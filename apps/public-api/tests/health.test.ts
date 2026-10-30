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
  preflightReady = true,
  evidence: {
    window?: boolean;
    entry?: boolean;
    feature?: boolean;
    throws?: 'window' | 'entry';
  } = {}
) => {
  const query = vi.fn(async (queryText: string) => {
    // Readiness must never probe NFC relations, even with LIMIT 0 or missing permissions.
    if (/core\.(practice_fields|field_attendance)|pg_index/.test(queryText)) {
      throw new Error('NFC table and index probes are forbidden');
    }
    if (queryText.includes(' AS ready')) {
      const feature = queryText.includes('WITH entry_functions AS')
        ? 'entry'
        : queryText.startsWith('SELECT EXISTS(')
          ? 'window'
          : 'feature';
      if (feature === evidence.throws) throw new Error('Private catalog diagnostics');
      return { rows: [{ ready: evidence[feature] ?? true }] };
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
    '0047_channel_invitations.sql',
    nfcMigrationVersion,
    nfcQuarantineMigrationVersion,
    '0058_venue_early_checkin_window.sql',
    '0059_telegram_learner_review.sql',
    maximumMigrationVersion
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
      for (const version of [
        '0042_future.sql',
        '0046_future.sql',
        '0047_future.sql',
        '0048_future.sql',
        '0048_z_future.sql',
        '0049_future.sql',
        '0050_venue_attendance_security_contract.sql',
        '0050_other.sql',
        '0051_other.sql',
        '0051_z_future.sql',
        '0052_future.sql',
        '0059_future.sql',
        '0060_future.sql',
        '0061_future.sql'
      ]) {
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

  it('keeps the reviewed schema60 maximum explicit without enabling Telegram review', () => {
    expect(maximumMigrationVersion).toBe('0060_venue_entry_guidance.sql');
  });

  it.each([
    '0058_venue_early_checkin_window.sql',
    '0059_telegram_learner_review.sql',
    '0060_venue_entry_guidance.sql'
  ])(
    'default-off build, liveness and ordinary public preview use zero DB on %s',
    async (version) => {
      const mock = createPoolMock(version);
      const app = buildApp({ pool: mock.pool, logger: false });
      try {
        await app.ready();
        expect((await app.inject('/health/live')).statusCode).toBe(200);
        expect((await app.inject('/venue-checkin?venue=tw-synthetic&source=nfc')).statusCode).toBe(
          200
        );
        expect(
          (await app.inject('/api/venue-entry/availability?venue=tw-synthetic')).statusCode
        ).toBe(404);
        expect(mock.connect).not.toHaveBeenCalled();
        expect(mock.directQuery).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    }
  );

  it.each([
    '0058_venue_early_checkin_window.sql',
    '0059_telegram_learner_review.sql',
    '0060_venue_entry_guidance.sql'
  ])(
    'QR readiness requires version-specific evidence on %s (mock catalog replies)',
    async (version) => {
      const mock = createPoolMock(version);
      expect(await checkStartupReadiness(mock.pool, true)).toMatchObject({ ready: true });
      const probes = mock.client.query.mock.calls
        .map(([sql]) => sql)
        .filter((sql) => sql.includes(' AS ready'));
      expect(probes.filter((sql) => sql.startsWith('SELECT EXISTS('))).toHaveLength(1);
      expect(probes.filter((sql) => sql.includes('WITH entry_functions AS'))).toHaveLength(
        version.startsWith('0060_') ? 1 : 0
      );
      expectNoNfcAccess(mock);
    }
  );

  it.each([
    ['window', { window: false }],
    ['entry', { entry: false }],
    ['window', { throws: 'window' }],
    ['entry', { throws: 'entry' }]
  ] as const)(
    'schema60 QR fails closed for %s missing/error evidence',
    async (feature, evidence) => {
      const mock = createPoolMock(maximumMigrationVersion, true, evidence);
      expect(await checkStartupReadiness(mock.pool, true)).toMatchObject({
        ready: false,
        reason: 'venue_feature_not_ready',
        capability: { feature, ready: false }
      });
      expectNoNfcAccess(mock);
    }
  );

  it.each(['0058_venue_early_checkin_window.sql', '0059_telegram_learner_review.sql'])(
    'legacy QR never probes absent entry objects on %s',
    async (version) => {
      const mock = createPoolMock(version, true, { throws: 'entry' });
      expect(await checkStartupReadiness(mock.pool, true)).toMatchObject({ ready: true });
      expect(
        mock.client.query.mock.calls.some(([sql]) => sql.includes('WITH entry_functions AS'))
      ).toBe(false);
    }
  );

  it('QR-off schema60 does not probe entry, including when independent history is enabled', async () => {
    const mock = createPoolMock(maximumMigrationVersion, true, { throws: 'entry' });
    expect(
      await checkStartupReadiness(mock.pool, false, {
        history: { enabled: true, publicOrigin: 'https://synthetic.invalid' }
      })
    ).toMatchObject({ ready: true });
    expect(
      mock.client.query.mock.calls.some(([sql]) => sql.includes('WITH entry_functions AS'))
    ).toBe(false);
  });

  it.each(['0060_unknown.sql', '0061_venue_entry_guidance.sql'])(
    'QR rejects unreviewed/future %s before probing capabilities',
    async (version) => {
      const mock = createPoolMock(version);
      expect(await checkStartupReadiness(mock.pool, true)).toMatchObject({
        ready: false,
        reason: 'schema_version_mismatch'
      });
      expect(mock.client.query.mock.calls.some(([sql]) => sql.includes(' AS ready'))).toBe(false);
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
