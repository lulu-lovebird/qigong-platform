-- Limited distance-only testing. Forward only; no deployment enablement or secrets.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
-- Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
SET LOCAL search_path = pg_catalog;

-- Earth's maximum great-circle distance exceeds the legacy 999999.99m bound.
ALTER TABLE core.field_attendance ALTER COLUMN distance_meters TYPE NUMERIC(10,2);
ALTER TABLE core.field_attendance ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE core.field_attendance ADD COLUMN verification_mode TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE core.field_attendance ADD CONSTRAINT venue_test_mode CHECK (
  (NOT is_test AND verification_mode='standard') OR
  (is_test AND verification_mode='distance_debug' AND checkin_method='qr_gps'
    AND checkin_id IS NULL AND volunteer_person_id IS NULL AND student_note IS NULL
    AND user_latitude IS NULL AND user_longitude IS NULL));
-- Formal uniqueness is unchanged within the FALSE key. Debug never replaces real.
DROP INDEX core.idx_field_attendance_unique_local_day;
CREATE UNIQUE INDEX idx_field_attendance_unique_local_day
  ON core.field_attendance(person_id,field_id,attendance_date,is_test);
GRANT SELECT (is_test) ON core.field_attendance TO qigong_venue_qr_writer;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qigong_venue_debug') THEN
    RAISE EXCEPTION 'venue debug requires a new isolated role'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('core.field_attendance'::regclass,
    'core.practice_fields'::regclass,'audit.events'::regclass) AND (NOT relrowsecurity OR NOT relforcerowsecurity)) THEN
    RAISE EXCEPTION 'venue debug requires FORCE RLS'; END IF;
END $$;
CREATE ROLE qigong_venue_debug NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA core,platform,admin,audit TO qigong_venue_debug;
GRANT SELECT (id,region_id,code,name_zh_tw,latitude,longitude,radius_meters,active_time_rules,is_active,timezone)
  ON core.practice_fields TO qigong_venue_debug;
GRANT SELECT (id,person_id,field_id,checkin_method,distance_meters,checkin_at,attendance_date,attendance_timezone,is_test,verification_mode)
  ON core.field_attendance TO qigong_venue_debug;
GRANT INSERT (person_id,field_id,checkin_method,distance_meters,checkin_at,attendance_date,attendance_timezone,is_test,verification_mode)
  ON core.field_attendance TO qigong_venue_debug;
GRANT INSERT (request_id,actor_person_id,action,target_type,target_id,outcome,metadata)
  ON audit.events TO qigong_venue_debug;
GRANT EXECUTE ON FUNCTION admin.request_id(),admin.request_person_id(),admin.request_principal_id(),
  platform.resolve_line_learner_identity(TEXT),platform.privacy_usage(TEXT,TEXT) TO qigong_venue_debug;

-- Owner-provisioned only; no runtime setter or production key. Empty means OFF.
CREATE TABLE platform.venue_debug_config (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL CHECK(isfinite(expires_at)),
  token_hash TEXT NOT NULL CHECK(token_hash ~ '^[0-9a-f]{64}$')
);
ALTER TABLE platform.venue_debug_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.venue_debug_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.venue_debug_config FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
GRANT SELECT ON platform.venue_debug_config TO qigong_venue_debug;
CREATE POLICY venue_debug_configuration ON platform.venue_debug_config FOR SELECT TO qigong_venue_debug USING(TRUE);
CREATE TABLE platform.venue_debug_context (
  backend_pid INTEGER NOT NULL, transaction_id XID8 NOT NULL, person_id UUID NOT NULL,
  PRIMARY KEY(backend_pid,transaction_id)
);
ALTER TABLE platform.venue_debug_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.venue_debug_context FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.venue_debug_context FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
GRANT SELECT,INSERT,DELETE ON platform.venue_debug_context TO qigong_venue_debug;
CREATE POLICY venue_debug_context_owner ON platform.venue_debug_context TO qigong_venue_debug
  USING(backend_pid=pg_backend_pid() AND transaction_id=pg_current_xact_id())
  WITH CHECK(backend_pid=pg_backend_pid() AND transaction_id=pg_current_xact_id());
CREATE FUNCTION platform.venue_debug_person() RETURNS UUID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
  SELECT person_id FROM platform.venue_debug_context
    WHERE backend_pid=pg_backend_pid() AND transaction_id=pg_current_xact_id()
$$;
ALTER FUNCTION platform.venue_debug_person() OWNER TO qigong_venue_debug;
-- This PUBLIC restrictive policy is an exclusion, never a grant. All existing
-- history, admin people/detail/export, rollup and future runtime readers exclude tests.
CREATE POLICY venue_formal_only ON core.field_attendance AS RESTRICTIVE FOR SELECT TO PUBLIC
  USING(NOT is_test OR current_user='qigong_venue_debug');
