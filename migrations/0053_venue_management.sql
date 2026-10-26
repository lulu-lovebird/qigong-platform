-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
-- Forward only. No attendance mutation, role promotion, or feature enablement.
SET LOCAL search_path = pg_catalog;
ALTER TABLE core.practice_fields ADD COLUMN address TEXT NOT NULL DEFAULT '' CHECK (length(address)<=500 AND address !~ '[[:cntrl:]]');
ALTER TABLE core.practice_fields ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version>0);

DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['qigong_venue_manager','qigong_venue_config_guard'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN RAISE EXCEPTION 'venue management roles must be new'; END IF;
    EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',r);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA core,admin,audit TO qigong_venue_manager, qigong_venue_config_guard;
GRANT SELECT ON core.practice_fields TO qigong_venue_manager;
GRANT SELECT(id,parent_region_id,region_type,active) ON core.regions TO qigong_venue_manager;
GRANT INSERT(region_id,code,name_zh_tw,name_en,address,latitude,longitude,radius_meters,timezone,active_time_rules,is_active),
  UPDATE(region_id,name_zh_tw,name_en,address,latitude,longitude,radius_meters,timezone,active_time_rules,is_active,version,updated_at)
  ON core.practice_fields TO qigong_venue_manager;
GRANT SELECT(id,code,name_zh_tw,is_active,timezone) ON core.practice_fields TO qigong_venue_config_guard;
-- 0051's invoker validation trigger also needs existence-only visibility.
GRANT SELECT(field_id) ON core.field_attendance TO qigong_venue_config_guard, qigong_venue_manager;
GRANT SELECT(token_hash,principal_id,expires_at,revoked_at) ON admin.sessions TO qigong_venue_manager;
GRANT SELECT(principal_id,role_id,scope_type,region_id,valid_from,valid_to) ON admin.role_grants TO qigong_venue_manager;
GRANT SELECT(role_id,permission_id) ON admin.role_permissions TO qigong_venue_manager;
GRANT SELECT(id,code) ON admin.permissions TO qigong_venue_manager;
GRANT EXECUTE ON FUNCTION admin.request_id(),admin.request_person_id(),admin.request_principal_id(),
  admin.session_principal(TEXT),admin.can_access_region(UUID,TEXT),admin.venue_attendance_authorized(TEXT,UUID,TEXT)
  TO qigong_venue_manager;
GRANT EXECUTE ON FUNCTION admin.request_principal_id() TO qigong_venue_config_guard;
GRANT INSERT(request_id,actor_principal_id,action,target_type,target_id,scope_type,scope_id,outcome,metadata)
  ON audit.events TO qigong_venue_manager;
CREATE POLICY venue_management_grants ON admin.role_grants FOR SELECT TO qigong_venue_manager
  USING(principal_id=admin.request_principal_id());
CREATE POLICY venue_management_permission ON admin.permissions FOR SELECT TO qigong_venue_manager
  USING(code='venue_attendance.field.manage');
CREATE POLICY venue_management_role_permissions ON admin.role_permissions FOR SELECT TO qigong_venue_manager
  USING(EXISTS(SELECT 1 FROM admin.permissions p WHERE p.id=permission_id));
CREATE POLICY venue_management_session ON admin.sessions FOR SELECT TO qigong_venue_manager
  USING(principal_id=admin.request_principal_id());
CREATE POLICY venue_management_read ON core.practice_fields FOR SELECT TO qigong_venue_manager
  USING(admin.can_access_region(region_id,'checkin.read') OR admin.can_access_region(region_id,'venue_attendance.field.read')
    OR admin.can_access_region(region_id,'venue_attendance.field.manage'));
CREATE POLICY venue_management_create ON core.practice_fields FOR INSERT TO qigong_venue_manager
  WITH CHECK(admin.can_access_region(region_id,'venue_attendance.field.manage'));
-- Replace only 0051's universal UPDATE veto. All other current/future roles remain
-- vetoed; DELETE and all attendance UPDATE/DELETE policies remain byte-for-byte intact.
ALTER POLICY venue_fields_no_update ON core.practice_fields
  USING(current_user='qigong_venue_manager') WITH CHECK(current_user='qigong_venue_manager');
CREATE POLICY venue_management_update ON core.practice_fields FOR UPDATE TO qigong_venue_manager
  USING(admin.can_access_region(region_id,'venue_attendance.field.manage'))
  WITH CHECK(admin.can_access_region(region_id,'venue_attendance.field.manage'));
CREATE POLICY venue_management_guard_fields ON core.practice_fields FOR SELECT TO qigong_venue_config_guard USING(TRUE);
CREATE POLICY venue_management_guard_attendance ON core.field_attendance FOR SELECT TO qigong_venue_config_guard USING(TRUE);
CREATE POLICY venue_management_attendance_existence ON core.field_attendance FOR SELECT TO qigong_venue_manager
  USING(EXISTS(SELECT 1 FROM core.practice_fields f WHERE f.id=field_id));
CREATE POLICY venue_management_audit ON audit.events FOR INSERT TO qigong_venue_manager
  WITH CHECK(request_id=admin.request_id() AND actor_principal_id=admin.request_principal_id()
    AND outcome='success' AND action IN ('venue.management.create','venue.management.update','venue.management.read'));

-- Guard does not own either table; it can see only the existence of attendance.
-- Same advisory lock in attendance INSERT and management UPDATE closes the
-- first-attendance/region-timezone race without changing the 0051 QR function.
CREATE FUNCTION core.guard_venue_management() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE f RECORD;
BEGIN
  IF TG_TABLE_NAME='field_attendance' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('venue-config:'||NEW.field_id::text,0));
    SELECT timezone,is_active INTO STRICT f FROM core.practice_fields WHERE id=NEW.field_id;
    IF NOT f.is_active OR NEW.attendance_timezone IS DISTINCT FROM f.timezone
      OR NEW.attendance_date IS DISTINCT FROM (NEW.checkin_at AT TIME ZONE f.timezone)::date THEN
      RAISE EXCEPTION 'venue_configuration_changed' USING ERRCODE='40001';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'venue_delete_forbidden' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('venue-config:'||OLD.id::text,0));
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'venue_identity_immutable' USING ERRCODE='22023';
  END IF;
  IF (NEW.region_id IS DISTINCT FROM OLD.region_id OR NEW.timezone IS DISTINCT FROM OLD.timezone)
    AND EXISTS(SELECT 1 FROM core.field_attendance WHERE field_id=OLD.id) THEN
    RAISE EXCEPTION 'venue_region_timezone_frozen' USING ERRCODE='40001';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION core.guard_venue_management() OWNER TO qigong_venue_config_guard;
