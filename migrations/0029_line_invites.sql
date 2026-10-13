-- Bearer invitations grant learner onboarding only, never administrator roles or identity linking.
CREATE TABLE platform.line_invites (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),token_hash BYTEA NOT NULL UNIQUE,label TEXT NOT NULL,
 region_id UUID NOT NULL REFERENCES core.regions(id),issuer_id UUID NOT NULL REFERENCES admin.principals(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),expires_at TIMESTAMPTZ NOT NULL,
 max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 10000),uses INTEGER NOT NULL DEFAULT 0 CHECK(uses>=0 AND uses<=max_uses),
 revision INTEGER NOT NULL DEFAULT 1,revoked_at TIMESTAMPTZ,CHECK(expires_at>created_at)
);
CREATE TABLE platform.line_invite_redemptions (
 invite_id UUID NOT NULL REFERENCES platform.line_invites(id),identity_id UUID PRIMARY KEY REFERENCES identity.platform_identities(id),
 application_id UUID NOT NULL UNIQUE REFERENCES identity.onboarding_applications(id),redeemed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE platform.line_invites ENABLE ROW LEVEL SECURITY;ALTER TABLE platform.line_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.line_invite_redemptions ENABLE ROW LEVEL SECURITY;ALTER TABLE platform.line_invite_redemptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.line_invites,platform.line_invite_redemptions FROM PUBLIC;
CREATE FUNCTION admin.line_invite_issuer_active(input_id UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM admin.principals p JOIN admin.role_grants g ON g.principal_id=p.id JOIN admin.roles r ON r.id=g.role_id WHERE p.id=input_id AND p.status='active' AND r.code='super_admin' AND g.scope_type='global' AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()))$$;
CREATE FUNCTION admin.create_line_invite(input_token TEXT,input_label TEXT,input_region TEXT,input_expiry TIMESTAMPTZ,input_limit INTEGER,input_reason TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE region UUID;result JSONB;BEGIN
 PERFORM pg_advisory_xact_lock(1919,1);IF admin.is_super_admin() IS NOT TRUE THEN RAISE EXCEPTION 'line invite management denied' USING ERRCODE='42501';END IF;
 IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' OR input_label IS NULL OR length(trim(input_label)) NOT BETWEEN 1 AND 100 OR input_label ~ '[[:cntrl:]]' OR input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500 OR input_expiry IS NULL OR input_expiry<=clock_timestamp() OR input_expiry>clock_timestamp()+INTERVAL '30 days' OR input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid line invite';END IF;
 SELECT id INTO region FROM core.regions WHERE code=input_region AND region_type='operational' AND active AND code IN('tw-general','my-general','sg-general','hk-general','other-general');IF region IS NULL THEN RAISE EXCEPTION 'invalid line invite region';END IF;
 INSERT INTO platform.line_invites(token_hash,label,region_id,issuer_id,expires_at,max_uses) VALUES(public.digest(input_token,'sha256'),trim(input_label),region,admin.request_principal_id(),input_expiry,input_limit) RETURNING jsonb_build_object('id',id,'revision',revision,'expiresAt',expires_at,'maxUses',max_uses) INTO result;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,scope_type,scope_id,reason,outcome) VALUES(admin.request_id(),admin.request_principal_id(),'line_invite.create','line_invite',result->>'id','region',region,trim(input_reason),'success');RETURN result;
END$$;
CREATE FUNCTION admin.line_invite_list(input_page INTEGER DEFAULT 1) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result JSONB;BEGIN
 IF admin.is_super_admin() IS NOT TRUE THEN RAISE EXCEPTION 'line invite management denied' USING ERRCODE='42501';END IF;
 IF input_page IS NULL OR input_page NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'invalid line invite page';END IF;
 SELECT coalesce(jsonb_agg(data),'[]') INTO result FROM(SELECT jsonb_build_object('id',v.id,'label',v.label,'region',r.code,'expiresAt',v.expires_at,'maxUses',v.max_uses,'uses',v.uses,'revision',v.revision,'revoked',v.revoked_at IS NOT NULL,'issuerActive',admin.line_invite_issuer_active(v.issuer_id)) data FROM platform.line_invites v JOIN core.regions r ON r.id=v.region_id ORDER BY v.created_at DESC,v.id LIMIT 50 OFFSET (input_page-1)*50) x;
 RETURN jsonb_build_object('items',result,'page',input_page,'total',(SELECT count(*) FROM platform.line_invites),'regions',(SELECT coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name_zh_tw) ORDER BY code),'[]') FROM core.regions WHERE active AND region_type='operational' AND code IN('tw-general','my-general','sg-general','hk-general','other-general')));
