ALTER TABLE identity.onboarding_applications
  ADD COLUMN learner_name TEXT,
  ADD COLUMN website_email TEXT,
  ADD COLUMN phone_e164 TEXT;

CREATE FUNCTION identity.require_application_details() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.status = 'approved' AND (
    NEW.learner_name IS NULL OR length(trim(NEW.learner_name)) NOT BETWEEN 1 AND 150
    OR NEW.website_email IS NULL OR NEW.website_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR NEW.phone_e164 IS NULL OR NEW.phone_e164 !~ '^\+[1-9][0-9]{6,14}$'
  ) THEN
    RAISE EXCEPTION 'application identity details required before approval';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER require_application_details
BEFORE INSERT OR UPDATE ON identity.onboarding_applications
FOR EACH ROW EXECUTE FUNCTION identity.require_application_details();

INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en, default_timezone)
SELECT id, 'my', 'country', '馬來西亞', 'Malaysia', 'Asia/Kuala_Lumpur'
FROM core.regions WHERE code = 'global'
ON CONFLICT (code) DO NOTHING;
INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en, default_timezone)
SELECT id, 'sg', 'country', '新加坡', 'Singapore', 'Asia/Singapore'
FROM core.regions WHERE code = 'global'
ON CONFLICT (code) DO NOTHING;
INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en, default_timezone)
SELECT id, 'hk', 'country', '香港', 'Hong Kong', 'Asia/Hong_Kong'
FROM core.regions WHERE code = 'global'
ON CONFLICT (code) DO NOTHING;
INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en, default_timezone)
SELECT id, 'other', 'country', '其它', 'Other', 'Etc/UTC'
FROM core.regions WHERE code = 'global'
ON CONFLICT (code) DO NOTHING;
INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en, default_timezone)
SELECT id, code || '-general', 'operational', name_zh_tw || '地區', name_en || ' Region', default_timezone
FROM core.regions WHERE code IN ('my', 'sg', 'hk', 'other') AND region_type = 'country'
ON CONFLICT (code) DO NOTHING;

