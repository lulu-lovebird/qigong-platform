-- C implementation. Operator gate remains FALSE; no runtime version is automatically activated.
CREATE TABLE audit.achievement_transitions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 person_id UUID NOT NULL REFERENCES identity.people(id),
 badge_code TEXT NOT NULL REFERENCES core.achievement_badge_identities(code),
 rule_version INTEGER NOT NULL,period TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('earned','revoked','restored')),
 cause TEXT NOT NULL CHECK(cause IN('committed_practice_change','scheduled_reconciliation','explicit_evaluation')),
 request_id TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE audit.achievement_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.achievement_transitions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON audit.achievement_transitions FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
ALTER TABLE ops.practice_badge_jobs ADD COLUMN dirty_generation BIGINT NOT NULL DEFAULT 1 CHECK(dirty_generation>=0),ADD COLUMN evaluated_generation BIGINT NOT NULL DEFAULT 0 CHECK(evaluated_generation>=0);

CREATE FUNCTION core._achievement_period_qualifies(input_person UUID,input_kind TEXT,input_methods TEXT[],input_all BOOLEAN,input_continuous BOOLEAN,input_threshold INTEGER,input_start DATE,input_end DATE,input_period TEXT,input_now TIMESTAMPTZ) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH accepted AS MATERIALIZED(
  SELECT DISTINCT c.practice_date FROM core.checkins c JOIN identity.people p ON p.id=c.person_id
  WHERE c.person_id=input_person AND c.practice_date<=(input_now AT TIME ZONE p.practice_timezone)::date
  AND(input_start IS NULL OR c.practice_date>=input_start) AND(input_end IS NULL OR c.practice_date<=input_end)
  AND(input_kind<>'combo' OR extract(year FROM c.practice_date)::integer::text=input_period)
  AND(input_kind IN('total','streak','summer','event')
   OR(input_kind IN('method','winter','challenge') AND CASE WHEN input_all THEN
    NOT EXISTS(SELECT 1 FROM unnest(input_methods) requested(code) WHERE NOT EXISTS(SELECT 1 FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=c.id AND m.code=requested.code))
    ELSE EXISTS(SELECT 1 FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=c.id AND m.code=ANY(input_methods)) END)
   OR(input_kind='combo' AND NOT EXISTS(SELECT 1 FROM unnest(input_methods) requested(code) WHERE NOT EXISTS(SELECT 1 FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=c.id AND m.code=requested.code)))
   OR(input_kind IN('morning','night') AND c.entry_kind='regular' AND(c.created_at AT TIME ZONE c.practice_timezone)::time>=CASE WHEN input_kind='morning' THEN TIME '05:00' ELSE TIME '21:00' END AND(c.created_at AT TIME ZONE c.practice_timezone)::time<CASE WHEN input_kind='morning' THEN TIME '07:00' ELSE TIME '23:00' END)
  )
 ), islands AS(SELECT practice_date-row_number() OVER(ORDER BY practice_date)::integer island FROM accepted)
 SELECT CASE WHEN input_continuous OR input_kind IN('streak','morning','night') THEN EXISTS(SELECT 1 FROM islands GROUP BY island HAVING count(*)>=input_threshold)
 ELSE(SELECT count(*) FROM accepted)>=input_threshold END
