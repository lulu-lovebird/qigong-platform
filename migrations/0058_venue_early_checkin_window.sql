-- Thirty-minute early check-in; practice schedules and attendance dates stay unchanged.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
SET LOCAL search_path=pg_catalog;

-- Fail closed: schema57 credentials are revoked, never migrated or auto-enabled.
DELETE FROM platform.venue_debug_config;

-- Pure input-only calculation. PostgreSQL's AT TIME ZONE resolves DST gaps/folds.
CREATE FUNCTION platform.venue_checkin_window(rules JSONB, zone TEXT, at_time TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog AS $$
DECLARE today DATE; session_day DATE; session_start TIMESTAMPTZ; session_end TIMESTAMPTZ;
  start_text TEXT; end_text TEXT; days JSONB; offset_day INTEGER;
BEGIN
  IF rules IS NULL OR zone IS NULL OR at_time IS NULL OR NOT isfinite(at_time)
    OR jsonb_typeof(rules) IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
  start_text := rules->>'start_time'; end_text := rules->>'end_time'; days := rules->'day_of_week';
  IF start_text IS NULL OR end_text IS NULL
    OR start_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR end_text !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
    OR start_text >= end_text OR jsonb_typeof(days) IS DISTINCT FROM 'array'
    OR jsonb_array_length(days) NOT BETWEEN 1 AND 7 THEN RETURN FALSE; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(days) d
    WHERE jsonb_typeof(d) IS DISTINCT FROM 'number' OR d::text !~ '^[0-6]$')
    OR (SELECT count(DISTINCT d) FROM jsonb_array_elements(days) d) <> jsonb_array_length(days)
    THEN RETURN FALSE; END IF;
  today := (at_time AT TIME ZONE zone)::date;
  -- A next-day 00:xx practice may open on the previous local calendar day.
  FOR offset_day IN 0..1 LOOP
    session_day := today + offset_day;
    IF days @> jsonb_build_array(EXTRACT(DOW FROM session_day)::int) THEN
      session_start := (session_day + start_text::time) AT TIME ZONE zone;
      session_end := (session_day + end_text::time) AT TIME ZONE zone;
      IF at_time >= session_start - INTERVAL '30 minutes' AND at_time < session_end
        THEN RETURN TRUE; END IF;
    END IF;
  END LOOP;
  RETURN FALSE;
EXCEPTION WHEN OTHERS THEN
  -- Corrupt schedules/timezones never create an open window.
  RETURN FALSE;
END $$;

-- Remove even migration-owner default-ACL residue, on this function only.
REVOKE ALL ON FUNCTION platform.venue_checkin_window(JSONB,TEXT,TIMESTAMPTZ) FROM PUBLIC;
DO $$
DECLARE grantee_name TEXT;
BEGIN
  FOR grantee_name IN
    SELECT r.rolname FROM pg_proc p, aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee
    WHERE p.oid='platform.venue_checkin_window(jsonb,text,timestamptz)'::regprocedure
      AND a.grantee<>p.proowner
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION platform.venue_checkin_window(JSONB,TEXT,TIMESTAMPTZ) FROM %I',grantee_name);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION platform.venue_checkin_window(JSONB,TEXT,TIMESTAMPTZ)
  TO qigong_venue_qr_writer,qigong_venue_debug;

CREATE OR REPLACE FUNCTION platform.venue_qr_checkin(input_subject TEXT, input_code TEXT, input_lat DOUBLE PRECISION, input_lon DOUBLE PRECISION)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $$
DECLARE mapping JSONB; privacy JSONB; venue RECORD; saved RECORD; at_time TIMESTAMPTZ;
  local_time TIMESTAMP; metres DOUBLE PRECISION; replayed BOOLEAN := FALSE; person UUID;
