-- Additive TG/WA invitation paths; existing LINE data/functions and phase27 workers stay unchanged.
CREATE TABLE platform.channel_invites (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), platform TEXT NOT NULL CHECK(platform IN('telegram','whatsapp')),
 token_hash BYTEA NOT NULL UNIQUE CHECK(octet_length(token_hash)=32), label TEXT NOT NULL,
 region_id UUID NOT NULL REFERENCES core.regions(id), issuer_id UUID NOT NULL REFERENCES admin.principals(id),
 expires_at TIMESTAMPTZ NOT NULL, max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 10000),
 uses INTEGER NOT NULL DEFAULT 0 CHECK(uses>=0 AND uses<=max_uses), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), UNIQUE(id,platform)
);
CREATE TABLE platform.channel_invite_continuations (
 platform TEXT NOT NULL CHECK(platform IN('telegram','whatsapp')), external_subject_id TEXT NOT NULL CHECK(external_subject_id ~ '^[0-9]{1,20}$'),
 invite_id UUID NOT NULL, nonce UUID NOT NULL, token_hash BYTEA NOT NULL CHECK(octet_length(token_hash)=32),
 expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL, redeemed_at TIMESTAMPTZ,
 PRIMARY KEY(platform,external_subject_id), UNIQUE(platform,token_hash),
 FOREIGN KEY(invite_id,platform) REFERENCES platform.channel_invites(id,platform),
 CHECK(expires_at>created_at AND expires_at<=created_at+INTERVAL '15 minutes')
);
CREATE TABLE platform.channel_invite_redemptions (
 invite_id UUID NOT NULL, platform TEXT NOT NULL, identity_id UUID PRIMARY KEY REFERENCES identity.platform_identities(id),
 application_id UUID NOT NULL UNIQUE REFERENCES identity.onboarding_applications(id), redeemed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(invite_id,platform) REFERENCES platform.channel_invites(id,platform)
);
CREATE INDEX channel_invite_continuation_expiry ON platform.channel_invite_continuations(expires_at);
ALTER TABLE platform.channel_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.channel_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.channel_invite_continuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.channel_invite_continuations FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.channel_invite_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.channel_invite_redemptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.channel_invites,platform.channel_invite_continuations,platform.channel_invite_redemptions FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;

CREATE FUNCTION admin.channel_invite_issuer_active(input_id UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM admin.principals p JOIN admin.role_grants g ON g.principal_id=p.id JOIN admin.roles r ON r.id=g.role_id
 WHERE p.id=input_id AND p.status='active' AND r.code='super_admin' AND g.scope_type='global'
 AND g.valid_from<=clock_timestamp() AND(g.valid_to IS NULL OR g.valid_to>clock_timestamp()))
$$;
CREATE FUNCTION admin.channel_invite_session_current(input_token TEXT) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT admin.channel_invite_issuer_active(admin.request_principal_id()) AND length(input_token) BETWEEN 32 AND 128
 AND EXISTS(SELECT 1 FROM admin.sessions s WHERE s.token_hash=public.digest(input_token,'sha256') AND s.principal_id=admin.request_principal_id()
 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp())
$$;
CREATE FUNCTION admin.create_channel_invite(input_platform TEXT,input_token TEXT,input_label TEXT,input_region TEXT,input_expiry TIMESTAMPTZ,input_limit INTEGER,input_reason TEXT,input_session TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE region UUID;result JSONB;
BEGIN
 PERFORM pg_advisory_xact_lock(1919,1);
 IF admin.channel_invite_session_current(input_session) IS NOT TRUE THEN RAISE EXCEPTION 'channel invite management denied' USING ERRCODE='42501';END IF;
 IF input_platform IS NULL OR input_platform NOT IN('telegram','whatsapp') OR input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$'
 OR input_label IS NULL OR length(trim(input_label)) NOT BETWEEN 1 AND 100 OR input_label ~ '[[:cntrl:]]'
 OR input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500 OR input_reason ~ '[[:cntrl:]]'
 OR input_expiry IS NULL OR input_expiry<=clock_timestamp() OR input_expiry>clock_timestamp()+INTERVAL '30 days'
 OR input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid channel invite';END IF;
 SELECT id INTO region FROM core.regions WHERE code=input_region AND code IN('tw-general','my-general','sg-general','hk-general','other-general') AND active AND region_type='operational' FOR SHARE;
 IF region IS NULL THEN RAISE EXCEPTION 'invalid channel invite region';END IF;
 INSERT INTO platform.channel_invites(platform,token_hash,label,region_id,issuer_id,expires_at,max_uses)
 VALUES(input_platform,public.digest(input_token,'sha256'),trim(input_label),region,admin.request_principal_id(),input_expiry,input_limit)
 RETURNING jsonb_build_object('id',id,'revision',revision,'expiresAt',expires_at,'maxUses',max_uses,'platform',platform) INTO result;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,scope_type,scope_id,reason,outcome)
 VALUES(admin.request_id(),admin.request_principal_id(),'channel_invite.create','channel_invite',result->>'id','region',region,trim(input_reason),'success');
 IF admin.channel_invite_session_current(input_session) IS NOT TRUE THEN RAISE EXCEPTION 'channel invite management denied' USING ERRCODE='42501';END IF;
 RETURN result;
