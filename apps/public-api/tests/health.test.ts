import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  buildApp,
  checkStartupReadiness,
  minimumMigrationVersion,
  maximumMigrationVersion
} from '../src/app.js';
import { nfcMigrationVersion, nfcQuarantineMigrationVersion } from '../src/admin-auth.js';

beforeEach(() => {
  vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('External API calls are forbidden in these isolated tests');
    })
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const createPoolMock = (
  version: string | null = maximumMigrationVersion,
  preflightReady = true
) => {
  const query = vi.fn(async (queryText: string) => {
    // Readiness must never probe NFC relations, even with LIMIT 0 or missing permissions.
    if (/core\.(practice_fields|field_attendance)|pg_index/.test(queryText)) {
      throw new Error('NFC table and index probes are forbidden');
    }
    if (queryText.includes('schema_migrations')) return { rows: version ? [{ version }] : [] };
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
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  const directQuery = vi.fn(async (sql: string) => {
    if (sql !== 'SELECT 1') throw new Error('Unexpected direct pool query');
    return { rows: [{ '?column?': 1 }] };
  });
  const connect = vi.fn(async () => client);
  return {
    pool: { query: directQuery, connect } as unknown as Pool,
    client,
    directQuery,
    connect
  };
};

const expectNoNfcAccess = (mock: ReturnType<typeof createPoolMock>) => {
  for (const [sql] of mock.client.query.mock.calls) {
    expect(sql).not.toMatch(/core\.(practice_fields|field_attendance)|pg_index/);
  }
  expect(mock.directQuery.mock.calls.every(([sql]) => sql === 'SELECT 1')).toBe(true);
};

const enabledFailures = [
  ['0046_achievement_evaluation_and_readers.sql', 'nfc_schema_not_ready'],
  [nfcMigrationVersion, 'nfc_authorization_unavailable'],
  [nfcQuarantineMigrationVersion, 'nfc_security_quarantined']
] as const;

describe('health endpoints', () => {
  it('reports liveness without checking dependencies', async () => {
    const mock = createPoolMock();
    const app = buildApp({ pool: mock.pool, serviceVersion: 'test', logger: false });
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, version: 'test' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(mock.directQuery).not.toHaveBeenCalled();
    expect(mock.connect).not.toHaveBeenCalled();
    await app.close();
  });

  it('accepts only UUID request IDs', async () => {
    const app = buildApp({ pool: createPoolMock().pool, logger: false });
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

  it.each([
    minimumMigrationVersion,
    '0043_achievement_rule_versions.sql',
    '0044_achievement_publication_candidates.sql',
    '0045_versioned_achievement_runtime.sql',
    '0046_achievement_evaluation_and_readers.sql',
    nfcMigrationVersion,
    nfcQuarantineMigrationVersion
  ])('accepts %s at startup and health without NFC access when off', async (version) => {
    const mock = createPoolMock(version);
    const app = buildApp({ pool: mock.pool, logger: false });
    try {
      await expect(app.ready()).resolves.toBe(app);
      expect(mock.connect).not.toHaveBeenCalled();
      expect(await checkStartupReadiness(mock.pool)).toMatchObject({
        ready: true,
        migration: { currentVersion: version, minimumVersion: minimumMigrationVersion }
      });
      const response = await app.inject('/health/ready');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, migration: { currentVersion: version } });
      expect((await app.inject('/health/live')).statusCode).toBe(200);
      expect((await app.inject('/api/v1/fields/active')).statusCode).toBe(404);
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/field-checkin', payload: {} })).statusCode
      ).toBe(404);
      expectNoNfcAccess(mock);
    } finally {
      await app.close();
    }
  });

  it.each(enabledFailures)(
    'rejects explicit NFC in startup preflight and buildApp for %s as %s',
    async (version, reason) => {
      vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', 'true');
      const mock = createPoolMock(version);
      expect(await checkStartupReadiness(mock.pool)).toMatchObject({ ready: false, reason });
      const app = buildApp({ pool: mock.pool, logger: false });
      try {
        await expect(app.ready()).rejects.toThrow(reason);
        expect(app.hasRoute({ method: 'GET', url: '/api/v1/fields/active' })).toBe(false);
        expect(app.hasRoute({ method: 'POST', url: '/api/v1/field-checkin' })).toBe(false);
        expectNoNfcAccess(mock);
        expect(mock.directQuery).not.toHaveBeenCalled();
        expect(mock.client.query).toHaveBeenCalledWith('SET LOCAL ROLE qigong_api_runtime');
        expect(mock.client.release).toHaveBeenCalledTimes(mock.connect.mock.calls.length);
      } finally {
        await app.close();
      }
    }
  );

  it.each(enabledFailures)(
    'health fails closed if NFC is enabled after default-off startup on %s',
    async (version, reason) => {
      const mock = createPoolMock(version);
      const app = buildApp({ pool: mock.pool, logger: false });
      try {
        await app.ready();
        vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', 'true');
        const response = await app.inject('/health/ready');
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({ ok: false, reason });
        expect((await app.inject('/api/v1/fields/active')).statusCode).toBe(404);
        expectNoNfcAccess(mock);
      } finally {
        await app.close();
      }
    }
  );

  it.each([undefined, 'true'])(
    'rejects unknown future schema versions with NFC setting %s',
    async (setting) => {
      vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', setting);
      for (const version of ['0048_future.sql', '0048_z_future.sql', '0049_future.sql']) {
        const mock = createPoolMock(version);
        expect(await checkStartupReadiness(mock.pool)).toMatchObject({
          ready: false,
          reason: 'schema_version_mismatch',
          migration: { ready: false }
        });
        const app = buildApp({ pool: mock.pool, logger: false });
        try {
          if (setting === 'true') {
            await expect(app.ready()).rejects.toThrow('nfc_schema_not_ready');
          } else {
            const response = await app.inject('/health/ready');
            expect(response.statusCode).toBe(503);
            expect(response.json()).toMatchObject({ reason: 'schema_version_mismatch' });
          }
          expectNoNfcAccess(mock);
        } finally {
          await app.close();
        }
      }
    }
  );

  it.each([null, '0002_identity_region_rbac.sql', '0041_independent_activity_drafts.sql'])(
    'preserves the minimum schema policy for %s',
    async (version) => {
      const mock = createPoolMock(version);
      const app = buildApp({ pool: mock.pool, logger: false });
      const response = await app.inject('/health/ready');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ reason: 'schema_version_mismatch' });
      expectNoNfcAccess(mock);
      await app.close();
    }
  );

  it('fails readiness when the login cannot assume the API runtime role', async () => {
    const mock = createPoolMock(maximumMigrationVersion, false);
    const app = buildApp({ pool: mock.pool, logger: false });
    const response = await app.inject('/health/ready');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ reason: 'database_unavailable' });
    expectNoNfcAccess(mock);
    await app.close();
  });
});
