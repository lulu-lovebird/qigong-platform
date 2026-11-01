-- 0062_venue_attendance_badges.sql
-- Physical venue attendance badges: milestones (venue_total), streaks (venue_streak), and activities (venue_activity).
-- Keeps core.practice_badge_definitions and core.achievement_badge_identities frozen for legacy online check-in taxonomy.
-- Venue badges are defined in core.venue_badge_definitions and awarded in core.person_venue_badges.

-- 1. Create core.venue_badge_definitions
CREATE TABLE IF NOT EXISTS core.venue_badge_definitions (
  code TEXT PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,79}$'),
  kind TEXT NOT NULL CHECK (kind IN ('venue_total', 'venue_streak', 'venue_activity')),
  name_zh_tw TEXT NOT NULL,
  name_en TEXT NOT NULL,
  threshold INTEGER NOT NULL CHECK (threshold > 0),
  rule_version INTEGER NOT NULL DEFAULT 1 CHECK (rule_version > 0),
  sort_order INTEGER NOT NULL
);

ALTER TABLE core.venue_badge_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.venue_badge_definitions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.venue_badge_definitions FROM PUBLIC;
GRANT SELECT ON core.venue_badge_definitions TO qigong_api_runtime, qigong_worker_runtime;

DROP POLICY IF EXISTS venue_badge_definitions_reader ON core.venue_badge_definitions;
CREATE POLICY venue_badge_definitions_reader ON core.venue_badge_definitions FOR SELECT USING (true);

