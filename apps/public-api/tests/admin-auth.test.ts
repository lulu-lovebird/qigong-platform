import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { buildApp } from '../src/app.js';
import type { AdminAuthProvider } from '../src/admin-auth.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);

describeWithDatabase('Authgear administrator HTTP boundary', () => {
  let pool: Pool;
  let runtimePool: Pool;
  let adminRole: string;
  let databaseName: string;
  const provider: AdminAuthProvider = {
    callbackUrl: 'https://platform.example.com/admin/auth/callback',
    begin: vi.fn(async (_verifier, state, nonce) => {
      expect(nonce).toBeTruthy();
      return new URL(`https://admin.example.com/authorize?state=${state}`);
    }),
    complete: vi.fn(async () => ({ iss: 'https://admin.example.com', sub: 'regional-admin' }))
  };

  beforeAll(async () => {
    const maintenance = new pg.Client({ connectionString: databaseUrl });
    await maintenance.connect();
    databaseName = `qigong_auth_http_test_${randomUUID().replaceAll('-', '')}`;
    await maintenance.query(`CREATE DATABASE ${databaseName}`);
    await maintenance.end();
    const url = new URL(databaseUrl!);
    url.pathname = `/${databaseName}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    await runMigrations(pool, migrationsDirectory, 'vitest');
    adminRole = `qigong_http_${randomUUID().replaceAll('-', '')}`;
    const password = randomUUID().replaceAll('-', '');
    await pool.query(`CREATE ROLE ${adminRole} LOGIN PASSWORD '${password}' NOINHERIT NOBYPASSRLS`);
    await pool.query(`GRANT qigong_api_runtime TO ${adminRole}`);
    url.username = adminRole;
    url.password = password;
    runtimePool = new pg.Pool({ connectionString: url.toString() });
    const global = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (code, region_type, name_zh_tw, name_en)
       VALUES ('http-global', 'global', '全球', 'Global') RETURNING id`
    );
    const country = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'http-country', 'country', '國家', 'Country') RETURNING id`,
      [global.rows[0]!.id]
    );
    const regions = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'http-a', 'operational', '甲', 'A'),
              ($1, 'http-b', 'operational', '乙', 'B') RETURNING id`,
      [country.rows[0]!.id]
    );
    const principal = await pool.query<{ id: string }>(
      `INSERT INTO admin.principals (oidc_issuer, oidc_subject, display_name)
       VALUES ('https://admin.example.com', 'regional-admin', 'Administrator') RETURNING id`
    );
    await pool.query(
      `INSERT INTO admin.role_grants (principal_id, role_id, scope_type, region_id, reason)
       SELECT $1, id, 'region', $2, 'provisioned' FROM admin.roles WHERE code = 'regional_admin'`,
      [principal.rows[0]!.id, regions.rows[0]!.id]
    );
    for (const [index, subject] of ['learner-a', 'learner-b'].entries()) {
      await withRequestContext(
        pool,
        'qigong_worker_runtime',
        { requestId: randomUUID() },
        (client) =>
          client.query('SELECT identity.submit_application($1, $2, $3, $4)', [
            'line',
            subject,
            'New learner',
            regions.rows[index]!.id
          ])
      );
    }
  });

  afterAll(async () => {
    await runtimePool.end();
    await pool.query(`DROP OWNED BY ${adminRole}`);
    await pool.query(`DROP ROLE ${adminRole}`);
    await pool.end();
    const admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE ${databaseName}`);
    await admin.end();
  });

  it('requires login and CSRF, then limits review to the assigned region', async () => {
    const app = buildApp({ pool: runtimePool, adminAuth: provider, logger: false });
    expect((await app.inject({ method: 'GET', url: '/admin/api/applications' })).statusCode).toBe(
      401
    );
    const login = await app.inject({ method: 'GET', url: '/admin/auth/login' });
    expect(login.statusCode).toBe(302);
    const state = new URL(login.headers.location!).searchParams.get('state')!;
    const callback = await app.inject({
      method: 'GET',
      url: `/admin/auth/callback?state=${state}&code=fake-code`,
      headers: { cookie: `__Host-qigong-admin-state=${state}` }
    });
    expect(callback.statusCode).toBe(302);
    const issued = callback.headers['set-cookie'];
    expect(Array.isArray(issued)).toBe(true);
    const values = (issued as string[]).map((header) => header.split(';')[0]!).join('; ');
    const csrf = values.match(/__Host-qigong-admin-csrf=([^;]+)/)?.[1];
    const list = await app.inject({
      method: 'GET',
      url: '/admin/api/applications',
      headers: { cookie: values }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().applications).toHaveLength(1);
    const other = await pool.query<{ id: string }>(
      `SELECT id FROM identity.onboarding_applications WHERE external_subject_id = 'learner-b'`
    );
    const url = `/admin/api/applications/${other.rows[0]!.id}/decision`;
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { cookie: values },
          payload: { decision: 'approved' }
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: { cookie: values, 'x-csrf-token': csrf! },
          payload: { decision: 'approved' }
        })
      ).statusCode
    ).toBe(409);
    const own = list.json().applications[0].id as string;
    const approved = await app.inject({
      method: 'POST',
      url: `/admin/api/applications/${own}/decision`,
      headers: { cookie: values, 'x-csrf-token': csrf! },
      payload: { decision: 'approved' }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().personId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/auth/logout',
          headers: { cookie: values, 'x-csrf-token': csrf! }
        })
      ).statusCode
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/admin/auth/me', headers: { cookie: values } }))
        .statusCode
    ).toBe(401);
    await app.close();
  });
});
