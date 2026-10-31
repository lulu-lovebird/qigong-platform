/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const migrationsDir = fileURLToPath(new URL('../../../migrations/', import.meta.url));
const sqlFile = '0062_venue_attendance_badges.sql';
const sql = readFileSync(path.join(migrationsDir, sqlFile), 'utf8');

describe('schema62 static source contracts (safety & security)', () => {
  it('defines core.venue_badge_definitions table with FORCE RLS and restricted permissions', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS core.venue_badge_definitions');
    expect(sql).toContain('ALTER TABLE core.venue_badge_definitions ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE core.venue_badge_definitions FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON core.venue_badge_definitions FROM PUBLIC');
    expect(sql).toContain(
      'GRANT SELECT ON core.venue_badge_definitions TO qigong_api_runtime, qigong_worker_runtime'
    );
  });

  it('defines core.venue_badge_activities table with FORCE RLS and restricted permissions', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS core.venue_badge_activities');
    expect(sql).toContain('ALTER TABLE core.venue_badge_activities ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE core.venue_badge_activities FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON core.venue_badge_activities FROM PUBLIC');
    expect(sql).toContain(
      'GRANT SELECT ON core.venue_badge_activities TO qigong_api_runtime, qigong_worker_runtime'
    );
  });

  it('seeds initial venue milestone badges with identities', () => {
    expect(sql).toContain("'venue_first_step'");
    expect(sql).toContain("'venue_total_5'");
    expect(sql).toContain("'venue_total_10'");
    expect(sql).toContain("'venue_total_25'");
    expect(sql).toContain("'venue_total_50'");
    expect(sql).toContain("'venue_total_100'");
    expect(sql).toContain('INSERT INTO core.achievement_badge_identities');
  });

  it('installs the evaluation trigger on core.field_attendance', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION ops.queue_venue_practice_badges()');
    expect(sql).toContain('CREATE TRIGGER queue_venue_attendance_badges');
    expect(sql).toContain('AFTER INSERT ON core.field_attendance');
    expect(sql).toContain('NOT NEW.is_test');
  });

  it('defines core.evaluate_venue_badges with venue_total and venue_activity handlers', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION core.evaluate_venue_badges(target UUID)');
    expect(sql).toContain("WHEN 'venue_total' THEN");
    expect(sql).toContain('SELECT count(DISTINCT attendance_date) INTO count_days');
    expect(sql).toContain('FROM core.field_attendance');
    expect(sql).toContain('WHERE person_id = target AND NOT is_test');
    expect(sql).toContain("WHEN 'venue_activity' THEN");
    expect(sql).toContain('FROM core.venue_badge_activities');
  });
});

const canRunDatabase = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);

