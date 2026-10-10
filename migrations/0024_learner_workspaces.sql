-- Channel workspaces and durable private practice summaries. No provider activation or legacy import.
CREATE TABLE ops.channel_practice_requests (
 identity_id UUID NOT NULL REFERENCES identity.platform_identities(id),request_id UUID NOT NULL,payload_hash BYTEA NOT NULL,result JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(identity_id,request_id)
);
CREATE TABLE platform.whatsapp_service_windows (
 subject_hash BYTEA PRIMARY KEY,inbound_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE ops.channel_practice_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),platform TEXT NOT NULL CHECK(platform IN ('line','whatsapp')),
 identity_id UUID NOT NULL REFERENCES identity.platform_identities(id),person_id UUID NOT NULL REFERENCES identity.people(id),checkin_id UUID NOT NULL REFERENCES core.checkins(id),
 recipient TEXT NOT NULL,payload JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','delivered','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,lease_id UUID,leased_until TIMESTAMPTZ,delivered_at TIMESTAMPTZ,last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,CHECK((lease_id IS NULL)=(leased_until IS NULL))
);
CREATE INDEX channel_receipts_pending ON ops.channel_practice_receipts(platform,available_at,created_at) WHERE status IN ('pending','sending');
DO $$DECLARE t TEXT;BEGIN FOREACH t IN ARRAY ARRAY['ops.channel_practice_requests','platform.whatsapp_service_windows','ops.channel_practice_receipts'] LOOP EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON %s FROM PUBLIC',t);END LOOP;END$$;
CREATE FUNCTION platform.channel_workspace_person(input_platform TEXT,input_credential TEXT) RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF input_platform IS NULL OR input_platform NOT IN ('line','whatsapp') THEN RAISE EXCEPTION 'invalid workspace platform';END IF;
 RETURN platform.practice_person(input_platform,input_credential);
END$$;
CREATE FUNCTION platform.channel_workspace_identity(input_platform TEXT,input_credential TEXT,input_person UUID) RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE subject TEXT;ident UUID;
BEGIN
 subject:=CASE WHEN input_platform='line' THEN input_credential ELSE platform.whatsapp_link_subject(input_credential,'checkin') END;
 SELECT i.id INTO ident FROM identity.platform_identities i WHERE i.platform=input_platform AND i.external_subject_id=subject AND i.person_id=input_person AND i.revoked_at IS NULL;
 IF ident IS NULL THEN RAISE EXCEPTION 'practice identity unavailable';END IF;RETURN ident;
