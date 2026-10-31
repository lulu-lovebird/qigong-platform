import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import * as database from '@qigong/database';
import type { VenueEntryAvailabilityDto } from '../src/venue-entry-guidance.js';
import {
  buildApp,
  checkStartupReadiness,
  createVenueEntryModeResolver,
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
    throws?: 'window' | 'entry' | 'migration';
    ledgerCount?: number;
    windowGrantees?: readonly string[];
    entryRoleExists?: boolean;
    availability?: VenueEntryAvailabilityDto;
    learner?: 'needs_application' | 'pending' | 'approved' | 'blocked';
  } = {}
) => {
  const query = vi.fn(
    async (
      queryText: string,
      _values?: unknown[]
    ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }> => {
      void _values;
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
        const modern =
          version === '0060_venue_entry_guidance.sql' ||
          version === '0061_venue_attendance_reporting.sql';
        const historical =
          version === '0058_venue_early_checkin_window.sql' ||
          version === '0059_telegram_learner_review.sql';
        const grantees = [
          'qigong_venue_qr_writer',
          'qigong_venue_debug',
          ...(modern ? ['qigong_venue_entry_reader'] : [])
        ];
        const actualGrantees = evidence.windowGrantees ?? grantees;
        const windowReady =
          (historical || modern) &&
          (evidence.ledgerCount ?? Number(version?.slice(0, 4))) === Number(version?.slice(0, 4)) &&
          actualGrantees.length === grantees.length &&
          grantees.every((role) => actualGrantees.includes(role)) &&
          (!modern || evidence.entryRoleExists !== false);
        return {
          rows: [
            {
              ready:
                (evidence[feature] ?? true) &&
                (feature === 'window'
                  ? windowReady
                  : feature === 'entry'
                    ? modern && windowReady
                    : true)
            }
          ]
        };
      }
      if (queryText.includes('schema_migrations')) {
        if (evidence.throws === 'migration') throw new Error('Private ledger diagnostics');
        return { rows: version ? [{ version }] : [] };
      }
      if (queryText === 'SELECT platform.venue_entry_availability($1) AS data') {
        if (!evidence.availability) throw new Error('Unexpected availability operation');
        return { rows: [{ data: evidence.availability }] };
      }
      if (queryText === 'SELECT platform.venue_entry_learner_status($1) AS data') {
        if (!evidence.learner) throw new Error('Unexpected learner operation');
        return { rows: [{ data: { version: 1, status: evidence.learner } }] };
      }
      if (queryText === 'SELECT platform.privacy_usage($1,$2) AS data')
        return { rows: [{ data: { active: false, reflectionConsent: false } }] };
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
    }
  );
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

const guidanceOrigin = 'https://synthetic.invalid';
const guidanceSubject = 'U' + 'a'.repeat(32);
const guidanceCode = 'tw-test-venue';
const guidanceGet = '/api/venue-entry/availability';
const guidancePost = '/api/line/venue-entry-status';
const guidanceHeaders = {
  origin: guidanceOrigin,
  'x-venue-entry': '1',
  'content-type': 'application/json'
};
const guidanceLine = () => ({
  channelSecret: 'synthetic-secret-not-used',
  channelAccessToken: 'synthetic-access-not-used',
  loginChannelId: '123',
  liffId: '123-synthetic',
  verifyIdentity: vi.fn(async () => ({ subject: guidanceSubject })),
  verifyIdToken: vi.fn(async () => {
    throw new Error('Legacy verification forbidden');
  })
});
const businessCalls = (mock: ReturnType<typeof createPoolMock>) =>
  mock.client.query.mock.calls.filter(([sql]) => /^SELECT platform\./.test(sql));
const capabilityCalls = (mock: ReturnType<typeof createPoolMock>) =>
  mock.client.query.mock.calls.map(([sql]) => sql).filter((sql) => sql.includes(' AS ready'));

const enabledFailures = [
  ['0046_achievement_evaluation_and_readers.sql', 'nfc_schema_not_ready'],
  [nfcMigrationVersion, 'nfc_authorization_unavailable'],
  [nfcQuarantineMigrationVersion, 'nfc_security_quarantined']
] as const;

