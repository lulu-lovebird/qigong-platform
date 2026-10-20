-- B prepares immutable, non-active releases only. Legacy evaluators must never see them.
-- A/0001–0043 and existing award data are not rewritten; keep phase27 compatibility.
INSERT INTO admin.permissions(code,description) VALUES('achievement.prepare_publication','Prepare immutable achievement releases awaiting separately enabled activation');
INSERT INTO admin.role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM admin.roles r CROSS JOIN admin.permissions p WHERE r.code IN('super_admin','master_admin') AND p.code='achievement.prepare_publication';
CREATE TABLE admin.achievement_publication_candidates (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 draft_id UUID NOT NULL REFERENCES admin.achievement_config_drafts(id),
 draft_revision INTEGER NOT NULL CHECK(draft_revision>0),
 code TEXT NOT NULL CHECK(code ~ '^[a-z][a-z0-9_]{1,79}$'),
 candidate_version INTEGER NOT NULL CHECK(candidate_version>0),
 subject TEXT NOT NULL CHECK(subject IN('rule','activity','challenge','event')),
 year INTEGER,
 config_hash TEXT NOT NULL CHECK(config_hash ~ '^[a-f0-9]{64}$'),
 base_hash TEXT NOT NULL CHECK(base_hash ~ '^[a-f0-9]{64}$'),
 source_hash TEXT NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=131072),
 snapshot_hash TEXT NOT NULL CHECK(snapshot_hash=encode(public.digest(snapshot::text,'sha256'),'hex')),
 effective_date DATE NOT NULL,
 state TEXT NOT NULL DEFAULT 'awaiting_activation' CHECK(state='awaiting_activation'),
 activation_enabled BOOLEAN NOT NULL DEFAULT FALSE CHECK(activation_enabled=FALSE),
 prepared_by UUID NOT NULL REFERENCES admin.principals(id),
 reason TEXT NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 1 AND 1000),
 prepared_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(draft_id,draft_revision),UNIQUE(code,candidate_version)
);
ALTER TABLE admin.achievement_publication_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.achievement_publication_candidates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON admin.achievement_publication_candidates FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION admin._immutable_achievement_publication() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'publication candidate immutable' USING ERRCODE='55000';END$$;
CREATE TRIGGER achievement_publication_immutable BEFORE UPDATE OR DELETE ON admin.achievement_publication_candidates FOR EACH ROW EXECUTE FUNCTION admin._immutable_achievement_publication();
CREATE TRIGGER achievement_publication_no_truncate BEFORE TRUNCATE ON admin.achievement_publication_candidates FOR EACH STATEMENT EXECUTE FUNCTION admin._immutable_achievement_publication();
REVOKE ALL ON FUNCTION admin._immutable_achievement_publication() FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;

CREATE FUNCTION admin.can_prepare_achievement_publication_now() RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id JOIN admin.principals p ON p.id=g.principal_id
 WHERE g.principal_id=admin.request_principal_id() AND p.status='active' AND r.code IN('master_admin','super_admin') AND g.scope_type='global'
 AND g.valid_from<=clock_timestamp() AND(g.valid_to IS NULL OR g.valid_to>clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['achievement.manage_drafts','achievement.prepare_publication']) required(code)
 WHERE NOT EXISTS(SELECT 1 FROM admin.role_permissions rp JOIN admin.permissions permission ON permission.id=rp.permission_id WHERE rp.role_id=r.id AND permission.code=required.code)))
$$;
CREATE FUNCTION admin.achievement_publication_session_current(input_token TEXT) RETURNS BOOLEAN
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT admin.can_prepare_achievement_publication_now() AND admin.achievement_management_session_current(input_token)
$$;

