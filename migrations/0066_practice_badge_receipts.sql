-- Atomic practice badge snapshots and negotiated LINE/TG receipt ownership.
-- Existing credentials/save signatures remain authoritative; no evaluator/table grants to API.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
 IF (SELECT count(*)=3 AND bool_and(p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_proc p
  WHERE p.oid IN ('platform.community_workspace_save(text,text,uuid,date,integer,text[],text,uuid[],text)'::regprocedure,
   'platform.queue_telegram_practice_receipt(text,uuid,text)'::regprocedure,
   'platform._pre_browser_queue_channel_practice_receipt(text,text,uuid,text)'::regprocedure)) IS DISTINCT FROM TRUE THEN
  RAISE EXCEPTION 'receipt migration requires the existing save/queue owner';
 END IF;
END $$;
CREATE FUNCTION core._practice_receipt_badge_keys(target UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_array(badge_code,rule_version,period) ORDER BY badge_code,rule_version,period),'[]'::jsonb)
 FROM core.person_practice_badges WHERE person_id=target AND revoked_at IS NULL
$$;
CREATE FUNCTION core._practice_receipt_new_badges(target UUID,before_keys JSONB,input_locale TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
 SELECT coalesce(jsonb_agg(admin._achievement_version_definition(badge_code,rule_version,input_locale)
  ||jsonb_build_object('period',period) ORDER BY badge_code,rule_version,period),'[]'::jsonb)
 FROM core.person_practice_badges WHERE person_id=target AND revoked_at IS NULL
  AND NOT coalesce(before_keys,'[]'::jsonb) @> jsonb_build_array(jsonb_build_array(badge_code,rule_version,period))
$$;
REVOKE ALL ON FUNCTION core._practice_receipt_badge_keys(UUID),core._practice_receipt_new_badges(UUID,JSONB,TEXT)
 FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
DO $$ DECLARE f RECORD; grantee_name TEXT; BEGIN
 FOR f IN SELECT p.oid,p.proowner FROM pg_proc p WHERE p.oid IN
 ('core._practice_receipt_badge_keys(uuid)'::regprocedure,'core._practice_receipt_new_badges(uuid,jsonb,text)'::regprocedure) LOOP
  FOR grantee_name IN SELECT r.rolname FROM pg_proc p,aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee
   WHERE p.oid=f.oid AND a.grantee<>f.proowner LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f.oid::regprocedure,grantee_name);
  END LOOP;
 END LOOP;
END $$;
-- Correlation indexes contain only in-flight wrapper-owned nonce payloads.
CREATE INDEX telegram_practice_receipts_save_nonce ON ops.telegram_practice_receipts((payload->>'_saveNonce')) WHERE payload?'_saveNonce';
CREATE INDEX channel_practice_receipts_save_nonce ON ops.channel_practice_receipts((payload->>'_saveNonce')) WHERE payload?'_saveNonce';

