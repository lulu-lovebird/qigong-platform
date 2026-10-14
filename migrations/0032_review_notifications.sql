-- Private reviewer alerts; no historical application backfill, role grants or identity linking.
CREATE TABLE admin.review_notification_preferences (
 principal_id UUID PRIMARY KEY REFERENCES admin.principals(id),telegram_subject TEXT UNIQUE CHECK(telegram_subject ~ '^[0-9]{1,20}$'),
 admin_enabled BOOLEAN NOT NULL DEFAULT FALSE,learner_enabled BOOLEAN NOT NULL DEFAULT FALSE,locale TEXT NOT NULL DEFAULT 'zh_TW' CHECK(locale IN('zh_TW','en')),revision INTEGER NOT NULL DEFAULT 1,last_test_at TIMESTAMPTZ
);
CREATE TABLE admin.review_notification_links (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),principal_id UUID NOT NULL REFERENCES admin.principals(id),token_hash BYTEA NOT NULL UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),expires_at TIMESTAMPTZ NOT NULL,claimed_subject TEXT,code_hash BYTEA,attempts INTEGER NOT NULL DEFAULT 0,confirmed_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ
);
CREATE TABLE ops.review_notification_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),kind TEXT NOT NULL CHECK(kind IN('admin','learner','test')),target_id UUID NOT NULL,version TEXT NOT NULL,
 region_id UUID REFERENCES core.regions(id),created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),UNIQUE(kind,target_id,version)
);
CREATE TABLE ops.review_notification_deliveries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),event_id UUID NOT NULL REFERENCES ops.review_notification_events(id),principal_id UUID NOT NULL REFERENCES admin.principals(id),preferences_revision INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','cancelled','failed')),attempts INTEGER NOT NULL DEFAULT 0,
 available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+INTERVAL '30 seconds',lease_id UUID,leased_until TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),UNIQUE(event_id,principal_id)
);
ALTER TABLE admin.review_notification_preferences ENABLE ROW LEVEL SECURITY;ALTER TABLE admin.review_notification_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE admin.review_notification_links ENABLE ROW LEVEL SECURITY;ALTER TABLE admin.review_notification_links FORCE ROW LEVEL SECURITY;
ALTER TABLE ops.review_notification_events ENABLE ROW LEVEL SECURITY;ALTER TABLE ops.review_notification_events FORCE ROW LEVEL SECURITY;
ALTER TABLE ops.review_notification_deliveries ENABLE ROW LEVEL SECURITY;ALTER TABLE ops.review_notification_deliveries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON admin.review_notification_preferences,admin.review_notification_links,ops.review_notification_events,ops.review_notification_deliveries FROM PUBLIC;
CREATE INDEX review_notification_pending ON ops.review_notification_deliveries(available_at) WHERE status IN('pending','sending');
CREATE FUNCTION admin.review_notification_actor() RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE actor UUID:=admin.request_principal_id();BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin.principals p JOIN admin.role_grants g ON g.principal_id=p.id WHERE p.id=actor AND p.status='active' AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp())) THEN RAISE EXCEPTION 'review notification access denied' USING ERRCODE='42501';END IF;RETURN actor;
END$$;
CREATE FUNCTION ops.review_event_pending(input_event UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM ops.review_notification_events e WHERE e.id=input_event AND CASE e.kind
 WHEN 'admin' THEN EXISTS(SELECT 1 FROM admin.access_applications a JOIN admin.principals p ON p.id=a.principal_id WHERE a.principal_id=e.target_id AND a.status='pending' AND a.version::text=e.version AND p.status='active')
 WHEN 'learner' THEN EXISTS(SELECT 1 FROM identity.onboarding_applications a WHERE a.id=e.target_id AND a.status='pending' AND a.requested_region_id IS NOT DISTINCT FROM e.region_id AND a.learner_name IS NOT NULL AND a.website_email IS NOT NULL AND a.phone_e164 IS NOT NULL)
 ELSE e.created_at>clock_timestamp()-INTERVAL '10 minutes' END)$$;
