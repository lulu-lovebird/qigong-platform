CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE identity.people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_issuer TEXT NOT NULL,
  website_subject TEXT NOT NULL,
  membership_id TEXT UNIQUE,
  legal_name TEXT NOT NULL,
  preferred_name TEXT,
  public_nickname TEXT,
  preferred_locale TEXT NOT NULL DEFAULT 'zh_TW'
    CHECK (preferred_locale IN ('zh_TW', 'zh_CN', 'en')),
  practice_timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
  reminder_timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
  membership_status TEXT NOT NULL DEFAULT 'active'
    CHECK (membership_status IN ('pending', 'active', 'suspended', 'expired')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (website_issuer, website_subject)
);

CREATE TABLE identity.platform_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES identity.people(id),
  platform TEXT NOT NULL CHECK (platform IN ('line', 'telegram', 'whatsapp')),
  external_subject_id TEXT NOT NULL,
  display_name TEXT,
  username TEXT,
  provider_locale TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (platform, external_subject_id),
  UNIQUE (id, person_id),
  CHECK (revoked_at IS NULL OR revoked_at >= verified_at)
);

CREATE FUNCTION identity.validate_interaction_channel_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  person_status TEXT;
  identity_revoked_at TIMESTAMPTZ;
BEGIN
  SELECT status INTO person_status
  FROM identity.people WHERE id = NEW.person_id
  FOR UPDATE;
  SELECT revoked_at INTO identity_revoked_at
  FROM identity.platform_identities
  WHERE id = NEW.platform_identity_id AND person_id = NEW.person_id
  FOR UPDATE;

  IF person_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'active interaction channel requires an active person';
  END IF;
  IF identity_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'active interaction channel cannot use a revoked identity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE identity.person_interaction_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES identity.people(id),
  platform_identity_id UUID NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_to TIMESTAMPTZ,
  activation_source TEXT NOT NULL
    CHECK (activation_source IN ('onboarding', 'website_self_service', 'admin_override', 'recovery')),
  activated_by_principal_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (platform_identity_id, person_id)
    REFERENCES identity.platform_identities(id, person_id),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  EXCLUDE USING gist (
    person_id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
  )
);

CREATE TRIGGER validate_interaction_channel_activation
BEFORE INSERT OR UPDATE OF person_id, platform_identity_id, valid_to
ON identity.person_interaction_channels
FOR EACH ROW
WHEN (NEW.valid_to IS NULL)
EXECUTE FUNCTION identity.validate_interaction_channel_activation();

CREATE UNIQUE INDEX person_one_open_interaction_channel
  ON identity.person_interaction_channels(person_id)
  WHERE valid_to IS NULL;

CREATE FUNCTION identity.prevent_active_identity_revocation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
    PERFORM 1 FROM identity.person_interaction_channels
    WHERE platform_identity_id = NEW.id AND valid_to IS NULL
    FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'close the active interaction channel before revoking its identity';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION identity.prevent_active_person_suspension()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status <> 'active' THEN
    PERFORM 1 FROM identity.person_interaction_channels
    WHERE person_id = NEW.id AND valid_to IS NULL
    FOR UPDATE;
    IF FOUND THEN
      RAISE EXCEPTION 'close the active interaction channel before suspending its person';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_active_identity_revocation
BEFORE UPDATE OF revoked_at ON identity.platform_identities
FOR EACH ROW EXECUTE FUNCTION identity.prevent_active_identity_revocation();

CREATE TRIGGER prevent_active_person_suspension
BEFORE UPDATE OF status ON identity.people
FOR EACH ROW EXECUTE FUNCTION identity.prevent_active_person_suspension();

CREATE TABLE core.regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_region_id UUID REFERENCES core.regions(id),
  code TEXT NOT NULL UNIQUE,
  region_type TEXT NOT NULL CHECK (region_type IN ('global', 'country', 'operational')),
  name_zh_tw TEXT NOT NULL,
  name_zh_cn TEXT,
  name_en TEXT NOT NULL,
  default_timezone TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (parent_region_id IS NULL OR parent_region_id <> id)
);

CREATE UNIQUE INDEX one_global_region
  ON core.regions(region_type)
  WHERE region_type = 'global';

CREATE FUNCTION core.validate_region_hierarchy()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_type TEXT;
  parent_active BOOLEAN;
