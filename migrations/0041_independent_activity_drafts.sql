-- Independent activity badges are private drafts, never seasonal revisions or active awards.
-- Deployed 0001–0040 remain unchanged. Existing draft identities/source hashes are preserved.
DO $$
DECLARE constraint_name TEXT;found_count INTEGER:=0;
BEGIN
 FOR constraint_name IN SELECT conname FROM pg_constraint WHERE conrelid='admin.achievement_config_drafts'::regclass AND contype='c' AND (SELECT attnum FROM pg_attribute WHERE attrelid='admin.achievement_config_drafts'::regclass AND attname='subject')=ANY(conkey) LOOP
  EXECUTE format('ALTER TABLE admin.achievement_config_drafts DROP CONSTRAINT %I',constraint_name);found_count:=found_count+1;
 END LOOP;
 IF found_count<>2 THEN RAISE EXCEPTION 'unexpected achievement draft constraints';END IF;
END$$;
ALTER TABLE admin.achievement_config_drafts ADD CONSTRAINT achievement_draft_subject_check CHECK(subject IN('activity','rule','challenge','event'));
ALTER TABLE admin.achievement_config_drafts ADD CONSTRAINT achievement_draft_identity_check CHECK(
 (subject='activity' AND year IS NOT NULL AND definition_code IS NOT NULL AND definition_code=code AND code IN('seasonal_summer','seasonal_winter'))
 OR(subject='rule' AND year IS NULL AND definition_code IS NOT NULL AND definition_code=code AND code NOT IN('seasonal_summer','seasonal_winter'))
 OR(subject='challenge' AND year IS NULL AND definition_code IS NULL AND code ~ '^challenge_[a-f0-9]{32}$')
 OR(subject='event' AND year IS NULL AND definition_code IS NULL AND code ~ '^event_[a-f0-9]{32}$'));
CREATE UNIQUE INDEX achievement_event_draft_code_idx ON admin.achievement_config_drafts(code) WHERE subject='event';

CREATE OR REPLACE FUNCTION admin._achievement_config_source(input_subject TEXT,input_code TEXT,input_year INTEGER) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE definition core.practice_badge_definitions;season JSONB;
BEGIN
 IF input_subject IS NULL OR input_subject NOT IN('activity','rule','challenge','event') OR input_code IS NULL THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
 IF input_subject='event' THEN
  IF input_code !~ '^event_[a-f0-9]{32}$' OR input_year IS NOT NULL THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('definition',NULL,'season',NULL);
 END IF;
 IF input_subject='challenge' THEN
  IF input_code !~ '^challenge_[a-f0-9]{32}$' OR input_year IS NOT NULL THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
  RETURN jsonb_build_object('definition',NULL,'season',NULL);
 END IF;
 SELECT * INTO definition FROM core.practice_badge_definitions WHERE code=input_code;
 IF NOT FOUND THEN RAISE EXCEPTION 'achievement configuration unavailable' USING ERRCODE='P0002';END IF;
 IF input_subject='activity' AND definition.kind IN('summer','winter') AND input_year BETWEEN 2000 AND 2200 THEN
  SELECT to_jsonb(s) INTO season FROM core.practice_badge_seasons s WHERE s.kind=definition.kind AND s.year=input_year;
 ELSIF input_subject<>'rule' OR definition.kind IN('summer','winter') OR input_year IS NOT NULL THEN
  RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';
 END IF;
 RETURN jsonb_build_object('definition',to_jsonb(definition),'season',season);
END$$;

