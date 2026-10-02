ALTER TABLE identity.people
  ALTER COLUMN website_issuer DROP NOT NULL,
  ALTER COLUMN website_subject DROP NOT NULL;
ALTER TABLE identity.people ALTER COLUMN legal_name DROP NOT NULL;
ALTER TABLE identity.people ADD CONSTRAINT website_identity_pair CHECK (
  (website_issuer IS NULL) = (website_subject IS NULL)
);

CREATE TABLE identity.onboarding_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('line', 'telegram', 'whatsapp')),
  external_subject_id TEXT NOT NULL,
  display_name TEXT,
  requested_region_id UUID REFERENCES core.regions(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  decided_by_principal_id UUID REFERENCES admin.principals(id),
  decided_at TIMESTAMPTZ,
  person_id UUID UNIQUE REFERENCES identity.people(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (platform, external_subject_id),
  CHECK (length(trim(external_subject_id)) > 0),
  CHECK (status <> 'approved' OR length(trim(display_name)) > 0),
  CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_by_principal_id IS NULL
      AND person_id IS NULL AND rejection_reason IS NULL)
    OR (status = 'approved' AND decided_at IS NOT NULL AND decided_by_principal_id IS NOT NULL
      AND person_id IS NOT NULL AND rejection_reason IS NULL AND requested_region_id IS NOT NULL)
    OR (status = 'rejected' AND decided_at IS NOT NULL AND decided_by_principal_id IS NOT NULL
      AND person_id IS NULL AND length(trim(rejection_reason)) > 0)
  )
);

CREATE FUNCTION identity.validate_application_region() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requested_region_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM core.regions
    WHERE id = NEW.requested_region_id AND region_type = 'operational' AND active
  ) THEN
    RAISE EXCEPTION 'application region must be active and operational';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_application_region
BEFORE INSERT OR UPDATE OF requested_region_id ON identity.onboarding_applications
FOR EACH ROW EXECUTE FUNCTION identity.validate_application_region();

CREATE TABLE core.practice_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  parent_id UUID REFERENCES core.practice_methods(id),
  method_type TEXT NOT NULL CHECK (method_type IN ('group', 'leaf')),
  name_zh_tw TEXT NOT NULL,
  name_en TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE TABLE core.practice_method_platforms (
  practice_method_id UUID NOT NULL REFERENCES core.practice_methods(id),
  platform TEXT NOT NULL CHECK (platform IN ('line', 'telegram', 'whatsapp')),
  available BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (practice_method_id, platform)
);

CREATE TABLE core.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE core.course_methods (
  course_id UUID NOT NULL REFERENCES core.courses(id),
  practice_method_id UUID NOT NULL REFERENCES core.practice_methods(id),
  PRIMARY KEY (course_id, practice_method_id)
);
CREATE TABLE core.person_course_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES identity.people(id),
  course_id UUID NOT NULL REFERENCES core.courses(id),
  status TEXT NOT NULL CHECK (status IN ('enrolled', 'completed', 'cancelled')),
  recorded_by_principal_id UUID NOT NULL REFERENCES admin.principals(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (person_id, course_id)
);

