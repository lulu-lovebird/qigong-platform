-- Additive WhatsApp Session-only venue authority; does not enable HTTP routes or provider messages.
-- Promotion of isolated PostgreSQL-tested candidates. Existing LINE/debug authority is unchanged.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
-- Reviewed source: whatsapp-venue-session-authority.sql
SET LOCAL search_path = pg_catalog;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qigong_whatsapp_venue_session_reader') THEN
    RAISE EXCEPTION 'WhatsApp venue session role must be new and isolated';
  END IF;
  CREATE ROLE qigong_whatsapp_venue_session_reader
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
END $$;

GRANT USAGE ON SCHEMA platform, identity, admin TO qigong_whatsapp_venue_session_reader;
GRANT SELECT(token_hash,csrf_hash,identity_id,person_id,expires_at,revoked_at)
  ON platform.whatsapp_browser_sessions TO qigong_whatsapp_venue_session_reader;
GRANT SELECT(id,person_id,platform,external_subject_id,verified_at,revoked_at)
  ON identity.platform_identities TO qigong_whatsapp_venue_session_reader;
GRANT SELECT(id,status) ON identity.people TO qigong_whatsapp_venue_session_reader;
GRANT SELECT(person_id,platform_identity_id,valid_from,valid_to)
  ON identity.person_interaction_channels TO qigong_whatsapp_venue_session_reader;
GRANT SELECT(person_id,platform,external_subject_id,status)
  ON identity.onboarding_applications TO qigong_whatsapp_venue_session_reader;
GRANT EXECUTE ON FUNCTION admin.request_id(),admin.request_person_id(),admin.request_principal_id(),
  platform.privacy_usage(TEXT,TEXT) TO qigong_whatsapp_venue_session_reader;

-- Both hashes must match a live, persisted Session; a person GUC is never authority.
-- The only owner entry point always overwrites these hashes from its validated arguments.
-- Runtime has neither role membership nor direct table privileges through this role.
CREATE POLICY wa_venue_session_reader ON platform.whatsapp_browser_sessions
  FOR SELECT TO qigong_whatsapp_venue_session_reader
  USING(token_hash=decode(nullif(current_setting('qigong.wa_venue_session_hash',TRUE),''),'hex')
    AND csrf_hash=decode(nullif(current_setting('qigong.wa_venue_csrf_hash',TRUE),''),'hex')
    AND revoked_at IS NULL AND expires_at>clock_timestamp());
CREATE POLICY wa_venue_identity_reader ON identity.platform_identities
  FOR SELECT TO qigong_whatsapp_venue_session_reader
  USING(platform='whatsapp' AND EXISTS(
    SELECT 1 FROM platform.whatsapp_browser_sessions s
    WHERE s.identity_id=platform_identities.id AND s.person_id=platform_identities.person_id));
CREATE POLICY wa_venue_person_reader ON identity.people
  FOR SELECT TO qigong_whatsapp_venue_session_reader
  USING(EXISTS(SELECT 1 FROM platform.whatsapp_browser_sessions s WHERE s.person_id=people.id));
CREATE POLICY wa_venue_channel_reader ON identity.person_interaction_channels
  FOR SELECT TO qigong_whatsapp_venue_session_reader
  USING(EXISTS(SELECT 1 FROM platform.whatsapp_browser_sessions s
    WHERE s.person_id=person_interaction_channels.person_id
      AND s.identity_id=person_interaction_channels.platform_identity_id));
CREATE POLICY wa_venue_application_reader ON identity.onboarding_applications
  FOR SELECT TO qigong_whatsapp_venue_session_reader
  USING(platform='whatsapp' AND EXISTS(
    SELECT 1 FROM identity.platform_identities i
    WHERE i.person_id=onboarding_applications.person_id
      AND i.external_subject_id=onboarding_applications.external_subject_id));

