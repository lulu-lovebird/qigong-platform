-- Verified display metadata only. Never link identities, grant eligibility or rewrite publications.
CREATE TABLE platform.telegram_verified_profiles(
 identity_id UUID PRIMARY KEY REFERENCES identity.platform_identities(id),
 display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 150 AND display_name !~ '[[:cntrl:]]'),
 profile_at TIMESTAMPTZ NOT NULL,source TEXT NOT NULL CHECK(source IN('webhook','miniapp')),
 last_webhook_update_id BIGINT CHECK(last_webhook_update_id>=0),verified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE platform.telegram_verified_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.telegram_verified_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.telegram_verified_profiles FROM PUBLIC;
CREATE FUNCTION platform.refresh_verified_telegram_profile(input_subject TEXT,input_name TEXT,input_source TEXT,input_profile_at TIMESTAMPTZ,input_update_id BIGINT DEFAULT NULL) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ident UUID;prior platform.telegram_verified_profiles%ROWTYPE;name_changed BOOLEAN;
BEGIN
 IF input_subject IS NULL OR input_subject !~ '^[0-9]{1,20}$' OR input_name IS NULL OR length(trim(input_name)) NOT BETWEEN 1 AND 150 OR input_name ~ '[[:cntrl:]]'
  OR input_source IS NULL OR input_source NOT IN('webhook','miniapp') OR input_profile_at IS NULL OR input_profile_at>clock_timestamp()+INTERVAL '60 seconds'
  OR input_profile_at<clock_timestamp()-(CASE WHEN input_source='miniapp' THEN INTERVAL '1 hour' ELSE INTERVAL '24 hours' END)
  OR (input_source='webhook' AND (input_update_id IS NULL OR input_update_id<0)) OR(input_source='miniapp' AND input_update_id IS NOT NULL)
 THEN RAISE EXCEPTION 'invalid verified Telegram profile';END IF;
 SELECT i.id INTO ident FROM identity.platform_identities i JOIN identity.people p ON p.id=i.person_id AND p.status='active' WHERE i.platform='telegram' AND i.external_subject_id=input_subject AND i.revoked_at IS NULL FOR UPDATE OF i;
 IF ident IS NULL THEN RETURN FALSE;END IF;
 SELECT * INTO prior FROM platform.telegram_verified_profiles WHERE identity_id=ident;
 IF prior.identity_id IS NOT NULL THEN
  IF input_source='webhook' AND input_update_id<=coalesce(prior.last_webhook_update_id,-1) THEN RETURN FALSE;END IF;
  IF input_profile_at<prior.profile_at OR(input_profile_at=prior.profile_at AND input_source='miniapp') THEN
   IF input_source='webhook' THEN UPDATE platform.telegram_verified_profiles SET last_webhook_update_id=input_update_id WHERE identity_id=ident;END IF;
   RETURN FALSE;
  END IF;
 END IF;
 name_changed:=prior.display_name IS DISTINCT FROM trim(input_name);
 INSERT INTO platform.telegram_verified_profiles(identity_id,display_name,profile_at,source,last_webhook_update_id) VALUES(ident,trim(input_name),input_profile_at,input_source,input_update_id)
 ON CONFLICT(identity_id) DO UPDATE SET display_name=EXCLUDED.display_name,profile_at=EXCLUDED.profile_at,source=EXCLUDED.source,last_webhook_update_id=coalesce(EXCLUDED.last_webhook_update_id,telegram_verified_profiles.last_webhook_update_id),verified_at=clock_timestamp();
 IF name_changed THEN INSERT INTO audit.events(request_id,action,target_type,target_id,outcome,metadata) VALUES(admin.request_id(),'telegram.profile_refresh','platform_identity',ident::text,'success',jsonb_build_object('nameChanged',TRUE));END IF;
 RETURN TRUE;