$$;
CREATE FUNCTION core.achievement_qualifying_periods(input_person UUID,input_code TEXT,input_version INTEGER,input_now TIMESTAMPTZ)
RETURNS TABLE(period TEXT,qualifies BOOLEAN,grant_ready BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE runtime core.achievement_runtime_versions;legacy core.achievement_rule_versions;cfg JSONB;definition JSONB;seasons JSONB;season JSONB;kind TEXT;methods TEXT[];start_day DATE;end_day DATE;required INTEGER;continuous BOOLEAN:=FALSE;match_all BOOLEAN:=FALSE;deadline JSONB;zones TEXT[];p TEXT;
BEGIN
 SELECT * INTO runtime FROM core.achievement_runtime_versions v WHERE v.code=input_code AND v.rule_version=input_version;
 IF FOUND THEN
  IF EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=runtime.candidate_id) THEN RETURN;END IF;
  cfg:=runtime.snapshot->'config';definition:=runtime.snapshot->'baseConfig'->'definition';
  kind:=CASE WHEN runtime.subject IN('event','challenge') THEN runtime.subject ELSE definition->>'kind' END;
  start_day:=CASE WHEN runtime.subject='challenge' AND cfg->>'startMode'='date' THEN(cfg->>'startDate')::date ELSE runtime.effective_date END;
  required:=coalesce((cfg->>'threshold')::integer,(cfg->>'requiredDays')::integer);continuous:=coalesce((cfg->>'continuous')::boolean,FALSE);match_all:=cfg->>'methodMatch'='all';
  IF runtime.subject IN('event','activity') THEN
   end_day:=(cfg->>'endDate')::date;deadline:=runtime.snapshot->'deadline';
   methods:=CASE WHEN kind='winter' THEN ARRAY['guishou_bagua','guishou_qiankun','guishou_fengxiang_guishuo'] ELSE '{}' END;
   period:=CASE WHEN runtime.subject='activity' THEN runtime.year::text ELSE 'activity' END;
   qualifies:=core._achievement_period_qualifies(input_person,kind,methods,FALSE,continuous,required,start_day,end_day,period,input_now);grant_ready:=input_now>=(deadline->>'settlementAt')::timestamptz;RETURN NEXT;RETURN;
  END IF;
  SELECT coalesce(array_agg(v),'{}') INTO methods FROM jsonb_array_elements_text(cfg->'methodCodes') v;
 ELSE
  SELECT * INTO legacy FROM core.achievement_rule_versions v WHERE v.badge_code=input_code AND v.rule_version=input_version;
  IF NOT FOUND OR legacy.provenance<>'legacy_snapshot' THEN RETURN;END IF;
  definition:=legacy.snapshot->'definition';kind:=definition->>'kind';required:=(definition->>'threshold')::integer;
  SELECT coalesce(array_agg(v),'{}') INTO methods FROM jsonb_array_elements_text(definition->'method_codes') v;
  IF kind IN('summer','winter') THEN
   SELECT array_agg(name ORDER BY name) INTO zones FROM pg_timezone_names WHERE name='UTC' OR(position('/' IN name)>0 AND name !~ '^(posix|right)/');
   FOR season IN SELECT value FROM jsonb_array_elements(legacy.snapshot->'seasons') LOOP
    period:=season->>'year';start_day:=(season->>'start_date')::date;end_day:=(season->>'end_date')::date;required:=(season->>'required_days')::integer;
    methods:=CASE WHEN kind='winter' THEN ARRAY['guishou_bagua','guishou_qiankun','guishou_fengxiang_guishuo'] ELSE '{}' END;
    deadline:=admin._achievement_activity_deadline(end_day,zones);
    qualifies:=core._achievement_period_qualifies(input_person,kind,methods,FALSE,FALSE,required,start_day,end_day,period,input_now);grant_ready:=input_now>=(deadline->>'settlementAt')::timestamptz;RETURN NEXT;
   END LOOP;RETURN;
  END IF;
 END IF;
 IF kind='combo' THEN
  FOR p IN SELECT DISTINCT extract(year FROM c.practice_date)::integer::text FROM core.checkins c JOIN identity.people owner ON owner.id=c.person_id WHERE c.person_id=input_person AND c.practice_date<=(input_now AT TIME ZONE owner.practice_timezone)::date AND(start_day IS NULL OR c.practice_date>=start_day)
   UNION SELECT b.period FROM core.person_practice_badges b WHERE b.person_id=input_person AND b.badge_code=input_code AND b.rule_version=input_version LOOP
   period:=p;qualifies:=core._achievement_period_qualifies(input_person,kind,methods,TRUE,FALSE,1,start_day,NULL,p,input_now);grant_ready:=TRUE;RETURN NEXT;
  END LOOP;
 ELSE
  period:='lifetime';qualifies:=core._achievement_period_qualifies(input_person,kind,methods,coalesce(match_all,FALSE),continuous,required,start_day,NULL,period,input_now);grant_ready:=TRUE;RETURN NEXT;
 END IF;
