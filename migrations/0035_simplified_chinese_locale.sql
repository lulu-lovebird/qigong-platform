-- Presentation locale only. No identity linking, preference backfill or legal-policy publication.
ALTER TABLE platform.identity_preferences DROP CONSTRAINT identity_preferences_locale_check;
ALTER TABLE platform.identity_preferences ADD CONSTRAINT identity_preferences_locale_check CHECK(locale IN('zh_TW','zh_CN','en'));
ALTER TABLE platform.identity_preferences DROP CONSTRAINT identity_preferences_platform_check;
ALTER TABLE platform.identity_preferences ADD CONSTRAINT identity_preferences_platform_check CHECK(platform IN('line','telegram','whatsapp'));
ALTER TABLE ops.telegram_reminders DROP CONSTRAINT telegram_reminders_locale_check;
ALTER TABLE ops.telegram_reminders ADD CONSTRAINT telegram_reminders_locale_check CHECK(locale IN('zh_TW','zh_CN','en'));
ALTER TABLE admin.review_notification_preferences DROP CONSTRAINT review_notification_preferences_locale_check;
ALTER TABLE admin.review_notification_preferences ADD CONSTRAINT review_notification_preferences_locale_check CHECK(locale IN('zh_TW','zh_CN','en'));
-- Capture the interface language of new binding challenges; old rows remain NULL.
ALTER TABLE admin.review_notification_links ADD COLUMN locale TEXT CHECK(locale IN('zh_TW','zh_CN','en'));
CREATE FUNCTION admin.begin_review_notification_link(input_token TEXT,input_locale TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result JSONB;BEGIN
 IF input_locale IS NULL OR input_locale NOT IN('zh_TW','zh_CN','en') THEN RAISE EXCEPTION 'invalid review notification locale';END IF;
 result:=admin.begin_review_notification_link(input_token);
 UPDATE admin.review_notification_links SET locale=input_locale WHERE id=(result->>'id')::uuid AND principal_id=admin.review_notification_actor();RETURN result;
END$$;
CREATE FUNCTION platform.review_notification_link_locale(input_token TEXT) RETURNS TEXT
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT coalesce(locale,'zh_TW') FROM admin.review_notification_links WHERE token_hash=public.digest(input_token,'sha256') AND expires_at>clock_timestamp() AND revoked_at IS NULL$$;
REVOKE ALL ON FUNCTION admin.begin_review_notification_link(TEXT,TEXT),platform.review_notification_link_locale(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.begin_review_notification_link(TEXT,TEXT),platform.review_notification_link_locale(TEXT) TO qigong_api_runtime;
-- Existing report facades retain their RLS/authorization/locking and historical text semantics.
-- Extend only the input-locale allowlist. Legal acceptance locale remains the original document language.
DO $locale$ DECLARE f RECORD;definition TEXT;updated TEXT;BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('core','platform','admin','ops') AND p.proargnames @> ARRAY['input_locale']::text[] AND NOT(n.nspname='platform' AND p.proname='accept_privacy') LOOP
  definition:=pg_get_functiondef(f.oid);
  updated:=regexp_replace(definition,'input_locale[[:space:]]+NOT IN[[:space:]]*\([[:space:]]*''(zh_TW|en)''[[:space:]]*,[[:space:]]*''(zh_TW|en)''[[:space:]]*\)','input_locale NOT IN (''zh_TW'',''zh_CN'',''en'')','g');
  IF updated IS DISTINCT FROM definition THEN EXECUTE updated;END IF;
 END LOOP;
END $locale$;
CREATE OR REPLACE FUNCTION platform.set_identity_locale(input_platform TEXT,input_subject TEXT,input_locale TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF input_platform IS NULL OR input_platform NOT IN('line','telegram','whatsapp') OR input_locale IS NULL OR input_locale NOT IN('zh_TW','zh_CN','en') OR input_subject IS NULL OR (CASE WHEN input_platform='line' THEN input_subject !~ '^U[0-9a-f]{32}$' ELSE input_subject !~ '^[0-9]{1,20}$' END) THEN RAISE EXCEPTION 'invalid identity locale';END IF;
 INSERT INTO platform.identity_preferences(platform,external_subject_id,locale) VALUES(input_platform,input_subject,input_locale)
 ON CONFLICT(platform,external_subject_id) DO UPDATE SET locale=EXCLUDED.locale;
END$$;
-- LINE receipts use the explicitly saved identity preference, not the region or application name.
DO $$DECLARE definition TEXT;updated TEXT;BEGIN
 definition:=pg_get_functiondef('platform._pre_browser_queue_channel_practice_receipt(text,text,uuid,text)'::regprocedure);
 updated:=replace(definition,'CASE WHEN input_platform=''line'' THEN ''zh_TW'' ELSE platform.get_identity_locale(input_platform,recipient) END','platform.get_identity_locale(input_platform,recipient)');
 IF updated=definition THEN RAISE EXCEPTION 'unexpected channel receipt locale definition';END IF;
 EXECUTE updated;
END$$;
CREATE OR REPLACE FUNCTION platform.channel_workspace_report(input_platform TEXT,input_credential TEXT,input_view TEXT,input_locale TEXT,input_period TEXT DEFAULT 'month',input_days INTEGER DEFAULT 30,input_month DATE DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE base JSONB;target UUID;region UUID;anchor DATE;start_day DATE;names JSONB;BEGIN
 base:=platform._pre_line_profile_channel_workspace_report(input_platform,input_credential,input_view,input_locale,input_period,input_days,input_month);
 IF input_platform<>'line' OR input_view<>'leaderboard' THEN RETURN base;END IF;
 target:=platform.channel_workspace_person('line',input_credential);anchor:=(base->>'end')::date;start_day:=(base->>'start')::date;
 SELECT region_id INTO region FROM core.person_region_assignments WHERE person_id=target AND assignment_type='primary' AND valid_from<=anchor AND (valid_to IS NULL OR valid_to>anchor);
 IF region IS NULL THEN RAISE EXCEPTION 'workspace region unavailable';END IF;
 WITH eligible AS(
  SELECT DISTINCT p.id,i.id identity_id FROM identity.people p JOIN core.person_region_assignments a ON a.person_id=p.id JOIN identity.platform_identities i ON i.person_id=p.id AND i.platform='line' AND i.revoked_at IS NULL
  JOIN identity.person_interaction_channels ch ON ch.person_id=p.id AND ch.platform_identity_id=i.id AND ch.valid_from<=clock_timestamp() AND ch.valid_to IS NULL
  JOIN identity.onboarding_applications ap ON ap.person_id=p.id AND ap.platform='line' AND ap.external_subject_id=i.external_subject_id AND ap.status='approved'
  WHERE p.status='active' AND a.region_id=region AND a.assignment_type='primary' AND a.valid_from<=anchor AND (a.valid_to IS NULL OR a.valid_to>anchor)
 ), counts AS(SELECT e.id,e.identity_id,count(c.id)::integer days FROM eligible e JOIN core.checkins c ON c.person_id=e.id AND c.practice_date BETWEEN start_day AND anchor GROUP BY e.id,e.identity_id),ranked AS(SELECT *,rank() OVER(ORDER BY days DESC)::integer position FROM counts)
 SELECT coalesce(jsonb_agg(jsonb_build_object('rank',r.position,'days',r.days,'self',r.id=target,'label',coalesce(platform.line_public_profile_name(r.identity_id),CASE input_locale WHEN 'en' THEN 'Anonymous learner' WHEN 'zh_CN' THEN '匿名学员' ELSE '匿名學員' END)||CASE WHEN r.id=target THEN CASE WHEN input_locale='en' THEN ' (you)' ELSE '（你）' END ELSE '' END) ORDER BY r.position,r.id),'[]') INTO names FROM(SELECT * FROM ranked ORDER BY position,id LIMIT 30) r;
 RETURN base||jsonb_build_object('scope','same_region_line_nicknames','rows',names);
END$$;
CREATE FUNCTION platform.line_journal_stream(input_subject TEXT,input_cursor JSONB,input_locale TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE base JSONB;entries JSONB;BEGIN
 IF input_locale IS NULL OR input_locale NOT IN('zh_TW','zh_CN','en') THEN RAISE EXCEPTION 'invalid journal locale';END IF;
 base:=platform._pre_line_profile_journal_stream(input_subject,input_cursor);
 SELECT coalesce(jsonb_agg(e.entry||jsonb_build_object('alias',CASE WHEN i.platform='line' THEN coalesce(platform.line_public_profile_name(i.id),CASE input_locale WHEN 'en' THEN 'Anonymous learner' WHEN 'zh_CN' THEN '匿名学员' ELSE '匿名學員' END) ELSE e.entry->>'alias' END) ORDER BY e.position),'[]') INTO entries
 FROM jsonb_array_elements(base->'entries') WITH ORDINALITY e(entry,position)
 JOIN core.journal_publications j ON j.id=(e.entry->>'id')::uuid AND j.active
 JOIN identity.people p ON p.id=j.person_id AND p.status='active'
 JOIN identity.platform_identities i ON i.id=j.identity_id AND i.person_id=p.id AND i.revoked_at IS NULL
 WHERE EXISTS(SELECT 1 FROM identity.person_interaction_channels ch WHERE ch.person_id=p.id AND ch.platform_identity_id=i.id AND ch.valid_from<=clock_timestamp() AND ch.valid_to IS NULL)
 AND EXISTS(SELECT 1 FROM identity.onboarding_applications a WHERE a.person_id=p.id AND a.platform=i.platform AND a.external_subject_id=i.external_subject_id AND a.status='approved');
 RETURN base||jsonb_build_object('entries',entries);
END$$;
REVOKE ALL ON FUNCTION platform.line_journal_stream(TEXT,JSONB,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.line_journal_stream(TEXT,JSONB,TEXT) TO qigong_api_runtime;
CREATE FUNCTION ops.locale_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-20-simplified-chinese')$$;
REVOKE ALL ON FUNCTION ops.locale_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.locale_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-20-simplified-chinese',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