END$$;
CREATE FUNCTION platform.record_whatsapp_service_window(input_subject TEXT,input_inbound TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF input_subject IS NULL OR input_subject !~ '^[0-9]{1,20}$' OR input_inbound IS NULL OR input_inbound>clock_timestamp()+INTERVAL '5 minutes' OR input_inbound<clock_timestamp()-INTERVAL '24 hours' THEN RAISE EXCEPTION 'invalid WhatsApp service window';END IF;
 INSERT INTO platform.whatsapp_service_windows(subject_hash,inbound_at,expires_at) VALUES(platform.privacy_subject_hash('whatsapp',input_subject),least(input_inbound,clock_timestamp()),least(input_inbound,clock_timestamp())+INTERVAL '24 hours')
 ON CONFLICT(subject_hash) DO UPDATE SET inbound_at=greatest(whatsapp_service_windows.inbound_at,EXCLUDED.inbound_at),expires_at=greatest(whatsapp_service_windows.expires_at,EXCLUDED.expires_at);
END$$;

CREATE FUNCTION platform.channel_workspace_timezone(input_platform TEXT,input_credential TEXT,input_zone TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; old_zone TEXT; last_change TIMESTAMPTZ; now_time TIMESTAMPTZ:=clock_timestamp();
BEGIN
  target:=platform.channel_workspace_person(input_platform,input_credential);
  SELECT practice_timezone INTO old_zone FROM identity.people WHERE id=target FOR UPDATE;
  IF platform.channel_workspace_person(input_platform,input_credential) IS DISTINCT FROM target THEN RAISE EXCEPTION 'practice identity unavailable';END IF;
  now_time:=clock_timestamp();
  IF input_zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=input_zone)
    OR length(input_zone)>100 THEN RAISE EXCEPTION 'invalid workspace timezone'; END IF;
  SELECT timezone_changed_at INTO last_change FROM platform.telegram_workspace_preferences WHERE person_id=target;
  IF old_zone<>input_zone THEN
    IF last_change>now_time-INTERVAL '24 hours' THEN RAISE EXCEPTION 'workspace timezone cooldown'; END IF;
    IF EXISTS(SELECT 1 FROM core.checkins WHERE person_id=target)
      OR EXISTS(SELECT 1 FROM platform.telegram_workspace_preferences WHERE person_id=target) THEN
      IF (now_time AT TIME ZONE old_zone)::date<>(now_time AT TIME ZONE input_zone)::date
        OR ((now_time AT TIME ZONE old_zone)::time<TIME '12:00')<>((now_time AT TIME ZONE input_zone)::time<TIME '12:00')
      THEN RAISE EXCEPTION 'workspace timezone window differs'; END IF;
    END IF;
    UPDATE identity.people SET practice_timezone=input_zone WHERE id=target;
  END IF;
  INSERT INTO platform.telegram_workspace_preferences(person_id,timezone_changed_at)
    VALUES(target,CASE WHEN old_zone<>input_zone THEN now_time ELSE NULL END)
    ON CONFLICT(person_id) DO UPDATE SET timezone_changed_at=CASE WHEN old_zone<>input_zone THEN now_time ELSE telegram_workspace_preferences.timezone_changed_at END;
END;
$$;
CREATE FUNCTION platform.channel_workspace_report(input_platform TEXT,input_credential TEXT,input_view TEXT,input_locale TEXT,input_period TEXT DEFAULT 'month',input_days INTEGER DEFAULT 30,input_month DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; zone TEXT; anchor DATE; start_day DATE; end_day DATE; result JSONB; metrics JSONB; region UUID;
BEGIN
  target:=platform.channel_workspace_person(input_platform,input_credential);IF input_platform='line' THEN input_locale:='zh_TW';END IF;
  IF input_locale IS NULL OR input_locale NOT IN ('zh_TW','en') THEN RAISE EXCEPTION 'invalid workspace query'; END IF;
  SELECT practice_timezone INTO zone FROM identity.people WHERE id=target;
  anchor:=(CURRENT_TIMESTAMP AT TIME ZONE zone)::date;
  metrics:=core.practice_metrics(target,anchor);
  CASE input_view
    WHEN 'profile' THEN
      RETURN metrics||jsonb_build_object('today',anchor::text,'timezone',zone,
        'confirmed',EXISTS(SELECT 1 FROM platform.telegram_workspace_preferences WHERE person_id=target),
        'makeupOpen',(CURRENT_TIMESTAMP AT TIME ZONE zone)::time<TIME '12:00',
        'entries',platform.telegram_workspace_entries(target,anchor-13,anchor+1,input_locale),
        'feelingTags',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',CASE WHEN input_locale='en' THEN name_en ELSE name_zh_tw END) ORDER BY sort_order,id),'[]') FROM core.practice_feeling_tags WHERE active),
        'methods',(SELECT coalesce(jsonb_agg(jsonb_build_object('code',m.code,'name',CASE WHEN input_locale='en' THEN m.name_en ELSE m.name_zh_tw END,
          'groupCode',coalesce(p.code,m.code),'group',CASE WHEN input_locale='en' THEN coalesce(p.name_en,m.name_en) ELSE coalesce(p.name_zh_tw,m.name_zh_tw) END)
          ORDER BY coalesce(p.sort_order,m.sort_order),m.sort_order,m.code),'[]') FROM core.practice_methods m LEFT JOIN core.practice_methods p ON p.id=m.parent_id
          WHERE m.active AND m.method_type='leaf' AND NOT EXISTS(SELECT 1 FROM core.practice_method_platforms a WHERE a.practice_method_id=m.id AND a.platform=input_platform AND NOT a.available)));
    WHEN 'history' THEN
      IF input_month IS NULL OR input_month<DATE '2000-01-01' OR input_month>anchor THEN RAISE EXCEPTION 'invalid workspace query'; END IF;
      start_day:=date_trunc('month',input_month)::date; end_day:=(start_day+INTERVAL '1 month')::date;
      RETURN jsonb_build_object('month',to_char(start_day,'YYYY-MM'),'entries',platform.telegram_workspace_entries(target,start_day,end_day,input_locale));
    WHEN 'methods' THEN
      IF input_days IS NULL OR input_days NOT IN (30,90) THEN RAISE EXCEPTION 'invalid workspace query'; END IF;
      start_day:=anchor-input_days+1;
      SELECT coalesce(jsonb_agg(to_jsonb(item) ORDER BY item.days DESC,item.code),'[]') INTO result FROM (
        SELECT coalesce(p.code,m.code) code,CASE WHEN input_locale='en' THEN coalesce(p.name_en,m.name_en) ELSE coalesce(p.name_zh_tw,m.name_zh_tw) END name,
          count(DISTINCT c.practice_date)::integer days
        FROM core.checkins c JOIN core.checkin_method_selections s ON s.checkin_id=c.id
          JOIN core.practice_methods m ON m.id=s.practice_method_id LEFT JOIN core.practice_methods p ON p.id=m.parent_id
        WHERE c.person_id=target AND c.practice_date BETWEEN start_day AND anchor GROUP BY coalesce(p.code,m.code),2
      ) item;
      RETURN jsonb_build_object('days',input_days,'start',start_day::text,'end',anchor::text,'mix',result,
        'entries',platform.telegram_workspace_entries(target,anchor-13,anchor+1,input_locale));
    WHEN 'leaderboard' THEN
      IF input_period IS NULL OR input_period NOT IN ('week','month','quarter','year','all') THEN RAISE EXCEPTION 'invalid workspace query'; END IF;
      start_day:=CASE WHEN input_period='all' THEN DATE '2000-01-01' ELSE date_trunc(input_period,anchor::timestamp)::date END;
      SELECT region_id INTO region FROM core.person_region_assignments WHERE person_id=target AND assignment_type='primary'
        AND valid_from<=anchor AND (valid_to IS NULL OR valid_to>anchor);
      IF region IS NULL THEN RAISE EXCEPTION 'workspace region unavailable'; END IF;
      WITH eligible AS (
        SELECT DISTINCT p.id FROM identity.people p JOIN core.person_region_assignments a ON a.person_id=p.id
        WHERE p.status='active' AND a.region_id=region AND a.assignment_type='primary' AND a.valid_from<=anchor AND (a.valid_to IS NULL OR a.valid_to>anchor)
          AND EXISTS(SELECT 1 FROM identity.platform_identities i JOIN identity.person_interaction_channels ch ON ch.platform_identity_id=i.id AND ch.person_id=i.person_id
            JOIN identity.onboarding_applications ap ON ap.person_id=i.person_id AND ap.platform=input_platform AND ap.external_subject_id=i.external_subject_id AND ap.status='approved'
            WHERE i.person_id=p.id AND i.platform=input_platform AND i.revoked_at IS NULL AND ch.valid_from<=CURRENT_TIMESTAMP AND ch.valid_to IS NULL)
      ), counts AS (
        SELECT e.id,count(c.id)::integer days FROM eligible e JOIN core.checkins c ON c.person_id=e.id
          AND c.practice_date BETWEEN start_day AND anchor GROUP BY e.id
      ), ranked AS (SELECT *,rank() OVER(ORDER BY days DESC)::integer position FROM counts)
      SELECT jsonb_build_object('period',input_period,'start',start_day::text,'end',anchor::text,
        'scope','same_region_masked','rows',coalesce((SELECT jsonb_agg(jsonb_build_object('rank',position,'days',days,'self',id=target,
          'label',CASE WHEN id=target THEN CASE WHEN input_locale='en' THEN 'You' ELSE '你' END
            ELSE CASE WHEN input_locale='en' THEN 'Learner ' ELSE '學員 ' END||left(encode(public.digest(id::text||region::text,'sha256'),'hex'),6) END) ORDER BY position,id)
          FROM (SELECT * FROM ranked ORDER BY position,id LIMIT 30) r),'[]'),
        'ownRank',(SELECT position FROM ranked WHERE id=target),'ownDays',coalesce((SELECT days FROM ranked WHERE id=target),0)) INTO result;
      RETURN result;
    WHEN 'achievements' THEN
      PERFORM core.evaluate_practice_badges(target);
      SELECT coalesce(jsonb_agg(jsonb_build_object('code',d.code,'kind',d.kind,'name',CASE WHEN input_locale='en' THEN d.name_en ELSE d.name_zh_tw END,
        'threshold',d.threshold,'ruleVersion',d.rule_version,
        'configured',CASE WHEN d.kind IN ('summer','winter') THEN EXISTS(SELECT 1 FROM core.practice_badge_seasons s WHERE s.kind=d.kind)
          ELSE NOT EXISTS(SELECT 1 FROM unnest(d.method_codes) AS required(method_code) WHERE NOT EXISTS(SELECT 1 FROM core.practice_methods m WHERE m.code=required.method_code)) END,
        'awards',(SELECT coalesce(jsonb_agg(jsonb_build_object('period',b.period,'earnedAt',b.earned_at,'revoked',b.revoked_at IS NOT NULL) ORDER BY b.period),'[]')
          FROM core.person_practice_badges b WHERE b.person_id=target AND b.badge_code=d.code AND b.rule_version=d.rule_version)) ORDER BY d.sort_order,d.code),'[]')
        INTO result FROM core.practice_badge_definitions d;
      RETURN metrics||jsonb_build_object('badges',result);
    ELSE RAISE EXCEPTION 'invalid workspace query';
  END CASE;
END;
$$;

CREATE FUNCTION platform.queue_channel_practice_receipt(input_platform TEXT,input_credential TEXT,input_checkin UUID,input_action TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;ident UUID;recipient TEXT;practice core.checkins;payload JSONB;receipt UUID;locale TEXT;state TEXT;
BEGIN
 target:=platform.channel_workspace_person(input_platform,input_credential);ident:=platform.channel_workspace_identity(input_platform,input_credential,target);
 IF input_action IS NULL OR input_action NOT IN ('regular','makeup','corrected') THEN RAISE EXCEPTION 'invalid receipt action';END IF;
 SELECT * INTO practice FROM core.checkins WHERE id=input_checkin AND person_id=target;IF practice.id IS NULL THEN RAISE EXCEPTION 'practice identity unavailable';END IF;
 SELECT external_subject_id INTO recipient FROM identity.platform_identities WHERE id=ident;
 locale:=CASE WHEN input_platform='line' THEN 'zh_TW' ELSE platform.get_identity_locale(input_platform,recipient) END;
 payload:=core.practice_metrics(target,(clock_timestamp() AT TIME ZONE practice.practice_timezone)::date)||jsonb_build_object('date',practice.practice_date::text,'action',input_action,'locale',locale,'methods',(SELECT jsonb_agg(CASE WHEN locale='en' THEN m.name_en ELSE m.name_zh_tw END ORDER BY m.sort_order,m.code) FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=input_checkin));
 state:=CASE WHEN input_platform='whatsapp' AND NOT EXISTS(SELECT 1 FROM platform.whatsapp_service_windows w WHERE w.subject_hash=platform.privacy_subject_hash('whatsapp',recipient) AND w.expires_at>clock_timestamp()) THEN 'cancelled' ELSE 'pending' END;
 INSERT INTO ops.channel_practice_receipts(platform,identity_id,person_id,checkin_id,recipient,payload,status) VALUES(input_platform,ident,target,practice.id,recipient,payload,state) RETURNING id INTO receipt;RETURN receipt;
END$$;
CREATE FUNCTION platform.channel_workspace_save(input_platform TEXT,input_credential TEXT,input_request UUID,input_date DATE,input_version INTEGER,input_methods TEXT[],input_note TEXT,input_tags UUID[]) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;ident UUID;practice UUID;actual_version INTEGER;anchor DATE;zone TEXT;old_request ops.channel_practice_requests;fingerprint BYTEA;result JSONB;action TEXT;receipt UUID;subject TEXT;
BEGIN
 target:=platform.channel_workspace_person(input_platform,input_credential);
 SELECT practice_timezone INTO zone FROM identity.people WHERE id=target FOR UPDATE;
 IF platform.channel_workspace_person(input_platform,input_credential) IS DISTINCT FROM target THEN RAISE EXCEPTION 'practice identity unavailable';END IF;
 IF coalesce(input_note,'')<>'' OR cardinality(input_tags)>0 THEN PERFORM platform.require_reflection_consent(input_platform,input_credential);END IF;
 ident:=platform.channel_workspace_identity(input_platform,input_credential,target);
 IF input_request IS NULL OR input_date IS NULL OR input_version IS NULL OR input_version<0 THEN RAISE EXCEPTION 'invalid workspace save';END IF;
 fingerprint:=public.digest(jsonb_build_array(input_date,input_version,input_methods,input_note,input_tags)::text,'sha256');
 SELECT * INTO old_request FROM ops.channel_practice_requests WHERE identity_id=ident AND request_id=input_request;
 IF old_request.identity_id IS NOT NULL THEN IF old_request.payload_hash<>fingerprint THEN RAISE EXCEPTION 'workspace request conflict' USING ERRCODE='40001';END IF;RETURN old_request.result;END IF;
 IF NOT EXISTS(SELECT 1 FROM platform.telegram_workspace_preferences WHERE person_id=target) THEN RAISE EXCEPTION 'workspace timezone unconfirmed';END IF;
 anchor:=(CURRENT_TIMESTAMP AT TIME ZONE zone)::date;
 IF (clock_timestamp() AT TIME ZONE zone)::date<>anchor OR (input_date<>anchor AND (input_date<>anchor-1 OR (clock_timestamp() AT TIME ZONE zone)::time>=TIME '12:00')) THEN RAISE EXCEPTION 'checkin correction unavailable';END IF;
 SELECT id INTO practice FROM core.checkins WHERE person_id=target AND practice_date=input_date FOR UPDATE;
 SELECT external_subject_id INTO subject FROM identity.platform_identities WHERE id=ident;
 IF practice IS NULL THEN
  IF input_version<>0 THEN RAISE EXCEPTION 'workspace version conflict' USING ERRCODE='40001';END IF;
  IF input_platform='line' THEN SELECT checkin_id,entry_kind INTO practice,action FROM platform.submit_line_checkin(subject,input_methods,input_date=anchor-1);
  ELSE SELECT checkin_id,entry_kind INTO practice,action FROM platform.submit_whatsapp_checkin(subject,input_methods,input_date=anchor-1);END IF;
 ELSE
  SELECT coalesce((SELECT revision FROM platform.telegram_practice_versions WHERE checkin_id=practice),0) INTO actual_version;
  IF actual_version<>input_version THEN RAISE EXCEPTION 'workspace version conflict' USING ERRCODE='40001';END IF;
  IF input_platform='line' THEN PERFORM platform.correct_line_checkin(subject,practice,input_methods);ELSE PERFORM platform.correct_whatsapp_checkin(subject,practice,input_methods);END IF;action:='corrected';
 END IF;
 PERFORM platform.save_practice_note(input_platform,input_credential,practice,input_note,input_tags);
 receipt:=platform.queue_channel_practice_receipt(input_platform,input_credential,practice,action);
 SELECT revision INTO actual_version FROM platform.telegram_practice_versions WHERE checkin_id=practice;
 result:=jsonb_build_object('checkinId',practice,'version',actual_version,'action',action,'receiptQueued',(SELECT status='pending' FROM ops.channel_practice_receipts WHERE id=receipt));
 INSERT INTO ops.channel_practice_requests(identity_id,request_id,payload_hash,result) VALUES(ident,input_request,fingerprint,result);RETURN result;
END$$;
CREATE FUNCTION ops.channel_practice_receipt_eligible(input_id UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM ops.channel_practice_receipts r JOIN identity.platform_identities i ON i.id=r.identity_id AND i.person_id=r.person_id AND i.platform=r.platform AND i.external_subject_id=r.recipient JOIN identity.people p ON p.id=i.person_id
 JOIN identity.person_interaction_channels ch ON ch.person_id=p.id AND ch.platform_identity_id=i.id JOIN identity.onboarding_applications a ON a.person_id=p.id AND a.platform=i.platform AND a.external_subject_id=i.external_subject_id AND a.status='approved'
 WHERE r.id=input_id AND p.status='active' AND i.revoked_at IS NULL AND ch.valid_from<=clock_timestamp() AND ch.valid_to IS NULL
 AND (platform.privacy_status(r.platform,r.recipient)->>'required')::boolean IS NOT TRUE
 AND (r.platform='line' OR EXISTS(SELECT 1 FROM platform.whatsapp_service_windows w WHERE w.subject_hash=platform.privacy_subject_hash('whatsapp',r.recipient) AND w.expires_at>clock_timestamp())))
$$;
CREATE FUNCTION ops.claim_channel_practice_receipts(input_platform TEXT,batch_size INTEGER) RETURNS TABLE(id UUID,lease_id UUID,recipient TEXT,payload JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF input_platform IS NULL OR input_platform NOT IN ('line','whatsapp') OR batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid receipt batch size';END IF;
 UPDATE ops.channel_practice_receipts r SET status='failed',lease_id=NULL,leased_until=NULL,last_error='retry limit reached' WHERE r.platform=input_platform AND r.status='sending' AND r.attempts>=8 AND r.leased_until<clock_timestamp();
 UPDATE ops.channel_practice_receipts r SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE r.platform=input_platform AND r.status IN ('pending','sending') AND ops.channel_practice_receipt_eligible(r.id) IS NOT TRUE;
 RETURN QUERY WITH selected AS(SELECT r.id FROM ops.channel_practice_receipts r WHERE r.platform=input_platform AND r.status IN ('pending','sending') AND r.attempts<8 AND r.available_at<=clock_timestamp() AND (r.status='pending' OR r.leased_until<clock_timestamp()) ORDER BY r.available_at,r.created_at,r.id FOR UPDATE SKIP LOCKED LIMIT batch_size)
 UPDATE ops.channel_practice_receipts r SET status='sending',attempts=r.attempts+1,lease_id=gen_random_uuid(),leased_until=clock_timestamp()+INTERVAL '10 minutes' FROM selected s WHERE r.id=s.id RETURNING r.id,r.lease_id,r.recipient,r.payload;
END$$;
CREATE FUNCTION ops.channel_practice_receipt_allowed(input_id UUID,input_lease UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM ops.channel_practice_receipts r WHERE r.id=input_id AND r.lease_id=input_lease AND r.status='sending' AND r.leased_until>clock_timestamp() AND ops.channel_practice_receipt_eligible(r.id))$$;
CREATE FUNCTION ops.finish_channel_practice_receipt(input_id UUID,input_lease UUID,input_delivered BOOLEAN) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE done UUID;BEGIN
 IF input_delivered IS NULL THEN RAISE EXCEPTION 'receipt outcome required';END IF;
 UPDATE ops.channel_practice_receipts r SET status=CASE WHEN input_delivered THEN 'delivered' WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,delivered_at=CASE WHEN input_delivered THEN clock_timestamp() ELSE NULL END,
 available_at=clock_timestamp()+LEAST(3600,30*power(2,LEAST(attempts-1,7)))*INTERVAL '1 second',lease_id=NULL,leased_until=NULL,last_error=CASE WHEN input_delivered THEN NULL ELSE 'Messaging delivery failed' END
 WHERE r.id=input_id AND r.lease_id=input_lease AND r.status='sending' AND r.leased_until>clock_timestamp() RETURNING r.id INTO done;RETURN done IS NOT NULL;
END$$;
DO $$DECLARE f RECORD;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE(n.nspname='platform' AND p.proname IN ('channel_workspace_person','channel_workspace_identity','channel_workspace_report','channel_workspace_timezone','channel_workspace_save','queue_channel_practice_receipt','record_whatsapp_service_window')) OR(n.nspname='ops' AND p.proname IN ('channel_practice_receipt_eligible','claim_channel_practice_receipts','channel_practice_receipt_allowed','finish_channel_practice_receipt')) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION platform.channel_workspace_report(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,DATE),platform.channel_workspace_timezone(TEXT,TEXT,TEXT),platform.channel_workspace_save(TEXT,TEXT,UUID,DATE,INTEGER,TEXT[],TEXT,UUID[]),platform.record_whatsapp_service_window(TEXT,TIMESTAMPTZ) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION ops.claim_channel_practice_receipts(TEXT,INTEGER),ops.channel_practice_receipt_allowed(UUID,UUID),ops.finish_channel_practice_receipt(UUID,UUID,BOOLEAN) TO qigong_worker_runtime;
CREATE FUNCTION platform.channel_journal_person(input_platform TEXT,input_credential TEXT) RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE target UUID;BEGIN
 target:=platform.channel_workspace_person(input_platform,input_credential);PERFORM 1 FROM identity.people WHERE id=target FOR UPDATE;
 IF platform.channel_workspace_person(input_platform,input_credential) IS DISTINCT FROM target THEN RAISE EXCEPTION 'practice identity unavailable';END IF;RETURN target;
END$$;
CREATE FUNCTION platform.channel_journal_own(input_platform TEXT,input_credential TEXT,input_page INTEGER,input_locale TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; result JSONB;
BEGIN
  target:=platform.channel_journal_person(input_platform,input_credential);
  IF input_page IS NULL OR input_page NOT BETWEEN 1 AND 100000 OR input_locale IS NULL OR input_locale NOT IN ('en','zh_TW') THEN RAISE EXCEPTION 'invalid journal query'; END IF;
  WITH visible AS (
    SELECT c.id,c.practice_date,coalesce(n.practice_note,'') practice_note,p.revision,p.active,p.alias,p.external_enabled,p.share_note,p.share_feelings,p.note_snapshot,p.tag_snapshot,p.method_snapshot
    FROM core.checkins c LEFT JOIN core.checkin_notes n ON n.checkin_id=c.id
      LEFT JOIN core.journal_publications p ON p.checkin_id=c.id
    WHERE c.person_id=target AND (EXISTS(SELECT 1 FROM core.checkin_privacy_origins origin WHERE origin.checkin_id=c.id) OR n.practice_note<>'' OR EXISTS(SELECT 1 FROM core.checkin_note_tags t WHERE t.checkin_id=c.id))
  ), entries AS (SELECT * FROM visible ORDER BY practice_date DESC,id DESC LIMIT 20 OFFSET (input_page-1)*20)
  SELECT jsonb_build_object('page',input_page,'total',(SELECT count(*) FROM visible),'entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'autoShared',EXISTS(SELECT 1 FROM core.checkin_privacy_origins origin WHERE origin.checkin_id=e.id),
    'sourceHash',encode(public.digest(platform.journal_source(e.id)::text,'sha256'),'hex'),
    'checkinId',e.id,'date',e.practice_date,'practiceNote',e.practice_note,'version',coalesce(e.revision,0),'active',coalesce(e.active,FALSE),
    'alias',coalesce(e.alias,''),'externalEnabled',coalesce(e.external_enabled,FALSE),'shareNote',coalesce(e.share_note,FALSE),'shareFeelings',coalesce(e.share_feelings,FALSE),
    'methods',(SELECT coalesce(jsonb_agg(CASE WHEN input_locale='en' THEN m.name_en ELSE m.name_zh_tw END ORDER BY m.sort_order,m.code),'[]') FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=e.id),
    'publishedNote',e.note_snapshot,'publishedTags',e.tag_snapshot,'publishedMethods',e.method_snapshot,
    'feelingTags',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.tag_id,'name',CASE WHEN input_locale='en' THEN t.name_en ELSE t.name_zh_tw END) ORDER BY t.sort_order,t.tag_id),'[]') FROM core.checkin_note_tags t WHERE t.checkin_id=e.id)
    ) ORDER BY e.practice_date DESC,e.id DESC) FROM entries e),'[]')) INTO result;
  RETURN result;