CREATE FUNCTION platform.whatsapp_venue_session_status(input_session TEXT,input_csrf TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $$
DECLARE privacy JSONB; valid BOOLEAN;
BEGIN
  IF admin.request_id() IS NULL OR admin.request_person_id() IS NOT NULL
    OR admin.request_principal_id() IS NOT NULL
    OR input_session IS NULL OR length(input_session)<>43 OR input_session !~ '^[A-Za-z0-9_-]{43}$'
    OR input_csrf IS NULL OR length(input_csrf)<>43 OR input_csrf !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'WhatsApp venue session unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('qigong.wa_venue_session_hash',encode(public.digest(input_session,'sha256'),'hex'),TRUE);
  PERFORM set_config('qigong.wa_venue_csrf_hash',encode(public.digest(input_csrf,'sha256'),'hex'),TRUE);
  SELECT EXISTS(
    SELECT 1 FROM platform.whatsapp_browser_sessions s
    JOIN identity.platform_identities i ON i.id=s.identity_id AND i.person_id=s.person_id
    JOIN identity.people p ON p.id=s.person_id
    JOIN identity.person_interaction_channels c ON c.person_id=p.id AND c.platform_identity_id=i.id
    JOIN identity.onboarding_applications a ON a.person_id=p.id AND a.platform='whatsapp'
      AND a.external_subject_id=i.external_subject_id AND a.status='approved'
    WHERE i.platform='whatsapp' AND i.revoked_at IS NULL AND i.verified_at<=clock_timestamp()
      AND p.status='active' AND c.valid_from<=clock_timestamp() AND c.valid_to IS NULL
  ) INTO valid;
  IF NOT valid THEN
    RAISE EXCEPTION 'WhatsApp venue session unavailable' USING ERRCODE='42501';
  END IF;
  -- Existing narrow privacy helper may wait. Recheck current Session/eligibility afterwards.
  -- Its private-link fallback cannot authorize this facade: the Session-only RLS above
  -- has already required a real Session and both hashes, and is rechecked below.
  privacy:=platform.privacy_usage('whatsapp',input_session);
  IF coalesce((privacy->>'required')::boolean,FALSE)
    OR coalesce((privacy->>'unavailable')::boolean,FALSE) THEN
    RAISE EXCEPTION 'WhatsApp venue consent unavailable' USING ERRCODE='42501';
  END IF;
  SELECT EXISTS(
    SELECT 1 FROM platform.whatsapp_browser_sessions s
    JOIN identity.platform_identities i ON i.id=s.identity_id AND i.person_id=s.person_id
    JOIN identity.people p ON p.id=s.person_id
    JOIN identity.person_interaction_channels c ON c.person_id=p.id AND c.platform_identity_id=i.id
    JOIN identity.onboarding_applications a ON a.person_id=p.id AND a.platform='whatsapp'
      AND a.external_subject_id=i.external_subject_id AND a.status='approved'
    WHERE i.platform='whatsapp' AND i.revoked_at IS NULL AND i.verified_at<=clock_timestamp()
      AND p.status='active' AND c.valid_from<=clock_timestamp() AND c.valid_to IS NULL
  ) INTO valid;
  IF NOT valid THEN
    RAISE EXCEPTION 'WhatsApp venue session unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('qigong.wa_venue_session_hash','',TRUE);
  PERFORM set_config('qigong.wa_venue_csrf_hash','',TRUE);
  RETURN jsonb_build_object('version',1,'status','approved','privacy','clear');
END $$;
ALTER FUNCTION platform.whatsapp_venue_session_status(TEXT,TEXT)
  OWNER TO qigong_whatsapp_venue_session_reader;

REVOKE ALL ON FUNCTION platform.whatsapp_venue_session_status(TEXT,TEXT) FROM PUBLIC;
DO $$
DECLARE grantee_name TEXT;
BEGIN
  FOR grantee_name IN
    SELECT r.rolname FROM pg_proc p,aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE p.oid='platform.whatsapp_venue_session_status(text,text)'::regprocedure
      AND a.grantee<>p.proowner
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION platform.whatsapp_venue_session_status(TEXT,TEXT) FROM %I',grantee_name);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION platform.whatsapp_venue_session_status(TEXT,TEXT) TO qigong_api_runtime;


-- Reviewed source: whatsapp-venue-checkin-writer.sql
SET LOCAL search_path=pg_catalog;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qigong_whatsapp_venue_writer') THEN
    RAISE EXCEPTION 'WhatsApp venue writer must be new and isolated';
  END IF;
  IF to_regprocedure('platform.whatsapp_venue_session_status(text,text)') IS NULL THEN
    RAISE EXCEPTION 'WhatsApp venue session candidate required';
  END IF;
  CREATE ROLE qigong_whatsapp_venue_writer
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
END $$;
GRANT USAGE ON SCHEMA platform,identity,core,admin,audit TO qigong_whatsapp_venue_writer;
GRANT SELECT(token_hash,csrf_hash,identity_id,person_id,expires_at,revoked_at)
  ON platform.whatsapp_browser_sessions TO qigong_whatsapp_venue_writer;
GRANT SELECT(id,person_id,platform,external_subject_id,verified_at,revoked_at)
  ON identity.platform_identities TO qigong_whatsapp_venue_writer;
GRANT SELECT(id,status) ON identity.people TO qigong_whatsapp_venue_writer;
GRANT SELECT(person_id,platform_identity_id,valid_from,valid_to)
  ON identity.person_interaction_channels TO qigong_whatsapp_venue_writer;
GRANT SELECT(person_id,platform,external_subject_id,status)
  ON identity.onboarding_applications TO qigong_whatsapp_venue_writer;
-- PostgreSQL row locks require UPDATE on at least one column. These grants allow
-- FOR SHARE/FOR UPDATE; dedicated RESTRICTIVE WITH CHECK(FALSE) policies below
-- prohibit actual updates, even if a future permissive policy also applies.
GRANT UPDATE(id) ON platform.whatsapp_browser_sessions,identity.platform_identities,
  identity.people,identity.person_interaction_channels,identity.onboarding_applications
  TO qigong_whatsapp_venue_writer;
GRANT SELECT(id,platform,subject_hash,policy_version,document_hash,revoked_at),UPDATE(id)
  ON platform.learner_privacy_acceptances TO qigong_whatsapp_venue_writer;
GRANT SELECT(id,code,name_zh_tw,latitude,longitude,radius_meters,active_time_rules,timezone,is_active)
  ON core.practice_fields TO qigong_whatsapp_venue_writer;
GRANT SELECT(id,person_id,field_id,checkin_at,attendance_date,attendance_timezone,is_test)
  ON core.field_attendance TO qigong_whatsapp_venue_writer;
GRANT INSERT(person_id,field_id,checkin_method,distance_meters,checkin_at,attendance_date,attendance_timezone)
  ON core.field_attendance TO qigong_whatsapp_venue_writer;
GRANT INSERT(request_id,actor_person_id,action,target_type,target_id,outcome,metadata)
  ON audit.events TO qigong_whatsapp_venue_writer;
GRANT EXECUTE ON FUNCTION admin.request_id(),admin.request_person_id(),admin.request_principal_id(),
  platform.privacy_status(TEXT,TEXT),platform.venue_checkin_window(JSONB,TEXT,TIMESTAMPTZ)
  TO qigong_whatsapp_venue_writer;

ALTER POLICY wa_venue_session_reader ON platform.whatsapp_browser_sessions
  TO qigong_whatsapp_venue_session_reader,qigong_whatsapp_venue_writer;
ALTER POLICY wa_venue_identity_reader ON identity.platform_identities
  TO qigong_whatsapp_venue_session_reader,qigong_whatsapp_venue_writer;
ALTER POLICY wa_venue_person_reader ON identity.people
  TO qigong_whatsapp_venue_session_reader,qigong_whatsapp_venue_writer;
ALTER POLICY wa_venue_channel_reader ON identity.person_interaction_channels
  TO qigong_whatsapp_venue_session_reader,qigong_whatsapp_venue_writer;
ALTER POLICY wa_venue_application_reader ON identity.onboarding_applications
  TO qigong_whatsapp_venue_session_reader,qigong_whatsapp_venue_writer;

CREATE POLICY wa_venue_session_lock ON platform.whatsapp_browser_sessions
  FOR UPDATE TO qigong_whatsapp_venue_writer USING(
    token_hash=decode(nullif(current_setting('qigong.wa_venue_session_hash',TRUE),''),'hex')
    AND csrf_hash=decode(nullif(current_setting('qigong.wa_venue_csrf_hash',TRUE),''),'hex')
    AND revoked_at IS NULL AND expires_at>clock_timestamp()) WITH CHECK(FALSE);
CREATE POLICY wa_venue_identity_lock ON identity.platform_identities
  FOR UPDATE TO qigong_whatsapp_venue_writer USING(platform='whatsapp' AND EXISTS(
    SELECT 1 FROM platform.whatsapp_browser_sessions s
    WHERE s.identity_id=platform_identities.id AND s.person_id=platform_identities.person_id)) WITH CHECK(FALSE);
CREATE POLICY wa_venue_person_lock ON identity.people
  FOR UPDATE TO qigong_whatsapp_venue_writer USING(EXISTS(
    SELECT 1 FROM platform.whatsapp_browser_sessions s WHERE s.person_id=people.id)) WITH CHECK(FALSE);
CREATE POLICY wa_venue_channel_lock ON identity.person_interaction_channels
  FOR UPDATE TO qigong_whatsapp_venue_writer USING(EXISTS(
    SELECT 1 FROM platform.whatsapp_browser_sessions s
    WHERE s.person_id=person_interaction_channels.person_id AND s.identity_id=person_interaction_channels.platform_identity_id)) WITH CHECK(FALSE);
CREATE POLICY wa_venue_application_lock ON identity.onboarding_applications
  FOR UPDATE TO qigong_whatsapp_venue_writer USING(platform='whatsapp' AND EXISTS(
    SELECT 1 FROM identity.platform_identities i WHERE i.person_id=onboarding_applications.person_id
      AND i.external_subject_id=onboarding_applications.external_subject_id)) WITH CHECK(FALSE);
CREATE POLICY wa_venue_acceptance_read ON platform.learner_privacy_acceptances
  FOR SELECT TO qigong_whatsapp_venue_writer USING(platform='whatsapp' AND EXISTS(
    SELECT 1 FROM identity.platform_identities i
    WHERE subject_hash=public.digest('whatsapp:'||i.external_subject_id,'sha256')));
CREATE POLICY wa_venue_acceptance_lock ON platform.learner_privacy_acceptances
  FOR UPDATE TO qigong_whatsapp_venue_writer USING(platform='whatsapp' AND EXISTS(
    SELECT 1 FROM identity.platform_identities i
    WHERE subject_hash=public.digest('whatsapp:'||i.external_subject_id,'sha256'))) WITH CHECK(FALSE);
DO $$ DECLARE target TEXT; BEGIN
  FOREACH target IN ARRAY ARRAY['platform.whatsapp_browser_sessions','identity.platform_identities',
    'identity.people','identity.person_interaction_channels','identity.onboarding_applications',
    'platform.learner_privacy_acceptances'] LOOP
    EXECUTE format('CREATE POLICY wa_venue_never_update ON %s AS RESTRICTIVE FOR UPDATE TO qigong_whatsapp_venue_writer USING(TRUE) WITH CHECK(FALSE)',target);
  END LOOP;
END $$;
CREATE POLICY wa_venue_writer_fields ON core.practice_fields
  FOR SELECT TO qigong_whatsapp_venue_writer USING(is_active);
CREATE POLICY wa_venue_writer_replay ON core.field_attendance
  FOR SELECT TO qigong_whatsapp_venue_writer USING(NOT is_test AND EXISTS(
    SELECT 1 FROM platform.whatsapp_browser_sessions s WHERE s.person_id=field_attendance.person_id));
CREATE POLICY wa_venue_writer_insert ON core.field_attendance
  FOR INSERT TO qigong_whatsapp_venue_writer WITH CHECK(
    admin.request_id() IS NOT NULL AND admin.request_person_id() IS NULL AND admin.request_principal_id() IS NULL
    AND NOT is_test AND verification_mode='standard' AND checkin_method='qr_gps'
    AND checkin_id IS NULL AND volunteer_person_id IS NULL AND user_latitude IS NULL AND user_longitude IS NULL AND student_note IS NULL
    AND EXISTS(SELECT 1 FROM platform.whatsapp_browser_sessions s WHERE s.person_id=field_attendance.person_id)
    AND EXISTS(SELECT 1 FROM core.practice_fields f WHERE f.id=field_id AND f.is_active
      AND attendance_timezone=f.timezone AND attendance_date=(checkin_at AT TIME ZONE f.timezone)::date));
CREATE POLICY wa_venue_writer_audit ON audit.events
  FOR INSERT TO qigong_whatsapp_venue_writer WITH CHECK(
    request_id=admin.request_id() AND action='venue.whatsapp_checkin' AND outcome='success'
    AND EXISTS(SELECT 1 FROM platform.whatsapp_browser_sessions s WHERE s.person_id=actor_person_id));

CREATE FUNCTION platform.whatsapp_venue_checkin(input_session TEXT,input_csrf TEXT,input_code TEXT,
  input_lat DOUBLE PRECISION,input_lon DOUBLE PRECISION)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $$
DECLARE person UUID; ident UUID; subject TEXT; privacy JSONB; venue RECORD; saved RECORD;
  at_time TIMESTAMPTZ; metres DOUBLE PRECISION; replayed BOOLEAN:=FALSE; eligible BOOLEAN;
BEGIN
  IF admin.request_id() IS NULL OR admin.request_person_id() IS NOT NULL OR admin.request_principal_id() IS NOT NULL
    OR input_session IS NULL OR length(input_session)<>43 OR input_session !~ '^[A-Za-z0-9_-]{43}$'
    OR input_csrf IS NULL OR length(input_csrf)<>43 OR input_csrf !~ '^[A-Za-z0-9_-]{43}$'
    OR input_code IS NULL OR length(input_code)>64 OR input_code !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)+$'
    OR input_code ~ '[[:cntrl:]]' OR input_code='tw-location-test'
    OR input_lat IS NULL OR input_lon IS NULL OR input_lat NOT BETWEEN -90 AND 90 OR input_lon NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'WhatsApp venue request denied' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('qigong.wa_venue_session_hash',encode(public.digest(input_session,'sha256'),'hex'),TRUE);
  PERFORM set_config('qigong.wa_venue_csrf_hash',encode(public.digest(input_csrf,'sha256'),'hex'),TRUE);
  SELECT s.person_id,s.identity_id,i.external_subject_id INTO person,ident,subject
    FROM platform.whatsapp_browser_sessions s JOIN identity.platform_identities i ON i.id=s.identity_id AND i.person_id=s.person_id;
  IF person IS NULL THEN RAISE EXCEPTION 'WhatsApp venue session unavailable' USING ERRCODE='42501'; END IF;
  -- Reject unknown credentials before contending on the policy/admin lock.
  -- This precheck is NOT authorization: all locks and fresh checks below remain mandatory.
  -- Existing policy publication/admin suspension uses this global transaction lock.
  -- Hold only for local DB work, never across GPS, network or provider calls.
  PERFORM pg_advisory_xact_lock(1919,1);
  -- Follow the canonical channel-close -> Session revoke -> identity change order.
  -- Person lock is last, matching the venue badge trigger's subsequent person lock.
  PERFORM 1 FROM identity.person_interaction_channels c WHERE c.person_id=person AND c.platform_identity_id=ident
    AND c.valid_from<=clock_timestamp() AND c.valid_to IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WhatsApp venue identity unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM platform.whatsapp_browser_sessions FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WhatsApp venue session unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM identity.platform_identities WHERE id=ident AND platform='whatsapp'
    AND revoked_at IS NULL AND verified_at<=clock_timestamp() FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WhatsApp venue identity unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM identity.onboarding_applications WHERE person_id=person AND platform='whatsapp'
    AND external_subject_id=subject AND status='approved' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WhatsApp venue identity unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM identity.people WHERE id=person AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WhatsApp venue identity unavailable' USING ERRCODE='42501'; END IF;
  -- Do not acquire privacy-subject locks here: existing login/logout may hold those
  -- before their row locks. Use pure status + acceptance row lock under policy lock.
  privacy:=platform.privacy_status('whatsapp',subject);
  IF coalesce((privacy->>'required')::boolean,FALSE) OR coalesce((privacy->>'unavailable')::boolean,FALSE) THEN
    RAISE EXCEPTION 'WhatsApp venue consent unavailable' USING ERRCODE='42501';
  END IF;
  IF coalesce((privacy->>'active')::boolean,FALSE) THEN
    PERFORM 1 FROM platform.learner_privacy_acceptances WHERE platform='whatsapp'
      AND subject_hash=public.digest('whatsapp:'||subject,'sha256')
      AND policy_version=privacy->>'version' AND document_hash=privacy->>'hash' AND revoked_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'WhatsApp venue consent unavailable' USING ERRCODE='42501'; END IF;
  END IF;
  -- Refresh clock and eligibility AFTER all waits; never authorize by a prior HTTP status.
  SELECT EXISTS(SELECT 1 FROM platform.whatsapp_browser_sessions s
    JOIN identity.platform_identities i ON i.id=s.identity_id AND i.person_id=s.person_id
    JOIN identity.people p ON p.id=s.person_id
    JOIN identity.person_interaction_channels c ON c.person_id=p.id AND c.platform_identity_id=i.id
    JOIN identity.onboarding_applications a ON a.person_id=p.id AND a.platform='whatsapp' AND a.external_subject_id=i.external_subject_id
    WHERE p.id=person AND p.status='active' AND i.platform='whatsapp' AND i.revoked_at IS NULL AND i.verified_at<=clock_timestamp()
      AND c.valid_from<=clock_timestamp() AND c.valid_to IS NULL AND a.status='approved') INTO eligible;
  IF NOT eligible THEN RAISE EXCEPTION 'WhatsApp venue session unavailable' USING ERRCODE='42501'; END IF;
  SELECT id,code,name_zh_tw,latitude,longitude,radius_meters,active_time_rules,timezone INTO venue
    FROM core.practice_fields WHERE code=input_code AND is_active;
  IF venue.id IS NULL THEN RAISE EXCEPTION 'venue_unavailable' USING ERRCODE='42501'; END IF;
  at_time:=clock_timestamp();
  IF platform.venue_checkin_window(venue.active_time_rules,venue.timezone,at_time) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'venue_outside_window' USING ERRCODE='P0001';
  END IF;
  metres:=6371000*2*asin(sqrt(LEAST(1.0,
    power(sin(radians(input_lat-venue.latitude::float8)/2),2)
    +cos(radians(venue.latitude::float8))*cos(radians(input_lat))*power(sin(radians(input_lon-venue.longitude::float8)/2),2))));
  IF metres>venue.radius_meters THEN RAISE EXCEPTION 'venue_outside_radius' USING ERRCODE='P0001'; END IF;
  INSERT INTO core.field_attendance(person_id,field_id,checkin_method,distance_meters,checkin_at,attendance_date,attendance_timezone)
    VALUES(person,venue.id,'qr_gps',metres,at_time,(at_time AT TIME ZONE venue.timezone)::date,venue.timezone)
    ON CONFLICT(person_id,field_id,attendance_date,is_test) DO NOTHING
    RETURNING id,checkin_at,attendance_date,attendance_timezone INTO saved;
  IF saved.id IS NULL THEN
    replayed:=TRUE;
    SELECT id,checkin_at,attendance_date,attendance_timezone INTO STRICT saved FROM core.field_attendance
      WHERE person_id=person AND field_id=venue.id AND attendance_date=(at_time AT TIME ZONE venue.timezone)::date AND NOT is_test;
  END IF;
  INSERT INTO audit.events(request_id,actor_person_id,action,target_type,target_id,outcome,metadata)
    VALUES(admin.request_id(),person,'venue.whatsapp_checkin','field_attendance',saved.id::text,'success',jsonb_build_object('replayed',replayed));
  PERFORM set_config('qigong.wa_venue_session_hash','',TRUE);
  PERFORM set_config('qigong.wa_venue_csrf_hash','',TRUE);
  RETURN jsonb_build_object('ok',TRUE,'venue',jsonb_build_object('code',venue.code,'name',venue.name_zh_tw,'timezone',saved.attendance_timezone),
    'checkedInAt',saved.checkin_at,'attendanceDate',saved.attendance_date,'replayed',replayed);
