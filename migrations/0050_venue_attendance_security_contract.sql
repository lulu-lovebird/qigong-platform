-- 團練場出席管理: controlled identity and authorization contract; NOT an NFC unlock.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
-- Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
-- Forward only. 0048 policies/ACLs and both quarantined tables remain untouched.
SET LOCAL search_path = pg_catalog;

-- A dedicated function owner, never a table owner or a runtime membership.
-- Refuse an existing privileged role rather than silently adopting/repairing it.
DO $$
DECLARE resolver_role OID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qigong_venue_identity') THEN
    CREATE ROLE qigong_venue_identity NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  SELECT oid INTO resolver_role FROM pg_catalog.pg_roles
  WHERE rolname = 'qigong_venue_identity'
    AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls
    AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication;
  IF resolver_role IS NULL OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = resolver_role OR member = resolver_role
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_shdepend
    WHERE refclassid = 'pg_catalog.pg_authid'::pg_catalog.regclass
      AND refobjid = resolver_role AND deptype IN ('a', 'o')
  ) THEN
    RAISE EXCEPTION 'unsafe venue identity function owner';
  END IF;
END;
$$ LANGUAGE plpgsql;

GRANT USAGE ON SCHEMA identity, platform TO qigong_venue_identity;
GRANT SELECT (id, status) ON identity.people TO qigong_venue_identity;
GRANT SELECT (id, person_id, platform, external_subject_id, revoked_at, verified_at)
  ON identity.platform_identities TO qigong_venue_identity;
GRANT SELECT (person_id, platform_identity_id, valid_from, valid_to)
  ON identity.person_interaction_channels TO qigong_venue_identity;
GRANT SELECT (person_id, platform, external_subject_id, status)
  ON identity.onboarding_applications TO qigong_venue_identity;

-- Explicit RLS, not ownership/BYPASSRLS. No profile/contact columns are granted.
CREATE POLICY venue_identity_active_person ON identity.people
FOR SELECT TO qigong_venue_identity USING (status = 'active');
CREATE POLICY venue_identity_active_line ON identity.platform_identities
FOR SELECT TO qigong_venue_identity
USING (platform = 'line' AND revoked_at IS NULL AND verified_at <= CURRENT_TIMESTAMP);
CREATE POLICY venue_identity_active_channel ON identity.person_interaction_channels
FOR SELECT TO qigong_venue_identity
USING (valid_from <= CURRENT_TIMESTAMP AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP));
CREATE POLICY venue_identity_approved_application ON identity.onboarding_applications
FOR SELECT TO qigong_venue_identity USING (platform = 'line' AND status = 'approved');

