-- Explicitly enabled Telegram reminders; no legacy settings import or provider activation.
CREATE TABLE platform.telegram_reminder_settings (
 person_id UUID PRIMARY KEY REFERENCES identity.people(id),enabled BOOLEAN NOT NULL DEFAULT FALSE,
 hour INTEGER NOT NULL DEFAULT 21 CHECK(hour BETWEEN 0 AND 23),timezone TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,last_preview_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE platform.telegram_reminder_updates (
 update_id BIGINT PRIMARY KEY,subject_hash BYTEA NOT NULL,fingerprint BYTEA NOT NULL,result JSONB NOT NULL
);
CREATE TABLE ops.telegram_reminders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),person_id UUID NOT NULL REFERENCES identity.people(id),identity_id UUID NOT NULL REFERENCES identity.platform_identities(id),
 dedup_key TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('daily','preview')),settings_revision INTEGER NOT NULL,
 locale TEXT NOT NULL CHECK(locale IN('zh_TW','en')),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sending','sent','cancelled','failed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),expires_at TIMESTAMPTZ NOT NULL,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),attempts INTEGER NOT NULL DEFAULT 0,lease_id UUID,leased_until TIMESTAMPTZ,
 UNIQUE(identity_id,dedup_key)
);
ALTER TABLE platform.telegram_reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.telegram_reminder_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.telegram_reminder_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.telegram_reminder_updates FORCE ROW LEVEL SECURITY;
ALTER TABLE ops.telegram_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.telegram_reminders FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.telegram_reminder_settings,platform.telegram_reminder_updates,ops.telegram_reminders FROM PUBLIC;
CREATE INDEX telegram_reminders_due ON ops.telegram_reminders(next_attempt_at) WHERE status IN('pending','sending');
CREATE FUNCTION platform.telegram_reminder_identity(input_subject TEXT) RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE ident UUID;state JSONB;BEGIN
 IF platform.telegram_workspace_ready(input_subject) IS NOT TRUE THEN RETURN NULL;END IF;
 state:=platform.privacy_status('telegram',input_subject);
 IF (state->>'required')::boolean OR (state->>'unavailable')::boolean THEN RETURN NULL;END IF;
 SELECT id INTO ident FROM identity.platform_identities WHERE platform='telegram' AND external_subject_id=input_subject AND revoked_at IS NULL;RETURN ident;
END$$;
CREATE FUNCTION platform.telegram_reminder_command(input_update BIGINT,input_subject TEXT,input_action TEXT,input_value TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ident UUID;target UUID;pref platform.telegram_reminder_settings;old platform.telegram_reminder_updates;finger BYTEA;result JSONB;preview BOOLEAN:=FALSE;
BEGIN
 IF input_update IS NULL OR input_update<0 OR input_subject IS NULL OR input_subject !~ '^[0-9]{1,20}$' OR input_action IS NULL OR input_action NOT IN('read','on','off','hour','timezone','preview') THEN RAISE EXCEPTION 'invalid reminder command';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram-reminder-update:'||input_update,0));
 finger:=public.digest(jsonb_build_array(input_action,input_value)::text,'sha256');SELECT * INTO old FROM platform.telegram_reminder_updates WHERE update_id=input_update;
 IF FOUND THEN IF old.subject_hash<>platform.privacy_subject_hash('telegram',input_subject) OR old.fingerprint<>finger THEN RAISE EXCEPTION 'reminder update conflict';END IF;RETURN old.result||jsonb_build_object('replayed',TRUE);END IF;
 SELECT id,person_id INTO ident,target FROM identity.platform_identities WHERE platform='telegram' AND external_subject_id=input_subject;
 IF ident IS NULL THEN RAISE EXCEPTION 'reminder access unavailable' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM identity.people WHERE id=target FOR UPDATE;
 IF input_action<>'off' AND platform.telegram_reminder_identity(input_subject) IS DISTINCT FROM ident THEN RAISE EXCEPTION 'reminder access unavailable' USING ERRCODE='42501';END IF;
 INSERT INTO platform.telegram_reminder_settings(person_id,timezone) SELECT id,practice_timezone FROM identity.people WHERE id=target ON CONFLICT DO NOTHING;
 SELECT * INTO pref FROM platform.telegram_reminder_settings WHERE person_id=target FOR UPDATE;
 IF input_action='hour' THEN IF input_value IS NULL OR input_value !~ '^[0-9]{1,2}$' OR input_value::integer NOT BETWEEN 0 AND 23 THEN RAISE EXCEPTION 'invalid reminder hour';END IF;pref.hour:=input_value::integer;pref.enabled:=TRUE;
 ELSIF input_action='timezone' THEN IF input_value IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=input_value) THEN RAISE EXCEPTION 'invalid reminder timezone';END IF;pref.timezone:=input_value;
 ELSIF input_action IN('on','off') THEN pref.enabled:=input_action='on';
 ELSIF input_action='preview' THEN
  IF pref.last_preview_at>clock_timestamp()-INTERVAL '5 minutes' THEN RAISE EXCEPTION 'reminder preview rate limited';END IF;
  UPDATE platform.telegram_reminder_settings SET last_preview_at=clock_timestamp() WHERE person_id=target;
  INSERT INTO ops.telegram_reminders(person_id,identity_id,dedup_key,kind,settings_revision,locale,expires_at)
   VALUES(target,ident,'preview:'||input_update,'preview',pref.revision,platform.get_identity_locale('telegram',input_subject),clock_timestamp()+INTERVAL '5 minutes');preview:=TRUE;
 END IF;
 IF input_action IN('on','off','hour','timezone') THEN
  UPDATE platform.telegram_reminder_settings SET enabled=pref.enabled,hour=pref.hour,timezone=pref.timezone,revision=revision+1,updated_at=clock_timestamp() WHERE person_id=target RETURNING * INTO pref;
  UPDATE ops.telegram_reminders SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE person_id=target AND status IN('pending','sending');
  INSERT INTO audit.events(request_id,action,target_type,target_id,outcome,metadata) VALUES(admin.request_id(),'telegram.reminder_settings','person',target::text,'success',jsonb_build_object('enabled',pref.enabled,'hour',pref.hour,'timezone',pref.timezone));
 END IF;
 result:=jsonb_build_object('enabled',pref.enabled,'hour',pref.hour,'timezone',pref.timezone,'revision',pref.revision,'previewQueued',preview,'replayed',FALSE);
 INSERT INTO platform.telegram_reminder_updates VALUES(input_update,platform.privacy_subject_hash('telegram',input_subject),finger,result);RETURN result;