BEGIN
  -- Public test-site code is not a credential. Never write OR replay formal attendance.
  IF input_code='tw-location-test' THEN
    RAISE EXCEPTION 'venue_test_code_required' USING ERRCODE='42501';
  END IF;
  IF admin.request_id() IS NULL OR admin.request_person_id() IS NOT NULL OR admin.request_principal_id() IS NOT NULL
    OR input_subject IS NULL OR input_subject !~ '^U[0-9a-f]{32}$'
    OR input_code IS NULL OR input_code !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)+$' OR length(input_code)>64
    OR input_lat IS NULL OR input_lon IS NULL OR input_lat NOT BETWEEN -90 AND 90 OR input_lon NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'venue_invalid' USING ERRCODE='22023';
  END IF;
  -- Serialize same-subject attempts. Recheck identity and current consent in this write transaction.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('venue:'||input_subject,0));
  mapping := platform.resolve_line_learner_identity(input_subject);
  IF mapping IS NULL THEN RAISE EXCEPTION 'venue_identity_denied' USING ERRCODE='42501'; END IF;
  privacy := platform.privacy_usage('line',input_subject);
  IF coalesce((privacy->>'required')::boolean,FALSE) OR coalesce((privacy->>'unavailable')::boolean,FALSE) THEN
    RAISE EXCEPTION 'venue_consent_denied' USING ERRCODE='42501';
  END IF;
  person := (mapping->>'personId')::uuid;
  PERFORM pg_catalog.set_config('qigong.venue_subject',input_subject,TRUE);
  SELECT id, code, name_zh_tw, latitude, longitude, radius_meters, active_time_rules, timezone
    INTO venue FROM core.practice_fields WHERE code=input_code AND is_active;
  IF venue.id IS NULL THEN RAISE EXCEPTION 'venue_unavailable' USING ERRCODE='42501'; END IF;
  at_time := pg_catalog.clock_timestamp(); local_time := at_time AT TIME ZONE venue.timezone;
  -- Every attempt, including replay, must pass the current time and radius checks.
    IF platform.venue_checkin_window(venue.active_time_rules,venue.timezone,at_time) IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'venue_outside_window' USING ERRCODE='P0001';
    END IF;
    metres := 6371000 * 2 * pg_catalog.asin(pg_catalog.sqrt(LEAST(1.0,
      pg_catalog.power(pg_catalog.sin(pg_catalog.radians(input_lat-venue.latitude::float8)/2),2)
      + pg_catalog.cos(pg_catalog.radians(venue.latitude::float8))*pg_catalog.cos(pg_catalog.radians(input_lat))
      * pg_catalog.power(pg_catalog.sin(pg_catalog.radians(input_lon-venue.longitude::float8)/2),2))));
    IF metres > venue.radius_meters THEN RAISE EXCEPTION 'venue_outside_radius' USING ERRCODE='P0001'; END IF;
    INSERT INTO core.field_attendance(person_id,field_id,checkin_method,distance_meters,checkin_at,attendance_date,attendance_timezone)
      VALUES(person,venue.id,'qr_gps',metres,at_time,local_time::date,venue.timezone)
      ON CONFLICT(person_id,field_id,attendance_date,is_test) DO NOTHING
      RETURNING id,checkin_at,attendance_date,attendance_timezone INTO saved;
    IF saved.id IS NULL THEN
      replayed := TRUE;
      SELECT id,checkin_at,attendance_date,attendance_timezone INTO STRICT saved FROM core.field_attendance
        WHERE person_id=person AND field_id=venue.id AND attendance_date=local_time::date AND NOT is_test;
    END IF;
  INSERT INTO audit.events(request_id,actor_person_id,action,target_type,target_id,outcome,metadata)
    VALUES(admin.request_id(),person,'venue.qr_checkin','field_attendance',saved.id::text,'success',jsonb_build_object('replayed',replayed));
  RETURN jsonb_build_object('ok',TRUE,'venue',jsonb_build_object('code',venue.code,'name',venue.name_zh_tw,'timezone',saved.attendance_timezone),
    'checkedInAt',saved.checkin_at,'attendanceDate',saved.attendance_date,'replayed',replayed);
END $$;
ALTER FUNCTION platform.venue_qr_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION) OWNER TO qigong_venue_qr_writer;


