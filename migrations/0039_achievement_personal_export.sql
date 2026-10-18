-- Explicit personal-data export, separate from ordinary read-only achievement reporting.
INSERT INTO admin.permissions(code,description) VALUES('achievement.export_personal','Export authorized achievement recipients and contact data');
INSERT INTO admin.role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM admin.roles r CROSS JOIN admin.permissions p
WHERE r.code IN('super_admin','master_admin') AND p.code='achievement.export_personal';

CREATE TABLE admin.achievement_export_limits (
 principal_id UUID PRIMARY KEY REFERENCES admin.principals(id),
 next_allowed_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE admin.achievement_export_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.achievement_export_limits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON admin.achievement_export_limits FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;

CREATE FUNCTION admin.can_export_achievement_personal_now() RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id
 JOIN admin.principals p ON p.id=g.principal_id
 WHERE p.id=admin.request_principal_id() AND p.status='active'
  AND r.code IN('super_admin','master_admin') AND g.scope_type='global'
  AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp())
  AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['achievement.export_personal','stats.read','learner.read','checkin.read']) required(code)
   WHERE NOT EXISTS(SELECT 1 FROM admin.role_permissions rp JOIN admin.permissions permission ON permission.id=rp.permission_id
    WHERE rp.role_id=r.id AND permission.code=required.code)))
$$;
REVOKE ALL ON FUNCTION admin.can_export_achievement_personal_now() FROM PUBLIC,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.can_export_achievement_personal_now() TO qigong_api_runtime;

CREATE FUNCTION admin._achievement_export_population(input_code TEXT,input_region UUID,input_platform TEXT,input_query TEXT,input_year INTEGER)
RETURNS TABLE(person_id UUID,periods TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF admin.can_export_achievement_personal_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement export denied' USING ERRCODE='42501';END IF;
 IF input_code IS NULL OR char_length(input_code)>80 OR (input_year IS NOT NULL AND input_year NOT BETWEEN 2000 AND 2200) THEN
  RAISE EXCEPTION 'invalid achievement export' USING ERRCODE='22023';END IF;
 PERFORM 1 FROM admin._achievement_people(input_region,input_platform,input_query);
 IF NOT EXISTS(SELECT 1 FROM core.practice_badge_definitions d WHERE d.code=input_code) THEN
  RAISE EXCEPTION 'achievement unavailable' USING ERRCODE='P0002';END IF;
 RETURN QUERY
 SELECT v.person_id,string_agg(DISTINCT b.period,';' ORDER BY b.period)
 FROM admin._achievement_people(input_region,input_platform,input_query) v
 JOIN core.person_practice_badges b ON b.person_id=v.person_id
 JOIN core.practice_badge_definitions d ON d.code=b.badge_code AND d.rule_version=b.rule_version
 WHERE b.badge_code=input_code AND b.revoked_at IS NULL
  AND (input_year IS NULL OR d.kind NOT IN('summer','winter') OR b.period=input_year::text)
 GROUP BY v.person_id ORDER BY v.person_id LIMIT 5001;
END$$;
REVOKE ALL ON FUNCTION admin._achievement_export_population(TEXT,UUID,TEXT,TEXT,INTEGER) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;

CREATE FUNCTION admin.achievement_export_preview(input_code TEXT,input_locale TEXT,input_region UUID,input_platform TEXT,input_query TEXT,input_year INTEGER)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;recipients INTEGER;
BEGIN
 IF admin.can_export_achievement_personal_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement export denied' USING ERRCODE='42501';END IF;
 IF input_locale IS NULL OR input_locale NOT IN('zh_TW','zh_CN','en') THEN RAISE EXCEPTION 'invalid achievement export' USING ERRCODE='22023';END IF;
 SELECT count(*)::integer INTO recipients FROM admin._achievement_export_population(input_code,input_region,input_platform,input_query,input_year);
 SELECT jsonb_build_object('code',d.code,'name',CASE WHEN input_locale='en' THEN d.name_en ELSE d.name_zh_tw END,
  'ruleVersion',d.rule_version,'count',recipients,'overLimit',recipients>5000,'limit',5000) INTO result
 FROM core.practice_badge_definitions d WHERE d.code=input_code;
 IF admin.can_export_achievement_personal_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement export denied' USING ERRCODE='42501';END IF;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION admin.achievement_export_preview(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER) FROM PUBLIC,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.achievement_export_preview(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER) TO qigong_api_runtime;

CREATE FUNCTION admin.prepare_achievement_personal_export(input_code TEXT,input_locale TEXT,input_region UUID,input_platform TEXT,input_query TEXT,input_year INTEGER,input_purpose TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE data JSONB;result JSONB;recipients INTEGER;next_allowed TIMESTAMPTZ;actor UUID;
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
 WITH winners AS MATERIALIZED(SELECT * FROM admin._achievement_export_population(input_code,input_region,input_platform,input_query,input_year))
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
 SELECT jsonb_build_object('code',d.code,'name',CASE WHEN input_locale='en' THEN d.name_en ELSE d.name_zh_tw END,
  'ruleVersion',d.rule_version,'count',recipients,'rows',data) INTO result FROM core.practice_badge_definitions d WHERE d.code=input_code;
 INSERT INTO admin.achievement_export_limits(principal_id,next_allowed_at) VALUES(actor,clock_timestamp()+INTERVAL '30 seconds')
 ON CONFLICT(principal_id) DO UPDATE SET next_allowed_at=EXCLUDED.next_allowed_at;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,reason,outcome,metadata)
 VALUES(coalesce(admin.request_id(),gen_random_uuid()),actor,'achievement.export_prepared','achievement',input_code,input_purpose,'success',
  jsonb_build_object('ruleVersion',(result->>'ruleVersion')::integer,'rowCount',recipients,'purpose',input_purpose,
   'regionId',input_region,'platform',input_platform,'seasonYear',input_year,'queryApplied',input_query<>'','delivery','prepared_not_confirmed_saved'));
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION admin.prepare_achievement_personal_export(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER,TEXT) FROM PUBLIC,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.prepare_achievement_personal_export(TEXT,TEXT,UUID,TEXT,TEXT,INTEGER,TEXT) TO qigong_api_runtime;

-- Recheck the actual admin session with wall-clock expiry on the same export connection.
CREATE FUNCTION admin.achievement_export_session_current(input_token TEXT) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT admin.can_export_achievement_personal_now() AND input_token IS NOT NULL
  AND length(input_token) BETWEEN 32 AND 128 AND EXISTS(SELECT 1 FROM admin.sessions s
   WHERE s.token_hash=public.digest(input_token,'sha256') AND s.principal_id=admin.request_principal_id()
    AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp())
$$;
REVOKE ALL ON FUNCTION admin.achievement_export_session_current(TEXT) FROM PUBLIC,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.achievement_export_session_current(TEXT) TO qigong_api_runtime;

CREATE FUNCTION ops.achievement_export_schema_ready() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-24-achievement-personal-export')$$;
REVOKE ALL ON FUNCTION ops.achievement_export_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.achievement_export_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-24-achievement-personal-export',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
