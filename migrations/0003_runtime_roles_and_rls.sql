DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qigong_api_runtime') THEN
    CREATE ROLE qigong_api_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qigong_worker_runtime') THEN
    CREATE ROLE qigong_worker_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qigong_authorizer') THEN
    CREATE ROLE qigong_authorizer NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_shdepend dependency
    JOIN pg_roles controlled_role ON controlled_role.oid = dependency.refobjid
    WHERE dependency.refclassid = 'pg_authid'::regclass
      AND controlled_role.rolname IN ('qigong_api_runtime', 'qigong_worker_runtime', 'qigong_authorizer')
      AND dependency.deptype IN ('a', 'o')
  ) THEN
    RAISE EXCEPTION 'qigong controlled roles must not retain object ownership or ACL dependencies';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members membership
    JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
    JOIN pg_roles member_role ON member_role.oid = membership.member
    WHERE granted_role.rolname IN ('qigong_api_runtime', 'qigong_worker_runtime', 'qigong_authorizer')
       OR member_role.rolname IN ('qigong_api_runtime', 'qigong_worker_runtime', 'qigong_authorizer')
  ) THEN
    RAISE EXCEPTION 'qigong controlled roles must have no memberships before migration';
  END IF;
END;
$$;

ALTER ROLE qigong_api_runtime
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOLOGIN NOINHERIT;
ALTER ROLE qigong_worker_runtime
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOLOGIN NOINHERIT;
ALTER ROLE qigong_authorizer
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOLOGIN NOINHERIT;

DROP TRIGGER validate_region_transfer_endpoints ON core.region_transfer_requests;
DROP TRIGGER validate_primary_assignment_region ON core.person_region_assignments;
DROP TRIGGER validate_cohort_region ON core.cohorts;
DROP FUNCTION core.validate_operational_regions();

CREATE FUNCTION core.validate_region_transfer_endpoints()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_type TEXT;
  destination_type TEXT;
BEGIN
  SELECT region_type INTO source_type FROM core.regions WHERE id = NEW.source_region_id AND active;
  SELECT region_type INTO destination_type FROM core.regions WHERE id = NEW.destination_region_id AND active;
  IF source_type IS DISTINCT FROM 'operational' OR destination_type IS DISTINCT FROM 'operational' THEN
    RAISE EXCEPTION 'region transfer endpoints must be active operational regions';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION core.validate_primary_assignment_region()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  region_type_value TEXT;
BEGIN
  IF NEW.assignment_type = 'primary' THEN
    SELECT region_type INTO region_type_value FROM core.regions WHERE id = NEW.region_id AND active;
    IF region_type_value IS DISTINCT FROM 'operational' THEN
      RAISE EXCEPTION 'primary assignment requires an active operational region';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION core.validate_cohort_region()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  region_type_value TEXT;
BEGIN
  SELECT region_type INTO region_type_value FROM core.regions WHERE id = NEW.region_id AND active;
  IF region_type_value IS DISTINCT FROM 'operational' THEN
    RAISE EXCEPTION 'cohort requires an active operational region';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_region_transfer_endpoints
BEFORE INSERT OR UPDATE OF source_region_id, destination_region_id
ON core.region_transfer_requests
FOR EACH ROW EXECUTE FUNCTION core.validate_region_transfer_endpoints();

CREATE TRIGGER validate_primary_assignment_region
BEFORE INSERT OR UPDATE OF region_id, assignment_type
ON core.person_region_assignments
FOR EACH ROW EXECUTE FUNCTION core.validate_primary_assignment_region();

CREATE TRIGGER validate_cohort_region
BEFORE INSERT OR UPDATE OF region_id
ON core.cohorts
FOR EACH ROW EXECUTE FUNCTION core.validate_cohort_region();

REVOKE ALL ON SCHEMA identity, core, platform, ops, admin, audit, reporting FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA identity, core, platform, ops, admin, audit, reporting FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA identity, core, platform, ops, admin, audit, reporting FROM PUBLIC;

GRANT USAGE ON SCHEMA identity, core, admin, audit TO qigong_api_runtime;
GRANT USAGE ON SCHEMA identity, core, platform, ops, audit TO qigong_worker_runtime;
GRANT USAGE ON SCHEMA identity, core, admin TO qigong_authorizer;