END$$;
CREATE FUNCTION admin.channel_invite_list(input_platform TEXT,input_page INTEGER,input_session TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE items JSONB;result JSONB;BEGIN
 IF admin.channel_invite_session_current(input_session) IS NOT TRUE THEN RAISE EXCEPTION 'channel invite management denied' USING ERRCODE='42501';END IF;
 IF input_platform IS NULL OR input_platform NOT IN('telegram','whatsapp') OR input_page IS NULL OR input_page NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'invalid channel invite query';END IF;
 SELECT coalesce(jsonb_agg(data),'[]') INTO items FROM(SELECT jsonb_build_object('id',v.id,'label',v.label,'region',r.code,'expiresAt',v.expires_at,'maxUses',v.max_uses,'uses',v.uses,'revision',v.revision,'revoked',v.revoked_at IS NOT NULL,'issuerActive',admin.channel_invite_issuer_active(v.issuer_id)) data FROM platform.channel_invites v JOIN core.regions r ON r.id=v.region_id WHERE v.platform=input_platform ORDER BY v.created_at DESC,v.id LIMIT 50 OFFSET(input_page-1)*50) x;
 SELECT jsonb_build_object('items',items,'page',input_page,'total',(SELECT count(*) FROM platform.channel_invites WHERE platform=input_platform),'regions',(SELECT coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name_zh_tw) ORDER BY code),'[]') FROM core.regions WHERE active AND region_type='operational' AND code IN('tw-general','my-general','sg-general','hk-general','other-general'))) INTO result;
 IF admin.channel_invite_session_current(input_session) IS NOT TRUE THEN RAISE EXCEPTION 'channel invite management denied' USING ERRCODE='42501';END IF;
 RETURN result;
END$$;
CREATE FUNCTION admin.revoke_channel_invite(input_platform TEXT,input_id UUID,input_revision INTEGER,input_reason TEXT,input_session TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE v platform.channel_invites;BEGIN
 PERFORM pg_advisory_xact_lock(1919,1);
 IF admin.channel_invite_session_current(input_session) IS NOT TRUE THEN RAISE EXCEPTION 'channel invite management denied' USING ERRCODE='42501';END IF;
 IF input_platform IS NULL OR input_platform NOT IN('telegram','whatsapp') OR input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500 OR input_reason ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid channel invite reason';END IF;
 SELECT * INTO v FROM platform.channel_invites WHERE id=input_id AND platform=input_platform FOR UPDATE;
 IF NOT FOUND OR input_revision IS DISTINCT FROM v.revision THEN RAISE EXCEPTION 'channel invite conflict' USING ERRCODE='40001';END IF;
 IF v.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('revoked',TRUE,'revision',v.revision);END IF;
 UPDATE platform.channel_invites SET revoked_at=clock_timestamp(),revision=revision+1 WHERE id=v.id RETURNING revision INTO v.revision;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,scope_type,scope_id,reason,outcome)
 VALUES(admin.request_id(),admin.request_principal_id(),'channel_invite.revoke','channel_invite',v.id::text,'region',v.region_id,trim(input_reason),'success');
 IF admin.channel_invite_session_current(input_session) IS NOT TRUE THEN RAISE EXCEPTION 'channel invite management denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('revoked',TRUE,'revision',v.revision);
END$$;

