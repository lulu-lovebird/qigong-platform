import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildApp, maximumMigrationVersion } from '../src/app.js';

const createPoolMock = (version = maximumMigrationVersion, preflightReady = true) => {
  const query = vi.fn(async (queryText: string) => {
    if (queryText.includes('schema_migrations')) return { rows: [{ version }] };
    if (queryText.includes('FROM pg_roles')) {
      return {
        rows: [
          {
            session_user: 'qigong_api_login',
            rolsuper: false,
            rolbypassrls: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: false,
            rolinherit: false
          }
        ]
      };
    }
    if (queryText.includes('FROM pg_shdepend')) return { rows: [{ unsafe: false }] };
    if (queryText.includes('FROM pg_auth_members')) {
      return { rows: [{ role_name: 'qigong_api_runtime' }] };
    }
    if (queryText.includes('SET LOCAL ROLE qigong_api_runtime') && !preflightReady) {
      throw new Error('permission denied to set role');
    }
    if (queryText.includes('identity.people')) return { rows: [], rowCount: 0 };
    return { rows: [{ '?column?': 1 }] };
  });
  const client = { query, release: vi.fn() };
  return {
    query: vi.fn(async (queryText: string) => {
      if (queryText.includes('schema_migrations')) return { rows: [{ version }] };
      return { rows: [{ '?column?': 1 }] };
    }),
    connect: vi.fn(async () => client)
  } as unknown as Pool;
};

describe('health endpoints', () => {
  it('reports liveness without checking dependencies', async () => {
    const pool = createPoolMock();
    const app = buildApp({ pool, serviceVersion: 'test', logger: false });
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, version: 'test' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(pool.query).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts only UUID request IDs', async () => {
    const app = buildApp({ pool: createPoolMock(), logger: false });
    const valid = '123e4567-e89b-42d3-a456-426614174000';
    const accepted = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': valid }
    });
    const replaced = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'predictable-id' }
    });
    expect(accepted.headers['x-request-id']).toBe(valid);
    expect(replaced.headers['x-request-id']).not.toBe('predictable-id');
    await app.close();
  });

  it('reports readiness when database and migrations are current', async () => {
    const app = buildApp({ pool: createPoolMock(), logger: false });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    await app.close();
  });

  it('fails readiness before runtime RLS is installed', async () => {
    const app = buildApp({ pool: createPoolMock('0002_identity_region_rbac.sql'), logger: false });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ reason: 'schema_version_mismatch' });
    await app.close();
  });

  it('fails readiness when the login cannot assume the API runtime role', async () => {
    const app = buildApp({ pool: createPoolMock(maximumMigrationVersion, false), logger: false });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ reason: 'runtime_role_misconfigured' });
    await app.close();
  });
});