CREATE OR REPLACE FUNCTION admin._achievement_config_validate(input_subject TEXT,input_code TEXT,input_year INTEGER,input_config JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source JSONB;kind TEXT;k TEXT;effective DATE;start_day DATE;end_day DATE;threshold INTEGER;codes TEXT[];required TEXT[];
BEGIN
 source:=admin._achievement_config_source(input_subject,input_code,input_year);kind:=CASE WHEN input_subject='challenge' THEN 'challenge' ELSE source->'definition'->>'kind' END;
 IF input_config IS NULL OR jsonb_typeof(input_config)<>'object' OR octet_length(input_config::text)>16384 THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
 required:=ARRAY['nameZhTw','nameZhCn','nameEn','description','effectiveDate']||CASE WHEN input_subject IN('activity','event') THEN ARRAY['startDate','endDate','timezone','requiredDays'] ELSE ARRAY['threshold','methodCodes']||CASE WHEN input_subject='challenge' THEN ARRAY['continuous','methodMatch','startMode','startDate'] ELSE '{}'::text[] END END;
 IF (SELECT count(*) FROM jsonb_object_keys(input_config))<>cardinality(required) OR NOT input_config ?& required THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['nameZhTw','nameZhCn','nameEn','description','effectiveDate'] LOOP
  IF jsonb_typeof(input_config->k)<>'string' THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
 END LOOP;
 IF char_length(btrim(input_config->>'nameZhTw')) NOT BETWEEN 1 AND 160 OR char_length(input_config->>'nameZhCn')>160 OR char_length(input_config->>'nameEn')>160 OR char_length(input_config->>'description')>2000
 OR (input_config->>'effectiveDate') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
 effective:=(input_config->>'effectiveDate')::date;
 IF effective NOT BETWEEN DATE '2000-01-01' AND DATE '2201-12-31' THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
 IF input_subject IN('activity','event') THEN
  IF jsonb_typeof(input_config->'startDate')<>'string' OR jsonb_typeof(input_config->'endDate')<>'string' OR jsonb_typeof(input_config->'timezone')<>'string'
   OR (input_config->>'startDate') !~ '^\d{4}-\d{2}-\d{2}$' OR (input_config->>'endDate') !~ '^\d{4}-\d{2}-\d{2}$'
   OR jsonb_typeof(input_config->'requiredDays')<>'number' OR (input_config->>'requiredDays') !~ '^\d{1,4}$' THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
  start_day:=(input_config->>'startDate')::date;end_day:=(input_config->>'endDate')::date;threshold:=(input_config->>'requiredDays')::integer;
  IF start_day<>effective OR end_day<start_day OR end_day-start_day>366 OR end_day>DATE '2201-12-31' OR threshold NOT BETWEEN 1 AND end_day-start_day+1
   OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=input_config->>'timezone' AND(name='UTC' OR(position('/' IN name)>0 AND name !~ '^(posix|right)/'))) THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
 ELSE
  IF jsonb_typeof(input_config->'threshold')<>'number' OR (input_config->>'threshold') !~ '^\d{1,5}$' OR jsonb_typeof(input_config->'methodCodes')<>'array' OR jsonb_array_length(input_config->'methodCodes')>100
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(input_config->'methodCodes') v WHERE jsonb_typeof(v)<>'string') THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
  threshold:=(input_config->>'threshold')::integer;SELECT coalesce(array_agg(v ORDER BY v),'{}') INTO codes FROM jsonb_array_elements_text(input_config->'methodCodes') v;
  IF threshold NOT BETWEEN 1 AND 10000 OR cardinality(codes)<>(SELECT count(DISTINCT v) FROM unnest(codes) v)
   OR(kind='combo' AND threshold<>1) OR(kind IN('method','combo','challenge') AND cardinality(codes)=0) OR(kind NOT IN('method','combo','challenge') AND cardinality(codes)>0)
   OR EXISTS(SELECT 1 FROM unnest(codes) AS requested(code) WHERE NOT EXISTS(SELECT 1 FROM core.practice_methods m WHERE m.code=requested.code AND m.method_type='leaf' AND NOT EXISTS(SELECT 1 FROM core.practice_methods child WHERE child.parent_id=m.id))) THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
  IF input_subject='challenge' THEN
   IF jsonb_typeof(input_config->'continuous')<>'boolean' OR jsonb_typeof(input_config->'methodMatch')<>'string' OR input_config->>'methodMatch' NOT IN('any','all')
    OR jsonb_typeof(input_config->'startMode')<>'string' OR input_config->>'startMode' NOT IN('effective','date') THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
   IF input_config->>'startMode'='effective' THEN
    IF input_config->'startDate'<>'null'::jsonb THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
   ELSE
    IF jsonb_typeof(input_config->'startDate')<>'string' OR (input_config->>'startDate') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
    start_day:=(input_config->>'startDate')::date;
    IF start_day<effective OR start_day>DATE '2201-12-31' THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
   END IF;
  END IF;
  input_config:=jsonb_set(input_config,'{methodCodes}',to_jsonb(codes));
 END IF;
 RETURN input_config;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';