CREATE FUNCTION platform._channel_invite_state(input_platform TEXT,input_subject TEXT,input_invite UUID,input_locale TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v platform.channel_invites;application_status TEXT;privacy JSONB;
BEGIN
 IF input_platform IS NULL OR input_platform NOT IN('telegram','whatsapp') OR input_subject IS NULL OR input_subject !~ '^[0-9]{1,20}$' OR input_locale IS NULL OR input_locale NOT IN('zh_TW','zh_CN','en') THEN RAISE EXCEPTION 'invalid channel invite identity';END IF;
 IF EXISTS(SELECT 1 FROM identity.platform_identities i JOIN identity.people p ON p.id=i.person_id JOIN identity.person_interaction_channels c ON c.person_id=p.id AND c.platform_identity_id=i.id JOIN identity.onboarding_applications a ON a.person_id=p.id AND a.platform=i.platform AND a.external_subject_id=i.external_subject_id AND a.status='approved'
 WHERE i.platform=input_platform AND i.external_subject_id=input_subject AND i.revoked_at IS NULL AND p.status='active' AND c.valid_to IS NULL AND c.valid_from<=clock_timestamp()) THEN
  privacy:=platform.privacy_status(input_platform,input_subject);
  RETURN jsonb_build_object('status',CASE WHEN (privacy->>'unavailable')::boolean THEN 'blocked' WHEN (privacy->>'required')::boolean THEN 'privacy' ELSE 'approved' END,'alreadyMember',TRUE);
 END IF;
 SELECT status INTO application_status FROM identity.onboarding_applications WHERE platform=input_platform AND external_subject_id=input_subject;
 IF (application_status IS NOT NULL AND application_status<>'pending') OR EXISTS(SELECT 1 FROM identity.platform_identities WHERE platform=input_platform AND external_subject_id=input_subject) THEN RETURN jsonb_build_object('status','blocked');END IF;
 SELECT * INTO v FROM platform.channel_invites WHERE id=input_invite AND platform=input_platform AND revoked_at IS NULL AND expires_at>clock_timestamp() AND uses<max_uses;
 IF NOT FOUND OR admin.channel_invite_issuer_active(v.issuer_id) IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM core.regions WHERE id=v.region_id AND active AND region_type='operational') THEN RETURN jsonb_build_object('status','invalid');END IF;
 privacy:=platform.privacy_status(input_platform,input_subject);
 IF (privacy->>'unavailable')::boolean THEN RETURN jsonb_build_object('status','blocked');END IF;
 RETURN jsonb_build_object('status',CASE WHEN(privacy->>'required')::boolean THEN 'privacy' ELSE 'form' END,'pendingApplication',coalesce(application_status='pending',FALSE),'region',(SELECT code FROM core.regions WHERE id=v.region_id),'regionName',(SELECT CASE input_locale WHEN 'en' THEN name_en WHEN 'zh_CN' THEN name_zh_cn ELSE name_zh_tw END FROM core.regions WHERE id=v.region_id));