CREATE FUNCTION admin.review_notification_can_review(input_principal UUID,input_event UUID) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE e ops.review_notification_events;saved TEXT:=current_setting('qigong.principal_id',TRUE);allowed BOOLEAN;BEGIN
 IF NOT EXISTS(SELECT 1 FROM admin.principals p JOIN admin.role_grants g ON g.principal_id=p.id WHERE p.id=input_principal AND p.status='active' AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp())) THEN RETURN FALSE;END IF;
 SELECT * INTO e FROM ops.review_notification_events WHERE id=input_event;IF NOT FOUND OR NOT ops.review_event_pending(input_event) THEN RETURN FALSE;END IF;
 PERFORM set_config('qigong.principal_id',input_principal::text,TRUE);
 IF e.kind='test' THEN allowed:=e.target_id=input_principal AND admin.review_notification_actor()=input_principal;
 ELSIF e.kind='admin' THEN allowed:=admin.can_manage_access_target(e.target_id);
 ELSE allowed:=admin.can_review_application(e.region_id);END IF;
 PERFORM set_config('qigong.principal_id',coalesce(saved,''),TRUE);RETURN coalesce(allowed,FALSE);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('qigong.principal_id',coalesce(saved,''),TRUE);RETURN FALSE;
END$$;
CREATE FUNCTION ops.capture_review_notification_event() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE old_ready BOOLEAN:=FALSE;new_ready BOOLEAN;BEGIN
 IF TG_TABLE_SCHEMA='admin' THEN
  IF NEW.status='pending' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'pending' OR OLD.version IS DISTINCT FROM NEW.version) THEN INSERT INTO ops.review_notification_events(kind,target_id,version) VALUES('admin',NEW.principal_id,NEW.version::text) ON CONFLICT DO NOTHING;END IF;
 ELSE
  new_ready:=NEW.status='pending' AND NEW.learner_name IS NOT NULL AND NEW.website_email IS NOT NULL AND NEW.phone_e164 IS NOT NULL;
  IF TG_OP='UPDATE' THEN old_ready:=OLD.status='pending' AND OLD.learner_name IS NOT NULL AND OLD.website_email IS NOT NULL AND OLD.phone_e164 IS NOT NULL;END IF;
  IF new_ready AND (NOT old_ready OR (TG_OP='UPDATE' AND NEW.requested_region_id IS DISTINCT FROM OLD.requested_region_id)) THEN INSERT INTO ops.review_notification_events(kind,target_id,version,region_id) VALUES('learner',NEW.id,NEW.updated_at::text||':'||coalesce(NEW.requested_region_id::text,''),NEW.requested_region_id) ON CONFLICT DO NOTHING;END IF;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER capture_admin_review_notification AFTER INSERT OR UPDATE ON admin.access_applications FOR EACH ROW EXECUTE FUNCTION ops.capture_review_notification_event();