BEGIN
  IF NEW.region_type = 'global' THEN
    IF NEW.parent_region_id IS NOT NULL THEN
      RAISE EXCEPTION 'global region cannot have a parent';
    END IF;
    RETURN NEW;
  END IF;

  SELECT region_type, active INTO parent_type, parent_active
  FROM core.regions WHERE id = NEW.parent_region_id
  FOR UPDATE;

  IF parent_type IS NULL OR NOT parent_active THEN
    RAISE EXCEPTION 'region parent must exist and be active';
  END IF;
  IF NEW.region_type = 'country' AND parent_type <> 'global' THEN
    RAISE EXCEPTION 'country parent must be global';
  END IF;
  IF NEW.region_type = 'operational' AND parent_type <> 'country' THEN
    RAISE EXCEPTION 'operational region parent must be country';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_region_hierarchy
BEFORE INSERT OR UPDATE OF parent_region_id, region_type
ON core.regions
FOR EACH ROW EXECUTE FUNCTION core.validate_region_hierarchy();

CREATE FUNCTION core.prevent_active_parent_deactivation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.active AND NOT NEW.active AND EXISTS (
    SELECT 1 FROM core.regions WHERE parent_region_id = NEW.id AND active
  ) THEN
    RAISE EXCEPTION 'deactivate active child regions before their parent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_active_parent_deactivation
BEFORE UPDATE OF active ON core.regions
FOR EACH ROW EXECUTE FUNCTION core.prevent_active_parent_deactivation();

CREATE TABLE admin.principals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oidc_issuer TEXT NOT NULL,
  oidc_subject TEXT NOT NULL,
  email TEXT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disabled')),
  break_glass BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (oidc_issuer, oidc_subject)
);

ALTER TABLE identity.person_interaction_channels
  ADD CONSTRAINT person_interaction_channels_activated_by_fk
  FOREIGN KEY (activated_by_principal_id) REFERENCES admin.principals(id);

CREATE TABLE core.region_transfer_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES identity.people(id),
  source_region_id UUID NOT NULL REFERENCES core.regions(id),
  destination_region_id UUID NOT NULL REFERENCES core.regions(id),
  effective_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled', 'overridden')),
  requested_by_principal_id UUID REFERENCES admin.principals(id),
  decided_by_principal_id UUID REFERENCES admin.principals(id),
  reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at TIMESTAMPTZ,
  UNIQUE (id, person_id, destination_region_id, effective_date),
  CHECK (source_region_id <> destination_region_id),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);

CREATE FUNCTION core.validate_operational_regions()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  source_type TEXT;
  destination_type TEXT;
BEGIN
  IF TG_TABLE_NAME = 'region_transfer_requests' THEN
    SELECT region_type INTO source_type FROM core.regions WHERE id = NEW.source_region_id AND active;
    SELECT region_type INTO destination_type FROM core.regions WHERE id = NEW.destination_region_id AND active;
    IF source_type IS DISTINCT FROM 'operational' OR destination_type IS DISTINCT FROM 'operational' THEN
      RAISE EXCEPTION 'region transfer endpoints must be active operational regions';
    END IF;
  ELSIF TG_TABLE_NAME = 'person_region_assignments' AND NEW.assignment_type = 'primary' THEN
    SELECT region_type INTO destination_type FROM core.regions WHERE id = NEW.region_id AND active;
    IF destination_type IS DISTINCT FROM 'operational' THEN
      RAISE EXCEPTION 'primary assignment requires an active operational region';
    END IF;
  ELSIF TG_TABLE_NAME = 'cohorts' THEN
    SELECT region_type INTO destination_type FROM core.regions WHERE id = NEW.region_id AND active;
    IF destination_type IS DISTINCT FROM 'operational' THEN
      RAISE EXCEPTION 'cohort requires an active operational region';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_region_transfer_endpoints
BEFORE INSERT OR UPDATE OF source_region_id, destination_region_id
ON core.region_transfer_requests
FOR EACH ROW EXECUTE FUNCTION core.validate_operational_regions();

CREATE TABLE core.person_region_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES identity.people(id),
  region_id UUID NOT NULL REFERENCES core.regions(id),
  assignment_type TEXT NOT NULL CHECK (assignment_type IN ('primary', 'secondary', 'program')),
  valid_from DATE NOT NULL,
  valid_to DATE,
  assigned_by_principal_id UUID REFERENCES admin.principals(id),
  transfer_request_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, person_id),
  FOREIGN KEY (transfer_request_id, person_id, region_id, valid_from)
    REFERENCES core.region_transfer_requests(id, person_id, destination_region_id, effective_date),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  EXCLUDE USING gist (
    person_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  ) WHERE (assignment_type = 'primary')
);

