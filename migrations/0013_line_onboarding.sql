ALTER TABLE identity.onboarding_applications DROP CONSTRAINT onboarding_applications_person_id_key;

CREATE OR REPLACE FUNCTION identity.decide_application(application_id UUID, decision TEXT, rejection TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE application identity.onboarding_applications%ROWTYPE;
DECLARE new_person_id UUID;
DECLARE actor_id UUID := admin.request_principal_id();
DECLARE matches INTEGER;
DECLARE active_channel BOOLEAN;
BEGIN
  SELECT * INTO application FROM identity.onboarding_applications WHERE id = application_id FOR UPDATE;
  IF NOT FOUND OR application.status <> 'pending' THEN RAISE EXCEPTION 'application is not pending'; END IF;
  IF NOT admin.can_review_application(application.requested_region_id) THEN
    RAISE EXCEPTION 'onboarding review permission denied';
  END IF;
  IF decision = 'rejected' THEN
    IF rejection IS NULL OR length(trim(rejection)) = 0 THEN RAISE EXCEPTION 'rejection reason required'; END IF;
    UPDATE identity.onboarding_applications SET status = 'rejected', rejection_reason = rejection,
      decided_by_principal_id = actor_id, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = application_id;
  ELSIF decision = 'approved' THEN
    IF application.requested_region_id IS NULL OR application.display_name IS NULL
      OR length(trim(application.display_name)) = 0 THEN
      RAISE EXCEPTION 'region and display name required for approval';
    END IF;
    -- Serialize review decisions so identical applications cannot both create a new learner.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      lower(trim(application.learner_name)) || ':' || lower(trim(application.website_email)) || ':' || application.phone_e164, 0));
    IF application.platform = 'line' THEN
      SELECT count(DISTINCT person_id), min(person_id::text)::uuid INTO matches, new_person_id
      FROM identity.onboarding_applications
      WHERE status = 'approved' AND person_id IS NOT NULL
        AND lower(trim(learner_name)) = lower(trim(application.learner_name))
        AND lower(trim(website_email)) = lower(trim(application.website_email))
        AND phone_e164 = application.phone_e164;
    ELSE
      matches := 0;
    END IF;
    IF matches > 1 THEN
      -- Ambiguous details are not sufficient to merge accounts.
      matches := 0;
    END IF;
    IF matches = 1 AND EXISTS (
      SELECT 1 FROM identity.onboarding_applications prior
      WHERE prior.person_id = new_person_id AND prior.platform = application.platform
    ) THEN
      -- Matching personal details do not authorize replacing an existing platform identity.
      matches := 0;
    END IF;
    IF matches = 0 THEN
      INSERT INTO identity.people (preferred_name, membership_status)
      VALUES (application.display_name, 'pending') RETURNING id INTO new_person_id;
      INSERT INTO core.person_region_assignments
        (person_id, region_id, assignment_type, valid_from, assigned_by_principal_id)
      VALUES (new_person_id, application.requested_region_id, 'primary', CURRENT_DATE, actor_id);
    END IF;
    INSERT INTO identity.platform_identities (person_id, platform, external_subject_id, display_name)
    VALUES (new_person_id, application.platform, application.external_subject_id, application.display_name);
    SELECT EXISTS (SELECT 1 FROM identity.person_interaction_channels
      WHERE person_id = new_person_id AND valid_to IS NULL) INTO active_channel;
    IF NOT active_channel THEN
      INSERT INTO identity.person_interaction_channels
        (person_id, platform_identity_id, activation_source, activated_by_principal_id)
      SELECT new_person_id, id, 'onboarding', actor_id FROM identity.platform_identities
      WHERE person_id = new_person_id AND platform = application.platform
        AND external_subject_id = application.external_subject_id;
    END IF;
    UPDATE identity.onboarding_applications SET status = 'approved', person_id = new_person_id,
      decided_by_principal_id = actor_id, decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = application_id;
  ELSE RAISE EXCEPTION 'invalid review decision'; END IF;
  INSERT INTO audit.events (request_id, actor_principal_id, action, target_type, target_id,
    scope_type, scope_id, reason, outcome)
  VALUES (admin.request_id(), actor_id, 'onboarding.' || decision, 'onboarding_application',
    application_id::text, 'region', application.requested_region_id, rejection, 'success');
  RETURN new_person_id;
END;
$$;