CREATE TRIGGER capture_learner_review_notification AFTER INSERT OR UPDATE ON identity.onboarding_applications FOR EACH ROW EXECUTE FUNCTION ops.capture_review_notification_event();
CREATE FUNCTION admin.begin_review_notification_link(input_token TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE actor UUID;result JSONB;BEGIN
 PERFORM pg_advisory_xact_lock(1919,1);actor:=admin.review_notification_actor();
 IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'invalid review notification link';END IF;
 IF (SELECT count(*) FROM admin.review_notification_links WHERE principal_id=actor AND created_at>clock_timestamp()-INTERVAL '10 minutes')>=3 THEN RAISE EXCEPTION 'review notification link rate limited';END IF;
 INSERT INTO admin.review_notification_preferences(principal_id) VALUES(actor) ON CONFLICT DO NOTHING;
 UPDATE admin.review_notification_links SET revoked_at=clock_timestamp() WHERE principal_id=actor AND confirmed_at IS NULL AND revoked_at IS NULL;
 INSERT INTO admin.review_notification_links(principal_id,token_hash,expires_at) VALUES(actor,public.digest(input_token,'sha256'),clock_timestamp()+INTERVAL '10 minutes') RETURNING jsonb_build_object('id',id,'expiresAt',expires_at) INTO result;RETURN result;
END$$;
CREATE FUNCTION platform.claim_review_notification_link(input_token TEXT,input_subject TEXT,input_code TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE link admin.review_notification_links;BEGIN
 IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' OR input_subject IS NULL OR input_subject !~ '^[0-9]{1,20}$' OR input_code IS NULL OR input_code !~ '^[0-9]{6}$' THEN RETURN FALSE;END IF;
 SELECT * INTO link FROM admin.review_notification_links WHERE token_hash=public.digest(input_token,'sha256') AND revoked_at IS NULL AND confirmed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR link.expires_at<=clock_timestamp() THEN RETURN FALSE;END IF;
 IF link.claimed_subject IS NOT NULL THEN RETURN link.claimed_subject=input_subject AND link.code_hash=public.digest(input_code,'sha256');END IF;
 UPDATE admin.review_notification_links SET claimed_subject=input_subject,code_hash=public.digest(input_code,'sha256') WHERE id=link.id;RETURN TRUE;
END$$;
CREATE FUNCTION admin.confirm_review_notification_link(input_id UUID,input_code TEXT,input_revision INTEGER) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE actor UUID;link admin.review_notification_links;pref admin.review_notification_preferences;BEGIN
 PERFORM pg_advisory_xact_lock(1919,1);actor:=admin.review_notification_actor();SELECT * INTO pref FROM admin.review_notification_preferences WHERE principal_id=actor FOR UPDATE;
 IF pref.revision IS DISTINCT FROM input_revision THEN RAISE EXCEPTION 'review notification conflict' USING ERRCODE='40001';END IF;
 SELECT * INTO link FROM admin.review_notification_links WHERE id=input_id AND principal_id=actor AND revoked_at IS NULL AND confirmed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR link.expires_at<=clock_timestamp() OR link.attempts>=5 OR link.claimed_subject IS NULL OR input_code IS NULL OR input_code !~ '^[0-9]{6}$' THEN RETURN jsonb_build_object('confirmed',FALSE);END IF;
 IF link.code_hash<>public.digest(input_code,'sha256') THEN UPDATE admin.review_notification_links SET attempts=attempts+1,revoked_at=CASE WHEN attempts+1>=5 THEN clock_timestamp() ELSE NULL END WHERE id=link.id;RETURN jsonb_build_object('confirmed',FALSE);END IF;
 IF EXISTS(SELECT 1 FROM admin.review_notification_preferences WHERE telegram_subject=link.claimed_subject AND principal_id<>actor) THEN RAISE EXCEPTION 'review notification channel already bound';END IF;
 UPDATE admin.review_notification_preferences SET telegram_subject=link.claimed_subject,revision=revision+1 WHERE principal_id=actor;
 UPDATE admin.review_notification_links SET confirmed_at=clock_timestamp() WHERE id=link.id;
 UPDATE ops.review_notification_deliveries SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE principal_id=actor AND status IN('pending','sending');
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,outcome) VALUES(admin.request_id(),actor,'review_notification.bind','admin_principal',actor::text,'success');RETURN jsonb_build_object('confirmed',TRUE,'revision',pref.revision+1);
END$$;
CREATE FUNCTION admin.save_review_notification_preferences(input_revision INTEGER,input_admin BOOLEAN,input_learner BOOLEAN,input_locale TEXT,input_disconnect BOOLEAN DEFAULT FALSE) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE actor UUID;pref admin.review_notification_preferences;BEGIN
 PERFORM pg_advisory_xact_lock(1919,1);actor:=admin.review_notification_actor();INSERT INTO admin.review_notification_preferences(principal_id) VALUES(actor) ON CONFLICT DO NOTHING;SELECT * INTO pref FROM admin.review_notification_preferences WHERE principal_id=actor FOR UPDATE;
 IF input_revision IS DISTINCT FROM pref.revision THEN RAISE EXCEPTION 'review notification conflict' USING ERRCODE='40001';END IF;
 IF input_admin IS NULL OR input_learner IS NULL OR input_disconnect IS NULL OR input_locale IS NULL OR input_locale NOT IN('zh_TW','en') THEN RAISE EXCEPTION 'invalid review notification settings';END IF;
 IF NOT input_disconnect AND (input_admin OR input_learner) AND pref.telegram_subject IS NULL THEN RAISE EXCEPTION 'review notification channel unavailable';END IF;
 UPDATE admin.review_notification_preferences SET admin_enabled=CASE WHEN input_disconnect THEN FALSE ELSE input_admin END,learner_enabled=CASE WHEN input_disconnect THEN FALSE ELSE input_learner END,locale=input_locale,telegram_subject=CASE WHEN input_disconnect THEN NULL ELSE telegram_subject END,revision=revision+1 WHERE principal_id=actor;
 UPDATE ops.review_notification_deliveries SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE principal_id=actor AND status IN('pending','sending');
 IF input_disconnect THEN UPDATE admin.review_notification_links SET revoked_at=clock_timestamp() WHERE principal_id=actor AND confirmed_at IS NULL AND revoked_at IS NULL;END IF;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,outcome,metadata) VALUES(admin.request_id(),actor,'review_notification.preferences','admin_principal',actor::text,'success',jsonb_build_object('adminEnabled',input_admin,'learnerEnabled',input_learner,'disconnected',input_disconnect));RETURN jsonb_build_object('saved',TRUE,'revision',pref.revision+1);