CREATE FUNCTION core.validate_transfer_backed_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  transfer_status TEXT;
  transfer_source_region_id UUID;
BEGIN
  IF NEW.transfer_request_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT status, source_region_id
  INTO transfer_status, transfer_source_region_id
  FROM core.region_transfer_requests
  WHERE id = NEW.transfer_request_id
  FOR UPDATE;
  IF transfer_status NOT IN ('accepted', 'overridden') THEN
    RAISE EXCEPTION 'transfer-backed assignment requires an accepted or overridden request';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM core.person_region_assignments
    WHERE person_id = NEW.person_id
      AND region_id = transfer_source_region_id
      AND assignment_type = 'primary'
      AND valid_from < NEW.valid_from
      AND valid_to = NEW.valid_from
  ) THEN
    RAISE EXCEPTION 'source primary assignment must close on the transfer effective date';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_transfer_backed_assignment
BEFORE INSERT OR UPDATE OF transfer_request_id, person_id, region_id, valid_from
ON core.person_region_assignments
FOR EACH ROW EXECUTE FUNCTION core.validate_transfer_backed_assignment();

CREATE FUNCTION core.prevent_transfer_invalidation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM core.person_region_assignments
    WHERE transfer_request_id = NEW.id
  ) AND NEW.status NOT IN ('accepted', 'overridden') THEN
    RAISE EXCEPTION 'a referenced transfer must remain accepted or overridden';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_transfer_invalidation
BEFORE UPDATE OF status ON core.region_transfer_requests
FOR EACH ROW EXECUTE FUNCTION core.prevent_transfer_invalidation();

CREATE FUNCTION core.prevent_transfer_source_assignment_invalidation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM core.region_transfer_requests tr
    JOIN core.person_region_assignments destination
      ON destination.transfer_request_id = tr.id
    WHERE tr.person_id = OLD.person_id
      AND tr.source_region_id = OLD.region_id
      AND tr.effective_date = OLD.valid_to
  ) AND (
    TG_OP = 'DELETE'
    OR NEW.person_id IS DISTINCT FROM OLD.person_id
    OR NEW.region_id IS DISTINCT FROM OLD.region_id
    OR NEW.assignment_type IS DISTINCT FROM OLD.assignment_type
    OR NEW.valid_to IS DISTINCT FROM OLD.valid_to
  ) THEN
    RAISE EXCEPTION 'cannot invalidate the source assignment of a completed transfer';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_transfer_source_assignment_invalidation
BEFORE UPDATE OR DELETE ON core.person_region_assignments
FOR EACH ROW EXECUTE FUNCTION core.prevent_transfer_source_assignment_invalidation();

CREATE TRIGGER validate_primary_assignment_region
BEFORE INSERT OR UPDATE OF region_id, assignment_type
ON core.person_region_assignments
FOR EACH ROW EXECUTE FUNCTION core.validate_operational_regions();

CREATE TABLE core.cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id UUID NOT NULL REFERENCES core.regions(id),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  starts_on DATE,
  ends_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

CREATE TRIGGER validate_cohort_region
BEFORE INSERT OR UPDATE OF region_id
ON core.cohorts
FOR EACH ROW EXECUTE FUNCTION core.validate_operational_regions();

CREATE TABLE core.cohort_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id UUID NOT NULL REFERENCES core.cohorts(id),
  person_id UUID NOT NULL REFERENCES identity.people(id),
  valid_from DATE NOT NULL,
  valid_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  EXCLUDE USING gist (
    cohort_id WITH =,
    person_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[)') WITH &&
  )
);