END$$;
CREATE FUNCTION ops.telegram_reminder_eligible(input_id UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM ops.telegram_reminders j JOIN platform.telegram_reminder_settings s ON s.person_id=j.person_id JOIN identity.platform_identities i ON i.id=j.identity_id AND i.person_id=j.person_id
 WHERE j.id=input_id AND j.expires_at>clock_timestamp() AND s.revision=j.settings_revision AND (j.kind='preview' OR s.enabled)
 AND platform.telegram_reminder_identity(i.external_subject_id)=i.id)
$$;
CREATE FUNCTION ops.queue_telegram_reminders(input_limit INTEGER DEFAULT 100) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r RECORD;n INTEGER:=0;BEGIN
 IF input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid reminder batch';END IF;
 UPDATE ops.telegram_reminders SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE status IN('pending','sending') AND NOT ops.telegram_reminder_eligible(id);
 FOR r IN SELECT s.*,i.id identity_id,i.external_subject_id subject,(clock_timestamp() AT TIME ZONE s.timezone)::date local_date,
 (((clock_timestamp() AT TIME ZONE s.timezone)::date+make_time(s.hour,0,0)) AT TIME ZONE s.timezone) due
 FROM platform.telegram_reminder_settings s JOIN identity.platform_identities i ON i.person_id=s.person_id AND i.platform='telegram' AND i.revoked_at IS NULL
 WHERE s.enabled AND platform.telegram_reminder_identity(i.external_subject_id)=i.id
 AND NOT EXISTS(SELECT 1 FROM ops.telegram_reminders j WHERE j.identity_id=i.id AND j.dedup_key='daily:'||(clock_timestamp() AT TIME ZONE s.timezone)::date)
 AND clock_timestamp()>=(((clock_timestamp() AT TIME ZONE s.timezone)::date+make_time(s.hour,0,0)) AT TIME ZONE s.timezone)
 AND clock_timestamp()<(((clock_timestamp() AT TIME ZONE s.timezone)::date+make_time(s.hour,0,0)) AT TIME ZONE s.timezone)+INTERVAL '1 hour'
 ORDER BY s.person_id LIMIT input_limit FOR UPDATE OF s SKIP LOCKED LOOP
  INSERT INTO ops.telegram_reminders(person_id,identity_id,dedup_key,kind,settings_revision,locale,expires_at)
   VALUES(r.person_id,r.identity_id,'daily:'||r.local_date,'daily',r.revision,platform.get_identity_locale('telegram',r.subject),r.due+INTERVAL '1 hour') ON CONFLICT DO NOTHING;
  IF FOUND THEN n:=n+1;END IF;
 END LOOP;RETURN n;