END$$;
ALTER FUNCTION core.evaluate_practice_badges(UUID) RENAME TO _legacy_evaluate_practice_badges;
REVOKE ALL ON FUNCTION core._legacy_evaluate_practice_badges(UUID) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION core.evaluate_practice_badges(target UUID) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE anchor DATE;zone TEXT;v RECORD;q RECORD;a core.person_practice_badges;action TEXT;observed TIMESTAMPTZ:=clock_timestamp();cause TEXT;
BEGIN
 IF NOT ops.versioned_achievements_enabled() THEN PERFORM core._legacy_evaluate_practice_badges(target);RETURN;END IF;
 SELECT p.practice_timezone INTO zone FROM identity.people p WHERE p.id=target AND p.status='active' FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;anchor:=(observed AT TIME ZONE zone)::date;
 cause:=coalesce(nullif(current_setting('qigong.achievement_cause',TRUE),''),'explicit_evaluation');IF cause NOT IN('committed_practice_change','scheduled_reconciliation','explicit_evaluation') THEN cause:='explicit_evaluation';END IF;
 FOR v IN WITH current_versions AS(
  SELECT i.code,coalesce((SELECT r.rule_version FROM core.achievement_runtime_versions r WHERE r.code=i.code AND r.effective_date<=anchor AND NOT EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=r.candidate_id) ORDER BY r.effective_date DESC,r.rule_version DESC LIMIT 1),d.rule_version) rule_version
  FROM core.achievement_badge_identities i LEFT JOIN core.practice_badge_definitions d ON d.code=i.code
 ), versions AS(SELECT c.code,c.rule_version,TRUE issue FROM current_versions c WHERE c.rule_version IS NOT NULL
  UNION ALL SELECT b.badge_code,b.rule_version,FALSE FROM core.person_practice_badges b WHERE b.person_id=target AND NOT EXISTS(SELECT 1 FROM current_versions c WHERE c.code=b.badge_code AND c.rule_version=b.rule_version))
 SELECT code,rule_version,bool_or(issue) issue FROM versions GROUP BY code,rule_version ORDER BY code,rule_version LOOP
  FOR q IN SELECT * FROM core.achievement_qualifying_periods(target,v.code,v.rule_version,observed) LOOP
   SELECT * INTO a FROM core.person_practice_badges b WHERE b.person_id=target AND b.badge_code=v.code AND b.rule_version=v.rule_version AND b.period=q.period FOR UPDATE;
   action:=NULL;
   IF q.qualifies AND q.grant_ready THEN
    IF a.person_id IS NULL AND v.issue THEN INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version,earned_at) VALUES(target,v.code,q.period,v.rule_version,observed);action:='earned';
    ELSIF a.revoked_at IS NOT NULL THEN UPDATE core.person_practice_badges SET revoked_at=NULL WHERE person_id=target AND badge_code=v.code AND rule_version=v.rule_version AND period=q.period;action:='restored';END IF;
   ELSIF NOT q.qualifies AND a.person_id IS NOT NULL AND a.revoked_at IS NULL THEN
    UPDATE core.person_practice_badges SET revoked_at=observed WHERE person_id=target AND badge_code=v.code AND rule_version=v.rule_version AND period=q.period;action:='revoked';
   END IF;
   IF action IS NOT NULL THEN
    INSERT INTO audit.practice_badge_changes(person_id,badge_code,period,rule_version,action,created_at) VALUES(target,v.code,q.period,v.rule_version,action,observed);
    INSERT INTO audit.achievement_transitions(person_id,badge_code,period,rule_version,action,cause,request_id,created_at) VALUES(target,v.code,q.period,v.rule_version,action,cause,nullif(current_setting('qigong.request_id',TRUE),''),observed);
   END IF;
  END LOOP;
 END LOOP;
END$$;
REVOKE ALL ON FUNCTION core.evaluate_practice_badges(UUID),core._achievement_period_qualifies(UUID,TEXT,TEXT[],BOOLEAN,BOOLEAN,INTEGER,DATE,DATE,TEXT,TIMESTAMPTZ),core.achievement_qualifying_periods(UUID,TEXT,INTEGER,TIMESTAMPTZ) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION ops._achievement_next_due(input_person UUID,input_now TIMESTAMPTZ) RETURNS TIMESTAMPTZ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE zone TEXT;next_due TIMESTAMPTZ;v RECORD;s JSONB;zones TEXT[];deadline JSONB;
BEGIN
 SELECT practice_timezone INTO zone FROM identity.people WHERE id=input_person;
 next_due:=((input_now AT TIME ZONE zone)::date+1)::timestamp AT TIME ZONE zone;
 FOR v IN SELECT * FROM core.achievement_runtime_versions r WHERE NOT EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=r.candidate_id) LOOP
  IF (v.effective_date::timestamp AT TIME ZONE zone)>input_now THEN next_due:=least(next_due,v.effective_date::timestamp AT TIME ZONE zone);END IF;
  IF v.snapshot->'deadline'<>'null'::jsonb AND(v.snapshot->'deadline'->>'settlementAt')::timestamptz>input_now THEN next_due:=least(next_due,(v.snapshot->'deadline'->>'settlementAt')::timestamptz);END IF;
 END LOOP;
 SELECT array_agg(name ORDER BY name) INTO zones FROM pg_timezone_names WHERE name='UTC' OR(position('/' IN name)>0 AND name !~ '^(posix|right)/');
 FOR s IN SELECT season FROM core.achievement_rule_versions r CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'seasons') season WHERE r.provenance='legacy_snapshot' LOOP
  deadline:=admin._achievement_activity_deadline((s->>'end_date')::date,zones);IF(deadline->>'settlementAt')::timestamptz>input_now THEN next_due:=least(next_due,(deadline->>'settlementAt')::timestamptz);END IF;
 END LOOP;
 RETURN next_due;
END$$;
CREATE FUNCTION ops._evaluate_achievement_person(input_person UUID,input_force BOOLEAN) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job ops.practice_badge_jobs;observed TIMESTAMPTZ:=clock_timestamp();
BEGIN
 PERFORM 1 FROM identity.people p WHERE p.id=input_person AND p.status='active' FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO job FROM ops.practice_badge_jobs WHERE person_id=input_person FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;
 IF NOT input_force AND job.evaluated_generation>=job.dirty_generation THEN RETURN;END IF;
 PERFORM set_config('qigong.achievement_cause',CASE WHEN input_force THEN 'scheduled_reconciliation' ELSE 'committed_practice_change' END,TRUE);
 PERFORM core.evaluate_practice_badges(input_person);
 UPDATE ops.practice_badge_jobs SET evaluated_generation=job.dirty_generation,evaluated_at=clock_timestamp(),due_at=ops._achievement_next_due(input_person,observed) WHERE person_id=input_person;