END$$;
REVOKE ALL ON FUNCTION platform.refresh_verified_telegram_profile(TEXT,TEXT,TEXT,TIMESTAMPTZ,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.refresh_verified_telegram_profile(TEXT,TEXT,TEXT,TIMESTAMPTZ,BIGINT) TO qigong_api_runtime;

-- Private presentation helpers. Their callers first authenticate the reader using unchanged facades.
CREATE FUNCTION platform.learner_public_author_name(input_identity UUID,input_alias TEXT,input_locale TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE provider TEXT;subject TEXT;nickname TEXT;privacy JSONB;
BEGIN
 SELECT i.platform,i.external_subject_id INTO provider,subject FROM identity.platform_identities i JOIN identity.people p ON p.id=i.person_id AND p.status='active'
 WHERE i.id=input_identity AND i.revoked_at IS NULL
 AND EXISTS(SELECT 1 FROM identity.person_interaction_channels ch WHERE ch.person_id=p.id AND ch.platform_identity_id=i.id AND ch.valid_from<=clock_timestamp() AND ch.valid_to IS NULL)
 AND EXISTS(SELECT 1 FROM identity.onboarding_applications a WHERE a.person_id=p.id AND a.platform=i.platform AND a.external_subject_id=i.external_subject_id AND a.status='approved');
 IF provider IS NULL THEN RETURN NULL;END IF;
 privacy:=platform.privacy_status(provider,subject);IF coalesce((privacy->>'required')::boolean,FALSE) OR coalesce((privacy->>'unavailable')::boolean,FALSE) THEN RETURN CASE WHEN provider='line' THEN CASE input_locale WHEN 'en' THEN 'Anonymous learner' WHEN 'zh_CN' THEN '匿名学员' ELSE '匿名學員' END ELSE input_alias END;END IF;
 IF provider='line' THEN RETURN coalesce(platform.line_public_profile_name(input_identity),CASE input_locale WHEN 'en' THEN 'Anonymous learner' WHEN 'zh_CN' THEN '匿名学员' ELSE '匿名學員' END);END IF;
 IF provider='telegram' THEN SELECT display_name INTO nickname FROM platform.telegram_verified_profiles WHERE identity_id=input_identity;END IF;
 RETURN coalesce(nickname,input_alias,CASE input_locale WHEN 'en' THEN 'Anonymous learner' WHEN 'zh_CN' THEN '匿名学员' ELSE '匿名學員' END);
END$$;
CREATE FUNCTION platform.learner_named_feed(input_data JSONB,input_locale TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE entries JSONB;BEGIN
 SELECT coalesce(jsonb_agg(e.entry||jsonb_build_object('alias',n.name) ORDER BY e.position),'[]') INTO entries
 FROM jsonb_array_elements(input_data->'entries') WITH ORDINALITY e(entry,position)
 JOIN core.journal_publications j ON j.id=(e.entry->>'id')::uuid AND j.active
 CROSS JOIN LATERAL(SELECT platform.learner_public_author_name(j.identity_id,j.alias,input_locale) name) n
 WHERE n.name IS NOT NULL;
 RETURN input_data||jsonb_build_object('entries',entries);
END$$;
REVOKE ALL ON FUNCTION platform.learner_public_author_name(UUID,TEXT,TEXT),platform.learner_named_feed(JSONB,TEXT) FROM PUBLIC;

-- Only learner-facing facades change. Staff and partner feed aliases retain their old contract.
DO $$DECLARE definition TEXT;updated TEXT;spec RECORD;BEGIN
 FOR spec IN SELECT * FROM(VALUES('platform.journal_feed(text,text,integer)',FALSE),('platform.community_feed(text,text,text,integer)',TRUE)) s(signature,channel_aware) LOOP
  definition:=pg_get_functiondef(spec.signature::regprocedure);
  updated:=replace(definition,'RETURN core.shared_journal_feed(input_locale,input_page,FALSE);',CASE WHEN spec.channel_aware THEN 'IF input_platform IN(''line'',''telegram'') THEN RETURN platform.learner_named_feed(core.shared_journal_feed(input_locale,input_page,FALSE),input_locale);END IF;RETURN core.shared_journal_feed(input_locale,input_page,FALSE);' ELSE 'RETURN platform.learner_named_feed(core.shared_journal_feed(input_locale,input_page,FALSE),input_locale);' END);
  IF updated=definition THEN RAISE EXCEPTION 'unexpected learner feed facade';END IF;
  EXECUTE updated;
 END LOOP;
 FOR spec IN SELECT * FROM(VALUES('platform.line_journal_stream(text,jsonb)','''zh_TW'''),('platform.line_journal_stream(text,jsonb,text)','input_locale')) s(signature,locale_expression) LOOP
  definition:=pg_get_functiondef(spec.signature::regprocedure);
  updated:=replace(definition,'RETURN base||jsonb_build_object(''entries'',entries);','RETURN platform.learner_named_feed(base||jsonb_build_object(''entries'',entries),'||spec.locale_expression||');');
  IF updated=definition THEN RAISE EXCEPTION 'unexpected LINE author-name facade';END IF;
  EXECUTE updated;
 END LOOP;
END$$;
CREATE FUNCTION ops.learner_author_names_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-22-learner-author-names')$$;
REVOKE ALL ON FUNCTION ops.learner_author_names_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.learner_author_names_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-22-learner-author-names',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