CREATE TRIGGER a_venue_management_identity BEFORE UPDATE OR DELETE ON core.practice_fields
  FOR EACH ROW EXECUTE FUNCTION core.guard_venue_management();
CREATE TRIGGER venue_management_attendance_guard BEFORE INSERT ON core.field_attendance
  FOR EACH ROW EXECUTE FUNCTION core.guard_venue_management();

CREATE FUNCTION admin.venue_management(input_session TEXT,input_action TEXT,input_region UUID,input_id UUID,input_version INTEGER,input_data JSONB,input_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
DECLARE principal UUID; before_row core.practice_fields%ROWTYPE; after_row core.practice_fields%ROWTYPE;
  data JSONB; writable BOOLEAN; target_region UUID;
BEGIN
  principal:=admin.session_principal(input_session);
  IF principal IS NULL OR principal IS DISTINCT FROM admin.request_principal_id() OR admin.request_id() IS NULL
    OR admin.request_person_id() IS NOT NULL THEN RAISE EXCEPTION 'venue_forbidden' USING ERRCODE='42501'; END IF;
  IF input_region IS NULL OR input_action IS NULL OR input_action NOT IN ('list','get','capabilities','create','update') THEN
    RAISE EXCEPTION 'venue_invalid' USING ERRCODE='22023'; END IF;
  writable:=admin.venue_attendance_authorized(input_session,input_region,'field.write');
  IF NOT (writable OR admin.can_access_region(input_region,'checkin.read')
    OR admin.venue_attendance_authorized(input_session,input_region,'field.read')) THEN
    RAISE EXCEPTION 'venue_forbidden' USING ERRCODE='42501'; END IF;
  IF input_action IN ('create','update') THEN
    IF NOT writable THEN RAISE EXCEPTION 'venue_forbidden' USING ERRCODE='42501'; END IF;
    IF input_data IS NULL OR jsonb_typeof(input_data) IS DISTINCT FROM 'object'
      OR NOT(input_data ?& ARRAY['region_id','code','name_zh_tw','name_en','address','latitude','longitude','radius_meters','timezone','active_time_rules','is_active'])
      OR (input_data-ARRAY['region_id','code','name_zh_tw','name_en','address','latitude','longitude','radius_meters','timezone','active_time_rules','is_active'])<>'{}'::jsonb
      OR jsonb_typeof(input_data->'name_zh_tw') IS DISTINCT FROM 'string'
      OR jsonb_typeof(input_data->'address') IS DISTINCT FROM 'string'
      OR jsonb_typeof(input_data->'timezone') IS DISTINCT FROM 'string'
      OR jsonb_typeof(input_data->'code') IS DISTINCT FROM 'string'
      OR jsonb_typeof(input_data->'region_id') IS DISTINCT FROM 'string'
      OR jsonb_typeof(input_data->'name_en') NOT IN ('string','null')
      OR jsonb_typeof(input_data->'latitude') IS DISTINCT FROM 'number'
      OR jsonb_typeof(input_data->'longitude') IS DISTINCT FROM 'number'
      OR jsonb_typeof(input_data->'radius_meters') IS DISTINCT FROM 'number'
      OR jsonb_typeof(input_data->'is_active') IS DISTINCT FROM 'boolean'
      OR length(coalesce(btrim(input_reason),'')) NOT BETWEEN 1 AND 500
      OR length(coalesce(input_data->>'name_en',''))>120 THEN
      RAISE EXCEPTION 'venue_invalid' USING ERRCODE='22023'; END IF;
    target_region:=(input_data->>'region_id')::uuid;
    IF NOT admin.venue_attendance_authorized(input_session,target_region,'field.write') THEN
      RAISE EXCEPTION 'venue_forbidden' USING ERRCODE='42501'; END IF;
    IF input_action='update' THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('venue-config:'||input_id::text,0));
      SELECT * INTO before_row FROM core.practice_fields WHERE id=input_id AND region_id=input_region FOR UPDATE;
      IF before_row.id IS NULL THEN RAISE EXCEPTION 'venue_not_found' USING ERRCODE='P0002'; END IF;
      IF input_version IS NULL OR before_row.version<>input_version THEN RAISE EXCEPTION 'venue_version_conflict' USING ERRCODE='40001'; END IF;
      IF before_row.code IS DISTINCT FROM input_data->>'code' THEN RAISE EXCEPTION 'venue_identity_immutable' USING ERRCODE='22023'; END IF;
    ELSIF target_region<>input_region OR input_id IS NOT NULL OR input_version IS NOT NULL THEN
      RAISE EXCEPTION 'venue_invalid' USING ERRCODE='22023';
    END IF;
    -- Revalidate the real credential, wall-clock expiration and both scopes AFTER locks.
    IF admin.session_principal(input_session) IS DISTINCT FROM principal
      OR NOT EXISTS(SELECT 1 FROM admin.sessions WHERE token_hash=public.digest(input_session,'sha256')
        AND principal_id=principal AND revoked_at IS NULL AND expires_at>clock_timestamp())
      OR NOT admin.venue_attendance_authorized(input_session,input_region,'field.write')
      OR NOT admin.venue_attendance_authorized(input_session,target_region,'field.write')
      OR EXISTS(SELECT 1 FROM core.regions target WHERE target.id IN (input_region,target_region)
        AND NOT EXISTS(SELECT 1 FROM admin.role_grants g
          JOIN admin.role_permissions rp ON rp.role_id=g.role_id
          JOIN admin.permissions p ON p.id=rp.permission_id AND p.code='venue_attendance.field.manage'
          WHERE g.principal_id=principal AND g.valid_from<=clock_timestamp()
            AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp())
            AND (g.scope_type='global' OR (g.scope_type='region' AND g.region_id=target.id)
              OR (g.scope_type='country' AND g.region_id=target.parent_region_id)))) THEN
      RAISE EXCEPTION 'venue_forbidden' USING ERRCODE='42501'; END IF;
    IF input_action='create' THEN
      INSERT INTO core.practice_fields(region_id,code,name_zh_tw,name_en,address,latitude,longitude,radius_meters,timezone,active_time_rules,is_active)
      VALUES(target_region,input_data->>'code',input_data->>'name_zh_tw',input_data->>'name_en',input_data->>'address',
        (input_data->>'latitude')::numeric,(input_data->>'longitude')::numeric,(input_data->>'radius_meters')::integer,
        input_data->>'timezone',input_data->'active_time_rules',(input_data->>'is_active')::boolean) RETURNING * INTO after_row;
    ELSE
      UPDATE core.practice_fields SET region_id=target_region,name_zh_tw=input_data->>'name_zh_tw',name_en=input_data->>'name_en',address=input_data->>'address',
        latitude=(input_data->>'latitude')::numeric,longitude=(input_data->>'longitude')::numeric,radius_meters=(input_data->>'radius_meters')::integer,
        timezone=input_data->>'timezone',active_time_rules=input_data->'active_time_rules',is_active=(input_data->>'is_active')::boolean,
        version=version+1,updated_at=clock_timestamp() WHERE id=input_id RETURNING * INTO after_row;
    END IF;
    data:=jsonb_build_object('field',to_jsonb(after_row));
  ELSIF input_action='capabilities' THEN data:=jsonb_build_object('canRead',TRUE,'canManage',writable);
  ELSIF input_action='get' THEN
    SELECT jsonb_build_object('field',to_jsonb(f)) INTO data FROM core.practice_fields f WHERE id=input_id AND region_id=input_region;
    IF data IS NULL THEN RAISE EXCEPTION 'venue_not_found' USING ERRCODE='P0002'; END IF;
  ELSE
    SELECT jsonb_build_object('fields',coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.code),'[]'::jsonb)) INTO data
      FROM core.practice_fields f WHERE region_id=input_region;
  END IF;
  INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,scope_type,scope_id,outcome,metadata)
    VALUES(admin.request_id(),principal,'venue.management.'||CASE WHEN input_action IN ('create','update') THEN input_action ELSE 'read' END,
      'practice_field',coalesce(after_row.id,input_id)::text,'region',input_region,'success',
      CASE WHEN input_action IN ('create','update') THEN jsonb_build_object('reason',input_reason,'before',to_jsonb(before_row),'after',to_jsonb(after_row))
      ELSE jsonb_build_object('operation',input_action) END);
  RETURN data;
