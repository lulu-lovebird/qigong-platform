-- Phase A expand only: freeze provable legacy metadata, expose versioned readers.
-- No publication, activation, evaluation change, award rewrite or progress reset.
-- Keep phase27 readiness for compatible42/43 workers; the new API gates version readers.
CREATE TABLE core.achievement_rule_versions (
 badge_code TEXT NOT NULL REFERENCES core.practice_badge_definitions(code),
 rule_version INTEGER NOT NULL CHECK(rule_version>0),
 provenance TEXT NOT NULL CHECK(provenance IN('legacy_snapshot','unknown_legacy')),
 snapshot JSONB,
 source_hash TEXT NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 captured_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(badge_code,rule_version),
 CHECK(coalesce((provenance='unknown_legacy' AND snapshot IS NULL) OR
  (provenance='legacy_snapshot' AND snapshot IS NOT NULL AND jsonb_typeof(snapshot)='object'
   AND snapshot->'definition'->>'code'=badge_code AND (snapshot->'definition'->>'rule_version')::integer=rule_version
   AND jsonb_typeof(snapshot->'definition')='object' AND jsonb_typeof(snapshot->'seasons')='array'),false)),
 CHECK(source_hash=encode(public.digest(coalesce(snapshot,'null'::jsonb)::text,'sha256'),'hex'))
);
ALTER TABLE core.achievement_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.achievement_rule_versions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.achievement_rule_versions FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
INSERT INTO core.achievement_rule_versions(badge_code,rule_version,provenance,snapshot,source_hash)
SELECT d.code,d.rule_version,'legacy_snapshot',s.data,encode(public.digest(s.data::text,'sha256'),'hex')
FROM core.practice_badge_definitions d CROSS JOIN LATERAL(SELECT jsonb_build_object('definition',to_jsonb(d),
 'seasons',coalesce((SELECT jsonb_agg(to_jsonb(y) ORDER BY y.year) FROM core.practice_badge_seasons y WHERE y.kind=d.kind),'[]'::jsonb)) data) s;
-- A stored award version does not prove its old threshold/name/conditions.
INSERT INTO core.achievement_rule_versions(badge_code,rule_version,provenance,snapshot,source_hash)
SELECT DISTINCT b.badge_code,b.rule_version,'unknown_legacy',NULL::jsonb,encode(public.digest('null','sha256'),'hex')
FROM core.person_practice_badges b WHERE NOT EXISTS(SELECT 1 FROM core.achievement_rule_versions v WHERE v.badge_code=b.badge_code AND v.rule_version=b.rule_version);
CREATE FUNCTION core._immutable_achievement_version() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'achievement version immutable' USING ERRCODE='55000';END$$;
CREATE TRIGGER achievement_version_immutable BEFORE UPDATE OR DELETE ON core.achievement_rule_versions FOR EACH ROW EXECUTE FUNCTION core._immutable_achievement_version();
CREATE TRIGGER achievement_version_no_truncate BEFORE TRUNCATE ON core.achievement_rule_versions FOR EACH STATEMENT EXECUTE FUNCTION core._immutable_achievement_version();
REVOKE ALL ON FUNCTION core._immutable_achievement_version() FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;

CREATE FUNCTION admin._achievement_version_definition(input_code TEXT,input_version INTEGER,input_locale TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row core.achievement_rule_versions;d JSONB;seasons JSONB;
BEGIN
 SELECT * INTO row FROM core.achievement_rule_versions v WHERE v.badge_code=input_code AND v.rule_version=input_version;
 IF NOT FOUND OR row.provenance='unknown_legacy' THEN
  RETURN jsonb_build_object('code',input_code,'ruleVersion',input_version,'name',input_code||' · v'||input_version,
   'kind','unknown','threshold',NULL,'methodCodes','[]'::jsonb,'seasons','[]'::jsonb,'configured',false,'configurationKnown',false);
 END IF;
 d:=row.snapshot->'definition';
 SELECT coalesce(jsonb_agg(jsonb_build_object('year',(s->>'year')::integer,'startDate',s->>'start_date','endDate',s->>'end_date','timezone',s->>'timezone','requiredDays',(s->>'required_days')::integer) ORDER BY s->>'year'),'[]') INTO seasons FROM jsonb_array_elements(row.snapshot->'seasons') s;
 RETURN jsonb_build_object('code',input_code,'ruleVersion',input_version,'name',CASE WHEN input_locale='en' THEN d->>'name_en' ELSE d->>'name_zh_tw' END,
  'kind',d->>'kind','threshold',(d->>'threshold')::integer,'methodCodes',d->'method_codes','seasons',seasons,'configurationKnown',true,
  'configured',CASE WHEN d->>'kind' IN('summer','winter') THEN jsonb_array_length(seasons)>0 ELSE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements_text(d->'method_codes') required(code) WHERE NOT EXISTS(SELECT 1 FROM core.practice_methods m WHERE m.code=required.code)) END);