END$$;
CREATE OR REPLACE FUNCTION ops.queue_practice_badges() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;practice UUID;
BEGIN
 IF TG_TABLE_NAME='checkins' THEN IF TG_OP='DELETE' THEN target:=OLD.person_id;practice:=OLD.id;ELSE target:=NEW.person_id;practice:=NEW.id;END IF;
 ELSE IF TG_OP='DELETE' THEN practice:=OLD.checkin_id;ELSE practice:=NEW.checkin_id;END IF;SELECT person_id INTO target FROM core.checkins WHERE id=practice;END IF;
 IF target IS NOT NULL THEN
  PERFORM 1 FROM identity.people WHERE id=target FOR UPDATE;
  INSERT INTO ops.practice_badge_jobs(person_id,due_at) VALUES(target,clock_timestamp()) ON CONFLICT(person_id) DO UPDATE SET due_at=clock_timestamp(),dirty_generation=practice_badge_jobs.dirty_generation+1;
  IF NOT(TG_TABLE_NAME='checkins' AND TG_OP='DELETE') THEN INSERT INTO platform.telegram_practice_versions(checkin_id) VALUES(practice) ON CONFLICT(checkin_id) DO UPDATE SET revision=telegram_practice_versions.revision+1;END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END$$;
CREATE TRIGGER practice_badges_methods_update AFTER UPDATE ON core.checkin_method_selections FOR EACH ROW EXECUTE FUNCTION ops.queue_practice_badges();
CREATE FUNCTION ops._deferred_achievement_evaluation() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;practice UUID;
BEGIN
 IF NOT ops.versioned_achievements_enabled() THEN RETURN NULL;END IF;
 IF TG_TABLE_NAME='checkins' THEN IF TG_OP='DELETE' THEN target:=OLD.person_id;ELSE target:=NEW.person_id;END IF;
 ELSE IF TG_OP='DELETE' THEN practice:=OLD.checkin_id;ELSE practice:=NEW.checkin_id;END IF;SELECT person_id INTO target FROM core.checkins WHERE id=practice;END IF;
 IF target IS NOT NULL THEN PERFORM ops._evaluate_achievement_person(target,FALSE);END IF;RETURN NULL;
END$$;
CREATE CONSTRAINT TRIGGER deferred_achievement_checkins AFTER INSERT OR UPDATE OR DELETE ON core.checkins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ops._deferred_achievement_evaluation();
CREATE CONSTRAINT TRIGGER deferred_achievement_methods AFTER INSERT OR UPDATE OR DELETE ON core.checkin_method_selections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ops._deferred_achievement_evaluation();
CREATE OR REPLACE FUNCTION ops.reconcile_practice_badges(batch_size INTEGER) RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;processed INTEGER:=0;
BEGIN
 IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid badge batch size';END IF;
 FOR target IN SELECT p.id FROM identity.people p JOIN ops.practice_badge_jobs j ON j.person_id=p.id WHERE p.status='active' AND j.due_at<=clock_timestamp() ORDER BY j.due_at,p.id LIMIT batch_size FOR UPDATE OF p SKIP LOCKED LOOP
  IF ops.versioned_achievements_enabled() THEN PERFORM ops._evaluate_achievement_person(target,TRUE);
  ELSE PERFORM 1 FROM ops.practice_badge_jobs WHERE person_id=target FOR UPDATE;PERFORM core._legacy_evaluate_practice_badges(target);UPDATE ops.practice_badge_jobs SET evaluated_at=clock_timestamp(),due_at=clock_timestamp()+INTERVAL '1 day' WHERE person_id=target;END IF;
  processed:=processed+1;
 END LOOP;RETURN processed;
END$$;
-- All workspace achievement report aliases become pure reads. Never evaluate from a GET/report.
DO $$DECLARE f RECORD;definition TEXT;BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='platform' AND p.proname LIKE '%workspace%report%' AND p.prokind='f' LOOP
  definition:=pg_get_functiondef(f.oid);
  IF position('PERFORM core.evaluate_practice_badges(target);' IN definition)>0 THEN EXECUTE replace(definition,'PERFORM core.evaluate_practice_badges(target);','-- Evaluation belongs to committed mutations/reconciliation, never a read.');END IF;
 END LOOP;