END$$;
CREATE FUNCTION admin.test_review_notification() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE actor UUID;pref admin.review_notification_preferences;BEGIN
 actor:=admin.review_notification_actor();SELECT * INTO pref FROM admin.review_notification_preferences WHERE principal_id=actor FOR UPDATE;
 IF pref.telegram_subject IS NULL THEN RAISE EXCEPTION 'review notification channel unavailable';END IF;
 IF pref.last_test_at>clock_timestamp()-INTERVAL '5 minutes' THEN RAISE EXCEPTION 'review notification test rate limited';END IF;
 INSERT INTO ops.review_notification_events(kind,target_id,version) VALUES('test',actor,clock_timestamp()::text);UPDATE admin.review_notification_preferences SET last_test_at=clock_timestamp() WHERE principal_id=actor;RETURN jsonb_build_object('queued',TRUE);
END$$;
CREATE FUNCTION ops.review_delivery_eligible(input_id UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM ops.review_notification_deliveries d JOIN ops.review_notification_events e ON e.id=d.event_id JOIN admin.review_notification_preferences p ON p.principal_id=d.principal_id WHERE d.id=input_id AND p.telegram_subject IS NOT NULL AND d.preferences_revision=p.revision AND (e.kind='test' OR (e.kind='admin' AND p.admin_enabled) OR (e.kind='learner' AND p.learner_enabled)) AND admin.review_notification_can_review(p.principal_id,e.id))$$;
CREATE FUNCTION ops.queue_review_notifications(input_limit INTEGER DEFAULT 200) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE count_new INTEGER;BEGIN
 IF input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid review notification batch';END IF;
 UPDATE ops.review_notification_deliveries SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE status IN('pending','sending') AND NOT ops.review_delivery_eligible(id);
 INSERT INTO ops.review_notification_deliveries(event_id,principal_id,preferences_revision)
 SELECT e.id,p.principal_id,p.revision FROM ops.review_notification_events e CROSS JOIN admin.review_notification_preferences p
 WHERE p.telegram_subject IS NOT NULL AND ops.review_event_pending(e.id) AND (e.kind='test' OR (e.kind='admin' AND p.admin_enabled) OR (e.kind='learner' AND p.learner_enabled)) AND admin.review_notification_can_review(p.principal_id,e.id)
 AND NOT EXISTS(SELECT 1 FROM ops.review_notification_deliveries d WHERE d.event_id=e.id AND d.principal_id=p.principal_id AND NOT(d.status='cancelled' AND d.preferences_revision<>p.revision)) ORDER BY e.created_at,e.id,p.principal_id LIMIT input_limit ON CONFLICT(event_id,principal_id) DO UPDATE SET preferences_revision=EXCLUDED.preferences_revision,status='pending',attempts=0,available_at=clock_timestamp()+INTERVAL '30 seconds',lease_id=NULL,leased_until=NULL WHERE review_notification_deliveries.status='cancelled' AND review_notification_deliveries.preferences_revision<>EXCLUDED.preferences_revision;
 GET DIAGNOSTICS count_new=ROW_COUNT;RETURN count_new;