-- 2. Create core.venue_badge_activities for time-bound / regional venue campaigns
CREATE TABLE IF NOT EXISTS core.venue_badge_activities (
  badge_code TEXT NOT NULL REFERENCES core.venue_badge_definitions(code),
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

-- 3. Create core.person_venue_badges
CREATE TABLE IF NOT EXISTS core.person_venue_badges (
  person_id UUID NOT NULL REFERENCES identity.people(id) ON DELETE CASCADE,
  badge_code TEXT NOT NULL REFERENCES core.venue_badge_definitions(code),
  period TEXT NOT NULL,
  rule_version INTEGER NOT NULL CHECK (rule_version > 0),
  earned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (person_id, badge_code, period, rule_version)
);

ALTER TABLE core.person_venue_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.person_venue_badges FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.person_venue_badges FROM PUBLIC;
GRANT SELECT ON core.person_venue_badges TO qigong_api_runtime, qigong_worker_runtime;

DROP POLICY IF EXISTS person_venue_badges_reader ON core.person_venue_badges;
CREATE POLICY person_venue_badges_reader ON core.person_venue_badges FOR SELECT USING (true);

-- 4. Create audit.venue_badge_changes
CREATE TABLE IF NOT EXISTS audit.venue_badge_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES identity.people(id) ON DELETE CASCADE,
  badge_code TEXT NOT NULL REFERENCES core.venue_badge_definitions(code),
  period TEXT NOT NULL,
  rule_version INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('earned', 'revoked', 'restored')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE audit.venue_badge_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.venue_badge_changes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON audit.venue_badge_changes FROM PUBLIC;

-- 5. Seed venue milestone badges in core.venue_badge_definitions
INSERT INTO core.venue_badge_definitions(code, kind, name_zh_tw, name_en, threshold, sort_order) VALUES
  ('venue_first_step', 'venue_total', '團練首到', 'First Field Practice', 1, 3001),
  ('venue_total_5', 'venue_total', '團練精進 · 伍', 'Field Practice · 5 Days', 5, 3005),
  ('venue_total_10', 'venue_total', '團練精進 · 拾', 'Field Practice · 10 Days', 10, 3010),
  ('venue_total_25', 'venue_total', '團練精進 · 廿五', 'Field Practice · 25 Days', 25, 3025),
  ('venue_total_50', 'venue_total', '團練大師 · 五十', 'Field Master · 50 Days', 50, 3050),
  ('venue_total_100', 'venue_total', '團練百場達人', 'Centurion of Field Practice', 100, 3100)
ON CONFLICT (code) DO NOTHING;

-- 6. Venue badge evaluation engine
CREATE OR REPLACE FUNCTION core.evaluate_venue_badges(target UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE definition RECORD; act RECORD;
DECLARE count_days INTEGER; periods TEXT[]; award RECORD; changed TEXT;
BEGIN
  PERFORM 1 FROM identity.people WHERE id = target AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  FOR definition IN SELECT * FROM core.venue_badge_definitions ORDER BY code LOOP
    periods := '{}';
    CASE definition.kind
      WHEN 'venue_total' THEN
        SELECT count(DISTINCT attendance_date) INTO count_days
        FROM core.field_attendance
        WHERE person_id = target AND NOT is_test;
        IF count_days >= definition.threshold THEN periods := ARRAY['lifetime']; END IF;
      WHEN 'venue_activity' THEN
        FOR act IN SELECT * FROM core.venue_badge_activities WHERE badge_code = definition.code LOOP
          SELECT count(DISTINCT a.attendance_date) INTO count_days
          FROM core.field_attendance a
          WHERE a.person_id = target AND NOT a.is_test
            AND a.attendance_date BETWEEN act.start_date AND act.end_date
            AND (act.field_id IS NULL OR a.field_id = act.field_id)
            AND (act.region_id IS NULL OR EXISTS (
              SELECT 1 FROM core.practice_fields f WHERE f.id = a.field_id AND f.region_id = act.region_id
            ));
          IF count_days >= act.required_days THEN periods := array_append(periods, act.period); END IF;
        END LOOP;
      ELSE
        NULL;
    END CASE;

    -- Revoke awards that no longer qualify
    FOR award IN SELECT * FROM core.person_venue_badges WHERE person_id = target AND badge_code = definition.code
      AND rule_version = definition.rule_version AND revoked_at IS NULL AND NOT(period = ANY(periods)) FOR UPDATE LOOP
      UPDATE core.person_venue_badges SET revoked_at = CURRENT_TIMESTAMP WHERE person_id = target
        AND badge_code = award.badge_code AND period = award.period AND rule_version = award.rule_version;
      INSERT INTO audit.venue_badge_changes(person_id, badge_code, period, rule_version, action)
        VALUES(target, award.badge_code, award.period, award.rule_version, 'revoked');
    END LOOP;

    -- Award newly qualified periods or restore previously revoked awards
    FOREACH changed IN ARRAY periods LOOP
      SELECT * INTO award FROM core.person_venue_badges WHERE person_id = target AND badge_code = definition.code
        AND period = changed AND rule_version = definition.rule_version;
      IF NOT FOUND THEN
        INSERT INTO core.person_venue_badges(person_id, badge_code, period, rule_version)
          VALUES(target, definition.code, changed, definition.rule_version);
        INSERT INTO audit.venue_badge_changes(person_id, badge_code, period, rule_version, action)
          VALUES(target, definition.code, changed, definition.rule_version, 'earned');
      ELSIF award.revoked_at IS NOT NULL THEN
        UPDATE core.person_venue_badges SET revoked_at = NULL WHERE person_id = target AND badge_code = definition.code
          AND period = changed AND rule_version = definition.rule_version;
        INSERT INTO audit.venue_badge_changes(person_id, badge_code, period, rule_version, action)
          VALUES(target, definition.code, changed, definition.rule_version, 'restored');
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION core.evaluate_venue_badges(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.evaluate_venue_badges(UUID) TO qigong_api_runtime, qigong_worker_runtime;

-- 7. Trigger on core.field_attendance to immediately evaluate and queue venue badges
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
    PERFORM core.evaluate_venue_badges(NEW.person_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION ops.queue_venue_practice_badges() FROM PUBLIC;

DROP TRIGGER IF EXISTS queue_venue_attendance_badges ON core.field_attendance;
CREATE TRIGGER queue_venue_attendance_badges
  AFTER INSERT ON core.field_attendance
  FOR EACH ROW EXECUTE FUNCTION ops.queue_venue_practice_badges();

-- 8. Admin venue badge recipients reader
CREATE OR REPLACE FUNCTION admin.venue_badge_recipients(
  input_code TEXT,
  input_locale TEXT,
  input_region UUID,
  input_platform TEXT,
  input_query TEXT,
  input_year INTEGER,
  input_page INTEGER,
  input_limit INTEGER
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE vdef core.venue_badge_definitions; result JSONB;
BEGIN
  PERFORM 1 FROM admin._achievement_people(input_region, input_platform, input_query);
  IF input_locale IS NULL OR input_locale NOT IN ('zh_TW', 'zh_CN', 'en')
    OR input_page IS NULL OR input_page NOT BETWEEN 1 AND 10000
    OR input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 100
    OR input_code IS NULL OR char_length(input_code) > 80 THEN
    RAISE EXCEPTION 'invalid achievement query' USING ERRCODE='22023';
  END IF;

  SELECT * INTO vdef FROM core.venue_badge_definitions vd WHERE vd.code = input_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'achievement unavailable' USING ERRCODE='P0002';
  END IF;

  WITH visible AS MATERIALIZED (
    SELECT * FROM admin._achievement_people(input_region, input_platform, input_query)
  ),
  recipients AS MATERIALIZED (
    SELECT v.person_id, v.display_name, v.region_id, v.region_name_zh_tw, v.region_name_en, v.platform,
      jsonb_agg(jsonb_build_object(
        'period', b.period,
        'ruleVersion', b.rule_version,
        'earnedAt', b.earned_at
      ) ORDER BY b.period, b.rule_version) AS awards
    FROM visible v
    JOIN core.person_venue_badges b ON b.person_id = v.person_id
    WHERE b.badge_code = input_code AND b.rule_version = vdef.rule_version AND b.revoked_at IS NULL
    GROUP BY v.person_id, v.display_name, v.region_id, v.region_name_zh_tw, v.region_name_en, v.platform
  ),
  page_rows AS (
    SELECT * FROM recipients ORDER BY display_name, person_id LIMIT input_limit OFFSET (input_page - 1) * input_limit
  )
  SELECT jsonb_build_object(
    'code', vdef.code,
    'ruleVersion', vdef.rule_version,
    'name', CASE WHEN input_locale = 'en' THEN vdef.name_en ELSE vdef.name_zh_tw END,
    'configurationKnown', true,
    'page', input_page,
    'limit', input_limit,
    'total', (SELECT count(*)::integer FROM recipients),
    'totalPages', GREATEST(1, CEIL((SELECT count(*) FROM recipients)::numeric / input_limit)::integer),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'personId', p.person_id,
        'displayName', p.display_name,
        'regionId', p.region_id,
        'regionName', CASE WHEN input_locale = 'en' THEN p.region_name_en ELSE p.region_name_zh_tw END,
        'platform', p.platform,
        'awards', p.awards
      ) ORDER BY p.display_name, p.person_id) FROM page_rows p
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION admin.venue_badge_recipients(TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) FROM PUBLIC, qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION admin.venue_badge_recipients(TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER, INTEGER) TO qigong_api_runtime;