END$$;
-- Make already-started activated activity conditions immutable without changing old draft source bytes.
DO $$DECLARE definition TEXT;BEGIN
 definition:=pg_get_functiondef('admin.save_achievement_config_draft(uuid,integer,text,text,integer,jsonb,text)'::regprocedure);
 definition:=replace(definition,'PERFORM pg_advisory_xact_lock_shared(1919,1);','PERFORM pg_advisory_xact_lock_shared(1919,1); IF admin._achievement_conditions_locked(input_subject,input_code,input_year) THEN RAISE EXCEPTION ''achievement activity locked'' USING ERRCODE=''55000'';END IF;');EXECUTE definition;
 definition:=pg_get_functiondef('admin._achievement_publication_context(uuid)'::regprocedure);
 definition:=replace(definition,$old$WHEN admin._achievement_config_locked(row.subject,source) IS TRUE THEN 'activity_started'$old$,$new$WHEN admin._achievement_config_locked(row.subject,source) IS TRUE OR admin._achievement_conditions_locked(row.subject,row.code,row.year) THEN 'activity_started'$new$);EXECUTE definition;
 definition:=pg_get_functiondef('admin.achievement_config_draft(uuid)'::regprocedure);
 definition:=replace(definition,'coalesce(admin._achievement_config_locked(row.subject,source),false)','(coalesce(admin._achievement_config_locked(row.subject,source),false) OR admin._achievement_conditions_locked(row.subject,row.code,row.year))');EXECUTE definition;
END$$;
REVOKE ALL ON FUNCTION ops._achievement_next_due(UUID,TIMESTAMPTZ),ops._evaluate_achievement_person(UUID,BOOLEAN),ops._deferred_achievement_evaluation() FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;

CREATE FUNCTION core._achievement_runtime_definition(input_code TEXT,input_version INTEGER,input_locale TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row core.achievement_runtime_versions;cfg JSONB;d JSONB;kind TEXT;methods JSONB;seasons JSONB:='[]';state TEXT;name TEXT;
BEGIN
 SELECT * INTO row FROM core.achievement_runtime_versions v WHERE v.code=input_code AND v.rule_version=input_version;IF NOT FOUND THEN RETURN NULL;END IF;
 cfg:=row.snapshot->'config';d:=row.snapshot->'baseConfig'->'definition';kind:=CASE WHEN row.subject IN('event','challenge') THEN row.subject ELSE d->>'kind' END;
 name:=CASE WHEN input_locale='en' THEN coalesce(nullif(cfg->>'nameEn',''),cfg->>'nameZhTw') WHEN input_locale='zh_CN' THEN coalesce(nullif(cfg->>'nameZhCn',''),cfg->>'nameZhTw') ELSE cfg->>'nameZhTw' END;
 methods:=coalesce(cfg->'methodCodes','[]'::jsonb);IF kind='winter' THEN methods:='["guishou_bagua","guishou_qiankun","guishou_fengxiang_guishuo"]'::jsonb;END IF;
 IF row.subject='activity' THEN seasons:=jsonb_build_array(jsonb_build_object('year',row.year,'startDate',cfg->>'startDate','endDate',cfg->>'endDate','timezone',cfg->>'timezone','requiredDays',(cfg->>'requiredDays')::integer));END IF;
 state:=CASE WHEN EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=row.candidate_id) THEN 'cancelled' WHEN row.earliest_start_at>clock_timestamp() THEN 'scheduled' ELSE 'published' END;
 RETURN jsonb_build_object('code',row.code,'ruleVersion',row.rule_version,'name',name,'kind',kind,'threshold',coalesce((cfg->>'threshold')::integer,(cfg->>'requiredDays')::integer),'methodCodes',methods,'seasons',seasons,'configured',state<>'cancelled','configurationKnown',true,
  'provenance','published_snapshot','continuous',coalesce((cfg->>'continuous')::boolean,FALSE),'methodMatch',coalesce(cfg->>'methodMatch','any'),'effectiveDate',row.effective_date,'progressStartDate',CASE WHEN cfg->>'startMode'='date' THEN cfg->>'startDate' ELSE row.effective_date::text END,'startDate',cfg->>'startDate','endDate',cfg->>'endDate','activationState',state);
END$$;
DO $$DECLARE definition TEXT;BEGIN
 definition:=pg_get_functiondef('admin._achievement_version_definition(text,integer,text)'::regprocedure);
 definition:=replace(definition,'DECLARE row core.achievement_rule_versions;','DECLARE runtime_meta JSONB;row core.achievement_rule_versions;');
 definition:=replace(definition,' SELECT * INTO row FROM core.achievement_rule_versions',E' runtime_meta:=core._achievement_runtime_definition(input_code,input_version,input_locale);IF runtime_meta IS NOT NULL THEN RETURN runtime_meta;END IF;\n SELECT * INTO row FROM core.achievement_rule_versions');EXECUTE definition;
