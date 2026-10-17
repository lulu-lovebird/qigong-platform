-- Read-only administrator achievement views. Never evaluate or rewrite awards on reads.
CREATE FUNCTION admin._achievement_people(input_region UUID,input_platform TEXT,input_query TEXT)
RETURNS TABLE(person_id UUID,display_name TEXT,region_id UUID,region_name_zh_tw TEXT,region_name_en TEXT,platform TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF admin.request_principal_id() IS NULL OR NOT admin.has_permission('stats.read')
   OR NOT admin.has_permission('learner.read') OR NOT admin.has_permission('checkin.read') THEN
  RAISE EXCEPTION 'achievement access denied' USING ERRCODE='42501';
 END IF;
 IF input_query IS NULL OR char_length(input_query)>100 OR
   (input_platform IS NOT NULL AND input_platform NOT IN('line','telegram','whatsapp')) THEN
  RAISE EXCEPTION 'invalid achievement query' USING ERRCODE='22023';
 END IF;
 IF input_region IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM core.regions r WHERE r.id=input_region AND r.active AND r.region_type='operational' AND (
   (admin.can_access_region(r.id,'stats.read') AND admin.can_access_region(r.id,'learner.read') AND admin.can_access_region(r.id,'checkin.read'))
   OR EXISTS(SELECT 1 FROM core.person_region_assignments a JOIN identity.people p ON p.id=a.person_id
    WHERE a.region_id=r.id AND a.assignment_type='primary' AND a.valid_from<=CURRENT_DATE
     AND (a.valid_to IS NULL OR a.valid_to>CURRENT_DATE) AND p.status='active'
     AND admin.can_access_person(p.id,'stats.read') AND admin.can_access_person(p.id,'learner.read') AND admin.can_access_person(p.id,'checkin.read'))
  )) THEN RAISE EXCEPTION 'achievement scope unavailable' USING ERRCODE='42501';END IF;
 RETURN QUERY
 SELECT p.id,coalesce(nullif(p.preferred_name,''),nullif(p.legal_name,''),nullif(p.public_nickname,''),''),
  a.region_id,r.name_zh_tw,r.name_en,i.platform
 FROM identity.people p
 LEFT JOIN core.person_region_assignments a ON a.person_id=p.id AND a.assignment_type='primary'
  AND a.valid_from<=CURRENT_DATE AND (a.valid_to IS NULL OR a.valid_to>CURRENT_DATE)
 LEFT JOIN core.regions r ON r.id=a.region_id
 LEFT JOIN identity.person_interaction_channels ch ON ch.person_id=p.id AND ch.valid_to IS NULL AND ch.valid_from<=clock_timestamp()
 LEFT JOIN identity.platform_identities i ON i.id=ch.platform_identity_id AND i.person_id=p.id AND i.revoked_at IS NULL
 WHERE p.status='active' AND admin.can_access_person(p.id,'stats.read')
  AND admin.can_access_person(p.id,'learner.read') AND admin.can_access_person(p.id,'checkin.read')
  AND (input_region IS NULL OR a.region_id=input_region)
  AND (input_platform IS NULL OR i.platform=input_platform)
  AND (input_query='' OR position(lower(input_query) IN lower(coalesce(nullif(p.preferred_name,''),nullif(p.legal_name,''),nullif(p.public_nickname,''),'')))>0);
END$$;
REVOKE ALL ON FUNCTION admin._achievement_people(UUID,TEXT,TEXT) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;

CREATE FUNCTION admin.achievement_catalog(input_locale TEXT,input_region UUID,input_platform TEXT,input_query TEXT,input_year INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;regions JSONB;
BEGIN
 IF input_locale IS NULL OR input_locale NOT IN('zh_TW','zh_CN','en') OR
  (input_year IS NOT NULL AND input_year NOT BETWEEN 2000 AND 2200) THEN
  RAISE EXCEPTION 'invalid achievement query' USING ERRCODE='22023';END IF;
 -- Materialization shares exactly the same authorized population across all badge counts.
 WITH visible AS MATERIALIZED(SELECT * FROM admin._achievement_people(input_region,input_platform,input_query)),
 awarded AS MATERIALIZED(
  SELECT b.* FROM core.person_practice_badges b JOIN visible v ON v.person_id=b.person_id
  JOIN core.practice_badge_definitions d ON d.code=b.badge_code AND d.rule_version=b.rule_version
  WHERE b.revoked_at IS NULL AND (input_year IS NULL OR d.kind NOT IN('summer','winter') OR b.period=input_year::text)
 ), counts AS(SELECT b.badge_code,count(DISTINCT b.person_id)::integer n FROM awarded b GROUP BY b.badge_code),
 periods AS(SELECT b.badge_code,b.period,count(DISTINCT b.person_id)::integer n FROM awarded b GROUP BY b.badge_code,b.period)
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'code',d.code,'kind',d.kind,'name',CASE WHEN input_locale='en' THEN d.name_en ELSE d.name_zh_tw END,
  'threshold',d.threshold,'methodCodes',d.method_codes,'ruleVersion',d.rule_version,
  'configured',CASE WHEN d.kind IN('summer','winter') THEN EXISTS(SELECT 1 FROM core.practice_badge_seasons s WHERE s.kind=d.kind AND (input_year IS NULL OR s.year=input_year))
   ELSE NOT EXISTS(SELECT 1 FROM unnest(d.method_codes) AS required(method_code) WHERE NOT EXISTS(SELECT 1 FROM core.practice_methods m WHERE m.code=required.method_code)) END,
  'recipientCount',coalesce(c.n,0),
  'periods',coalesce((SELECT jsonb_agg(jsonb_build_object('period',p.period,'recipientCount',p.n) ORDER BY p.period) FROM periods p WHERE p.badge_code=d.code),'[]'::jsonb),
  'seasons',coalesce((SELECT jsonb_agg(jsonb_build_object('year',s.year,'startDate',s.start_date::text,'endDate',s.end_date::text,'timezone',s.timezone,'requiredDays',s.required_days) ORDER BY s.year DESC)
   FROM core.practice_badge_seasons s WHERE s.kind=d.kind AND (input_year IS NULL OR s.year=input_year)),'[]'::jsonb)
 ) ORDER BY d.sort_order,d.code),'[]'::jsonb) INTO result
 FROM core.practice_badge_definitions d LEFT JOIN counts c ON c.badge_code=d.code;
 -- Execute the authorization helper even for an empty award/catalog population.
 PERFORM 1 FROM admin._achievement_people(input_region,input_platform,input_query);
 WITH visible AS MATERIALIZED(SELECT * FROM admin._achievement_people(NULL,NULL,''))
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',CASE WHEN input_locale='en' THEN r.name_en ELSE r.name_zh_tw END) ORDER BY r.code),'[]'::jsonb)
 INTO regions FROM core.regions r WHERE r.active AND r.region_type='operational' AND (
  (admin.can_access_region(r.id,'stats.read') AND admin.can_access_region(r.id,'learner.read') AND admin.can_access_region(r.id,'checkin.read'))
  OR EXISTS(SELECT 1 FROM visible v WHERE v.region_id=r.id));
 RETURN jsonb_build_object('badges',result,'regions',regions,'seasonYear',input_year,'readOnly',TRUE,'observedAt',clock_timestamp());