END $$;
ALTER FUNCTION admin.venue_management(TEXT,TEXT,UUID,UUID,INTEGER,JSONB,TEXT) OWNER TO qigong_venue_manager;

-- Trusted public lookup contract; only the runtime may invoke it. Inactive codes
-- still resolve, so the parent's public page can explicitly show disabled venues.
CREATE FUNCTION admin.venue_management_lookup(input_code TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
  SELECT jsonb_build_object('code',code,'name',name_zh_tw,'active',is_active)
  FROM core.practice_fields WHERE code=input_code
$$;
ALTER FUNCTION admin.venue_management_lookup(TEXT) OWNER TO qigong_venue_config_guard;
DO $$ DECLARE f RECORD; g RECORD; BEGIN
  FOR f IN SELECT p.oid,p.proowner,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=ANY(ARRAY[
      'core.guard_venue_management()'::regprocedure,'admin.venue_management(text,text,uuid,uuid,integer,jsonb,text)'::regprocedure,
      'admin.venue_management_lookup(text)'::regprocedure]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC CASCADE',f.nspname,f.proname,f.args);
    FOR g IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee
      WHERE p.oid=f.oid AND a.grantee<>f.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM %I CASCADE',f.nspname,f.proname,f.args,g.rolname);
    END LOOP;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION admin.venue_management(TEXT,TEXT,UUID,UUID,INTEGER,JSONB,TEXT),admin.venue_management_lookup(TEXT) TO qigong_api_runtime;