END$$;
CREATE OR REPLACE FUNCTION admin._achievement_version_select(input_code TEXT,input_version INTEGER,input_region UUID,input_platform TEXT,input_query TEXT) RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE selected INTEGER;
BEGIN
 PERFORM 1 FROM admin._achievement_people(input_region,input_platform,input_query);
 IF input_code IS NULL OR char_length(input_code)>80 OR input_version IS NOT NULL AND input_version<1 THEN RAISE EXCEPTION 'invalid achievement query' USING ERRCODE='22023';END IF;
 SELECT coalesce(input_version,(SELECT r.rule_version FROM core.achievement_runtime_versions r WHERE r.code=i.code AND NOT EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=r.candidate_id) ORDER BY r.effective_date DESC,r.rule_version DESC LIMIT 1),
 (SELECT r.rule_version FROM core.achievement_runtime_versions r WHERE r.code=i.code ORDER BY r.rule_version DESC LIMIT 1),(SELECT d.rule_version FROM core.practice_badge_definitions d WHERE d.code=i.code),(SELECT max(v.rule_version) FROM core.achievement_rule_versions v WHERE v.badge_code=i.code AND v.provenance='legacy_snapshot')) INTO selected FROM core.achievement_badge_identities i WHERE i.code=input_code;
 IF selected IS NULL OR NOT(EXISTS(SELECT 1 FROM core.achievement_rule_versions v WHERE v.badge_code=input_code AND v.rule_version=selected AND v.provenance='legacy_snapshot') OR EXISTS(SELECT 1 FROM core.achievement_runtime_versions v WHERE v.code=input_code AND v.rule_version=selected) OR EXISTS(SELECT 1 FROM core.person_practice_badges b JOIN admin._achievement_people(input_region,input_platform,input_query) p ON p.person_id=b.person_id WHERE b.badge_code=input_code AND b.rule_version=selected)) THEN RAISE EXCEPTION 'achievement unavailable' USING ERRCODE='P0002';END IF;
 RETURN selected;
END$$;
CREATE OR REPLACE FUNCTION admin.achievement_version_catalog(input_locale TEXT,input_region UUID,input_platform TEXT,input_query TEXT,input_year INTEGER) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE base JSONB;i RECORD;selected INTEGER;meta JSONB;options JSONB;recipients INTEGER;periods JSONB;result JSONB:='[]';
BEGIN
 base:=admin.achievement_catalog(input_locale,input_region,input_platform,input_query,input_year);
 FOR i IN SELECT code FROM core.achievement_badge_identities ORDER BY code LOOP
  selected:=admin._achievement_version_select(i.code,NULL,input_region,input_platform,input_query);meta:=admin._achievement_version_definition(i.code,selected,input_locale);
  WITH visible AS MATERIALIZED(SELECT * FROM admin._achievement_people(input_region,input_platform,input_query)),versions AS(
   SELECT v.rule_version FROM core.achievement_rule_versions v WHERE v.badge_code=i.code AND v.provenance='legacy_snapshot'
   UNION SELECT v.rule_version FROM core.achievement_runtime_versions v WHERE v.code=i.code
   UNION SELECT b.rule_version FROM core.person_practice_badges b JOIN visible owner ON owner.person_id=b.person_id WHERE b.badge_code=i.code),
  definitions AS(SELECT v.rule_version,admin._achievement_version_definition(i.code,v.rule_version,input_locale) data FROM versions v)
  SELECT coalesce(jsonb_agg(d.data||jsonb_build_object('isCurrent',d.rule_version=selected,'recipientCount',(SELECT count(DISTINCT b.person_id) FROM core.person_practice_badges b JOIN visible owner ON owner.person_id=b.person_id WHERE b.badge_code=i.code AND b.rule_version=d.rule_version AND b.revoked_at IS NULL AND(input_year IS NULL OR d.data->>'kind' NOT IN('summer','winter') OR b.period=input_year::text))) ORDER BY d.rule_version DESC),'[]') INTO options FROM definitions d;
  SELECT count(DISTINCT b.person_id)::integer INTO recipients FROM core.person_practice_badges b JOIN admin._achievement_people(input_region,input_platform,input_query) owner ON owner.person_id=b.person_id WHERE b.badge_code=i.code AND b.rule_version=selected AND b.revoked_at IS NULL AND(input_year IS NULL OR meta->>'kind' NOT IN('summer','winter') OR b.period=input_year::text);
  SELECT coalesce(jsonb_agg(jsonb_build_object('period',p.period,'recipientCount',p.n) ORDER BY p.period),'[]') INTO periods FROM(SELECT b.period,count(DISTINCT b.person_id) n FROM core.person_practice_badges b JOIN admin._achievement_people(input_region,input_platform,input_query) owner ON owner.person_id=b.person_id WHERE b.badge_code=i.code AND b.rule_version=selected AND b.revoked_at IS NULL AND(input_year IS NULL OR meta->>'kind' NOT IN('summer','winter') OR b.period=input_year::text) GROUP BY b.period) p;
  result:=result||jsonb_build_array(meta||jsonb_build_object('versions',options,'recipientCount',recipients,'periods',periods));
 END LOOP;RETURN base||jsonb_build_object('badges',result,'versioned',true);
