-- Policy A: personal details never authorize linking to an existing learner.
-- Replace future approval behavior only; do not split or rewrite existing identities.
-- Preserve the existing function owner and EXECUTE privileges via CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION identity.decide_application(application_id UUID, decision TEXT, rejection TEXT DEFAULT NULL)
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
