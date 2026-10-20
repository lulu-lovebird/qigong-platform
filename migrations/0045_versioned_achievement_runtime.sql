-- C schema only. Operational runtime stays OFF; no publication or award backfill.
CREATE TABLE core.achievement_badge_identities (
 code TEXT PRIMARY KEY CHECK(code ~ '^[a-z][a-z0-9_]{1,79}$'),
 origin TEXT NOT NULL CHECK(origin IN('legacy','versioned')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO core.achievement_badge_identities(code,origin) SELECT code,'legacy' FROM core.practice_badge_definitions;
ALTER TABLE core.achievement_badge_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.achievement_badge_identities FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.achievement_badge_identities FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
DO $$DECLARE r RECORD;BEGIN
 FOR r IN SELECT c.conname,c.conrelid::regclass rel FROM pg_constraint c WHERE c.contype='f' AND c.confrelid='core.practice_badge_definitions'::regclass AND c.conrelid IN('core.person_practice_badges'::regclass,'core.achievement_rule_versions'::regclass) LOOP
  EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',r.rel,r.conname);
 END LOOP;
END$$;
ALTER TABLE core.person_practice_badges ADD CONSTRAINT person_practice_badges_identity_fk FOREIGN KEY(badge_code) REFERENCES core.achievement_badge_identities(code);
ALTER TABLE core.achievement_rule_versions ADD CONSTRAINT achievement_rule_versions_identity_fk FOREIGN KEY(badge_code) REFERENCES core.achievement_badge_identities(code);

CREATE TABLE ops.versioned_achievement_control (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton=TRUE),
 enabled BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO ops.versioned_achievement_control(singleton,enabled) VALUES(TRUE,FALSE);
CREATE TABLE core.achievement_runtime_versions (
 code TEXT NOT NULL REFERENCES core.achievement_badge_identities(code),
 rule_version INTEGER NOT NULL CHECK(rule_version>0),
 candidate_id UUID NOT NULL UNIQUE REFERENCES admin.achievement_publication_candidates(id),
 subject TEXT NOT NULL CHECK(subject IN('rule','activity','challenge','event')),
 year INTEGER,
 snapshot JSONB NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 snapshot_hash TEXT NOT NULL CHECK(snapshot_hash=encode(public.digest(snapshot::text,'sha256'),'hex')),
 effective_date DATE NOT NULL,
 earliest_start_at TIMESTAMPTZ NOT NULL,
 published_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 published_by UUID NOT NULL REFERENCES admin.principals(id),
 PRIMARY KEY(code,rule_version)
);
CREATE TABLE core.achievement_activation_cancellations (
 candidate_id UUID PRIMARY KEY REFERENCES core.achievement_runtime_versions(candidate_id),
 cancelled_by UUID NOT NULL REFERENCES admin.principals(id),
 cancelled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
 reason TEXT NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 1 AND 1000)
);
DO $$DECLARE n TEXT;BEGIN FOREACH n IN ARRAY ARRAY['ops.versioned_achievement_control','core.achievement_runtime_versions','core.achievement_activation_cancellations'] LOOP
 EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY',n);EXECUTE format('REVOKE ALL ON %s FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime',n);
END LOOP;END$$;
CREATE FUNCTION core._immutable_achievement_runtime() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'achievement runtime version immutable' USING ERRCODE='55000';END$$;
DO $$DECLARE n TEXT;BEGIN FOREACH n IN ARRAY ARRAY['achievement_badge_identities','achievement_runtime_versions','achievement_activation_cancellations'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_runtime_row BEFORE UPDATE OR DELETE ON core.%I FOR EACH ROW EXECUTE FUNCTION core._immutable_achievement_runtime()',n);
 EXECUTE format('CREATE TRIGGER immutable_runtime_truncate BEFORE TRUNCATE ON core.%I FOR EACH STATEMENT EXECUTE FUNCTION core._immutable_achievement_runtime()',n);
END LOOP;END$$;
REVOKE ALL ON FUNCTION core._immutable_achievement_runtime() FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION ops.versioned_achievements_enabled() RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT enabled FROM ops.versioned_achievement_control WHERE singleton),FALSE) AND EXISTS(SELECT 1 FROM public.schema_migrations WHERE version='0046_achievement_evaluation_and_readers.sql')
$$;
REVOKE ALL ON FUNCTION ops.versioned_achievements_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.versioned_achievements_enabled() TO qigong_api_runtime,qigong_worker_runtime;
INSERT INTO admin.permissions(code,description) VALUES('achievement.activate','Publish/schedule or cancel a sealed achievement version only when the operator runtime gate is enabled');
INSERT INTO admin.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM admin.roles r CROSS JOIN admin.permissions p WHERE r.code IN('super_admin','master_admin') AND p.code='achievement.activate';
CREATE FUNCTION admin.can_activate_achievement_now() RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT ops.versioned_achievements_enabled() AND EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id JOIN admin.principals p ON p.id=g.principal_id
 WHERE p.id=admin.request_principal_id() AND p.status='active' AND r.code IN('super_admin','master_admin') AND g.scope_type='global'
 AND g.valid_from<=clock_timestamp() AND(g.valid_to IS NULL OR g.valid_to>clock_timestamp())
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['achievement.manage_drafts','achievement.prepare_publication','achievement.activate']) required(code)
 WHERE NOT EXISTS(SELECT 1 FROM admin.role_permissions rp JOIN admin.permissions permission ON permission.id=rp.permission_id WHERE rp.role_id=r.id AND permission.code=required.code)))