CREATE OR REPLACE FUNCTION platform.queue_telegram_practice_receipt(input_token TEXT,input_checkin UUID,input_action TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; ident UUID; recipient TEXT; practice core.checkins%ROWTYPE; payload JSONB; receipt UUID; locale TEXT; guidance JSONB;
BEGIN
  target:=platform.practice_person('telegram',input_token);
  IF input_action IS NULL OR input_action NOT IN ('regular','makeup','corrected') THEN RAISE EXCEPTION 'invalid receipt action'; END IF;
  SELECT * INTO practice FROM core.checkins WHERE id=input_checkin AND person_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'practice identity unavailable'; END IF;
  SELECT i.id,i.external_subject_id INTO ident,recipient FROM identity.platform_identities i
    JOIN platform.telegram_checkin_links l ON l.telegram_user_id=i.external_subject_id
    WHERE i.person_id=target AND i.platform='telegram' AND i.revoked_at IS NULL AND l.token_hash=public.digest(input_token,'sha256');
  locale:=platform.get_identity_locale('telegram',recipient);
  guidance:=core.lookup_practice_guidance(practice.practice_date);
  payload:=core.practice_metrics(target,(CURRENT_TIMESTAMP AT TIME ZONE practice.practice_timezone)::date)||jsonb_build_object(
    'date',practice.practice_date::text,'action',input_action,'locale',locale,
    'methods',(SELECT jsonb_agg(CASE WHEN locale='en' THEN m.name_en ELSE m.name_zh_tw END ORDER BY m.sort_order,m.code)
      FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=input_checkin));
  IF guidance IS NOT NULL THEN
    payload:=payload||jsonb_build_object('guidance',guidance);
  END IF;
  IF nullif(current_setting('qigong.practice_save_nonce',TRUE),'') IS NOT NULL THEN
   payload:=payload||jsonb_build_object('_saveNonce',current_setting('qigong.practice_save_nonce',TRUE));
 END IF;
 INSERT INTO ops.telegram_practice_receipts(identity_id,person_id,checkin_id,recipient,payload)
    VALUES(ident,target,input_checkin,recipient,payload) RETURNING id INTO receipt;
  RETURN receipt;
END;
$$;

CREATE OR REPLACE FUNCTION platform._pre_browser_queue_channel_practice_receipt(input_platform TEXT,input_credential TEXT,input_checkin UUID,input_action TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;ident UUID;recipient TEXT;practice core.checkins;payload JSONB;receipt UUID;locale TEXT;state TEXT;guidance JSONB;
BEGIN
 target:=platform.channel_workspace_person(input_platform,input_credential);ident:=platform.channel_workspace_identity(input_platform,input_credential,target);
 IF input_action IS NULL OR input_action NOT IN ('regular','makeup','corrected') THEN RAISE EXCEPTION 'invalid receipt action';END IF;
 SELECT * INTO practice FROM core.checkins WHERE id=input_checkin AND person_id=target;IF practice.id IS NULL THEN RAISE EXCEPTION 'practice identity unavailable';END IF;
 SELECT external_subject_id INTO recipient FROM identity.platform_identities WHERE id=ident;
 locale:=platform.get_identity_locale(input_platform,recipient);
 guidance:=core.lookup_practice_guidance(practice.practice_date);
 payload:=core.practice_metrics(target,(clock_timestamp() AT TIME ZONE practice.practice_timezone)::date)||jsonb_build_object('date',practice.practice_date::text,'action',input_action,'locale',locale,'methods',(SELECT jsonb_agg(CASE WHEN locale='en' THEN m.name_en ELSE m.name_zh_tw END ORDER BY m.sort_order,m.code) FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=input_checkin));
 IF guidance IS NOT NULL THEN
   payload:=payload||jsonb_build_object('guidance',guidance);
 END IF;
 state:=CASE WHEN input_platform='whatsapp' AND NOT EXISTS(SELECT 1 FROM platform.whatsapp_service_windows w WHERE w.subject_hash=platform.privacy_subject_hash('whatsapp',recipient) AND w.expires_at>clock_timestamp()) THEN 'cancelled' ELSE 'pending' END;
 IF nullif(current_setting('qigong.practice_save_nonce',TRUE),'') IS NOT NULL THEN
   payload:=payload||jsonb_build_object('_saveNonce',current_setting('qigong.practice_save_nonce',TRUE));
 END IF;
 INSERT INTO ops.channel_practice_receipts(platform,identity_id,person_id,checkin_id,recipient,payload,status) VALUES(input_platform,ident,target,practice.id,recipient,payload,state) RETURNING id INTO receipt;RETURN receipt;
END$$;

CREATE OR REPLACE FUNCTION platform.community_workspace_save(input_platform TEXT,input_credential TEXT,input_request UUID,input_date DATE,input_version INTEGER,input_methods TEXT[],input_note TEXT,input_tags UUID[],input_notice TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE response JSONB;practice UUID;owner UUID;ident UUID;before_practice UUID;before_note TEXT;before_version INTEGER;
 saved_notice TEXT:=current_setting('qigong.community_notice',TRUE);saved_nonce TEXT:=current_setting('qigong.practice_save_nonce',TRUE);
 saved_cause TEXT:=current_setting('qigong.achievement_cause',TRUE);
 mode TEXT;was_replay BOOLEAN;before_badges JSONB;new_badges JSONB;nonce TEXT;receipt UUID;receipt_payload JSONB;delivery TEXT;
BEGIN
 IF input_platform IS NULL OR input_platform NOT IN('line','telegram')
   OR (input_notice IS NOT NULL AND input_notice<>'student-community-notes-v1') THEN
   RAISE EXCEPTION 'invalid community notice';
 END IF;
 owner:=platform.practice_person(input_platform,input_credential);
 PERFORM pg_advisory_xact_lock(hashtextextended('community-note:'||owner::text,0));
 -- Preserve TG's existing link -> person lock order. Never lock person first then link.
 IF input_platform='telegram' THEN
   PERFORM 1 FROM platform.telegram_checkin_links WHERE token_hash=public.digest(input_credential,'sha256') AND expires_at>clock_timestamp() FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'practice identity unavailable'; END IF;
 END IF;
 PERFORM 1 FROM identity.people WHERE id=owner FOR UPDATE;
 IF NOT FOUND OR platform.practice_person(input_platform,input_credential) IS DISTINCT FROM owner THEN
   RAISE EXCEPTION 'practice identity unavailable';
 END IF;
 IF input_platform='telegram' THEN
   SELECT i.id INTO ident FROM identity.platform_identities i JOIN platform.telegram_checkin_links l ON l.telegram_user_id=i.external_subject_id
    WHERE i.person_id=owner AND i.platform='telegram' AND i.revoked_at IS NULL AND l.token_hash=public.digest(input_credential,'sha256');
   SELECT EXISTS(SELECT 1 FROM ops.telegram_practice_requests WHERE identity_id=ident AND request_id=input_request) INTO was_replay;
 ELSE
   ident:=platform.channel_workspace_identity('line',input_credential,owner);
   SELECT EXISTS(SELECT 1 FROM ops.channel_practice_requests WHERE identity_id=ident AND request_id=input_request) INTO was_replay;
 END IF;
 IF ident IS NULL THEN RAISE EXCEPTION 'practice identity unavailable'; END IF;
 SELECT c.id,coalesce(n.practice_note,''),coalesce(v.revision,0) INTO before_practice,before_note,before_version
  FROM core.checkins c LEFT JOIN core.checkin_notes n ON n.checkin_id=c.id
  LEFT JOIN platform.telegram_practice_versions v ON v.checkin_id=c.id WHERE c.person_id=owner AND c.practice_date=input_date;
 IF NOT was_replay THEN
   -- Settle prior eligible awards before snapshotting; only THIS mutation's delta is announced.
   PERFORM ops._evaluate_achievement_person(owner,TRUE);
   before_badges:=core._practice_receipt_badge_keys(owner);
   nonce:=gen_random_uuid()::text;
   PERFORM set_config('qigong.practice_save_nonce',nonce,TRUE);
 END IF;
 PERFORM set_config('qigong.community_notice',coalesce(input_notice,''),TRUE);
 -- Always enter the old save, including replay, so payload fingerprint/version/auth checks remain authoritative.
 IF input_platform='telegram' THEN
   response:=platform.telegram_workspace_save(input_credential,input_request,input_date,input_version,input_methods,input_note,input_tags);
 ELSE
   response:=platform.channel_workspace_save('line',input_credential,input_request,input_date,input_version,input_methods,input_note,input_tags);
 END IF;
 practice:=(response->>'checkinId')::uuid;
 IF NOT was_replay THEN
   PERFORM ops._evaluate_achievement_person(owner,FALSE);
   IF input_platform='telegram' THEN
     SELECT id,r.payload INTO STRICT receipt,receipt_payload FROM ops.telegram_practice_receipts r
      WHERE r.person_id=owner AND r.identity_id=ident AND r.checkin_id=practice
        AND r.payload?'_saveNonce' AND r.payload->>'_saveNonce'=nonce;
   ELSE
     SELECT id,r.payload INTO STRICT receipt,receipt_payload FROM ops.channel_practice_receipts r
      WHERE r.platform='line' AND r.person_id=owner AND r.identity_id=ident AND r.checkin_id=practice
        AND r.payload?'_saveNonce' AND r.payload->>'_saveNonce'=nonce;
   END IF;
   new_badges:=core._practice_receipt_new_badges(owner,before_badges,receipt_payload->>'locale');
   receipt_payload:=(receipt_payload-'_saveNonce')||jsonb_build_object('unlockedBadges',new_badges);
   delivery:=CASE WHEN input_platform='line' AND current_setting('qigong.line_receipt_mode',TRUE)='liff-summary-v1' THEN 'liff' ELSE 'bot' END;
   IF input_platform='telegram' THEN
     UPDATE ops.telegram_practice_receipts SET payload=receipt_payload WHERE id=receipt;
   ELSIF delivery='liff' THEN
     -- Never visible as pending outside this transaction; no Bot Push attempt or quota.
     UPDATE ops.channel_practice_receipts SET payload=receipt_payload,status='cancelled',last_error='LIFF client owns receipt delivery' WHERE id=receipt;
     response:=response||jsonb_build_object('receiptQueued',FALSE,'lineReceipt',jsonb_build_object('id',receipt,'payload',receipt_payload));
   ELSE
     UPDATE ops.channel_practice_receipts SET payload=receipt_payload WHERE id=receipt;
   END IF;
   response:=response||jsonb_build_object('unlockedBadges',new_badges,'receiptDelivery',delivery);
 END IF;
 -- Preserve original community-sharing semantics; notes/feelings never enter the chat payload.
 IF input_notice IS NOT NULL AND before_practice=practice AND trim(coalesce(before_note,''))='' AND trim(coalesce(input_note,''))<>'' AND before_version=input_version AND (response->>'version')::integer>before_version THEN
   INSERT INTO core.community_note_origins(checkin_id,notice_version) VALUES(practice,input_notice) ON CONFLICT(checkin_id) DO NOTHING;
 END IF;
 IF input_notice IS NOT NULL AND input_note IS NOT NULL AND (response->>'version')::integer=(SELECT revision FROM platform.telegram_practice_versions WHERE checkin_id=practice) AND (platform.journal_source(practice)->>'note') IS NOT DISTINCT FROM input_note THEN
   IF trim(input_note)<>'' THEN PERFORM platform.require_reflection_consent(input_platform,input_credential); END IF;
   PERFORM core.publish_community_note(practice);
 END IF;
 IF input_notice IS NOT NULL THEN
   SELECT CASE WHEN o.checkin_id IS NULL THEN 'legacy_private' WHEN o.manual_controlled THEN 'manual' ELSE 'automatic' END INTO mode
    FROM (SELECT practice id) target LEFT JOIN core.community_note_origins o ON o.checkin_id=target.id;
   response:=response||jsonb_build_object('communitySharing',mode,'communityShared',EXISTS(SELECT 1 FROM core.journal_publications WHERE checkin_id=practice AND active AND share_note AND trim(note_snapshot)<>''));
 END IF;
 IF input_platform='telegram' THEN
   UPDATE ops.telegram_practice_requests SET result=response WHERE identity_id=ident AND request_id=input_request;
 ELSE
   UPDATE ops.channel_practice_requests SET result=response WHERE identity_id=ident AND request_id=input_request;
 END IF;
 PERFORM set_config('qigong.community_notice',coalesce(saved_notice,''),TRUE);
 PERFORM set_config('qigong.practice_save_nonce',coalesce(saved_nonce,''),TRUE);
 PERFORM set_config('qigong.achievement_cause',coalesce(saved_cause,''),TRUE);
 RETURN response;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('qigong.community_notice',coalesce(saved_notice,''),TRUE);
 PERFORM set_config('qigong.practice_save_nonce',coalesce(saved_nonce,''),TRUE);
 PERFORM set_config('qigong.achievement_cause',coalesce(saved_cause,''),TRUE);
 RAISE;
END$$;