END$$;
CREATE FUNCTION admin.revoke_line_invite(input_id UUID,input_revision INTEGER,input_reason TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE v platform.line_invites;BEGIN
 PERFORM pg_advisory_xact_lock(1919,1);IF admin.is_super_admin() IS NOT TRUE THEN RAISE EXCEPTION 'line invite management denied' USING ERRCODE='42501';END IF;
 IF input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid line invite reason';END IF;
 SELECT * INTO v FROM platform.line_invites WHERE id=input_id FOR UPDATE;IF NOT FOUND OR input_revision IS DISTINCT FROM v.revision THEN RAISE EXCEPTION 'line invite conflict' USING ERRCODE='40001';END IF;
 IF v.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('revoked',TRUE,'revision',v.revision);END IF;
 UPDATE platform.line_invites SET revoked_at=clock_timestamp(),revision=revision+1 WHERE id=input_id RETURNING revision INTO v.revision;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,scope_type,scope_id,reason,outcome) VALUES(admin.request_id(),admin.request_principal_id(),'line_invite.revoke','line_invite',input_id::text,'region',v.region_id,trim(input_reason),'success');RETURN jsonb_build_object('revoked',TRUE,'revision',v.revision);
END$$;
CREATE FUNCTION platform.line_invite_state(input_subject TEXT,input_token TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE state JSONB;v platform.line_invites;status TEXT;BEGIN
 IF input_subject IS NULL OR input_subject !~ '^U[0-9a-f]{32}$' THEN RAISE EXCEPTION 'invalid line invite identity';END IF;
 -- Existing authorization is independent of the invitation's validity or issuer.
 IF EXISTS(SELECT 1 FROM identity.platform_identities i JOIN identity.people p ON p.id=i.person_id JOIN identity.person_interaction_channels c ON c.person_id=p.id AND c.platform_identity_id=i.id JOIN identity.onboarding_applications a ON a.person_id=p.id AND a.platform='line' AND a.external_subject_id=input_subject AND a.status='approved' WHERE i.platform='line' AND i.external_subject_id=input_subject AND i.revoked_at IS NULL AND p.status='active' AND c.valid_to IS NULL AND c.valid_from<=clock_timestamp()) THEN
  state:=platform.privacy_status('line',input_subject);RETURN jsonb_build_object('status',CASE WHEN (state->>'required')::boolean OR (state->>'unavailable')::boolean THEN 'privacy' ELSE 'approved' END);
 END IF;
 SELECT a.status INTO status FROM identity.onboarding_applications a WHERE a.platform='line' AND a.external_subject_id=input_subject;
 IF status IS NOT NULL OR EXISTS(SELECT 1 FROM identity.platform_identities WHERE platform='line' AND external_subject_id=input_subject) THEN RETURN jsonb_build_object('status',CASE WHEN status='pending' THEN 'pending' ELSE 'blocked' END);END IF;
 IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN jsonb_build_object('status','invalid');END IF;
 SELECT * INTO v FROM platform.line_invites WHERE token_hash=public.digest(input_token,'sha256') AND revoked_at IS NULL AND expires_at>clock_timestamp() AND uses<max_uses;
 IF NOT FOUND OR admin.line_invite_issuer_active(v.issuer_id) IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM core.regions WHERE id=v.region_id AND active AND region_type='operational') THEN RETURN jsonb_build_object('status','invalid');END IF;
 state:=platform.privacy_status('line',input_subject);IF (state->>'unavailable')::boolean THEN RETURN jsonb_build_object('status','blocked');END IF;
 RETURN jsonb_build_object('status',CASE WHEN (state->>'required')::boolean THEN 'privacy' ELSE 'form' END,'region',(SELECT code FROM core.regions WHERE id=v.region_id),'regionName',(SELECT name_zh_tw FROM core.regions WHERE id=v.region_id));
