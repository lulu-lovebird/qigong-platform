-- Reviewed QR success path. Forward only; no legacy backfill or daily-practice writes.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
-- Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
SET LOCAL search_path = pg_catalog;

-- New development only: never reinterpret existing attendance dates silently.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM core.field_attendance) THEN
    RAISE EXCEPTION '0050 requires empty attendance; legacy migration is not authorized';
  END IF;
END $$;

ALTER TABLE core.practice_fields ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Taipei';
ALTER TABLE core.field_attendance ADD COLUMN attendance_date DATE NOT NULL;
ALTER TABLE core.field_attendance ADD COLUMN attendance_timezone TEXT NOT NULL;
ALTER TABLE core.field_attendance DROP CONSTRAINT field_attendance_checkin_method_check;
ALTER TABLE core.field_attendance ADD CONSTRAINT field_attendance_checkin_method_check
  CHECK (checkin_method IN ('nfc_gps', 'qr_gps', 'volunteer_manual'));
DROP INDEX core.idx_field_attendance_unique_day;
CREATE UNIQUE INDEX idx_field_attendance_unique_local_day
  ON core.field_attendance(person_id, field_id, attendance_date);

CREATE FUNCTION core.validate_venue_qr_configuration() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone)
    OR NEW.latitude NOT BETWEEN -90 AND 90 OR NEW.longitude NOT BETWEEN -180 AND 180
    OR NEW.radius_meters NOT BETWEEN 1 AND 5000
    OR length(NEW.name_zh_tw) NOT BETWEEN 1 AND 120 OR NEW.name_zh_tw ~ '[[:cntrl:]]'
    OR length(NEW.code)>64 OR NEW.code !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)+$'
    OR pg_catalog.jsonb_typeof(NEW.active_time_rules) IS DISTINCT FROM 'object'
    OR NOT (NEW.active_time_rules ?& ARRAY['day_of_week','start_time','end_time'])
    OR pg_catalog.jsonb_typeof(NEW.active_time_rules->'day_of_week') IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(NEW.active_time_rules->'day_of_week') NOT BETWEEN 1 AND 7
    OR NOT (NEW.active_time_rules->>'start_time' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    OR NOT (NEW.active_time_rules->>'end_time' ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$')
    OR NEW.active_time_rules->>'start_time' >= NEW.active_time_rules->>'end_time'
    OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(NEW.active_time_rules->'day_of_week') d
      WHERE d::text !~ '^[0-6]$') THEN
    RAISE EXCEPTION 'invalid venue configuration' USING ERRCODE = '22023';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.region_id IS DISTINCT FROM OLD.region_id OR NEW.timezone IS DISTINCT FROM OLD.timezone)
    AND EXISTS (SELECT 1 FROM core.field_attendance WHERE field_id=OLD.id) THEN
    RAISE EXCEPTION 'venue region/timezone is immutable after first attendance';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_venue_qr_configuration BEFORE INSERT OR UPDATE
  ON core.practice_fields FOR EACH ROW EXECUTE FUNCTION core.validate_venue_qr_configuration();
-- Validate existing field configuration too; no scope/date ledger or data rewrite.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM core.practice_fields) THEN
    RAISE EXCEPTION '0050 requires synthetic/new venue configuration after migration';
  END IF;
END $$;

DO $$ DECLARE role_name TEXT; role_oid OID; BEGIN
  FOREACH role_name IN ARRAY ARRAY['qigong_venue_qr_writer','qigong_venue_qr_reader'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      RAISE EXCEPTION 'venue QR roles must be new isolated roles';
    END IF;
    EXECUTE pg_catalog.format('CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', role_name);
    SELECT oid INTO role_oid FROM pg_catalog.pg_roles WHERE rolname = role_name;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid = role_oid OR member = role_oid) THEN
      RAISE EXCEPTION 'unexpected venue role membership';
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA core, platform, admin, audit TO qigong_venue_qr_writer, qigong_venue_qr_reader;
GRANT USAGE ON SCHEMA identity TO qigong_venue_qr_reader;
GRANT SELECT (id, region_id, code, name_zh_tw, latitude, longitude, radius_meters, active_time_rules, is_active, timezone)
  ON core.practice_fields TO qigong_venue_qr_writer;