END$$;
REVOKE ALL ON FUNCTION admin.achievement_catalog(TEXT,UUID,TEXT,TEXT,INTEGER) FROM PUBLIC,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.achievement_catalog(TEXT,UUID,TEXT,TEXT,INTEGER) TO qigong_api_runtime;

CREATE FUNCTION admin.achievement_recipients(input_code TEXT,input_locale TEXT,input_region UUID,input_platform TEXT,input_query TEXT,input_year INTEGER,input_page INTEGER,input_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE definition core.practice_badge_definitions;result JSONB;
BEGIN
 PERFORM 1 FROM admin._achievement_people(input_region,input_platform,input_query);
 IF input_locale IS NULL OR input_locale NOT IN('zh_TW','zh_CN','en') OR input_page IS NULL OR input_page NOT BETWEEN 1 AND 10000
  OR input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 100 OR (input_year IS NOT NULL AND input_year NOT BETWEEN 2000 AND 2200)
  OR input_code IS NULL OR char_length(input_code)>80 THEN
  RAISE EXCEPTION 'invalid achievement query' USING ERRCODE='22023';END IF;
 SELECT * INTO definition FROM core.practice_badge_definitions d WHERE d.code=input_code;
 IF NOT FOUND THEN RAISE EXCEPTION 'achievement unavailable' USING ERRCODE='P0002';END IF;
 WITH visible AS MATERIALIZED(SELECT * FROM admin._achievement_people(input_region,input_platform,input_query)),
 recipients AS MATERIALIZED(
  SELECT v.person_id,v.display_name,v.region_id,v.region_name_zh_tw,v.region_name_en,v.platform,
   jsonb_agg(jsonb_build_object('period',b.period,'ruleVersion',b.rule_version,'earnedAt',b.earned_at) ORDER BY b.period,b.rule_version) awards
  FROM visible v JOIN core.person_practice_badges b ON b.person_id=v.person_id
  WHERE b.badge_code=input_code AND b.rule_version=definition.rule_version AND b.revoked_at IS NULL
   AND (input_year IS NULL OR definition.kind NOT IN('summer','winter') OR b.period=input_year::text)
  GROUP BY v.person_id,v.display_name,v.region_id,v.region_name_zh_tw,v.region_name_en,v.platform
 ), page_rows AS(SELECT * FROM recipients ORDER BY display_name,person_id LIMIT input_limit OFFSET (input_page-1)*input_limit)
 SELECT jsonb_build_object('code',input_code,'ruleVersion',definition.rule_version,'page',input_page,'limit',input_limit,
  'total',(SELECT count(*)::integer FROM recipients),
  'totalPages',greatest(1,ceil((SELECT count(*) FROM recipients)::numeric/input_limit)::integer),
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('personId',p.person_id,'displayName',p.display_name,
   'regionId',p.region_id,'regionName',CASE WHEN input_locale='en' THEN p.region_name_en ELSE p.region_name_zh_tw END,
   'platform',p.platform,'awards',p.awards) ORDER BY p.display_name,p.person_id) FROM page_rows p),'[]'::jsonb)) INTO result;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION admin.achievement_recipients(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER,INTEGER,INTEGER) FROM PUBLIC,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.achievement_recipients(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER,INTEGER,INTEGER) TO qigong_api_runtime;

CREATE FUNCTION ops.admin_achievements_schema_ready() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-23-admin-achievements')
$$;
REVOKE ALL ON FUNCTION ops.admin_achievements_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.admin_achievements_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-23-admin-achievements',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
