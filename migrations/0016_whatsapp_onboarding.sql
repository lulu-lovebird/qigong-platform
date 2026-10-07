CREATE TABLE platform.whatsapp_events (
  message_id TEXT PRIMARY KEY, subject TEXT NOT NULL, payload_hash TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE platform.whatsapp_links (
  subject TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('apply','checkin')),
  token_hash BYTEA NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ,
  PRIMARY KEY(subject,purpose)
);
CREATE TABLE platform.whatsapp_notification_consents (
  subject TEXT PRIMARY KEY, allowed BOOLEAN NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE platform.whatsapp_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.whatsapp_events FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.whatsapp_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.whatsapp_links FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.whatsapp_notification_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.whatsapp_notification_consents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.whatsapp_events,platform.whatsapp_links,platform.whatsapp_notification_consents FROM PUBLIC;

-- Commit the inbox marker and domain writes with the adapter reply transaction.
-- A failed transaction is retryable. Provider acceptance followed by commit failure can duplicate replies.
CREATE FUNCTION platform.begin_whatsapp_event(input_id TEXT,input_subject TEXT,input_hash TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF input_id IS NULL OR length(input_id) NOT BETWEEN 1 AND 256 OR input_subject IS NULL
    OR input_subject !~ '^[0-9]{1,20}$' OR input_hash IS NULL OR input_hash !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'invalid WhatsApp event'; END IF;
  INSERT INTO platform.whatsapp_events(message_id,subject,payload_hash) VALUES(input_id,input_subject,input_hash) ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN TRUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM platform.whatsapp_events WHERE message_id=input_id AND subject=input_subject AND payload_hash=input_hash)
  THEN RAISE EXCEPTION 'WhatsApp event ID conflict'; END IF;
  RETURN FALSE;
END;
$$;
CREATE FUNCTION platform.whatsapp_notification_allowed(input_subject TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT coalesce((SELECT allowed FROM platform.whatsapp_notification_consents WHERE subject=input_subject),FALSE)
$$;
CREATE FUNCTION platform.withdraw_whatsapp_notifications(input_subject TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF input_subject IS NULL OR input_subject !~ '^[0-9]{1,20}$' THEN RAISE EXCEPTION 'invalid WhatsApp subject'; END IF;
  INSERT INTO platform.whatsapp_notification_consents(subject,allowed) VALUES(input_subject,FALSE)
  ON CONFLICT(subject) DO UPDATE SET allowed=FALSE,updated_at=CURRENT_TIMESTAMP;
END;
$$;
CREATE FUNCTION platform.whatsapp_checkin_person(input_user_id TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT person.id FROM identity.platform_identities identity
  JOIN identity.people person ON person.id = identity.person_id
  JOIN identity.onboarding_applications application ON application.person_id = person.id
    AND application.platform = 'whatsapp' AND application.external_subject_id = input_user_id
    AND application.status = 'approved'
  JOIN identity.person_interaction_channels channel ON channel.person_id = person.id
    AND channel.platform_identity_id = identity.id
  WHERE input_user_id ~ '^[0-9]{1,20}$' AND identity.platform = 'whatsapp'
    AND identity.external_subject_id = input_user_id AND identity.revoked_at IS NULL
    AND person.status = 'active' AND channel.valid_from <= CURRENT_TIMESTAMP
    AND channel.valid_to IS NULL LIMIT 1
$$;

CREATE FUNCTION platform.whatsapp_checkin_method_tree(input_user_id TEXT)
RETURNS TABLE (code TEXT, name_zh_tw TEXT, sort_order INTEGER,
  parent_code TEXT, parent_name_zh_tw TEXT, parent_sort_order INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT method.code, method.name_zh_tw, method.sort_order,
    parent.code, parent.name_zh_tw, parent.sort_order
  FROM core.practice_methods method
  LEFT JOIN core.practice_methods parent ON parent.id = method.parent_id
  WHERE platform.whatsapp_checkin_person(input_user_id) IS NOT NULL
    AND method.active AND method.method_type = 'leaf'
    AND NOT EXISTS (SELECT 1 FROM core.practice_method_platforms availability
      WHERE availability.practice_method_id = method.id AND availability.platform = 'whatsapp'
        AND NOT availability.available)
  ORDER BY coalesce(parent.sort_order, method.sort_order), method.sort_order, method.code
$$;

CREATE FUNCTION platform.whatsapp_checkin_history(input_user_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_person UUID := platform.whatsapp_checkin_person(input_user_id);
DECLARE zone TEXT;
DECLARE today DATE;
DECLARE last_day DATE;
DECLARE consecutive INTEGER;
DECLARE total INTEGER;
DECLARE entries JSONB;
BEGIN
  IF target_person IS NULL THEN RAISE EXCEPTION 'WhatsApp checkin identity unavailable'; END IF;
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

CREATE FUNCTION platform.submit_whatsapp_checkin(input_user_id TEXT, input_method_codes TEXT[], input_makeup BOOLEAN)
RETURNS TABLE (checkin_id UUID, practice_date DATE, entry_kind TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_person UUID := platform.whatsapp_checkin_person(input_user_id);
DECLARE identity_id UUID;
DECLARE assignment_id UUID;
DECLARE zone TEXT;
DECLARE practice_day DATE;
DECLARE inserted_id UUID;
DECLARE method_count INTEGER;
BEGIN
  IF target_person IS NULL THEN RAISE EXCEPTION 'WhatsApp checkin identity unavailable'; END IF;
  IF input_makeup IS NULL OR input_method_codes IS NULL
    OR cardinality(input_method_codes) NOT BETWEEN 1 AND 30
    OR EXISTS (SELECT 1 FROM unnest(input_method_codes) code WHERE code IS NULL OR length(code) = 0)
  THEN RAISE EXCEPTION 'invalid checkin submission'; END IF;
  SELECT id INTO identity_id FROM identity.platform_identities
    WHERE person_id = target_person AND platform = 'whatsapp' AND external_subject_id = input_user_id;
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
        WHERE availability.practice_method_id = method.id AND availability.platform = 'whatsapp' AND NOT availability.available);
  IF method_count <> cardinality(input_method_codes) THEN RAISE EXCEPTION 'invalid or duplicate practice method'; END IF;
  INSERT INTO core.checkins (person_id, submitted_via_identity_id, practice_date, practice_timezone, entry_kind, region_assignment_id)
    VALUES (target_person, identity_id, practice_day, zone,
      CASE WHEN input_makeup THEN 'makeup' ELSE 'regular' END, assignment_id) RETURNING id INTO inserted_id;
  INSERT INTO core.checkin_method_selections (checkin_id, practice_method_id)
    SELECT inserted_id, method.id FROM core.practice_methods method WHERE method.code = ANY(input_method_codes);
  RETURN QUERY SELECT inserted_id, practice_day, CASE WHEN input_makeup THEN 'makeup' ELSE 'regular' END::TEXT;
END;
$$;

CREATE FUNCTION platform.correct_whatsapp_checkin(input_user_id TEXT, input_checkin_id UUID, input_method_codes TEXT[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_person UUID := platform.whatsapp_checkin_person(input_user_id);
DECLARE target_checkin core.checkins%ROWTYPE;
DECLARE zone TEXT;
DECLARE today DATE;
DECLARE method_count INTEGER;
BEGIN
  IF target_person IS NULL THEN RAISE EXCEPTION 'WhatsApp checkin identity unavailable'; END IF;
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
        WHERE availability.practice_method_id = method.id AND availability.platform = 'whatsapp' AND NOT availability.available);
  IF method_count <> cardinality(input_method_codes) THEN RAISE EXCEPTION 'invalid or duplicate practice method'; END IF;
  DELETE FROM core.checkin_method_selections WHERE checkin_id = input_checkin_id;
  INSERT INTO core.checkin_method_selections (checkin_id, practice_method_id)
    SELECT input_checkin_id, method.id FROM core.practice_methods method WHERE method.code = ANY(input_method_codes);
END;
$$;

CREATE FUNCTION platform.whatsapp_checkin_history(input_user_id TEXT,input_locale TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB := platform.whatsapp_checkin_history(input_user_id);
DECLARE entries JSONB;
BEGIN
  IF input_locale IS NULL OR input_locale NOT IN ('zh_TW','en') THEN RAISE EXCEPTION 'invalid identity locale'; END IF;
  IF input_locale='en' THEN
    SELECT coalesce(jsonb_agg(entry || jsonb_build_object('method_names',(
      SELECT jsonb_agg(method.name_en ORDER BY codes.position)
      FROM jsonb_array_elements_text(entry->'method_codes') WITH ORDINALITY codes(code,position)
      JOIN core.practice_methods method ON method.code=codes.code
    )) ORDER BY entry->>'practice_date' DESC),'[]'::jsonb) INTO entries
    FROM jsonb_array_elements(result->'entries') entry;
    result := jsonb_set(result,'{entries}',entries);
  END IF;
  RETURN result;
END;
$$;

CREATE FUNCTION platform.begin_whatsapp_link(input_subject TEXT,input_token TEXT,input_purpose TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state TEXT;
BEGIN
  IF input_subject IS NULL OR input_subject !~ '^[0-9]{1,20}$' OR input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$'
    OR input_purpose IS NULL OR input_purpose NOT IN ('apply','checkin') THEN RAISE EXCEPTION 'invalid WhatsApp link'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp:'||input_subject,0));
  IF input_purpose='checkin' THEN
    IF platform.whatsapp_checkin_person(input_subject) IS NULL THEN RETURN 'unavailable'; END IF;
    state := 'ready';
  ELSE
    SELECT status INTO state FROM identity.onboarding_applications WHERE platform='whatsapp' AND external_subject_id=input_subject;
    IF state IS NOT NULL THEN RETURN state; END IF;
    IF EXISTS(SELECT 1 FROM platform.whatsapp_links WHERE subject=input_subject AND purpose='apply' AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP) THEN RETURN 'link_pending'; END IF;
    state := 'form_required';
  END IF;
  INSERT INTO platform.whatsapp_links(subject,purpose,token_hash,expires_at)
  VALUES(input_subject,input_purpose,public.digest(input_token,'sha256'),CURRENT_TIMESTAMP+CASE WHEN input_purpose='apply' THEN INTERVAL '30 minutes' ELSE INTERVAL '15 minutes' END)
  ON CONFLICT(subject,purpose) DO UPDATE SET token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,used_at=NULL;
  RETURN state;
END;
$$;
CREATE FUNCTION platform.whatsapp_link_subject(input_token TEXT,input_purpose TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target TEXT;
BEGIN
  IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' OR input_purpose IS NULL OR input_purpose NOT IN ('apply','checkin') THEN RAISE EXCEPTION 'invalid WhatsApp link'; END IF;
  SELECT subject INTO target FROM platform.whatsapp_links WHERE token_hash=public.digest(input_token,'sha256') AND purpose=input_purpose
    AND expires_at>CURRENT_TIMESTAMP AND (input_purpose='checkin' OR used_at IS NULL);
  IF target IS NULL OR (input_purpose='checkin' AND platform.whatsapp_checkin_person(target) IS NULL) THEN RAISE EXCEPTION 'invalid WhatsApp link'; END IF;
  RETURN target;
END;
$$;
CREATE FUNCTION platform.set_whatsapp_locale_by_token(input_token TEXT,input_locale TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target TEXT;
DECLARE purpose TEXT;
BEGIN
  SELECT link.purpose INTO purpose FROM platform.whatsapp_links link WHERE token_hash=public.digest(input_token,'sha256');
  target := platform.whatsapp_link_subject(input_token,purpose);
  PERFORM platform.set_identity_locale('whatsapp',target,input_locale);
END;
$$;
CREATE FUNCTION platform.submit_whatsapp_application(input_token TEXT,input_name TEXT,input_email TEXT,input_phone TEXT,input_region TEXT,input_locale TEXT,input_consent BOOLEAN)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target TEXT;
DECLARE region UUID;
DECLARE application UUID;
BEGIN
  IF input_name IS NULL OR length(trim(input_name)) NOT BETWEEN 1 AND 150 OR input_email IS NULL OR length(input_email)>254
    OR input_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR input_phone IS NULL OR input_phone !~ '^\+[1-9][0-9]{6,14}$'
    OR input_region IS NULL OR input_region NOT IN ('tw-general','my-general','sg-general','hk-general','other-general') OR input_consent IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'invalid WhatsApp application'; END IF;
  SELECT subject INTO target FROM platform.whatsapp_links WHERE token_hash=public.digest(input_token,'sha256') AND purpose='apply' AND expires_at>CURRENT_TIMESTAMP AND used_at IS NULL FOR UPDATE;
  IF target IS NULL THEN RAISE EXCEPTION 'invalid WhatsApp link'; END IF;
  SELECT id INTO region FROM core.regions WHERE code=input_region AND region_type='operational' AND active;
  IF region IS NULL THEN RAISE EXCEPTION 'WhatsApp region unavailable'; END IF;
  application := identity.submit_application('whatsapp',target,trim(input_name),region);
  UPDATE identity.onboarding_applications SET learner_name=trim(input_name),website_email=lower(trim(input_email)),phone_e164=input_phone,display_name=trim(input_name)
  WHERE id=application AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'WhatsApp application already reviewed'; END IF;
  PERFORM platform.set_identity_locale('whatsapp',target,input_locale);
  INSERT INTO platform.whatsapp_notification_consents(subject,allowed) VALUES(target,TRUE)
  ON CONFLICT(subject) DO UPDATE SET allowed=TRUE,updated_at=CURRENT_TIMESTAMP;
  UPDATE platform.whatsapp_links SET used_at=CURRENT_TIMESTAMP WHERE subject=target AND purpose='apply';
  RETURN 'pending';
END;
$$;
CREATE FUNCTION platform.whatsapp_localized_methods(input_user_id TEXT)
RETURNS TABLE(code TEXT,name_zh_tw TEXT,sort_order INTEGER,parent_code TEXT,parent_name_zh_tw TEXT,parent_sort_order INTEGER,name_en TEXT,parent_name_en TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT tree.*,method.name_en,parent.name_en FROM platform.whatsapp_checkin_method_tree(input_user_id) tree
  JOIN core.practice_methods method ON method.code=tree.code LEFT JOIN core.practice_methods parent ON parent.code=tree.parent_code
$$;
REVOKE ALL ON FUNCTION platform.begin_whatsapp_event(TEXT,TEXT,TEXT),platform.withdraw_whatsapp_notifications(TEXT),platform.whatsapp_notification_allowed(TEXT),
  platform.whatsapp_checkin_person(TEXT),platform.whatsapp_checkin_method_tree(TEXT),platform.whatsapp_checkin_history(TEXT),platform.whatsapp_checkin_history(TEXT,TEXT),
  platform.submit_whatsapp_checkin(TEXT,TEXT[],BOOLEAN),platform.correct_whatsapp_checkin(TEXT,UUID,TEXT[]),platform.begin_whatsapp_link(TEXT,TEXT,TEXT),
  platform.whatsapp_link_subject(TEXT,TEXT),platform.set_whatsapp_locale_by_token(TEXT,TEXT),platform.submit_whatsapp_application(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN),platform.whatsapp_localized_methods(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.begin_whatsapp_event(TEXT,TEXT,TEXT),platform.withdraw_whatsapp_notifications(TEXT),platform.whatsapp_checkin_person(TEXT),
  platform.whatsapp_checkin_method_tree(TEXT),platform.whatsapp_checkin_history(TEXT),platform.whatsapp_checkin_history(TEXT,TEXT),platform.submit_whatsapp_checkin(TEXT,TEXT[],BOOLEAN),
  platform.correct_whatsapp_checkin(TEXT,UUID,TEXT[]),platform.begin_whatsapp_link(TEXT,TEXT,TEXT),platform.whatsapp_link_subject(TEXT,TEXT),platform.set_whatsapp_locale_by_token(TEXT,TEXT),
  platform.submit_whatsapp_application(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN),platform.whatsapp_localized_methods(TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION platform.whatsapp_notification_allowed(TEXT) TO qigong_worker_runtime;
