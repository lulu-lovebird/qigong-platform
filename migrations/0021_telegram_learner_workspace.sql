-- Learner-only workspace. No implicit linking, public journals, provider activation,
-- direct runtime table access, or guessed seasonal dates.
CREATE TABLE platform.telegram_workspace_preferences (
  person_id UUID PRIMARY KEY REFERENCES identity.people(id),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  timezone_changed_at TIMESTAMPTZ
);
CREATE TABLE platform.telegram_practice_versions (
  checkin_id UUID PRIMARY KEY REFERENCES core.checkins(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
);
CREATE TABLE ops.telegram_practice_requests (
  identity_id UUID NOT NULL REFERENCES identity.platform_identities(id),
  request_id UUID NOT NULL,
  payload_hash BYTEA NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(identity_id,request_id)
);
CREATE TABLE ops.telegram_practice_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id UUID NOT NULL REFERENCES identity.platform_identities(id),
  person_id UUID NOT NULL REFERENCES identity.people(id),
  checkin_id UUID NOT NULL REFERENCES core.checkins(id),
  recipient TEXT NOT NULL CHECK (recipient ~ '^[0-9]{1,20}$'),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','delivered','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_id UUID,
  leased_until TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((lease_id IS NULL) = (leased_until IS NULL))
);
CREATE INDEX telegram_receipts_pending_idx ON ops.telegram_practice_receipts(available_at,created_at)
  WHERE status IN ('pending','sending');