$$;
CREATE FUNCTION admin.achievement_activation_session_current(input_token TEXT) RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT admin.can_activate_achievement_now() AND admin.achievement_management_session_current(input_token)
$$;
CREATE FUNCTION admin._achievement_conditions_locked(input_subject TEXT,input_code TEXT,input_year INTEGER) RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT input_subject IN('activity','event') AND EXISTS(SELECT 1 FROM core.achievement_runtime_versions v WHERE v.code=input_code AND v.subject=input_subject AND(input_year IS NULL OR v.year=input_year)
 AND NOT EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=v.candidate_id)
 AND v.earliest_start_at<=clock_timestamp())
$$;
CREATE FUNCTION admin.achievement_activation_review(input_id UUID) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row admin.achievement_publication_candidates;context JSONB;blocked TEXT;registered BOOLEAN;cancelled BOOLEAN;
BEGIN
 IF admin.can_activate_achievement_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement activation denied' USING ERRCODE='42501';END IF;
 SELECT * INTO row FROM admin.achievement_publication_candidates WHERE id=input_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'publication candidate unavailable' USING ERRCODE='P0002';END IF;
 SELECT EXISTS(SELECT 1 FROM core.achievement_runtime_versions WHERE candidate_id=input_id),EXISTS(SELECT 1 FROM core.achievement_activation_cancellations WHERE candidate_id=input_id) INTO registered,cancelled;
 context:=admin._achievement_publication_context(row.draft_id);
 blocked:=CASE WHEN cancelled THEN 'cancelled' WHEN registered THEN NULL WHEN(context->>'revision')::integer<>row.draft_revision OR context->>'configHash'<>row.config_hash OR context->>'sourceHash'<>row.source_hash THEN 'stale'
 WHEN NOT registered AND(context->>'eligible')::boolean IS NOT TRUE THEN coalesce(context->>'blockedReason','blocked')
 WHEN NOT registered AND(context->'deadline') IS DISTINCT FROM(row.snapshot->'deadline') THEN 'deadline_changed'
 WHEN NOT registered AND(context->'timezoneSnapshot') IS DISTINCT FROM(row.snapshot->'timezoneSnapshot') THEN 'timezone_policy_changed'
 WHEN NOT registered AND admin._achievement_conditions_locked(row.subject,row.code,row.year) THEN 'activity_started' ELSE NULL END;
 RETURN jsonb_build_object('id',row.id,'code',row.code,'ruleVersion',row.candidate_version,'snapshotHash',row.snapshot_hash,'draftRevision',row.draft_revision,'effectiveDate',row.effective_date,'eligible',blocked IS NULL,'blockedReason',blocked,'registered',registered,'cancelled',cancelled,'runtimeEnabled',true);
