CREATE TABLE core.checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES identity.people(id),
  submitted_via_identity_id UUID NOT NULL,
  practice_date DATE NOT NULL,
  practice_timezone TEXT NOT NULL,
  entry_kind TEXT NOT NULL CHECK (entry_kind IN ('regular', 'makeup')),
  region_assignment_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (person_id, practice_date),
  FOREIGN KEY (submitted_via_identity_id, person_id)
    REFERENCES identity.platform_identities(id, person_id),
  FOREIGN KEY (region_assignment_id, person_id)
    REFERENCES core.person_region_assignments(id, person_id)
);
CREATE TABLE core.checkin_method_selections (
  checkin_id UUID NOT NULL REFERENCES core.checkins(id) ON DELETE CASCADE,
  practice_method_id UUID NOT NULL REFERENCES core.practice_methods(id),
  PRIMARY KEY (checkin_id, practice_method_id)
);
ALTER TABLE core.checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.checkins FORCE ROW LEVEL SECURITY;
ALTER TABLE core.checkin_method_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.checkin_method_selections FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.checkins, core.checkin_method_selections FROM PUBLIC;

CREATE TABLE platform.telegram_checkin_links (
  telegram_user_id TEXT PRIMARY KEY,
  token_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
ALTER TABLE platform.telegram_checkin_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.telegram_checkin_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.telegram_checkin_links FROM PUBLIC;

CREATE FUNCTION platform.begin_telegram_checkin(input_user_id TEXT, input_token TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE linked_person UUID;
BEGIN
  IF input_user_id IS NULL OR input_user_id !~ '^[0-9]{1,20}$'
    OR input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'invalid Telegram checkin link';
  END IF;
  SELECT identity.person_id INTO linked_person
  FROM identity.platform_identities identity
  JOIN identity.people person ON person.id = identity.person_id
  JOIN identity.person_interaction_channels channel
    ON channel.platform_identity_id = identity.id AND channel.person_id = identity.person_id
  JOIN identity.onboarding_applications application
    ON application.person_id = person.id AND application.platform = 'telegram'
      AND application.external_subject_id = input_user_id AND application.status = 'approved'
  WHERE identity.platform = 'telegram' AND identity.external_subject_id = input_user_id
    AND identity.revoked_at IS NULL AND person.status = 'active'
    AND channel.valid_to IS NULL AND channel.valid_from <= CURRENT_TIMESTAMP;
  IF linked_person IS NULL THEN RETURN 'not_approved'; END IF;
  INSERT INTO platform.telegram_checkin_links (telegram_user_id, token_hash, expires_at)
  VALUES (input_user_id, public.digest(input_token, 'sha256'), CURRENT_TIMESTAMP + INTERVAL '15 minutes')
  ON CONFLICT (telegram_user_id) DO UPDATE SET
    token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, used_at = NULL;
  RETURN 'ready';
END;
$$;

CREATE FUNCTION platform.submit_telegram_checkin(
  input_token TEXT, input_method_codes TEXT[], input_makeup BOOLEAN
) RETURNS TABLE (checkin_id UUID, practice_date DATE, entry_kind TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE link_record platform.telegram_checkin_links%ROWTYPE;
DECLARE target_person UUID;
DECLARE platform_identity UUID;
DECLARE target_assignment UUID;
DECLARE practice_zone TEXT;
DECLARE local_time TIMESTAMP;
DECLARE target_date DATE;
DECLARE new_checkin UUID;
DECLARE method_count INTEGER;
BEGIN
  IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$'
    OR input_makeup IS NULL OR input_method_codes IS NULL
    OR cardinality(input_method_codes) NOT BETWEEN 1 AND 30
    OR EXISTS (SELECT 1 FROM unnest(input_method_codes) code WHERE code IS NULL OR length(code) = 0)
  THEN RAISE EXCEPTION 'invalid checkin submission'; END IF;
  SELECT * INTO link_record FROM platform.telegram_checkin_links
  WHERE token_hash = public.digest(input_token, 'sha256') FOR UPDATE;
  IF NOT FOUND OR link_record.used_at IS NOT NULL OR link_record.expires_at <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'checkin link expired or used';
  END IF;
  SELECT person.id, identity.id, person.practice_timezone
  INTO target_person, platform_identity, practice_zone
  FROM identity.platform_identities identity
  JOIN identity.people person ON person.id = identity.person_id
  JOIN identity.person_interaction_channels channel
    ON channel.platform_identity_id = identity.id AND channel.person_id = person.id
  JOIN identity.onboarding_applications application
    ON application.person_id = person.id AND application.platform = 'telegram'
      AND application.external_subject_id = link_record.telegram_user_id
      AND application.status = 'approved'
  WHERE identity.platform = 'telegram' AND identity.external_subject_id = link_record.telegram_user_id
    AND identity.revoked_at IS NULL AND person.status = 'active'
    AND channel.valid_to IS NULL AND channel.valid_from <= CURRENT_TIMESTAMP
  FOR UPDATE OF person;
  IF target_person IS NULL THEN RAISE EXCEPTION 'checkin identity not approved or active'; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = practice_zone) THEN
    RAISE EXCEPTION 'invalid practice timezone';
  END IF;
  local_time := CURRENT_TIMESTAMP AT TIME ZONE practice_zone;
  IF input_makeup AND local_time::time >= TIME '12:00' THEN
    RAISE EXCEPTION 'makeup deadline passed';
  END IF;
  target_date := local_time::date - CASE WHEN input_makeup THEN 1 ELSE 0 END;
  SELECT assignment.id INTO target_assignment FROM core.person_region_assignments assignment
  WHERE assignment.person_id = target_person AND assignment.assignment_type = 'primary'
    AND assignment.valid_from <= target_date
    AND (assignment.valid_to IS NULL OR assignment.valid_to > target_date);
  IF target_assignment IS NULL THEN RAISE EXCEPTION 'practice date has no region assignment'; END IF;

  SELECT count(*) INTO method_count FROM core.practice_methods method
  WHERE method.code = ANY(input_method_codes) AND method.method_type = 'leaf' AND method.active
    AND NOT EXISTS (SELECT 1 FROM core.practice_method_platforms availability
      WHERE availability.practice_method_id = method.id
        AND availability.platform = 'telegram' AND NOT availability.available);
  IF method_count <> cardinality(input_method_codes) THEN
    RAISE EXCEPTION 'invalid or duplicate practice method';
  END IF;

  INSERT INTO core.checkins
    (person_id, submitted_via_identity_id, practice_date, practice_timezone,
     entry_kind, region_assignment_id)
  VALUES (target_person, platform_identity, target_date, practice_zone,
    CASE WHEN input_makeup THEN 'makeup' ELSE 'regular' END, target_assignment)
  RETURNING id INTO new_checkin;
  INSERT INTO core.checkin_method_selections (checkin_id, practice_method_id)
  SELECT new_checkin, method.id FROM core.practice_methods method
  WHERE method.code = ANY(input_method_codes);
  UPDATE platform.telegram_checkin_links SET used_at = CURRENT_TIMESTAMP
  WHERE telegram_user_id = link_record.telegram_user_id;
  RETURN QUERY SELECT new_checkin, target_date,
    CASE WHEN input_makeup THEN 'makeup' ELSE 'regular' END::TEXT;
END;
$$;

CREATE FUNCTION platform.telegram_checkin_methods(input_token TEXT)
RETURNS TABLE (code TEXT, name_zh_tw TEXT, sort_order INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT method.code, method.name_zh_tw, method.sort_order
  FROM platform.telegram_checkin_links link
  JOIN identity.platform_identities identity
    ON identity.platform = 'telegram' AND identity.external_subject_id = link.telegram_user_id
  JOIN identity.people person ON person.id = identity.person_id
  JOIN identity.onboarding_applications application
    ON application.person_id = person.id AND application.platform = 'telegram'
      AND application.external_subject_id = link.telegram_user_id AND application.status = 'approved'
  JOIN identity.person_interaction_channels channel
    ON channel.platform_identity_id = identity.id AND channel.person_id = person.id
  CROSS JOIN core.practice_methods method
  WHERE link.token_hash = public.digest(input_token, 'sha256')
    AND link.expires_at > CURRENT_TIMESTAMP AND link.used_at IS NULL
    AND identity.revoked_at IS NULL AND person.status = 'active'
    AND channel.valid_to IS NULL AND channel.valid_from <= CURRENT_TIMESTAMP
    AND method.active AND method.method_type = 'leaf'
    AND NOT EXISTS (SELECT 1 FROM core.practice_method_platforms availability
      WHERE availability.practice_method_id = method.id
        AND availability.platform = 'telegram' AND NOT availability.available)
  ORDER BY method.sort_order, method.code
$$;

REVOKE ALL ON FUNCTION platform.begin_telegram_checkin(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.submit_telegram_checkin(TEXT, TEXT[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.telegram_checkin_methods(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.begin_telegram_checkin(TEXT, TEXT),
  platform.submit_telegram_checkin(TEXT, TEXT[], BOOLEAN),
  platform.telegram_checkin_methods(TEXT) TO qigong_api_runtime;

INSERT INTO core.practice_methods (code, method_type, name_zh_tw, name_en, sort_order) VALUES
  ('dayan_chu', 'leaf', '大雁初', 'Dayan Form 1', 11),
  ('dayan_gao', 'leaf', '大雁高', 'Dayan Form 2', 12),
  ('wuqinxi_he', 'leaf', '鶴戲', 'Crane Form', 21),
  ('wuqinxi_yuan', 'leaf', '猿戲', 'Monkey Form', 22),
  ('wuqinxi_hu', 'leaf', '虎戲', 'Tiger Form', 23),
  ('wuqinxi_xiong', 'leaf', '熊戲', 'Bear Form', 24),
  ('wuqinxi_lu', 'leaf', '鹿戲', 'Deer Form', 25),
  ('huichun_chu', 'leaf', '回春初', 'Huichun Form 1', 31),
  ('huichun_zhong', 'leaf', '回春中', 'Huichun Form 2', 32),
  ('guishou_bagua', 'leaf', '八卦功', 'Bagua Practice', 41),
  ('guishou_qiankun', 'leaf', '乾坤功', 'Qiankun Practice', 42),
  ('guishou_fengxiang_guishuo', 'leaf', '鳳翔與龜縮', 'Phoenix and Turtle Form', 43),
  ('zhengyang_morning', 'leaf', '晨功', 'Morning Practice', 51),
  ('zhengyang_night', 'leaf', '夜功', 'Night Practice', 52),
  ('huanghai', 'leaf', '神奇晃海功', 'Magic Swaying Sea Gong', 60),
  ('lotus', 'leaf', '蓮花養心法', 'Lotus Heart Nourishing Method', 70),
  ('heqi', 'leaf', '和氣舒壓法', 'Heqi Relaxation Method', 80),
  ('sanwo', 'leaf', '三窩功', 'Sanwo Gong', 90),
  ('liuyin', 'leaf', '六音理臟法', 'Liuyin Organ Tuning Method', 100),
  ('jinggong_zhoutian', 'leaf', '周天靜功', 'Zhoutian Quiet Practice', 111),
  ('jinggong_qixing', 'leaf', '七星心法', 'Seven Star Method', 112),
  ('jinggong_songjing', 'leaf', '鬆靜功', 'Songjing Practice', 113)
ON CONFLICT (code) DO NOTHING;

UPDATE core.platform_metadata SET architecture_version = 'phase-3-telegram-checkin',
  updated_at = CURRENT_TIMESTAMP WHERE singleton = TRUE;
