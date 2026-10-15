-- Subject-bound, short-lived invitation continuation. No plaintext invitation/resume tokens or backfill.
CREATE TABLE platform.line_invite_continuations (
 external_subject_id TEXT PRIMARY KEY CHECK(external_subject_id ~ '^U[0-9a-f]{32}$'),
 invite_id UUID NOT NULL REFERENCES platform.line_invites(id),nonce UUID NOT NULL,
 token_hash BYTEA NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
 expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 CHECK(expires_at>created_at AND expires_at<=created_at+INTERVAL '15 minutes')
);
ALTER TABLE platform.line_invite_continuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.line_invite_continuations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.line_invite_continuations FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE INDEX line_invite_continuation_expiry ON platform.line_invite_continuations(expires_at);
-- Resume capabilities cannot be redeemed by a different verified LINE subject.
CREATE FUNCTION platform.line_invite_target(input_subject TEXT,input_token TEXT) RETURNS UUID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT id FROM (
  SELECT v.id FROM platform.line_invites v WHERE v.token_hash=public.digest(input_token,'sha256')
  UNION ALL
  SELECT c.invite_id FROM platform.line_invite_continuations c WHERE c.external_subject_id=input_subject AND c.token_hash=public.digest(input_token,'sha256') AND c.expires_at>clock_timestamp()
 ) targets LIMIT 1
$$;
CREATE OR REPLACE FUNCTION platform.line_invite_state(input_subject TEXT,input_token TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE state JSONB;v platform.line_invites;status TEXT;BEGIN
 IF input_subject IS NULL OR input_subject !~ '^U[0-9a-f]{32}$' THEN RAISE EXCEPTION 'invalid line invite identity';END IF;
 -- Existing authorization is independent of the invitation's validity or issuer.
 IF EXISTS(SELECT 1 FROM identity.platform_identities i JOIN identity.people p ON p.id=i.person_id JOIN identity.person_interaction_channels c ON c.person_id=p.id AND c.platform_identity_id=i.id JOIN identity.onboarding_applications a ON a.person_id=p.id AND a.platform='line' AND a.external_subject_id=input_subject AND a.status='approved' WHERE i.platform='line' AND i.external_subject_id=input_subject AND i.revoked_at IS NULL AND p.status='active' AND c.valid_to IS NULL AND c.valid_from<=clock_timestamp()) THEN
  state:=platform.privacy_status('line',input_subject);RETURN jsonb_build_object('status',CASE WHEN (state->>'required')::boolean OR (state->>'unavailable')::boolean THEN 'privacy' ELSE 'approved' END);
 END IF;
 SELECT a.status INTO status FROM identity.onboarding_applications a WHERE a.platform='line' AND a.external_subject_id=input_subject;
 IF (status IS NOT NULL AND status<>'pending') OR EXISTS(SELECT 1 FROM identity.platform_identities WHERE platform='line' AND external_subject_id=input_subject) THEN RETURN jsonb_build_object('status',CASE WHEN status='pending' THEN 'pending' ELSE 'blocked' END);END IF;
 IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' THEN RETURN jsonb_build_object('status','invalid');END IF;
 SELECT * INTO v FROM platform.line_invites WHERE id=platform.line_invite_target(input_subject,input_token) AND revoked_at IS NULL AND expires_at>clock_timestamp() AND uses<max_uses;
 IF NOT FOUND OR admin.line_invite_issuer_active(v.issuer_id) IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM core.regions WHERE id=v.region_id AND active AND region_type='operational') THEN RETURN jsonb_build_object('status','invalid');END IF;
 state:=platform.privacy_status('line',input_subject);IF (state->>'unavailable')::boolean THEN RETURN jsonb_build_object('status','blocked');END IF;
 RETURN jsonb_build_object('status',CASE WHEN (state->>'required')::boolean THEN 'privacy' ELSE 'form' END,'region',(SELECT code FROM core.regions WHERE id=v.region_id),'regionName',(SELECT name_zh_tw FROM core.regions WHERE id=v.region_id),'pendingApplication',coalesce(status='pending',FALSE));