GRANT SELECT (id, region_id, code, name_zh_tw, is_active, timezone)
  ON core.practice_fields TO qigong_venue_qr_reader;
GRANT SELECT (id, person_id, field_id, checkin_method, distance_meters, checkin_at, attendance_date, attendance_timezone)
  ON core.field_attendance TO qigong_venue_qr_writer, qigong_venue_qr_reader;
GRANT INSERT (person_id, field_id, checkin_method, distance_meters, checkin_at, attendance_date, attendance_timezone)
  ON core.field_attendance TO qigong_venue_qr_writer;
GRANT SELECT (id, legal_name, preferred_name) ON identity.people TO qigong_venue_qr_reader;
GRANT INSERT (request_id, actor_principal_id, actor_person_id, action, target_type, target_id, scope_type, scope_id, outcome, metadata)
  ON audit.events TO qigong_venue_qr_writer, qigong_venue_qr_reader;
GRANT EXECUTE ON FUNCTION admin.request_id(), admin.request_person_id(), admin.request_principal_id()
  TO qigong_venue_qr_writer, qigong_venue_qr_reader;
GRANT EXECUTE ON FUNCTION platform.resolve_line_learner_identity(TEXT), platform.privacy_usage(TEXT,TEXT)
  TO qigong_venue_qr_writer;
GRANT EXECUTE ON FUNCTION admin.session_principal(TEXT), admin.can_access_region(UUID,TEXT)
  TO qigong_venue_qr_reader;

-- Retain 0049's minimal nonowner resolver, but check wall-clock validity after waits.
-- Existing RLS may conservatively deny identities activated after transaction start.
CREATE OR REPLACE FUNCTION platform.resolve_line_learner_identity(input_subject TEXT)
RETURNS JSONB LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $$
  SELECT jsonb_build_object('subject',i.external_subject_id,'identityId',i.id,'personId',p.id,
    'revoked',FALSE,'learnerActive',TRUE,'channelActive',TRUE,'applicationApproved',TRUE)
  FROM identity.platform_identities i JOIN identity.people p ON p.id=i.person_id AND p.status='active'
  JOIN identity.onboarding_applications a ON a.person_id=p.id AND a.platform='line'
    AND a.external_subject_id=input_subject AND a.status='approved'
  WHERE input_subject ~ '^U[0-9a-f]{32}$' AND i.platform='line' AND i.external_subject_id=input_subject
    AND i.revoked_at IS NULL AND i.verified_at<=clock_timestamp()
    AND EXISTS(SELECT 1 FROM identity.person_interaction_channels c WHERE c.person_id=p.id
      AND c.platform_identity_id=i.id AND c.valid_from<=clock_timestamp()
      AND (c.valid_to IS NULL OR c.valid_to>clock_timestamp()))
$$;

-- No runtime/session membership, ownership change, BYPASSRLS, UPDATE or DELETE grants.
-- Only these inaccessible function owners can satisfy the new policies.
DROP POLICY practice_fields_security_quarantine ON core.practice_fields;
DROP POLICY field_attendance_security_quarantine ON core.field_attendance;
CREATE POLICY venue_fields_no_update ON core.practice_fields AS RESTRICTIVE FOR UPDATE TO PUBLIC USING(FALSE) WITH CHECK(FALSE);
CREATE POLICY venue_fields_no_delete ON core.practice_fields AS RESTRICTIVE FOR DELETE TO PUBLIC USING(FALSE);
CREATE POLICY venue_attendance_no_update ON core.field_attendance AS RESTRICTIVE FOR UPDATE TO PUBLIC USING(FALSE) WITH CHECK(FALSE);
CREATE POLICY venue_attendance_no_delete ON core.field_attendance AS RESTRICTIVE FOR DELETE TO PUBLIC USING(FALSE);
CREATE POLICY venue_fields_reader ON core.practice_fields FOR SELECT TO qigong_venue_qr_reader
  USING (admin.can_access_region(region_id,'checkin.read') OR admin.can_access_region(region_id,'stats.export'));
CREATE POLICY venue_fields_writer ON core.practice_fields FOR SELECT TO qigong_venue_qr_writer
  USING (is_active);
CREATE POLICY venue_attendance_reader ON core.field_attendance FOR SELECT TO qigong_venue_qr_reader
  USING (EXISTS (SELECT 1 FROM core.practice_fields f WHERE f.id = field_id));