END $$;
ALTER FUNCTION platform.whatsapp_venue_checkin(TEXT,TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION)
  OWNER TO qigong_whatsapp_venue_writer;
REVOKE ALL ON FUNCTION platform.whatsapp_venue_checkin(TEXT,TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION) FROM PUBLIC;
DO $$ DECLARE grantee_name TEXT; BEGIN
  FOR grantee_name IN SELECT r.rolname FROM pg_proc p,aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE p.oid='platform.whatsapp_venue_checkin(text,text,text,double precision,double precision)'::regprocedure AND a.grantee<>p.proowner LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION platform.whatsapp_venue_checkin(TEXT,TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION) FROM %I',grantee_name);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION platform.whatsapp_venue_checkin(TEXT,TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION) TO qigong_api_runtime;

-- Own formal history. This migration is unpublished; no existing deployed SQL is edited.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qigong_whatsapp_venue_history_reader') THEN
    RAISE EXCEPTION 'WhatsApp venue history role must be new and isolated';
  END IF;
  CREATE ROLE qigong_whatsapp_venue_history_reader
    NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
END $$;
GRANT USAGE ON SCHEMA platform,core TO qigong_whatsapp_venue_history_reader;
GRANT SELECT(token_hash,csrf_hash,person_id,expires_at,revoked_at)
  ON platform.whatsapp_browser_sessions TO qigong_whatsapp_venue_history_reader;
