import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { buildApp, checkStartupReadiness, maximumMigrationVersion } from '../src/app.js';

beforeEach(() => vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', undefined));
afterEach(() => vi.unstubAllEnvs());

type NfcSchema = 'ready' | 'missing_columns' | 'missing_index' | 'missing_result';

const createPoolMock = (
  version = maximumMigrationVersion,
  preflightReady = true,
  nfcSchema: NfcSchema | (() => NfcSchema) = 'ready'
) => {
  const query = vi.fn(async (queryText: string) => {
    const schema = typeof nfcSchema === 'function' ? nfcSchema() : nfcSchema;
    if (queryText.includes('schema_migrations')) return { rows: [{ version }] };
    if (queryText.includes('LIMIT 0') && schema === 'missing_columns') {
      throw new Error('NFC relation, column or runtime SELECT privilege missing');
    }
    if (queryText.includes('FROM pg_index')) {
      return {
        rows: schema === 'missing_result' ? [] : [{ ready: schema !== 'missing_index' }]
      };
    }
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
    expect(Reflect.get(pool, 'query')).not.toHaveBeenCalled();
    expect(Reflect.get(pool, 'connect')).not.toHaveBeenCalled();
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

  it.each(['0046_achievement_evaluation_and_readers.sql', maximumMigrationVersion])(
    'accepts %s without NFC schema access when NFC is off',
    async (version) => {
      const pool = createPoolMock(version, true, 'missing_columns');
      const app = buildApp({ pool, logger: false });
      const response = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, migration: { currentVersion: version } });
      const client = await pool.connect();
      expect(Reflect.get(client, 'query')).not.toHaveBeenCalledWith(
        expect.stringContaining('core.practice_fields')
      );
      expect(Reflect.get(client, 'query')).not.toHaveBeenCalledWith(
        expect.stringContaining('FROM pg_index')
      );
      await app.close();
    }
  );

  it('accepts explicitly enabled NFC only when 0047 schema probes succeed', async () => {
    vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', 'true');
    const app = buildApp({ pool: createPoolMock(), logger: false });
    const response = await app.inject('/health/ready');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    await app.close();
  });

  it.each([
    ['0046_achievement_evaluation_and_readers.sql', 'ready'],
    [maximumMigrationVersion, 'missing_columns'],
    [maximumMigrationVersion, 'missing_index'],
    [maximumMigrationVersion, 'missing_result']
  ] as const)('fails startup readiness for enabled NFC with %s / %s', async (version, schema) => {
    vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', 'true');
    expect(await checkStartupReadiness(createPoolMock(version, true, schema))).toMatchObject({
      ready: false,
      reason: 'nfc_schema_not_ready'
    });
  });

  it('fails NFC health readiness if the schema becomes inaccessible after startup', async () => {
    vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', 'true');
    let schemaAvailable = true;
    const pool = createPoolMock(maximumMigrationVersion, true, () =>
      schemaAvailable ? 'ready' : 'missing_columns'
    );
    const app = buildApp({ pool, logger: false });
    await app.ready();
    schemaAvailable = false;
    const response = await app.inject('/health/ready');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ ok: false, reason: 'nfc_schema_not_ready' });
    await app.close();
  });

  it('still rejects schema versions newer than 0047', async () => {
    const app = buildApp({ pool: createPoolMock('0048_future.sql'), logger: false });
    const response = await app.inject('/health/ready');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ reason: 'schema_version_mismatch' });
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
    expect(response.json()).toMatchObject({ reason: 'database_unavailable' });
    await app.close();
  });
});