END$$;
CREATE FUNCTION admin._achievement_version_select(input_code TEXT,input_version INTEGER,input_region UUID,input_platform TEXT,input_query TEXT) RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected INTEGER;
BEGIN
 PERFORM 1 FROM admin._achievement_people(input_region,input_platform,input_query);
 IF input_code IS NULL OR char_length(input_code)>80 OR input_version IS NOT NULL AND input_version<1 THEN RAISE EXCEPTION 'invalid achievement query' USING ERRCODE='22023';END IF;
 SELECT coalesce(input_version,d.rule_version) INTO selected FROM core.practice_badge_definitions d WHERE d.code=input_code;
 IF selected IS NULL OR NOT(EXISTS(SELECT 1 FROM core.achievement_rule_versions v WHERE v.badge_code=input_code AND v.rule_version=selected AND v.provenance='legacy_snapshot') OR EXISTS(
  SELECT 1 FROM core.person_practice_badges b JOIN admin._achievement_people(input_region,input_platform,input_query) p ON p.person_id=b.person_id WHERE b.badge_code=input_code AND b.rule_version=selected)) THEN
  RAISE EXCEPTION 'achievement unavailable' USING ERRCODE='P0002';END IF;
 RETURN selected;
END$$;
CREATE FUNCTION admin.achievement_version_catalog(input_locale TEXT,input_region UUID,input_platform TEXT,input_query TEXT,input_year INTEGER) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE base JSONB;badge JSONB;options JSONB;meta JSONB;seasons JSONB;result JSONB:='[]';
BEGIN
 base:=admin.achievement_catalog(input_locale,input_region,input_platform,input_query,input_year);
 FOR badge IN SELECT value FROM jsonb_array_elements(base->'badges') LOOP
  WITH visible AS MATERIALIZED(SELECT * FROM admin._achievement_people(input_region,input_platform,input_query)),
  versions AS(SELECT v.rule_version FROM core.achievement_rule_versions v WHERE v.badge_code=badge->>'code' AND v.provenance='legacy_snapshot'
   UNION SELECT b.rule_version FROM core.person_practice_badges b JOIN visible p ON p.person_id=b.person_id WHERE b.badge_code=badge->>'code'),
  definitions AS(SELECT v.rule_version,admin._achievement_version_definition(badge->>'code',v.rule_version,input_locale) meta FROM versions v)
  SELECT coalesce(jsonb_agg(d.meta||jsonb_build_object('isCurrent',d.rule_version=(badge->>'ruleVersion')::integer,'recipientCount',
   (SELECT count(DISTINCT b.person_id) FROM core.person_practice_badges b JOIN visible p ON p.person_id=b.person_id WHERE b.badge_code=badge->>'code' AND b.rule_version=d.rule_version AND b.revoked_at IS NULL
    AND(input_year IS NULL OR d.meta->>'kind' NOT IN('summer','winter') OR b.period=input_year::text))) ORDER BY d.rule_version DESC),'[]') INTO options FROM definitions d;
  meta:=admin._achievement_version_definition(badge->>'code',(badge->>'ruleVersion')::integer,input_locale);
  IF (meta->>'configurationKnown')::boolean THEN
   SELECT coalesce(jsonb_agg(s ORDER BY s->>'year'),'[]') INTO seasons FROM jsonb_array_elements(meta->'seasons') s WHERE input_year IS NULL OR(s->>'year')::integer=input_year;
   badge:=badge||meta||jsonb_build_object('seasons',seasons,'configured',CASE WHEN meta->>'kind' IN('summer','winter') THEN jsonb_array_length(seasons)>0 ELSE(meta->>'configured')::boolean END);
  END IF;
  result:=result||jsonb_build_array(badge||jsonb_build_object('versions',options));
 END LOOP;
 RETURN base||jsonb_build_object('badges',result,'versioned',true);