GRANT SELECT ON
  identity.people,
  identity.platform_identities,
  identity.person_interaction_channels,
  core.regions,
  core.person_region_assignments,
  core.cohorts,
  core.cohort_memberships,
  core.region_transfer_requests,
  admin.principals,
  admin.roles,
  admin.permissions,
  admin.role_permissions,
  admin.role_grants,
  admin.privacy_cases
TO qigong_api_runtime;

GRANT SELECT ON
  identity.people,
  identity.platform_identities,
  identity.person_interaction_channels,
  core.regions,
  core.person_region_assignments,
  core.cohorts,
  core.cohort_memberships
TO qigong_worker_runtime;

GRANT SELECT ON
  core.regions,
  core.person_region_assignments,
  core.cohort_memberships,
  core.region_transfer_requests,
  admin.principals,
  admin.roles,
  admin.permissions,
  admin.role_permissions,
  admin.role_grants,
  admin.privacy_cases
TO qigong_authorizer;

CREATE FUNCTION admin.request_person_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('qigong.person_id', TRUE), '')::uuid
$$;

CREATE FUNCTION admin.request_principal_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('qigong.principal_id', TRUE), '')::uuid
$$;

CREATE FUNCTION admin.request_id()
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $$
  SELECT NULLIF(current_setting('qigong.request_id', TRUE), '')::uuid
$$;

CREATE FUNCTION admin.has_permission(required_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM admin.role_grants grant_record
    JOIN admin.principals principal ON principal.id = grant_record.principal_id
    JOIN admin.role_permissions role_permission ON role_permission.role_id = grant_record.role_id
    JOIN admin.permissions permission ON permission.id = role_permission.permission_id
    WHERE grant_record.principal_id = admin.request_principal_id()
      AND principal.status = 'active'
      AND permission.code = required_permission
      AND grant_record.valid_from <= CURRENT_TIMESTAMP
      AND (grant_record.valid_to IS NULL OR grant_record.valid_to > CURRENT_TIMESTAMP)
  )
$$;

