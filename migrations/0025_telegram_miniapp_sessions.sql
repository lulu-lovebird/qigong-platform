-- Persistent buttons, verified launch exchange and independent short-lived sessions.
ALTER TABLE platform.telegram_checkin_links DROP CONSTRAINT telegram_checkin_links_pkey;
ALTER TABLE platform.telegram_checkin_links ADD PRIMARY KEY(token_hash);
CREATE INDEX telegram_checkin_sessions_subject_idx ON platform.telegram_checkin_links(telegram_user_id);
CREATE TABLE platform.telegram_miniapp_exchange_limits (
 subject_hash BYTEA PRIMARY KEY,window_start TIMESTAMPTZ NOT NULL,requests INTEGER NOT NULL CHECK(requests>0)
);
ALTER TABLE platform.telegram_miniapp_exchange_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.telegram_miniapp_exchange_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.telegram_miniapp_exchange_limits FROM PUBLIC;
CREATE OR REPLACE FUNCTION platform._pre_privacy_begin_telegram_checkin(input_user_id TEXT, input_token TEXT)
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
  IF EXISTS(SELECT 1 FROM platform.telegram_checkin_links WHERE token_hash=public.digest(input_token,'sha256') AND telegram_user_id<>input_user_id) THEN RAISE EXCEPTION 'Telegram session conflict' USING ERRCODE='42501';END IF;
  INSERT INTO platform.telegram_checkin_links (telegram_user_id, token_hash, expires_at)
  VALUES (input_user_id, public.digest(input_token, 'sha256'), CURRENT_TIMESTAMP + INTERVAL '15 minutes')
  ON CONFLICT (token_hash) DO UPDATE SET
    token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at, used_at = NULL;
  RETURN 'ready';
END;
$$;
CREATE FUNCTION platform.telegram_workspace_ready(input_subject TEXT) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT input_subject ~ '^[0-9]{1,20}$' AND EXISTS(SELECT 1 FROM identity.platform_identities i JOIN identity.people p ON p.id=i.person_id
 JOIN identity.person_interaction_channels ch ON ch.person_id=p.id AND ch.platform_identity_id=i.id JOIN identity.onboarding_applications a ON a.person_id=p.id AND a.platform='telegram' AND a.external_subject_id=i.external_subject_id AND a.status='approved'
 WHERE i.platform='telegram' AND i.external_subject_id=input_subject AND i.revoked_at IS NULL AND p.status='active' AND ch.valid_from<=clock_timestamp() AND ch.valid_to IS NULL)
$$;
CREATE FUNCTION platform.begin_telegram_miniapp_session(input_subject TEXT,input_token TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE key BYTEA;start_time TIMESTAMPTZ;count_now INTEGER;
BEGIN
 IF platform.telegram_workspace_ready(input_subject) IS NOT TRUE THEN RETURN 'unavailable';END IF;
 key:=platform.privacy_subject_hash('telegram',input_subject);start_time:=date_trunc('minute',clock_timestamp());
 INSERT INTO platform.telegram_miniapp_exchange_limits(subject_hash,window_start,requests) VALUES(key,start_time,1)
 ON CONFLICT(subject_hash) DO UPDATE SET window_start=EXCLUDED.window_start,requests=CASE WHEN telegram_miniapp_exchange_limits.window_start=EXCLUDED.window_start THEN telegram_miniapp_exchange_limits.requests+1 ELSE 1 END RETURNING requests INTO count_now;
 IF count_now>12 THEN RAISE EXCEPTION 'Mini App exchange rate limited' USING ERRCODE='42501';END IF;
 RETURN platform.begin_telegram_checkin(input_subject,input_token);
END$$;
REVOKE ALL ON FUNCTION platform.telegram_workspace_ready(TEXT),platform.begin_telegram_miniapp_session(TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.telegram_workspace_ready(TEXT),platform.begin_telegram_miniapp_session(TEXT,TEXT) TO qigong_api_runtime;
CREATE FUNCTION ops.telegram_miniapp_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-10-telegram-miniapp')$$;
REVOKE ALL ON FUNCTION ops.telegram_miniapp_schema_ready() FROM PUBLIC;GRANT EXECUTE ON FUNCTION ops.telegram_miniapp_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-10-telegram-miniapp',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