// Test-only lexical guard for these fixed server queries, not a general SQL parser.
const assertGuidanceReadsOnly = (sql: string) => {
  expect(sql).not.toMatch(/refresh_verified_line_profile|begin_privacy_gate|nonce/);
  const withoutValues = sql.replace(/'(?:[^']|'')*'/g, "''");
  expect(withoutValues).not.toMatch(
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/i
  );
};

describe('guidance fixed-query write guard', () => {
  it('accepts quoted privilege labels in a read-only catalog SELECT', () => {
    expect(() =>
      assertGuidanceReadsOnly(
        "SELECT has_table_privilege(1,2,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')"
      )
    ).not.toThrow();
  });
  it.each([
    'UPDATE core.checkins SET practice_date=CURRENT_DATE',
    'INSERT INTO core.checkins DEFAULT VALUES',
    'WITH changed AS (UPDATE core.checkins SET practice_date=CURRENT_DATE RETURNING id) SELECT * FROM changed',
    'SELECT platform.refresh_verified_line_profile($1,$2)',
    'SELECT platform.begin_privacy_gate($1,$2,$3)'
  ])('still rejects a real mutation or forbidden business operation: %s', (sql) => {
    expect(() => assertGuidanceReadsOnly(sql)).toThrow();
  });
});

describe('server-owned venue entry mode resolver (mock metadata, not PostgreSQL)', () => {
  const requestId = '11111111-1111-4111-8111-111111111111';

  it('constructs without I/O and rechecks metadata for every operation', async () => {
    const mock = createPoolMock();
    const resolveMode = createVenueEntryModeResolver(mock.pool);
    expect(mock.connect).not.toHaveBeenCalled();
    expect(mock.directQuery).not.toHaveBeenCalled();
    expect(await resolveMode(requestId)).toBe('guided');
    expect(await resolveMode(requestId)).toBe('guided');
    expect(
      mock.client.query.mock.calls.filter(
        ([sql]) =>
          sql === 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1'
      )
    ).toHaveLength(2);
    expect(capabilityCalls(mock).map((sql) => sql.includes('WITH entry_functions AS'))).toEqual([
      false,
      true,
      false,
      true
    ]);
    expect(businessCalls(mock)).toEqual([]);
    expectNoNfcAccess(mock);
  });

  it.each([
    '0051_venue_qr_attendance.sql',
    '0054_venue_people_read.sql',
    '0055_venue_distance_debug.sql',
    '0056_venue_cks_distance_debug.sql',
    '0057_venue_test_scope.sql'
  ])('exact historical %s is legacy without probing nonexistent helpers', async (version) => {
    const mock = createPoolMock(version, true, { throws: 'window', entryRoleExists: false });
    expect(await createVenueEntryModeResolver(mock.pool)(requestId)).toBe('legacy');
    expect(capabilityCalls(mock)).toEqual([]);
    expect(businessCalls(mock)).toEqual([]);
  });

  it.each(['0058_venue_early_checkin_window.sql', '0059_telegram_learner_review.sql'])(
    '%s requires the two-grantee window gate but never the absent entry role',
    async (version) => {
      const mock = createPoolMock(version, true, { entryRoleExists: false, throws: 'entry' });
      expect(await createVenueEntryModeResolver(mock.pool)(requestId)).toBe('legacy');
      expect(capabilityCalls(mock)).toHaveLength(1);
      expect(capabilityCalls(mock)[0]).toMatch(/^SELECT EXISTS\(/);
      expect(businessCalls(mock)).toEqual([]);
    }
  );

  it.each([
    null,
    minimumMigrationVersion,
    '0049_nfc_security_quarantine.sql',
    '0050_venue_attendance_security_contract.sql',
    '0052_venue_personal_history.sql',
    '0053_venue_management.sql',
    '0051_other.sql',
    '0054_unknown.sql',
    '0058_future.sql',
    '0059_future.sql',
    '0060_unknown.sql',
    '0061_venue_entry_guidance.sql'
  ])(
    'missing, transition or unreviewed %s is unavailable before capability probes',
    async (version) => {
      const mock = createPoolMock(version);
      expect(await createVenueEntryModeResolver(mock.pool)(requestId)).toBe('unavailable');
      expect(capabilityCalls(mock)).toEqual([]);
      expect(businessCalls(mock)).toEqual([]);
    }
  );

  it('honors status.ready=false even with an exact known currentVersion', async () => {
    const mock = createPoolMock();
    const status = vi.spyOn(database, 'getMigrationStatus').mockResolvedValueOnce({
      currentVersion: maximumMigrationVersion,
      minimumVersion: minimumMigrationVersion,
      maximumVersion: maximumMigrationVersion,
      ready: false
    });
    try {
      expect(await createVenueEntryModeResolver(mock.pool)(requestId)).toBe('unavailable');
      expect(status).toHaveBeenCalledWith(
        mock.pool,
        minimumMigrationVersion,
        maximumMigrationVersion,
        'qigong_api_runtime'
      );
      expect(mock.connect).not.toHaveBeenCalled();
    } finally {
      status.mockRestore();
    }
  });

  it.each([
    { throws: 'migration' },
    { window: false },
    { entry: false },
    { throws: 'window' },
    { throws: 'entry' },
    { ledgerCount: 59 },
    { ledgerCount: 61 },
    { entryRoleExists: false },
    { windowGrantees: ['qigong_venue_qr_writer', 'qigong_venue_debug'] },
    {
      windowGrantees: [
        'qigong_venue_qr_writer',
        'qigong_venue_debug',
        'qigong_venue_entry_reader',
        'unexpected_role'
      ]
    }
  ] as const)('schema60 fails closed for missing/partial/error metadata %j', async (evidence) => {
    const mock = createPoolMock('0060_venue_entry_guidance.sql', true, evidence);
    expect(await createVenueEntryModeResolver(mock.pool)(requestId)).toBe('unavailable');
    const probes = capabilityCalls(mock);
    if (!('throws' in evidence && evidence.throws === 'entry') && !('entry' in evidence))
      expect(probes.some((sql) => sql.includes('WITH entry_functions AS'))).toBe(false);
    expect(businessCalls(mock)).toEqual([]);
    expectNoNfcAccess(mock);
  });

  it.each(['0058_venue_early_checkin_window.sql', '0059_telegram_learner_review.sql'])(
    'legacy %s rejects false, partial, unexpected ACL and error window evidence',
    async (version) => {
      for (const evidence of [
        { window: false },
        { ledgerCount: 57 },
        { windowGrantees: ['qigong_venue_qr_writer'] },
        {
          windowGrantees: [
            'qigong_venue_qr_writer',
            'qigong_venue_debug',
            'qigong_venue_entry_reader'
          ]
        },
        { throws: 'window' }
      ] as const) {
        const mock = createPoolMock(version, true, evidence);
        expect(await createVenueEntryModeResolver(mock.pool)(requestId)).toBe('unavailable');
        expect(capabilityCalls(mock)).toHaveLength(1);
        expect(capabilityCalls(mock)[0]).not.toContain('WITH entry_functions AS');
      }
    }
  );
});

describe('guidance API through buildApp (mock SQL and pure LINE identity)', () => {
  const qr = { enabled: true, publicOrigin: guidanceOrigin } as const;

  it('QR+LINE construction, readiness setup and liveness perform no mode SQL or verification', async () => {
    const mock = createPoolMock();
    const line = guidanceLine();
    const app = buildApp({ pool: mock.pool, logger: false, line, venueQr: qr });
    try {
      await app.ready();
      expect(app.hasRoute({ method: 'GET', url: guidanceGet })).toBe(true);
      expect(app.hasRoute({ method: 'POST', url: guidancePost })).toBe(true);
      expect((await app.inject('/health/live')).statusCode).toBe(200);
      expect(mock.connect).not.toHaveBeenCalled();
      expect(mock.directQuery).not.toHaveBeenCalled();
      expect(line.verifyIdentity).not.toHaveBeenCalled();
      expect(line.verifyIdToken).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each(['open', 'before_open', 'ended', 'not_activity_day', 'disabled', 'not_found'] as const)(
    'composed public/direct/primary pages use the authoritative %s calendar without identity work',
    async (availability) => {
      const data: VenueEntryAvailabilityDto = {
        version: 1,
        availability,
        venue:
          availability === 'not_found'
            ? null
            : {
                code: guidanceCode,
                name: 'Synthetic venue',
                timezone: 'Asia/Taipei'
              },
        observedAt:
          availability === 'before_open'
            ? '2032-01-05T00:00:00Z'
            : availability === 'ended'
              ? '2032-01-05T03:00:00Z'
              : '2032-01-05T00:45:00Z',
        relevantSession: ['open', 'before_open', 'ended'].includes(availability)
          ? {
              startsAt: '2032-01-05T01:00:00Z',
              endsAt: '2032-01-05T03:00:00Z',
              opensAt: '2032-01-05T00:30:00Z'
            }
          : null,
        nextSession: null
      };
      const mock = createPoolMock(maximumMigrationVersion, true, { availability: data });
      const line = guidanceLine();
      const app = buildApp({ pool: mock.pool, logger: false, line, venueQr: qr });
      const suffix = '/venue-checkin?venue=' + guidanceCode + '&source=nfc';
      const expected = availability === 'not_found' ? 404 : availability === 'disabled' ? 410 : 200;
      try {
        const portal = await app.inject(suffix);
        expect(portal.statusCode).toBe(expected);
        expect(portal.headers.location).toBeUndefined();
        const direct = await app.inject('/line' + suffix);
        expect(direct.statusCode).toBe(expected);
        expect(direct.headers['permissions-policy']).toBe(
          `geolocation=${availability === 'open' ? '(self)' : '()'}, camera=(), microphone=()`
        );
        if (availability !== 'open') {
          expect(portal.body).not.toMatch(/<a\b|<button\b|<select\b|<input\b|<script\b/);
          expect(direct.body).not.toMatch(/<a\b|<button\b|<select\b|<input\b|<script\b/);
        }
        const primary = await app.inject('/line/?liff.state=' + encodeURIComponent(suffix));
        expect(primary.statusCode).toBe(expected);
        expect(primary.headers.location).toBeUndefined();
        expect(primary.headers['permissions-policy']).toBe(
          'geolocation=(), camera=(), microphone=()'
        );
        expect(primary.body).toContain('withLoginOnExternalBrowser:false');
        expect(primary.body).not.toMatch(/getIDToken|liff\.login|fetch\(|navigator\./);
        expect(businessCalls(mock)).toEqual(
          Array.from({ length: 3 }, () => [
            'SELECT platform.venue_entry_availability($1) AS data',
            [guidanceCode]
          ])
        );
        expect(line.verifyIdentity).not.toHaveBeenCalled();
        expect(line.verifyIdToken).not.toHaveBeenCalled();
        expect(mock.directQuery).not.toHaveBeenCalled();
        for (const [statement] of mock.client.query.mock.calls) assertGuidanceReadsOnly(statement);
      } finally {
        await app.close();
      }
    }
  );

  it.each(['0058_venue_early_checkin_window.sql', '0059_telegram_learner_review.sql'])(
    'composed HTML on verified %s stays legacy and never calls new entry facades',
    async (version) => {
      const mock = createPoolMock(version);
      const line = guidanceLine();
      const app = buildApp({ pool: mock.pool, logger: false, line, venueQr: qr });
      try {
        const portal = await app.inject('/venue-checkin?venue=' + guidanceCode + '&channel=line');
        expect(portal.statusCode).toBe(303);
        expect(portal.headers.location).toMatch(
          /^https:\/\/liff\.line\.me\/123-synthetic\/venue-checkin\?/
        );
        const direct = await app.inject('/line/venue-checkin?venue=' + guidanceCode);
        expect(direct.statusCode).toBe(200);
        expect(direct.body).toContain('id="preview-test"');
        expect(direct.body).not.toContain('id="guided-checkin"');
        expect(direct.headers['permissions-policy']).toBe('geolocation=(self)');
        expect(businessCalls(mock)).toEqual([]);
        expect(capabilityCalls(mock).some((sql) => sql.includes('WITH entry_functions AS'))).toBe(
          false
        );
        expect(line.verifyIdentity).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    }
  );

  it('bad schema60 capability makes composed pages unavailable, never a legacy GPS fallback', async () => {
    const mock = createPoolMock(maximumMigrationVersion, true, { entry: false });
    const line = guidanceLine();
    const app = buildApp({ pool: mock.pool, logger: false, line, venueQr: qr });
    try {
      for (const path of ['/venue-checkin?venue=', '/line/venue-checkin?venue=']) {
        const response = await app.inject(path + guidanceCode);
        expect(response.statusCode).toBe(503);
        expect(response.headers.location).toBeUndefined();
        expect(response.body).not.toMatch(/<script\b|<a\b|<button\b|<select\b|<input\b/);
      }
      expect(businessCalls(mock)).toEqual([]);
      expect(line.verifyIdentity).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('invalid query, identity selectors, body and Origin fail before provider and mode SQL', async () => {
    const mock = createPoolMock();
    const line = guidanceLine();
    const app = buildApp({ pool: mock.pool, logger: false, line, venueQr: qr });
    try {
      for (const query of [
        '',
        '?venue=bad',
        '?venue=' + guidanceCode + '&mode=guided',
        '?venue=' + guidanceCode + '&source=qr',
        '?venue=' + guidanceCode + '&venue=' + guidanceCode
      ]) {
        const response = await app.inject(guidanceGet + query);
        expect(response.statusCode).toBe(400);
        expect(response.headers['cache-control']).toBe('no-store');
      }
      for (const payload of [
        {},
        { idToken: 'synthetic', subject: guidanceSubject },
        { idToken: 'synthetic', mode: 'guided' },
        { idToken: 'synthetic', personId: 'forged' }
      ]) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: guidancePost,
              headers: guidanceHeaders,
              payload
            })
          ).statusCode
        ).toBe(400);
      }
      expect(
        (
          await app.inject({
            method: 'POST',
            url: guidancePost,
            headers: { ...guidanceHeaders, origin: 'https://evil.invalid' },
            payload: { idToken: 'synthetic' }
          })
        ).statusCode
      ).toBe(403);
      expect(mock.connect).not.toHaveBeenCalled();
      expect(mock.directQuery).not.toHaveBeenCalled();
      expect(line.verifyIdentity).not.toHaveBeenCalled();
      expect(line.verifyIdToken).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('provider rejection is 401 after exactly one verification with no mode or private SQL', async () => {
    const mock = createPoolMock();
    const line = guidanceLine();
    line.verifyIdentity.mockRejectedValueOnce(new Error('Private provider diagnostics'));
    const app = buildApp({ pool: mock.pool, logger: false, line, venueQr: qr });
    try {
      const response = await app.inject({
        method: 'POST',
        url: guidancePost,
        headers: guidanceHeaders,
        payload: { idToken: 'synthetic' }
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_line_identity' });
      expect(line.verifyIdentity).toHaveBeenCalledExactlyOnceWith('synthetic');
      expect(mock.connect).not.toHaveBeenCalled();
      expect(line.verifyIdToken).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    ['0051_venue_qr_attendance.sql', {}, 404],
    ['0058_venue_early_checkin_window.sql', {}, 404],
    ['0059_telegram_learner_review.sql', {}, 404],
    [maximumMigrationVersion, { window: false }, 503],
    [maximumMigrationVersion, { entry: false }, 503],
    ['0060_unknown.sql', {}, 503]
  ] as const)(
    '%s rejects unsupported/unready operations without data facades',
    async (version, evidence, status) => {
      const mock = createPoolMock(version, true, evidence);
      const line = guidanceLine();
      const app = buildApp({ pool: mock.pool, logger: false, line, venueQr: qr });
      try {
        for (const response of [
          await app.inject(guidanceGet + '?venue=' + guidanceCode),
          await app.inject({
            method: 'POST',
            url: guidancePost,
            headers: guidanceHeaders,
            payload: { idToken: 'synthetic' }
          })
        ]) {
          expect(response.statusCode).toBe(status);
          expect(response.json()).toEqual({ error: 'venue_entry_unavailable' });
          expect(response.headers['cache-control']).toBe('no-store');
          expect(response.headers['referrer-policy']).toBe('no-referrer');
          expect(response.headers['x-content-type-options']).toBe('nosniff');
        }
        expect(line.verifyIdentity).toHaveBeenCalledExactlyOnceWith('synthetic');
        expect(line.verifyIdToken).not.toHaveBeenCalled();
        expect(businessCalls(mock)).toEqual([]);
      } finally {
        await app.close();
      }
    }
  );

  it.each(['open', 'not_activity_day', 'before_open', 'ended', 'disabled', 'not_found'] as const)(
    'guided GET preserves PostgreSQL calendar DTO %s and ignores caller mode headers',
    async (availability) => {
      const session = {
        startsAt: '2032-01-05T01:00:00Z',
        endsAt: '2032-01-05T03:00:00Z',
        opensAt: '2032-01-05T00:30:00Z'
      };
      const data: VenueEntryAvailabilityDto = {
        version: 1,
        availability,
        venue:
          availability === 'not_found'
            ? null
            : { code: guidanceCode, name: 'Synthetic venue', timezone: 'Asia/Taipei' },
        observedAt: '2032-01-05T00:45:00Z',
        relevantSession: ['open', 'before_open', 'ended'].includes(availability) ? session : null,
        nextSession: null
      };
      const mock = createPoolMock(maximumMigrationVersion, true, { availability: data });
      const line = guidanceLine();
      const app = buildApp({ pool: mock.pool, logger: false, line, venueQr: qr });
      try {
        const response = await app.inject({
          url: guidanceGet + '?venue=' + guidanceCode,
          headers: {
            origin: 'https://evil.invalid',
            host: 'caller.invalid',
            'x-venue-entry-mode': 'legacy',
            'x-line-access-token': 'synthetic'
          }
        });
        expect(response.statusCode).toBe(
          availability === 'not_found' ? 404 : availability === 'disabled' ? 410 : 200
        );
        expect(response.json()).toEqual(data);
        expect(businessCalls(mock)).toEqual([
          ['SELECT platform.venue_entry_availability($1) AS data', [guidanceCode]]
        ]);
        const sql = mock.client.query.mock.calls.map(([text]) => text);
        expect(sql.findIndex((text) => text.includes('WITH entry_functions AS'))).toBeLessThan(
          sql.indexOf('SELECT platform.venue_entry_availability($1) AS data')
        );
        expect(line.verifyIdentity).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    }
  );

  it.each(['needs_application', 'pending', 'approved', 'blocked'] as const)(
    'self %s verifies once, then resolves mode, then reads only the verified subject',
    async (learner) => {
      const mock = createPoolMock(maximumMigrationVersion, true, { learner });
      const line = guidanceLine();
      const app = buildApp({ pool: mock.pool, logger: false, line, venueQr: qr });
      try {
        const response = await app.inject({
          method: 'POST',
          url: guidancePost,
          headers: {
            ...guidanceHeaders,
            'x-venue-entry-mode': 'legacy',
            'x-line-user-id': 'forged'
          },
          payload: { idToken: 'synthetic' }
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          version: 1,
          status: learner,
          privacy: learner === 'approved' ? 'clear' : null
        });
        expect(line.verifyIdentity).toHaveBeenCalledExactlyOnceWith('synthetic');
        expect(line.verifyIdToken).not.toHaveBeenCalled();
        expect(line.verifyIdentity.mock.invocationCallOrder[0]).toBeLessThan(
          mock.connect.mock.invocationCallOrder[0] ?? 0
        );
        expect(businessCalls(mock)).toEqual([
          ['SELECT platform.venue_entry_learner_status($1) AS data', [guidanceSubject]],
          ...(learner === 'approved'
            ? [['SELECT platform.privacy_usage($1,$2) AS data', ['line', guidanceSubject]]]
            : [])
        ]);
        const sql = mock.client.query.mock.calls.map(([text]) => text);
        expect(sql.findIndex((text) => text.includes('WITH entry_functions AS'))).toBeLessThan(
          sql.indexOf('SELECT platform.venue_entry_learner_status($1) AS data')
        );
        for (const statement of sql) assertGuidanceReadsOnly(statement);
      } finally {
        await app.close();
      }
    }
  );
});

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

  it('keeps the reviewed schema61 maximum explicit without enabling Telegram review', () => {
    expect(maximumMigrationVersion).toBe('0061_venue_attendance_reporting.sql');
  });

  it.each([
    '0058_venue_early_checkin_window.sql',
    '0059_telegram_learner_review.sql',
    '0060_venue_entry_guidance.sql',
    '0061_venue_attendance_reporting.sql'
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
        version.startsWith('0060_') || version.startsWith('0061_') ? 1 : 0
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
      const mock = createPoolMock('0060_venue_entry_guidance.sql', true, evidence);
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