GRANT SELECT(id,person_id,field_id,checkin_at,attendance_date,attendance_timezone,is_test)
  ON core.field_attendance TO qigong_whatsapp_venue_history_reader;
GRANT SELECT(id,code,name_zh_tw) ON core.practice_fields TO qigong_whatsapp_venue_history_reader;
GRANT EXECUTE ON FUNCTION platform.whatsapp_venue_session_status(TEXT,TEXT)
  TO qigong_whatsapp_venue_history_reader;
CREATE POLICY wa_venue_history_session ON platform.whatsapp_browser_sessions
  FOR SELECT TO qigong_whatsapp_venue_history_reader USING(
    token_hash=decode(nullif(current_setting('qigong.wa_venue_session_hash',TRUE),''),'hex')
    AND csrf_hash=decode(nullif(current_setting('qigong.wa_venue_csrf_hash',TRUE),''),'hex')
    AND revoked_at IS NULL AND expires_at>clock_timestamp());
CREATE POLICY wa_venue_history_own ON core.field_attendance
  FOR SELECT TO qigong_whatsapp_venue_history_reader USING(NOT is_test AND EXISTS(
    SELECT 1 FROM platform.whatsapp_browser_sessions s WHERE s.person_id=field_attendance.person_id));
CREATE POLICY wa_venue_history_fields ON core.practice_fields
  FOR SELECT TO qigong_whatsapp_venue_history_reader USING(EXISTS(
    SELECT 1 FROM core.field_attendance a WHERE a.field_id=practice_fields.id));