END;
$$;
CREATE FUNCTION platform.channel_journal_publish(input_platform TEXT,input_credential TEXT,input_checkin UUID,input_version INTEGER,input_active BOOLEAN,input_note BOOLEAN,input_feelings BOOLEAN,input_external BOOLEAN,input_alias TEXT,input_source_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; ident UUID; current_revision INTEGER; practice DATE; note TEXT; tags JSONB; methods JSONB; source JSONB; result JSONB;
BEGIN
  target:=platform.channel_journal_person(input_platform,input_credential);IF input_active AND (input_note OR input_feelings) THEN PERFORM platform.require_reflection_consent(input_platform,input_credential);END IF;
  IF input_version IS NULL OR input_version<0 OR input_active IS NULL OR input_note IS NULL OR input_feelings IS NULL OR input_external IS NULL
    OR input_alias IS NULL OR length(trim(input_alias)) NOT BETWEEN 1 AND 40 OR input_alias ~ '[[:cntrl:]]'
  THEN RAISE EXCEPTION 'invalid journal publication'; END IF;
  SELECT c.practice_date,coalesce(n.practice_note,'') INTO practice,note FROM core.checkins c
    LEFT JOIN core.checkin_notes n ON n.checkin_id=c.id WHERE c.id=input_checkin AND c.person_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'journal unavailable'; END IF;
  SELECT revision INTO current_revision FROM core.journal_publications WHERE checkin_id=input_checkin FOR UPDATE;
  IF coalesce(current_revision,0)<>input_version THEN RAISE EXCEPTION 'journal version conflict' USING ERRCODE='40001'; END IF;
  IF NOT input_active THEN
    IF current_revision IS NULL THEN RETURN jsonb_build_object('version',0,'active',FALSE); END IF;
    UPDATE core.journal_publications SET active=FALSE,external_enabled=FALSE,revision=revision+1 WHERE checkin_id=input_checkin RETURNING jsonb_build_object('version',revision,'active',active) INTO result;
  ELSE
    ident:=platform.channel_workspace_identity(input_platform,input_credential,target);
    source:=platform.journal_source(input_checkin);
    IF input_source_hash IS DISTINCT FROM encode(public.digest(source::text,'sha256'),'hex') THEN RAISE EXCEPTION 'journal source conflict' USING ERRCODE='40001'; END IF;
    note:=source->>'note';tags:=source->'tags';methods:=source->'methods';practice:=(source->>'date')::date;
    IF NOT input_note THEN note:=''; END IF;
    IF NOT input_feelings THEN tags:='[]'; END IF;
    IF trim(note)='' AND jsonb_array_length(tags)=0 AND NOT (jsonb_array_length(methods)>0 AND EXISTS(SELECT 1 FROM core.checkin_privacy_origins WHERE checkin_id=input_checkin)) THEN RAISE EXCEPTION 'empty journal publication'; END IF;

    INSERT INTO core.journal_publications(checkin_id,person_id,identity_id,revision,active,external_enabled,share_note,share_feelings,alias,practice_date,note_snapshot,method_snapshot,tag_snapshot)
      VALUES(input_checkin,target,ident,1,TRUE,input_external,input_note,input_feelings,trim(input_alias),practice,note,methods,tags)
      ON CONFLICT(checkin_id) DO UPDATE SET revision=journal_publications.revision+1,active=TRUE,external_enabled=EXCLUDED.external_enabled,
        share_note=EXCLUDED.share_note,share_feelings=EXCLUDED.share_feelings,alias=EXCLUDED.alias,identity_id=EXCLUDED.identity_id,
        note_snapshot=EXCLUDED.note_snapshot,method_snapshot=EXCLUDED.method_snapshot,tag_snapshot=EXCLUDED.tag_snapshot,published_at=clock_timestamp()
      RETURNING jsonb_build_object('version',revision,'active',active) INTO result;
  END IF;
  IF input_active AND EXISTS(SELECT 1 FROM platform.learner_privacy_policies p WHERE p.state='active') THEN UPDATE core.journal_publications SET shared_with_staff=TRUE WHERE checkin_id=input_checkin;END IF;
  INSERT INTO audit.events(request_id,action,target_type,target_id,outcome,metadata)
    VALUES(admin.request_id(),CASE WHEN input_active THEN 'journal.publish' ELSE 'journal.withdraw' END,'journal_publication',input_checkin,'success',jsonb_build_object('version',result->'version','external',input_active AND input_external));
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION platform.channel_journal_person(TEXT,TEXT),platform.channel_journal_own(TEXT,TEXT,INTEGER,TEXT),platform.channel_journal_publish(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.channel_journal_own(TEXT,TEXT,INTEGER,TEXT),platform.channel_journal_publish(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT) TO qigong_api_runtime;

CREATE FUNCTION ops.channel_workspace_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-9-channel-workspaces')$$;
REVOKE ALL ON FUNCTION ops.channel_workspace_schema_ready() FROM PUBLIC;GRANT EXECUTE ON FUNCTION ops.channel_workspace_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-9-channel-workspaces',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
