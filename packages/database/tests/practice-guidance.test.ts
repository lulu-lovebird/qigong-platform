/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const migrationsDir = fileURLToPath(new URL('../../../migrations/', import.meta.url));
const sqlFile = '0063_practice_guidance.sql';
const sql = readFileSync(path.join(migrationsDir, sqlFile), 'utf8');

describe('schema63 static source contracts (safety & security)', () => {
  it('defines core.practice_guidance_campaigns with FORCE RLS and restricted permissions', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS core.practice_guidance_campaigns');
    expect(sql).toContain('ALTER TABLE core.practice_guidance_campaigns ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE core.practice_guidance_campaigns FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('REVOKE ALL ON core.practice_guidance_campaigns FROM PUBLIC');
    expect(sql).toContain(
      'GRANT SELECT ON core.practice_guidance_campaigns TO qigong_api_runtime, qigong_worker_runtime'
    );
  });

  it('defines core.practice_guidance_entries with length constraints, foreign keys and indexes', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS core.practice_guidance_entries');
    expect(sql).toContain('char_length(trim(content)) BETWEEN 1 AND 500');
    expect(sql).toContain('UNIQUE (campaign_id, guide_date)');
    expect(sql).toContain('idx_guidance_entries_lookup');
  });

  it('defines core.lookup_practice_guidance with SECURITY DEFINER and stable volatility', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION core.lookup_practice_guidance(input_date DATE)'
    );
    expect(sql).toContain('STABLE SECURITY DEFINER');
    expect(sql).toContain('WHERE c.is_active = true');
    expect(sql).toContain('input_date BETWEEN c.start_date AND c.end_date');
  });

  it('defines admin.manage_guidance_campaign restricting to super_admin and master_admin', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION admin.manage_guidance_campaign');
    expect(sql).toContain("r.code IN ('super_admin', 'master_admin')");
    expect(sql).toContain("WHEN 'upsert_entries' THEN");
  });
});

const canRunDatabase = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);

describe.runIf(canRunDatabase)('schema63 integration: practice guidance campaign & lookup', () => {
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

  it('manages campaigns and retrieves active daily guidance', async () => {
    const client = await pool.connect();
    try {
      // 1. Create a principal with super_admin role and session
      const pRes = await client.query<{ id: string }>(
        "INSERT INTO admin.principals (status, oidc_issuer, oidc_subject, email, display_name) VALUES ('active', 'authgear', 'sub-master', 'master@example.com', 'Master') RETURNING id"
      );
      const principalId = pRes.rows[0]!.id;

      const rRes = await client.query<{ id: string }>(
        "SELECT id FROM admin.roles WHERE code = 'super_admin'"
      );
      const roleId = rRes.rows[0]!.id;

      await client.query(
        "INSERT INTO admin.role_grants (principal_id, role_id, scope_type, reason) VALUES ($1, $2, 'global', 'test grant')",
        [principalId, roleId]
      );

      const sRes = await client.query<{ token: string }>(
        "INSERT INTO admin.sessions (principal_id, token_hash, expires_at) VALUES ($1, digest('test-session-123456789012345678901234567890123', 'sha256'), clock_timestamp() + interval '1 hour') RETURNING 'test-session-123456789012345678901234567890123' AS token",
        [principalId]
      );
      const session = sRes.rows[0]!.token;

      // 2. Create campaign via admin function
      const createRes = await client.query<{ data: { ok: boolean; id: string } }>(
        "SELECT admin.manage_guidance_campaign('create', $1, $2) AS data",
        [
          session,
          JSON.stringify({
            title: '2026 三伏共修活動',
            startDate: '2026-07-15',
            endDate: '2026-07-17',
            isActive: true
          })
        ]
      );
      expect(createRes.rows[0]!.data.ok).toBe(true);
      const campaignId = createRes.rows[0]!.data.id;

      // 3. Upsert daily entries
      const upsertRes = await client.query<{ data: { ok: boolean } }>(
        "SELECT admin.manage_guidance_campaign('upsert_entries', $1, $2) AS data",
        [
          session,
          JSON.stringify({
            campaignId,
            entries: [
              {
                guide_date: '2026-07-15',
                title: '初伏第一天',
                content: '注意排汗與補水，雙肩放鬆。'
              },
              { guide_date: '2026-07-16', title: '初伏第二天', content: '練功前後靜坐三分鐘。' }
            ]
          })
        ]
      );
      expect(upsertRes.rows[0]!.data.ok).toBe(true);

      // 4. Test core.lookup_practice_guidance on active date
      const lookup15 = await client.query<{
        data: { campaignTitle: string; title: string; content: string };
      }>("SELECT core.lookup_practice_guidance('2026-07-15'::date) AS data");
      expect(lookup15.rows[0]!.data).toEqual({
        campaignTitle: '2026 三伏共修活動',
        guideDate: '2026-07-15',
        title: '初伏第一天',
        content: '注意排汗與補水，雙肩放鬆。'
      });

      // 5. Test lookup on date within campaign but no entry set (2026-07-17) -> returns null
      const lookup17 = await client.query<{ data: unknown }>(
        "SELECT core.lookup_practice_guidance('2026-07-17'::date) AS data"
      );
      expect(lookup17.rows[0]!.data).toBeNull();

      // 6. Test lookup outside campaign dates (2026-07-18) -> returns null
      const lookup18 = await client.query<{ data: unknown }>(
        "SELECT core.lookup_practice_guidance('2026-07-18'::date) AS data"
      );
      expect(lookup18.rows[0]!.data).toBeNull();

      // 7. Deactivate campaign and test lookup -> returns null
      await client.query("SELECT admin.manage_guidance_campaign('update', $1, $2)", [
        session,
        JSON.stringify({ id: campaignId, isActive: false })
      ]);
      const lookupDeactivated = await client.query<{ data: unknown }>(
        "SELECT core.lookup_practice_guidance('2026-07-15'::date) AS data"
      );
      expect(lookupDeactivated.rows[0]!.data).toBeNull();
    } finally {
      client.release();
    }
  });
});