CREATE TABLE admin.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE admin.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE admin.role_permissions (
  role_id UUID NOT NULL REFERENCES admin.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES admin.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE admin.privacy_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID REFERENCES identity.people(id),
  case_type TEXT NOT NULL CHECK (case_type IN ('export', 'delete', 'anonymize', 'restriction')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMPTZ
);

CREATE TABLE admin.role_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES admin.principals(id),
  role_id UUID NOT NULL REFERENCES admin.roles(id),
  scope_type TEXT NOT NULL
    CHECK (scope_type IN ('global', 'country', 'region', 'cohort', 'content', 'platform', 'privacy_case')),
  region_id UUID REFERENCES core.regions(id),
  cohort_id UUID REFERENCES core.cohorts(id),
  platform TEXT CHECK (platform IN ('line', 'telegram', 'whatsapp')),
  privacy_case_id UUID REFERENCES admin.privacy_cases(id),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_to TIMESTAMPTZ,
  granted_by_principal_id UUID REFERENCES admin.principals(id),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK (
    (scope_type IN ('global', 'content') AND region_id IS NULL AND cohort_id IS NULL AND platform IS NULL AND privacy_case_id IS NULL)
    OR (scope_type IN ('country', 'region') AND region_id IS NOT NULL AND cohort_id IS NULL AND platform IS NULL AND privacy_case_id IS NULL)
    OR (scope_type = 'cohort' AND region_id IS NULL AND cohort_id IS NOT NULL AND platform IS NULL AND privacy_case_id IS NULL)
    OR (scope_type = 'platform' AND region_id IS NULL AND cohort_id IS NULL AND platform IS NOT NULL AND privacy_case_id IS NULL)
    OR (scope_type = 'privacy_case' AND region_id IS NULL AND cohort_id IS NULL AND platform IS NULL AND privacy_case_id IS NOT NULL)
  )
);

CREATE FUNCTION admin.validate_role_grant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  role_code TEXT;
  region_type_value TEXT;
BEGIN
  SELECT code INTO role_code FROM admin.roles WHERE id = NEW.role_id;
  IF NEW.scope_type IN ('country', 'region') THEN
    SELECT region_type INTO region_type_value FROM core.regions WHERE id = NEW.region_id AND active;
    IF NEW.scope_type = 'country' AND region_type_value IS DISTINCT FROM 'country' THEN
      RAISE EXCEPTION 'country scope requires an active country region';
    END IF;
    IF NEW.scope_type = 'region' AND region_type_value IS DISTINCT FROM 'operational' THEN
      RAISE EXCEPTION 'region scope requires an active operational region';
    END IF;
  END IF;

  IF role_code IN ('super_admin', 'global_viewer') AND NEW.scope_type <> 'global' THEN
    RAISE EXCEPTION '% requires global scope', role_code;
  ELSIF role_code = 'country_admin' AND NEW.scope_type <> 'country' THEN
    RAISE EXCEPTION 'country_admin requires country scope';
  ELSIF role_code IN ('regional_admin', 'regional_viewer') AND NEW.scope_type <> 'region' THEN
    RAISE EXCEPTION '% requires region scope', role_code;
  ELSIF role_code = 'coach' AND NEW.scope_type <> 'cohort' THEN
    RAISE EXCEPTION 'coach requires cohort scope';
  ELSIF role_code = 'content_admin' AND NEW.scope_type <> 'content' THEN
    RAISE EXCEPTION 'content_admin requires content scope';
  ELSIF role_code = 'privacy_admin' AND NEW.scope_type <> 'privacy_case' THEN
    RAISE EXCEPTION 'privacy_admin requires privacy_case scope';
  ELSIF role_code = 'broadcast_admin' AND NEW.scope_type NOT IN ('global', 'country', 'region', 'platform') THEN
    RAISE EXCEPTION 'broadcast_admin has invalid scope';
  ELSIF role_code = 'auditor' AND NEW.scope_type NOT IN ('global', 'country', 'region') THEN
    RAISE EXCEPTION 'auditor has invalid scope';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_role_grant
BEFORE INSERT OR UPDATE OF role_id, scope_type, region_id, cohort_id, platform, privacy_case_id
ON admin.role_grants
FOR EACH ROW EXECUTE FUNCTION admin.validate_role_grant();