END$$;

CREATE OR REPLACE FUNCTION admin.save_achievement_config_draft(input_id UUID,input_revision INTEGER,input_subject TEXT,input_code TEXT,input_year INTEGER,input_config JSONB,input_reason TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row admin.achievement_config_drafts;source JSONB;normalized JSONB;actor UUID;event TEXT;
BEGIN
 IF admin.can_manage_achievement_drafts_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement management denied' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock_shared(1919,1);
 IF admin.can_manage_achievement_drafts_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement management denied' USING ERRCODE='42501';END IF;
 IF input_reason IS NULL OR char_length(btrim(input_reason)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
 IF input_subject IN('challenge','event') AND input_id IS NULL THEN
  IF input_code IS NOT NULL THEN RAISE EXCEPTION 'invalid achievement configuration' USING ERRCODE='22023';END IF;
  input_code:=CASE WHEN input_subject='event' THEN 'event_' ELSE 'challenge_' END||replace(gen_random_uuid()::text,'-','');
 END IF;
 source:=admin._achievement_config_source(input_subject,input_code,input_year);normalized:=admin._achievement_config_validate(input_subject,input_code,input_year,input_config);actor:=admin.request_principal_id();
 IF input_id IS NULL THEN
  IF input_revision IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'achievement draft conflict' USING ERRCODE='40001';END IF;
  IF admin._achievement_config_locked(input_subject,source) IS TRUE THEN RAISE EXCEPTION 'achievement activity locked' USING ERRCODE='55000';END IF;
  PERFORM pg_advisory_xact_lock(1940,1);
  IF admin.can_manage_achievement_drafts_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement management denied' USING ERRCODE='42501';END IF;
  source:=admin._achievement_config_source(input_subject,input_code,input_year);
  normalized:=admin._achievement_config_validate(input_subject,input_code,input_year,input_config);
  IF admin._achievement_config_locked(input_subject,source) IS TRUE THEN RAISE EXCEPTION 'achievement activity locked' USING ERRCODE='55000';END IF;
  IF (SELECT count(*) FROM admin.achievement_config_drafts WHERE state='draft')>=1000 THEN RAISE EXCEPTION 'achievement management capacity' USING ERRCODE='54000';END IF;
  INSERT INTO admin.achievement_config_drafts(subject,code,definition_code,year,config,base_config,base_hash,created_by,updated_by)
  VALUES(input_subject,input_code,CASE WHEN input_subject IN('challenge','event') THEN NULL ELSE input_code END,input_year,normalized,source,encode(public.digest(source::text,'sha256'),'hex'),actor,actor) RETURNING * INTO row;event:='created';
 ELSE
  SELECT * INTO row FROM admin.achievement_config_drafts WHERE id=input_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'achievement draft unavailable' USING ERRCODE='P0002';END IF;
  IF admin.can_manage_achievement_drafts_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement management denied' USING ERRCODE='42501';END IF;
  source:=admin._achievement_config_source(row.subject,row.code,row.year);
  IF row.state<>'draft' OR row.revision IS DISTINCT FROM input_revision OR row.subject IS DISTINCT FROM input_subject OR row.code IS DISTINCT FROM input_code OR row.year IS DISTINCT FROM input_year
   OR row.base_hash<>encode(public.digest(source::text,'sha256'),'hex') THEN RAISE EXCEPTION 'achievement draft conflict' USING ERRCODE='40001';END IF;
  IF admin._achievement_config_locked(row.subject,source) IS TRUE THEN RAISE EXCEPTION 'achievement activity locked' USING ERRCODE='55000';END IF;
  UPDATE admin.achievement_config_drafts SET config=normalized,revision=revision+1,updated_by=actor,updated_at=clock_timestamp() WHERE id=input_id RETURNING * INTO row;event:='updated';
 END IF;
 IF admin.can_manage_achievement_drafts_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement management denied' USING ERRCODE='42501';END IF;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,reason,outcome,metadata)
 VALUES(coalesce(admin.request_id(),gen_random_uuid()),actor,'achievement.draft_'||event,'achievement_draft',row.id::text,input_reason,'success',jsonb_build_object('subject',row.subject,'code',row.code,'year',row.year,'revision',row.revision,'baseHash',row.base_hash,'configHash',encode(public.digest(row.config::text,'sha256'),'hex')));
 RETURN admin.achievement_config_draft(row.id);
END$$;

CREATE OR REPLACE FUNCTION admin.compute_achievement_config_preview(input_id UUID,input_revision INTEGER) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE row admin.achievement_config_drafts;source JSONB;kind TEXT;effective DATE;ending DATE;required INTEGER;codes TEXT[];zones TEXT[];deadline JSONB;counts JSONB;observed TIMESTAMPTZ:=clock_timestamp();population INTEGER;
BEGIN
 IF admin.can_preview_achievement_drafts_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement management denied' USING ERRCODE='42501';END IF;
 SELECT * INTO row FROM admin.achievement_config_drafts WHERE id=input_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'achievement draft unavailable' USING ERRCODE='P0002';END IF;
 source:=admin._achievement_config_source(row.subject,row.code,row.year);
 IF row.state<>'draft' OR row.revision IS DISTINCT FROM input_revision OR row.base_hash<>encode(public.digest(source::text,'sha256'),'hex') THEN RAISE EXCEPTION 'achievement draft conflict' USING ERRCODE='40001';END IF;
 PERFORM admin._achievement_config_validate(row.subject,row.code,row.year,row.config);
 kind:=CASE WHEN row.subject='event' THEN 'event' WHEN row.subject='challenge' THEN CASE WHEN(row.config->>'continuous')::boolean THEN 'challenge_streak' ELSE 'challenge_total' END ELSE row.base_config->'definition'->>'kind' END;
 effective:=CASE WHEN row.subject='challenge' AND row.config->>'startMode'='date' THEN(row.config->>'startDate')::date ELSE(row.config->>'effectiveDate')::date END;
 SELECT count(*) INTO population FROM admin._achievement_people(NULL,NULL,'');IF population>5000 THEN RAISE EXCEPTION 'achievement management capacity' USING ERRCODE='54000';END IF;
 IF row.subject IN('activity','event') THEN
  ending:=(row.config->>'endDate')::date;required:=(row.config->>'requiredDays')::integer;
  codes:=CASE WHEN kind='winter' THEN ARRAY['guishou_bagua','guishou_qiankun','guishou_fengxiang_guishuo'] ELSE '{}' END;
  SELECT array_agg(name ORDER BY name) INTO zones FROM pg_timezone_names WHERE name='UTC' OR(position('/' IN name)>0 AND name !~ '^(posix|right)/');
  deadline:=admin._achievement_activity_deadline(ending,zones);
 ELSE
  required:=(row.config->>'threshold')::integer;SELECT coalesce(array_agg(v),'{}') INTO codes FROM jsonb_array_elements_text(row.config->'methodCodes') v;
 END IF;
 WITH visible AS MATERIALIZED(SELECT v.person_id,p.practice_timezone FROM admin._achievement_people(NULL,NULL,'') v JOIN identity.people p ON p.id=v.person_id),
 days AS MATERIALIZED(
  SELECT c.person_id,c.practice_date,c.entry_kind,c.created_at,c.practice_timezone,
   EXISTS(SELECT 1 FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=c.id AND m.code=ANY(codes)) any_method,
   NOT EXISTS(SELECT 1 FROM unnest(codes) required_code WHERE NOT EXISTS(SELECT 1 FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=c.id AND m.code=required_code)) all_methods
  FROM visible v JOIN core.checkins c ON c.person_id=v.person_id WHERE c.practice_date>=effective AND c.practice_date<=(observed AT TIME ZONE v.practice_timezone)::date
   AND(ending IS NULL OR c.practice_date<=ending)
 ), accepted AS MATERIALIZED(
  SELECT DISTINCT d.person_id,d.practice_date FROM days d WHERE
   kind IN('streak','total','summer','event') OR(row.subject='challenge' AND CASE WHEN row.config->>'methodMatch'='all' THEN d.all_methods ELSE d.any_method END) OR(kind IN('method','winter') AND d.any_method) OR(kind='combo' AND d.all_methods)
   OR(kind IN('morning','night') AND d.entry_kind='regular' AND(d.created_at AT TIME ZONE d.practice_timezone)::time>=CASE WHEN kind='morning' THEN TIME '05:00' ELSE TIME '21:00' END
     AND(d.created_at AT TIME ZONE d.practice_timezone)::time<CASE WHEN kind='morning' THEN TIME '07:00' ELSE TIME '23:00' END)
 ), islands AS(SELECT person_id,practice_date-row_number() OVER(PARTITION BY person_id ORDER BY practice_date)::integer island FROM accepted),
 qualifying AS(SELECT person_id FROM accepted GROUP BY person_id HAVING kind NOT IN('streak','morning','night','challenge_streak') AND count(*)>=required
  UNION SELECT person_id FROM islands WHERE kind IN('streak','morning','night','challenge_streak') GROUP BY person_id,island HAVING count(*)>=required),
 previous AS(SELECT DISTINCT b.person_id FROM core.person_practice_badges b JOIN visible v ON v.person_id=b.person_id WHERE b.badge_code=row.code AND b.rule_version=(row.base_config->'definition'->>'rule_version')::integer AND b.revoked_at IS NULL AND(row.year IS NULL OR b.period=row.year::text))
 SELECT jsonb_build_object('population',population,'currentlyAwarded',(SELECT count(*) FROM previous),'qualifyingAsOf',(SELECT count(DISTINCT person_id) FROM qualifying),
 'additionalQualifying',(SELECT count(DISTINCT q.person_id) FROM qualifying q WHERE NOT EXISTS(SELECT 1 FROM previous p WHERE p.person_id=q.person_id)),
 'existingAwardsPreserved',(SELECT count(*) FROM previous),'wouldRevoke',0) INTO counts;
 IF admin.can_preview_achievement_drafts_now() IS NOT TRUE THEN RAISE EXCEPTION 'achievement management denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('draftId',row.id,'revision',row.revision,'code',row.code,'subject',row.subject,'year',row.year,'configHash',encode(public.digest(row.config::text,'sha256'),'hex'),'baseHash',row.base_hash,
 'observedAt',observed,'expiresAt',observed+INTERVAL '10 minutes','effectiveDate',(row.config->>'effectiveDate')::date,'progressStartDate',effective,'counts',counts,'deadline',deadline,'awardableNow',CASE WHEN deadline IS NULL OR observed>=(deadline->>'settlementAt')::timestamptz THEN (counts->>'qualifyingAsOf')::integer ELSE 0 END,
 'publicationEnabled',false,'timezoneSnapshot',coalesce(to_jsonb(zones),'[]'));
END$$;

-- CREATE OR REPLACE retains the original owner/ACL/security/search_path contracts.
CREATE FUNCTION ops.achievement_event_drafts_schema_ready() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-26-independent-activity-drafts')$$;
REVOKE ALL ON FUNCTION ops.achievement_event_drafts_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.achievement_event_drafts_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-26-independent-activity-drafts',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