-- Caller MUST first verify LINE issuer/audience/expiry/signature on the server.
-- A subject string is not a credential. This is a snapshot, not attendance authority.
CREATE FUNCTION platform.resolve_line_learner_identity(input_subject TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $$
  SELECT pg_catalog.jsonb_build_object(
    'subject', linked.external_subject_id, 'identityId', linked.id, 'personId', person.id,
    'revoked', FALSE, 'learnerActive', TRUE, 'channelActive', TRUE, 'applicationApproved', TRUE
  )
  FROM identity.platform_identities AS linked
  JOIN identity.people AS person ON person.id = linked.person_id AND person.status = 'active'
  JOIN identity.onboarding_applications AS application ON application.person_id = person.id
    AND application.platform = 'line' AND application.external_subject_id = input_subject
    AND application.status = 'approved'
  WHERE input_subject ~ '^U[0-9a-f]{32}$'
    AND linked.platform = 'line' AND linked.external_subject_id = input_subject
    AND linked.revoked_at IS NULL AND linked.verified_at <= CURRENT_TIMESTAMP
    AND EXISTS (
      SELECT 1 FROM identity.person_interaction_channels AS channel
      WHERE channel.person_id = person.id AND channel.platform_identity_id = linked.id
        AND channel.valid_from <= CURRENT_TIMESTAMP
        AND (channel.valid_to IS NULL OR channel.valid_to > CURRENT_TIMESTAMP)
    )
$$;
ALTER FUNCTION platform.resolve_line_learner_identity(TEXT) OWNER TO qigong_venue_identity;

-- Separate permissions in the existing RBAC model. Do not silently promote any role,
-- including super_admin/master_admin, or reuse daily-practice/private-note permissions.
INSERT INTO admin.permissions (code, description) VALUES
  ('venue_attendance.field.read', '團練場出席管理：讀取場地'),
  ('venue_attendance.field.manage', '團練場出席管理：管理場地'),
  ('venue_attendance.attendance.read', '團練場出席管理：查詢出席'),
  ('venue_attendance.attendance.export', '團練場出席管理：匯出出席')
ON CONFLICT (code) DO NOTHING;

-- Positive result is only a scoped RBAC precondition, never table/feature readiness.
-- Recheck the actual session credential on EVERY operation. Forged principal/person
-- GUCs alone cannot satisfy this contract. No learner self-read branch is used.
CREATE FUNCTION admin.venue_attendance_authorized(
  input_session_token TEXT, input_region_id UUID, input_operation TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog AS $$
DECLARE session_principal UUID; required_permission TEXT;
BEGIN
  IF input_session_token IS NULL OR pg_catalog.length(input_session_token) NOT BETWEEN 32 AND 128
    OR input_region_id IS NULL OR admin.request_id() IS NULL
    OR admin.request_person_id() IS NOT NULL THEN RETURN FALSE; END IF;
  session_principal := admin.session_principal(input_session_token);
  IF session_principal IS NULL
    OR admin.request_principal_id() IS DISTINCT FROM session_principal THEN RETURN FALSE; END IF;
  required_permission := CASE input_operation
    WHEN 'field.read' THEN 'venue_attendance.field.read'
    WHEN 'field.write' THEN 'venue_attendance.field.manage'
    WHEN 'attendance.read' THEN 'venue_attendance.attendance.read'
    WHEN 'attendance.export' THEN 'venue_attendance.attendance.export'
    ELSE NULL END;
  IF required_permission IS NULL THEN RETURN FALSE; END IF;
  RETURN EXISTS (
    SELECT 1 FROM core.regions AS operational
    JOIN core.regions AS country ON country.id = operational.parent_region_id
      AND country.region_type = 'country' AND country.active
    JOIN core.regions AS global_region ON global_region.id = country.parent_region_id
      AND global_region.region_type = 'global' AND global_region.active
    WHERE operational.id = input_region_id AND operational.region_type = 'operational'
      AND operational.active
      AND admin.can_access_region(operational.id, required_permission)
  );
END;
$$;

-- These are intentionally executable denial contracts, not fake successful CRUD.
-- An authorized caller still receives SQLSTATE 55000. No table SELECT/DML happens.
CREATE FUNCTION admin.venue_attendance_read_fields(input_session_token TEXT, input_region_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT admin.venue_attendance_authorized(input_session_token, input_region_id, 'field.read') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'venue_attendance_forbidden';
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'venue_attendance_quarantined';
END;
$$;

-- Initial write contract is metadata-only, update-only, with no region move/create.
-- field_id is a resource selector, NEVER a claim that it belongs to input_region_id.
-- A later reviewed implementation must resolve/lock the row and check its region.
CREATE FUNCTION admin.venue_attendance_write_field(
  input_session_token TEXT, input_region_id UUID, input_field_id UUID, input_change JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT admin.venue_attendance_authorized(input_session_token, input_region_id, 'field.write') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'venue_attendance_forbidden';
  END IF;
  IF input_field_id IS NULL OR input_change IS NULL
    OR pg_catalog.jsonb_typeof(input_change) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'venue_attendance_invalid_input';
  END IF;
  IF NOT (input_change ?& ARRAY['nameZhTw', 'isActive'])
    OR (input_change - ARRAY['nameZhTw', 'isActive']) <> '{}'::pg_catalog.jsonb
    OR pg_catalog.jsonb_typeof(input_change -> 'nameZhTw') IS DISTINCT FROM 'string'
    OR pg_catalog.jsonb_typeof(input_change -> 'isActive') IS DISTINCT FROM 'boolean'
    OR pg_catalog.length(pg_catalog.btrim(input_change ->> 'nameZhTw')) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'venue_attendance_invalid_input';
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'venue_attendance_quarantined';
END;
$$;

-- Half-open Asia/Taipei date interval; export has its own permission, not read fallback.
CREATE FUNCTION admin.venue_attendance_read_attendance(
  input_session_token TEXT, input_region_id UUID, input_from DATE, input_until DATE, input_export BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT admin.venue_attendance_authorized(input_session_token, input_region_id,
    CASE WHEN input_export THEN 'attendance.export' ELSE 'attendance.read' END) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'venue_attendance_forbidden';
  END IF;
  IF input_from IS NULL OR input_until IS NULL OR input_export IS NULL
    OR NOT pg_catalog.isfinite(input_from) OR NOT pg_catalog.isfinite(input_until)
    OR input_until <= input_from OR input_until - input_from > 366 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'venue_attendance_invalid_input';
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'venue_attendance_quarantined';
END;
$$;

-- Remove PUBLIC and arbitrary default-ACL grants on precisely these new functions,
-- including direct session EXECUTE. Leave unrelated functions/default ACLs untouched.
DO $$
DECLARE target RECORD; privilege_grant RECORD;
BEGIN
  FOR target IN
    SELECT routine.oid, routine.proowner, namespace.nspname, routine.proname,
      pg_catalog.pg_get_function_identity_arguments(routine.oid) AS arguments
    FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE routine.oid = ANY (ARRAY[
      'platform.resolve_line_learner_identity(text)'::pg_catalog.regprocedure,
      'admin.venue_attendance_authorized(text,uuid,text)'::pg_catalog.regprocedure,
      'admin.venue_attendance_read_fields(text,uuid)'::pg_catalog.regprocedure,
      'admin.venue_attendance_write_field(text,uuid,uuid,jsonb)'::pg_catalog.regprocedure,
      'admin.venue_attendance_read_attendance(text,uuid,date,date,boolean)'::pg_catalog.regprocedure
    ])
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC CASCADE',
      target.nspname, target.proname, target.arguments);
    FOR privilege_grant IN
      SELECT DISTINCT role.rolname FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) AS acl
      JOIN pg_catalog.pg_roles AS role ON role.oid = acl.grantee
      WHERE routine.oid = target.oid AND acl.grantee <> target.proowner
    LOOP
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM %I CASCADE',
        target.nspname, target.proname, target.arguments, privilege_grant.rolname);
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION platform.resolve_line_learner_identity(TEXT),
  admin.venue_attendance_authorized(TEXT, UUID, TEXT),
  admin.venue_attendance_read_fields(TEXT, UUID),
  admin.venue_attendance_write_field(TEXT, UUID, UUID, JSONB),
  admin.venue_attendance_read_attendance(TEXT, UUID, DATE, DATE, BOOLEAN)
TO qigong_api_runtime;
-- No grants/policies on practice_fields/field_attendance, no attendance insertion,
-- raw learner GPS, notes, daily-practice links, migration-readiness or gate changes.
