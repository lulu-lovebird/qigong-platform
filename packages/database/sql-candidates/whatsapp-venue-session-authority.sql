-- Candidate DDL, NOT part of the deployment migration chain.
-- Read-only status only: never authority for a later attendance write transaction.
-- Apply transactionally ONLY in an isolated test database pending final integration review.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
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