CREATE FUNCTION admin.can_access_person(target_person_id UUID, required_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    target_person_id = admin.request_person_id()
    OR EXISTS (
      SELECT 1
      FROM admin.role_grants grant_record
      JOIN admin.principals principal ON principal.id = grant_record.principal_id
      JOIN admin.role_permissions role_permission ON role_permission.role_id = grant_record.role_id
      JOIN admin.permissions permission ON permission.id = role_permission.permission_id
      WHERE grant_record.principal_id = admin.request_principal_id()
        AND principal.status = 'active'
        AND permission.code = required_permission
        AND grant_record.valid_from <= CURRENT_TIMESTAMP
        AND (grant_record.valid_to IS NULL OR grant_record.valid_to > CURRENT_TIMESTAMP)
        AND (
          grant_record.scope_type = 'global'
          OR (
            grant_record.scope_type = 'region'
            AND EXISTS (
              SELECT 1 FROM core.person_region_assignments assignment
              WHERE assignment.person_id = target_person_id
                AND assignment.region_id = grant_record.region_id
                AND assignment.assignment_type = 'primary'
                AND assignment.valid_from <= CURRENT_DATE
                AND (assignment.valid_to IS NULL OR assignment.valid_to > CURRENT_DATE)
            )
          )
          OR (
            grant_record.scope_type = 'country'
            AND EXISTS (
              SELECT 1
              FROM core.person_region_assignments assignment
              JOIN core.regions operational ON operational.id = assignment.region_id
              WHERE assignment.person_id = target_person_id
                AND operational.parent_region_id = grant_record.region_id
                AND assignment.assignment_type = 'primary'
                AND assignment.valid_from <= CURRENT_DATE
                AND (assignment.valid_to IS NULL OR assignment.valid_to > CURRENT_DATE)
            )
          )
          OR (
            grant_record.scope_type = 'cohort'
            AND EXISTS (
              SELECT 1 FROM core.cohort_memberships membership
              WHERE membership.person_id = target_person_id
                AND membership.cohort_id = grant_record.cohort_id
                AND membership.valid_from <= CURRENT_DATE
                AND (membership.valid_to IS NULL OR membership.valid_to > CURRENT_DATE)
            )
          )
          OR (
            grant_record.scope_type = 'privacy_case'
            AND EXISTS (
              SELECT 1 FROM admin.privacy_cases privacy_case
              WHERE privacy_case.id = grant_record.privacy_case_id
                AND privacy_case.person_id = target_person_id
                AND privacy_case.status IN ('open', 'in_progress')
            )
          )
        )
    )
$$;

CREATE FUNCTION admin.can_access_region(target_region_id UUID, required_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM admin.role_grants grant_record
    JOIN admin.principals principal ON principal.id = grant_record.principal_id
    JOIN admin.role_permissions role_permission ON role_permission.role_id = grant_record.role_id
    JOIN admin.permissions permission ON permission.id = role_permission.permission_id
    JOIN core.regions target_region ON target_region.id = target_region_id
    WHERE grant_record.principal_id = admin.request_principal_id()
      AND principal.status = 'active'
      AND permission.code = required_permission
      AND grant_record.valid_from <= CURRENT_TIMESTAMP
      AND (grant_record.valid_to IS NULL OR grant_record.valid_to > CURRENT_TIMESTAMP)
      AND (
        grant_record.scope_type = 'global'
        OR (grant_record.scope_type = 'region' AND grant_record.region_id = target_region_id)
        OR (
          grant_record.scope_type = 'country'
          AND target_region.parent_region_id = grant_record.region_id
        )
      )
  )
$$;

CREATE FUNCTION admin.can_access_cohort(target_cohort_id UUID, required_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM admin.role_grants grant_record
    JOIN admin.principals principal ON principal.id = grant_record.principal_id
    JOIN admin.role_permissions role_permission ON role_permission.role_id = grant_record.role_id
    JOIN admin.permissions permission ON permission.id = role_permission.permission_id
    JOIN core.cohorts cohort ON cohort.id = target_cohort_id
    JOIN core.regions operational_region ON operational_region.id = cohort.region_id
    WHERE grant_record.principal_id = admin.request_principal_id()
      AND principal.status = 'active'
      AND permission.code = required_permission
      AND grant_record.valid_from <= CURRENT_TIMESTAMP
      AND (grant_record.valid_to IS NULL OR grant_record.valid_to > CURRENT_TIMESTAMP)
      AND (
        grant_record.scope_type = 'global'
        OR (grant_record.scope_type = 'country' AND grant_record.region_id = operational_region.parent_region_id)
        OR (grant_record.scope_type = 'region' AND grant_record.region_id = cohort.region_id)
        OR (grant_record.scope_type = 'cohort' AND grant_record.cohort_id = target_cohort_id)
      )
  )
$$;

CREATE FUNCTION admin.can_access_privacy_case(target_case_id UUID, required_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM admin.role_grants grant_record
    JOIN admin.principals principal ON principal.id = grant_record.principal_id
    JOIN admin.role_permissions role_permission ON role_permission.role_id = grant_record.role_id
    JOIN admin.permissions permission ON permission.id = role_permission.permission_id
    WHERE grant_record.principal_id = admin.request_principal_id()
      AND principal.status = 'active'
      AND permission.code = required_permission
      AND grant_record.scope_type = 'privacy_case'
      AND grant_record.privacy_case_id = target_case_id
      AND grant_record.valid_from <= CURRENT_TIMESTAMP
      AND (grant_record.valid_to IS NULL OR grant_record.valid_to > CURRENT_TIMESTAMP)
  )
$$;

ALTER FUNCTION admin.has_permission(TEXT) OWNER TO qigong_authorizer;
ALTER FUNCTION admin.can_access_person(UUID, TEXT) OWNER TO qigong_authorizer;
ALTER FUNCTION admin.can_access_region(UUID, TEXT) OWNER TO qigong_authorizer;
ALTER FUNCTION admin.can_access_cohort(UUID, TEXT) OWNER TO qigong_authorizer;
ALTER FUNCTION admin.can_access_privacy_case(UUID, TEXT) OWNER TO qigong_authorizer;

REVOKE ALL ON FUNCTION admin.request_person_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin.request_principal_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin.request_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin.has_permission(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin.can_access_person(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin.can_access_region(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin.can_access_cohort(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin.can_access_privacy_case(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.request_person_id() TO qigong_api_runtime, qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.request_principal_id() TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION admin.request_id() TO qigong_api_runtime, qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.has_permission(TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION admin.can_access_person(UUID, TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION admin.can_access_region(UUID, TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION admin.can_access_cohort(UUID, TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION admin.can_access_privacy_case(UUID, TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION admin.request_person_id() TO qigong_authorizer;
GRANT EXECUTE ON FUNCTION admin.request_principal_id() TO qigong_authorizer;

CREATE POLICY authorizer_region_assignments_read ON core.person_region_assignments
FOR SELECT TO qigong_authorizer USING (TRUE);
CREATE POLICY authorizer_cohort_memberships_read ON core.cohort_memberships
FOR SELECT TO qigong_authorizer USING (TRUE);
CREATE POLICY authorizer_transfer_requests_read ON core.region_transfer_requests
FOR SELECT TO qigong_authorizer USING (TRUE);
CREATE POLICY authorizer_principals_read ON admin.principals
FOR SELECT TO qigong_authorizer USING (TRUE);
CREATE POLICY authorizer_roles_read ON admin.roles
FOR SELECT TO qigong_authorizer USING (TRUE);
CREATE POLICY authorizer_permissions_read ON admin.permissions
FOR SELECT TO qigong_authorizer USING (TRUE);
CREATE POLICY authorizer_role_permissions_read ON admin.role_permissions
FOR SELECT TO qigong_authorizer USING (TRUE);
CREATE POLICY authorizer_role_grants_read ON admin.role_grants
FOR SELECT TO qigong_authorizer USING (TRUE);
CREATE POLICY authorizer_privacy_cases_read ON admin.privacy_cases
FOR SELECT TO qigong_authorizer USING (TRUE);

CREATE POLICY people_self_or_scoped_read ON identity.people
FOR SELECT TO qigong_api_runtime
USING (admin.can_access_person(id, 'learner.read'));

CREATE POLICY platform_identities_self_or_scoped_read ON identity.platform_identities
FOR SELECT TO qigong_api_runtime
USING (admin.can_access_person(person_id, 'learner.read'));

CREATE POLICY interaction_channels_self_or_scoped_read ON identity.person_interaction_channels
FOR SELECT TO qigong_api_runtime
USING (admin.can_access_person(person_id, 'learner.read'));

CREATE POLICY region_assignments_self_or_scoped_read ON core.person_region_assignments
FOR SELECT TO qigong_api_runtime
USING (
  person_id = admin.request_person_id()
  OR admin.can_access_region(region_id, 'learner.read')
);

CREATE POLICY cohort_memberships_self_or_scoped_read ON core.cohort_memberships
FOR SELECT TO qigong_api_runtime
USING (
  person_id = admin.request_person_id()
  OR admin.can_access_cohort(cohort_id, 'learner.read')
);

CREATE POLICY transfer_requests_self_or_scoped_read ON core.region_transfer_requests
FOR SELECT TO qigong_api_runtime
USING (
  person_id = admin.request_person_id()
  OR admin.can_access_region(source_region_id, 'learner.read')
  OR admin.can_access_region(destination_region_id, 'learner.read')
);

CREATE POLICY privacy_cases_explicit_scope_read ON admin.privacy_cases
FOR SELECT TO qigong_api_runtime
USING (
  person_id = admin.request_person_id()
  OR admin.can_access_privacy_case(id, 'privacy.export')
);

CREATE POLICY principals_self_read ON admin.principals
FOR SELECT TO qigong_api_runtime
USING (id = admin.request_principal_id());

CREATE POLICY role_grants_self_read ON admin.role_grants
FOR SELECT TO qigong_api_runtime
USING (principal_id = admin.request_principal_id());

CREATE POLICY roles_for_authenticated_principal_read ON admin.roles
FOR SELECT TO qigong_api_runtime
USING (admin.request_principal_id() IS NOT NULL);

CREATE POLICY permissions_for_authenticated_principal_read ON admin.permissions
FOR SELECT TO qigong_api_runtime
USING (admin.request_principal_id() IS NOT NULL);

CREATE POLICY role_permissions_for_authenticated_principal_read ON admin.role_permissions
FOR SELECT TO qigong_api_runtime
USING (admin.request_principal_id() IS NOT NULL);

UPDATE core.platform_metadata
SET architecture_version = 'phase-2-runtime-rls', updated_at = CURRENT_TIMESTAMP
WHERE singleton = TRUE;