END$$;
CREATE FUNCTION platform.begin_channel_invite(input_platform TEXT,input_subject TEXT,input_invite_token TEXT,input_nonce UUID,input_resume_token TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;c platform.channel_invite_continuations;state JSONB;stamp TIMESTAMPTZ;expiry TIMESTAMPTZ;
BEGIN
 IF input_platform IS NULL OR input_platform NOT IN('telegram','whatsapp') OR input_subject IS NULL OR input_subject !~ '^[0-9]{1,20}$' OR input_nonce IS NULL OR input_resume_token IS NULL OR input_resume_token !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'invalid channel invite continuation';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(input_platform||':'||input_subject,0));
 SELECT * INTO c FROM platform.channel_invite_continuations WHERE platform=input_platform AND external_subject_id=input_subject FOR UPDATE;
 IF input_invite_token IS NULL AND(c.invite_id IS NULL OR c.expires_at<=clock_timestamp() OR c.redeemed_at IS NOT NULL) THEN RETURN jsonb_build_object('status','none');END IF;
 state:=platform._channel_invite_state(input_platform,input_subject,NULL,'zh_TW');
 IF (state->>'alreadyMember')::boolean IS TRUE THEN RETURN jsonb_build_object('status','approved');END IF;
 IF state->>'status'='blocked' THEN RETURN state;END IF;
 IF input_invite_token IS NOT NULL THEN
  IF input_invite_token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN jsonb_build_object('status','invalid');END IF;
  SELECT id INTO target FROM platform.channel_invites WHERE platform=input_platform AND token_hash=public.digest(input_invite_token,'sha256');
 ELSE
  IF c.invite_id IS NULL OR c.expires_at<=clock_timestamp() OR c.redeemed_at IS NOT NULL THEN RETURN jsonb_build_object('status','none');END IF;
  target:=c.invite_id;
 END IF;
 state:=platform._channel_invite_state(input_platform,input_subject,target,'zh_TW');
 IF state->>'status' NOT IN('form','privacy') THEN RETURN state;END IF;
 IF c.invite_id=target AND c.expires_at>clock_timestamp() AND c.redeemed_at IS NULL THEN
  IF c.nonce=input_nonce THEN UPDATE platform.channel_invite_continuations SET token_hash=public.digest(input_resume_token,'sha256') WHERE platform=input_platform AND external_subject_id=input_subject AND token_hash IS DISTINCT FROM public.digest(input_resume_token,'sha256');END IF;
  RETURN state||jsonb_build_object('nonce',c.nonce);
 END IF;
 stamp:=clock_timestamp();SELECT least(expires_at,stamp+INTERVAL '15 minutes') INTO expiry FROM platform.channel_invites WHERE id=target AND platform=input_platform AND revoked_at IS NULL AND expires_at>stamp AND uses<max_uses;
 IF expiry IS NULL OR expiry<=stamp THEN RETURN jsonb_build_object('status','invalid');END IF;
 DELETE FROM platform.channel_invite_continuations WHERE(platform,external_subject_id) IN(SELECT platform,external_subject_id FROM platform.channel_invite_continuations WHERE expires_at<=stamp ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED);
 INSERT INTO platform.channel_invite_continuations(platform,external_subject_id,invite_id,nonce,token_hash,created_at,expires_at)
 VALUES(input_platform,input_subject,target,input_nonce,public.digest(input_resume_token,'sha256'),stamp,expiry)
 ON CONFLICT(platform,external_subject_id) DO UPDATE SET invite_id=EXCLUDED.invite_id,nonce=EXCLUDED.nonce,token_hash=EXCLUDED.token_hash,created_at=EXCLUDED.created_at,expires_at=EXCLUDED.expires_at,redeemed_at=NULL;
 RETURN state||jsonb_build_object('nonce',input_nonce);
