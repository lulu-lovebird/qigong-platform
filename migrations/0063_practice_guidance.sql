-- 0063_practice_guidance.sql
-- Master / Super Admin managed practice guidance campaigns and daily instructions attached to practice receipts.

-- 1. Campaigns table
CREATE TABLE IF NOT EXISTS core.practice_guidance_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 150),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES admin.principals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (end_date >= start_date)
);

ALTER TABLE core.practice_guidance_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.practice_guidance_campaigns FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.practice_guidance_campaigns FROM PUBLIC;
GRANT SELECT ON core.practice_guidance_campaigns TO qigong_api_runtime, qigong_worker_runtime;

DROP POLICY IF EXISTS guidance_campaigns_reader ON core.practice_guidance_campaigns;
CREATE POLICY guidance_campaigns_reader ON core.practice_guidance_campaigns FOR SELECT USING (true);

-- 2. Daily guidance entries table
CREATE TABLE IF NOT EXISTS core.practice_guidance_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES core.practice_guidance_campaigns(id) ON DELETE CASCADE,
  guide_date DATE NOT NULL,
  title TEXT CHECK (title IS NULL OR char_length(trim(title)) <= 100),
  content TEXT NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (campaign_id, guide_date)
);

ALTER TABLE core.practice_guidance_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.practice_guidance_entries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.practice_guidance_entries FROM PUBLIC;
GRANT SELECT ON core.practice_guidance_entries TO qigong_api_runtime, qigong_worker_runtime;

DROP POLICY IF EXISTS guidance_entries_reader ON core.practice_guidance_entries;
CREATE POLICY guidance_entries_reader ON core.practice_guidance_entries FOR SELECT USING (true);

-- Indexes for active lookup
CREATE INDEX IF NOT EXISTS idx_guidance_campaign_dates
  ON core.practice_guidance_campaigns(start_date, end_date)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_guidance_entries_lookup
  ON core.practice_guidance_entries(guide_date);

