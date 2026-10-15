-- New disclosed LINE/Telegram notes only. Never backfill old notes or legal consent.
CREATE TABLE core.community_note_origins (
 checkin_id UUID PRIMARY KEY REFERENCES core.checkins(id) ON DELETE CASCADE,
 notice_version TEXT NOT NULL CHECK(notice_version='student-community-notes-v1'),
 manual_controlled BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE core.community_note_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.community_note_origins FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.community_note_origins FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION core.capture_community_note_origin() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('qigong.community_notice',TRUE)='student-community-notes-v1' AND EXISTS(SELECT 1 FROM identity.platform_identities WHERE id=NEW.submitted_via_identity_id AND platform IN('line','telegram')) THEN
  INSERT INTO core.community_note_origins(checkin_id,notice_version) VALUES(NEW.id,'student-community-notes-v1');
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER capture_community_note_origin AFTER INSERT ON core.checkins FOR EACH ROW EXECUTE FUNCTION core.capture_community_note_origin();
-- Author publication/withdrawal choices and privacy revocation override future auto-refresh.
CREATE FUNCTION core.community_note_manual_control() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('qigong.community_publishing',TRUE) IS DISTINCT FROM 'yes' THEN UPDATE core.community_note_origins SET manual_controlled=TRUE WHERE checkin_id=NEW.checkin_id;END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER community_note_manual_control AFTER INSERT OR UPDATE ON core.journal_publications FOR EACH ROW EXECUTE FUNCTION core.community_note_manual_control();
CREATE OR REPLACE FUNCTION core.refresh_default_publication() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE practice UUID;entry core.checkins;origin platform.learner_privacy_acceptances;source JSONB;prior core.journal_publications;note TEXT;tags JSONB;label TEXT;
BEGIN
 IF TG_TABLE_NAME='checkins' THEN practice:=coalesce(NEW.id,OLD.id);ELSE practice:=coalesce(NEW.checkin_id,OLD.checkin_id);END IF;
 SELECT c.* INTO entry FROM core.checkins c WHERE c.id=practice;
 IF entry.id IS NULL THEN RETURN NULL;END IF;
 -- These records are refreshed only by a save that carries the displayed community notice.
 IF EXISTS(SELECT 1 FROM core.community_note_origins WHERE checkin_id=practice) THEN RETURN NULL;END IF;
 SELECT a.* INTO origin FROM core.checkin_privacy_origins o JOIN platform.learner_privacy_acceptances a ON a.id=o.acceptance_id WHERE o.checkin_id=practice AND a.revoked_at IS NULL;
 IF origin.id IS NULL OR NOT EXISTS(SELECT 1 FROM identity.people WHERE id=entry.person_id AND status='active') THEN RETURN NULL;END IF;
 source:=platform.journal_source(practice);note:=CASE WHEN origin.reflection_consent THEN source->>'note' ELSE '' END;tags:=CASE WHEN origin.reflection_consent THEN source->'tags' ELSE '[]'::jsonb END;
 SELECT * INTO prior FROM core.journal_publications WHERE checkin_id=practice FOR UPDATE;
 IF prior.id IS NOT NULL AND NOT prior.active THEN RETURN NULL;END IF;
 IF prior.id IS NOT NULL AND prior.note_snapshot=note AND prior.tag_snapshot=tags AND prior.method_snapshot=source->'methods' THEN RETURN NULL;END IF;
 label:=coalesce(prior.alias,'Learner '||substr(encode(public.digest(entry.person_id::text,'sha256'),'hex'),1,8));
 INSERT INTO core.journal_publications(checkin_id,person_id,identity_id,revision,active,external_enabled,share_note,share_feelings,alias,practice_date,note_snapshot,method_snapshot,tag_snapshot,shared_with_staff)
 VALUES(practice,entry.person_id,entry.submitted_via_identity_id,1,TRUE,FALSE,note<>'',jsonb_array_length(tags)>0,label,entry.practice_date,note,source->'methods',tags,TRUE)
 ON CONFLICT(checkin_id) DO UPDATE SET revision=journal_publications.revision+1,external_enabled=FALSE,note_snapshot=EXCLUDED.note_snapshot,method_snapshot=EXCLUDED.method_snapshot,tag_snapshot=EXCLUDED.tag_snapshot,share_note=EXCLUDED.share_note,share_feelings=EXCLUDED.share_feelings,shared_with_staff=TRUE,published_at=clock_timestamp();
 RETURN NULL;
END$$;
CREATE FUNCTION core.publish_community_note(input_checkin UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE entry core.checkins;prior core.journal_publications;source JSONB;note TEXT;saved TEXT:=current_setting('qigong.community_publishing',TRUE);BEGIN
 PERFORM 1 FROM core.community_note_origins WHERE checkin_id=input_checkin AND NOT manual_controlled;IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO entry FROM core.checkins WHERE id=input_checkin FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM identity.platform_identities i JOIN identity.people p ON p.id=i.person_id JOIN identity.person_interaction_channels c ON c.person_id=p.id AND c.platform_identity_id=i.id JOIN identity.onboarding_applications a ON a.person_id=p.id AND a.platform=i.platform AND a.external_subject_id=i.external_subject_id WHERE i.id=entry.submitted_via_identity_id AND i.person_id=entry.person_id AND i.platform IN('line','telegram') AND i.revoked_at IS NULL AND p.status='active' AND c.valid_from<=clock_timestamp() AND c.valid_to IS NULL AND a.status='approved') THEN RAISE EXCEPTION 'practice identity unavailable' USING ERRCODE='42501';END IF;
 source:=platform.journal_source(input_checkin);note:=coalesce(source->>'note','');
 SELECT * INTO prior FROM core.journal_publications WHERE checkin_id=input_checkin FOR UPDATE;
 PERFORM 1 FROM core.community_note_origins WHERE checkin_id=input_checkin AND NOT manual_controlled FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;
 PERFORM set_config('qigong.community_publishing','yes',TRUE);
 IF trim(note)='' THEN
  UPDATE core.journal_publications SET active=FALSE,external_enabled=FALSE,revision=revision+1 WHERE checkin_id=input_checkin AND active;
  IF FOUND THEN INSERT INTO audit.events(request_id,action,target_type,target_id,outcome,metadata) VALUES(admin.request_id(),'community_note.clear','checkin',input_checkin::text,'success',jsonb_build_object('noticeVersion','student-community-notes-v1'));END IF;
 ELSIF prior.id IS NULL OR NOT prior.active OR prior.note_snapshot IS DISTINCT FROM note OR prior.tag_snapshot IS DISTINCT FROM source->'tags' OR prior.method_snapshot IS DISTINCT FROM source->'methods' THEN
  INSERT INTO core.journal_publications(checkin_id,person_id,identity_id,revision,active,external_enabled,share_note,share_feelings,alias,practice_date,note_snapshot,method_snapshot,tag_snapshot,shared_with_staff)
  VALUES(input_checkin,entry.person_id,entry.submitted_via_identity_id,1,TRUE,FALSE,TRUE,TRUE,'Learner '||substr(encode(public.digest(entry.person_id::text,'sha256'),'hex'),1,8),entry.practice_date,note,source->'methods',source->'tags',TRUE)
  ON CONFLICT(checkin_id) DO UPDATE SET revision=journal_publications.revision+1,active=TRUE,external_enabled=FALSE,share_note=TRUE,share_feelings=TRUE,note_snapshot=EXCLUDED.note_snapshot,method_snapshot=EXCLUDED.method_snapshot,tag_snapshot=EXCLUDED.tag_snapshot,shared_with_staff=TRUE,published_at=clock_timestamp();
  INSERT INTO audit.events(request_id,action,target_type,target_id,outcome,metadata) VALUES(admin.request_id(),'community_note.publish','checkin',input_checkin::text,'success',jsonb_build_object('noticeVersion','student-community-notes-v1'));
 END IF;
 PERFORM set_config('qigong.community_publishing',coalesce(saved,''),TRUE);
EXCEPTION WHEN OTHERS THEN PERFORM set_config('qigong.community_publishing',coalesce(saved,''),TRUE);RAISE;
END$$;
CREATE FUNCTION platform.community_workspace_save(input_platform TEXT,input_credential TEXT,input_request UUID,input_date DATE,input_version INTEGER,input_methods TEXT[],input_note TEXT,input_tags UUID[],input_notice TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result JSONB;practice UUID;owner UUID;before_practice UUID;before_note TEXT;before_version INTEGER;saved TEXT:=current_setting('qigong.community_notice',TRUE);mode TEXT;BEGIN
 IF input_platform IS NULL OR input_platform NOT IN('line','telegram') OR (input_notice IS NOT NULL AND input_notice<>'student-community-notes-v1') THEN RAISE EXCEPTION 'invalid community notice';END IF;
 owner:=platform.practice_person(input_platform,input_credential);
 PERFORM pg_advisory_xact_lock(hashtextextended('community-note:'||owner::text,0));
 SELECT c.id,coalesce(n.practice_note,''),coalesce(v.revision,0) INTO before_practice,before_note,before_version FROM core.checkins c LEFT JOIN core.checkin_notes n ON n.checkin_id=c.id LEFT JOIN platform.telegram_practice_versions v ON v.checkin_id=c.id WHERE c.person_id=owner AND c.practice_date=input_date;
 PERFORM set_config('qigong.community_notice',coalesce(input_notice,''),TRUE);
 IF input_platform='telegram' THEN result:=platform.telegram_workspace_save(input_credential,input_request,input_date,input_version,input_methods,input_note,input_tags);
 ELSE result:=platform.channel_workspace_save('line',input_credential,input_request,input_date,input_version,input_methods,input_note,input_tags);END IF;
 practice:=(result->>'checkinId')::uuid;
 -- A newly written reflection on an older practice-only record is new content, not a backfill.
 -- Do not mark existing private text or a replay of an earlier/older-client request.
 IF input_notice IS NOT NULL AND before_practice=practice AND trim(coalesce(before_note,''))='' AND trim(coalesce(input_note,''))<>'' AND before_version=input_version AND (result->>'version')::integer>before_version THEN
  INSERT INTO core.community_note_origins(checkin_id,notice_version) VALUES(practice,input_notice) ON CONFLICT(checkin_id) DO NOTHING;
 END IF;
 IF input_notice IS NOT NULL AND input_note IS NOT NULL AND (result->>'version')::integer=(SELECT revision FROM platform.telegram_practice_versions WHERE checkin_id=practice) AND (platform.journal_source(practice)->>'note') IS NOT DISTINCT FROM input_note THEN
  IF trim(input_note)<>'' THEN PERFORM platform.require_reflection_consent(input_platform,input_credential);END IF;
  PERFORM core.publish_community_note(practice);
 END IF;
 IF input_notice IS NOT NULL THEN
  SELECT CASE WHEN o.checkin_id IS NULL THEN 'legacy_private' WHEN o.manual_controlled THEN 'manual' ELSE 'automatic' END INTO mode FROM (SELECT practice id) target LEFT JOIN core.community_note_origins o ON o.checkin_id=target.id;
  result:=result||jsonb_build_object('communitySharing',mode,'communityShared',EXISTS(SELECT 1 FROM core.journal_publications WHERE checkin_id=practice AND active AND share_note AND trim(note_snapshot)<>''));
 END IF;
 PERFORM set_config('qigong.community_notice',coalesce(saved,''),TRUE);RETURN result;
EXCEPTION WHEN OTHERS THEN PERFORM set_config('qigong.community_notice',coalesce(saved,''),TRUE);RAISE;
END$$;
-- Serialize author-controlled sharing with disclosed saves before acquiring person/publication locks.
ALTER FUNCTION platform.journal_publish(TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT) RENAME TO _pre_community_journal_publish;
REVOKE ALL ON FUNCTION platform._pre_community_journal_publish(TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION platform.journal_publish(input_token TEXT,input_checkin UUID,input_version INTEGER,input_active BOOLEAN,input_share_note BOOLEAN,input_share_feelings BOOLEAN,input_external BOOLEAN,input_alias TEXT,input_source_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('community-note:'||platform.practice_person('telegram',input_token)::text,0));
 RETURN platform._pre_community_journal_publish(input_token,input_checkin,input_version,input_active,input_share_note,input_share_feelings,input_external,input_alias,input_source_hash);
END$$;
ALTER FUNCTION platform.channel_journal_publish(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT) RENAME TO _pre_community_channel_journal_publish;
REVOKE ALL ON FUNCTION platform._pre_community_channel_journal_publish(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION platform.channel_journal_publish(input_platform TEXT,input_credential TEXT,input_checkin UUID,input_version INTEGER,input_active BOOLEAN,input_note BOOLEAN,input_feelings BOOLEAN,input_external BOOLEAN,input_alias TEXT,input_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('community-note:'||platform.channel_workspace_person(input_platform,input_credential)::text,0));
 RETURN platform._pre_community_channel_journal_publish(input_platform,input_credential,input_checkin,input_version,input_active,input_note,input_feelings,input_external,input_alias,input_hash);
END$$;
REVOKE ALL ON FUNCTION platform.journal_publish(TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT),platform.channel_journal_publish(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.journal_publish(TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT),platform.channel_journal_publish(TEXT,TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT) TO qigong_api_runtime;
CREATE FUNCTION ops.community_notes_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-19-community-notes')$$;
REVOKE ALL ON FUNCTION core.capture_community_note_origin(),core.community_note_manual_control(),core.publish_community_note(UUID),platform.community_workspace_save(TEXT,TEXT,UUID,DATE,INTEGER,TEXT[],TEXT,UUID[],TEXT),ops.community_notes_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.community_workspace_save(TEXT,TEXT,UUID,DATE,INTEGER,TEXT[],TEXT,UUID[],TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION ops.community_notes_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-19-community-notes',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