CREATE TABLE core.person_method_visibility (
  person_id UUID NOT NULL REFERENCES identity.people(id),
  practice_method_id UUID NOT NULL REFERENCES core.practice_methods(id),
  visible BOOLEAN NOT NULL,
  set_by_principal_id UUID NOT NULL REFERENCES admin.principals(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (person_id, practice_method_id)
);

INSERT INTO admin.permissions (code, description) VALUES
  ('onboarding.review', 'Approve or reject regional messaging applications'),
  ('enrollment.manage', 'Manage learner course enrollments'),
  ('method_visibility.manage', 'Manage learner method visibility')
ON CONFLICT (code) DO NOTHING;
INSERT INTO admin.role_permissions (role_id, permission_id)
SELECT role.id, permission.id FROM admin.roles role CROSS JOIN admin.permissions permission
WHERE role.code IN ('super_admin', 'country_admin', 'regional_admin')
  AND permission.code IN ('onboarding.review', 'enrollment.manage', 'method_visibility.manage')
ON CONFLICT DO NOTHING;

CREATE FUNCTION admin.can_review_application(target_region_id UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT target_region_id IS NOT NULL AND admin.can_access_region(target_region_id, 'onboarding.review')
$$;
ALTER FUNCTION admin.can_review_application(UUID) OWNER TO qigong_authorizer;
REVOKE ALL ON FUNCTION admin.can_review_application(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.can_review_application(UUID) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION admin.can_access_region(UUID, TEXT) TO qigong_authorizer;

CREATE FUNCTION admin.can_manage_person(target_person_id UUID, required_permission TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin.role_grants grant_record
    JOIN admin.principals principal ON principal.id = grant_record.principal_id
    JOIN admin.role_permissions role_permission ON role_permission.role_id = grant_record.role_id
    JOIN admin.permissions permission ON permission.id = role_permission.permission_id
    WHERE grant_record.principal_id = admin.request_principal_id()
      AND principal.status = 'active' AND permission.code = required_permission
      AND grant_record.valid_from <= CURRENT_TIMESTAMP
      AND (grant_record.valid_to IS NULL OR grant_record.valid_to > CURRENT_TIMESTAMP)
      AND (
        grant_record.scope_type = 'global'
        OR EXISTS (
          SELECT 1 FROM core.person_region_assignments assignment
          JOIN core.regions region ON region.id = assignment.region_id
          WHERE assignment.person_id = target_person_id AND assignment.assignment_type = 'primary'
            AND assignment.valid_from <= CURRENT_DATE
            AND (assignment.valid_to IS NULL OR assignment.valid_to > CURRENT_DATE)
            AND (
              (grant_record.scope_type = 'region' AND grant_record.region_id = region.id)
              OR (grant_record.scope_type = 'country' AND grant_record.region_id = region.parent_region_id)
            )
        )
      )
  )
$$;
ALTER FUNCTION admin.can_manage_person(UUID, TEXT) OWNER TO qigong_authorizer;
REVOKE ALL ON FUNCTION admin.can_manage_person(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.can_manage_person(UUID, TEXT) TO qigong_api_runtime;

CREATE FUNCTION identity.submit_application(
  requested_platform TEXT, requested_subject TEXT, requested_name TEXT, region_id UUID
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE application_id UUID;
BEGIN
  IF requested_platform IS NULL OR requested_platform NOT IN ('line', 'telegram', 'whatsapp')
    OR requested_subject IS NULL OR length(trim(requested_subject)) = 0
    OR requested_name IS NULL OR length(trim(requested_name)) = 0 THEN
    RAISE EXCEPTION 'invalid verified platform identity';
  END IF;
  IF EXISTS (SELECT 1 FROM identity.platform_identities
             WHERE platform = requested_platform AND external_subject_id = requested_subject) THEN
    RAISE EXCEPTION 'platform identity already linked';
  END IF;
  INSERT INTO identity.onboarding_applications
    (platform, external_subject_id, display_name, requested_region_id)
  VALUES (requested_platform, requested_subject, requested_name, region_id)
  ON CONFLICT (platform, external_subject_id) DO NOTHING
  RETURNING id INTO application_id;
  IF application_id IS NULL THEN
    SELECT id INTO application_id FROM identity.onboarding_applications
    WHERE platform = requested_platform AND external_subject_id = requested_subject;
  END IF;
  RETURN application_id;
END;
$$;
REVOKE ALL ON FUNCTION identity.submit_application(TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.submit_application(TEXT, TEXT, TEXT, UUID) TO qigong_worker_runtime;

CREATE FUNCTION identity.decide_application(application_id UUID, decision TEXT, rejection TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE application identity.onboarding_applications%ROWTYPE;
DECLARE new_person_id UUID;
DECLARE actor_id UUID := admin.request_principal_id();
BEGIN
  SELECT * INTO application FROM identity.onboarding_applications WHERE id = application_id FOR UPDATE;
  IF NOT FOUND OR application.status <> 'pending' THEN
    RAISE EXCEPTION 'application is not pending';
  END IF;
  IF NOT admin.can_review_application(application.requested_region_id) THEN
    RAISE EXCEPTION 'onboarding review permission denied';
  END IF;
  IF decision = 'rejected' THEN
    IF rejection IS NULL OR length(trim(rejection)) = 0 THEN
      RAISE EXCEPTION 'rejection reason required';
    END IF;
    UPDATE identity.onboarding_applications SET status = 'rejected', rejection_reason = rejection,
      decided_by_principal_id = actor_id, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = application_id;
  ELSIF decision = 'approved' THEN
    IF application.requested_region_id IS NULL OR application.display_name IS NULL
      OR length(trim(application.display_name)) = 0 THEN
      RAISE EXCEPTION 'region and display name required for approval';
    END IF;
    INSERT INTO identity.people (preferred_name, membership_status)
      VALUES (application.display_name, 'pending') RETURNING id INTO new_person_id;
    INSERT INTO identity.platform_identities (person_id, platform, external_subject_id, display_name)
      VALUES (new_person_id, application.platform, application.external_subject_id, application.display_name);
    INSERT INTO core.person_region_assignments
      (person_id, region_id, assignment_type, valid_from, assigned_by_principal_id)
      VALUES (new_person_id, application.requested_region_id, 'primary', CURRENT_DATE, actor_id);
    INSERT INTO identity.person_interaction_channels
      (person_id, platform_identity_id, activation_source, activated_by_principal_id)
      SELECT new_person_id, id, 'onboarding', actor_id FROM identity.platform_identities
      WHERE person_id = new_person_id;
    UPDATE identity.onboarding_applications SET status = 'approved', person_id = new_person_id,
      decided_by_principal_id = actor_id, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = application_id;
  ELSE
    RAISE EXCEPTION 'invalid review decision';
  END IF;
  INSERT INTO audit.events (request_id, actor_principal_id, action, target_type, target_id,
    scope_type, scope_id, reason, outcome)
  VALUES (admin.request_id(), actor_id, 'onboarding.' || decision, 'onboarding_application',
    application_id::text, 'region', application.requested_region_id, rejection, 'success');
  RETURN new_person_id;
END;
$$;
REVOKE ALL ON FUNCTION identity.decide_application(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.decide_application(UUID, TEXT, TEXT) TO qigong_api_runtime;

ALTER TABLE identity.onboarding_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.onboarding_applications FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_application_read ON identity.onboarding_applications
  FOR SELECT TO qigong_api_runtime USING (admin.can_review_application(requested_region_id));
CREATE POLICY scoped_application_update ON identity.onboarding_applications
  FOR UPDATE TO qigong_api_runtime
  USING (admin.can_review_application(requested_region_id))
  WITH CHECK (admin.can_review_application(requested_region_id));
GRANT SELECT ON identity.onboarding_applications TO qigong_api_runtime;

ALTER TABLE core.person_course_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.person_course_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_enrollment_read ON core.person_course_enrollments
  FOR SELECT TO qigong_api_runtime
  USING (admin.can_access_person(person_id, 'learner.read'));
CREATE POLICY scoped_enrollment_write ON core.person_course_enrollments
  FOR ALL TO qigong_api_runtime
  USING (admin.can_manage_person(person_id, 'enrollment.manage'))
  WITH CHECK (admin.can_manage_person(person_id, 'enrollment.manage'));
GRANT SELECT ON core.person_course_enrollments TO qigong_api_runtime;

ALTER TABLE core.person_method_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.person_method_visibility FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped_visibility_read ON core.person_method_visibility
  FOR SELECT TO qigong_api_runtime
  USING (admin.can_access_person(person_id, 'learner.read'));
CREATE POLICY scoped_visibility_write ON core.person_method_visibility
  FOR ALL TO qigong_api_runtime
  USING (admin.can_manage_person(person_id, 'method_visibility.manage'))
  WITH CHECK (admin.can_manage_person(person_id, 'method_visibility.manage'));
GRANT SELECT ON core.person_method_visibility TO qigong_api_runtime;

GRANT SELECT ON core.practice_methods, core.practice_method_platforms, core.courses, core.course_methods
  TO qigong_api_runtime;

CREATE FUNCTION core.visible_practice_methods(target_person_id UUID, target_platform TEXT)
RETURNS TABLE (id UUID, code TEXT, name_zh_tw TEXT, sort_order INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT method.id, method.code, method.name_zh_tw, method.sort_order
  FROM core.practice_methods method
  JOIN identity.people person ON person.id = target_person_id
  JOIN identity.platform_identities platform_identity
    ON platform_identity.person_id = person.id AND platform_identity.platform = target_platform
    AND platform_identity.revoked_at IS NULL
  JOIN identity.person_interaction_channels channel
    ON channel.platform_identity_id = platform_identity.id AND channel.person_id = person.id
    AND channel.valid_from <= CURRENT_TIMESTAMP AND channel.valid_to IS NULL
  LEFT JOIN core.practice_method_platforms availability
    ON availability.practice_method_id = method.id AND availability.platform = target_platform
  LEFT JOIN core.person_method_visibility override
    ON override.practice_method_id = method.id AND override.person_id = person.id
  WHERE target_person_id = admin.request_person_id()
    AND person.status = 'active'
    AND method.active AND method.method_type = 'leaf'
    AND COALESCE(availability.available, TRUE)
    AND COALESCE(override.visible, TRUE)
  ORDER BY method.sort_order, method.code
$$;
REVOKE ALL ON FUNCTION core.visible_practice_methods(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.visible_practice_methods(UUID, TEXT) TO qigong_api_runtime;

CREATE FUNCTION core.record_course_enrollment(target_person_id UUID, target_course_id UUID,
  enrollment_status TEXT, change_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT admin.can_manage_person(target_person_id, 'enrollment.manage') THEN
    RAISE EXCEPTION 'enrollment permission denied';
  END IF;
  IF enrollment_status IS NULL OR enrollment_status NOT IN ('enrolled', 'completed', 'cancelled')
    OR change_reason IS NULL OR length(trim(change_reason)) = 0 THEN
    RAISE EXCEPTION 'invalid enrollment change';
  END IF;
  INSERT INTO core.person_course_enrollments
    (person_id, course_id, status, reason, recorded_by_principal_id)
  VALUES (target_person_id, target_course_id, enrollment_status, change_reason,
    admin.request_principal_id())
  ON CONFLICT (person_id, course_id) DO UPDATE
    SET status = EXCLUDED.status, reason = EXCLUDED.reason,
      recorded_by_principal_id = EXCLUDED.recorded_by_principal_id,
      recorded_at = CURRENT_TIMESTAMP;
  INSERT INTO audit.events (request_id, actor_principal_id, action, target_type, target_id,
    reason, outcome) VALUES (admin.request_id(), admin.request_principal_id(),
    'enrollment.changed', 'person', target_person_id::text, change_reason, 'success');
END;
$$;
REVOKE ALL ON FUNCTION core.record_course_enrollment(UUID, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.record_course_enrollment(UUID, UUID, TEXT, TEXT) TO qigong_api_runtime;

CREATE FUNCTION core.set_method_visibility(target_person_id UUID, target_method_id UUID,
  is_visible BOOLEAN, change_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT admin.can_manage_person(target_person_id, 'method_visibility.manage') THEN
    RAISE EXCEPTION 'method visibility permission denied';
  END IF;
  IF is_visible IS NULL OR change_reason IS NULL OR length(trim(change_reason)) = 0
    OR NOT EXISTS (SELECT 1 FROM core.practice_methods
      WHERE id = target_method_id AND method_type = 'leaf') THEN
    RAISE EXCEPTION 'invalid method visibility change';
  END IF;
  INSERT INTO core.person_method_visibility
    (person_id, practice_method_id, visible, reason, set_by_principal_id)
  VALUES (target_person_id, target_method_id, is_visible, change_reason,
    admin.request_principal_id())
  ON CONFLICT (person_id, practice_method_id) DO UPDATE
    SET visible = EXCLUDED.visible, reason = EXCLUDED.reason,
      set_by_principal_id = EXCLUDED.set_by_principal_id, updated_at = CURRENT_TIMESTAMP;
  INSERT INTO audit.events (request_id, actor_principal_id, action, target_type, target_id,
    reason, outcome) VALUES (admin.request_id(), admin.request_principal_id(),
    'method_visibility.changed', 'person', target_person_id::text, change_reason, 'success');
END;
$$;
REVOKE ALL ON FUNCTION core.set_method_visibility(UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.set_method_visibility(UUID, UUID, BOOLEAN, TEXT) TO qigong_api_runtime;

UPDATE core.platform_metadata
SET architecture_version = 'phase-2-onboarding', updated_at = CURRENT_TIMESTAMP
WHERE singleton = TRUE;
