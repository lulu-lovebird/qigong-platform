-- 0062_venue_attendance_badges.sql
-- Physical venue attendance badges: milestones (venue_total), streaks (venue_streak), and activities (venue_activity).
-- Integrates with existing core.practice_badge_definitions, core.person_practice_badges, and evaluation pipeline.

-- 1. Extend kind check constraint on core.practice_badge_definitions
ALTER TABLE core.practice_badge_definitions DROP CONSTRAINT IF EXISTS practice_badge_definitions_kind_check;
ALTER TABLE core.practice_badge_definitions ADD CONSTRAINT practice_badge_definitions_kind_check
  CHECK (kind = ANY (ARRAY[
    'streak'::text, 'total'::text, 'morning'::text, 'night'::text, 'combo'::text, 'method'::text, 'summer'::text, 'winter'::text,
    'venue_total'::text, 'venue_streak'::text, 'venue_activity'::text
  ]));

-- 2. Create core.venue_badge_activities for time-bound / regional venue campaigns
CREATE TABLE IF NOT EXISTS core.venue_badge_activities (
  badge_code TEXT NOT NULL REFERENCES core.practice_badge_definitions(code),
  period TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
  required_days INTEGER NOT NULL CHECK (required_days > 0),
  region_id UUID REFERENCES core.regions(id),
  field_id UUID REFERENCES core.practice_fields(id),
  PRIMARY KEY (badge_code, period),
  CHECK (end_date >= start_date)
);

ALTER TABLE core.venue_badge_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.venue_badge_activities FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.venue_badge_activities FROM PUBLIC;
GRANT SELECT ON core.venue_badge_activities TO qigong_api_runtime, qigong_worker_runtime;

DROP POLICY IF EXISTS venue_badge_activities_reader ON core.venue_badge_activities;
CREATE POLICY venue_badge_activities_reader ON core.venue_badge_activities FOR SELECT USING (true);

-- 3. Seed venue attendance badge definitions
INSERT INTO core.practice_badge_definitions(code, kind, name_zh_tw, name_en, threshold, sort_order) VALUES
  ('venue_first_step', 'venue_total', '團練首到', 'First Field Practice', 1, 3001),
  ('venue_total_5', 'venue_total', '團練精進 · 伍', 'Field Practice · 5 Days', 5, 3005),
  ('venue_total_10', 'venue_total', '團練精進 · 拾', 'Field Practice · 10 Days', 10, 3010),
  ('venue_total_25', 'venue_total', '團練精進 · 廿五', 'Field Practice · 25 Days', 25, 3025),
  ('venue_total_50', 'venue_total', '團練大師 · 五十', 'Field Master · 50 Days', 50, 3050),
  ('venue_total_100', 'venue_total', '團練百場達人', 'Centurion of Field Practice', 100, 3100)
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.achievement_badge_identities(code, origin) VALUES
  ('venue_first_step', 'legacy'),
  ('venue_total_5', 'legacy'),
  ('venue_total_10', 'legacy'),
  ('venue_total_25', 'legacy'),
  ('venue_total_50', 'legacy'),
  ('venue_total_100', 'legacy')
ON CONFLICT (code) DO NOTHING;

-- Register initial frozen metadata snapshot in core.achievement_rule_versions
INSERT INTO core.achievement_rule_versions(badge_code, rule_version, provenance, snapshot, source_hash)
SELECT d.code, d.rule_version, 'legacy_snapshot', s.data, encode(public.digest(s.data::text, 'sha256'), 'hex')
FROM core.practice_badge_definitions d
CROSS JOIN LATERAL (
  SELECT jsonb_build_object(
    'definition', to_jsonb(d),
    'seasons', coalesce((SELECT jsonb_agg(to_jsonb(y) ORDER BY y.year) FROM core.practice_badge_seasons y WHERE y.kind = d.kind), '[]'::jsonb)
  ) AS data
) s
WHERE d.code IN ('venue_first_step', 'venue_total_5', 'venue_total_10', 'venue_total_25', 'venue_total_50', 'venue_total_100')
ON CONFLICT (badge_code, rule_version) DO NOTHING;

-- 4. Update core.evaluate_practice_badges to support venue_total and venue_activity
CREATE OR REPLACE FUNCTION core.evaluate_practice_badges(target UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE zone TEXT; anchor DATE; metrics JSONB; definition RECORD; candidate RECORD; act RECORD;
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
      WHEN 'venue_total' THEN
        SELECT count(DISTINCT attendance_date) INTO count_days
        FROM core.field_attendance
        WHERE person_id=target AND NOT is_test;
        IF count_days>=definition.threshold THEN periods:=ARRAY['lifetime']; END IF;
      WHEN 'venue_activity' THEN
        FOR act IN SELECT * FROM core.venue_badge_activities WHERE badge_code=definition.code LOOP
          SELECT count(DISTINCT a.attendance_date) INTO count_days
          FROM core.field_attendance a
          WHERE a.person_id=target AND NOT a.is_test
            AND a.attendance_date BETWEEN act.start_date AND act.end_date
            AND (act.field_id IS NULL OR a.field_id=act.field_id)
            AND (act.region_id IS NULL OR EXISTS (
              SELECT 1 FROM core.practice_fields f WHERE f.id=a.field_id AND f.region_id=act.region_id
            ));
          IF count_days>=act.required_days THEN periods:=array_append(periods,act.period); END IF;
        END LOOP;
      ELSE
        -- Unknown or unimplemented badge kind; preserve existing periods
        NULL;
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

-- 5. Trigger on core.field_attendance to schedule badge evaluation upon verified check-in
CREATE OR REPLACE FUNCTION ops.queue_venue_practice_badges() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT NEW.is_test THEN
    PERFORM 1 FROM identity.people WHERE id = NEW.person_id FOR UPDATE;
    INSERT INTO ops.practice_badge_jobs(person_id, due_at)
    VALUES(NEW.person_id, clock_timestamp())
    ON CONFLICT(person_id) DO UPDATE SET
      due_at = clock_timestamp(),
      dirty_generation = ops.practice_badge_jobs.dirty_generation + 1;
    IF ops.versioned_achievements_enabled() THEN
      PERFORM ops._evaluate_achievement_person(NEW.person_id, FALSE);
    ELSE
      PERFORM core.evaluate_practice_badges(NEW.person_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ops.queue_venue_practice_badges() FROM PUBLIC;

DROP TRIGGER IF EXISTS queue_venue_attendance_badges ON core.field_attendance;
CREATE TRIGGER queue_venue_attendance_badges
  AFTER INSERT ON core.field_attendance
  FOR EACH ROW EXECUTE FUNCTION ops.queue_venue_practice_badges();