CREATE TABLE core.practice_badge_definitions (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('streak','total','morning','night','combo','method','summer','winter')),
  name_zh_tw TEXT NOT NULL,
  name_en TEXT NOT NULL,
  threshold INTEGER NOT NULL CHECK (threshold > 0),
  method_codes TEXT[] NOT NULL DEFAULT '{}',
  rule_version INTEGER NOT NULL DEFAULT 1 CHECK (rule_version > 0),
  sort_order INTEGER NOT NULL
);
CREATE TABLE core.practice_badge_seasons (
  kind TEXT NOT NULL CHECK (kind IN ('summer','winter')),
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2200),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  timezone TEXT NOT NULL,
  required_days INTEGER NOT NULL CHECK (required_days > 0),
  PRIMARY KEY(kind,year),
  CHECK (end_date >= start_date AND end_date-start_date+1 >= required_days)
);
CREATE TABLE core.person_practice_badges (
  person_id UUID NOT NULL REFERENCES identity.people(id),
  badge_code TEXT NOT NULL REFERENCES core.practice_badge_definitions(code),
  period TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY(person_id,badge_code,period,rule_version)
);
CREATE TABLE ops.practice_badge_jobs (
  person_id UUID PRIMARY KEY REFERENCES identity.people(id),
  due_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  evaluated_at TIMESTAMPTZ
);
CREATE TABLE audit.practice_badge_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES identity.people(id),
  badge_code TEXT NOT NULL,
  period TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('earned','revoked','restored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX practice_badge_jobs_due_idx ON ops.practice_badge_jobs(due_at,person_id);

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'platform.telegram_workspace_preferences','platform.telegram_practice_versions',
    'ops.telegram_practice_requests','ops.telegram_practice_receipts',
    'core.practice_badge_definitions','core.practice_badge_seasons','core.person_practice_badges',
    'ops.practice_badge_jobs','audit.practice_badge_changes'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON %s FROM PUBLIC',table_name);
  END LOOP;
END;
$$;

INSERT INTO core.practice_badge_definitions(code,kind,name_zh_tw,name_en,threshold,sort_order)
SELECT 'streak_'||n,'streak','連續練功 '||n||' 天',n||'-day practice streak',n,n FROM unnest(ARRAY[3,7,21,100]) n;
INSERT INTO core.practice_badge_definitions(code,kind,name_zh_tw,name_en,threshold,sort_order)
SELECT 'total_'||n,'total','累計練功 '||n||' 天',n||' practice days',n,200+n FROM unnest(ARRAY[10,100]) n;
INSERT INTO core.practice_badge_definitions(code,kind,name_zh_tw,name_en,threshold,sort_order) VALUES
  ('time_morning','morning','晨光修練','Morning practice',5,401),
  ('time_night','night','月下修練','Night practice',5,402),
  ('seasonal_summer','summer','三伏修練','Summer practice',27,501),
  ('seasonal_winter','winter','冬至龜壽功','Winter Guishou practice',27,502);
-- Immutable v1 mappings: adding a new taxonomy leaf must NOT rewrite old rules.
INSERT INTO core.practice_badge_definitions(code,kind,name_zh_tw,name_en,threshold,method_codes,sort_order)
SELECT 'method_'||g.code||'_'||n,'method',g.zh||' '||n||' 天',g.en||' · '||n||' days',n,g.leaves,600+g.position*100+n
FROM (VALUES
 ('dayan','大雁功','Dayan',ARRAY['dayan_chu','dayan_gao'],1),
 ('wuqinxi','五禽戲','Wuqinxi',ARRAY['wuqinxi_he','wuqinxi_yuan','wuqinxi_hu','wuqinxi_xiong','wuqinxi_lu'],2),
 ('huichun','回春功','Huichun',ARRAY['huichun_chu','huichun_zhong'],3),
 ('guishou','龜壽功','Guishou',ARRAY['guishou_bagua','guishou_qiankun','guishou_fengxiang_guishuo'],4),
 ('zhengyang','正陽功','Zhengyang',ARRAY['zhengyang_morning','zhengyang_night'],5),
 ('huanghai','神奇晃海功','Swaying Sea',ARRAY['huanghai'],6),
 ('lotus','蓮花養心法','Lotus',ARRAY['lotus'],7),
 ('heqi','和氣舒壓法','Heqi',ARRAY['heqi'],8),
 ('sanwo','三窩功','Sanwo',ARRAY['sanwo'],9),
 ('liuyin','六音理臟法','Liuyin',ARRAY['liuyin'],10),
 ('jinggong','靜功','Quiet practice',ARRAY['jinggong_zhoutian','jinggong_qixing','jinggong_songjing'],11)
) g(code,zh,en,leaves,position) CROSS JOIN unnest(ARRAY[7,30,100]) n;
INSERT INTO core.practice_badge_definitions(code,kind,name_zh_tw,name_en,threshold,method_codes,sort_order)
SELECT replace(code,'method_','combo_')::text,'combo',replace(name_zh_tw,' 7 天','全套'),replace(name_en,' · 7 days',' · complete set'),1,method_codes,sort_order+2000
FROM core.practice_badge_definitions WHERE kind='method' AND threshold=7
  AND cardinality(method_codes)>1;

CREATE FUNCTION core.practice_metrics(target UUID,anchor DATE) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  WITH days AS (
    SELECT practice_date,practice_date-row_number() OVER(ORDER BY practice_date)::integer AS island
    FROM core.checkins WHERE person_id=target AND practice_date<=anchor
  ), runs AS (SELECT count(*)::integer size,max(practice_date) last_day FROM days GROUP BY island)
  SELECT jsonb_build_object('totalDays',(SELECT count(*) FROM days),
    'currentStreak',coalesce((SELECT size FROM runs WHERE last_day>=anchor-1 ORDER BY last_day DESC LIMIT 1),0),
    'longestStreak',coalesce((SELECT max(size) FROM runs),0),'lastDate',(SELECT max(practice_date)::text FROM days))
$$;

CREATE FUNCTION ops.queue_practice_badges() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; practice UUID;
BEGIN
  IF TG_TABLE_NAME='checkins' THEN
    IF TG_OP='DELETE' THEN target:=OLD.person_id; practice:=OLD.id;
    ELSE target:=NEW.person_id; practice:=NEW.id; END IF;
  ELSE
    IF TG_OP='DELETE' THEN practice:=OLD.checkin_id; ELSE practice:=NEW.checkin_id; END IF;
    SELECT person_id INTO target FROM core.checkins WHERE id=practice;
  END IF;
  IF target IS NOT NULL THEN
    INSERT INTO ops.practice_badge_jobs(person_id) VALUES(target)
      ON CONFLICT(person_id) DO UPDATE SET due_at=CURRENT_TIMESTAMP;
    IF NOT (TG_TABLE_NAME='checkins' AND TG_OP='DELETE') THEN
      INSERT INTO platform.telegram_practice_versions(checkin_id) VALUES(practice)
        ON CONFLICT(checkin_id) DO UPDATE SET revision=telegram_practice_versions.revision+1;
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER practice_badges_checkin AFTER INSERT OR UPDATE OR DELETE ON core.checkins
  FOR EACH ROW EXECUTE FUNCTION ops.queue_practice_badges();
CREATE TRIGGER practice_badges_methods AFTER INSERT OR DELETE ON core.checkin_method_selections
  FOR EACH ROW EXECUTE FUNCTION ops.queue_practice_badges();
INSERT INTO ops.practice_badge_jobs(person_id) SELECT id FROM identity.people;

CREATE FUNCTION core.evaluate_practice_badges(target UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE zone TEXT; anchor DATE; metrics JSONB; definition RECORD; candidate RECORD;
DECLARE qualifies BOOLEAN; periods TEXT[]; award RECORD; changed TEXT; count_days INTEGER;
BEGIN
  SELECT practice_timezone INTO zone FROM identity.people WHERE id=target FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  anchor:=(CURRENT_TIMESTAMP AT TIME ZONE zone)::date;
  metrics:=core.practice_metrics(target,anchor);
  FOR definition IN SELECT * FROM core.practice_badge_definitions ORDER BY code LOOP
    periods:='{}';
    CASE definition.kind
      WHEN 'streak' THEN
        IF (metrics->>'longestStreak')::integer>=definition.threshold THEN periods:=ARRAY['lifetime']; END IF;
      WHEN 'total' THEN
        IF (metrics->>'totalDays')::integer>=definition.threshold THEN periods:=ARRAY['lifetime']; END IF;
      WHEN 'method' THEN
        SELECT count(DISTINCT c.practice_date) INTO count_days FROM core.checkins c
          JOIN core.checkin_method_selections s ON s.checkin_id=c.id
          JOIN core.practice_methods m ON m.id=s.practice_method_id
          WHERE c.person_id=target AND c.practice_date<=anchor AND m.code=ANY(definition.method_codes);
        IF count_days>=definition.threshold THEN periods:=ARRAY['lifetime']; END IF;
      WHEN 'combo' THEN
        SELECT coalesce(array_agg(DISTINCT extract(year FROM c.practice_date)::integer::text),'{}') INTO periods
        FROM core.checkins c WHERE c.person_id=target AND c.practice_date<=anchor
          AND NOT EXISTS(SELECT 1 FROM unnest(definition.method_codes) AS required(method_code)
            WHERE NOT EXISTS(SELECT 1 FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id
              WHERE s.checkin_id=c.id AND m.code=required.method_code));
      WHEN 'morning','night' THEN
        SELECT EXISTS(SELECT 1 FROM (
          SELECT c.practice_date-row_number() OVER(ORDER BY c.practice_date)::integer AS island
          FROM core.checkins c WHERE c.person_id=target AND c.practice_date<=anchor AND c.entry_kind='regular'
            AND (c.created_at AT TIME ZONE c.practice_timezone)::time >=
              CASE WHEN definition.kind='morning' THEN TIME '05:00' ELSE TIME '21:00' END
            AND (c.created_at AT TIME ZONE c.practice_timezone)::time <
              CASE WHEN definition.kind='morning' THEN TIME '07:00' ELSE TIME '23:00' END
        ) d GROUP BY island HAVING count(*)>=definition.threshold) INTO qualifies;
        IF qualifies THEN periods:=ARRAY['lifetime']; END IF;
      WHEN 'summer','winter' THEN
        FOR candidate IN SELECT * FROM core.practice_badge_seasons WHERE kind=definition.kind
          AND end_date<=(CURRENT_TIMESTAMP AT TIME ZONE timezone)::date LOOP
          SELECT count(*) INTO count_days FROM core.checkins c WHERE c.person_id=target
            AND c.practice_date BETWEEN candidate.start_date AND candidate.end_date
            AND (definition.kind='summer' OR EXISTS(SELECT 1 FROM core.checkin_method_selections s
              JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=c.id
                AND m.code=ANY(ARRAY['guishou_bagua','guishou_qiankun','guishou_fengxiang_guishuo'])));
          IF count_days>=candidate.required_days THEN periods:=array_append(periods,candidate.year::text); END IF;
        END LOOP;
    END CASE;
    FOR award IN SELECT * FROM core.person_practice_badges WHERE person_id=target AND badge_code=definition.code
      AND rule_version=definition.rule_version AND revoked_at IS NULL AND NOT(period=ANY(periods)) FOR UPDATE LOOP
      UPDATE core.person_practice_badges SET revoked_at=CURRENT_TIMESTAMP WHERE person_id=target
        AND badge_code=award.badge_code AND period=award.period AND rule_version=award.rule_version;
      INSERT INTO audit.practice_badge_changes(person_id,badge_code,period,rule_version,action)
        VALUES(target,award.badge_code,award.period,award.rule_version,'revoked');
    END LOOP;
    FOREACH changed IN ARRAY periods LOOP
      SELECT * INTO award FROM core.person_practice_badges WHERE person_id=target AND badge_code=definition.code
        AND period=changed AND rule_version=definition.rule_version;
      IF NOT FOUND THEN
        INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version)
          VALUES(target,definition.code,changed,definition.rule_version);
        INSERT INTO audit.practice_badge_changes(person_id,badge_code,period,rule_version,action)
          VALUES(target,definition.code,changed,definition.rule_version,'earned');
      ELSIF award.revoked_at IS NOT NULL THEN
        UPDATE core.person_practice_badges SET revoked_at=NULL WHERE person_id=target AND badge_code=definition.code
          AND period=changed AND rule_version=definition.rule_version;
        INSERT INTO audit.practice_badge_changes(person_id,badge_code,period,rule_version,action)
          VALUES(target,definition.code,changed,definition.rule_version,'restored');
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE FUNCTION ops.reconcile_practice_badges(batch_size INTEGER) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; processed INTEGER:=0;
BEGIN
  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid badge batch size'; END IF;
  -- Person -> job lock order matches writes. SKIP LOCKED never delays a learner.
  FOR target IN SELECT p.id FROM identity.people p JOIN ops.practice_badge_jobs j ON j.person_id=p.id
    WHERE j.due_at<=CURRENT_TIMESTAMP AND p.status='active' ORDER BY j.due_at,p.id
    LIMIT batch_size FOR UPDATE OF p SKIP LOCKED LOOP
    PERFORM 1 FROM ops.practice_badge_jobs WHERE person_id=target FOR UPDATE;
    PERFORM core.evaluate_practice_badges(target);
    UPDATE ops.practice_badge_jobs SET evaluated_at=CURRENT_TIMESTAMP,due_at=CURRENT_TIMESTAMP+INTERVAL '1 day' WHERE person_id=target;
    processed:=processed+1;
  END LOOP;
  RETURN processed;
END;
$$;

CREATE FUNCTION platform.telegram_workspace_timezone(input_token TEXT,input_zone TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; old_zone TEXT; last_change TIMESTAMPTZ; now_time TIMESTAMPTZ:=clock_timestamp();
BEGIN
  target:=platform.practice_person('telegram',input_token);
  SELECT practice_timezone INTO old_zone FROM identity.people WHERE id=target FOR UPDATE;
  IF platform.telegram_checkin_person(input_token) IS DISTINCT FROM target OR NOT EXISTS(
    SELECT 1 FROM platform.telegram_checkin_links WHERE token_hash=public.digest(input_token,'sha256') AND expires_at>clock_timestamp())
  THEN RAISE EXCEPTION 'practice identity unavailable'; END IF;
  now_time:=clock_timestamp();
  IF input_zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=input_zone)
    OR length(input_zone)>100 THEN RAISE EXCEPTION 'invalid workspace timezone'; END IF;
  SELECT timezone_changed_at INTO last_change FROM platform.telegram_workspace_preferences WHERE person_id=target;
  IF old_zone<>input_zone THEN
    IF last_change>now_time-INTERVAL '24 hours' THEN RAISE EXCEPTION 'workspace timezone cooldown'; END IF;
    IF EXISTS(SELECT 1 FROM core.checkins WHERE person_id=target)
      OR EXISTS(SELECT 1 FROM platform.telegram_workspace_preferences WHERE person_id=target) THEN
      IF (now_time AT TIME ZONE old_zone)::date<>(now_time AT TIME ZONE input_zone)::date
        OR ((now_time AT TIME ZONE old_zone)::time<TIME '12:00')<>((now_time AT TIME ZONE input_zone)::time<TIME '12:00')
      THEN RAISE EXCEPTION 'workspace timezone window differs'; END IF;
    END IF;
    UPDATE identity.people SET practice_timezone=input_zone WHERE id=target;
  END IF;
  INSERT INTO platform.telegram_workspace_preferences(person_id,timezone_changed_at)
    VALUES(target,CASE WHEN old_zone<>input_zone THEN now_time ELSE NULL END)
    ON CONFLICT(person_id) DO UPDATE SET timezone_changed_at=CASE WHEN old_zone<>input_zone THEN now_time ELSE telegram_workspace_preferences.timezone_changed_at END;
END;
$$;

CREATE FUNCTION platform.telegram_workspace_entries(target UUID,start_day DATE,end_day DATE,input_locale TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'date',c.practice_date::text,'kind',c.entry_kind,'timezone',c.practice_timezone,
    'version',coalesce(v.revision,0),'methods',(SELECT coalesce(jsonb_agg(jsonb_build_object('code',m.code,
      'name',CASE WHEN input_locale='en' THEN m.name_en ELSE m.name_zh_tw END,
      'group',CASE WHEN input_locale='en' THEN coalesce(p.name_en,m.name_en) ELSE coalesce(p.name_zh_tw,m.name_zh_tw) END) ORDER BY m.sort_order,m.code),'[]')
      FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id LEFT JOIN core.practice_methods p ON p.id=m.parent_id WHERE s.checkin_id=c.id),
    'practiceNote',coalesce(n.practice_note,''),'feelingTags',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.tag_id,
      'name',CASE WHEN input_locale='en' THEN t.name_en ELSE t.name_zh_tw END) ORDER BY t.sort_order,t.tag_id),'[]') FROM core.checkin_note_tags t WHERE t.checkin_id=c.id)
    ) ORDER BY c.practice_date DESC),'[]')
  FROM core.checkins c LEFT JOIN core.checkin_notes n ON n.checkin_id=c.id
    LEFT JOIN platform.telegram_practice_versions v ON v.checkin_id=c.id
  WHERE c.person_id=target AND c.practice_date>=start_day AND c.practice_date<end_day