CREATE FUNCTION admin._achievement_publication_context(input_id UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row admin.achievement_config_drafts;source JSONB;normalized JSONB;source_hash TEXT;config_hash TEXT;zones TEXT[];latest_today DATE;effective DATE;blocked TEXT;deadline JSONB;
BEGIN
 SELECT * INTO row FROM admin.achievement_config_drafts WHERE id=input_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'achievement draft unavailable' USING ERRCODE='P0002';END IF;
 source:=admin._achievement_config_source(row.subject,row.code,row.year);
 normalized:=admin._achievement_config_validate(row.subject,row.code,row.year,row.config);
 source_hash:=encode(public.digest(source::text,'sha256'),'hex');config_hash:=encode(public.digest(normalized::text,'sha256'),'hex');effective:=(normalized->>'effectiveDate')::date;
 SELECT array_agg(name ORDER BY name) INTO zones FROM pg_timezone_names WHERE name='UTC' OR(position('/' IN name)>0 AND name !~ '^(posix|right)/');
 SELECT max((clock_timestamp() AT TIME ZONE zone)::date) INTO latest_today FROM unnest(zones) zone;
 blocked:=CASE WHEN row.state<>'draft' THEN 'archived' WHEN row.base_hash<>source_hash THEN 'source_changed'
  WHEN admin._achievement_config_locked(row.subject,source) IS TRUE THEN 'activity_started'
  WHEN effective<=latest_today THEN 'effective_date_not_future'
  WHEN row.subject='activity' AND extract(year FROM (normalized->>'startDate')::date)::integer<>row.year THEN 'activity_year_mismatch' ELSE NULL END;
 IF blocked IS NULL AND row.subject IN('activity','event') THEN deadline:=admin._achievement_activity_deadline((normalized->>'endDate')::date,zones);END IF;
 RETURN jsonb_build_object('draftId',row.id,'revision',row.revision,'subject',row.subject,'code',row.code,'year',row.year,
  'configHash',config_hash,'baseHash',row.base_hash,'sourceHash',source_hash,'effectiveDate',effective,'eligible',blocked IS NULL,'blockedReason',blocked,
  'config',normalized,'baseConfig',source,'timezoneSnapshot',zones,'deadline',deadline);
END$$;
CREATE FUNCTION admin.achievement_publication_review(input_id UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE context JSONB;
BEGIN
 IF admin.can_prepare_achievement_publication_now() IS NOT TRUE THEN RAISE EXCEPTION 'publication preparation denied' USING ERRCODE='42501';END IF;
 context:=admin._achievement_publication_context(input_id);
 IF admin.can_prepare_achievement_publication_now() IS NOT TRUE THEN RAISE EXCEPTION 'publication preparation denied' USING ERRCODE='42501';END IF;
 RETURN(context-'config'-'baseConfig'-'timezoneSnapshot'-'deadline')||jsonb_build_object('phase','awaiting_activation_only','activationEnabled',false,'awardingEnabled',false);
END$$;
CREATE FUNCTION admin.achievement_publication_candidate(input_id UUID) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row admin.achievement_publication_candidates;draft admin.achievement_config_drafts;source_hash TEXT;
BEGIN
 IF admin.can_prepare_achievement_publication_now() IS NOT TRUE THEN RAISE EXCEPTION 'publication preparation denied' USING ERRCODE='42501';END IF;
 SELECT * INTO row FROM admin.achievement_publication_candidates WHERE id=input_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'publication candidate unavailable' USING ERRCODE='P0002';END IF;
 SELECT * INTO draft FROM admin.achievement_config_drafts WHERE id=row.draft_id;
 source_hash:=encode(public.digest(admin._achievement_config_source(draft.subject,draft.code,draft.year)::text,'sha256'),'hex');
 IF admin.can_prepare_achievement_publication_now() IS NOT TRUE THEN RAISE EXCEPTION 'publication preparation denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('id',row.id,'draftId',row.draft_id,'draftRevision',row.draft_revision,'code',row.code,'candidateVersion',row.candidate_version,'subject',row.subject,'year',row.year,
  'configHash',row.config_hash,'baseHash',row.base_hash,'sourceHash',row.source_hash,'snapshotHash',row.snapshot_hash,'effectiveDate',row.effective_date,'preparedAt',row.prepared_at,
  'state',row.state,'activationEnabled',false,'awardingEnabled',false,'snapshot',row.snapshot,
  'stale',draft.state<>'draft' OR draft.revision<>row.draft_revision OR source_hash<>row.source_hash);
END$$;
CREATE FUNCTION admin.achievement_publication_candidates(input_page INTEGER DEFAULT 1) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;
BEGIN
 IF admin.can_prepare_achievement_publication_now() IS NOT TRUE THEN RAISE EXCEPTION 'publication preparation denied' USING ERRCODE='42501';END IF;
 IF input_page IS NULL OR input_page NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'invalid publication preparation' USING ERRCODE='22023';END IF;
 SELECT jsonb_build_object('page',input_page,'limit',20,'total',(SELECT count(*) FROM admin.achievement_publication_candidates),
 'rows',coalesce((SELECT jsonb_agg(admin.achievement_publication_candidate(r.id) ORDER BY r.prepared_at DESC,r.id) FROM(SELECT * FROM admin.achievement_publication_candidates ORDER BY prepared_at DESC,id LIMIT 20 OFFSET(input_page-1)*20) r),'[]')) INTO result;
 IF admin.can_prepare_achievement_publication_now() IS NOT TRUE THEN RAISE EXCEPTION 'publication preparation denied' USING ERRCODE='42501';END IF;
 RETURN result;
END$$;

CREATE FUNCTION admin.prepare_achievement_publication(input_id UUID,input_revision INTEGER,input_config_hash TEXT,input_base_hash TEXT,input_source_hash TEXT,input_reason TEXT,input_confirmed BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE draft admin.achievement_config_drafts;context JSONB;row admin.achievement_publication_candidates;version BIGINT;sealed JSONB;actor UUID;
BEGIN
 IF admin.can_prepare_achievement_publication_now() IS NOT TRUE THEN RAISE EXCEPTION 'publication preparation denied' USING ERRCODE='42501';END IF;
 IF input_confirmed IS DISTINCT FROM TRUE OR input_revision IS NULL OR input_revision<1 OR input_reason IS NULL OR char_length(btrim(input_reason)) NOT BETWEEN 1 AND 1000
 OR input_config_hash IS NULL OR input_config_hash !~ '^[a-f0-9]{64}$' OR input_base_hash IS NULL OR input_base_hash !~ '^[a-f0-9]{64}$' OR input_source_hash IS NULL OR input_source_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid publication preparation' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock_shared(1919,1);
 SELECT * INTO draft FROM admin.achievement_config_drafts WHERE id=input_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'achievement draft unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('achievement-publication:'||draft.code,0));
 PERFORM pg_advisory_xact_lock(1944,1);
 IF admin.can_prepare_achievement_publication_now() IS NOT TRUE THEN RAISE EXCEPTION 'publication preparation denied' USING ERRCODE='42501';END IF;
 context:=admin._achievement_publication_context(input_id);
 IF (context->>'revision')::integer<>input_revision OR context->>'configHash'<>input_config_hash OR context->>'baseHash'<>input_base_hash OR context->>'sourceHash'<>input_source_hash THEN RAISE EXCEPTION 'publication preparation conflict' USING ERRCODE='40001';END IF;
 IF(context->>'eligible')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'publication preparation blocked' USING ERRCODE='55000';END IF;
 SELECT * INTO row FROM admin.achievement_publication_candidates c WHERE c.draft_id=input_id AND c.draft_revision=input_revision;
 IF FOUND THEN
  IF row.config_hash<>input_config_hash OR row.base_hash<>input_base_hash OR row.source_hash<>input_source_hash THEN RAISE EXCEPTION 'publication preparation conflict' USING ERRCODE='40001';END IF;
  RETURN admin.achievement_publication_candidate(row.id);
 END IF;
 IF(SELECT count(*) FROM admin.achievement_publication_candidates)>=5000 THEN RAISE EXCEPTION 'publication preparation capacity' USING ERRCODE='54000';END IF;
 SELECT greatest(coalesce((SELECT max(v.rule_version)::bigint FROM core.achievement_rule_versions v WHERE v.badge_code=draft.code),0),
  coalesce((SELECT max(b.rule_version)::bigint FROM core.person_practice_badges b WHERE b.badge_code=draft.code),0),
  coalesce((SELECT max(c.candidate_version)::bigint FROM admin.achievement_publication_candidates c WHERE c.code=draft.code),0))+1 INTO version;
 IF version>2147483647 THEN RAISE EXCEPTION 'publication preparation capacity' USING ERRCODE='54000';END IF;
 sealed:=jsonb_build_object('formatVersion',1,'draftId',draft.id,'draftRevision',draft.revision,'code',draft.code,'candidateVersion',version,'subject',draft.subject,'year',draft.year,
  'config',context->'config','baseConfig',context->'baseConfig','baseHash',context->>'baseHash','sourceHash',context->>'sourceHash','configHash',context->>'configHash',
  'timezoneSnapshot',context->'timezoneSnapshot','deadline',context->'deadline','effectiveDate',context->>'effectiveDate','state','awaiting_activation','activationEnabled',false,'awardingEnabled',false);
 actor:=admin.request_principal_id();
 IF admin.can_prepare_achievement_publication_now() IS NOT TRUE THEN RAISE EXCEPTION 'publication preparation denied' USING ERRCODE='42501';END IF;
 INSERT INTO admin.achievement_publication_candidates(draft_id,draft_revision,code,candidate_version,subject,year,config_hash,base_hash,source_hash,snapshot,snapshot_hash,effective_date,prepared_by,reason)
 VALUES(draft.id,draft.revision,draft.code,version,draft.subject,draft.year,input_config_hash,input_base_hash,input_source_hash,sealed,encode(public.digest(sealed::text,'sha256'),'hex'),(context->>'effectiveDate')::date,actor,input_reason) RETURNING * INTO row;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,reason,outcome,metadata)
 VALUES(coalesce(admin.request_id(),gen_random_uuid()),actor,'achievement.publication_prepared','achievement_publication_candidate',row.id::text,input_reason,'success',
  jsonb_build_object('draftId',draft.id,'draftRevision',draft.revision,'code',draft.code,'candidateVersion',version,'configHash',input_config_hash,'sourceHash',input_source_hash,'snapshotHash',row.snapshot_hash,'state','awaiting_activation','activationEnabled',false,'awardingEnabled',false));
 RETURN admin.achievement_publication_candidate(row.id);
END$$;

CREATE FUNCTION ops.achievement_publication_schema_ready() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='0044_achievement_publication_candidates.sql') AND to_regclass('admin.achievement_publication_candidates') IS NOT NULL$$;
REVOKE ALL ON FUNCTION admin._achievement_publication_context(UUID) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
REVOKE ALL ON FUNCTION admin.can_prepare_achievement_publication_now(),admin.achievement_publication_session_current(TEXT),admin.achievement_publication_review(UUID),admin.achievement_publication_candidate(UUID),admin.achievement_publication_candidates(INTEGER),admin.prepare_achievement_publication(UUID,INTEGER,TEXT,TEXT,TEXT,TEXT,BOOLEAN),ops.achievement_publication_schema_ready() FROM PUBLIC,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.can_prepare_achievement_publication_now(),admin.achievement_publication_session_current(TEXT),admin.achievement_publication_review(UUID),admin.achievement_publication_candidate(UUID),admin.achievement_publication_candidates(INTEGER),admin.prepare_achievement_publication(UUID,INTEGER,TEXT,TEXT,TEXT,TEXT,BOOLEAN),ops.achievement_publication_schema_ready() TO qigong_api_runtime;
