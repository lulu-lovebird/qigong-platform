-- Verified provider display metadata only; never match identities or grant authorization by name.
CREATE TABLE platform.line_verified_profiles (
 identity_id UUID PRIMARY KEY REFERENCES identity.platform_identities(id),display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 150 AND display_name !~ '[[:cntrl:]]'),verified_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE platform.line_verified_profiles ENABLE ROW LEVEL SECURITY;ALTER TABLE platform.line_verified_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.line_verified_profiles FROM PUBLIC;
CREATE FUNCTION platform.refresh_verified_line_profile(input_subject TEXT,input_name TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE ident UUID;previous TEXT;BEGIN
 IF input_subject IS NULL OR input_subject !~ '^U[0-9a-f]{32}$' OR input_name IS NULL OR length(trim(input_name)) NOT BETWEEN 1 AND 150 OR input_name ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid verified LINE profile';END IF;
 SELECT i.id INTO ident FROM identity.platform_identities i JOIN identity.people p ON p.id=i.person_id WHERE i.platform='line' AND i.external_subject_id=input_subject AND i.revoked_at IS NULL AND p.status='active' FOR UPDATE OF i;
 IF ident IS NULL THEN RETURN FALSE;END IF;
 SELECT display_name INTO previous FROM platform.line_verified_profiles WHERE identity_id=ident;
 INSERT INTO platform.line_verified_profiles(identity_id,display_name) VALUES(ident,trim(input_name)) ON CONFLICT(identity_id) DO UPDATE SET display_name=EXCLUDED.display_name,verified_at=clock_timestamp();
 IF previous IS DISTINCT FROM trim(input_name) THEN INSERT INTO audit.events(request_id,action,target_type,target_id,outcome,metadata) VALUES(admin.request_id(),'line.profile_refresh','platform_identity',ident::text,'success',jsonb_build_object('nameChanged',TRUE));END IF;
 RETURN TRUE;
END$$;
CREATE FUNCTION platform.line_public_profile_name(input_identity UUID) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE subject TEXT;nickname TEXT;state JSONB;BEGIN
 SELECT i.external_subject_id,n.display_name INTO subject,nickname FROM identity.platform_identities i JOIN identity.people p ON p.id=i.person_id AND p.status='active' JOIN platform.line_verified_profiles n ON n.identity_id=i.id WHERE i.id=input_identity AND i.platform='line' AND i.revoked_at IS NULL;
 IF subject IS NULL THEN RETURN NULL;END IF;state:=platform.privacy_status('line',subject);IF (state->>'required')::boolean OR (state->>'unavailable')::boolean THEN RETURN NULL;END IF;RETURN nickname;
END$$;
REVOKE ALL ON FUNCTION platform.line_public_profile_name(UUID) FROM PUBLIC;
ALTER FUNCTION platform.channel_workspace_report(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,DATE) RENAME TO _pre_line_profile_channel_workspace_report;
REVOKE ALL ON FUNCTION platform._pre_line_profile_channel_workspace_report(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,DATE) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION platform.channel_workspace_report(input_platform TEXT,input_credential TEXT,input_view TEXT,input_locale TEXT,input_period TEXT DEFAULT 'month',input_days INTEGER DEFAULT 30,input_month DATE DEFAULT NULL) RETURNS JSONB
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
 SELECT coalesce(jsonb_agg(jsonb_build_object('rank',r.position,'days',r.days,'self',r.id=target,'label',coalesce(platform.line_public_profile_name(r.identity_id),'匿名學員')||CASE WHEN r.id=target THEN '（你）' ELSE '' END) ORDER BY r.position,r.id),'[]') INTO names FROM(SELECT * FROM ranked ORDER BY position,id LIMIT 30) r;
 RETURN base||jsonb_build_object('scope','same_region_line_nicknames','rows',names);
END$$;
ALTER FUNCTION platform.line_journal_stream(TEXT,JSONB) RENAME TO _pre_line_profile_journal_stream;
REVOKE ALL ON FUNCTION platform._pre_line_profile_journal_stream(TEXT,JSONB) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION platform.line_journal_stream(input_subject TEXT,input_cursor JSONB DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE base JSONB;entries JSONB;BEGIN
 base:=platform._pre_line_profile_journal_stream(input_subject,input_cursor);
 SELECT coalesce(jsonb_agg(e.entry||jsonb_build_object('alias',CASE WHEN i.platform='line' THEN coalesce(platform.line_public_profile_name(i.id),'匿名學員') ELSE e.entry->>'alias' END) ORDER BY e.position),'[]') INTO entries
 FROM jsonb_array_elements(base->'entries') WITH ORDINALITY e(entry,position)
 JOIN core.journal_publications j ON j.id=(e.entry->>'id')::uuid AND j.active
 JOIN identity.people p ON p.id=j.person_id AND p.status='active'
 JOIN identity.platform_identities i ON i.id=j.identity_id AND i.person_id=p.id AND i.revoked_at IS NULL
 WHERE EXISTS(SELECT 1 FROM identity.person_interaction_channels ch WHERE ch.person_id=p.id AND ch.platform_identity_id=i.id AND ch.valid_from<=clock_timestamp() AND ch.valid_to IS NULL)
 AND EXISTS(SELECT 1 FROM identity.onboarding_applications a WHERE a.person_id=p.id AND a.platform=i.platform AND a.external_subject_id=i.external_subject_id AND a.status='approved');
 RETURN base||jsonb_build_object('entries',entries);
END$$;
CREATE FUNCTION ops.line_profile_schema_ready() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-16-line-profile-names')$$;
REVOKE ALL ON FUNCTION platform.refresh_verified_line_profile(TEXT,TEXT),platform.channel_workspace_report(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,DATE),platform.line_journal_stream(TEXT,JSONB),ops.line_profile_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.refresh_verified_line_profile(TEXT,TEXT),platform.channel_workspace_report(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,DATE),platform.line_journal_stream(TEXT,JSONB) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION ops.line_profile_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-16-line-profile-names',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