describe.runIf(canRunDatabase)('schema62 integration: venue attendance badge evaluation', () => {
  let pool: Pool;
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const testDb = await createIsolatedTestDatabase(process.env.TEST_DATABASE_URL!);
    pool = testDb.pool;
    cleanup = () => testDb.dispose();
    await runMigrations(pool, migrationsDir);
  });

  afterAll(async () => {
    if (cleanup) await cleanup();
  });

  it('awards venue_first_step on first physical venue attendance', async () => {
    const personId = randomUUID();
    const fieldId = randomUUID();
    const regionId = randomUUID();

    const client = await pool.connect();
    try {
      // Create operational region hierarchy & practice field
      let g = await client.query<{ id: string }>(
        "SELECT id FROM core.regions WHERE region_type = 'global' LIMIT 1"
      );
      if (!g.rows.length) {
        g = await client.query<{ id: string }>(
          "INSERT INTO core.regions(code, region_type, name_zh_tw, name_en) VALUES ('global-test', 'global', '全球', 'Global') RETURNING id"
        );
      }
      const c = await client.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id, code, region_type, name_zh_tw, name_en) VALUES ($1, 'tw-country-test', 'country', '台灣', 'Taiwan') RETURNING id",
        [g.rows[0]!.id]
      );
      await client.query(
        "INSERT INTO core.regions(id, parent_region_id, code, name_zh_tw, name_en, region_type, active) VALUES($1, $2, 'tw-test', '台灣', 'Taiwan', 'operational', true)",
        [regionId, c.rows[0]!.id]
      );
      await client.query(
        `INSERT INTO core.practice_fields(id, code, name_zh_tw, name_en, timezone, region_id, latitude, longitude, radius_meters, is_active)
         VALUES($1, 'f-001', '測試場地', 'Test Field', 'Asia/Taipei', $2, 25.033, 121.565, 100, true)`,
        [fieldId, regionId]
      );
      // Create person
      await client.query(
        "INSERT INTO identity.people(id, status, practice_timezone) VALUES($1, 'active', 'Asia/Taipei')",
        [personId]
      );

      // 1. Initial state: no badges
      await client.query('SELECT core.evaluate_practice_badges($1)', [personId]);
      const initialBadges = await client.query(
        "SELECT * FROM core.person_practice_badges WHERE person_id = $1 AND badge_code LIKE 'venue_%'",
        [personId]
      );
      expect(initialBadges.rows).toHaveLength(0);

      // 2. Insert test attendance (is_test = true): must NOT award badge
      await client.query(
        `INSERT INTO core.field_attendance(
          id, person_id, field_id, checkin_method, attendance_date, attendance_timezone, is_test, verification_mode
        ) VALUES(gen_random_uuid(), $1, $2, 'qr_gps', '2026-11-01', 'Asia/Taipei', true, 'distance_debug')`,
        [personId, fieldId]
      );
      await client.query('SELECT core.evaluate_practice_badges($1)', [personId]);
      const afterTestBadge = await client.query(
        "SELECT * FROM core.person_practice_badges WHERE person_id = $1 AND badge_code LIKE 'venue_%'",
        [personId]
      );
      expect(afterTestBadge.rows).toHaveLength(0);

      // 3. Insert real attendance (is_test = false) on day 1
      await client.query(
        `INSERT INTO core.field_attendance(
          id, person_id, field_id, checkin_method, attendance_date, attendance_timezone, is_test, verification_mode
        ) VALUES(gen_random_uuid(), $1, $2, 'qr_gps', '2026-11-01', 'Asia/Taipei', false, 'standard')`,
        [personId, fieldId]
      );
      await client.query('SELECT core.evaluate_practice_badges($1)', [personId]);

      // Assert venue_first_step earned
      const afterFirstBadge = await client.query<{ badge_code: string; period: string }>(
        "SELECT badge_code, period FROM core.person_practice_badges WHERE person_id = $1 AND badge_code LIKE 'venue_%'",
        [personId]
      );
      expect(afterFirstBadge.rows).toEqual([
        { badge_code: 'venue_first_step', period: 'lifetime' }
      ]);

      // 4. Insert second attendance on a DIFFERENT field on the SAME day: distinct days still = 1
      const fieldId2 = randomUUID();
      await client.query(
        `INSERT INTO core.practice_fields(id, code, name_zh_tw, name_en, timezone, region_id, latitude, longitude, radius_meters, is_active)
         VALUES($1, 'f-002', '第二場地', 'Second Field', 'Asia/Taipei', $2, 25.040, 121.570, 100, true)`,
        [fieldId2, regionId]
      );
      await client.query(
        `INSERT INTO core.field_attendance(
          id, person_id, field_id, checkin_method, checkin_at, attendance_date, attendance_timezone, is_test, verification_mode
        ) VALUES(gen_random_uuid(), $1, $2, 'nfc_gps', '2026-11-01T14:00:00+08:00', '2026-11-01', 'Asia/Taipei', false, 'standard')`,
        [personId, fieldId2]
      );
      await client.query('SELECT core.evaluate_practice_badges($1)', [personId]);

      const afterSameDay = await client.query<{ badge_code: string }>(
        "SELECT badge_code FROM core.person_practice_badges WHERE person_id = $1 AND badge_code LIKE 'venue_%'",
        [personId]
      );
      // Still only venue_first_step (1 distinct date)
      expect(afterSameDay.rows).toHaveLength(1);

      // 5. Insert 4 more attendances on distinct dates (days 2..5)
      const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'];
      for (const d of dates) {
        await client.query(
          `INSERT INTO core.field_attendance(
            id, person_id, field_id, checkin_method, checkin_at, attendance_date, attendance_timezone, is_test, verification_mode
          ) VALUES(gen_random_uuid(), $1, $2, 'nfc_gps', ($3 || 'T10:00:00+08:00')::timestamptz, $3::date, 'Asia/Taipei', false, 'standard')`,
          [personId, fieldId, d]
        );
      }
      await client.query('SELECT core.evaluate_practice_badges($1)', [personId]);

      // Total distinct days = 5 -> should have venue_first_step and venue_total_5
      const afterFiveDays = await client.query<{ badge_code: string; period: string }>(
        "SELECT badge_code, period FROM core.person_practice_badges WHERE person_id = $1 AND badge_code LIKE 'venue_%' ORDER BY badge_code",
        [personId]
      );
      expect(afterFiveDays.rows).toEqual([
        { badge_code: 'venue_first_step', period: 'lifetime' },
        { badge_code: 'venue_total_5', period: 'lifetime' }
      ]);
    } finally {
      client.release();
    }
  });

  it('evaluates venue_activity time-bound badges according to campaign dates', async () => {
    const personId = randomUUID();
    const fieldId = randomUUID();
    const regionId = randomUUID();

    const client = await pool.connect();
    try {
      // Seed person, region hierarchy, field
      let g = await client.query<{ id: string }>(
        "SELECT id FROM core.regions WHERE region_type = 'global' LIMIT 1"
      );
      if (!g.rows.length) {
        g = await client.query<{ id: string }>(
          "INSERT INTO core.regions(code, region_type, name_zh_tw, name_en) VALUES ('global-hk', 'global', '全球', 'Global') RETURNING id"
        );
      }
      const c = await client.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id, code, region_type, name_zh_tw, name_en) VALUES ($1, 'hk-country-test', 'country', '香港', 'Hong Kong') RETURNING id",
        [g.rows[0]!.id]
      );
      await client.query(
        "INSERT INTO core.regions(id, parent_region_id, code, name_zh_tw, name_en, region_type, active) VALUES($1, $2, 'hk-test', '香港', 'Hong Kong', 'operational', true)",
        [regionId, c.rows[0]!.id]
      );
      await client.query(
        `INSERT INTO core.practice_fields(id, code, name_zh_tw, name_en, timezone, region_id, latitude, longitude, radius_meters, is_active)
         VALUES($1, 'f-hk-01', '九龍共修點', 'Kowloon', 'Asia/Hong_Kong', $2, 22.319, 114.169, 100, true)`,
        [fieldId, regionId]
      );
      await client.query(
        "INSERT INTO identity.people(id, status, practice_timezone) VALUES($1, 'active', 'Asia/Hong_Kong')",
        [personId]
      );

      // Define a custom campaign badge: "2026 迎春團練" requiring 2 days in Jan 2026
      await client.query(
        "INSERT INTO core.venue_badge_definitions(code, kind, name_zh_tw, name_en, threshold, sort_order) VALUES('venue_spring_2026', 'venue_activity', '2026 迎春團練', 'Spring 2026 Gathering', 2, 3501)"
      );
      await client.query(
        "INSERT INTO core.achievement_badge_identities(code, origin) VALUES('venue_spring_2026', 'versioned')"
      );
      await client.query(
        `INSERT INTO core.venue_badge_activities(
          badge_code, period, start_date, end_date, timezone, required_days, region_id, field_id
        ) VALUES('venue_spring_2026', 'spring_2026', '2026-01-01', '2026-01-31', 'Asia/Hong_Kong', 2, $1, $2)`,
        [regionId, fieldId]
      );

      // Attendance outside activity window (e.g. Feb 2026): does NOT count towards venue_spring_2026
      await client.query(
        `INSERT INTO core.field_attendance(
          id, person_id, field_id, checkin_method, checkin_at, attendance_date, attendance_timezone, is_test, verification_mode
        ) VALUES(gen_random_uuid(), $1, $2, 'qr_gps', '2026-02-01T10:00:00+08:00', '2026-02-01', 'Asia/Hong_Kong', false, 'standard')`,
        [personId, fieldId]
      );
      await client.query('SELECT core.evaluate_practice_badges($1)', [personId]);

      const initialBadges = await client.query(
        "SELECT * FROM core.person_practice_badges WHERE person_id = $1 AND badge_code = 'venue_spring_2026'",
        [personId]
      );
      expect(initialBadges.rows).toHaveLength(0);

      // Day 1 within activity window (2026-01-10): count = 1, threshold = 2 -> not yet awarded
      await client.query(
        `INSERT INTO core.field_attendance(
          id, person_id, field_id, checkin_method, checkin_at, attendance_date, attendance_timezone, is_test, verification_mode
        ) VALUES(gen_random_uuid(), $1, $2, 'qr_gps', '2026-01-10T10:00:00+08:00', '2026-01-10', 'Asia/Hong_Kong', false, 'standard')`,
        [personId, fieldId]
      );
      await client.query('SELECT core.evaluate_practice_badges($1)', [personId]);
      const afterOneDay = await client.query(
        "SELECT * FROM core.person_practice_badges WHERE person_id = $1 AND badge_code = 'venue_spring_2026'",
        [personId]
      );
      expect(afterOneDay.rows).toHaveLength(0);

      // Day 2 within activity window (2026-01-20): count = 2 >= 2 -> awarded!
      await client.query(
        `INSERT INTO core.field_attendance(
          id, person_id, field_id, checkin_method, checkin_at, attendance_date, attendance_timezone, is_test, verification_mode
        ) VALUES(gen_random_uuid(), $1, $2, 'qr_gps', '2026-01-20T10:00:00+08:00', '2026-01-20', 'Asia/Hong_Kong', false, 'standard')`,
        [personId, fieldId]
      );
      await client.query('SELECT core.evaluate_practice_badges($1)', [personId]);
      const afterTwoDays = await client.query<{ badge_code: string; period: string }>(
        "SELECT badge_code, period FROM core.person_practice_badges WHERE person_id = $1 AND badge_code = 'venue_spring_2026'",
        [personId]
      );
      expect(afterTwoDays.rows).toEqual([
        { badge_code: 'venue_spring_2026', period: 'spring_2026' }
      ]);
    } finally {
      client.release();
    }
  });
});
