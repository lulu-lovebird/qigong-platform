import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/index.js';
import { checkApiRuntimePreflight, runMigrations, withRequestContext } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);

describeWithDatabase('runtime roles and request-scoped RLS', () => {
  let pool: Pool;
  let runtimePool: Pool;
  let dispose: () => Promise<void>;
  let runtimeLoginRole: string;
  let learnerA: string;
  let learnerB: string;
  let learnerC: string;
  let regionalPrincipal: string;
  let countryPrincipal: string;
  let coachPrincipal: string;
  let privacyPrincipal: string;
  let regionAId: string;
  let regionBId: string;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase(databaseUrl!);
    pool = database.pool;
    dispose = () => database.dispose();
    await runMigrations(pool, migrationsDirectory, 'vitest');
    runtimeLoginRole = `qigong_api_login_${randomUUID().replaceAll('-', '')}`;
    const runtimePassword = randomUUID().replaceAll('-', '');
    await pool.query(
      `CREATE ROLE ${runtimeLoginRole} LOGIN PASSWORD '${runtimePassword}' NOINHERIT NOBYPASSRLS`
    );
    await pool.query(`GRANT qigong_api_runtime TO ${runtimeLoginRole}`);
    const runtimeUrl = new URL(database.databaseUrl);
    runtimeUrl.username = runtimeLoginRole;
    runtimeUrl.password = runtimePassword;
    runtimePool = new pg.Pool({ connectionString: runtimeUrl.toString(), max: 2 });

    const global = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (code, region_type, name_zh_tw, name_en)
       VALUES ('runtime-global', 'global', '全球', 'Global') RETURNING id`
    );
    const country = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'runtime-tw', 'country', '台灣', 'Taiwan') RETURNING id`,
      [global.rows[0]!.id]
    );
    const regionA = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'runtime-taipei', 'operational', '台北', 'Taipei') RETURNING id`,
      [country.rows[0]!.id]
    );
    const regionB = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'runtime-kaohsiung', 'operational', '高雄', 'Kaohsiung') RETURNING id`,
      [country.rows[0]!.id]
    );
    regionAId = regionA.rows[0]!.id;
    regionBId = regionB.rows[0]!.id;
    const people = await pool.query<{ id: string }>(
      `INSERT INTO identity.people (website_issuer, website_subject, legal_name)
       VALUES ('https://members.example.com', 'runtime-a', 'Learner A'),
              ('https://members.example.com', 'runtime-b', 'Learner B'),
              ('https://members.example.com', 'runtime-c', 'Learner C') RETURNING id`
    );
    [learnerA, learnerB, learnerC] = people.rows.map(({ id }) => id);
    await pool.query(
      `INSERT INTO core.person_region_assignments
         (person_id, region_id, assignment_type, valid_from)
       VALUES ($1, $3, 'primary', CURRENT_DATE),
              ($2, $3, 'primary', CURRENT_DATE),
              ($4, $3, 'primary', CURRENT_DATE)`,
      [learnerA, learnerB, regionBId, learnerC]
    );
    await pool.query(
      `UPDATE core.person_region_assignments
       SET valid_from = CURRENT_DATE - 30
       WHERE person_id = $1`,
      [learnerA]
    );
    await pool.query(
      `UPDATE core.person_region_assignments
       SET valid_to = CURRENT_DATE
       WHERE person_id = $1`,
      [learnerA]
    );
    await pool.query(
      `INSERT INTO core.person_region_assignments
         (person_id, region_id, assignment_type, valid_from)
       VALUES ($1, $2, 'primary', CURRENT_DATE)`,
      [learnerA, regionAId]
    );
    const cohort = await pool.query<{ id: string }>(
      `INSERT INTO core.cohorts (region_id, code, name)
       VALUES ($1, 'runtime-cohort', 'Runtime Cohort') RETURNING id`,
      [regionB.rows[0]!.id]
    );
    await pool.query(
      `INSERT INTO core.cohort_memberships (cohort_id, person_id, valid_from)
       VALUES ($1, $2, CURRENT_DATE)`,
      [cohort.rows[0]!.id, learnerC]
    );
    const principals = await pool.query<{ id: string; oidc_subject: string }>(
      `INSERT INTO admin.principals (oidc_issuer, oidc_subject, display_name)
       VALUES ('https://members.example.com', 'runtime-regional', 'Regional Admin'),
              ('https://members.example.com', 'runtime-country', 'Country Admin'),
              ('https://members.example.com', 'runtime-coach', 'Coach'),
              ('https://members.example.com', 'runtime-privacy', 'Privacy Admin')
       RETURNING id, oidc_subject`
    );
    const principalBySubject = new Map(principals.rows.map((row) => [row.oidc_subject, row.id]));
    regionalPrincipal = principalBySubject.get('runtime-regional')!;
    countryPrincipal = principalBySubject.get('runtime-country')!;
    coachPrincipal = principalBySubject.get('runtime-coach')!;
    privacyPrincipal = principalBySubject.get('runtime-privacy')!;
    const privacyCase = await pool.query<{ id: string }>(
      `INSERT INTO admin.privacy_cases (person_id, case_type) VALUES ($1, 'export') RETURNING id`,
      [learnerB]
    );
    await pool.query(
      `INSERT INTO admin.role_grants
         (principal_id, role_id, scope_type, region_id, cohort_id, privacy_case_id, valid_from, reason)
       SELECT $1::uuid, id, 'region', $5::uuid, NULL::uuid, NULL::uuid, CURRENT_TIMESTAMP - INTERVAL '1 day', 'runtime test' FROM admin.roles WHERE code = 'regional_admin'
       UNION ALL
       SELECT $2::uuid, id, 'country', $6::uuid, NULL::uuid, NULL::uuid, CURRENT_TIMESTAMP - INTERVAL '1 day', 'runtime test' FROM admin.roles WHERE code = 'country_admin'
       UNION ALL
       SELECT $3::uuid, id, 'cohort', NULL::uuid, $7::uuid, NULL::uuid, CURRENT_TIMESTAMP - INTERVAL '1 day', 'runtime test' FROM admin.roles WHERE code = 'coach'
       UNION ALL
       SELECT $4::uuid, id, 'privacy_case', NULL::uuid, NULL::uuid, $8::uuid, CURRENT_TIMESTAMP - INTERVAL '1 day', 'runtime test' FROM admin.roles WHERE code = 'privacy_admin'`,
      [
        regionalPrincipal,
        countryPrincipal,
        coachPrincipal,
        privacyPrincipal,
        regionA.rows[0]!.id,
        country.rows[0]!.id,
        cohort.rows[0]!.id,
        privacyCase.rows[0]!.id
      ]
    );
  });

  afterAll(async () => {
    await runtimePool.end();
    await pool.query(`DROP OWNED BY ${runtimeLoginRole}`);
    await pool.query(`DROP ROLE ${runtimeLoginRole}`);
    await dispose();
  });

  const visiblePeople = (personId?: string, principalId?: string) =>
    withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID(), personId, principalId },
      async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT id FROM identity.people ORDER BY id`
        );
        return result.rows.map(({ id }) => id).sort();
      }
    );

  it('uses non-login, non-bypass runtime roles and denies missing context', async () => {
    const roles = await pool.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT rolname, rolcanlogin, rolbypassrls FROM pg_roles
       WHERE rolname IN ('qigong_api_runtime', 'qigong_worker_runtime') ORDER BY rolname`
    );
    expect(roles.rows).toEqual([
      { rolname: 'qigong_api_runtime', rolcanlogin: false, rolbypassrls: false },
      { rolname: 'qigong_worker_runtime', rolcanlogin: false, rolbypassrls: false }
    ]);
    await expect(checkApiRuntimePreflight(runtimePool)).resolves.toMatchObject({
      sessionUser: runtimeLoginRole,
      ready: true
    });
    expect(await visiblePeople()).toEqual([]);
  });

  it('allows learner self access without exposing another learner', async () => {
    expect(await visiblePeople(learnerA)).toEqual([learnerA]);
  });

  it('enforces region, country, cohort, and privacy-case scopes', async () => {
    expect(await visiblePeople(undefined, regionalPrincipal)).toEqual([learnerA]);
    expect(await visiblePeople(undefined, countryPrincipal)).toEqual(
      [learnerA, learnerB, learnerC].sort()
    );
    expect(await visiblePeople(undefined, coachPrincipal)).toEqual([learnerC]);
    expect(await visiblePeople(undefined, privacyPrincipal)).toEqual([learnerB]);
  });

  it('executes row-scope helpers as the constrained authorizer', async () => {
    const regionAccess = await withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: regionalPrincipal },
      async (client) =>
        client.query<{ allowed: boolean }>(
          `SELECT admin.can_access_region($1, 'learner.read') AS allowed`,
          [regionAId]
        )
    );
    expect(regionAccess.rows[0]!.allowed).toBe(true);
  });

  it('binds historical assignment rows to their own region scope', async () => {
    const assignments = await withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: regionalPrincipal },
      async (client) =>
        client.query<{ region_id: string }>(
          `SELECT region_id FROM core.person_region_assignments WHERE person_id = $1`,
          [learnerA]
        )
    );
    expect(assignments.rows.map(({ region_id }) => region_id)).toEqual([regionAId]);
    expect(assignments.rows.map(({ region_id }) => region_id)).not.toContain(regionBId);
  });

  it('revokes privacy scope when its principal is suspended', async () => {
    await pool.query(`UPDATE admin.principals SET status = 'suspended' WHERE id = $1`, [
      privacyPrincipal
    ]);
    expect(await visiblePeople(undefined, privacyPrincipal)).toEqual([]);
    await pool.query(`UPDATE admin.principals SET status = 'active' WHERE id = $1`, [
      privacyPrincipal
    ]);
  });

  it('denies access after a scoped grant expires', async () => {
    await pool.query(
      `UPDATE admin.role_grants SET valid_to = CURRENT_TIMESTAMP
       WHERE principal_id = $1`,
      [regionalPrincipal]
    );
    expect(await visiblePeople(undefined, regionalPrincipal)).toEqual([]);
  });

  it('does not expose protected learner data to the worker role', async () => {
    await expect(
      withRequestContext(
        runtimePool,
        'qigong_worker_runtime',
        { requestId: randomUUID(), personId: learnerA },
        async (client) => client.query(`SELECT id FROM identity.people`)
      )
    ).rejects.toThrow('permission denied to set role');

    const people = await withRequestContext(
      pool,
      'qigong_worker_runtime',
      { requestId: randomUUID(), personId: learnerA },
      async (client) => client.query(`SELECT id FROM identity.people`)
    );
    expect(people.rows).toEqual([]);
  });

  it('clears context after commit and rollback on pooled connections', async () => {
    const requestId = randomUUID();
    await withRequestContext(
      runtimePool,
      'qigong_api_runtime',
      { requestId, personId: learnerA },
      async (client) => {
        const context = await client.query<{ request_id: string }>(
          `SELECT admin.request_id()::text AS request_id`
        );
        expect(context.rows[0]!.request_id).toBe(requestId);
      }
    );
    const afterCommit = await runtimePool.query<{ person_id: string | null; current_user: string }>(
      `SELECT NULLIF(current_setting('qigong.person_id', TRUE), '') AS person_id,
              CURRENT_USER AS current_user`
    );
    expect(afterCommit.rows[0]!.person_id).toBeNull();
    expect(afterCommit.rows[0]!.current_user).not.toBe('qigong_api_runtime');

    await expect(
      withRequestContext(
        runtimePool,
        'qigong_api_runtime',
        { requestId: randomUUID(), personId: learnerB },
        async () => {
          throw new Error('force rollback');
        }
      )
    ).rejects.toThrow('force rollback');
    const afterRollback = await runtimePool.query<{
      person_id: string | null;
      current_user: string;
    }>(
      `SELECT NULLIF(current_setting('qigong.person_id', TRUE), '') AS person_id,
              CURRENT_USER AS current_user`
    );
    expect(afterRollback.rows[0]!.person_id).toBeNull();
    expect(afterRollback.rows[0]!.current_user).not.toBe('qigong_api_runtime');
  });

  it('rejects malformed request context before acquiring a transaction', async () => {
    await expect(
      withRequestContext(
        runtimePool,
        'qigong_api_runtime',
        { requestId: 'not-a-uuid', personId: learnerA },
        async () => undefined
      )
    ).rejects.toThrow('requestId must be a UUID');
  });
});