END$$;
CREATE FUNCTION admin.achievement_version_recipients(input_code TEXT,input_locale TEXT,input_region UUID,input_platform TEXT,input_query TEXT,input_year INTEGER,input_page INTEGER,input_limit INTEGER,input_version INTEGER) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected INTEGER;meta JSONB;result JSONB;
BEGIN
 selected:=admin._achievement_version_select(input_code,input_version,input_region,input_platform,input_query);
 IF input_locale IS NULL OR input_locale NOT IN('zh_TW','zh_CN','en') OR input_page IS NULL OR input_page NOT BETWEEN 1 AND 10000 OR input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 100 OR(input_year IS NOT NULL AND input_year NOT BETWEEN 2000 AND 2200) THEN RAISE EXCEPTION 'invalid achievement query' USING ERRCODE='22023';END IF;
 meta:=admin._achievement_version_definition(input_code,selected,input_locale);
 WITH visible AS MATERIALIZED(SELECT * FROM admin._achievement_people(input_region,input_platform,input_query)),recipients AS(
  SELECT p.person_id,p.display_name,p.region_id,p.region_name_zh_tw,p.region_name_en,p.platform,
   jsonb_agg(jsonb_build_object('period',b.period,'ruleVersion',b.rule_version,'earnedAt',b.earned_at) ORDER BY b.period,b.rule_version) awards
  FROM visible p JOIN core.person_practice_badges b ON b.person_id=p.person_id WHERE b.badge_code=input_code AND b.rule_version=selected AND b.revoked_at IS NULL
   AND(input_year IS NULL OR meta->>'kind' NOT IN('summer','winter') OR b.period=input_year::text)
  GROUP BY p.person_id,p.display_name,p.region_id,p.region_name_zh_tw,p.region_name_en,p.platform
 ), page_rows AS(SELECT * FROM recipients ORDER BY display_name,person_id LIMIT input_limit OFFSET(input_page-1)*input_limit)
 SELECT jsonb_build_object('code',input_code,'name',meta->>'name','configurationKnown',(meta->>'configurationKnown')::boolean,'ruleVersion',selected,'page',input_page,'limit',input_limit,'total',(SELECT count(*) FROM recipients),'totalPages',greatest(1,ceil((SELECT count(*) FROM recipients)::numeric/input_limit)::integer),
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('personId',p.person_id,'displayName',p.display_name,'regionId',p.region_id,'regionName',CASE WHEN input_locale='en' THEN p.region_name_en ELSE p.region_name_zh_tw END,'platform',p.platform,'awards',p.awards) ORDER BY p.display_name,p.person_id) FROM page_rows p),'[]')) INTO result;
 RETURN result;
END$$;