END$$;
CREATE FUNCTION ops.claim_review_notifications(input_limit INTEGER DEFAULT 5) RETURNS TABLE(id UUID,lease_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE first RECORD;ids UUID[];lease UUID;n INTEGER:=0;BEGIN
 IF input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'invalid review notification batch';END IF;
 UPDATE ops.review_notification_deliveries d SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE d.status IN('pending','sending') AND NOT ops.review_delivery_eligible(d.id);
 WHILE n<input_limit LOOP
  SELECT d.id,d.principal_id,e.kind,e.region_id INTO first FROM ops.review_notification_deliveries d JOIN ops.review_notification_events e ON e.id=d.event_id WHERE d.available_at<=clock_timestamp() AND d.attempts<8 AND (d.status='pending' OR (d.status='sending' AND d.leased_until<clock_timestamp())) AND ops.review_delivery_eligible(d.id) ORDER BY d.available_at,d.id LIMIT 1 FOR UPDATE OF d SKIP LOCKED;
  IF NOT FOUND THEN EXIT;END IF;
  SELECT array_agg(x.id) INTO ids FROM(SELECT d.id FROM ops.review_notification_deliveries d JOIN ops.review_notification_events e ON e.id=d.event_id WHERE d.principal_id=first.principal_id AND e.kind=first.kind AND e.region_id IS NOT DISTINCT FROM first.region_id AND d.available_at<=clock_timestamp() AND d.attempts<8 AND (d.status='pending' OR (d.status='sending' AND d.leased_until<clock_timestamp())) AND ops.review_delivery_eligible(d.id) ORDER BY (d.id=first.id) DESC,d.available_at,d.id LIMIT 50 FOR UPDATE OF d SKIP LOCKED) x;
  lease:=gen_random_uuid();UPDATE ops.review_notification_deliveries d SET status='sending',attempts=attempts+1,lease_id=lease,leased_until=clock_timestamp()+INTERVAL '2 minutes' WHERE d.id=ANY(ids);id:=first.id;lease_id:=lease;RETURN NEXT;n:=n+1;
 END LOOP;
 UPDATE ops.review_notification_deliveries SET status='failed',lease_id=NULL,leased_until=NULL WHERE status='sending' AND attempts>=8 AND leased_until<clock_timestamp();
END$$;
CREATE FUNCTION ops.review_notification_payload(input_id UUID,input_lease UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE principal UUID;kind TEXT;region UUID;count_now INTEGER;pref admin.review_notification_preferences;BEGIN
 SELECT d.principal_id,e.kind,e.region_id INTO principal,kind,region FROM ops.review_notification_deliveries d JOIN ops.review_notification_events e ON e.id=d.event_id WHERE d.id=input_id AND d.status='sending' AND d.lease_id=input_lease AND d.leased_until>clock_timestamp();IF NOT FOUND THEN RETURN jsonb_build_object('allowed',FALSE);END IF;
 SELECT * INTO pref FROM admin.review_notification_preferences WHERE principal_id=principal;
 SELECT count(*)::integer INTO count_now FROM ops.review_notification_deliveries WHERE lease_id=input_lease AND principal_id=principal AND status='sending' AND leased_until>clock_timestamp() AND ops.review_delivery_eligible(id);
 IF count_now=0 OR pref.telegram_subject IS NULL THEN RETURN jsonb_build_object('allowed',FALSE);END IF;
 RETURN jsonb_build_object('allowed',TRUE,'recipient',pref.telegram_subject,'kind',kind,'count',count_now,'locale',pref.locale,'region',CASE WHEN region IS NULL THEN NULL ELSE (SELECT name_zh_tw FROM core.regions WHERE id=region) END);
END$$;
CREATE FUNCTION ops.finish_review_notification(input_id UUID,input_lease UUID,input_sent BOOLEAN) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE principal UUID;BEGIN
 IF input_sent IS NULL THEN RETURN FALSE;END IF;
 SELECT principal_id INTO principal FROM ops.review_notification_deliveries WHERE id=input_id AND lease_id=input_lease AND status='sending' AND leased_until>clock_timestamp();IF NOT FOUND THEN RETURN FALSE;END IF;
 UPDATE ops.review_notification_deliveries SET status=CASE WHEN NOT ops.review_delivery_eligible(id) THEN 'cancelled' WHEN input_sent THEN 'sent' WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,available_at=clock_timestamp()+INTERVAL '1 minute'*least(15,power(2,attempts)::integer),lease_id=NULL,leased_until=NULL WHERE principal_id=principal AND lease_id=input_lease AND status='sending' AND leased_until>clock_timestamp();RETURN FOUND;
END$$;
CREATE FUNCTION admin.review_notification_state() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE actor UUID;pref admin.review_notification_preferences;events JSONB;BEGIN
 actor:=admin.review_notification_actor();INSERT INTO admin.review_notification_preferences(principal_id) VALUES(actor) ON CONFLICT DO NOTHING;SELECT * INTO pref FROM admin.review_notification_preferences WHERE principal_id=actor;
 SELECT coalesce(jsonb_agg(data),'[]') INTO events FROM(SELECT jsonb_build_object('id',e.id,'kind',e.kind,'createdAt',e.created_at,'region',r.name_zh_tw,'deliveryStatus',(SELECT d.status FROM ops.review_notification_deliveries d WHERE d.event_id=e.id AND d.principal_id=actor)) data FROM ops.review_notification_events e LEFT JOIN core.regions r ON r.id=e.region_id WHERE e.kind<>'test' AND admin.review_notification_can_review(actor,e.id) ORDER BY e.created_at DESC LIMIT 20) x;
 RETURN jsonb_build_object('revision',pref.revision,'bound',pref.telegram_subject IS NOT NULL,'recipientHint',CASE WHEN pref.telegram_subject IS NULL THEN NULL ELSE '••••'||right(pref.telegram_subject,4) END,'adminEnabled',pref.admin_enabled,'learnerEnabled',pref.learner_enabled,'locale',pref.locale,'pendingCount',(SELECT count(*) FROM ops.review_notification_events e WHERE e.kind<>'test' AND admin.review_notification_can_review(actor,e.id)),
 'unroutedCount',(SELECT count(*) FROM ops.review_notification_events e WHERE e.kind<>'test' AND admin.review_notification_can_review(actor,e.id) AND NOT EXISTS(SELECT 1 FROM ops.review_notification_deliveries d WHERE d.event_id=e.id AND d.status IN('pending','sending','sent') AND ops.review_delivery_eligible(d.id))),
 'failedCount',(SELECT count(*) FROM ops.review_notification_deliveries d WHERE d.principal_id=actor AND d.status='failed' AND ops.review_delivery_eligible(d.id)),
 'link',(SELECT jsonb_build_object('id',id,'claimed',claimed_subject IS NOT NULL,'expiresAt',expires_at) FROM admin.review_notification_links WHERE principal_id=actor AND revoked_at IS NULL AND confirmed_at IS NULL AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 1),'events',events);
END$$;
CREATE FUNCTION ops.review_notification_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-17-review-notifications')$$;
DO $$DECLARE r RECORD;BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='admin' AND p.proname IN('review_notification_actor','review_notification_can_review','begin_review_notification_link','confirm_review_notification_link','save_review_notification_preferences','test_review_notification','review_notification_state')) OR (n.nspname='platform' AND p.proname='claim_review_notification_link') OR (n.nspname='ops' AND p.proname IN('review_event_pending','capture_review_notification_event','review_delivery_eligible','queue_review_notifications','claim_review_notifications','review_notification_payload','finish_review_notification','review_notification_schema_ready')) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',r.signature);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION admin.begin_review_notification_link(TEXT),admin.confirm_review_notification_link(UUID,TEXT,INTEGER),admin.save_review_notification_preferences(INTEGER,BOOLEAN,BOOLEAN,TEXT,BOOLEAN),admin.test_review_notification(),admin.review_notification_state(),platform.claim_review_notification_link(TEXT,TEXT,TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION ops.queue_review_notifications(INTEGER),ops.claim_review_notifications(INTEGER),ops.review_notification_payload(UUID,UUID),ops.finish_review_notification(UUID,UUID,BOOLEAN) TO qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION ops.review_notification_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-17-review-notifications',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
