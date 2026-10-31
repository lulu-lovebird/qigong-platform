/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const migrationsDir = fileURLToPath(new URL('../../../migrations/', import.meta.url));
const sqlFile = '0061_venue_attendance_reporting.sql';
const sql = readFileSync(path.join(migrationsDir, sqlFile), 'utf8');

describe('schema61 static source contracts (safety & security)', () => {
  it('defines the isolated reporting reader role with strict flags', () => {
    expect(sql).toContain('CREATE ROLE qigong_venue_reporting_reader');
    expect(sql).toContain(
      'NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
    );
    expect(sql).toContain(
      "IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='qigong_venue_reporting_reader')"
    );
    expect(sql).toContain('venue reporting requires FORCE RLS');
  });

  it('restricts schema USAGE and specific columns on authorized tables', () => {
    expect(sql).toContain(
      'GRANT USAGE ON SCHEMA core, identity, admin, audit TO qigong_venue_reporting_reader;'
    );
    expect(sql).toContain(
      'GRANT SELECT (id,region_id,code,name_zh_tw,name_en,timezone,is_active) ON core.practice_fields'
    );
    expect(sql).toContain(
      'GRANT SELECT (id,person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone)'
    );
    expect(sql).toContain('GRANT SELECT (id,preferred_name,legal_name) ON identity.people');
    expect(sql).toContain(
      'GRANT SELECT (id,person_id,platform,external_subject_id,verified_at,revoked_at) ON identity.platform_identities'
    );
    expect(sql).toContain(
      'GRANT SELECT (id,person_id,platform,external_subject_id,learner_name,display_name,website_email,phone_e164,status,decided_at)'
    );
    expect(sql).toContain(
      'GRANT INSERT (request_id,actor_principal_id,action,target_type,scope_type,scope_id,outcome,metadata)'
    );
  });

  it('pins search_path to pg_catalog and forces row_security in all reporting functions', () => {
    const functions = [
      'admin.venue_weekend_attendance_summary',
      'admin.venue_learner_attendance_history'
    ];
    for (const fn of functions) {
      expect(sql).toContain(`CREATE FUNCTION ${fn}(`);
    }
    expect(sql).toMatch(/SET search_path = pg_catalog SET row_security = on/);
  });

  it('enforces row limits on bulk exports to prevent unbounded resource exhaustion', () => {
    expect(sql).toContain(
      "RAISE EXCEPTION 'venue_attendance_export_too_large' USING ERRCODE='54000';"
    );
    expect(sql).toContain('LIMIT 5001');
  });

  it('creates RESTRICTIVE RLS policies tied to validated session GUCs', () => {
    expect(sql).toContain('AS RESTRICTIVE FOR SELECT TO qigong_venue_reporting_reader');
    expect(sql).toContain("NULLIF(current_setting('qigong.reporting_region',TRUE),'')");
    expect(sql).toContain("NULLIF(current_setting('qigong.reporting_permission',TRUE),'')");
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

interface SummaryResponse {
  mode: string;
  regionId: string;
  fields: Array<{ fieldCode: string; attendanceCount: number; learnerCount: number }>;
}
interface ExportResponse {
  mode: string;
  rowCount: number;
  rows: Array<{
    fieldCode: string;
    learnerName: string;
    email: string;
    phone: string;
    lineId: string;
    whatsappId: string;
  }>;
}
interface SearchResponse {
  mode: string;
  total: number;
  rows: Array<{ phone: string; email: string }>;
}
interface DetailResponse {
  mode: string;
  total: number;
  learner: { learnerName: string; email: string; phone: string };
  annualSummary: Array<{ year: number; attendanceCount: number; attendanceDays: number }>;
  history: Array<{ fieldCode: string; attendanceDate: string }>;
}

describeWithDatabase('schema61 venue attendance reporting integration (PostgreSQL 16)', () => {
  let pool: Pool;
  let dispose: () => Promise<void>;
  let twRegion: string;
  let sgRegion: string;
  let testField1: string;
  let testField2: string;
  let adminSession: string;
  let principalId: string;
  let person1: string;
  let person2: string;

  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(databaseUrl!);
    pool = db.pool;
    dispose = () => db.dispose();

    await runMigrations(pool, migrationsDir, 'vitest');

    const client = await pool.connect();
    try {
      // 1. Regions
      const r = await client.query<{ id: string }>(
        "INSERT INTO core.regions(code, region_type, name_zh_tw, name_en) VALUES ('tw-rep', 'country', '台灣', 'Taiwan'), ('sg-rep', 'country', '新加坡', 'Singapore') RETURNING id"
      );
      twRegion = r.rows[0]!.id;
      sgRegion = r.rows[1]!.id;

      // 2. Fields
      const f1 = await client.query<{ id: string }>(
        `INSERT INTO core.practice_fields(region_id, code, name_zh_tw, timezone, is_active)
         VALUES ($1, 'tw-taipei-1', '台北大安團練場', 'Asia/Taipei', true) RETURNING id`,
        [twRegion]
      );
      testField1 = f1.rows[0]!.id;

      const f2 = await client.query<{ id: string }>(
        `INSERT INTO core.practice_fields(region_id, code, name_zh_tw, timezone, is_active)
         VALUES ($1, 'tw-hsinchu-1', '新竹團練場', 'Asia/Taipei', true) RETURNING id`,
        [twRegion]
      );
      testField2 = f2.rows[0]!.id;

      // 3. Admin principal & roles
      principalId = randomUUID();
      await client.query(
        `INSERT INTO admin.principals(id, oidc_issuer, oidc_subject, display_name)
         VALUES ($1, 'https://issuer.test', 'admin-rep', 'Reporting Admin')`,
        [principalId]
      );

      const roleExport = await client.query<{ id: string }>(
        "INSERT INTO admin.roles(code, description) VALUES ('rep_export_role', 'Read and Export') RETURNING id"
      );

      const permRead = (
        await client.query<{ id: string }>(
          "SELECT id FROM admin.permissions WHERE code='checkin.read'"
        )
      ).rows[0]!.id;
      const permExport = (
        await client.query<{ id: string }>(
          "SELECT id FROM admin.permissions WHERE code='stats.export'"
        )
      ).rows[0]!.id;

      await client.query(
        'INSERT INTO admin.role_permissions(role_id, permission_id) VALUES ($1, $2), ($1, $3)',
        [roleExport.rows[0]!.id, permRead, permExport]
      );

      await client.query(
        `INSERT INTO admin.role_grants(principal_id, role_id, scope_type, region_id, reason)
         VALUES ($1, $2, 'region', $3, 'test grant')`,
        [principalId, roleExport.rows[0]!.id, twRegion]
      );

      adminSession = 's'.repeat(43);
      await client.query(
        `INSERT INTO admin.sessions(token_hash, principal_id, expires_at)
         VALUES (public.digest($1, 'sha256'), $2, clock_timestamp() + interval '1 day')`,
        [adminSession, principalId]
      );

      // 4. Learners (Two learners with identical name '陳小明' to test disambiguation)
      const p1 = await client.query<{ id: string }>(
        `INSERT INTO identity.people(website_issuer, website_subject, legal_name, preferred_name)
         VALUES ('test', 'sub-1', '陳小明', '小明A') RETURNING id`
      );
      person1 = p1.rows[0]!.id;

      const p2 = await client.query<{ id: string }>(
        `INSERT INTO identity.people(website_issuer, website_subject, legal_name, preferred_name)
         VALUES ('test', 'sub-2', '陳小明', '小明B') RETURNING id`
      );
      person2 = p2.rows[0]!.id;

      await client.query(
        `INSERT INTO identity.platform_identities(person_id, platform, external_subject_id)
         VALUES ($1, 'line', 'U_LINE_1'), ($2, 'whatsapp', '+886911222333')`,
        [person1, person2]
      );

      await client.query(
        `INSERT INTO identity.onboarding_applications(platform, external_subject_id, person_id, learner_name, website_email, phone_e164, status, decided_at)
         VALUES ('line', 'U_LINE_1', $1, '陳小明', 'ming_a@example.com', '+886912345678', 'approved', clock_timestamp()),
                ('whatsapp', '+886911222333', $2, '陳小明', 'ming_b@example.com', '+886987654321', 'approved', clock_timestamp())`,
        [person1, person2]
      );

      // 5. Attendance records
      await client.query(
        `INSERT INTO core.field_attendance(person_id, field_id, checkin_method, checkin_at, attendance_date, attendance_timezone)
         VALUES ($1, $2, 'nfc_gps', '2026-10-31 06:30:00+08', '2026-10-31', 'Asia/Taipei'),
                ($1, $2, 'nfc_gps', '2025-10-15 06:30:00+08', '2025-10-15', 'Asia/Taipei')`,
        [person1, testField1]
      );

      await client.query(
        `INSERT INTO core.field_attendance(person_id, field_id, checkin_method, checkin_at, attendance_date, attendance_timezone)
         VALUES ($1, $2, 'nfc_gps', '2026-10-31 07:00:00+08', '2026-10-31', 'Asia/Taipei')`,
        [person2, testField2]
      );
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await dispose?.();
  });

  it('rejects unauthenticated requests or invalid parameters', async () => {
    await withRequestContext(pool, 'qigong_api_runtime', { requestId: randomUUID() }, async (c) => {
      await expect(
        c.query(
          "SELECT admin.venue_weekend_attendance_summary('bad-session', $1, '2026-10-01', '2026-11-01', NULL, false)",
          [twRegion]
        )
      ).rejects.toThrow('venue_reporting_unauthenticated');

      await expect(
        c.query(
          "SELECT admin.venue_weekend_attendance_summary($1, $2, '2026-11-01', '2026-10-01', NULL, false)",
          [adminSession, twRegion]
        )
      ).rejects.toThrow('venue_reporting_invalid');
    });
  });

  it('enforces region scope and denies access to unauthorized regions', async () => {
    await withRequestContext(pool, 'qigong_api_runtime', { requestId: randomUUID() }, async (c) => {
      await expect(
        c.query(
          "SELECT admin.venue_weekend_attendance_summary($1, $2, '2026-10-01', '2026-11-01', NULL, false)",
          [adminSession, sgRegion]
        )
      ).rejects.toThrow('venue_reporting_forbidden');
    });
  });

  it('summarizes weekend attendance across venues in a region', async () => {
    await withRequestContext(pool, 'qigong_api_runtime', { requestId: randomUUID() }, async (c) => {
      const res = await c.query<{ data: SummaryResponse }>(
        "SELECT admin.venue_weekend_attendance_summary($1, $2, '2026-10-30', '2026-11-01', NULL, false) AS data",
        [adminSession, twRegion]
      );
      const data = res.rows[0]!.data;
      expect(data.mode).toBe('summary');
      expect(data.regionId).toBe(twRegion);
      expect(data.fields).toHaveLength(2);

      const f1 = data.fields.find((f) => f.fieldCode === 'tw-taipei-1');
      expect(f1).toBeDefined();
      expect(f1!.attendanceCount).toBe(1);
      expect(f1!.learnerCount).toBe(1);

      const f2 = data.fields.find((f) => f.fieldCode === 'tw-hsinchu-1');
      expect(f2).toBeDefined();
      expect(f2!.attendanceCount).toBe(1);
      expect(f2!.learnerCount).toBe(1);
    });
  });

  it('exports attendee details with phone, email and platform IDs for CSV generation', async () => {
    await withRequestContext(pool, 'qigong_api_runtime', { requestId: randomUUID() }, async (c) => {
      const res = await c.query<{ data: ExportResponse }>(
        "SELECT admin.venue_weekend_attendance_summary($1, $2, '2026-10-30', '2026-11-01', NULL, true) AS data",
        [adminSession, twRegion]
      );
      const data = res.rows[0]!.data;
      expect(data.mode).toBe('export');
      expect(data.rowCount).toBe(2);
      expect(data.rows).toHaveLength(2);

      const row1 = data.rows.find((r) => r.fieldCode === 'tw-taipei-1');
      expect(row1!.learnerName).toBe('陳小明');
      expect(row1!.email).toBe('ming_a@example.com');
      expect(row1!.phone).toBe('+886912345678');
      expect(row1!.lineId).toBe('U_LINE_1');

      const row2 = data.rows.find((r) => r.fieldCode === 'tw-hsinchu-1');
      expect(row2!.learnerName).toBe('陳小明');
      expect(row2!.email).toBe('ming_b@example.com');
      expect(row2!.phone).toBe('+886987654321');
      expect(row2!.whatsappId).toBe('+886911222333');
    });
  });

  it('searches learners by name and disambiguates duplicate names via phone and email', async () => {
    await withRequestContext(pool, 'qigong_api_runtime', { requestId: randomUUID() }, async (c) => {
      const res = await c.query<{ data: SearchResponse }>(
        "SELECT admin.venue_learner_attendance_history($1, $2, '小明', NULL, 1, 20) AS data",
        [adminSession, twRegion]
      );
      const data = res.rows[0]!.data;
      expect(data.mode).toBe('search');
      expect(data.total).toBe(2);
      expect(data.rows).toHaveLength(2);

      const phones = data.rows.map((r) => r.phone);
      expect(phones).toContain('+886912345678');
      expect(phones).toContain('+886987654321');

      const emails = data.rows.map((r) => r.email);
      expect(emails).toContain('ming_a@example.com');
      expect(emails).toContain('ming_b@example.com');
    });
  });

  it('retrieves detailed learner attendance history with annual breakdown', async () => {
    await withRequestContext(pool, 'qigong_api_runtime', { requestId: randomUUID() }, async (c) => {
      const res = await c.query<{ data: DetailResponse }>(
        "SELECT admin.venue_learner_attendance_history($1, $2, '', $3, 1, 20) AS data",
        [adminSession, twRegion, person1]
      );
      const data = res.rows[0]!.data;
      expect(data.mode).toBe('detail');
      expect(data.learner.learnerName).toBe('陳小明');
      expect(data.learner.email).toBe('ming_a@example.com');
      expect(data.learner.phone).toBe('+886912345678');

      expect(data.annualSummary).toEqual([
        { year: 2026, attendanceCount: 1, attendanceDays: 1 },
        { year: 2025, attendanceCount: 1, attendanceDays: 1 }
      ]);

      expect(data.total).toBe(2);
      expect(data.history).toHaveLength(2);
      expect(data.history[0]!.fieldCode).toBe('tw-taipei-1');
      expect(data.history[0]!.attendanceDate).toBe('2026-10-31');
    });
  });
});