CREATE POLICY venue_debug_own ON core.field_attendance FOR SELECT TO qigong_venue_debug
  USING(is_test AND person_id=platform.venue_debug_person());
CREATE POLICY venue_debug_fields ON core.practice_fields FOR SELECT TO qigong_venue_debug
  USING(code='tw-location-test');
CREATE POLICY venue_debug_insert ON core.field_attendance FOR INSERT TO qigong_venue_debug
  WITH CHECK(is_test AND verification_mode='distance_debug' AND person_id=platform.venue_debug_person()
    AND admin.request_id() IS NOT NULL AND admin.request_person_id() IS NULL AND admin.request_principal_id() IS NULL
    AND EXISTS(SELECT 1 FROM core.practice_fields f WHERE f.id=field_id AND f.code='tw-location-test' AND f.is_active
      AND attendance_timezone=f.timezone AND attendance_date=(checkin_at AT TIME ZONE f.timezone)::date));
CREATE POLICY venue_debug_insert_only ON core.field_attendance AS RESTRICTIVE FOR INSERT TO PUBLIC
  WITH CHECK(NOT is_test OR current_user='qigong_venue_debug');
CREATE POLICY venue_debug_audit ON audit.events FOR INSERT TO qigong_venue_debug
  WITH CHECK(request_id=admin.request_id() AND actor_person_id=platform.venue_debug_person()
    AND action='venue.qr_checkin' AND outcome='success' AND metadata->>'isTest'='true'
    AND metadata->>'verificationMode'='distance_debug');

CREATE OR REPLACE FUNCTION platform.venue_qr_checkin(input_subject TEXT, input_code TEXT, input_lat DOUBLE PRECISION, input_lon DOUBLE PRECISION)
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
    IF NOT (venue.active_time_rules->'day_of_week' @> pg_catalog.jsonb_build_array(EXTRACT(DOW FROM local_time)::int))
      OR local_time::time < (venue.active_time_rules->>'start_time')::time
      OR local_time::time >= (venue.active_time_rules->>'end_time')::time THEN
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

