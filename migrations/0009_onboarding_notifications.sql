CREATE TABLE ops.onboarding_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL UNIQUE REFERENCES identity.onboarding_applications(id),
  platform TEXT NOT NULL CHECK (platform IN ('line', 'telegram', 'whatsapp')),
  external_subject_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_id UUID,
  leased_until TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((lease_id IS NULL) = (leased_until IS NULL))
);

CREATE FUNCTION ops.queue_onboarding_decision() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    INSERT INTO ops.onboarding_notifications
      (application_id, platform, external_subject_id, decision)
    VALUES (NEW.id, NEW.platform, NEW.external_subject_id, NEW.status);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER queue_onboarding_decision
AFTER UPDATE OF status ON identity.onboarding_applications
FOR EACH ROW EXECUTE FUNCTION ops.queue_onboarding_decision();

ALTER TABLE ops.onboarding_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.onboarding_notifications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ops.onboarding_notifications FROM PUBLIC;

CREATE FUNCTION ops.claim_onboarding_notifications(batch_size INTEGER)
RETURNS TABLE (id UUID, lease_id UUID, platform TEXT, external_subject_id TEXT, decision TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF batch_size IS NULL OR batch_size < 1 OR batch_size > 20 THEN
    RAISE EXCEPTION 'invalid notification batch size';
  END IF;
  RETURN QUERY
  WITH selected AS (
    SELECT notification.id FROM ops.onboarding_notifications notification
    WHERE notification.status IN ('pending', 'sending')
      AND notification.attempts < 8
      AND notification.available_at <= CURRENT_TIMESTAMP
      AND (notification.status = 'pending' OR notification.leased_until < CURRENT_TIMESTAMP)
    ORDER BY notification.available_at, notification.created_at
    FOR UPDATE SKIP LOCKED LIMIT batch_size
  )
  UPDATE ops.onboarding_notifications notification
  SET status = 'sending', attempts = notification.attempts + 1,
      lease_id = gen_random_uuid(), leased_until = CURRENT_TIMESTAMP + INTERVAL '2 minutes'
  FROM selected WHERE notification.id = selected.id
  RETURNING notification.id, notification.lease_id, notification.platform,
    notification.external_subject_id, notification.decision;
END;
$$;

CREATE FUNCTION ops.finish_onboarding_notification(
  notification_id UUID, claim_id UUID, delivered BOOLEAN, failure TEXT DEFAULT NULL
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE updated_id UUID;
BEGIN
  IF delivered IS NULL OR (NOT delivered AND (failure IS NULL OR length(trim(failure)) = 0)) THEN
    RAISE EXCEPTION 'notification outcome required';
  END IF;
  UPDATE ops.onboarding_notifications notification
  SET status = CASE WHEN delivered THEN 'delivered' WHEN attempts >= 8 THEN 'failed' ELSE 'pending' END,
      available_at = CASE WHEN delivered THEN CURRENT_TIMESTAMP
        ELSE CURRENT_TIMESTAMP + (LEAST(3600, 30 * power(2, LEAST(attempts - 1, 7))) * INTERVAL '1 second') END,
      delivered_at = CASE WHEN delivered THEN CURRENT_TIMESTAMP ELSE NULL END,
      last_error = CASE WHEN delivered THEN NULL ELSE left(failure, 200) END,
      lease_id = NULL, leased_until = NULL
  WHERE notification.id = notification_id AND notification.lease_id = claim_id
    AND notification.status = 'sending' AND notification.leased_until > CURRENT_TIMESTAMP
  RETURNING notification.id INTO updated_id;
  RETURN updated_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION ops.claim_onboarding_notifications(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION ops.finish_onboarding_notification(UUID, UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.claim_onboarding_notifications(INTEGER),
  ops.finish_onboarding_notification(UUID, UUID, BOOLEAN, TEXT) TO qigong_worker_runtime;

UPDATE core.platform_metadata
SET architecture_version = 'phase-2-onboarding-notifications', updated_at = CURRENT_TIMESTAMP
WHERE singleton = TRUE;
