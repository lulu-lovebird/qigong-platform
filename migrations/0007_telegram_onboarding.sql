CREATE TABLE platform.telegram_onboarding_updates (
  update_id BIGINT PRIMARY KEY CHECK (update_id >= 0),
  telegram_user_id TEXT NOT NULL,
  application_id UUID REFERENCES identity.onboarding_applications(id),
  result TEXT NOT NULL CHECK (result IN ('pending', 'approved', 'rejected')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE platform.telegram_onboarding_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.telegram_onboarding_updates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.telegram_onboarding_updates FROM PUBLIC;

CREATE FUNCTION platform.register_telegram_onboarding(
  telegram_update_id BIGINT,
  input_telegram_user_id TEXT,
  telegram_display_name TEXT,
  requested_region_code TEXT
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE existing_result TEXT;
DECLARE target_region_id UUID;
DECLARE target_application_id UUID;
BEGIN
  IF telegram_update_id IS NULL OR telegram_update_id < 0
    OR input_telegram_user_id IS NULL OR input_telegram_user_id !~ '^[0-9]{1,20}$'
    OR telegram_display_name IS NULL OR length(trim(telegram_display_name)) = 0
    OR length(telegram_display_name) > 255 THEN
    RAISE EXCEPTION 'invalid Telegram onboarding update';
  END IF;

  -- Serialize repeats for the same Telegram update without granting table access to the API role.
  PERFORM pg_advisory_xact_lock(telegram_update_id);
  SELECT result INTO existing_result FROM platform.telegram_onboarding_updates
  WHERE update_id = telegram_update_id;
  IF FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM platform.telegram_onboarding_updates
      WHERE update_id = telegram_update_id AND telegram_user_id = input_telegram_user_id) THEN
      RAISE EXCEPTION 'Telegram update ID belongs to another user';
    END IF;
    RETURN existing_result;
  END IF;

  SELECT id INTO target_region_id FROM core.regions
  WHERE code = requested_region_code AND region_type = 'operational' AND active;
  IF target_region_id IS NULL THEN RAISE EXCEPTION 'Telegram onboarding region unavailable'; END IF;

  IF EXISTS (SELECT 1 FROM identity.platform_identities
    WHERE platform = 'telegram' AND external_subject_id = input_telegram_user_id AND revoked_at IS NULL) THEN
    existing_result := 'approved';
  ELSE
    target_application_id := identity.submit_application(
      'telegram', input_telegram_user_id, telegram_display_name, target_region_id
    );
    SELECT status INTO existing_result FROM identity.onboarding_applications
    WHERE id = target_application_id;
  END IF;

  INSERT INTO platform.telegram_onboarding_updates
    (update_id, telegram_user_id, application_id, result)
  VALUES (telegram_update_id, input_telegram_user_id, target_application_id, existing_result);
  RETURN existing_result;
END;
$$;

REVOKE ALL ON FUNCTION platform.register_telegram_onboarding(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION platform.register_telegram_onboarding(BIGINT, TEXT, TEXT, TEXT)
  TO qigong_api_runtime;

UPDATE core.platform_metadata
SET architecture_version = 'phase-2-telegram-onboarding', updated_at = CURRENT_TIMESTAMP
WHERE singleton = TRUE;