END$$;
CREATE FUNCTION ops.claim_telegram_reminders(input_limit INTEGER DEFAULT 25) RETURNS TABLE(id UUID,lease_id UUID,recipient TEXT,locale TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r RECORD;lease UUID;BEGIN
 IF input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'invalid reminder batch';END IF;
 UPDATE ops.telegram_reminders j SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE j.status IN('pending','sending') AND NOT ops.telegram_reminder_eligible(j.id);
 FOR r IN SELECT j.id,i.external_subject_id,j.locale FROM ops.telegram_reminders j JOIN identity.platform_identities i ON i.id=j.identity_id
 WHERE j.next_attempt_at<=clock_timestamp() AND (j.status='pending' OR (j.status='sending' AND j.leased_until<clock_timestamp())) AND j.attempts<5 AND ops.telegram_reminder_eligible(j.id)
 ORDER BY (j.kind='preview') DESC,j.next_attempt_at,j.id LIMIT input_limit FOR UPDATE OF j SKIP LOCKED LOOP
 lease:=gen_random_uuid();UPDATE ops.telegram_reminders j SET status='sending',lease_id=lease,leased_until=clock_timestamp()+INTERVAL '2 minutes',attempts=attempts+1 WHERE j.id=r.id;
 id:=r.id;lease_id:=lease;recipient:=r.external_subject_id;locale:=r.locale;RETURN NEXT;END LOOP;
 UPDATE ops.telegram_reminders j SET status='failed',lease_id=NULL,leased_until=NULL WHERE j.status='sending' AND j.attempts>=5 AND j.leased_until<clock_timestamp();
END$$;
CREATE FUNCTION ops.telegram_reminder_allowed(input_id UUID,input_lease UUID) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM ops.telegram_reminders WHERE id=input_id AND lease_id=input_lease AND status='sending' AND leased_until>clock_timestamp()) AND ops.telegram_reminder_eligible(input_id)$$;
CREATE FUNCTION ops.finish_telegram_reminder(input_id UUID,input_lease UUID,input_sent BOOLEAN) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF input_sent IS NULL THEN RETURN FALSE;END IF;
 UPDATE ops.telegram_reminders SET status=CASE WHEN NOT ops.telegram_reminder_eligible(input_id) THEN 'cancelled' WHEN input_sent THEN 'sent' WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
 next_attempt_at=clock_timestamp()+INTERVAL '1 minute'*least(15,power(2,attempts)::integer),lease_id=NULL,leased_until=NULL
 WHERE id=input_id AND lease_id=input_lease AND status='sending' AND leased_until>clock_timestamp();RETURN FOUND;
END$$;
CREATE FUNCTION platform.cancel_telegram_reminder_access() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF TG_TABLE_NAME='people' THEN IF NEW.status<>'active' THEN UPDATE ops.telegram_reminders SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE person_id=NEW.id AND status IN('pending','sending');END IF;
 ELSIF TG_TABLE_NAME='platform_identities' THEN IF NEW.revoked_at IS NOT NULL THEN UPDATE ops.telegram_reminders SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE identity_id=NEW.id AND status IN('pending','sending');END IF;
 ELSE IF NEW.valid_to IS NOT NULL THEN UPDATE ops.telegram_reminders SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE identity_id=NEW.platform_identity_id AND status IN('pending','sending');END IF;END IF;RETURN NEW;
END$$;
CREATE TRIGGER telegram_reminder_person_cancel AFTER UPDATE OF status ON identity.people FOR EACH ROW EXECUTE FUNCTION platform.cancel_telegram_reminder_access();
CREATE TRIGGER telegram_reminder_identity_cancel AFTER UPDATE OF revoked_at ON identity.platform_identities FOR EACH ROW EXECUTE FUNCTION platform.cancel_telegram_reminder_access();
CREATE TRIGGER telegram_reminder_channel_cancel AFTER UPDATE OF valid_to ON identity.person_interaction_channels FOR EACH ROW EXECUTE FUNCTION platform.cancel_telegram_reminder_access();
CREATE FUNCTION ops.telegram_reminder_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-13-telegram-reminders')$$;
DO $$DECLARE r RECORD;BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='platform' AND p.proname IN('telegram_reminder_identity','telegram_reminder_command','cancel_telegram_reminder_access')) OR (n.nspname='ops' AND p.proname IN('telegram_reminder_eligible','queue_telegram_reminders','claim_telegram_reminders','telegram_reminder_allowed','finish_telegram_reminder','telegram_reminder_schema_ready')) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',r.signature);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION platform.telegram_reminder_command(BIGINT,TEXT,TEXT,TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION ops.queue_telegram_reminders(INTEGER),ops.claim_telegram_reminders(INTEGER),ops.telegram_reminder_allowed(UUID,UUID),ops.finish_telegram_reminder(UUID,UUID,BOOLEAN) TO qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION ops.telegram_reminder_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-13-telegram-reminders',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