$$;

CREATE FUNCTION platform.telegram_workspace_report(input_token TEXT,input_view TEXT,input_locale TEXT,input_period TEXT DEFAULT 'month',input_days INTEGER DEFAULT 30,input_month DATE DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; zone TEXT; anchor DATE; start_day DATE; end_day DATE; result JSONB; metrics JSONB; region UUID;
BEGIN
  target:=platform.practice_person('telegram',input_token);
  IF input_locale IS NULL OR input_locale NOT IN ('zh_TW','en') THEN RAISE EXCEPTION 'invalid workspace query'; END IF;
  SELECT practice_timezone INTO zone FROM identity.people WHERE id=target;
  anchor:=(CURRENT_TIMESTAMP AT TIME ZONE zone)::date;
  metrics:=core.practice_metrics(target,anchor);
  CASE input_view
    WHEN 'profile' THEN
      RETURN metrics||jsonb_build_object('today',anchor::text,'timezone',zone,
        'confirmed',EXISTS(SELECT 1 FROM platform.telegram_workspace_preferences WHERE person_id=target),
        'makeupOpen',(CURRENT_TIMESTAMP AT TIME ZONE zone)::time<TIME '12:00',
        'entries',platform.telegram_workspace_entries(target,anchor-13,anchor+1,input_locale),
        'feelingTags',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',CASE WHEN input_locale='en' THEN name_en ELSE name_zh_tw END) ORDER BY sort_order,id),'[]') FROM core.practice_feeling_tags WHERE active),
        'methods',(SELECT coalesce(jsonb_agg(jsonb_build_object('code',m.code,'name',CASE WHEN input_locale='en' THEN m.name_en ELSE m.name_zh_tw END,
          'groupCode',coalesce(p.code,m.code),'group',CASE WHEN input_locale='en' THEN coalesce(p.name_en,m.name_en) ELSE coalesce(p.name_zh_tw,m.name_zh_tw) END)
          ORDER BY coalesce(p.sort_order,m.sort_order),m.sort_order,m.code),'[]') FROM core.practice_methods m LEFT JOIN core.practice_methods p ON p.id=m.parent_id
          WHERE m.active AND m.method_type='leaf' AND NOT EXISTS(SELECT 1 FROM core.practice_method_platforms a WHERE a.practice_method_id=m.id AND a.platform='telegram' AND NOT a.available)));
    WHEN 'history' THEN
      IF input_month IS NULL OR input_month<DATE '2000-01-01' OR input_month>anchor THEN RAISE EXCEPTION 'invalid workspace query'; END IF;
      start_day:=date_trunc('month',input_month)::date; end_day:=(start_day+INTERVAL '1 month')::date;
      RETURN jsonb_build_object('month',to_char(start_day,'YYYY-MM'),'entries',platform.telegram_workspace_entries(target,start_day,end_day,input_locale));
    WHEN 'methods' THEN
      IF input_days IS NULL OR input_days NOT IN (30,90) THEN RAISE EXCEPTION 'invalid workspace query'; END IF;
      start_day:=anchor-input_days+1;
      SELECT coalesce(jsonb_agg(to_jsonb(item) ORDER BY item.days DESC,item.code),'[]') INTO result FROM (
        SELECT coalesce(p.code,m.code) code,CASE WHEN input_locale='en' THEN coalesce(p.name_en,m.name_en) ELSE coalesce(p.name_zh_tw,m.name_zh_tw) END name,
          count(DISTINCT c.practice_date)::integer days
        FROM core.checkins c JOIN core.checkin_method_selections s ON s.checkin_id=c.id
          JOIN core.practice_methods m ON m.id=s.practice_method_id LEFT JOIN core.practice_methods p ON p.id=m.parent_id
        WHERE c.person_id=target AND c.practice_date BETWEEN start_day AND anchor GROUP BY coalesce(p.code,m.code),2
      ) item;
      RETURN jsonb_build_object('days',input_days,'start',start_day::text,'end',anchor::text,'mix',result,
        'entries',platform.telegram_workspace_entries(target,anchor-13,anchor+1,input_locale));
    WHEN 'leaderboard' THEN
      IF input_period IS NULL OR input_period NOT IN ('week','month','quarter','year','all') THEN RAISE EXCEPTION 'invalid workspace query'; END IF;
      start_day:=CASE WHEN input_period='all' THEN DATE '2000-01-01' ELSE date_trunc(input_period,anchor::timestamp)::date END;
      SELECT region_id INTO region FROM core.person_region_assignments WHERE person_id=target AND assignment_type='primary'
        AND valid_from<=anchor AND (valid_to IS NULL OR valid_to>anchor);
      IF region IS NULL THEN RAISE EXCEPTION 'workspace region unavailable'; END IF;
      WITH eligible AS (
        SELECT DISTINCT p.id FROM identity.people p JOIN core.person_region_assignments a ON a.person_id=p.id
        WHERE p.status='active' AND a.region_id=region AND a.assignment_type='primary' AND a.valid_from<=anchor AND (a.valid_to IS NULL OR a.valid_to>anchor)
          AND EXISTS(SELECT 1 FROM identity.platform_identities i JOIN identity.person_interaction_channels ch ON ch.platform_identity_id=i.id AND ch.person_id=i.person_id
            JOIN identity.onboarding_applications ap ON ap.person_id=i.person_id AND ap.platform='telegram' AND ap.external_subject_id=i.external_subject_id AND ap.status='approved'
            WHERE i.person_id=p.id AND i.platform='telegram' AND i.revoked_at IS NULL AND ch.valid_from<=CURRENT_TIMESTAMP AND ch.valid_to IS NULL)
      ), counts AS (
        SELECT e.id,count(c.id)::integer days FROM eligible e JOIN core.checkins c ON c.person_id=e.id
          AND c.practice_date BETWEEN start_day AND anchor GROUP BY e.id
      ), ranked AS (SELECT *,rank() OVER(ORDER BY days DESC)::integer position FROM counts)
      SELECT jsonb_build_object('period',input_period,'start',start_day::text,'end',anchor::text,
        'scope','same_region_masked','rows',coalesce((SELECT jsonb_agg(jsonb_build_object('rank',position,'days',days,'self',id=target,
          'label',CASE WHEN id=target THEN CASE WHEN input_locale='en' THEN 'You' ELSE '你' END
            ELSE CASE WHEN input_locale='en' THEN 'Learner ' ELSE '學員 ' END||left(encode(public.digest(id::text||region::text,'sha256'),'hex'),6) END) ORDER BY position,id)
          FROM (SELECT * FROM ranked ORDER BY position,id LIMIT 30) r),'[]'),
        'ownRank',(SELECT position FROM ranked WHERE id=target),'ownDays',coalesce((SELECT days FROM ranked WHERE id=target),0)) INTO result;
      RETURN result;
    WHEN 'achievements' THEN
      PERFORM core.evaluate_practice_badges(target);
      SELECT coalesce(jsonb_agg(jsonb_build_object('code',d.code,'kind',d.kind,'name',CASE WHEN input_locale='en' THEN d.name_en ELSE d.name_zh_tw END,
        'threshold',d.threshold,'ruleVersion',d.rule_version,
        'configured',CASE WHEN d.kind IN ('summer','winter') THEN EXISTS(SELECT 1 FROM core.practice_badge_seasons s WHERE s.kind=d.kind)
          ELSE NOT EXISTS(SELECT 1 FROM unnest(d.method_codes) AS required(method_code) WHERE NOT EXISTS(SELECT 1 FROM core.practice_methods m WHERE m.code=required.method_code)) END,
        'awards',(SELECT coalesce(jsonb_agg(jsonb_build_object('period',b.period,'earnedAt',b.earned_at,'revoked',b.revoked_at IS NOT NULL) ORDER BY b.period),'[]')
          FROM core.person_practice_badges b WHERE b.person_id=target AND b.badge_code=d.code AND b.rule_version=d.rule_version)) ORDER BY d.sort_order,d.code),'[]')
        INTO result FROM core.practice_badge_definitions d;
      RETURN metrics||jsonb_build_object('badges',result);
    ELSE RAISE EXCEPTION 'invalid workspace query';
  END CASE;
END;
$$;

CREATE FUNCTION platform.queue_telegram_practice_receipt(input_token TEXT,input_checkin UUID,input_action TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; ident UUID; recipient TEXT; practice core.checkins%ROWTYPE; payload JSONB; receipt UUID; locale TEXT;
BEGIN
  target:=platform.practice_person('telegram',input_token);
  IF input_action IS NULL OR input_action NOT IN ('regular','makeup','corrected') THEN RAISE EXCEPTION 'invalid receipt action'; END IF;
  SELECT * INTO practice FROM core.checkins WHERE id=input_checkin AND person_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'practice identity unavailable'; END IF;
  SELECT i.id,i.external_subject_id INTO ident,recipient FROM identity.platform_identities i
    JOIN platform.telegram_checkin_links l ON l.telegram_user_id=i.external_subject_id
    WHERE i.person_id=target AND i.platform='telegram' AND i.revoked_at IS NULL AND l.token_hash=public.digest(input_token,'sha256');
  locale:=platform.get_identity_locale('telegram',recipient);
  payload:=core.practice_metrics(target,(CURRENT_TIMESTAMP AT TIME ZONE practice.practice_timezone)::date)||jsonb_build_object(
    'date',practice.practice_date::text,'action',input_action,'locale',locale,
    'methods',(SELECT jsonb_agg(CASE WHEN locale='en' THEN m.name_en ELSE m.name_zh_tw END ORDER BY m.sort_order,m.code)
      FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=input_checkin));
  INSERT INTO ops.telegram_practice_receipts(identity_id,person_id,checkin_id,recipient,payload)
    VALUES(ident,target,input_checkin,recipient,payload) RETURNING id INTO receipt;
  RETURN receipt;
END;
$$;

CREATE FUNCTION platform.telegram_workspace_save(input_token TEXT,input_request UUID,input_date DATE,input_version INTEGER,input_methods TEXT[],input_note TEXT,input_tags UUID[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; ident UUID; practice UUID; actual_version INTEGER; anchor DATE; zone TEXT;
DECLARE old_request ops.telegram_practice_requests%ROWTYPE; fingerprint BYTEA; result JSONB; action TEXT;
BEGIN
  -- Same link -> person ordering as submit_telegram_checkin; recheck after waiting.
  PERFORM 1 FROM platform.telegram_checkin_links WHERE token_hash=public.digest(input_token,'sha256') FOR UPDATE;
  target:=platform.practice_person('telegram',input_token);
  SELECT practice_timezone INTO zone FROM identity.people WHERE id=target FOR UPDATE;
  IF platform.telegram_checkin_person(input_token) IS DISTINCT FROM target OR NOT EXISTS(
    SELECT 1 FROM platform.telegram_checkin_links WHERE token_hash=public.digest(input_token,'sha256') AND expires_at>clock_timestamp())
  THEN RAISE EXCEPTION 'practice identity unavailable'; END IF;
  SELECT i.id INTO ident FROM identity.platform_identities i JOIN platform.telegram_checkin_links l ON l.telegram_user_id=i.external_subject_id
    WHERE i.person_id=target AND i.platform='telegram' AND i.revoked_at IS NULL AND l.token_hash=public.digest(input_token,'sha256');
  IF input_request IS NULL OR input_date IS NULL OR input_version IS NULL OR input_version<0 THEN RAISE EXCEPTION 'invalid workspace save'; END IF;
  fingerprint:=public.digest(jsonb_build_array(input_date,input_version,input_methods,input_note,input_tags)::text,'sha256');
  SELECT * INTO old_request FROM ops.telegram_practice_requests WHERE identity_id=ident AND request_id=input_request;
  IF FOUND THEN
    IF old_request.payload_hash<>fingerprint THEN RAISE EXCEPTION 'workspace request conflict' USING ERRCODE='40001'; END IF;
    RETURN old_request.result;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM platform.telegram_workspace_preferences WHERE person_id=target) THEN RAISE EXCEPTION 'workspace timezone unconfirmed'; END IF;
  -- Legacy submit/correct functions use the transaction timestamp. If waiting
  -- crosses local midnight, reject rather than silently save the previous day.
  anchor:=(CURRENT_TIMESTAMP AT TIME ZONE zone)::date;
  IF (clock_timestamp() AT TIME ZONE zone)::date<>anchor THEN RAISE EXCEPTION 'checkin correction unavailable'; END IF;
  IF input_date<>anchor AND (input_date<>anchor-1 OR (clock_timestamp() AT TIME ZONE zone)::time>=TIME '12:00')
    THEN RAISE EXCEPTION 'checkin correction unavailable'; END IF;
  SELECT id INTO practice FROM core.checkins WHERE person_id=target AND practice_date=input_date FOR UPDATE;
  IF practice IS NULL THEN
    IF input_version<>0 THEN RAISE EXCEPTION 'workspace version conflict' USING ERRCODE='40001'; END IF;
    UPDATE platform.telegram_checkin_links SET used_at=NULL WHERE token_hash=public.digest(input_token,'sha256');
    SELECT checkin_id,entry_kind INTO practice,action FROM platform.submit_telegram_checkin(input_token,input_methods,input_date=anchor-1);
    UPDATE platform.telegram_checkin_links SET used_at=NULL WHERE token_hash=public.digest(input_token,'sha256');
  ELSE
    SELECT coalesce((SELECT revision FROM platform.telegram_practice_versions WHERE checkin_id=practice),0) INTO actual_version;
    IF actual_version<>input_version THEN RAISE EXCEPTION 'workspace version conflict' USING ERRCODE='40001'; END IF;
    PERFORM platform.correct_telegram_checkin(input_token,practice,input_methods);
    action:='corrected';
  END IF;
  PERFORM platform.save_practice_note('telegram',input_token,practice,input_note,input_tags);
  PERFORM platform.queue_telegram_practice_receipt(input_token,practice,action);
  SELECT revision INTO actual_version FROM platform.telegram_practice_versions WHERE checkin_id=practice;
  result:=jsonb_build_object('checkinId',practice,'version',actual_version,'action',action,'receiptQueued',true);
  INSERT INTO ops.telegram_practice_requests(identity_id,request_id,payload_hash,result) VALUES(ident,input_request,fingerprint,result);
  RETURN result;
END;
$$;

CREATE FUNCTION ops.claim_telegram_practice_receipts(batch_size INTEGER)
RETURNS TABLE(id UUID,lease_id UUID,recipient TEXT,payload JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid receipt batch size'; END IF;
  UPDATE ops.telegram_practice_receipts r SET status='failed',lease_id=NULL,leased_until=NULL,last_error='retry limit reached'
    WHERE status='sending' AND attempts>=8 AND leased_until<CURRENT_TIMESTAMP;
  UPDATE ops.telegram_practice_receipts r SET status='cancelled',lease_id=NULL,leased_until=NULL
    WHERE status IN ('pending','sending') AND NOT EXISTS(SELECT 1 FROM identity.platform_identities i
      JOIN identity.people p ON p.id=i.person_id JOIN identity.person_interaction_channels ch ON ch.platform_identity_id=i.id AND ch.person_id=i.person_id
      JOIN identity.onboarding_applications ap ON ap.person_id=i.person_id AND ap.platform='telegram' AND ap.external_subject_id=i.external_subject_id AND ap.status='approved'
      WHERE i.id=r.identity_id AND i.person_id=r.person_id AND i.revoked_at IS NULL AND p.status='active'
        AND ch.valid_from<=CURRENT_TIMESTAMP AND ch.valid_to IS NULL);
  RETURN QUERY WITH selected AS (
    SELECT r.id FROM ops.telegram_practice_receipts r WHERE r.status IN ('pending','sending') AND r.attempts<8
      AND r.available_at<=CURRENT_TIMESTAMP AND (r.status='pending' OR r.leased_until<CURRENT_TIMESTAMP)
      ORDER BY r.available_at,r.created_at,r.id FOR UPDATE SKIP LOCKED LIMIT batch_size
  ) UPDATE ops.telegram_practice_receipts r SET status='sending',attempts=r.attempts+1,lease_id=gen_random_uuid(),leased_until=CURRENT_TIMESTAMP+INTERVAL '10 minutes'
    FROM selected WHERE r.id=selected.id RETURNING r.id,r.lease_id,r.recipient,r.payload;
END;
$$;
CREATE FUNCTION ops.telegram_practice_receipt_allowed(input_id UUID,input_lease UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM ops.telegram_practice_receipts r
    JOIN identity.platform_identities i ON i.id=r.identity_id AND i.person_id=r.person_id AND i.external_subject_id=r.recipient
    JOIN identity.people p ON p.id=i.person_id
    JOIN identity.person_interaction_channels ch ON ch.platform_identity_id=i.id AND ch.person_id=i.person_id
    JOIN identity.onboarding_applications ap ON ap.person_id=i.person_id AND ap.platform='telegram' AND ap.external_subject_id=i.external_subject_id AND ap.status='approved'
    WHERE r.id=input_id AND r.lease_id=input_lease AND r.status='sending' AND r.leased_until>CURRENT_TIMESTAMP
      AND i.platform='telegram' AND i.revoked_at IS NULL AND p.status='active' AND ch.valid_from<=CURRENT_TIMESTAMP AND ch.valid_to IS NULL)
$$;
CREATE FUNCTION ops.finish_telegram_practice_receipt(input_id UUID,input_lease UUID,input_delivered BOOLEAN)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE done UUID;
BEGIN
  IF input_delivered IS NULL THEN RAISE EXCEPTION 'receipt outcome required'; END IF;
  UPDATE ops.telegram_practice_receipts SET status=CASE WHEN input_delivered THEN 'delivered' WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,
    delivered_at=CASE WHEN input_delivered THEN CURRENT_TIMESTAMP ELSE NULL END,
    available_at=CURRENT_TIMESTAMP+LEAST(3600,30*power(2,LEAST(attempts-1,7)))*INTERVAL '1 second',
    lease_id=NULL,leased_until=NULL,last_error=CASE WHEN input_delivered THEN NULL ELSE 'Telegram delivery failed' END
    WHERE id=input_id AND lease_id=input_lease AND status='sending' AND leased_until>CURRENT_TIMESTAMP RETURNING id INTO done;
  RETURN done IS NOT NULL;
END;
$$;

CREATE FUNCTION ops.telegram_workspace_schema_ready() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT max(version)='0021_telegram_learner_workspace.sql' FROM public.schema_migrations
$$;

-- Definer helpers are INTERNAL. Only the small credential-bound facade is callable.
DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='platform' AND (p.proname LIKE 'telegram_workspace_%' OR p.proname='queue_telegram_practice_receipt'))
      OR (n.nspname='core' AND p.proname IN ('practice_metrics','evaluate_practice_badges'))
      OR (n.nspname='ops' AND p.proname IN ('queue_practice_badges','reconcile_practice_badges','claim_telegram_practice_receipts','finish_telegram_practice_receipt','telegram_practice_receipt_allowed','telegram_workspace_schema_ready'))
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn.signature); END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION platform.telegram_workspace_timezone(TEXT,TEXT),
  platform.telegram_workspace_report(TEXT,TEXT,TEXT,TEXT,INTEGER,DATE),
  platform.telegram_workspace_save(TEXT,UUID,DATE,INTEGER,TEXT[],TEXT,UUID[]),
  platform.queue_telegram_practice_receipt(TEXT,UUID,TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION ops.telegram_workspace_schema_ready(),ops.telegram_practice_receipt_allowed(UUID,UUID),ops.reconcile_practice_badges(INTEGER),ops.claim_telegram_practice_receipts(INTEGER),
  ops.finish_telegram_practice_receipt(UUID,UUID,BOOLEAN) TO qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-6-telegram-learner-workspace',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