CREATE UNIQUE INDEX unique_open_role_grant
  ON admin.role_grants(
    principal_id,
    role_id,
    scope_type,
    COALESCE(region_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(cohort_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(platform, ''),
    COALESCE(privacy_case_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE valid_to IS NULL;

CREATE TABLE audit.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_id UUID NOT NULL,
  actor_principal_id UUID REFERENCES admin.principals(id),
  actor_person_id UUID REFERENCES identity.people(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  scope_type TEXT,
  scope_id UUID,
  reason TEXT,
  before_data JSONB,
  after_data JSONB,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO admin.roles (code, description) VALUES
  ('super_admin', 'Global platform administration'),
  ('global_viewer', 'Read-only global reporting'),
  ('country_admin', 'Country-scoped learner operations'),
  ('regional_admin', 'Operational-region learner administration'),
  ('regional_viewer', 'Operational-region read-only access'),
  ('coach', 'Cohort-scoped learner coaching'),
  ('content_admin', 'Taxonomy, campaign, and badge content administration'),
  ('broadcast_admin', 'Scoped messaging and broadcast administration'),
  ('privacy_admin', 'Privacy export, deletion, and anonymization operations'),
  ('auditor', 'Read-only audit access')
ON CONFLICT (code) DO NOTHING;

INSERT INTO admin.permissions (code, description) VALUES
  ('learner.read', 'Read learner profile data'),
  ('learner.manage_profile', 'Update learner profile data'),
  ('learner.assign_region', 'Assign learner regions'),
  ('learner.transfer_request', 'Request a region transfer'),
  ('learner.transfer_accept', 'Accept a region transfer'),
  ('learner.transfer_override', 'Override the region transfer workflow'),
  ('identity.link', 'Link a verified platform identity'),
  ('identity.link_override', 'Administratively link platform identities'),
  ('identity.revoke', 'Revoke a platform identity'),
  ('interaction_channel.switch', 'Switch a learner primary interaction channel'),
  ('checkin.read', 'Read non-sensitive check-in data'),
  ('checkin.read_private_note', 'Read private practice notes'),
  ('checkin.correct', 'Administratively correct check-ins'),
  ('stats.read', 'Read scoped statistics'),
  ('stats.export', 'Export scoped statistics'),
  ('taxonomy.manage', 'Manage practice taxonomy'),
  ('badge.manage', 'Manage badge definitions and rules'),
  ('campaign.manage', 'Manage seasonal campaigns'),
  ('broadcast.create', 'Create scoped broadcasts'),
  ('broadcast.approve', 'Approve scoped broadcasts'),
  ('privacy.export', 'Export personal data for privacy requests'),
  ('privacy.delete', 'Delete or anonymize personal data'),
  ('audit.read', 'Read audit events')
ON CONFLICT (code) DO NOTHING;

INSERT INTO admin.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM admin.roles r
JOIN admin.permissions p ON
  r.code = 'super_admin'
  OR (r.code = 'global_viewer' AND p.code IN ('learner.read', 'checkin.read', 'stats.read'))
  OR (r.code = 'country_admin' AND p.code IN ('learner.read', 'learner.manage_profile', 'learner.assign_region', 'learner.transfer_accept', 'checkin.read', 'stats.read', 'broadcast.create'))
  OR (r.code = 'regional_admin' AND p.code IN ('learner.read', 'learner.manage_profile', 'learner.transfer_request', 'checkin.read', 'stats.read'))
  OR (r.code = 'regional_viewer' AND p.code IN ('learner.read', 'checkin.read', 'stats.read'))
  OR (r.code = 'coach' AND p.code IN ('learner.read', 'checkin.read', 'checkin.read_private_note', 'stats.read'))
  OR (r.code = 'content_admin' AND p.code IN ('taxonomy.manage', 'badge.manage', 'campaign.manage'))
  OR (r.code = 'broadcast_admin' AND p.code IN ('broadcast.create', 'broadcast.approve'))
  OR (r.code = 'privacy_admin' AND p.code IN ('learner.read', 'checkin.read_private_note', 'privacy.export', 'privacy.delete'))
  OR (r.code = 'auditor' AND p.code = 'audit.read')
ON CONFLICT DO NOTHING;

ALTER TABLE identity.people ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.people FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.platform_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.platform_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE identity.person_interaction_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.person_interaction_channels FORCE ROW LEVEL SECURITY;
ALTER TABLE core.person_region_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.person_region_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE core.cohort_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.cohort_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE core.region_transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.region_transfer_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE admin.privacy_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.privacy_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.events FORCE ROW LEVEL SECURITY;
ALTER TABLE admin.principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.principals FORCE ROW LEVEL SECURITY;
ALTER TABLE admin.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE admin.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE admin.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE admin.role_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.role_grants FORCE ROW LEVEL SECURITY;

UPDATE core.platform_metadata
SET architecture_version = 'phase-2', updated_at = CURRENT_TIMESTAMP
WHERE singleton = TRUE;