END$$;
CREATE OR REPLACE FUNCTION platform.redeem_line_invite(input_subject TEXT,input_token TEXT,input_name TEXT,input_email TEXT,input_phone TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE v platform.line_invites;person UUID;ident UUID;application UUID;state JSONB;BEGIN
 -- Serialize with grant changes, invite revocation and both normal/invited onboarding.
 PERFORM pg_advisory_xact_lock(1919,1);PERFORM pg_advisory_xact_lock(hashtextextended('line:'||coalesce(input_subject,''),0));
 state:=platform.line_invite_state(input_subject,input_token);
 IF state->>'status'='approved' THEN RETURN jsonb_build_object('status','approved','alreadyMember',TRUE);END IF;
 IF state->>'status'='privacy' THEN RAISE EXCEPTION 'privacy acceptance required' USING ERRCODE='42501';END IF;
 IF state->>'status'<>'form' THEN RAISE EXCEPTION 'line invite unavailable' USING ERRCODE='42501';END IF;
 IF input_name IS NULL OR length(trim(input_name)) NOT BETWEEN 1 AND 150 OR input_name ~ '[[:cntrl:]]' OR input_email IS NULL OR length(input_email)>254 OR input_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR input_phone IS NULL OR input_phone !~ '^\+[1-9][0-9]{6,14}$' THEN RAISE EXCEPTION 'invalid line invite details';END IF;
 SELECT * INTO v FROM platform.line_invites WHERE id=platform.line_invite_target(input_subject,input_token) FOR UPDATE;
 IF NOT FOUND OR v.revoked_at IS NOT NULL OR v.expires_at<=clock_timestamp() OR v.uses>=v.max_uses OR admin.line_invite_issuer_active(v.issuer_id) IS NOT TRUE THEN RAISE EXCEPTION 'line invite unavailable' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM core.regions WHERE id=v.region_id AND active AND region_type='operational' FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'line invite unavailable' USING ERRCODE='42501';END IF;
 PERFORM platform.require_privacy_subject('line',input_subject);
 -- Names/email/phone are self-reported metadata, never an identity lookup.
 application:=identity.submit_application('line',input_subject,trim(input_name),v.region_id);
 PERFORM 1 FROM identity.onboarding_applications WHERE id=application AND status='pending' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'line invite unavailable' USING ERRCODE='42501';END IF;
 IF v.expires_at<=clock_timestamp() OR platform.line_invite_target(input_subject,input_token) IS DISTINCT FROM v.id OR admin.line_invite_issuer_active(v.issuer_id) IS NOT TRUE OR EXISTS(SELECT 1 FROM identity.platform_identities WHERE platform='line' AND external_subject_id=input_subject) THEN RAISE EXCEPTION 'line invite unavailable' USING ERRCODE='42501';END IF;
 INSERT INTO identity.people(preferred_name,membership_status,practice_timezone,reminder_timezone) SELECT trim(input_name),'pending',coalesce(default_timezone,'Asia/Taipei'),coalesce(default_timezone,'Asia/Taipei') FROM core.regions WHERE id=v.region_id RETURNING id INTO person;
 INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,display_name) VALUES(person,'line',input_subject,trim(input_name)) RETURNING id INTO ident;
 INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from,assigned_by_principal_id) VALUES(person,v.region_id,'primary',CURRENT_DATE,v.issuer_id);
 INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,activated_by_principal_id) VALUES(person,ident,'onboarding',v.issuer_id);
 UPDATE identity.onboarding_applications SET requested_region_id=v.region_id,learner_name=trim(input_name),display_name=trim(input_name),website_email=lower(trim(input_email)),phone_e164=input_phone,status='approved',person_id=person,decided_by_principal_id=v.issuer_id,decided_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=application;
 DELETE FROM platform.line_invite_continuations WHERE external_subject_id=input_subject;
 UPDATE ops.review_notification_deliveries d SET status='cancelled',lease_id=NULL,leased_until=NULL FROM ops.review_notification_events e WHERE e.id=d.event_id AND e.kind='learner' AND e.target_id=application AND d.status IN('pending','sending');
 INSERT INTO platform.line_invite_redemptions VALUES(v.id,ident,application,clock_timestamp());UPDATE platform.line_invites SET uses=uses+1 WHERE id=v.id;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,scope_type,scope_id,outcome,metadata) VALUES(admin.request_id(),v.issuer_id,'line_invite.redeem','onboarding_application',application::text,'region',v.region_id,'success',jsonb_build_object('inviteId',v.id));RETURN jsonb_build_object('status','approved','alreadyMember',FALSE);
END$$;