END$$;
CREATE FUNCTION platform.channel_invite_form_subject(input_platform TEXT,input_token TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE target TEXT;BEGIN
 IF input_platform IS NULL OR input_platform NOT IN('telegram','whatsapp') OR input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'channel invite unavailable' USING ERRCODE='42501';END IF;
 SELECT external_subject_id INTO target FROM platform.channel_invite_continuations WHERE platform=input_platform AND token_hash=public.digest(input_token,'sha256') AND expires_at>clock_timestamp();
 IF target IS NULL THEN RAISE EXCEPTION 'channel invite unavailable' USING ERRCODE='42501';END IF;RETURN target;
END$$;
CREATE FUNCTION platform.channel_invite_form_state(input_platform TEXT,input_token TEXT,input_locale TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE target TEXT;invite UUID;BEGIN
 target:=platform.channel_invite_form_subject(input_platform,input_token);
 SELECT invite_id INTO invite FROM platform.channel_invite_continuations WHERE platform=input_platform AND external_subject_id=target AND token_hash=public.digest(input_token,'sha256') AND expires_at>clock_timestamp();
 RETURN platform._channel_invite_state(input_platform,target,invite,input_locale);
END$$;
CREATE FUNCTION platform.redeem_channel_invite(input_platform TEXT,input_token TEXT,input_name TEXT,input_email TEXT,input_phone TEXT,input_locale TEXT,input_notification_consent BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target TEXT;c platform.channel_invite_continuations;v platform.channel_invites;state JSONB;application UUID;person UUID;ident UUID;
BEGIN
 PERFORM pg_advisory_xact_lock(1919,1);
 target:=platform.channel_invite_form_subject(input_platform,input_token);
 PERFORM pg_advisory_xact_lock(hashtextextended(input_platform||':'||target,0));
 SELECT * INTO c FROM platform.channel_invite_continuations WHERE platform=input_platform AND external_subject_id=target AND token_hash=public.digest(input_token,'sha256') AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'channel invite unavailable' USING ERRCODE='42501';END IF;
 state:=platform._channel_invite_state(input_platform,target,c.invite_id,input_locale);
 IF state->>'status'='approved' THEN RETURN jsonb_build_object('status','approved','alreadyMember',TRUE);END IF;
 IF state->>'status'='privacy' THEN RAISE EXCEPTION 'privacy acceptance required' USING ERRCODE='42501';END IF;
 IF state->>'status'<>'form' OR c.redeemed_at IS NOT NULL THEN RAISE EXCEPTION 'channel invite unavailable' USING ERRCODE='42501';END IF;
 IF input_name IS NULL OR length(trim(input_name)) NOT BETWEEN 1 AND 150 OR input_name ~ '[[:cntrl:]]' OR input_email IS NULL OR length(input_email)>254 OR input_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR input_phone IS NULL OR input_phone !~ '^\+[1-9][0-9]{6,14}$' OR(input_platform='whatsapp' AND input_notification_consent IS DISTINCT FROM TRUE) THEN RAISE EXCEPTION 'invalid channel invite details';END IF;
 SELECT * INTO v FROM platform.channel_invites WHERE id=c.invite_id AND platform=input_platform FOR UPDATE;
 IF NOT FOUND OR v.revoked_at IS NOT NULL OR v.expires_at<=clock_timestamp() OR v.uses>=v.max_uses OR admin.channel_invite_issuer_active(v.issuer_id) IS NOT TRUE THEN RAISE EXCEPTION 'channel invite unavailable' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM core.regions WHERE id=v.region_id AND active AND region_type='operational' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'channel invite unavailable' USING ERRCODE='42501';END IF;
 PERFORM platform.require_privacy_subject(input_platform,target);
 application:=identity.submit_application(input_platform,target,trim(input_name),v.region_id);
 PERFORM 1 FROM identity.onboarding_applications WHERE id=application AND status='pending' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'channel invite unavailable' USING ERRCODE='42501';END IF;
 IF v.expires_at<=clock_timestamp() OR c.expires_at<=clock_timestamp() OR admin.channel_invite_issuer_active(v.issuer_id) IS NOT TRUE OR EXISTS(SELECT 1 FROM identity.platform_identities WHERE platform=input_platform AND external_subject_id=target) THEN RAISE EXCEPTION 'channel invite unavailable' USING ERRCODE='42501';END IF;
 INSERT INTO identity.people(preferred_name,membership_status,practice_timezone,reminder_timezone) SELECT trim(input_name),'pending',coalesce(default_timezone,'Asia/Taipei'),coalesce(default_timezone,'Asia/Taipei') FROM core.regions WHERE id=v.region_id RETURNING id INTO person;
 INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,display_name) VALUES(person,input_platform,target,trim(input_name)) RETURNING id INTO ident;
 INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from,assigned_by_principal_id) VALUES(person,v.region_id,'primary',CURRENT_DATE,v.issuer_id);
 INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,activated_by_principal_id) VALUES(person,ident,'onboarding',v.issuer_id);
 UPDATE identity.onboarding_applications SET requested_region_id=v.region_id,learner_name=trim(input_name),display_name=trim(input_name),website_email=lower(trim(input_email)),phone_e164=input_phone,status='approved',person_id=person,decided_by_principal_id=v.issuer_id,decided_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=application;
 PERFORM platform.set_identity_locale(input_platform,target,input_locale);
 IF input_platform='whatsapp' THEN INSERT INTO platform.whatsapp_notification_consents(subject,allowed) VALUES(target,TRUE) ON CONFLICT(subject) DO UPDATE SET allowed=TRUE,updated_at=clock_timestamp();END IF;
 UPDATE platform.channel_invite_continuations SET redeemed_at=clock_timestamp() WHERE platform=input_platform AND external_subject_id=target;
 UPDATE ops.review_notification_deliveries d SET status='cancelled',lease_id=NULL,leased_until=NULL FROM ops.review_notification_events e WHERE e.id=d.event_id AND e.kind='learner' AND e.target_id=application AND d.status IN('pending','sending');
 INSERT INTO platform.channel_invite_redemptions(invite_id,platform,identity_id,application_id) VALUES(v.id,input_platform,ident,application);
 UPDATE platform.channel_invites SET uses=uses+1 WHERE id=v.id;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,scope_type,scope_id,outcome,metadata) VALUES(admin.request_id(),v.issuer_id,'channel_invite.redeem','onboarding_application',application::text,'region',v.region_id,'success',jsonb_build_object('inviteId',v.id,'platform',input_platform));
 -- Revalidate after any audit/notification triggers and lock waits; a failed check rolls everything back.
 IF NOT EXISTS(SELECT 1 FROM platform.channel_invites live JOIN core.regions r ON r.id=live.region_id WHERE live.id=v.id AND live.platform=input_platform AND live.revoked_at IS NULL AND live.expires_at>clock_timestamp() AND live.uses<=live.max_uses AND admin.channel_invite_issuer_active(live.issuer_id) AND r.active AND r.region_type='operational')
 OR NOT EXISTS(SELECT 1 FROM platform.channel_invite_continuations current_context WHERE current_context.platform=input_platform AND current_context.external_subject_id=target AND current_context.invite_id=v.id AND current_context.token_hash=public.digest(input_token,'sha256') AND current_context.expires_at>clock_timestamp() AND current_context.redeemed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'channel invite unavailable' USING ERRCODE='42501';END IF;
 PERFORM platform.require_privacy_subject(input_platform,target);
 RETURN jsonb_build_object('status','approved','alreadyMember',FALSE);
END$$;

-- Old ordinary forms must not silently downgrade a live invitation into pending review.
ALTER FUNCTION platform.submit_telegram_application(TEXT,TEXT,TEXT,TEXT,TEXT) RENAME TO _pre_channel_invite_submit_telegram_application;
REVOKE ALL ON FUNCTION platform._pre_channel_invite_submit_telegram_application(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION platform.submit_telegram_application(input_token TEXT,input_name TEXT,input_email TEXT,input_phone TEXT,input_region TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE target TEXT;BEGIN
 SELECT telegram_user_id INTO target FROM platform.telegram_application_links WHERE token_hash=public.digest(input_token,'sha256') AND expires_at>clock_timestamp() AND used_at IS NULL;
 IF target IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('telegram:'||target,0));
  IF EXISTS(SELECT 1 FROM platform.channel_invite_continuations WHERE platform='telegram' AND external_subject_id=target AND expires_at>clock_timestamp() AND redeemed_at IS NULL) THEN RAISE EXCEPTION 'channel invite continuation required' USING ERRCODE='42501';END IF;
 END IF;
 RETURN platform._pre_channel_invite_submit_telegram_application(input_token,input_name,input_email,input_phone,input_region);
END$$;
ALTER FUNCTION platform.submit_whatsapp_application(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) RENAME TO _pre_channel_invite_submit_whatsapp_application;
REVOKE ALL ON FUNCTION platform._pre_channel_invite_submit_whatsapp_application(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION platform.submit_whatsapp_application(input_token TEXT,input_name TEXT,input_email TEXT,input_phone TEXT,input_region TEXT,input_locale TEXT,input_consent BOOLEAN) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE target TEXT;BEGIN
 SELECT subject INTO target FROM platform.whatsapp_links WHERE token_hash=public.digest(input_token,'sha256') AND purpose='apply' AND expires_at>clock_timestamp() AND used_at IS NULL;
 IF target IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('whatsapp:'||target,0));
  IF EXISTS(SELECT 1 FROM platform.channel_invite_continuations WHERE platform='whatsapp' AND external_subject_id=target AND expires_at>clock_timestamp() AND redeemed_at IS NULL) THEN RAISE EXCEPTION 'channel invite continuation required' USING ERRCODE='42501';END IF;
 END IF;
 RETURN platform._pre_channel_invite_submit_whatsapp_application(input_token,input_name,input_email,input_phone,input_region,input_locale,input_consent);
END$$;
DO $$DECLARE f RECORD;BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE(n.nspname='admin' AND p.proname IN('channel_invite_issuer_active','channel_invite_session_current','create_channel_invite','channel_invite_list','revoke_channel_invite'))
 OR(n.nspname='platform' AND p.proname IN('_channel_invite_state','begin_channel_invite','channel_invite_form_subject','channel_invite_form_state','redeem_channel_invite','submit_telegram_application','submit_whatsapp_application'))
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime',f.signature);END LOOP;
END$$;
GRANT EXECUTE ON FUNCTION admin.channel_invite_session_current(TEXT),admin.create_channel_invite(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,TEXT,TEXT),admin.channel_invite_list(TEXT,INTEGER,TEXT),admin.revoke_channel_invite(TEXT,UUID,INTEGER,TEXT,TEXT),
 platform.begin_channel_invite(TEXT,TEXT,TEXT,UUID,TEXT),platform.channel_invite_form_subject(TEXT,TEXT),platform.channel_invite_form_state(TEXT,TEXT,TEXT),platform.redeem_channel_invite(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN),
 platform.submit_telegram_application(TEXT,TEXT,TEXT,TEXT,TEXT),platform.submit_whatsapp_application(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) TO qigong_api_runtime;