CREATE FUNCTION platform.venue_debug_checkin(input_subject TEXT, input_code TEXT, input_lat DOUBLE PRECISION, input_lon DOUBLE PRECISION, input_issued BIGINT, input_proof TEXT)
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
  IF input_code IS DISTINCT FROM 'tw-location-test' OR input_issued IS NULL
    OR input_issued < extract(epoch FROM clock_timestamp())-30
    OR input_issued > extract(epoch FROM clock_timestamp())+2
    OR input_proof IS NULL OR input_proof !~ '^[0-9a-f]{64}$'
    OR NOT EXISTS(SELECT 1 FROM platform.venue_debug_config c WHERE c.enabled AND c.expires_at>clock_timestamp()
      AND input_proof=encode(public.hmac(convert_to(admin.request_id()::text||'|'||input_subject||'|'||input_code||'|'||input_issued::text,'UTF8'),
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
  SELECT id, code, name_zh_tw, latitude, longitude, radius_meters, active_time_rules, timezone
    INTO venue FROM core.practice_fields WHERE code=input_code AND is_active;
  IF venue.id IS NULL THEN RAISE EXCEPTION 'venue_unavailable' USING ERRCODE='42501'; END IF;
  at_time := pg_catalog.clock_timestamp(); local_time := at_time AT TIME ZONE venue.timezone;
  -- Every attempt, including replay, must pass the current time and radius checks.
    IF NOT (venue.active_time_rules->'day_of_week' @> pg_catalog.jsonb_build_array(EXTRACT(DOW FROM local_time)::int))
      OR local_time::time < (venue.active_time_rules->>'start_time')::time
      OR local_time::time >= (venue.active_time_rules->>'end_time')::time THEN
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
ALTER FUNCTION platform.venue_debug_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,BIGINT,TEXT) OWNER TO qigong_venue_debug;

CREATE FUNCTION platform.venue_debug_history(input_platform TEXT,input_subject TEXT,
  input_month TEXT DEFAULT NULL,input_venue TEXT DEFAULT NULL,input_page BIGINT DEFAULT 1)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $$
DECLARE mapping JSONB; privacy JSONB; person UUID; result JSONB; month_start DATE; month_end DATE;
BEGIN
  IF admin.request_id() IS NULL OR admin.request_person_id() IS NOT NULL
    OR admin.request_principal_id() IS NOT NULL OR input_platform IS DISTINCT FROM 'line'
    OR input_subject IS NULL OR input_subject !~ '^U[0-9a-f]{32}$'
    OR input_page IS NULL OR input_page NOT BETWEEN 1 AND 9007199254740991
    OR (input_month IS NOT NULL AND (input_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR left(input_month,4)='0000'))
    OR (input_venue IS NOT NULL AND (length(input_venue)>64 OR input_venue !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)+$')) THEN
    RAISE EXCEPTION 'venue_history_invalid' USING ERRCODE='22023';
  END IF;
  -- Revalidate in THIS read transaction; the HTTP adapter snapshot is not authority.
  mapping := platform.resolve_line_learner_identity(input_subject);
  IF mapping IS NULL THEN RAISE EXCEPTION 'venue_history_denied' USING ERRCODE='42501'; END IF;
  privacy := platform.privacy_usage(input_platform,input_subject);
  IF coalesce((privacy->>'required')::boolean,FALSE) OR coalesce((privacy->>'unavailable')::boolean,FALSE) THEN
    RAISE EXCEPTION 'venue_history_denied' USING ERRCODE='42501';
  END IF;
  person := (mapping->>'personId')::uuid;
  month_start := (coalesce(input_month,to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM'))||'-01')::date;
  month_end := (month_start+interval '1 month')::date;
  INSERT INTO platform.venue_debug_context VALUES(pg_backend_pid(),pg_current_xact_id(),person);
  WITH own AS MATERIALIZED (
    SELECT a.id,a.field_id,a.checkin_at,a.attendance_date,a.attendance_timezone
    FROM core.field_attendance a WHERE a.person_id=person AND a.is_test
  ), totals AS (
    SELECT count(*) attendance_count,count(DISTINCT attendance_date) attendance_days,
      count(*) FILTER (WHERE attendance_date>=month_start AND attendance_date<month_end) month_count FROM own
  ), filtered AS (
    SELECT a.id,a.checkin_at,a.attendance_date,a.attendance_timezone,f.code,f.name_zh_tw
    FROM own a JOIN core.practice_fields f ON f.id=a.field_id
    WHERE (input_month IS NULL OR (a.attendance_date>=month_start AND a.attendance_date<month_end))
      AND (input_venue IS NULL OR f.code=input_venue)
  ), page_rows AS MATERIALIZED (
    SELECT * FROM filtered ORDER BY checkin_at DESC,id DESC
    LIMIT 21 OFFSET ((input_page::bigint-1)*20)
  ), visible AS (
    SELECT * FROM page_rows ORDER BY checkin_at DESC,id DESC LIMIT 20
  ) SELECT jsonb_build_object('ok',TRUE,'timezone','Asia/Taipei',
    'totals',jsonb_build_object('attendanceCount',0,'attendanceDays',0,'monthCount',0),
    'page',input_page,'pageSize',20,'hasMore',(SELECT count(*)>20 FROM page_rows),
    'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('isTest',TRUE,'verificationMode','distance_debug','id',id,'venueCode',code,'venueName',name_zh_tw,
      'checkedInAt',to_char(checkin_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'venueLocalDate',attendance_date,'venueTimezone',attendance_timezone) ORDER BY checkin_at DESC,id DESC)
      FROM visible),'[]'::jsonb)) INTO result FROM totals;
  DELETE FROM platform.venue_debug_context WHERE backend_pid=pg_backend_pid() AND transaction_id=pg_current_xact_id();
  RETURN result;
END $$;
ALTER FUNCTION platform.venue_debug_history(TEXT,TEXT,TEXT,TEXT,BIGINT) OWNER TO qigong_venue_debug;

-- Remove inherited default ACLs too. No role memberships, GUC authority or broad EXECUTE.
DO $$ DECLARE f RECORD; g RECORD; BEGIN
  FOR f IN SELECT p.oid,p.proowner,p.oid::regprocedure signature FROM pg_proc p
    WHERE p.oid=ANY(ARRAY['platform.venue_debug_person()'::regprocedure,
      'platform.venue_debug_checkin(text,text,double precision,double precision,bigint,text)'::regprocedure,
      'platform.venue_debug_history(text,text,text,text,bigint)'::regprocedure]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC CASCADE',f.signature);
    FOR g IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=f.oid AND a.grantee<>f.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I CASCADE',f.signature,g.rolname);
    END LOOP;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION platform.venue_debug_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,BIGINT,TEXT),
  platform.venue_debug_history(TEXT,TEXT,TEXT,TEXT,BIGINT) TO qigong_api_runtime;
