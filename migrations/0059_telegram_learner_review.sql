-- Learner-only private review. Existing subscriptions remain count-only.
-- Owners intentionally follow 0032/0014 (migration owner); no runtime table grants.
-- A protocol ACK from the current verified form submission, NOT proof of reading
-- or legal consent. Historical applications remain NULL; there is no backfill.
ALTER TABLE identity.onboarding_applications ADD COLUMN telegram_review_notice_version TEXT
 CHECK(telegram_review_notice_version IS NULL OR telegram_review_notice_version='telegram-learner-review-v1');

-- Delegate all existing privacy/invitation/token/ownership checks unchanged.
-- No application ID or principal is accepted; only the successfully submitted
-- pending application belonging to the verified source receives the receipt.
CREATE FUNCTION platform.submit_line_application_v2(input_user TEXT,input_token TEXT,input_name TEXT,input_email TEXT,input_phone TEXT,input_region TEXT,input_notice_version TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result TEXT;BEGIN
 IF input_notice_version IS DISTINCT FROM 'telegram-learner-review-v1' THEN RAISE EXCEPTION 'invalid application notice version';END IF;
 result:=platform.submit_line_application(input_user,input_token,input_name,input_email,input_phone,input_region);
 UPDATE identity.onboarding_applications SET telegram_review_notice_version=input_notice_version
 WHERE result='pending' AND platform='line' AND external_subject_id=input_user AND status='pending'
 AND learner_name IS NOT NULL AND website_email IS NOT NULL AND phone_e164 IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'application receipt unavailable';END IF;
 RETURN result;
END$$;
CREATE FUNCTION platform.submit_telegram_application_v2(input_token TEXT,input_name TEXT,input_email TEXT,input_phone TEXT,input_region TEXT,input_notice_version TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result TEXT;target TEXT;BEGIN
 IF input_notice_version IS DISTINCT FROM 'telegram-learner-review-v1' THEN RAISE EXCEPTION 'invalid application notice version';END IF;
 result:=platform.submit_telegram_application(input_token,input_name,input_email,input_phone,input_region);
 -- The delegated function consumed and locked this exact link in this transaction.
 SELECT telegram_user_id INTO target FROM platform.telegram_application_links
 WHERE token_hash=public.digest(input_token,'sha256') AND used_at IS NOT NULL;
 UPDATE identity.onboarding_applications SET telegram_review_notice_version=input_notice_version
 WHERE result='pending' AND platform='telegram' AND external_subject_id=target AND status='pending'
 AND learner_name IS NOT NULL AND website_email IS NOT NULL AND phone_e164 IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'application receipt unavailable';END IF;
 RETURN result;
END$$;
CREATE FUNCTION platform.submit_whatsapp_application_v2(input_token TEXT,input_name TEXT,input_email TEXT,input_phone TEXT,input_region TEXT,input_locale TEXT,input_consent BOOLEAN,input_notice_version TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result TEXT;target TEXT;BEGIN
 IF input_notice_version IS DISTINCT FROM 'telegram-learner-review-v1' THEN RAISE EXCEPTION 'invalid application notice version';END IF;
 result:=platform.submit_whatsapp_application(input_token,input_name,input_email,input_phone,input_region,input_locale,input_consent);
 SELECT subject INTO target FROM platform.whatsapp_links
 WHERE token_hash=public.digest(input_token,'sha256') AND purpose='apply' AND used_at IS NOT NULL;
 UPDATE identity.onboarding_applications SET telegram_review_notice_version=input_notice_version
 WHERE result='pending' AND platform='whatsapp' AND external_subject_id=target AND status='pending'
 AND learner_name IS NOT NULL AND website_email IS NOT NULL AND phone_e164 IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'application receipt unavailable';END IF;
 RETURN result;
END$$;

ALTER TABLE admin.review_notification_preferences
 ADD COLUMN learner_review_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN learner_review_disclosure TEXT;

CREATE FUNCTION admin.reset_telegram_learner_review_consent() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF NEW.revision IS DISTINCT FROM OLD.revision OR NEW.telegram_subject IS DISTINCT FROM OLD.telegram_subject
 OR NOT NEW.learner_enabled THEN
  NEW.learner_review_enabled:=FALSE;NEW.learner_review_disclosure:=NULL;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER reset_telegram_learner_review_consent BEFORE UPDATE ON admin.review_notification_preferences
 FOR EACH ROW EXECUTE FUNCTION admin.reset_telegram_learner_review_consent();

-- Exact 0019 admin.is_super_admin semantics, without accepting a runtime actor.
-- Internal only: callers derive the principal from context or confirmed binding/token.
CREATE FUNCTION ops.telegram_learner_review_allowed(input_principal UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id
 JOIN admin.principals p ON p.id=g.principal_id WHERE p.id=input_principal
 AND p.status='active' AND r.code='super_admin' AND g.scope_type='global'
 AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()))
$$;

CREATE FUNCTION admin.save_telegram_learner_review_preferences(input_revision INTEGER,input_admin BOOLEAN,input_learner BOOLEAN,input_locale TEXT,input_disconnect BOOLEAN,input_direct BOOLEAN,input_disclosure TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result JSONB;actor UUID;BEGIN
 IF input_direct IS NULL OR (input_direct AND (input_disclosure IS DISTINCT FROM 'telegram-learner-review-v1' OR NOT input_learner OR input_disconnect)) THEN RAISE EXCEPTION 'invalid review notification settings';END IF;
 actor:=admin.review_notification_actor();
 IF input_direct AND NOT ops.telegram_learner_review_allowed(actor) THEN RAISE EXCEPTION 'review notification access denied' USING ERRCODE='42501';END IF;
 result:=admin.save_review_notification_preferences(input_revision,input_admin,input_learner,input_locale,input_disconnect);
 UPDATE admin.review_notification_preferences SET learner_review_enabled=input_direct,
 learner_review_disclosure=CASE WHEN input_direct THEN input_disclosure ELSE NULL END WHERE principal_id=actor;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,outcome,metadata)
 VALUES(admin.request_id(),actor,'review_notification.direct_consent','admin_principal',actor::text,'success',jsonb_build_object('enabled',input_direct,'disclosure',CASE WHEN input_direct THEN input_disclosure ELSE NULL END));
 RETURN result;
END$$;
ALTER FUNCTION admin.review_notification_state() RENAME TO review_notification_state_58;
CREATE FUNCTION admin.review_notification_state() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result JSONB;BEGIN
 result:=admin.review_notification_state_58();RETURN result||
 (SELECT jsonb_build_object('isSuperAdmin',ops.telegram_learner_review_allowed(p.principal_id),'learnerReviewEnabled',p.learner_review_enabled,'learnerReviewDisclosure','telegram-learner-review-v1',
 'unroutedCount',(SELECT count(*) FROM ops.review_notification_events e WHERE e.kind<>'test' AND admin.review_notification_can_review(p.principal_id,e.id)
 AND NOT EXISTS(SELECT 1 FROM ops.review_notification_deliveries d WHERE d.event_id=e.id AND d.status IN('pending','sending','sent') AND ops.review_delivery_eligible(d.id))
 AND NOT EXISTS(SELECT 1 FROM ops.telegram_learner_reviews t WHERE current_setting('qigong.telegram_learner_review_enabled',TRUE)='true' AND t.event_id=e.id AND t.delivery_state IN('pending','sending','sent') AND ops.telegram_learner_review_eligible(t.id))),
 'failedCount',coalesce((result->>'failedCount')::integer,0)+(SELECT count(*) FROM ops.telegram_learner_reviews t WHERE t.principal_id=p.principal_id AND t.delivery_state='failed' AND ops.telegram_learner_review_eligible(t.id)))
 FROM admin.review_notification_preferences p WHERE p.principal_id=admin.review_notification_actor());
END$$;

CREATE TABLE ops.telegram_learner_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),event_id UUID NOT NULL REFERENCES ops.review_notification_events(id),
 principal_id UUID NOT NULL REFERENCES admin.principals(id),preferences_revision INTEGER NOT NULL,
 application_id UUID NOT NULL REFERENCES identity.onboarding_applications(id),region_id UUID NOT NULL REFERENCES core.regions(id),snapshot BYTEA NOT NULL,
 delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK(delivery_state IN('pending','sending','sent','cancelled','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),lease_id UUID,leased_until TIMESTAMPTZ,
 message_id BIGINT CHECK(message_id>0),token_hash BYTEA UNIQUE CHECK(octet_length(token_hash)=32),expires_at TIMESTAMPTZ,
 stage TEXT NOT NULL DEFAULT 'ready' CHECK(stage IN('ready','deny','input','confirm_approve','confirm_deny','closed')),
 prompt_message_id BIGINT CHECK(prompt_message_id>0),reason TEXT CHECK(length(reason) BETWEEN 1 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),UNIQUE(event_id,principal_id,preferences_revision)
);
ALTER TABLE ops.telegram_learner_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.telegram_learner_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ops.telegram_learner_reviews FROM PUBLIC;
CREATE INDEX telegram_learner_reviews_pending ON ops.telegram_learner_reviews(available_at) WHERE delivery_state IN('pending','sending');

-- The legacy count lease remains unchanged for count-only learner/admin/test subscriptions.
ALTER FUNCTION ops.review_delivery_eligible(UUID) RENAME TO review_delivery_eligible_58;
CREATE FUNCTION ops.review_delivery_eligible(input_id UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT ops.review_delivery_eligible_58(input_id) AND NOT EXISTS(
 SELECT 1 FROM ops.review_notification_deliveries d JOIN ops.review_notification_events e ON e.id=d.event_id
 JOIN admin.review_notification_preferences p ON p.principal_id=d.principal_id
 JOIN identity.onboarding_applications a ON a.id=e.target_id
 WHERE d.id=input_id AND e.kind='learner' AND p.learner_review_enabled
 AND (current_setting('qigong.telegram_learner_review_enabled',TRUE)='true' AND ops.telegram_learner_review_allowed(p.principal_id)
 OR EXISTS(SELECT 1 FROM ops.telegram_learner_reviews t WHERE t.event_id=e.id AND t.principal_id=p.principal_id AND t.preferences_revision=p.revision AND t.delivery_state='sent'))
 AND p.learner_review_disclosure='telegram-learner-review-v1'
 AND a.telegram_review_notice_version='telegram-learner-review-v1'
 AND a.status='pending' AND a.requested_region_id=e.region_id
 AND a.learner_name IS NOT NULL AND a.website_email IS NOT NULL AND a.phone_e164 IS NOT NULL)
$$;

-- Immutable ownership tombstones: no applicant payload, tokens or reply text.
-- Retain after prompt closure/expiry/reset so late replies never become journals.
CREATE TABLE ops.telegram_learner_review_prompts (
 subject TEXT NOT NULL CHECK(subject ~ '^[1-9][0-9]{0,19}$'),message_id BIGINT NOT NULL CHECK(message_id>0),
 PRIMARY KEY(subject,message_id)
);
ALTER TABLE ops.telegram_learner_review_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.telegram_learner_review_prompts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON ops.telegram_learner_review_prompts FROM PUBLIC;
CREATE FUNCTION platform.telegram_learner_review_owned_prompt(input_subject TEXT,input_prompt BIGINT) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM ops.telegram_learner_review_prompts WHERE subject=input_subject AND message_id=input_prompt)
$$;

-- Routing only, never authorization. All legacy permission checks remain in 0058.
-- Every count-worker transaction explicitly sets the same mode. No default TRUE.
-- Recover only eligible, unsent direct-suppressed counts, not sent direct notices.
CREATE FUNCTION ops.queue_review_notifications_for_mode(input_limit INTEGER,input_direct BOOLEAN) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE n INTEGER;saved TEXT:=current_setting('qigong.telegram_learner_review_enabled',TRUE);BEGIN
 IF input_direct IS NULL THEN RAISE EXCEPTION 'review notification mode required';END IF;
 PERFORM set_config('qigong.telegram_learner_review_enabled',input_direct::text,TRUE);
 n:=ops.queue_review_notifications(input_limit);
 IF NOT input_direct THEN
  UPDATE ops.review_notification_deliveries d SET status='pending',lease_id=NULL,leased_until=NULL
  FROM ops.review_notification_events e,admin.review_notification_preferences p,identity.onboarding_applications a
  WHERE d.event_id=e.id AND d.principal_id=p.principal_id AND a.id=e.target_id AND e.kind='learner'
  AND d.status='cancelled' AND d.preferences_revision=p.revision AND d.attempts<8
  AND p.learner_review_enabled AND p.learner_review_disclosure='telegram-learner-review-v1'
  AND a.telegram_review_notice_version='telegram-learner-review-v1' AND ops.review_delivery_eligible(d.id);
 END IF;
 PERFORM set_config('qigong.telegram_learner_review_enabled',coalesce(saved,''),TRUE);
 RETURN n;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('qigong.telegram_learner_review_enabled',coalesce(saved,''),TRUE);RAISE;
END$$;

-- Owner-only explicit reset before off->on; feature pause alone is NOT revocation.
CREATE FUNCTION ops.invalidate_telegram_learner_reviews() RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE n INTEGER;BEGIN
 UPDATE ops.telegram_learner_reviews SET delivery_state='cancelled',stage='closed',token_hash=NULL,
 lease_id=NULL,leased_until=NULL,prompt_message_id=NULL,reason=NULL WHERE stage<>'closed';
 GET DIAGNOSTICS n=ROW_COUNT;
 UPDATE admin.review_notification_preferences SET learner_review_enabled=FALSE,learner_review_disclosure=NULL,revision=revision+1 WHERE learner_review_enabled;
 RETURN n;
END$$;
CREATE FUNCTION ops.telegram_learner_review_eligible(input_id UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM ops.telegram_learner_reviews t JOIN admin.review_notification_preferences p ON p.principal_id=t.principal_id
 JOIN identity.onboarding_applications a ON a.id=t.application_id WHERE t.id=input_id
 AND p.telegram_subject IS NOT NULL AND p.revision=t.preferences_revision AND p.learner_enabled AND p.learner_review_enabled
 AND p.learner_review_disclosure='telegram-learner-review-v1'
 AND a.telegram_review_notice_version='telegram-learner-review-v1'
 AND a.status='pending' AND a.requested_region_id=t.region_id AND public.digest(to_jsonb(a)::text,'sha256')=t.snapshot
 AND ops.telegram_learner_review_allowed(t.principal_id))
$$;
CREATE FUNCTION ops.claim_telegram_learner_reviews(input_limit INTEGER DEFAULT 5) RETURNS TABLE(id UUID,lease_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'invalid learner review batch';END IF;
 UPDATE ops.telegram_learner_reviews t SET delivery_state='cancelled',token_hash=NULL,stage='closed',lease_id=NULL,leased_until=NULL
 WHERE t.delivery_state IN('pending','sending') AND NOT ops.telegram_learner_review_eligible(t.id);
 INSERT INTO ops.telegram_learner_reviews(event_id,principal_id,preferences_revision,application_id,region_id,snapshot)
 SELECT e.id,p.principal_id,p.revision,a.id,a.requested_region_id,public.digest(to_jsonb(a)::text,'sha256')
 FROM ops.review_notification_events e JOIN identity.onboarding_applications a ON a.id=e.target_id CROSS JOIN admin.review_notification_preferences p
 WHERE e.kind='learner' AND a.telegram_review_notice_version='telegram-learner-review-v1' AND a.status='pending' AND a.requested_region_id=e.region_id AND p.telegram_subject IS NOT NULL
 AND p.learner_enabled AND p.learner_review_enabled AND p.learner_review_disclosure='telegram-learner-review-v1'
 AND a.learner_name IS NOT NULL AND a.website_email IS NOT NULL AND a.phone_e164 IS NOT NULL
 AND ops.telegram_learner_review_allowed(p.principal_id)
 AND NOT EXISTS(SELECT 1 FROM ops.telegram_learner_reviews existing WHERE existing.event_id=e.id AND existing.principal_id=p.principal_id AND existing.preferences_revision=p.revision)
 ORDER BY e.created_at,e.id,p.principal_id LIMIT 200 ON CONFLICT DO NOTHING;
 RETURN QUERY WITH selected AS(SELECT t.id FROM ops.telegram_learner_reviews t
 WHERE (t.delivery_state='pending' OR (t.delivery_state='sending' AND t.leased_until<clock_timestamp()))
 AND t.attempts<8 AND t.available_at<=clock_timestamp() AND ops.telegram_learner_review_eligible(t.id)
 ORDER BY t.available_at,t.id LIMIT input_limit FOR UPDATE SKIP LOCKED)
 UPDATE ops.telegram_learner_reviews t SET delivery_state='sending',attempts=t.attempts+1,lease_id=gen_random_uuid(),
 leased_until=clock_timestamp()+INTERVAL '2 minutes',token_hash=NULL,message_id=NULL,prompt_message_id=NULL,stage='ready',reason=NULL
 FROM selected s WHERE t.id=s.id RETURNING t.id,t.lease_id;
 UPDATE ops.telegram_learner_reviews t SET delivery_state='failed',token_hash=NULL,stage='closed' WHERE t.delivery_state='sending' AND t.attempts>=8 AND t.leased_until<clock_timestamp();
END$$;
CREATE FUNCTION ops.telegram_learner_review_payload(input_id UUID,input_lease UUID,input_token TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE t ops.telegram_learner_reviews;result JSONB;BEGIN
 IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN jsonb_build_object('allowed',FALSE);END IF;
 SELECT * INTO t FROM ops.telegram_learner_reviews WHERE id=input_id FOR UPDATE;
 IF NOT FOUND OR t.delivery_state<>'sending' OR t.lease_id IS DISTINCT FROM input_lease OR t.leased_until<=clock_timestamp() OR NOT ops.telegram_learner_review_eligible(t.id) THEN RETURN jsonb_build_object('allowed',FALSE);END IF;
 -- Re-read application and binding immediately before producing any personal data.
 -- display_name is overwritten by the self-reported form name (0008/0013), not a provider nickname.
 SELECT jsonb_build_object('allowed',TRUE,'recipient',p.telegram_subject,'locale',p.locale,'name',left(a.learner_name,150),
 'platform',a.platform,'sourceId',a.external_subject_id,
 'phone',left(a.phone_e164,32),'email',left(a.website_email,254),'region',left(CASE p.locale WHEN 'en' THEN r.name_en ELSE r.name_zh_tw END,150)) INTO result
 FROM identity.onboarding_applications a JOIN core.regions r ON r.id=a.requested_region_id
 JOIN admin.review_notification_preferences p ON p.principal_id=t.principal_id
 WHERE a.id=t.application_id AND a.telegram_review_notice_version='telegram-learner-review-v1' AND public.digest(to_jsonb(a)::text,'sha256')=t.snapshot AND p.revision=t.preferences_revision;
 IF result IS NULL THEN RETURN jsonb_build_object('allowed',FALSE);END IF;
 UPDATE ops.telegram_learner_reviews SET token_hash=public.digest(input_token,'sha256'),expires_at=clock_timestamp()+INTERVAL '24 hours' WHERE id=t.id;
 RETURN result;
END$$;
CREATE FUNCTION ops.finish_telegram_learner_review(input_id UUID,input_lease UUID,input_message BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE t ops.telegram_learner_reviews;eligible BOOLEAN;BEGIN
 SELECT * INTO t FROM ops.telegram_learner_reviews WHERE id=input_id FOR UPDATE;
 IF NOT FOUND OR t.delivery_state<>'sending' OR t.lease_id IS DISTINCT FROM input_lease OR t.leased_until<=clock_timestamp() THEN RETURN FALSE;END IF;
 eligible:=ops.telegram_learner_review_eligible(t.id);
 UPDATE ops.telegram_learner_reviews SET delivery_state=CASE WHEN NOT eligible THEN 'cancelled' WHEN input_message>0 AND t.token_hash IS NOT NULL THEN 'sent' WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,
 message_id=CASE WHEN eligible AND input_message>0 THEN input_message ELSE NULL END,
 token_hash=CASE WHEN eligible AND input_message>0 THEN token_hash ELSE NULL END,
 lease_id=NULL,leased_until=NULL,available_at=clock_timestamp()+INTERVAL '1 minute'*least(15,power(2,attempts)::integer) WHERE id=t.id;
 RETURN TRUE;
END$$;

-- Token and sender derive the principal; no caller-provided principal or application IDs.
CREATE FUNCTION platform.telegram_learner_review_action(input_subject TEXT,input_message BIGINT,input_token TEXT,input_action TEXT,input_next_token TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t ops.telegram_learner_reviews;p admin.review_notification_preferences;a identity.onboarding_applications;
 saved TEXT:=current_setting('qigong.principal_id',TRUE);next_stage TEXT;chosen TEXT;BEGIN
 IF input_subject IS NULL OR input_subject !~ '^[1-9][0-9]{0,19}$' OR input_message IS NULL OR input_message<=0
 OR input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' OR input_next_token IS NULL OR input_next_token !~ '^[A-Za-z0-9_-]{43}$'
 OR input_action IS NULL OR input_action NOT IN('approve','deny','cancel','confirm','incomplete','contact','custom') THEN RETURN jsonb_build_object('state','unavailable');END IF;
 -- Binding lock precedes the per-application lease lock everywhere that needs both.
 SELECT pref.* INTO p FROM admin.review_notification_preferences pref JOIN ops.telegram_learner_reviews x ON x.principal_id=pref.principal_id
 WHERE x.token_hash=public.digest(input_token,'sha256') AND pref.telegram_subject=input_subject FOR UPDATE OF pref;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unavailable');END IF;
 SELECT * INTO t FROM ops.telegram_learner_reviews WHERE token_hash=public.digest(input_token,'sha256') FOR UPDATE;
 IF NOT FOUND OR t.delivery_state<>'sent' OR t.message_id IS DISTINCT FROM input_message OR t.expires_at<=clock_timestamp()
 OR t.preferences_revision<>p.revision OR NOT p.learner_enabled OR NOT p.learner_review_enabled OR p.learner_review_disclosure IS DISTINCT FROM 'telegram-learner-review-v1' THEN RETURN jsonb_build_object('state','unavailable');END IF;
 SELECT * INTO a FROM identity.onboarding_applications WHERE id=t.application_id FOR UPDATE;
 IF NOT FOUND OR a.telegram_review_notice_version IS DISTINCT FROM 'telegram-learner-review-v1' OR t.expires_at<=clock_timestamp() OR a.requested_region_id IS DISTINCT FROM t.region_id OR NOT ops.telegram_learner_review_allowed(p.principal_id) THEN RETURN jsonb_build_object('state','unavailable');END IF;
 IF a.status<>'pending' OR public.digest(to_jsonb(a)::text,'sha256')<>t.snapshot THEN
  UPDATE ops.telegram_learner_reviews SET stage='closed',token_hash=NULL,prompt_message_id=NULL,reason=NULL WHERE id=t.id;
  RETURN jsonb_build_object('state','stale','locale',p.locale);
 END IF;
 IF input_action='cancel' THEN next_stage:='ready';
 ELSIF t.stage='ready' AND input_action='approve' THEN next_stage:='confirm_approve';
 ELSIF t.stage='ready' AND input_action='deny' THEN next_stage:='deny';
 ELSIF t.stage='deny' AND input_action IN('incomplete','contact') THEN
  next_stage:='confirm_deny';chosen:=CASE input_action WHEN 'incomplete' THEN 'Application information is incomplete / 申請資料不完整' ELSE 'Unable to verify contact details / 無法確認聯絡資料' END;
 ELSIF t.stage='deny' AND input_action='custom' THEN next_stage:='input';
 ELSIF input_action='confirm' AND t.stage IN('confirm_approve','confirm_deny') THEN
  IF t.stage='confirm_deny' AND (t.reason IS NULL OR length(btrim(t.reason))=0) THEN RETURN jsonb_build_object('state','unavailable');END IF;
  PERFORM set_config('qigong.principal_id',p.principal_id::text,TRUE);
  IF NOT ops.telegram_learner_review_allowed(p.principal_id) THEN
   PERFORM set_config('qigong.principal_id',coalesce(saved,''),TRUE);RETURN jsonb_build_object('state','unavailable');
  END IF;
  PERFORM identity.decide_application(t.application_id,CASE t.stage WHEN 'confirm_approve' THEN 'approved' ELSE 'rejected' END,t.reason);
  PERFORM set_config('qigong.principal_id',coalesce(saved,''),TRUE);
  UPDATE ops.telegram_learner_reviews SET stage='closed',token_hash=NULL,prompt_message_id=NULL,reason=NULL WHERE id=t.id;
  RETURN jsonb_build_object('state','decided','locale',p.locale);
 ELSE RETURN jsonb_build_object('state','unavailable');END IF;
 UPDATE ops.telegram_learner_reviews SET stage=next_stage,token_hash=public.digest(input_next_token,'sha256'),reason=chosen,prompt_message_id=NULL WHERE id=t.id;
 RETURN jsonb_build_object('state',next_stage,'locale',p.locale,'reason',chosen,'applicant',jsonb_build_object('name',left(a.learner_name,150),'platform',a.platform,'sourceId',left(a.external_subject_id,128)));
EXCEPTION WHEN OTHERS THEN PERFORM set_config('qigong.principal_id',coalesce(saved,''),TRUE);RAISE;
END$$;
CREATE FUNCTION platform.telegram_learner_review_prompt(input_subject TEXT,input_message BIGINT,input_token TEXT,input_prompt BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF input_prompt IS NULL OR input_prompt<=0 THEN RETURN FALSE;END IF;
 INSERT INTO ops.telegram_learner_review_prompts(subject,message_id)
 SELECT p.telegram_subject,input_prompt FROM ops.telegram_learner_reviews t JOIN admin.review_notification_preferences p ON p.principal_id=t.principal_id
 WHERE p.telegram_subject=input_subject AND t.message_id=input_message AND t.token_hash=public.digest(input_token,'sha256') AND t.stage='input'
 ON CONFLICT DO NOTHING;
 UPDATE ops.telegram_learner_reviews t SET prompt_message_id=input_prompt
 FROM admin.review_notification_preferences p WHERE t.principal_id=p.principal_id AND p.telegram_subject=input_subject
 AND p.revision=t.preferences_revision AND p.learner_review_enabled AND p.learner_enabled
 AND t.message_id=input_message AND t.token_hash=public.digest(input_token,'sha256') AND t.stage='input'
 AND t.expires_at>clock_timestamp() AND ops.telegram_learner_review_eligible(t.id);
 RETURN FOUND;
END$$;
CREATE FUNCTION platform.telegram_learner_review_reason(input_subject TEXT,input_prompt BIGINT,input_reason TEXT,input_next_token TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE t ops.telegram_learner_reviews;p admin.review_notification_preferences;a identity.onboarding_applications;BEGIN
 IF input_reason IS NULL OR length(btrim(input_reason)) NOT BETWEEN 1 AND 500 OR btrim(input_reason) LIKE '/%'
 OR btrim(input_reason) ~* '^(help(@[A-Za-z0-9_]+)?|說明|说明|使用說明|使用说明|幫助|帮助|隱私|隐私|條款|条款)$'
 OR input_next_token IS NULL OR input_next_token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN jsonb_build_object('state','unavailable');END IF;
 SELECT pref.* INTO p FROM admin.review_notification_preferences pref JOIN ops.telegram_learner_reviews x ON x.principal_id=pref.principal_id
 WHERE pref.telegram_subject=input_subject AND x.prompt_message_id=input_prompt AND x.stage='input' AND x.expires_at>clock_timestamp() FOR UPDATE OF pref;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unavailable');END IF;
 SELECT * INTO t FROM ops.telegram_learner_reviews WHERE principal_id=p.principal_id AND prompt_message_id=input_prompt AND stage='input' FOR UPDATE;
 IF NOT FOUND OR t.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('state','unavailable');END IF;
 SELECT * INTO a FROM identity.onboarding_applications WHERE id=t.application_id FOR SHARE;
 IF NOT FOUND OR t.expires_at<=clock_timestamp() OR NOT ops.telegram_learner_review_eligible(t.id) THEN RETURN jsonb_build_object('state','unavailable');END IF;
 UPDATE ops.telegram_learner_reviews SET stage='confirm_deny',reason=btrim(input_reason),prompt_message_id=NULL,token_hash=public.digest(input_next_token,'sha256') WHERE id=t.id;
 RETURN jsonb_build_object('state','confirm_deny','locale',p.locale,'reason',btrim(input_reason),'messageId',t.message_id,'applicant',jsonb_build_object('name',left(a.learner_name,150),'platform',a.platform,'sourceId',left(a.external_subject_id,128)));
END$$;

-- Scrub inherited default ACLs too, not only PUBLIC/the two known runtimes.
-- Keep only actual object-owner privileges before granting the narrow entrypoints.
DO $$DECLARE r RECORD;g RECORD;BEGIN
 FOR g IN SELECT DISTINCT a.grantee FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 WHERE c.oid IN('ops.telegram_learner_reviews'::regclass,'ops.telegram_learner_review_prompts'::regclass) AND a.grantee<>c.relowner
 LOOP EXECUTE format('REVOKE ALL ON TABLE ops.telegram_learner_reviews,ops.telegram_learner_review_prompts FROM %s',CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);END LOOP;
 FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='ops' AND p.proname IN('queue_review_notifications_for_mode','invalidate_telegram_learner_reviews','telegram_learner_review_allowed','telegram_learner_review_eligible','claim_telegram_learner_reviews','telegram_learner_review_payload','finish_telegram_learner_review','review_delivery_eligible'))
 OR (n.nspname='admin' AND p.proname IN('reset_telegram_learner_review_consent','save_telegram_learner_review_preferences','review_notification_state','review_notification_state_58'))
 OR (n.nspname='platform' AND p.proname IN('telegram_learner_review_owned_prompt','telegram_learner_review_action','telegram_learner_review_prompt','telegram_learner_review_reason','submit_line_application_v2','submit_telegram_application_v2','submit_whatsapp_application_v2'))
 LOOP
  FOR g IN SELECT DISTINCT a.grantee FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=r.signature::oid AND a.grantee<>p.proowner
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s',r.signature,CASE WHEN g.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);END LOOP;
 END LOOP;
END$$;
GRANT EXECUTE ON FUNCTION platform.submit_line_application_v2(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
 platform.submit_telegram_application_v2(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),
 platform.submit_whatsapp_application_v2(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION platform.telegram_learner_review_owned_prompt(TEXT,BIGINT),admin.review_notification_state(),admin.save_telegram_learner_review_preferences(INTEGER,BOOLEAN,BOOLEAN,TEXT,BOOLEAN,BOOLEAN,TEXT),
 platform.telegram_learner_review_action(TEXT,BIGINT,TEXT,TEXT,TEXT),platform.telegram_learner_review_prompt(TEXT,BIGINT,TEXT,BIGINT),platform.telegram_learner_review_reason(TEXT,BIGINT,TEXT,TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION ops.queue_review_notifications_for_mode(INTEGER,BOOLEAN),ops.claim_telegram_learner_reviews(INTEGER),ops.telegram_learner_review_payload(UUID,UUID,TEXT),ops.finish_telegram_learner_review(UUID,UUID,BIGINT) TO qigong_worker_runtime;
-- Keep existing architecture-version readiness guards intact; entrypoints must explicitly accept schema59.
