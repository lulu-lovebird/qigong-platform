-- WhatsApp fixed bookmarks and opt-in device sessions. No provider activation or auto-approval.
CREATE TABLE platform.whatsapp_browser_sessions (
 id UUID NOT NULL DEFAULT gen_random_uuid(),token_hash BYTEA PRIMARY KEY,csrf_hash BYTEA NOT NULL,
 identity_id UUID NOT NULL REFERENCES identity.platform_identities(id),person_id UUID NOT NULL REFERENCES identity.people(id),
 remembered BOOLEAN NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),expires_at TIMESTAMPTZ NOT NULL,revoked_at TIMESTAMPTZ,
 CHECK(expires_at>created_at AND expires_at<=created_at+INTERVAL '720 hours')
);
ALTER TABLE platform.whatsapp_browser_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.whatsapp_browser_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.whatsapp_browser_sessions FROM PUBLIC;
CREATE INDEX whatsapp_browser_sessions_person ON platform.whatsapp_browser_sessions(person_id) WHERE revoked_at IS NULL;

CREATE FUNCTION platform.whatsapp_browser_credential_subject(input_credential TEXT,input_purpose TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target TEXT;
BEGIN
 IF input_credential IS NULL OR input_credential !~ '^[A-Za-z0-9_-]{43}$' OR input_purpose IS NULL OR input_purpose NOT IN ('apply','checkin') THEN RAISE EXCEPTION 'invalid WhatsApp link';END IF;
 IF input_purpose='checkin' THEN
  SELECT i.external_subject_id INTO target FROM platform.whatsapp_browser_sessions s
   JOIN identity.platform_identities i ON i.id=s.identity_id AND i.person_id=s.person_id AND i.platform='whatsapp'
   JOIN identity.people p ON p.id=s.person_id JOIN identity.person_interaction_channels c ON c.person_id=p.id AND c.platform_identity_id=i.id
   JOIN identity.onboarding_applications a ON a.person_id=p.id AND a.platform='whatsapp' AND a.external_subject_id=i.external_subject_id AND a.status='approved'
   WHERE s.token_hash=public.digest(input_credential,'sha256') AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
    AND i.revoked_at IS NULL AND p.status='active' AND c.valid_from<=clock_timestamp() AND c.valid_to IS NULL;
 END IF;
 IF target IS NULL THEN SELECT l.subject INTO target FROM platform.whatsapp_links l WHERE l.token_hash=public.digest(input_credential,'sha256') AND l.purpose=input_purpose AND l.expires_at>clock_timestamp() AND (input_purpose='checkin' OR l.used_at IS NULL);END IF;
 IF target IS NULL THEN RAISE EXCEPTION 'invalid WhatsApp link';END IF;RETURN target;
END$$;
CREATE OR REPLACE FUNCTION platform.whatsapp_link_subject(input_token TEXT,input_purpose TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target TEXT;BEGIN
 PERFORM platform.require_privacy_token('whatsapp',input_token,input_purpose);
 target:=platform.whatsapp_browser_credential_subject(input_token,input_purpose);
 IF input_purpose='checkin' AND platform.whatsapp_checkin_person(target) IS NULL THEN RAISE EXCEPTION 'invalid WhatsApp link';END IF;RETURN target;
END$$;
CREATE FUNCTION platform.whatsapp_legacy_checkin_allowed(input_token TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM platform.whatsapp_links WHERE token_hash=public.digest(input_token,'sha256') AND purpose='checkin' AND expires_at>clock_timestamp()) THEN RETURN FALSE;END IF;
 PERFORM platform.whatsapp_link_subject(input_token,'checkin');RETURN TRUE;
END$$;
CREATE FUNCTION platform.create_whatsapp_browser_session(input_link TEXT,input_session TEXT,input_csrf TEXT,input_remember BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE link platform.whatsapp_links;target UUID;ident UUID;until_time TIMESTAMPTZ;created TIMESTAMPTZ:=clock_timestamp();session_id UUID;
BEGIN
 IF input_session IS NULL OR input_session !~ '^[A-Za-z0-9_-]{43}$' OR input_csrf IS NULL OR input_csrf !~ '^[A-Za-z0-9_-]{43}$' OR input_remember IS NULL THEN RAISE EXCEPTION 'invalid WhatsApp browser session';END IF;
 SELECT * INTO link FROM platform.whatsapp_links WHERE token_hash=public.digest(input_link,'sha256') AND purpose='checkin' AND used_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid WhatsApp link';END IF;
 PERFORM platform.whatsapp_link_subject(input_link,'checkin');target:=platform.whatsapp_checkin_person(link.subject);
 IF target IS NULL THEN RAISE EXCEPTION 'invalid WhatsApp link';END IF;PERFORM 1 FROM identity.people WHERE id=target FOR UPDATE;
 IF link.expires_at<=clock_timestamp() OR platform.whatsapp_checkin_person(link.subject) IS DISTINCT FROM target THEN RAISE EXCEPTION 'invalid WhatsApp link';END IF;
 SELECT id INTO ident FROM identity.platform_identities WHERE platform='whatsapp' AND external_subject_id=link.subject AND person_id=target AND revoked_at IS NULL;
 IF ident IS NULL OR EXISTS(SELECT 1 FROM platform.whatsapp_links WHERE token_hash=public.digest(input_session,'sha256')) THEN RAISE EXCEPTION 'invalid WhatsApp browser session';END IF;
 created:=clock_timestamp();until_time:=created+CASE WHEN input_remember THEN INTERVAL '720 hours' ELSE INTERVAL '15 minutes' END;
 INSERT INTO platform.whatsapp_browser_sessions(token_hash,csrf_hash,identity_id,person_id,remembered,created_at,expires_at)
 VALUES(public.digest(input_session,'sha256'),public.digest(input_csrf,'sha256'),ident,target,input_remember,created,until_time) RETURNING id INTO session_id;
 UPDATE platform.whatsapp_links SET used_at=clock_timestamp() WHERE token_hash=link.token_hash;
 INSERT INTO audit.events(request_id,action,target_type,target_id,outcome,metadata) VALUES(admin.request_id(),'whatsapp.browser_login','browser_session',session_id::text,'success',jsonb_build_object('remembered',input_remember));
 RETURN jsonb_build_object('authenticated',TRUE,'remembered',input_remember,'expiresAt',until_time);
END$$;
CREATE FUNCTION platform.whatsapp_browser_session_info(input_session TEXT,input_csrf TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE session platform.whatsapp_browser_sessions;BEGIN
 IF input_session IS NULL OR input_session !~ '^[A-Za-z0-9_-]{43}$' OR input_csrf IS NULL OR input_csrf !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'invalid WhatsApp browser session';END IF;
 SELECT * INTO session FROM platform.whatsapp_browser_sessions WHERE token_hash=public.digest(input_session,'sha256') AND csrf_hash=public.digest(input_csrf,'sha256') AND revoked_at IS NULL AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid WhatsApp browser session';END IF;
 PERFORM platform.whatsapp_link_subject(input_session,'checkin');
 RETURN jsonb_build_object('authenticated',TRUE,'remembered',session.remembered,'expiresAt',session.expires_at);
END$$;
CREATE FUNCTION platform.revoke_whatsapp_browser_session(input_session TEXT,input_csrf TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE session_id UUID;BEGIN
 PERFORM platform.whatsapp_browser_session_info(input_session,input_csrf);
 UPDATE platform.whatsapp_browser_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE token_hash=public.digest(input_session,'sha256') RETURNING id INTO session_id;
 INSERT INTO audit.events(request_id,action,target_type,target_id,outcome) VALUES(admin.request_id(),'whatsapp.browser_logout','browser_session',session_id::text,'success');
END$$;
CREATE FUNCTION platform.revoke_whatsapp_browser_access() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF TG_TABLE_NAME='people' THEN
  IF NEW.status<>'active' THEN UPDATE platform.whatsapp_browser_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE person_id=NEW.id;END IF;
 ELSIF TG_TABLE_NAME='platform_identities' THEN
  IF NEW.revoked_at IS NOT NULL THEN UPDATE platform.whatsapp_browser_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE identity_id=NEW.id;END IF;
 ELSIF TG_TABLE_NAME='person_interaction_channels' THEN
  IF NEW.valid_to IS NOT NULL THEN UPDATE platform.whatsapp_browser_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE identity_id=NEW.platform_identity_id AND person_id=NEW.person_id;END IF;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER whatsapp_browser_people_revoke AFTER UPDATE OF status ON identity.people FOR EACH ROW EXECUTE FUNCTION platform.revoke_whatsapp_browser_access();
CREATE TRIGGER whatsapp_browser_identity_revoke AFTER UPDATE OF revoked_at ON identity.platform_identities FOR EACH ROW EXECUTE FUNCTION platform.revoke_whatsapp_browser_access();
CREATE TRIGGER whatsapp_browser_channel_revoke AFTER UPDATE OF valid_to ON identity.person_interaction_channels FOR EACH ROW EXECUTE FUNCTION platform.revoke_whatsapp_browser_access();
CREATE OR REPLACE FUNCTION platform.set_whatsapp_locale_by_token(input_token TEXT,input_locale TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE subject TEXT;purpose TEXT;BEGIN
 IF EXISTS(SELECT 1 FROM platform.whatsapp_browser_sessions WHERE token_hash=public.digest(input_token,'sha256')) THEN purpose:='checkin';
 ELSE SELECT l.purpose INTO purpose FROM platform.whatsapp_links l WHERE l.token_hash=public.digest(input_token,'sha256');END IF;
 subject:=platform.whatsapp_link_subject(input_token,purpose);PERFORM platform.set_identity_locale('whatsapp',subject,input_locale);
END$$;

-- Stop only WhatsApp practice receipts. LINE and application decisions stay unchanged.
ALTER FUNCTION platform.queue_channel_practice_receipt(TEXT,TEXT,UUID,TEXT) RENAME TO _pre_browser_queue_channel_practice_receipt;
REVOKE ALL ON FUNCTION platform._pre_browser_queue_channel_practice_receipt(TEXT,TEXT,UUID,TEXT) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION platform.queue_channel_practice_receipt(input_platform TEXT,input_credential TEXT,input_checkin UUID,input_action TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE target UUID;BEGIN
 IF input_platform='whatsapp' THEN target:=platform.channel_workspace_person(input_platform,input_credential);
 IF input_action IS NULL OR input_action NOT IN ('regular','makeup','corrected') OR NOT EXISTS(SELECT 1 FROM core.checkins WHERE id=input_checkin AND person_id=target) THEN RAISE EXCEPTION 'invalid receipt action';END IF;RETURN NULL;END IF;
 RETURN platform._pre_browser_queue_channel_practice_receipt(input_platform,input_credential,input_checkin,input_action);
END$$;
ALTER FUNCTION ops.channel_practice_receipt_eligible(UUID) RENAME TO _pre_browser_channel_practice_receipt_eligible;
REVOKE ALL ON FUNCTION ops._pre_browser_channel_practice_receipt_eligible(UUID) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION ops.channel_practice_receipt_eligible(input_id UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM ops.channel_practice_receipts WHERE id=input_id AND platform='line') AND ops._pre_browser_channel_practice_receipt_eligible(input_id)$$;
UPDATE ops.channel_practice_receipts SET status='cancelled',lease_id=NULL,leased_until=NULL,last_error='WhatsApp practice summaries disabled' WHERE platform='whatsapp' AND status IN ('pending','sending');

CREATE OR REPLACE FUNCTION platform.privacy_credential_subject(input_platform TEXT,input_credential TEXT,input_purpose TEXT DEFAULT 'checkin') RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE subject TEXT;
BEGIN
 CASE input_platform
 WHEN 'line' THEN subject:=input_credential;
 WHEN 'telegram' THEN
  IF input_purpose='apply' THEN SELECT telegram_user_id INTO subject FROM platform.telegram_application_links WHERE token_hash=public.digest(input_credential,'sha256') AND expires_at>clock_timestamp() AND used_at IS NULL;
  ELSE SELECT telegram_user_id INTO subject FROM platform.telegram_checkin_links WHERE token_hash=public.digest(input_credential,'sha256') AND expires_at>clock_timestamp();END IF;
 WHEN 'whatsapp' THEN subject:=platform.whatsapp_browser_credential_subject(input_credential,input_purpose);
 ELSE RAISE EXCEPTION 'invalid privacy identity';END CASE;
 IF subject IS NULL THEN RAISE EXCEPTION 'privacy credential unavailable' USING ERRCODE='42501';END IF;RETURN subject;
END$$;

CREATE OR REPLACE FUNCTION platform.channel_workspace_save(input_platform TEXT,input_credential TEXT,input_request UUID,input_date DATE,input_version INTEGER,input_methods TEXT[],input_note TEXT,input_tags UUID[]) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;ident UUID;practice UUID;actual_version INTEGER;anchor DATE;zone TEXT;old_request ops.channel_practice_requests;fingerprint BYTEA;result JSONB;action TEXT;receipt UUID;subject TEXT;
BEGIN
 target:=platform.channel_workspace_person(input_platform,input_credential);
 SELECT practice_timezone INTO zone FROM identity.people WHERE id=target FOR UPDATE;
 IF platform.channel_workspace_person(input_platform,input_credential) IS DISTINCT FROM target THEN RAISE EXCEPTION 'practice identity unavailable';END IF;
 IF coalesce(input_note,'')<>'' OR cardinality(input_tags)>0 THEN PERFORM platform.require_reflection_consent(input_platform,input_credential);END IF;
 ident:=platform.channel_workspace_identity(input_platform,input_credential,target);
 IF input_request IS NULL OR input_date IS NULL OR input_version IS NULL OR input_version<0 THEN RAISE EXCEPTION 'invalid workspace save';END IF;
 fingerprint:=public.digest(jsonb_build_array(input_date,input_version,input_methods,input_note,input_tags)::text,'sha256');
 SELECT * INTO old_request FROM ops.channel_practice_requests WHERE identity_id=ident AND request_id=input_request;
 IF old_request.identity_id IS NOT NULL THEN IF old_request.payload_hash<>fingerprint THEN RAISE EXCEPTION 'workspace request conflict' USING ERRCODE='40001';END IF;RETURN old_request.result||CASE WHEN input_platform='whatsapp' THEN jsonb_build_object('receiptQueued',FALSE) ELSE '{}'::jsonb END;END IF;
 IF NOT EXISTS(SELECT 1 FROM platform.telegram_workspace_preferences WHERE person_id=target) THEN RAISE EXCEPTION 'workspace timezone unconfirmed';END IF;
 anchor:=(CURRENT_TIMESTAMP AT TIME ZONE zone)::date;
 IF (clock_timestamp() AT TIME ZONE zone)::date<>anchor OR (input_date<>anchor AND (input_date<>anchor-1 OR (clock_timestamp() AT TIME ZONE zone)::time>=TIME '12:00')) THEN RAISE EXCEPTION 'checkin correction unavailable';END IF;
 SELECT id INTO practice FROM core.checkins WHERE person_id=target AND practice_date=input_date FOR UPDATE;
 SELECT external_subject_id INTO subject FROM identity.platform_identities WHERE id=ident;
 IF practice IS NULL THEN
  IF input_version<>0 THEN RAISE EXCEPTION 'workspace version conflict' USING ERRCODE='40001';END IF;
  IF input_platform='line' THEN SELECT checkin_id,entry_kind INTO practice,action FROM platform.submit_line_checkin(subject,input_methods,input_date=anchor-1);
  ELSE SELECT checkin_id,entry_kind INTO practice,action FROM platform.submit_whatsapp_checkin(subject,input_methods,input_date=anchor-1);END IF;
 ELSE
  SELECT coalesce((SELECT revision FROM platform.telegram_practice_versions WHERE checkin_id=practice),0) INTO actual_version;
  IF actual_version<>input_version THEN RAISE EXCEPTION 'workspace version conflict' USING ERRCODE='40001';END IF;
  IF input_platform='line' THEN PERFORM platform.correct_line_checkin(subject,practice,input_methods);ELSE PERFORM platform.correct_whatsapp_checkin(subject,practice,input_methods);END IF;action:='corrected';
 END IF;
 PERFORM platform.save_practice_note(input_platform,input_credential,practice,input_note,input_tags);
 receipt:=platform.queue_channel_practice_receipt(input_platform,input_credential,practice,action);
 SELECT revision INTO actual_version FROM platform.telegram_practice_versions WHERE checkin_id=practice;
 result:=jsonb_build_object('checkinId',practice,'version',actual_version,'action',action,'receiptQueued',coalesce((SELECT status='pending' FROM ops.channel_practice_receipts WHERE id=receipt),FALSE));
 INSERT INTO ops.channel_practice_requests(identity_id,request_id,payload_hash,result) VALUES(ident,input_request,fingerprint,result);RETURN result;
END$$;

DO $$DECLARE f RECORD;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='platform' AND p.proname IN ('whatsapp_browser_credential_subject','whatsapp_legacy_checkin_allowed','create_whatsapp_browser_session','whatsapp_browser_session_info','revoke_whatsapp_browser_session','revoke_whatsapp_browser_access','queue_channel_practice_receipt') LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);END LOOP;END$$;
REVOKE ALL ON FUNCTION ops.channel_practice_receipt_eligible(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.whatsapp_legacy_checkin_allowed(TEXT),platform.create_whatsapp_browser_session(TEXT,TEXT,TEXT,BOOLEAN),platform.whatsapp_browser_session_info(TEXT,TEXT),platform.revoke_whatsapp_browser_session(TEXT,TEXT) TO qigong_api_runtime;
CREATE FUNCTION ops.whatsapp_browser_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-12-whatsapp-browser')$$;
REVOKE ALL ON FUNCTION ops.whatsapp_browser_schema_ready() FROM PUBLIC;GRANT EXECUTE ON FUNCTION ops.whatsapp_browser_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-12-whatsapp-browser',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
