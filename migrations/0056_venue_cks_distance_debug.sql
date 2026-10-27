-- CKS distance-only exception: forward migration; never provisions credentials.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
SET LOCAL search_path=pg_catalog;
-- Revoke the old site's authority, never transfer it to a formal venue.
DELETE FROM platform.venue_debug_config;
ALTER TABLE platform.venue_debug_config
  ADD COLUMN venue_code TEXT NOT NULL CHECK(venue_code='tw-taipei-cks'),
  ADD COLUMN configured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(configured_at)),
  ADD CONSTRAINT venue_debug_finite_window CHECK(expires_at>configured_at AND expires_at<=configured_at+interval '60 minutes'),
  ADD CONSTRAINT venue_debug_millisecond_expiry CHECK(expires_at=date_trunc('milliseconds',expires_at));
DROP FUNCTION platform.venue_debug_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,BIGINT,TEXT);
-- Read historical tests at the old site, but only the configured CKS site can write.
ALTER POLICY venue_debug_fields ON core.practice_fields USING(code IN ('tw-location-test','tw-taipei-cks'));
ALTER POLICY venue_debug_insert ON core.field_attendance
  WITH CHECK(is_test AND verification_mode='distance_debug' AND person_id=platform.venue_debug_person()
    AND admin.request_id() IS NOT NULL AND admin.request_person_id() IS NULL AND admin.request_principal_id() IS NULL
    AND EXISTS(SELECT 1 FROM core.practice_fields f WHERE f.id=field_id AND f.code='tw-taipei-cks' AND f.is_active
      AND attendance_timezone=f.timezone AND attendance_date=(checkin_at AT TIME ZONE f.timezone)::date));
-- No existing helper exposes precisely this boolean without identity/scoping grants.
CREATE ROLE qigong_venue_debug_region_guard NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA core,platform TO qigong_venue_debug_region_guard;
GRANT SELECT(id,parent_region_id,region_type,active) ON core.regions TO qigong_venue_debug_region_guard;
CREATE POLICY venue_debug_region_guard ON core.regions FOR SELECT TO qigong_venue_debug_region_guard USING(TRUE);
CREATE FUNCTION platform.venue_debug_region_active(input_region UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
  SELECT EXISTS(SELECT 1 FROM core.regions r
    JOIN core.regions c ON c.id=r.parent_region_id
    JOIN core.regions g ON g.id=c.parent_region_id
    WHERE r.id=input_region AND r.region_type='operational' AND r.active
      AND c.region_type='country' AND c.active
      AND g.region_type='global' AND g.active AND g.parent_region_id IS NULL)
$$;
ALTER FUNCTION platform.venue_debug_region_active(UUID) OWNER TO qigong_venue_debug_region_guard;
CREATE FUNCTION platform.venue_debug_checkin(input_subject TEXT, input_code TEXT, input_lat DOUBLE PRECISION, input_lon DOUBLE PRECISION, input_issued BIGINT, input_expires_ms BIGINT, input_proof TEXT)
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
  IF input_code IS DISTINCT FROM 'tw-taipei-cks' OR input_issued IS NULL
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
ALTER FUNCTION platform.venue_debug_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,BIGINT,BIGINT,TEXT) OWNER TO qigong_venue_debug;


-- Strip inherited default ACLs; runtime may call checkin, not the region guard.
DO $$ DECLARE f RECORD; g RECORD; BEGIN
  FOR f IN SELECT p.oid,p.proowner,p.oid::regprocedure signature FROM pg_proc p
    WHERE p.oid=ANY(ARRAY['platform.venue_debug_region_active(uuid)'::regprocedure,
      'platform.venue_debug_checkin(text,text,double precision,double precision,bigint,bigint,text)'::regprocedure]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC CASCADE',f.signature);
    FOR g IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=f.oid AND a.grantee<>f.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I CASCADE',f.signature,g.rolname);
    END LOOP;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION platform.venue_debug_region_active(UUID) TO qigong_venue_debug;
GRANT EXECUTE ON FUNCTION platform.venue_debug_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION,BIGINT,BIGINT,TEXT) TO qigong_api_runtime;