END$$;
CREATE OR REPLACE FUNCTION platform._achievement_version_badges(input_person UUID,input_locale TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH owner AS(SELECT practice_timezone,(clock_timestamp() AT TIME ZONE practice_timezone)::date anchor FROM identity.people WHERE id=input_person),
 current_versions AS(SELECT i.code,coalesce((SELECT v.rule_version FROM core.achievement_runtime_versions v,owner WHERE v.code=i.code AND v.effective_date<=owner.anchor AND NOT EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=v.candidate_id) ORDER BY v.effective_date DESC,v.rule_version DESC LIMIT 1),(SELECT d.rule_version FROM core.practice_badge_definitions d WHERE d.code=i.code)) rule_version FROM core.achievement_badge_identities i),
 versions AS(SELECT code,rule_version FROM current_versions WHERE rule_version IS NOT NULL UNION SELECT b.badge_code,b.rule_version FROM core.person_practice_badges b WHERE b.person_id=input_person
 UNION SELECT v.code,v.rule_version FROM core.achievement_runtime_versions v,owner WHERE v.effective_date>owner.anchor AND NOT EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=v.candidate_id)),
 definitions AS(SELECT v.code,v.rule_version,admin._achievement_version_definition(v.code,v.rule_version,input_locale) data FROM versions v)
 SELECT coalesce(jsonb_agg(d.data||jsonb_build_object('awards',coalesce((SELECT jsonb_agg(jsonb_build_object('period',b.period,'earnedAt',b.earned_at,'revoked',b.revoked_at IS NOT NULL) ORDER BY b.period) FROM core.person_practice_badges b WHERE b.person_id=input_person AND b.badge_code=d.code AND b.rule_version=d.rule_version),'[]')) ORDER BY d.code,d.rule_version DESC),'[]') FROM definitions d
$$;
-- New version metadata names are explicit publisher translations, never automatic UI conversion.
DO $$DECLARE n TEXT;definition TEXT;BEGIN
 FOREACH n IN ARRAY ARRAY['admin.achievement_version_export_preview(text,text,uuid,text,text,integer,integer)','admin.prepare_achievement_version_export(text,text,uuid,text,text,integer,text,integer)'] LOOP
  definition:=pg_get_functiondef(n::regprocedure);definition:=replace(definition,$old$'ruleVersion',selected,'count'$old$,$new$'ruleVersion',selected,'provenance',meta->>'provenance','count'$new$);EXECUTE definition;
 END LOOP;
END$$;
REVOKE ALL ON FUNCTION core._achievement_runtime_definition(TEXT,INTEGER,TEXT) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;

CREATE FUNCTION ops._achievement_timezone_dirty() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 INSERT INTO ops.practice_badge_jobs(person_id,due_at) VALUES(NEW.id,clock_timestamp()) ON CONFLICT(person_id) DO UPDATE SET due_at=clock_timestamp(),dirty_generation=practice_badge_jobs.dirty_generation+1;RETURN NEW;
END$$;
CREATE FUNCTION ops._deferred_achievement_timezone() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF ops.versioned_achievements_enabled() THEN PERFORM ops._evaluate_achievement_person(NEW.id,FALSE);END IF;RETURN NULL;
END$$;
CREATE TRIGGER achievement_timezone_dirty AFTER UPDATE OF practice_timezone ON identity.people FOR EACH ROW WHEN(OLD.practice_timezone IS DISTINCT FROM NEW.practice_timezone) EXECUTE FUNCTION ops._achievement_timezone_dirty();
CREATE CONSTRAINT TRIGGER deferred_achievement_timezone AFTER UPDATE ON identity.people DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(OLD.practice_timezone IS DISTINCT FROM NEW.practice_timezone) EXECUTE FUNCTION ops._deferred_achievement_timezone();
DO $$DECLARE definition TEXT;BEGIN
 definition:=pg_get_functiondef('admin.achievement_publication_candidate(uuid)'::regprocedure);
 definition:=replace(definition,$old$'stale',draft.state$old$,$new$'activation',(SELECT jsonb_build_object('registered',true,'cancelled',EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=v.candidate_id),'state',CASE WHEN EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=v.candidate_id) THEN 'cancelled' WHEN v.earliest_start_at>clock_timestamp() THEN 'scheduled' ELSE 'published' END) FROM core.achievement_runtime_versions v WHERE v.candidate_id=row.id),'stale',draft.state$new$);EXECUTE definition;
 definition:=pg_get_functiondef('admin.achievement_management_catalog()'::regprocedure);
 definition:=replace(definition,$old$'canPublish',false$old$,$new$'canPublish',admin.can_activate_achievement_now()$new$);EXECUTE definition;
END$$;
REVOKE ALL ON FUNCTION ops._achievement_timezone_dirty(),ops._deferred_achievement_timezone() FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;

