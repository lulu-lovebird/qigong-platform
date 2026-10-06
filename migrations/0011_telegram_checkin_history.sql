CREATE FUNCTION platform.telegram_checkin_person(input_token TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT person.id
  FROM platform.telegram_checkin_links link
  JOIN identity.platform_identities identity
    ON identity.platform = 'telegram' AND identity.external_subject_id = link.telegram_user_id
  JOIN identity.people person ON person.id = identity.person_id
  JOIN identity.onboarding_applications application
    ON application.person_id = person.id AND application.platform = 'telegram'
      AND application.external_subject_id = link.telegram_user_id AND application.status = 'approved'
  JOIN identity.person_interaction_channels channel
    ON channel.platform_identity_id = identity.id AND channel.person_id = person.id
  WHERE input_token ~ '^[A-Za-z0-9_-]{43}$'
    AND link.token_hash = public.digest(input_token, 'sha256')
    AND link.expires_at > CURRENT_TIMESTAMP
    AND identity.revoked_at IS NULL AND person.status = 'active'
    AND channel.valid_to IS NULL AND channel.valid_from <= CURRENT_TIMESTAMP
  LIMIT 1
$$;

CREATE FUNCTION platform.telegram_checkin_history(input_token TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_person UUID;
DECLARE practice_zone TEXT;
DECLARE today DATE;
DECLARE last_date DATE;
DECLARE streak INTEGER;
DECLARE total INTEGER;
DECLARE entries JSONB;
BEGIN
  target_person := platform.telegram_checkin_person(input_token);
  IF target_person IS NULL THEN RAISE EXCEPTION 'checkin link expired or identity unavailable'; END IF;
  SELECT practice_timezone INTO practice_zone FROM identity.people WHERE id = target_person;
  today := (CURRENT_TIMESTAMP AT TIME ZONE practice_zone)::date;
  SELECT count(*) INTO total FROM core.checkins WHERE person_id = target_person;
  SELECT max(practice_date) INTO last_date FROM core.checkins
    WHERE person_id = target_person AND practice_date <= today;
  IF last_date < today - 1 THEN
    streak := 0;
  ELSE
    SELECT count(*) INTO streak FROM (
      SELECT practice_date, row_number() OVER (ORDER BY practice_date DESC) AS position
      FROM core.checkins WHERE person_id = target_person AND practice_date <= last_date
    ) days WHERE practice_date = last_date - (position::integer - 1);
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(item) ORDER BY item.practice_date DESC), '[]'::jsonb)
  INTO entries FROM (
    SELECT checkin.id, checkin.practice_date::text AS practice_date, checkin.entry_kind,
      checkin.practice_timezone,
      array_agg(method.code ORDER BY method.sort_order, method.code) AS method_codes,
      array_agg(method.name_zh_tw ORDER BY method.sort_order, method.code) AS method_names,
      (checkin.practice_date = today OR
        (checkin.practice_date = today - 1
          AND (CURRENT_TIMESTAMP AT TIME ZONE practice_zone)::time < TIME '12:00')) AS editable
    FROM (SELECT * FROM core.checkins WHERE person_id = target_person
      ORDER BY practice_date DESC LIMIT 14) checkin
    JOIN core.checkin_method_selections selection ON selection.checkin_id = checkin.id
    JOIN core.practice_methods method ON method.id = selection.practice_method_id
    GROUP BY checkin.id, checkin.practice_date, checkin.entry_kind, checkin.practice_timezone
  ) item;
  RETURN jsonb_build_object('today', today::text, 'timezone', practice_zone,
    'makeupOpen', (CURRENT_TIMESTAMP AT TIME ZONE practice_zone)::time < TIME '12:00',
    'currentStreak', coalesce(streak, 0), 'totalDays', total, 'entries', entries);
END;
$$;

CREATE FUNCTION platform.correct_telegram_checkin(
  input_token TEXT, input_checkin_id UUID, input_method_codes TEXT[]
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_person UUID;
DECLARE target_checkin core.checkins%ROWTYPE;
DECLARE practice_zone TEXT;
DECLARE today DATE;
DECLARE method_count INTEGER;
BEGIN
  IF input_checkin_id IS NULL OR input_method_codes IS NULL
    OR cardinality(input_method_codes) NOT BETWEEN 1 AND 30
    OR EXISTS (SELECT 1 FROM unnest(input_method_codes) code WHERE code IS NULL OR length(code) = 0)
  THEN RAISE EXCEPTION 'invalid checkin correction'; END IF;
  target_person := platform.telegram_checkin_person(input_token);
  IF target_person IS NULL THEN RAISE EXCEPTION 'checkin link expired or identity unavailable'; END IF;
  SELECT practice_timezone INTO practice_zone FROM identity.people WHERE id = target_person FOR UPDATE;
  today := (CURRENT_TIMESTAMP AT TIME ZONE practice_zone)::date;
  SELECT * INTO target_checkin FROM core.checkins
  WHERE id = input_checkin_id AND person_id = target_person FOR UPDATE;
  IF NOT FOUND OR NOT (target_checkin.practice_date = today OR
    (target_checkin.practice_date = today - 1
      AND (CURRENT_TIMESTAMP AT TIME ZONE practice_zone)::time < TIME '12:00'))
  THEN RAISE EXCEPTION 'checkin correction unavailable'; END IF;
  SELECT count(*) INTO method_count FROM core.practice_methods method
  WHERE method.code = ANY(input_method_codes) AND method.method_type = 'leaf' AND method.active
    AND NOT EXISTS (SELECT 1 FROM core.practice_method_platforms availability
      WHERE availability.practice_method_id = method.id
        AND availability.platform = 'telegram' AND NOT availability.available);
  IF method_count <> cardinality(input_method_codes) THEN
    RAISE EXCEPTION 'invalid or duplicate practice method';
  END IF;
  DELETE FROM core.checkin_method_selections WHERE checkin_id = input_checkin_id;
  INSERT INTO core.checkin_method_selections (checkin_id, practice_method_id)
  SELECT input_checkin_id, method.id FROM core.practice_methods method
  WHERE method.code = ANY(input_method_codes);
END;
$$;

REVOKE ALL ON FUNCTION platform.telegram_checkin_person(TEXT),
  platform.telegram_checkin_history(TEXT),
  platform.correct_telegram_checkin(TEXT, UUID, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.telegram_checkin_history(TEXT),
  platform.correct_telegram_checkin(TEXT, UUID, TEXT[]) TO qigong_api_runtime;