CREATE POLICY venue_names_reader ON identity.people FOR SELECT TO qigong_venue_qr_reader
  USING (EXISTS (SELECT 1 FROM core.field_attendance a WHERE a.person_id = people.id));
CREATE POLICY venue_attendance_replay ON core.field_attendance FOR SELECT TO qigong_venue_qr_writer
  USING (person_id = (platform.resolve_line_learner_identity(NULLIF(current_setting('qigong.venue_subject',TRUE),''))->>'personId')::uuid);
CREATE POLICY venue_attendance_verified_insert ON core.field_attendance FOR INSERT TO qigong_venue_qr_writer
  WITH CHECK (
    admin.request_id() IS NOT NULL AND admin.request_principal_id() IS NULL
    AND person_id = (platform.resolve_line_learner_identity(NULLIF(current_setting('qigong.venue_subject',TRUE),''))->>'personId')::uuid
    AND checkin_method = 'qr_gps' AND checkin_id IS NULL AND volunteer_person_id IS NULL
    AND user_latitude IS NULL AND user_longitude IS NULL AND student_note IS NULL
    AND EXISTS (SELECT 1 FROM core.practice_fields f WHERE f.id = field_id AND f.is_active
      AND attendance_timezone = f.timezone AND attendance_date = (checkin_at AT TIME ZONE f.timezone)::date)
  );
CREATE POLICY venue_audit_insert ON audit.events FOR INSERT TO qigong_venue_qr_writer, qigong_venue_qr_reader
  WITH CHECK (request_id = admin.request_id() AND outcome = 'success'
    AND action IN ('venue.qr_checkin','venue.attendance_read','venue.attendance_export','venue.fields_read'));

CREATE FUNCTION platform.venue_qr_checkin(input_subject TEXT, input_code TEXT, input_lat DOUBLE PRECISION, input_lon DOUBLE PRECISION)
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
      ON CONFLICT(person_id,field_id,attendance_date) DO NOTHING
      RETURNING id,checkin_at,attendance_date,attendance_timezone INTO saved;
    IF saved.id IS NULL THEN
      replayed := TRUE;
      SELECT id,checkin_at,attendance_date,attendance_timezone INTO STRICT saved FROM core.field_attendance
        WHERE person_id=person AND field_id=venue.id AND attendance_date=local_time::date;
    END IF;
  INSERT INTO audit.events(request_id,actor_person_id,action,target_type,target_id,outcome,metadata)
    VALUES(admin.request_id(),person,'venue.qr_checkin','field_attendance',saved.id::text,'success',jsonb_build_object('replayed',replayed));
  RETURN jsonb_build_object('ok',TRUE,'venue',jsonb_build_object('code',venue.code,'name',venue.name_zh_tw,'timezone',saved.attendance_timezone),
    'checkedInAt',saved.checkin_at,'attendanceDate',saved.attendance_date,'replayed',replayed);
END $$;
ALTER FUNCTION platform.venue_qr_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION) OWNER TO qigong_venue_qr_writer;