CREATE TABLE platform.line_links (
  line_user_id TEXT PRIMARY KEY,
  token_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE platform.line_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.line_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.line_links FROM PUBLIC;

CREATE FUNCTION platform.begin_line_link(input_user_id TEXT, input_token TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE status TEXT;
BEGIN
  IF input_user_id !~ '^U[0-9a-f]{32}$' OR input_token !~ '^[A-Za-z0-9_-]{43}$'
    OR input_user_id IS NULL OR input_token IS NULL THEN RAISE EXCEPTION 'invalid LINE link'; END IF;
  SELECT application.status INTO status FROM identity.onboarding_applications application
  WHERE platform = 'line' AND external_subject_id = input_user_id;
  IF status = 'approved' THEN RETURN 'approved'; END IF;
  IF status = 'rejected' THEN RETURN 'rejected'; END IF;
  IF status = 'pending' AND EXISTS (SELECT 1 FROM identity.onboarding_applications
    WHERE platform = 'line' AND external_subject_id = input_user_id AND learner_name IS NOT NULL)
  THEN RETURN 'pending'; END IF;
  INSERT INTO platform.line_links (line_user_id, token_hash, expires_at)
  VALUES (input_user_id, public.digest(input_token, 'sha256'), CURRENT_TIMESTAMP + INTERVAL '30 minutes')
  ON CONFLICT (line_user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash,
    expires_at = EXCLUDED.expires_at;
  RETURN 'form_required';
END;
$$;

CREATE FUNCTION platform.submit_line_application(input_user_id TEXT, input_token TEXT,
  input_name TEXT, input_email TEXT, input_phone TEXT, input_region_code TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE region_id UUID;
DECLARE application_id UUID;
BEGIN
  IF input_user_id IS NULL OR input_user_id !~ '^U[0-9a-f]{32}$'
    OR input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$'
    OR input_name IS NULL OR length(trim(input_name)) NOT BETWEEN 1 AND 150
    OR input_email IS NULL OR length(input_email) > 254
    OR input_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR input_phone IS NULL OR input_phone !~ '^\+[1-9][0-9]{6,14}$'
    OR input_region_code IS NULL OR input_region_code NOT IN ('tw-general','my-general','sg-general','hk-general','other-general')
  THEN RAISE EXCEPTION 'invalid LINE application details'; END IF;
  DELETE FROM platform.line_links WHERE line_user_id = input_user_id
    AND token_hash = public.digest(input_token, 'sha256') AND expires_at > CURRENT_TIMESTAMP;
  IF NOT FOUND THEN RAISE EXCEPTION 'LINE application link expired or used'; END IF;
  SELECT id INTO region_id FROM core.regions WHERE code = input_region_code
    AND region_type = 'operational' AND active;
  IF region_id IS NULL THEN RAISE EXCEPTION 'LINE application region unavailable'; END IF;
  application_id := identity.submit_application('line', input_user_id, trim(input_name), region_id);
  UPDATE identity.onboarding_applications SET learner_name = trim(input_name),
    website_email = lower(trim(input_email)), phone_e164 = input_phone,
    display_name = trim(input_name), requested_region_id = region_id, updated_at = CURRENT_TIMESTAMP
  WHERE id = application_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'LINE application already reviewed'; END IF;
  RETURN 'pending';
END;
$$;

CREATE FUNCTION platform.line_checkin_person(input_user_id TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT person.id FROM identity.platform_identities identity
  JOIN identity.people person ON person.id = identity.person_id
  JOIN identity.onboarding_applications application ON application.person_id = person.id
    AND application.platform = 'line' AND application.external_subject_id = input_user_id
    AND application.status = 'approved'
  JOIN identity.person_interaction_channels channel ON channel.person_id = person.id
    AND channel.platform_identity_id = identity.id
  WHERE input_user_id ~ '^U[0-9a-f]{32}$' AND identity.platform = 'line'
    AND identity.external_subject_id = input_user_id AND identity.revoked_at IS NULL
    AND person.status = 'active' AND channel.valid_from <= CURRENT_TIMESTAMP
    AND channel.valid_to IS NULL LIMIT 1
$$;

CREATE FUNCTION platform.line_checkin_method_tree(input_user_id TEXT)
RETURNS TABLE (code TEXT, name_zh_tw TEXT, sort_order INTEGER,
  parent_code TEXT, parent_name_zh_tw TEXT, parent_sort_order INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT method.code, method.name_zh_tw, method.sort_order,
    parent.code, parent.name_zh_tw, parent.sort_order
  FROM core.practice_methods method
  LEFT JOIN core.practice_methods parent ON parent.id = method.parent_id
  WHERE platform.line_checkin_person(input_user_id) IS NOT NULL
    AND method.active AND method.method_type = 'leaf'
    AND NOT EXISTS (SELECT 1 FROM core.practice_method_platforms availability
      WHERE availability.practice_method_id = method.id AND availability.platform = 'line'
        AND NOT availability.available)
  ORDER BY coalesce(parent.sort_order, method.sort_order), method.sort_order, method.code
$$;

CREATE FUNCTION platform.line_checkin_history(input_user_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_person UUID := platform.line_checkin_person(input_user_id);
DECLARE zone TEXT;
DECLARE today DATE;
DECLARE last_day DATE;
DECLARE consecutive INTEGER;
DECLARE total INTEGER;
DECLARE entries JSONB;
BEGIN
  IF target_person IS NULL THEN RAISE EXCEPTION 'LINE checkin identity unavailable'; END IF;
  SELECT practice_timezone INTO zone FROM identity.people WHERE id = target_person;
  today := (CURRENT_TIMESTAMP AT TIME ZONE zone)::date;
  SELECT count(*), max(practice_date) FILTER (WHERE practice_date <= today)
    INTO total, last_day FROM core.checkins WHERE person_id = target_person;
  IF last_day < today - 1 THEN consecutive := 0;
  ELSE
    SELECT count(*) INTO consecutive FROM (
      SELECT practice_date, row_number() OVER (ORDER BY practice_date DESC) AS position
      FROM core.checkins WHERE person_id = target_person AND practice_date <= last_day
    ) days WHERE practice_date = last_day - (position::integer - 1);
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(item) ORDER BY item.practice_date DESC), '[]'::jsonb)
    INTO entries FROM (
    SELECT checkin.id, checkin.practice_date::text AS practice_date, checkin.entry_kind,
      checkin.practice_timezone,
      array_agg(method.code ORDER BY method.sort_order, method.code) AS method_codes,
      array_agg(method.name_zh_tw ORDER BY method.sort_order, method.code) AS method_names,
      (checkin.practice_date = today OR (checkin.practice_date = today - 1
        AND (CURRENT_TIMESTAMP AT TIME ZONE zone)::time < TIME '12:00')) AS editable
    FROM (SELECT * FROM core.checkins WHERE person_id = target_person
      ORDER BY practice_date DESC LIMIT 14) checkin
    JOIN core.checkin_method_selections selection ON selection.checkin_id = checkin.id
    JOIN core.practice_methods method ON method.id = selection.practice_method_id
    GROUP BY checkin.id, checkin.practice_date, checkin.entry_kind, checkin.practice_timezone
  ) item;
  RETURN jsonb_build_object('today', today::text, 'timezone', zone,
    'makeupOpen', (CURRENT_TIMESTAMP AT TIME ZONE zone)::time < TIME '12:00',
    'currentStreak', coalesce(consecutive, 0), 'totalDays', total, 'entries', entries);
END;
$$;

CREATE FUNCTION platform.submit_line_checkin(input_user_id TEXT, input_method_codes TEXT[], input_makeup BOOLEAN)
RETURNS TABLE (checkin_id UUID, practice_date DATE, entry_kind TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_person UUID := platform.line_checkin_person(input_user_id);
DECLARE identity_id UUID;
DECLARE assignment_id UUID;
DECLARE zone TEXT;
DECLARE practice_day DATE;
DECLARE inserted_id UUID;
DECLARE method_count INTEGER;
BEGIN
  IF target_person IS NULL THEN RAISE EXCEPTION 'LINE checkin identity unavailable'; END IF;
  IF input_makeup IS NULL OR input_method_codes IS NULL
    OR cardinality(input_method_codes) NOT BETWEEN 1 AND 30
    OR EXISTS (SELECT 1 FROM unnest(input_method_codes) code WHERE code IS NULL OR length(code) = 0)
  THEN RAISE EXCEPTION 'invalid checkin submission'; END IF;
  SELECT id INTO identity_id FROM identity.platform_identities
    WHERE person_id = target_person AND platform = 'line' AND external_subject_id = input_user_id;
  SELECT practice_timezone INTO zone FROM identity.people WHERE id = target_person FOR UPDATE;
  IF input_makeup AND (CURRENT_TIMESTAMP AT TIME ZONE zone)::time >= TIME '12:00' THEN
    RAISE EXCEPTION 'makeup deadline passed'; END IF;
  practice_day := (CURRENT_TIMESTAMP AT TIME ZONE zone)::date - CASE WHEN input_makeup THEN 1 ELSE 0 END;
  SELECT id INTO assignment_id FROM core.person_region_assignments assignment
    WHERE assignment.person_id = target_person AND assignment.assignment_type = 'primary'
      AND assignment.valid_from <= practice_day AND (assignment.valid_to IS NULL OR assignment.valid_to > practice_day);
  IF assignment_id IS NULL THEN RAISE EXCEPTION 'practice date has no region assignment'; END IF;
  SELECT count(*) INTO method_count FROM core.practice_methods method
    WHERE method.code = ANY(input_method_codes) AND method.method_type = 'leaf' AND method.active
      AND NOT EXISTS (SELECT 1 FROM core.practice_method_platforms availability
        WHERE availability.practice_method_id = method.id AND availability.platform = 'line' AND NOT availability.available);
  IF method_count <> cardinality(input_method_codes) THEN RAISE EXCEPTION 'invalid or duplicate practice method'; END IF;
  INSERT INTO core.checkins (person_id, submitted_via_identity_id, practice_date, practice_timezone, entry_kind, region_assignment_id)
    VALUES (target_person, identity_id, practice_day, zone,
      CASE WHEN input_makeup THEN 'makeup' ELSE 'regular' END, assignment_id) RETURNING id INTO inserted_id;
  INSERT INTO core.checkin_method_selections (checkin_id, practice_method_id)
    SELECT inserted_id, method.id FROM core.practice_methods method WHERE method.code = ANY(input_method_codes);
  RETURN QUERY SELECT inserted_id, practice_day, CASE WHEN input_makeup THEN 'makeup' ELSE 'regular' END::TEXT;
END;
$$;

CREATE FUNCTION platform.correct_line_checkin(input_user_id TEXT, input_checkin_id UUID, input_method_codes TEXT[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_person UUID := platform.line_checkin_person(input_user_id);
DECLARE target_checkin core.checkins%ROWTYPE;
DECLARE zone TEXT;
DECLARE today DATE;
DECLARE method_count INTEGER;
BEGIN
  IF target_person IS NULL THEN RAISE EXCEPTION 'LINE checkin identity unavailable'; END IF;
  IF input_checkin_id IS NULL OR input_method_codes IS NULL
    OR cardinality(input_method_codes) NOT BETWEEN 1 AND 30
    OR EXISTS (SELECT 1 FROM unnest(input_method_codes) code WHERE code IS NULL OR length(code) = 0)
  THEN RAISE EXCEPTION 'invalid checkin correction'; END IF;
  SELECT practice_timezone INTO zone FROM identity.people WHERE id = target_person FOR UPDATE;
  today := (CURRENT_TIMESTAMP AT TIME ZONE zone)::date;
  SELECT * INTO target_checkin FROM core.checkins WHERE id = input_checkin_id AND person_id = target_person FOR UPDATE;
  IF NOT FOUND OR NOT (target_checkin.practice_date = today OR (target_checkin.practice_date = today - 1
    AND (CURRENT_TIMESTAMP AT TIME ZONE zone)::time < TIME '12:00'))
  THEN RAISE EXCEPTION 'checkin correction unavailable'; END IF;
  SELECT count(*) INTO method_count FROM core.practice_methods method
    WHERE method.code = ANY(input_method_codes) AND method.method_type = 'leaf' AND method.active
      AND NOT EXISTS (SELECT 1 FROM core.practice_method_platforms availability
        WHERE availability.practice_method_id = method.id AND availability.platform = 'line' AND NOT availability.available);
  IF method_count <> cardinality(input_method_codes) THEN RAISE EXCEPTION 'invalid or duplicate practice method'; END IF;
  DELETE FROM core.checkin_method_selections WHERE checkin_id = input_checkin_id;
  INSERT INTO core.checkin_method_selections (checkin_id, practice_method_id)
    SELECT input_checkin_id, method.id FROM core.practice_methods method WHERE method.code = ANY(input_method_codes);
END;
$$;

REVOKE ALL ON FUNCTION platform.begin_line_link(TEXT,TEXT),
  platform.submit_line_application(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.begin_line_link(TEXT,TEXT),
  platform.submit_line_application(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO qigong_api_runtime;
REVOKE ALL ON FUNCTION platform.line_checkin_person(TEXT),
  platform.line_checkin_method_tree(TEXT), platform.line_checkin_history(TEXT),
  platform.submit_line_checkin(TEXT,TEXT[],BOOLEAN),
  platform.correct_line_checkin(TEXT,UUID,TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.line_checkin_method_tree(TEXT),
  platform.line_checkin_history(TEXT), platform.submit_line_checkin(TEXT,TEXT[],BOOLEAN),
  platform.correct_line_checkin(TEXT,UUID,TEXT[]) TO qigong_api_runtime;