END$$;
CREATE FUNCTION admin.activate_achievement_version(input_id UUID,input_snapshot_hash TEXT,input_reason TEXT,input_confirmed BOOLEAN) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row admin.achievement_publication_candidates;review JSONB;first_start TIMESTAMPTZ;
BEGIN
 IF admin.can_activate_achievement_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement activation denied' USING ERRCODE='42501';END IF;
 IF input_confirmed IS DISTINCT FROM TRUE OR input_snapshot_hash IS NULL OR input_snapshot_hash !~ '^[a-f0-9]{64}$' OR input_reason IS NULL OR char_length(btrim(input_reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid achievement activation' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock_shared(1919,1);
 SELECT * INTO row FROM admin.achievement_publication_candidates WHERE id=input_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'publication candidate unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('achievement-publication:'||row.code,0));
 IF admin.can_activate_achievement_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement activation denied' USING ERRCODE='42501';END IF;
 IF row.snapshot_hash<>input_snapshot_hash THEN RAISE EXCEPTION 'achievement activation conflict' USING ERRCODE='40001';END IF;
 review:=admin.achievement_activation_review(row.id);
 IF(review->>'registered')::boolean AND NOT(review->>'cancelled')::boolean THEN RETURN review;END IF;
 IF(review->>'eligible')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'achievement activation blocked' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM core.achievement_runtime_versions v WHERE v.code=row.code AND(v.rule_version=row.candidate_version OR(v.effective_date=row.effective_date AND NOT EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=v.candidate_id)))) OR EXISTS(SELECT 1 FROM core.achievement_rule_versions v WHERE v.badge_code=row.code AND v.rule_version=row.candidate_version) OR EXISTS(SELECT 1 FROM core.person_practice_badges b WHERE b.badge_code=row.code AND b.rule_version=row.candidate_version) THEN RAISE EXCEPTION 'achievement activation conflict' USING ERRCODE='40001';END IF;
 SELECT min(row.effective_date::timestamp AT TIME ZONE zone) INTO first_start FROM jsonb_array_elements_text(row.snapshot->'timezoneSnapshot') zone;
 INSERT INTO core.achievement_badge_identities(code,origin) VALUES(row.code,'versioned') ON CONFLICT(code) DO NOTHING;
 INSERT INTO core.achievement_runtime_versions(code,rule_version,candidate_id,subject,year,snapshot,snapshot_hash,effective_date,earliest_start_at,published_by)
 VALUES(row.code,row.candidate_version,row.id,row.subject,row.year,row.snapshot,row.snapshot_hash,row.effective_date,first_start,admin.request_principal_id());
 INSERT INTO ops.practice_badge_jobs(person_id,due_at) SELECT p.id,least(clock_timestamp(),first_start) FROM identity.people p WHERE p.status='active' ON CONFLICT(person_id) DO UPDATE SET due_at=least(practice_badge_jobs.due_at,EXCLUDED.due_at);
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,reason,outcome,metadata) VALUES(coalesce(admin.request_id(),gen_random_uuid()),admin.request_principal_id(),'achievement.version_scheduled','achievement_publication_candidate',row.id::text,input_reason,'success',jsonb_build_object('code',row.code,'ruleVersion',row.candidate_version,'snapshotHash',row.snapshot_hash,'effectiveDate',row.effective_date));
 RETURN admin.achievement_activation_review(row.id);
END$$;
CREATE FUNCTION admin.cancel_achievement_activation(input_id UUID,input_snapshot_hash TEXT,input_reason TEXT,input_confirmed BOOLEAN) RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row core.achievement_runtime_versions;
BEGIN
 IF admin.can_activate_achievement_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement activation denied' USING ERRCODE='42501';END IF;
 IF input_confirmed IS DISTINCT FROM TRUE OR input_reason IS NULL OR char_length(btrim(input_reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid achievement activation' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock_shared(1919,1);
 SELECT * INTO row FROM core.achievement_runtime_versions WHERE candidate_id=input_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'publication candidate unavailable' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('achievement-publication:'||row.code,0));
 IF admin.can_activate_achievement_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement activation denied' USING ERRCODE='42501';END IF;
 IF input_snapshot_hash IS DISTINCT FROM row.snapshot_hash THEN RAISE EXCEPTION 'achievement activation conflict' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM core.achievement_activation_cancellations WHERE candidate_id=input_id) THEN RETURN admin.achievement_activation_review(input_id);END IF;
 IF row.earliest_start_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM core.person_practice_badges WHERE badge_code=row.code AND rule_version=row.rule_version) THEN RAISE EXCEPTION 'achievement activation blocked' USING ERRCODE='55000';END IF;
 INSERT INTO core.achievement_activation_cancellations(candidate_id,cancelled_by,reason) VALUES(input_id,admin.request_principal_id(),input_reason);
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,reason,outcome,metadata) VALUES(coalesce(admin.request_id(),gen_random_uuid()),admin.request_principal_id(),'achievement.version_cancelled','achievement_publication_candidate',input_id::text,input_reason,'success',jsonb_build_object('code',row.code,'ruleVersion',row.rule_version,'snapshotHash',row.snapshot_hash));
 RETURN admin.achievement_activation_review(input_id);
END$$;
REVOKE ALL ON FUNCTION admin._achievement_conditions_locked(TEXT,TEXT,INTEGER) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
REVOKE ALL ON FUNCTION admin.can_activate_achievement_now(),admin.achievement_activation_session_current(TEXT),admin.achievement_activation_review(UUID),admin.activate_achievement_version(UUID,TEXT,TEXT,BOOLEAN),admin.cancel_achievement_activation(UUID,TEXT,TEXT,BOOLEAN) FROM PUBLIC,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.can_activate_achievement_now(),admin.achievement_activation_session_current(TEXT),admin.achievement_activation_review(UUID),admin.activate_achievement_version(UUID,TEXT,TEXT,BOOLEAN),admin.cancel_achievement_activation(UUID,TEXT,TEXT,BOOLEAN) TO qigong_api_runtime;