CREATE FUNCTION platform.whatsapp_venue_history(input_session TEXT,input_csrf TEXT,
  input_month TEXT,input_venue TEXT,input_page INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $$
DECLARE target UUID; month_start DATE; result JSONB;
BEGIN
  IF input_page IS NULL OR input_page NOT BETWEEN 1 AND 10000
    OR (input_month IS NOT NULL AND (length(input_month)<>7
      OR input_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR left(input_month,4)='0000'))
    OR (input_venue IS NOT NULL AND (length(input_venue)>64
      OR input_venue !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)+$' OR input_venue ~ '[[:cntrl:]]')) THEN
    RAISE EXCEPTION 'invalid WhatsApp venue history filter' USING ERRCODE='22023';
  END IF;
  -- Reuse the dedicated Session-only authority; never the daily link resolver.
  PERFORM platform.whatsapp_venue_session_status(input_session,input_csrf);
  PERFORM set_config('qigong.wa_venue_session_hash',encode(public.digest(input_session,'sha256'),'hex'),TRUE);
  PERFORM set_config('qigong.wa_venue_csrf_hash',encode(public.digest(input_csrf,'sha256'),'hex'),TRUE);
  SELECT person_id INTO target FROM platform.whatsapp_browser_sessions;
  IF target IS NULL THEN RAISE EXCEPTION 'WhatsApp venue session unavailable' USING ERRCODE='42501'; END IF;
  month_start:=CASE WHEN input_month IS NULL THEN NULL ELSE (input_month||'-01')::date END;
  WITH visible AS (
    SELECT a.id,a.checkin_at,a.attendance_date,a.attendance_timezone,f.code,f.name_zh_tw
    FROM core.field_attendance a JOIN core.practice_fields f ON f.id=a.field_id
    WHERE a.person_id=target AND NOT a.is_test AND (input_venue IS NULL OR f.code=input_venue)
  ), filtered AS (
    SELECT * FROM visible WHERE month_start IS NULL
      OR (attendance_date>=month_start AND attendance_date<month_start+INTERVAL '1 month')
  ), entries AS (
    SELECT * FROM filtered ORDER BY checkin_at DESC,id DESC LIMIT 20 OFFSET (input_page-1)*20
  )
  SELECT jsonb_build_object('ok',TRUE,'dateBasis','venue_local_date',
    'totals',jsonb_build_object('attendanceCount',(SELECT count(*) FROM visible),
      'attendanceDays',(SELECT count(DISTINCT attendance_date) FROM visible),
      'monthCount',(SELECT count(*) FROM visible WHERE
        (month_start IS NOT NULL AND attendance_date>=month_start AND attendance_date<month_start+INTERVAL '1 month')
        OR (month_start IS NULL AND to_char(attendance_date,'YYYY-MM')=to_char(clock_timestamp() AT TIME ZONE attendance_timezone,'YYYY-MM')))),
    'page',input_page,'pageSize',20,'hasMore',(SELECT count(*) FROM filtered)>input_page*20,
    'entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',id,'venueCode',code,'venueName',name_zh_tw,'checkedInAt',checkin_at,
      'venueLocalDate',attendance_date,'venueTimezone',attendance_timezone)
      ORDER BY checkin_at DESC,id DESC) FROM entries),'[]'::jsonb)) INTO result;
  -- Recheck eligibility/consent before releasing a response and clear both hashes.
  -- This is read-only snapshot authorization, not an attendance-write lock protocol.
  PERFORM platform.whatsapp_venue_session_status(input_session,input_csrf);
  RETURN result;
END $$;
ALTER FUNCTION platform.whatsapp_venue_history(TEXT,TEXT,TEXT,TEXT,INTEGER)
  OWNER TO qigong_whatsapp_venue_history_reader;
REVOKE ALL ON FUNCTION platform.whatsapp_venue_history(TEXT,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC;
DO $$ DECLARE grantee_name TEXT; BEGIN
  FOR grantee_name IN SELECT r.rolname FROM pg_proc p,aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE p.oid='platform.whatsapp_venue_history(text,text,text,text,integer)'::regprocedure AND a.grantee<>p.proowner LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION platform.whatsapp_venue_history(TEXT,TEXT,TEXT,TEXT,INTEGER) FROM %I',grantee_name);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION platform.whatsapp_venue_history(TEXT,TEXT,TEXT,TEXT,INTEGER) TO qigong_api_runtime;