-- Called only after server verification of the exact LINE subject and an explicit invitation.
CREATE FUNCTION platform.remember_line_invite(input_subject TEXT,input_token TEXT,input_nonce UUID,input_resume TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE state JSONB;target UUID;result UUID;expiry TIMESTAMPTZ;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('line:'||coalesce(input_subject,''),0));
 IF input_nonce IS NULL OR input_resume IS NULL OR input_resume !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'invalid line invite continuation';END IF;
 state:=platform.line_invite_state(input_subject,input_token);
 IF state->>'status' NOT IN('form','privacy') OR state->>'region' IS NULL THEN RAISE EXCEPTION 'line invite unavailable' USING ERRCODE='42501';END IF;
 target:=platform.line_invite_target(input_subject,input_token);
 SELECT nonce INTO result FROM platform.line_invite_continuations WHERE external_subject_id=input_subject AND invite_id=target AND expires_at>clock_timestamp() FOR UPDATE;
 IF FOUND THEN
  -- Keep stable links until expiry; refresh only the hash if the server signing secret rotated.
  IF result=input_nonce THEN UPDATE platform.line_invite_continuations SET token_hash=public.digest(input_resume,'sha256') WHERE external_subject_id=input_subject AND token_hash IS DISTINCT FROM public.digest(input_resume,'sha256');END IF;
  RETURN result;
 END IF;
 SELECT least(expires_at,clock_timestamp()+INTERVAL '15 minutes') INTO expiry FROM platform.line_invites WHERE id=target AND revoked_at IS NULL AND expires_at>clock_timestamp() AND uses<max_uses;
 IF NOT FOUND OR expiry<=clock_timestamp() THEN RAISE EXCEPTION 'line invite unavailable' USING ERRCODE='42501';END IF;
 DELETE FROM platform.line_invite_continuations WHERE external_subject_id IN(SELECT external_subject_id FROM platform.line_invite_continuations WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED);
 INSERT INTO platform.line_invite_continuations(external_subject_id,invite_id,nonce,token_hash,expires_at) VALUES(input_subject,target,input_nonce,public.digest(input_resume,'sha256'),expiry)
 ON CONFLICT(external_subject_id) DO UPDATE SET invite_id=EXCLUDED.invite_id,nonce=EXCLUDED.nonce,token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,created_at=EXCLUDED.created_at;
 RETURN input_nonce;
END$$;
CREATE FUNCTION platform.line_invite_continuation(input_subject TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result UUID;BEGIN
 DELETE FROM platform.line_invite_continuations WHERE external_subject_id IN(SELECT external_subject_id FROM platform.line_invite_continuations WHERE expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED);
 IF input_subject IS NULL OR input_subject !~ '^U[0-9a-f]{32}$' THEN RAISE EXCEPTION 'invalid line invite identity';END IF;
 IF EXISTS(SELECT 1 FROM identity.platform_identities WHERE platform='line' AND external_subject_id=input_subject) OR EXISTS(SELECT 1 FROM identity.onboarding_applications WHERE platform='line' AND external_subject_id=input_subject AND status<>'pending') THEN RETURN NULL;END IF;
 SELECT c.nonce INTO result FROM platform.line_invite_continuations c JOIN platform.line_invites v ON v.id=c.invite_id JOIN core.regions r ON r.id=v.region_id WHERE c.external_subject_id=input_subject AND c.expires_at>clock_timestamp() AND v.revoked_at IS NULL AND v.expires_at>clock_timestamp() AND v.uses<v.max_uses AND r.active AND r.region_type='operational' AND admin.line_invite_issuer_active(v.issuer_id);
 RETURN result;
END$$;
-- An old/manual form must not silently downgrade a saved invitation to pending.
CREATE OR REPLACE FUNCTION platform.submit_line_application(input_user TEXT,input_token TEXT,input_name TEXT,input_email TEXT,input_phone TEXT,input_region TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('line:'||coalesce(input_user,''),0));
 IF platform.line_invite_continuation(input_user) IS NOT NULL THEN RAISE EXCEPTION 'LINE invite continuation required' USING ERRCODE='42501';END IF;
 RETURN platform._pre_invite_submit_line_application(input_user,input_token,input_name,input_email,input_phone,input_region);
END$$;
CREATE FUNCTION ops.line_invite_continuation_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-18-line-invite-continuation')$$;
REVOKE ALL ON FUNCTION platform.line_invite_target(TEXT,TEXT),platform.remember_line_invite(TEXT,TEXT,UUID,TEXT),platform.line_invite_continuation(TEXT),ops.line_invite_continuation_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.remember_line_invite(TEXT,TEXT,UUID,TEXT),platform.line_invite_continuation(TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION ops.line_invite_continuation_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-18-line-invite-continuation',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