-- 3. Lookup function for practice receipt generation
CREATE OR REPLACE FUNCTION core.lookup_practice_guidance(input_date DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;
BEGIN
  IF input_date IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'campaignTitle', c.title,
    'guideDate', e.guide_date,
    'title', e.title,
    'content', e.content
  ) INTO result
  FROM core.practice_guidance_entries e
  JOIN core.practice_guidance_campaigns c ON c.id = e.campaign_id
  WHERE c.is_active = true
    AND e.guide_date = input_date
    AND input_date BETWEEN c.start_date AND c.end_date
  ORDER BY c.created_at DESC
  LIMIT 1;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION core.lookup_practice_guidance(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.lookup_practice_guidance(DATE) TO qigong_api_runtime, qigong_worker_runtime;

-- 5. Hook guidance lookup into practice receipt queuing
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
 INSERT INTO ops.channel_practice_receipts(platform,identity_id,person_id,checkin_id,recipient,payload,status) VALUES(input_platform,ident,target,practice.id,recipient,payload,state) RETURNING id INTO receipt;RETURN receipt;
END$$;

CREATE OR REPLACE FUNCTION platform.queue_channel_practice_receipt(input_platform TEXT,input_credential TEXT,input_checkin UUID,input_action TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE target UUID;BEGIN
 IF input_platform='whatsapp' THEN target:=platform.channel_workspace_person(input_platform,input_credential);
 IF input_action IS NULL OR input_action NOT IN ('regular','makeup','corrected') OR NOT EXISTS(SELECT 1 FROM core.checkins WHERE id=input_checkin AND person_id=target) THEN RAISE EXCEPTION 'invalid receipt action';END IF;RETURN NULL;END IF;
 RETURN platform._pre_browser_queue_channel_practice_receipt(input_platform,input_credential,input_checkin,input_action);
END$$;

CREATE OR REPLACE FUNCTION platform.channel_workspace_save(input_platform TEXT,input_credential TEXT,input_request UUID,input_date DATE,input_version INTEGER,input_methods TEXT[],input_note TEXT,input_tags UUID[]) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;ident UUID;practice UUID;actual_version INTEGER;anchor DATE;zone TEXT;old_request ops.channel_practice_requests;fingerprint BYTEA;result JSONB;action TEXT;receipt UUID;subject TEXT;guidance JSONB;
BEGIN
 target:=platform.channel_workspace_person(input_platform,input_credential);
 SELECT practice_timezone INTO zone FROM identity.people WHERE id=target FOR UPDATE;
 IF platform.channel_workspace_person(input_platform,input_credential) IS DISTINCT FROM target THEN RAISE EXCEPTION 'practice identity unavailable';END IF;
 IF coalesce(input_note,'')<>'' OR cardinality(input_tags)>0 THEN PERFORM platform.require_reflection_consent(input_platform,input_credential);END IF;
 ident:=platform.channel_workspace_identity(input_platform,input_credential,target);
 IF input_request IS NULL OR input_date IS NULL OR input_version IS NULL OR input_version<0 THEN RAISE EXCEPTION 'invalid workspace save';END IF;
 fingerprint:=public.digest(jsonb_build_array(input_date,input_version,input_methods,input_note,input_tags)::text,'sha256');
 SELECT * INTO old_request FROM ops.channel_practice_requests WHERE identity_id=ident AND request_id=input_request;
 IF old_request.identity_id IS NOT NULL THEN IF old_request.payload_hash<>fingerprint THEN RAISE EXCEPTION 'workspace request conflict' USING ERRCODE='40001';END IF;RETURN old_request.result||CASE WHEN input_platform='whatsapp' THEN jsonb_build_object('receiptQueued',FALSE) ELSE '{}'::jsonb END;END IF;
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
 guidance:=core.lookup_practice_guidance(input_date);
 SELECT revision INTO actual_version FROM platform.telegram_practice_versions WHERE checkin_id=practice;
 result:=jsonb_build_object('checkinId',practice,'version',actual_version,'action',action,'receiptQueued',coalesce((SELECT status='pending' FROM ops.channel_practice_receipts WHERE id=receipt),FALSE));
 IF guidance IS NOT NULL THEN
   result:=result||jsonb_build_object('guidance',guidance);
 END IF;
 INSERT INTO ops.channel_practice_requests(identity_id,request_id,payload_hash,result) VALUES(ident,input_request,fingerprint,result);RETURN result;
END$$;

CREATE OR REPLACE FUNCTION admin.manage_guidance_campaign(
  input_action TEXT,
  input_session TEXT,
  input_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v_principal UUID;
  v_is_authorized BOOLEAN;
  v_id UUID;
  v_title TEXT;
  v_start DATE;
  v_end DATE;
  v_active BOOLEAN;
  v_entries JSONB;
  v_entry RECORD;
  result JSONB;
BEGIN
  -- Authenticate admin session
  SELECT admin.session_principal(input_session) INTO v_principal;
  IF v_principal IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE='28000';
  END IF;

  -- Authorize: super_admin or master_admin only
  SELECT EXISTS (
    SELECT 1 FROM admin.role_grants g
    JOIN admin.roles r ON r.id = g.role_id
    WHERE g.principal_id = v_principal
      AND r.code IN ('super_admin', 'master_admin')
      AND g.valid_from <= clock_timestamp()
      AND (g.valid_to IS NULL OR g.valid_to > clock_timestamp())
  ) INTO v_is_authorized;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE='42501';
  END IF;

  CASE input_action
    WHEN 'list' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id,
        'title', c.title,
        'startDate', c.start_date::text,
        'endDate', c.end_date::text,
        'timezone', c.timezone,
        'isActive', c.is_active,
        'entryCount', (SELECT count(*)::integer FROM core.practice_guidance_entries e WHERE e.campaign_id = c.id),
        'totalDays', (c.end_date - c.start_date + 1)::integer,
        'createdAt', c.created_at
      ) ORDER BY c.start_date DESC, c.created_at DESC), '[]'::jsonb) INTO result
      FROM core.practice_guidance_campaigns c;
      RETURN result;

    WHEN 'get' THEN
      v_id := (input_payload->>'id')::uuid;
      SELECT jsonb_build_object(
        'id', c.id,
        'title', c.title,
        'startDate', c.start_date::text,
        'endDate', c.end_date::text,
        'timezone', c.timezone,
        'isActive', c.is_active,
        'entries', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', e.id,
            'guideDate', e.guide_date::text,
            'title', e.title,
            'content', e.content
          ) ORDER BY e.guide_date)
          FROM core.practice_guidance_entries e
          WHERE e.campaign_id = c.id
        ), '[]'::jsonb)
      ) INTO result
      FROM core.practice_guidance_campaigns c
      WHERE c.id = v_id;

      IF result IS NULL THEN
        RAISE EXCEPTION 'campaign_not_found' USING ERRCODE='P0002';
      END IF;
      RETURN result;

    WHEN 'create' THEN
      v_title := trim(input_payload->>'title');
      v_start := (input_payload->>'startDate')::date;
      v_end := (input_payload->>'endDate')::date;
      v_active := coalesce((input_payload->>'isActive')::boolean, true);

      IF v_title IS NULL OR char_length(v_title) = 0 OR v_start IS NULL OR v_end IS NULL OR v_end < v_start THEN
        RAISE EXCEPTION 'invalid_campaign_params' USING ERRCODE='22023';
      END IF;

      INSERT INTO core.practice_guidance_campaigns (title, start_date, end_date, is_active, created_by)
      VALUES (v_title, v_start, v_end, v_active, v_principal)
      RETURNING id INTO v_id;

      RETURN jsonb_build_object('ok', true, 'id', v_id);

    WHEN 'update' THEN
      v_id := (input_payload->>'id')::uuid;
      v_title := trim(input_payload->>'title');
      v_start := (input_payload->>'startDate')::date;
      v_end := (input_payload->>'endDate')::date;
      v_active := (input_payload->>'isActive')::boolean;

      UPDATE core.practice_guidance_campaigns
      SET title = coalesce(v_title, title),
          start_date = coalesce(v_start, start_date),
          end_date = coalesce(v_end, end_date),
          is_active = coalesce(v_active, is_active),
          updated_at = clock_timestamp()
      WHERE id = v_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'campaign_not_found' USING ERRCODE='P0002';
      END IF;
      RETURN jsonb_build_object('ok', true, 'id', v_id);

    WHEN 'upsert_entries' THEN
      v_id := (input_payload->>'campaignId')::uuid;
      v_entries := input_payload->'entries';

      IF NOT EXISTS (SELECT 1 FROM core.practice_guidance_campaigns WHERE id = v_id) THEN
        RAISE EXCEPTION 'campaign_not_found' USING ERRCODE='P0002';
      END IF;

      FOR v_entry IN SELECT * FROM jsonb_to_recordset(v_entries) AS x(guide_date date, title text, content text) LOOP
        IF v_entry.content IS NOT NULL AND char_length(trim(v_entry.content)) > 0 THEN
          INSERT INTO core.practice_guidance_entries (campaign_id, guide_date, title, content, updated_at)
          VALUES (v_id, v_entry.guide_date, nullif(trim(v_entry.title), ''), trim(v_entry.content), clock_timestamp())
          ON CONFLICT (campaign_id, guide_date) DO UPDATE SET
            title = EXCLUDED.title,
            content = EXCLUDED.content,
            updated_at = clock_timestamp();
        ELSE
          -- Content is empty: remove entry if exists
          DELETE FROM core.practice_guidance_entries
          WHERE campaign_id = v_id AND guide_date = v_entry.guide_date;
        END IF;
      END LOOP;

      RETURN jsonb_build_object('ok', true, 'campaignId', v_id);

    WHEN 'delete' THEN
      v_id := (input_payload->>'id')::uuid;
      DELETE FROM core.practice_guidance_campaigns WHERE id = v_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'campaign_not_found' USING ERRCODE='P0002';
      END IF;
      RETURN jsonb_build_object('ok', true, 'id', v_id);

    ELSE
      RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023';
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION admin.manage_guidance_campaign(TEXT, TEXT, JSONB) FROM PUBLIC, qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.manage_guidance_campaign(TEXT, TEXT, JSONB) TO qigong_api_runtime;