CREATE TABLE platform.telegram_application_links (
  telegram_user_id TEXT PRIMARY KEY,
  token_hash BYTEA NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
ALTER TABLE platform.telegram_application_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.telegram_application_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.telegram_application_links FROM PUBLIC;

-- The API supplies only an HMAC-derived link token for a secret-verified Telegram update.
-- Replayed update IDs yield the same token; a new /start rotates it.
CREATE FUNCTION platform.begin_telegram_application(
  input_update_id BIGINT, input_user_id TEXT, input_token TEXT
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE prior_user_id TEXT;
DECLARE application_status TEXT;
DECLARE application_ready BOOLEAN;
BEGIN
  IF input_update_id IS NULL OR input_update_id < 0
    OR input_user_id IS NULL OR input_user_id !~ '^[0-9]{1,20}$'
    OR input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' THEN
    RAISE EXCEPTION 'invalid Telegram application link';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('telegram:' || input_user_id, 0));
  SELECT telegram_user_id INTO prior_user_id FROM platform.telegram_onboarding_updates
  WHERE update_id = input_update_id;
  IF FOUND THEN
    IF prior_user_id <> input_user_id THEN RAISE EXCEPTION 'Telegram update ID belongs to another user'; END IF;
    IF EXISTS (SELECT 1 FROM platform.telegram_application_links
      WHERE telegram_user_id = input_user_id AND token_hash = public.digest(input_token, 'sha256')
        AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP) THEN
      RETURN 'form_required';
    END IF;
    RETURN 'duplicate';
  END IF;

  SELECT status, learner_name IS NOT NULL AND website_email IS NOT NULL AND phone_e164 IS NOT NULL
  INTO application_status, application_ready FROM identity.onboarding_applications
  WHERE platform = 'telegram' AND external_subject_id = input_user_id;
  IF application_status IS NULL AND EXISTS (
    SELECT 1 FROM identity.platform_identities
    WHERE platform = 'telegram' AND external_subject_id = input_user_id AND revoked_at IS NULL
  ) THEN application_status := 'approved'; END IF;

  -- Do not replace an unredeemed link. Telegram may retry an update after a send timeout;
  -- the original link must remain usable even if a later /start arrives first.
  IF application_status IS NULL OR (application_status = 'pending' AND NOT application_ready) THEN
    IF EXISTS (SELECT 1 FROM platform.telegram_application_links
      WHERE telegram_user_id = input_user_id AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP) THEN
      INSERT INTO platform.telegram_onboarding_updates (update_id, telegram_user_id, result)
      VALUES (input_update_id, input_user_id, 'pending');
      RETURN 'link_pending';
    END IF;
  END IF;

  IF application_status IS NULL OR (application_status = 'pending' AND NOT application_ready) THEN
    INSERT INTO platform.telegram_application_links (telegram_user_id, token_hash, expires_at)
    VALUES (input_user_id, public.digest(input_token, 'sha256'), CURRENT_TIMESTAMP + INTERVAL '30 minutes')
    ON CONFLICT (telegram_user_id) DO UPDATE SET
      token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, used_at = NULL;
  END IF;
  INSERT INTO platform.telegram_onboarding_updates (update_id, telegram_user_id, result)
  VALUES (input_update_id, input_user_id, COALESCE(application_status, 'pending'));
  IF application_status IS NULL OR (application_status = 'pending' AND NOT application_ready) THEN
    RETURN 'form_required';
  END IF;
  RETURN application_status;
END;
$$;

CREATE FUNCTION platform.submit_telegram_application(
  input_token TEXT, input_name TEXT, input_email TEXT, input_phone TEXT, input_region_code TEXT
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE link_record platform.telegram_application_links%ROWTYPE;
DECLARE region_id UUID;
DECLARE application_id UUID;
DECLARE application_status TEXT;
BEGIN
  IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$'
    OR input_name IS NULL OR length(trim(input_name)) NOT BETWEEN 1 AND 150
    OR input_email IS NULL OR length(input_email) > 254
    OR input_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR input_phone IS NULL OR input_phone !~ '^\+[1-9][0-9]{6,14}$'
    OR input_region_code NOT IN ('tw-general', 'my-general', 'sg-general', 'hk-general', 'other-general')
  THEN RAISE EXCEPTION 'invalid application details'; END IF;

  SELECT * INTO link_record FROM platform.telegram_application_links
  WHERE token_hash = public.digest(input_token, 'sha256') FOR UPDATE;
  IF NOT FOUND OR link_record.expires_at <= CURRENT_TIMESTAMP OR link_record.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'application link expired or used';
  END IF;
  SELECT id INTO region_id FROM core.regions
  WHERE code = input_region_code AND region_type = 'operational' AND active;
  IF region_id IS NULL THEN RAISE EXCEPTION 'application region unavailable'; END IF;

  application_id := identity.submit_application('telegram', link_record.telegram_user_id, trim(input_name), region_id);
  SELECT status INTO application_status FROM identity.onboarding_applications
  WHERE id = application_id FOR UPDATE;
  IF application_status <> 'pending' THEN RAISE EXCEPTION 'application already reviewed'; END IF;
  UPDATE identity.onboarding_applications SET
    learner_name = trim(input_name), website_email = lower(trim(input_email)), phone_e164 = input_phone,
    display_name = trim(input_name), requested_region_id = region_id, updated_at = CURRENT_TIMESTAMP
  WHERE id = application_id;
  UPDATE platform.telegram_application_links SET used_at = CURRENT_TIMESTAMP
  WHERE telegram_user_id = link_record.telegram_user_id;
  RETURN 'pending';
END;
$$;

REVOKE ALL ON FUNCTION platform.begin_telegram_application(BIGINT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.submit_telegram_application(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.begin_telegram_application(BIGINT, TEXT, TEXT),
  platform.submit_telegram_application(TEXT, TEXT, TEXT, TEXT, TEXT) TO qigong_api_runtime;

UPDATE core.platform_metadata SET architecture_version = 'phase-2-verified-onboarding',
  updated_at = CURRENT_TIMESTAMP WHERE singleton = TRUE;