CREATE FUNCTION admin._runtime_achievement_draft_source(input_subject TEXT,input_code TEXT,input_year INTEGER) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('definition',to_jsonb(d)||jsonb_build_object('rule_version',v.rule_version,'name_zh_tw',v.snapshot->'config'->>'nameZhTw','name_en',coalesce(nullif(v.snapshot->'config'->>'nameEn',''),v.snapshot->'config'->>'nameZhTw'),'name_zh_cn',coalesce(nullif(v.snapshot->'config'->>'nameZhCn',''),v.snapshot->'config'->>'nameZhTw'),'provenance','published_snapshot','threshold',coalesce((v.snapshot->'config'->>'threshold')::integer,(v.snapshot->'config'->>'requiredDays')::integer),'method_codes',coalesce(v.snapshot->'config'->'methodCodes',to_jsonb(d.method_codes))),
 'season',CASE WHEN input_subject='activity' THEN jsonb_build_object('kind',d.kind,'year',v.year,'start_date',v.snapshot->'config'->>'startDate','end_date',v.snapshot->'config'->>'endDate','timezone',v.snapshot->'config'->>'timezone','required_days',(v.snapshot->'config'->>'requiredDays')::integer) ELSE 'null'::jsonb END)
 FROM core.practice_badge_definitions d JOIN LATERAL(SELECT * FROM core.achievement_runtime_versions r WHERE r.code=d.code AND r.subject=input_subject AND(input_subject<>'activity' OR r.year=input_year) AND NOT EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=r.candidate_id) ORDER BY r.effective_date DESC,r.rule_version DESC LIMIT 1) v ON TRUE
 WHERE d.code=input_code AND input_subject IN('rule','activity')
$$;
DO $$DECLARE definition TEXT;BEGIN
 definition:=pg_get_functiondef('admin._achievement_config_source(text,text,integer)'::regprocedure);
 definition:=replace(definition,'DECLARE definition core.practice_badge_definitions;','DECLARE published JSONB;definition core.practice_badge_definitions;');
 definition:=replace(definition,' SELECT * INTO definition FROM core.practice_badge_definitions',E' published:=admin._runtime_achievement_draft_source(input_subject,input_code,input_year);IF published IS NOT NULL THEN RETURN published;END IF;\n SELECT * INTO definition FROM core.practice_badge_definitions');EXECUTE definition;
 definition:=pg_get_functiondef('admin.achievement_management_catalog()'::regprocedure);
 definition:=replace(definition,' RETURN result;',$replacebody$ SELECT jsonb_set(result,'{definitions}',coalesce(jsonb_agg(coalesce(admin._runtime_achievement_draft_source('rule',d.code,NULL)->'definition',to_jsonb(d)) ORDER BY d.sort_order,d.code),'[]'::jsonb)) INTO result FROM core.practice_badge_definitions d;
 RETURN result;$replacebody$);EXECUTE definition;
END$$;
REVOKE ALL ON FUNCTION admin._runtime_achievement_draft_source(TEXT,TEXT,INTEGER) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;

CREATE FUNCTION admin._runtime_achievement_seasons() RETURNS SETOF JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH published AS(SELECT DISTINCT ON(v.snapshot->'baseConfig'->'definition'->>'kind',v.year) v.snapshot->'baseConfig'->'definition'->>'kind' kind,v.year,v.snapshot->'config' cfg FROM core.achievement_runtime_versions v WHERE v.subject='activity' AND NOT EXISTS(SELECT 1 FROM core.achievement_activation_cancellations c WHERE c.candidate_id=v.candidate_id) ORDER BY v.snapshot->'baseConfig'->'definition'->>'kind',v.year,v.effective_date DESC,v.rule_version DESC)
 SELECT to_jsonb(s) FROM core.practice_badge_seasons s WHERE NOT EXISTS(SELECT 1 FROM published v WHERE v.kind=s.kind AND v.year=s.year)
 UNION ALL SELECT jsonb_build_object('kind',p.kind,'year',p.year,'start_date',p.cfg->>'startDate','end_date',p.cfg->>'endDate','timezone',p.cfg->>'timezone','required_days',(p.cfg->>'requiredDays')::integer) FROM published p
$$;
DO $$DECLARE definition TEXT;BEGIN
 definition:=pg_get_functiondef('admin.achievement_management_catalog()'::regprocedure);
 definition:=replace(definition,' RETURN result;',$body$ SELECT jsonb_set(result,'{seasons}',coalesce(jsonb_agg(s ORDER BY s->>'year' DESC,s->>'kind'),'[]'::jsonb)) INTO result FROM admin._runtime_achievement_seasons() s;
 RETURN result;$body$);EXECUTE definition;
END$$;
REVOKE ALL ON FUNCTION admin._runtime_achievement_seasons() FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;


DO $$DECLARE definition TEXT;BEGIN
 definition:=pg_get_functiondef('admin.achievement_publication_candidate(uuid)'::regprocedure);
 definition:=replace(definition,$old$'stale',draft.state<>'draft' OR draft.revision<>row.draft_revision OR source_hash<>row.source_hash$old$,$new$'stale',(draft.state<>'draft' OR draft.revision<>row.draft_revision OR source_hash<>row.source_hash) AND NOT EXISTS(SELECT 1 FROM core.achievement_runtime_versions r WHERE r.candidate_id=row.id)$new$);EXECUTE definition;
END$$;