END$$;
CREATE FUNCTION platform.redeem_line_invite(input_subject TEXT,input_token TEXT,input_name TEXT,input_email TEXT,input_phone TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE v platform.line_invites;person UUID;ident UUID;application UUID;state JSONB;BEGIN
 -- Serialize with grant changes, invite revocation and both normal/invited onboarding.
 PERFORM pg_advisory_xact_lock(1919,1);PERFORM pg_advisory_xact_lock(hashtextextended('line:'||coalesce(input_subject,''),0));
 state:=platform.line_invite_state(input_subject,input_token);
 IF state->>'status'='approved' THEN RETURN jsonb_build_object('status','approved','alreadyMember',TRUE);END IF;
 IF state->>'status'='privacy' THEN RAISE EXCEPTION 'privacy acceptance required' USING ERRCODE='42501';END IF;
 IF state->>'status'<>'form' THEN RAISE EXCEPTION 'line invite unavailable' USING ERRCODE='42501';END IF;
 IF input_name IS NULL OR length(trim(input_name)) NOT BETWEEN 1 AND 150 OR input_name ~ '[[:cntrl:]]' OR input_email IS NULL OR length(input_email)>254 OR input_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR input_phone IS NULL OR input_phone !~ '^\+[1-9][0-9]{6,14}$' THEN RAISE EXCEPTION 'invalid line invite details';END IF;
 SELECT * INTO v FROM platform.line_invites WHERE token_hash=public.digest(input_token,'sha256') FOR UPDATE;
 IF NOT FOUND OR v.revoked_at IS NOT NULL OR v.expires_at<=clock_timestamp() OR v.uses>=v.max_uses OR admin.line_invite_issuer_active(v.issuer_id) IS NOT TRUE THEN RAISE EXCEPTION 'line invite unavailable' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM core.regions WHERE id=v.region_id AND active AND region_type='operational' FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'line invite unavailable' USING ERRCODE='42501';END IF;
 PERFORM platform.require_privacy_subject('line',input_subject);
 -- Names/email/phone are self-reported metadata, never an identity lookup.
 application:=identity.submit_application('line',input_subject,trim(input_name),v.region_id);
 PERFORM 1 FROM identity.onboarding_applications WHERE id=application AND status='pending' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'line invite unavailable' USING ERRCODE='42501';END IF;
 IF v.expires_at<=clock_timestamp() OR admin.line_invite_issuer_active(v.issuer_id) IS NOT TRUE OR EXISTS(SELECT 1 FROM identity.platform_identities WHERE platform='line' AND external_subject_id=input_subject) THEN RAISE EXCEPTION 'line invite unavailable' USING ERRCODE='42501';END IF;
 INSERT INTO identity.people(preferred_name,membership_status,practice_timezone,reminder_timezone) SELECT trim(input_name),'pending',coalesce(default_timezone,'Asia/Taipei'),coalesce(default_timezone,'Asia/Taipei') FROM core.regions WHERE id=v.region_id RETURNING id INTO person;
 INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,display_name) VALUES(person,'line',input_subject,trim(input_name)) RETURNING id INTO ident;
 INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from,assigned_by_principal_id) VALUES(person,v.region_id,'primary',CURRENT_DATE,v.issuer_id);
 INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,activated_by_principal_id) VALUES(person,ident,'onboarding',v.issuer_id);
 UPDATE identity.onboarding_applications SET learner_name=trim(input_name),display_name=trim(input_name),website_email=lower(trim(input_email)),phone_e164=input_phone,status='approved',person_id=person,decided_by_principal_id=v.issuer_id,decided_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=application;
 INSERT INTO platform.line_invite_redemptions VALUES(v.id,ident,application,clock_timestamp());UPDATE platform.line_invites SET uses=uses+1 WHERE id=v.id;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,scope_type,scope_id,outcome,metadata) VALUES(admin.request_id(),v.issuer_id,'line_invite.redeem','onboarding_application',application::text,'region',v.region_id,'success',jsonb_build_object('inviteId',v.id));RETURN jsonb_build_object('status','approved','alreadyMember',FALSE);
END$$;
-- Serializing normal submissions prevents overwriting an invitation-approved profile.
ALTER FUNCTION platform.submit_line_application(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) RENAME TO _pre_invite_submit_line_application;
REVOKE ALL ON FUNCTION platform._pre_invite_submit_line_application(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION platform.submit_line_application(input_user TEXT,input_token TEXT,input_name TEXT,input_email TEXT,input_phone TEXT,input_region TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('line:'||coalesce(input_user,''),0));
 RETURN platform._pre_invite_submit_line_application(input_user,input_token,input_name,input_email,input_phone,input_region);
END$$;
CREATE FUNCTION ops.line_invite_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-14-line-invites')$$;
DO $$DECLARE r RECORD;BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='admin' AND p.proname IN('line_invite_issuer_active','create_line_invite','line_invite_list','revoke_line_invite')) OR (n.nspname='platform' AND p.proname IN('line_invite_state','redeem_line_invite','submit_line_application')) OR (n.nspname='ops' AND p.proname='line_invite_schema_ready') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',r.signature);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION admin.create_line_invite(TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,TEXT),admin.line_invite_list(INTEGER),admin.revoke_line_invite(UUID,INTEGER,TEXT),platform.line_invite_state(TEXT,TEXT),platform.redeem_line_invite(TEXT,TEXT,TEXT,TEXT,TEXT),platform.submit_line_application(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION ops.line_invite_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-14-line-invites',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