CREATE FUNCTION admin.venue_qr_read(input_session TEXT,input_region UUID,input_from DATE,input_until DATE,
  input_page INTEGER,input_limit INTEGER,input_export BOOLEAN,input_field UUID,input_method TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $$
DECLARE principal UUID; data JSONB; operation TEXT; permission TEXT;
BEGIN
  principal := admin.session_principal(input_session);
  operation := CASE WHEN input_export THEN 'attendance.export' ELSE 'attendance.read' END;
  permission := CASE WHEN input_export THEN 'stats.export' ELSE 'checkin.read' END;
  IF principal IS NULL OR principal IS DISTINCT FROM admin.request_principal_id()
    OR admin.request_id() IS NULL OR admin.request_person_id() IS NOT NULL
    OR NOT admin.can_access_region(input_region,permission) THEN
    RAISE EXCEPTION 'venue_forbidden' USING ERRCODE='42501';
  END IF;
  IF input_region IS NULL OR input_export IS NULL OR input_from IS NULL OR input_until IS NULL
    OR NOT isfinite(input_from) OR NOT isfinite(input_until) OR input_until<=input_from OR input_until-input_from>366
    OR input_page IS NULL OR input_page NOT BETWEEN 1 AND 10000 OR input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 100
    OR (input_method IS NOT NULL AND input_method NOT IN ('qr_gps','nfc_gps','volunteer_manual')) THEN
    RAISE EXCEPTION 'venue_invalid' USING ERRCODE='22023';
  END IF;
  WITH scoped AS MATERIALIZED (
    SELECT a.id,a.person_id,a.attendance_date,a.checkin_method,a.distance_meters,
      f.id field_id,f.code,f.name_zh_tw,
      left(coalesce(nullif(btrim(p.preferred_name),''),nullif(btrim(p.legal_name),''),'學員'),120) learner_name
    FROM core.field_attendance a JOIN core.practice_fields f ON f.id=a.field_id
    JOIN identity.people p ON p.id=a.person_id
    WHERE f.region_id=input_region AND a.attendance_date>=input_from AND a.attendance_date<input_until
      AND (input_field IS NULL OR f.id=input_field) AND (input_method IS NULL OR a.checkin_method=input_method)
  ), totals AS (
    SELECT count(*) n,count(DISTINCT attendance_date) days,count(DISTINCT person_id) learners FROM scoped
  ), page_rows AS (
    SELECT * FROM scoped ORDER BY attendance_date,id
    LIMIT (CASE WHEN input_export THEN 1001 ELSE input_limit END)
    OFFSET (CASE WHEN input_export THEN 0 ELSE (input_page-1)*input_limit END)
  ) SELECT jsonb_build_object('version',1,'state','available','operation',operation,'regionId',input_region,
    'from',input_from,'until',input_until,'filters',jsonb_build_object('fieldId',input_field,'method',input_method),
    'timezone','venue-local','nameVisibility','visible',
    'totals',jsonb_build_object('attendanceCount',totals.n,'attendanceDays',totals.days,'learnerCount',totals.learners),
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('date',attendance_date,'learnerName',learner_name,
      'field',jsonb_build_object('fieldId',field_id,'code',code,'nameZhTw',name_zh_tw),
      'method',checkin_method,'distanceMeters',distance_meters) ORDER BY attendance_date,id) FROM page_rows),'[]'::jsonb))
    || CASE WHEN input_export THEN jsonb_build_object('rowCount',totals.n)
      ELSE jsonb_build_object('page',input_page,'limit',input_limit) END INTO data FROM totals;
  IF input_export AND (data->>'rowCount')::bigint>1000 THEN
    RAISE EXCEPTION 'venue_export_too_large' USING ERRCODE='54000';
  END IF;
  INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,scope_type,scope_id,outcome,metadata)
    VALUES(admin.request_id(),principal,CASE WHEN input_export THEN 'venue.attendance_export' ELSE 'venue.attendance_read' END,
      'field_attendance','region',input_region,'success',jsonb_build_object('from',input_from,'until',input_until,'rowCount',data->'totals'->'attendanceCount'));
  RETURN data;
END $$;
ALTER FUNCTION admin.venue_qr_read(TEXT,UUID,DATE,DATE,INTEGER,INTEGER,BOOLEAN,UUID,TEXT) OWNER TO qigong_venue_qr_reader;

-- Clear arbitrary default function ACLs, not only PUBLIC, before precise runtime grants.
DO $$ DECLARE f RECORD; g RECORD; BEGIN
  FOR f IN SELECT p.oid,p.proowner,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.oid=ANY(ARRAY['platform.venue_qr_checkin(text,text,double precision,double precision)'::regprocedure,
      'admin.venue_qr_read(text,uuid,date,date,integer,integer,boolean,uuid,text)'::regprocedure,
      'core.validate_venue_qr_configuration()'::regprocedure]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC CASCADE',f.nspname,f.proname,f.args);
    FOR g IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=f.oid AND a.grantee<>f.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM %I CASCADE',f.nspname,f.proname,f.args,g.rolname);
    END LOOP;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION platform.venue_qr_checkin(TEXT,TEXT,DOUBLE PRECISION,DOUBLE PRECISION),
  admin.venue_qr_read(TEXT,UUID,DATE,DATE,INTEGER,INTEGER,BOOLEAN,UUID,TEXT) TO qigong_api_runtime;