CREATE FUNCTION platform._achievement_version_badges(input_person UUID,input_locale TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH versions AS(SELECT d.code,d.rule_version FROM core.practice_badge_definitions d UNION SELECT b.badge_code,b.rule_version FROM core.person_practice_badges b WHERE b.person_id=input_person),
 definitions AS(SELECT v.code,v.rule_version,admin._achievement_version_definition(v.code,v.rule_version,input_locale) meta FROM versions v)
 SELECT coalesce(jsonb_agg(d.meta||jsonb_build_object('awards',coalesce((SELECT jsonb_agg(jsonb_build_object('period',b.period,'earnedAt',b.earned_at,'revoked',b.revoked_at IS NOT NULL) ORDER BY b.period) FROM core.person_practice_badges b WHERE b.person_id=input_person AND b.badge_code=d.code AND b.rule_version=d.rule_version),'[]')) ORDER BY d.code,d.rule_version DESC),'[]') FROM definitions d
$$;
-- Preserve existing42 authentication and legacy evaluator behavior in A; C will unify writes.
CREATE FUNCTION platform.telegram_versioned_achievements(input_token TEXT,input_locale TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;target UUID;
BEGIN
 result:=platform.telegram_workspace_report(input_token,'achievements',input_locale);target:=platform.practice_person('telegram',input_token);
 RETURN result||jsonb_build_object('badges',platform._achievement_version_badges(target,input_locale),'versioned',true);
END$$;
CREATE FUNCTION platform.channel_versioned_achievements(input_platform TEXT,input_credential TEXT,input_locale TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;target UUID;
BEGIN
 result:=platform.channel_workspace_report(input_platform,input_credential,'achievements',input_locale);target:=platform.channel_workspace_person(input_platform,input_credential);
 RETURN result||jsonb_build_object('badges',platform._achievement_version_badges(target,input_locale),'versioned',true);
END$$;

CREATE FUNCTION ops.achievement_rule_versions_schema_ready() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='0043_achievement_rule_versions.sql') AND to_regclass('core.achievement_rule_versions') IS NOT NULL$$;
REVOKE ALL ON FUNCTION admin._achievement_version_definition(TEXT,INTEGER,TEXT),admin._achievement_version_select(TEXT,INTEGER,UUID,TEXT,TEXT),platform._achievement_version_badges(UUID,TEXT) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
REVOKE ALL ON FUNCTION admin.achievement_version_catalog(TEXT,UUID,TEXT,TEXT,INTEGER),admin.achievement_version_recipients(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER,INTEGER,INTEGER,INTEGER),platform.telegram_versioned_achievements(TEXT,TEXT),platform.channel_versioned_achievements(TEXT,TEXT,TEXT),ops.achievement_rule_versions_schema_ready() FROM PUBLIC,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.achievement_version_catalog(TEXT,UUID,TEXT,TEXT,INTEGER),admin.achievement_version_recipients(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER,INTEGER,INTEGER,INTEGER),platform.telegram_versioned_achievements(TEXT,TEXT),platform.channel_versioned_achievements(TEXT,TEXT,TEXT),ops.achievement_rule_versions_schema_ready() TO qigong_api_runtime;

CREATE FUNCTION admin._achievement_version_export_population(input_code TEXT,input_region UUID,input_platform TEXT,input_query TEXT,input_year INTEGER,input_version INTEGER)
RETURNS TABLE(person_id UUID,periods TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected INTEGER;meta JSONB;
BEGIN
 IF admin.can_export_achievement_personal_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement export denied' USING ERRCODE='42501';END IF;
 IF input_year IS NOT NULL AND input_year NOT BETWEEN 2000 AND 2200 THEN RAISE EXCEPTION 'invalid achievement export' USING ERRCODE='22023';END IF;
 selected:=admin._achievement_version_select(input_code,input_version,input_region,input_platform,input_query);meta:=admin._achievement_version_definition(input_code,selected,'en');
 RETURN QUERY SELECT v.person_id,string_agg(DISTINCT b.period,';' ORDER BY b.period)
 FROM admin._achievement_people(input_region,input_platform,input_query) v JOIN core.person_practice_badges b ON b.person_id=v.person_id
 WHERE b.badge_code=input_code AND b.rule_version=selected AND b.revoked_at IS NULL
 AND(input_year IS NULL OR meta->>'kind' NOT IN('summer','winter') OR b.period=input_year::text)
 GROUP BY v.person_id ORDER BY v.person_id LIMIT 5001;
END$$;

CREATE FUNCTION admin.achievement_version_export_preview(input_code TEXT,input_locale TEXT,input_region UUID,input_platform TEXT,input_query TEXT,input_year INTEGER,input_version INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;recipients INTEGER;selected INTEGER;meta JSONB;
BEGIN
 IF admin.can_export_achievement_personal_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement export denied' USING ERRCODE='42501';END IF;
 IF input_locale IS NULL OR input_locale NOT IN('zh_TW','zh_CN','en') THEN RAISE EXCEPTION 'invalid achievement export' USING ERRCODE='22023';END IF;
 selected:=admin._achievement_version_select(input_code,input_version,input_region,input_platform,input_query);meta:=admin._achievement_version_definition(input_code,selected,input_locale);
 SELECT count(*)::integer INTO recipients FROM admin._achievement_version_export_population(input_code,input_region,input_platform,input_query,input_year,selected);
 result:=jsonb_build_object('code',input_code,'name',meta->>'name','ruleVersion',selected,'count',recipients,'overLimit',recipients>5000,'limit',5000);
 IF admin.can_export_achievement_personal_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement export denied' USING ERRCODE='42501';END IF;
 RETURN result;
END$$;

CREATE FUNCTION admin.prepare_achievement_version_export(input_code TEXT,input_locale TEXT,input_region UUID,input_platform TEXT,input_query TEXT,input_year INTEGER,input_purpose TEXT,input_version INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE data JSONB;result JSONB;recipients INTEGER;next_allowed TIMESTAMPTZ;actor UUID;selected INTEGER;meta JSONB;
BEGIN
 IF admin.can_export_achievement_personal_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement export denied' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock_shared(1919,1);
 actor:=admin.request_principal_id();
 PERFORM pg_advisory_xact_lock(hashtextextended('achievement-export:'||actor::text,0));
 IF admin.can_export_achievement_personal_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement export denied' USING ERRCODE='42501';END IF;
 IF input_locale IS NULL OR input_locale NOT IN('zh_TW','zh_CN','en') OR input_purpose IS NULL
  OR input_purpose NOT IN('award_contact','internal_review') THEN RAISE EXCEPTION 'invalid achievement export' USING ERRCODE='22023';END IF;
 SELECT l.next_allowed_at INTO next_allowed FROM admin.achievement_export_limits l WHERE l.principal_id=actor FOR UPDATE;
 IF next_allowed>clock_timestamp() THEN RAISE EXCEPTION 'achievement export rate limited' USING ERRCODE='P0001';END IF;
 selected:=admin._achievement_version_select(input_code,input_version,input_region,input_platform,input_query);meta:=admin._achievement_version_definition(input_code,selected,input_locale);
 WITH winners AS MATERIALIZED(SELECT * FROM admin._achievement_version_export_population(input_code,input_region,input_platform,input_query,input_year,selected))
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'lineId',coalesce(ids.line_id,''),'telegramId',coalesce(ids.telegram_id,''),'whatsappId',coalesce(ids.whatsapp_id,''),
  'name',coalesce(nullif(p.legal_name,''),nullif(p.preferred_name,''),nullif(contact.learner_name,''),''),
  'phone',coalesce(contact.phone_e164,''),'email',coalesce(contact.website_email,''),'periods',w.periods,
  'contactStatus',CASE WHEN contact.id IS NULL THEN 'missing_current_application' ELSE 'matched_current_application' END
 ) ORDER BY p.id),'[]'::jsonb) INTO data
 FROM winners w JOIN identity.people p ON p.id=w.person_id
 LEFT JOIN LATERAL(
  SELECT string_agg(i.external_subject_id,';' ORDER BY i.external_subject_id) FILTER(WHERE i.platform='line') line_id,
   string_agg(i.external_subject_id,';' ORDER BY i.external_subject_id) FILTER(WHERE i.platform='telegram') telegram_id,
   string_agg(i.external_subject_id,';' ORDER BY i.external_subject_id) FILTER(WHERE i.platform='whatsapp') whatsapp_id
  FROM identity.platform_identities i WHERE i.person_id=p.id AND i.revoked_at IS NULL AND i.verified_at<=clock_timestamp()
 ) ids ON TRUE
 LEFT JOIN LATERAL(
  SELECT a.id,a.learner_name,a.phone_e164,a.website_email
  FROM identity.person_interaction_channels ch JOIN identity.platform_identities i ON i.id=ch.platform_identity_id AND i.person_id=p.id AND i.revoked_at IS NULL AND i.verified_at<=clock_timestamp()
  JOIN identity.onboarding_applications a ON a.person_id=p.id AND a.platform=i.platform AND a.external_subject_id=i.external_subject_id AND a.status='approved'
  WHERE ch.person_id=p.id AND ch.valid_to IS NULL AND ch.valid_from<=clock_timestamp()
  ORDER BY a.decided_at DESC,a.id LIMIT 1
 ) contact ON TRUE;
 recipients:=jsonb_array_length(data);
 IF recipients>5000 OR octet_length(data::text)>5242880 THEN RAISE EXCEPTION 'achievement export too large' USING ERRCODE='54000';END IF;
 IF admin.can_export_achievement_personal_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement export denied' USING ERRCODE='42501';END IF;
 result:=jsonb_build_object('code',input_code,'name',meta->>'name','ruleVersion',selected,'count',recipients,'rows',data);
 INSERT INTO admin.achievement_export_limits(principal_id,next_allowed_at) VALUES(actor,clock_timestamp()+INTERVAL '30 seconds')
 ON CONFLICT(principal_id) DO UPDATE SET next_allowed_at=EXCLUDED.next_allowed_at;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,reason,outcome,metadata)
 VALUES(coalesce(admin.request_id(),gen_random_uuid()),actor,'achievement.export_prepared','achievement',input_code,input_purpose,'success',
  jsonb_build_object('ruleVersion',(result->>'ruleVersion')::integer,'rowCount',recipients,'purpose',input_purpose,
   'regionId',input_region,'platform',input_platform,'seasonYear',input_year,'queryApplied',input_query<>'','delivery','prepared_not_confirmed_saved'));
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION admin._achievement_version_export_population(TEXT,UUID,TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
REVOKE ALL ON FUNCTION admin.achievement_version_export_preview(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER,INTEGER),admin.prepare_achievement_version_export(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER,TEXT,INTEGER) FROM PUBLIC,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.achievement_version_export_preview(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER,INTEGER),admin.prepare_achievement_version_export(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER,TEXT,INTEGER) TO qigong_api_runtime;