-- Fixed static schema56 debug DDL; equality to configured venue remains mandatory.
CREATE OR REPLACE FUNCTION platform.venue_debug_checkin(input_subject TEXT, input_code TEXT, input_lat DOUBLE PRECISION, input_lon DOUBLE PRECISION, input_issued BIGINT, input_expires_ms BIGINT, input_proof TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $$
DECLARE mapping JSONB; privacy JSONB; venue RECORD; saved RECORD; at_time TIMESTAMPTZ;
  local_time TIMESTAMP; metres DOUBLE PRECISION; replayed BOOLEAN := FALSE; person UUID;
BEGIN
  IF admin.request_id() IS NULL OR admin.request_person_id() IS NOT NULL OR admin.request_principal_id() IS NOT NULL
    OR input_subject IS NULL OR input_subject !~ '^U[0-9a-f]{32}$'
    OR input_code IS NULL OR input_code !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)+$' OR length(input_code)>64
    OR input_lat IS NULL OR input_lon IS NULL OR input_lat NOT BETWEEN -90 AND 90 OR input_lon NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'venue_invalid' USING ERRCODE='22023';
  END IF;
  -- Serialize same-subject attempts. Recheck identity and current consent in this write transaction.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('venue:'||input_subject,0));
  IF input_code NOT IN ('tw-location-test','tw-taipei-cks') OR input_issued IS NULL
    OR input_issued < extract(epoch FROM clock_timestamp())-30
    OR input_issued > extract(epoch FROM clock_timestamp())+2
    OR input_expires_ms IS NULL
    OR input_proof IS NULL OR input_proof !~ '^[0-9a-f]{64}$'
    OR NOT EXISTS(SELECT 1 FROM platform.venue_debug_config c WHERE c.enabled AND c.venue_code=input_code AND c.expires_at>clock_timestamp()
      AND input_expires_ms=(extract(epoch FROM c.expires_at)*1000)::bigint
      AND input_proof=encode(public.hmac(convert_to(admin.request_id()::text||'|'||input_subject||'|'||input_code||'|'||input_issued::text||'|'||input_expires_ms::text,'UTF8'),
        decode(c.token_hash,'hex'),'sha256'),'hex')) THEN
    RAISE EXCEPTION 'venue_debug_denied' USING ERRCODE='42501'; END IF;
  mapping := platform.resolve_line_learner_identity(input_subject);
  IF mapping IS NULL THEN RAISE EXCEPTION 'venue_identity_denied' USING ERRCODE='42501'; END IF;
  privacy := platform.privacy_usage('line',input_subject);
  IF coalesce((privacy->>'required')::boolean,FALSE) OR coalesce((privacy->>'unavailable')::boolean,FALSE) THEN
    RAISE EXCEPTION 'venue_consent_denied' USING ERRCODE='42501';
  END IF;
  person := (mapping->>'personId')::uuid;
  INSERT INTO platform.venue_debug_context VALUES(pg_backend_pid(),pg_current_xact_id(),person);
  SELECT id, region_id, code, name_zh_tw, latitude, longitude, radius_meters, active_time_rules, timezone
    INTO venue FROM core.practice_fields WHERE code=input_code AND is_active;
  IF venue.id IS NULL OR NOT platform.venue_debug_region_active(venue.region_id) THEN RAISE EXCEPTION 'venue_unavailable' USING ERRCODE='42501'; END IF;
  at_time := pg_catalog.clock_timestamp(); local_time := at_time AT TIME ZONE venue.timezone;
  -- Every attempt, including replay, must pass the current time and radius checks.
    IF platform.venue_checkin_window(venue.active_time_rules,venue.timezone,at_time) IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'venue_outside_window' USING ERRCODE='P0001';
    END IF;
    metres := 6371000 * 2 * pg_catalog.asin(pg_catalog.sqrt(LEAST(1.0,
      pg_catalog.power(pg_catalog.sin(pg_catalog.radians(input_lat-venue.latitude::float8)/2),2)
      + pg_catalog.cos(pg_catalog.radians(venue.latitude::float8))*pg_catalog.cos(pg_catalog.radians(input_lat))
      * pg_catalog.power(pg_catalog.sin(pg_catalog.radians(input_lon-venue.longitude::float8)/2),2))));
    -- Only distance is waived; original coordinates are used, never persisted.
    INSERT INTO core.field_attendance(person_id,field_id,checkin_method,distance_meters,checkin_at,attendance_date,attendance_timezone,is_test,verification_mode)
      VALUES(person,venue.id,'qr_gps',metres,at_time,local_time::date,venue.timezone,TRUE,'distance_debug')
      ON CONFLICT(person_id,field_id,attendance_date,is_test) DO NOTHING
      RETURNING id,checkin_at,attendance_date,attendance_timezone INTO saved;
    IF saved.id IS NULL THEN
      replayed := TRUE;
      SELECT id,checkin_at,attendance_date,attendance_timezone INTO STRICT saved FROM core.field_attendance
        WHERE person_id=person AND field_id=venue.id AND attendance_date=local_time::date AND is_test;
    END IF;
  INSERT INTO audit.events(request_id,actor_person_id,action,target_type,target_id,outcome,metadata)
    VALUES(admin.request_id(),person,'venue.qr_checkin','field_attendance',saved.id::text,'success',jsonb_build_object('replayed',replayed,'isTest',TRUE,'verificationMode','distance_debug'));
  DELETE FROM platform.venue_debug_context WHERE backend_pid=pg_backend_pid() AND transaction_id=pg_current_xact_id();
  RETURN jsonb_build_object('isTest',TRUE,'verificationMode','distance_debug','ok',TRUE,'venue',jsonb_build_object('code',venue.code,'name',venue.name_zh_tw,'timezone',saved.attendance_timezone),
    'checkedInAt',saved.checkin_at,'attendanceDate',saved.attendance_date,'replayed',replayed);
END $$;
ALTER FUNCTION platform.venue_debug_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,BIGINT,BIGINT,TEXT) OWNER TO qigong_venue_debug;

-- CREATE OR REPLACE preserves ownership/ACL; explicitly retain only the narrow entry grants.
REVOKE ALL ON FUNCTION platform.venue_qr_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION),
  platform.venue_debug_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,BIGINT,BIGINT,TEXT)
  FROM PUBLIC,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION platform.venue_qr_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION),
  platform.venue_debug_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,BIGINT,BIGINT,TEXT)
  TO qigong_api_runtime;
