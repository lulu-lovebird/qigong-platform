/** Real buildApp/VM composition; SQL and LINE are MOCKED, not PostgreSQL.
 * New catalog SQL still requires reviewed PG QA; older function/RLS PG evidence
 * does not execute or prove these readiness predicates. */
import type { Pool } from '@qigong/database';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, checkStartupReadiness } from '../src/app.js';
import type { AdminAuthProvider } from '../src/admin-auth.js';
import {
  venueSuiteMigrationVersion,
  venueEntryGuidanceMigrationVersion,
  type VenueSuiteConfig
} from '../src/venue-suite.js';
import { venueDebugMigrationVersion } from '../src/venue-debug.js';

const origin = 'https://synthetic.invalid';
const subject = 'U' + 'a'.repeat(32);
const principal = '10000000-0000-4000-8000-000000000001';
const personId = '20000000-0000-4000-8000-000000000001';
const session = 's'.repeat(43),
  csrf = 'c'.repeat(43);
const enabled = { enabled: true, publicOrigin: origin } as const;
const auth: AdminAuthProvider = {
  callbackUrl: origin + '/admin/auth/callback',
  begin: async () => new URL(origin),
  complete: async () => ({ iss: origin, sub: 'synthetic' })
};
const line = {
  channelSecret: 'synthetic-secret-not-used',
  channelAccessToken: 'synthetic-access-not-used',
  loginChannelId: '123',
  liffId: '123-synthetic',
  verifyIdentity: vi.fn(async () => ({ subject }))
};
const fixture = (version = venueDebugMigrationVersion, capable = true) => {
  const managed: { value: { code: string; name: string; active: boolean } | null; fail: boolean } =
    {
      value: { code: 'tw-test-one', name: '<Synthetic venue>', active: true },
      fail: false
    };
  const permissions = {
    management: true,
    canReadPeople: true,
    canExportPeople: false,
    fail: false,
    revoked: false
  };
  const unavailableFunctions = new Set<string>();
  // This is a deliberately explicit mock evidence model, NOT a SQL evaluator.
  const catalog = {
    ledgerCount: Number(version.slice(0, 4)),
    windowGrantees: new Set([
      'qigong_venue_qr_writer',
      'qigong_venue_debug',
      ...(version === venueEntryGuidanceMigrationVersion ? ['qigong_venue_entry_reader'] : [])
    ]),
    entryRoleExists: version === venueEntryGuidanceMigrationVersion,
    entryValid: true,
    failures: new Set<string>(),
    errors: new Set<string>()
  };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes('WITH eligible')) {
      if (permissions.fail) throw new Error('private catalog diagnostics');
      return {
        rows: permissions.management
          ? [
              {
                id: personId,
                displayName: '<Synthetic region>',
                countryName: 'Synthetic country',
                code: 'synthetic-region',
                canRead: true,
                canManage: false
              }
            ]
          : []
      };
    }
    if (sql.includes(' AS management,')) {
      if (permissions.fail) throw new Error('private permission diagnostics');
      const allowed = !values?.length || values[0] === personId;
      return {
        rows: [
          {
            management: allowed && permissions.management,
            canReadPeople: allowed && permissions.canReadPeople,
            canExportPeople: allowed && permissions.canExportPeople
          }
        ]
      };
    }
    if (sql.includes('venue_people_read(')) {
      if (values?.[0] !== session || permissions.revoked)
        throw Object.assign(new Error('session rejected'), { code: '28000' });
      const exporting = values?.[12] === true;
      if (
        values?.[1] !== personId ||
        !(exporting ? permissions.canExportPeople : permissions.canReadPeople)
      )
        throw Object.assign(new Error('scope rejected'), { code: '42501' });
      return {
        rows: [
          {
            data: {
              version: 1,
              regionId: values?.[1],
              from: values?.[2],
              until: values?.[3],
              fieldId: values?.[4],
              personId: values?.[5],
              search: values?.[6],
              mode: values?.[7],
              sort: values?.[8],
              direction: values?.[9],
              page: exporting ? 1 : values?.[10],
              limit: exporting ? 1000 : values?.[11],
              exporting,
              total: 1,
              totals: { attendanceCount: 1, attendanceDays: 1, learnerCount: 1 },
              rows: [
                {
                  personId,
                  name: '<Synthetic learner>',
                  attendanceCount: 1,
                  attendanceDays: 1,
                  latestDate: '2026-10-01'
                }
              ]
            }
          }
        ]
      };
    }
    if (sql.includes('venue_management_lookup')) {
      if (managed.fail) throw new Error('private diagnostics');
      return { rows: [{ data: managed.value }] };
    }
    if (sql.includes(' AS ready')) {
      const kind = sql.includes('WITH entry_functions AS')
        ? 'entry'
        : sql.startsWith('SELECT EXISTS(')
          ? 'window'
          : 'feature';
      if (catalog.errors.has(kind)) throw new Error('Private readiness catalog diagnostics');
      if (
        !catalog.entryRoleExists &&
        /has_function_privilege\('qigong_venue_entry_reader'/.test(sql)
      )
        throw Object.assign(new Error('missing role'), { code: '42704' });
      const historical =
        version === venueDebugMigrationVersion || version === '0059_telegram_learner_review.sql';
      const modern = version === venueEntryGuidanceMigrationVersion;
      const grantees = [
        'qigong_venue_qr_writer',
        'qigong_venue_debug',
        ...(modern ? ['qigong_venue_entry_reader'] : [])
      ];
      const validWindow =
        (historical || modern) &&
        catalog.ledgerCount === Number(version.slice(0, 4)) &&
        catalog.windowGrantees.size === grantees.length &&
        grantees.every((r) => catalog.windowGrantees.has(r)) &&
        (!modern || catalog.entryRoleExists) &&
        !unavailableFunctions.has('platform.venue_checkin_window(jsonb,text,timestamptz)');
      const functions =
        values?.[0] ??
        (sql.includes('platform.venue_checkin_window(jsonb,text,timestamptz)')
          ? ['platform.venue_checkin_window(jsonb,text,timestamptz)']
          : undefined);
      return {
        rows: [
          {
            ready:
              capable &&
              !catalog.failures.has(kind) &&
              (kind === 'window'
                ? validWindow
                : kind === 'entry'
                  ? modern && validWindow && catalog.entryValid
                  : !(historical || modern) || validWindow) &&
              Array.isArray(functions) &&
              !functions.some(
                (signature: unknown) =>
                  typeof signature === 'string' && unavailableFunctions.has(signature)
              )
          }
        ]
      };
    }
    if (sql.includes('schema_migrations')) return { rows: [{ version }] };
    if (sql.includes('FROM pg_roles'))
      return {
        rows: [
          {
            session_user: 'synthetic_login',
            rolsuper: false,
            rolbypassrls: false,
            rolcreatedb: false,
            rolcreaterole: false,
            rolreplication: false,
            rolinherit: false
          }
        ]
      };
    if (sql.includes('FROM pg_shdepend')) return { rows: [{ unsafe: false }] };
    if (sql.includes('FROM pg_auth_members'))
      return { rows: [{ role_name: 'qigong_api_runtime' }] };
    if (sql.includes('session_principal'))
      return {
        rows: [{ principal_id: values?.[0] === session && !permissions.revoked ? principal : null }]
      };
    if (sql.includes('resolve_line_learner_identity'))
      return {
        rows: [
          {
            data: {
              subject,
              personId,
              identityId: '30000000-0000-4000-8000-000000000001',
              revoked: false,
              learnerActive: true,
              channelActive: true,
              applicationApproved: true
            }
          }
        ]
      };
    if (sql.includes('privacy_usage'))
      return { rows: [{ data: { active: false, reflectionConsent: true } }] };
    if (sql.includes('venue_personal_history'))
      return {
        rows: [
          {
            data: {
              ok: true,
              timezone: 'Asia/Taipei',
              totals: { attendanceCount: 0, attendanceDays: 0, monthCount: 0 },
              page: 1,
              pageSize: 20,
              hasMore: false,
              entries: []
            }
          }
        ]
      };
    return { rows: [], rowCount: 0 };
  });
  const connect = vi.fn(async () => ({ query, release: vi.fn() }));
  const directQuery = vi.fn(async () => ({ rows: [] }));
  const pool = { connect, query: directQuery } as unknown as Pool;
  return { pool, query, connect, directQuery, managed, permissions, unavailableFunctions, catalog };
};
const apps: ReturnType<typeof buildApp>[] = [];
const appFor = (
  f = fixture(),
  suite: VenueSuiteConfig = { history: enabled, management: enabled, people: enabled }
) => {
  const app = buildApp({ pool: f.pool, line, adminAuth: auth, logger: false, venueSuite: suite });
  apps.push(app);
  return app;
};
beforeEach(() => {
  vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('External API forbidden');
    })
  );
  line.verifyIdentity.mockClear();
});
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('venue suite through buildApp', () => {
  it('serves a UUID-free region directory only through private session + CSRF/origin boundary', async () => {
    const f = fixture();
    const app = appFor(f);
    const headers = {
      origin,
      cookie: `__Host-qigong-admin=${session}; __Host-qigong-admin-csrf=${csrf}`,
      'x-csrf-token': csrf
    };
    const request = (payload: object = {}, extra: Record<string, string> = {}) =>
      app.inject({
        method: 'POST',
        url: '/admin/api/venue-management/regions',
        headers: { ...headers, ...extra },
        payload
      });
    const directory = await request({ lang: 'en' });
    expect(directory.statusCode).toBe(200);
    expect(directory.json()).toEqual({
      regions: [
        {
          id: personId,
          displayName: '<Synthetic region>',
          countryName: 'Synthetic country',
          code: 'synthetic-region',
          canRead: true,
          canManage: false
        }
      ]
    });
    expect(directory.headers['cache-control']).toBe('no-store');
    expect(directory.headers['referrer-policy']).toBe('no-referrer');
    for (const extra of [
      { origin: 'https://evil.invalid' },
      { 'x-csrf-token': 'x'.repeat(43) },
      { 'sec-fetch-site': 'cross-site' }
    ])
      expect((await request({}, extra)).statusCode).toBe(403);
    for (const cookie of [
      '',
      `__Host-qigong-admin=${principal}; __Host-qigong-admin-csrf=${csrf}`,
      `${headers.cookie}; __Host-qigong-admin=${session}`
    ]) {
      expect((await request({}, { cookie })).statusCode).toBe(cookie ? 401 : 403);
    }
    for (const payload of [
      { regionId: personId },
      { principal },
      { canManage: true },
      { action: 'regions' },
      { lang: 'xx' }
    ])
      expect((await request(payload)).statusCode).toBe(400);
    f.permissions.fail = true;
    expect((await request()).statusCode).toBe(503);
    f.permissions.fail = false;
    f.permissions.management = false;
    expect((await request()).json()).toEqual({ regions: [] });
    f.permissions.revoked = true;
    expect((await request()).statusCode).toBe(401);
  });
  it.each([
    '0051_venue_qr_attendance.sql',
    venueSuiteMigrationVersion,
    venueDebugMigrationVersion,
    '0059_telegram_learner_review.sql',
    venueEntryGuidanceMigrationVersion
  ])('supports %s with all new features default off', async (version) => {
    const app = appFor(fixture(version), {});
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
    for (const url of ['/admin/venue-management', '/admin/venue-people'])
      expect((await app.inject(url)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/line/venue-history',
          payload: { idToken: 'synthetic' }
        })
      ).statusCode
    ).toBe(404);
    const page = await app.inject('/line/venue-history');
    expect(page.statusCode).toBe(503);
    expect(page.body).not.toContain('<script');
    expect((await app.inject('/line/venue-checkin?venue=tw-test-one')).body).not.toContain(
      'id="preview-history"'
    );
  });
  it.each([
    '0052_venue_personal_history.sql',
    '0053_venue_management.sql',
    '0054_unknown.sql',
    '0055_future.sql',
    '0056_future.sql',
    '0057_future.sql',
    '0058_future.sql',
    '0059_future.sql',
    '0060_future.sql',
    '0061_future.sql'
  ])('does not admit unknown/transition schema %s', async (version) => {
    expect(await checkStartupReadiness(fixture(version).pool)).toMatchObject({
      ready: false,
      reason: 'schema_version_mismatch'
    });
    const app = appFor(fixture(version));
    await expect(app.ready()).rejects.toThrow('venue suite readiness failed');
  });
  it.each([
    venueSuiteMigrationVersion,
    '0055_venue_distance_debug.sql',
    '0056_venue_cks_distance_debug.sql',
    '0057_venue_test_scope.sql',
    venueDebugMigrationVersion,
    '0059_telegram_learner_review.sql',
    venueEntryGuidanceMigrationVersion
  ])(
    'keeps independently authorized administration and history operational on %s with debug off',
    async (version) => {
      const app = appFor(fixture(version));
      expect((await app.inject('/health/ready')).statusCode).toBe(200);
      const cookie = '__Host-qigong-admin=' + session + '; __Host-qigong-admin-csrf=' + csrf;
      expect(
        (await app.inject({ url: '/admin/api/venue-suite', headers: { cookie } })).json()
      ).toEqual({ management: true, people: true });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/admin/api/venue-suite/capabilities',
            headers: { cookie, origin, 'x-csrf-token': csrf },
            payload: { regionId: personId }
          })
        ).json()
      ).toMatchObject({ canReadPeople: true, canExportPeople: false });
      expect((await app.inject('/admin/field-checkin')).statusCode).toBe(404);
      expect((await app.inject('/line/venue-checkin?venue=tw-location-test')).body).not.toContain(
        'id="preview-debug-token"'
      );
    }
  );
  it('probes all five independent capabilities on exact 58 without inferring readiness from version', async () => {
    const suite = { history: enabled, management: enabled, people: enabled };
    const f = fixture();
    expect(await checkStartupReadiness(f.pool, true, suite, true)).toMatchObject({ ready: true });
    const contracts = [
      ['window', 'platform.venue_checkin_window(jsonb,text,timestamptz)'],
      ['history', 'platform.venue_personal_history(text,text,text,text,bigint)'],
      ['management', 'admin.venue_management(text,text,uuid,uuid,integer,jsonb,text)'],
      [
        'people',
        'admin.venue_people_read(text,uuid,date,date,uuid,uuid,text,text,text,text,integer,integer,boolean)'
      ],
      [
        'debug',
        'platform.venue_debug_checkin(text,text,double precision,double precision,bigint,bigint,text)'
      ]
    ] as const;
    for (const [feature, signature] of contracts) {
      f.unavailableFunctions.add(signature);
      expect(await checkStartupReadiness(f.pool, true, suite, true)).toMatchObject({
        ready: false,
        reason: 'venue_feature_not_ready',
        capability: { feature, ready: false }
      });
      f.unavailableFunctions.clear();
    }
    for (const version of [
      venueSuiteMigrationVersion,
      '0055_venue_distance_debug.sql',
      '0056_venue_cks_distance_debug.sql',
      '0057_venue_test_scope.sql',
      '0057_future.sql',
      '0058_future.sql',
      '0059_future.sql'
    ])
      expect(await checkStartupReadiness(fixture(version).pool, true, suite, true)).toMatchObject({
        ready: false,
        reason: 'schema_version_mismatch'
      });
  });

  it.each(['0059_telegram_learner_review.sql', venueEntryGuidanceMigrationVersion])(
    'preserves independent capability failures on %s (mock catalog, NOT SQL execution)',
    async (version) => {
      const f = fixture(version);
      const suite = { history: enabled, management: enabled, people: enabled };
      expect(await checkStartupReadiness(f.pool, true, suite, true)).toMatchObject({ ready: true });
      const cases = [
        ['window', 'platform.venue_checkin_window(jsonb,text,timestamptz)'],
        ['history', 'platform.venue_personal_history(text,text,text,text,bigint)'],
        ['management', 'admin.venue_management(text,text,uuid,uuid,integer,jsonb,text)'],
        [
          'people',
          'admin.venue_people_read(text,uuid,date,date,uuid,uuid,text,text,text,text,integer,integer,boolean)'
        ],
        [
          'debug',
          'platform.venue_debug_checkin(text,text,double precision,double precision,bigint,bigint,text)'
        ],
        ...(version === venueEntryGuidanceMigrationVersion
          ? [
              ['entry', 'platform.venue_entry_availability(text)'],
              ['entry', 'platform.venue_entry_learner_status(text)'],
              ['entry', 'platform.venue_entry_schedule_context(jsonb,text,timestamptz)']
            ]
          : [])
      ] as const;
      for (const [feature, signature] of cases) {
        f.unavailableFunctions.add(signature);
        expect(await checkStartupReadiness(f.pool, true, suite, true)).toMatchObject({
          ready: false,
          reason: 'venue_feature_not_ready',
          capability: { feature, ready: false }
        });
        f.unavailableFunctions.clear();
      }
    }
  );

  it.each([venueDebugMigrationVersion, '0059_telegram_learner_review.sql'])(
    'legacy %s accepts two ACL grants without any new role or entry functions (mock evidence)',
    async (version) => {
      const f = fixture(version);
      expect(f.catalog.entryRoleExists).toBe(false);
      f.catalog.errors.add('entry');
      expect(
        await checkStartupReadiness(
          f.pool,
          true,
          { history: enabled, management: enabled, people: enabled },
          true
        )
      ).toMatchObject({ ready: true });
      expect(f.query.mock.calls.some(([sql]) => sql.includes('WITH entry_functions AS'))).toBe(
        false
      );
      // A third grant is not legitimate on schema58/59, even if that cluster
      // happens to contain an entry role from a different fixture/database.
      f.catalog.windowGrantees.add('qigong_venue_entry_reader');
      f.catalog.entryRoleExists = true;
      expect(await checkStartupReadiness(f.pool, true)).toMatchObject({
        ready: false,
        capability: { feature: 'window', ready: false }
      });
    }
  );

  it.each([
    'missing entry grant',
    'extra role grant',
    'PUBLIC grant',
    'missing entry role',
    'partial ledger'
  ])('schema60 QR rejects %s before entry health (mock window evidence)', async (fault) => {
    const f = fixture(venueEntryGuidanceMigrationVersion);
    if (fault === 'missing entry grant')
      f.catalog.windowGrantees.delete('qigong_venue_entry_reader');
    if (fault === 'extra role grant') f.catalog.windowGrantees.add('unexpected_role');
    if (fault === 'PUBLIC grant') f.catalog.windowGrantees.add('PUBLIC');
    if (fault === 'missing entry role') f.catalog.entryRoleExists = false;
    if (fault === 'partial ledger') f.catalog.ledgerCount = 59;
    expect(await checkStartupReadiness(f.pool, true)).toMatchObject({
      ready: false,
      reason: 'venue_feature_not_ready',
      capability: { feature: 'window', ready: false }
    });
  });

  it.each([
    'wrong owner',
    'wrong SECURITY DEFINER',
    'wrong search_path',
    'missing subject scope',
    'extra function grant',
    'unsafe owner',
    'owner membership',
    'owner table ownership',
    'schema CREATE',
    'extra column SELECT',
    'missing FORCE RLS',
    'changed policy scope'
  ])(
    'schema60 QR fails reported %s entry evidence without leaking diagnostics (NOT a PG mutation)',
    async () => {
      const f = fixture(venueEntryGuidanceMigrationVersion);
      f.catalog.entryValid = false;
      expect(await checkStartupReadiness(f.pool, true)).toMatchObject({
        ready: false,
        reason: 'venue_feature_not_ready',
        capability: { feature: 'entry', ready: false }
      });
    }
  );

  it('schema60 catalog errors are unavailable and QR-off never probes the entry gate', async () => {
    const f = fixture(venueEntryGuidanceMigrationVersion);
    f.catalog.errors.add('entry');
    expect(await checkStartupReadiness(f.pool, true)).toMatchObject({
      ready: false,
      capability: { feature: 'entry', ready: false }
    });
    f.query.mockClear();
    expect(await checkStartupReadiness(f.pool, false, { history: enabled })).toMatchObject({
      ready: true
    });
    expect(f.query.mock.calls.some(([sql]) => sql.includes('WITH entry_functions AS'))).toBe(false);
  });

  it.each([
    venueDebugMigrationVersion,
    '0059_telegram_learner_review.sql',
    venueEntryGuidanceMigrationVersion
  ])('default-off build/liveness/preview on %s do not connect or probe', async (version) => {
    const f = fixture(version);
    const app = appFor(f, {});
    await app.ready();
    expect((await app.inject('/health/live')).statusCode).toBe(200);
    expect((await app.inject('/venue-checkin?venue=tw-test-one&source=nfc')).statusCode).toBe(200);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.directQuery).not.toHaveBeenCalled();
  });

  it('schema60 readiness does not prematurely wire new guidance routes or execute any learner operations', async () => {
    const f = fixture(venueEntryGuidanceMigrationVersion);
    const app = buildApp({ pool: f.pool, line, logger: false, venueQr: enabled });
    apps.push(app);
    await app.ready();
    expect((await app.inject('/health/ready')).statusCode).toBe(200);
    expect(app.hasRoute({ method: 'GET', url: '/api/venue-entry/availability' })).toBe(false);
    expect(app.hasRoute({ method: 'POST', url: '/api/line/venue-entry-status' })).toBe(false);
    for (const [sql] of f.query.mock.calls)
      expect(sql).not.toMatch(
        /SELECT\s+platform\.(?:venue_entry_|privacy_usage|refresh_verified_line_profile|begin_privacy_gate)/
      );
    expect(line.verifyIdentity).not.toHaveBeenCalled();
  });

  it('does not infer history readiness from QR-compatible 0051 or from version alone', async () => {
    await expect(appFor(fixture('0051_venue_qr_attendance.sql')).ready()).rejects.toThrow();
    await expect(appFor(fixture(venueSuiteMigrationVersion, false)).ready()).rejects.toThrow();
  });
  it.each([
    '/line/venue-history?month=2026-10&venue=sg-test-one&page=2&lang=en',
    '/line/?liff.state=' +
      encodeURIComponent('/venue-history?month=2026-10&venue=sg-test-one&page=2&lang=en')
  ])(
    'mounts direct and primary LIFF history without redirecting or losing login filters: %s',
    async (url) => {
      const f = fixture();
      const app = appFor(f);
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.headers.location).toBeUndefined();
      expect(response.body).toContain('My group practice history');
      expect(response.body).toContain('/line/venue-history?month=2026-10');
      expect(response.body).toContain('page=2');
      expect(response.headers['permissions-policy']).toContain('geolocation=()');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(line.verifyIdentity).not.toHaveBeenCalled();
      expect(f.query.mock.calls.some(([sql]) => sql.includes('venue_personal_history($'))).toBe(
        false
      );
    }
  );
  it('returns safe 400 pages for malformed history and preserves the ordinary workspace', async () => {
    const app = appFor();
    for (const url of [
      '/line/venue-history?personId=private',
      '/line/?liff.state=' + encodeURIComponent('/venue-history?lang=en&lang=en')
    ]) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('<script');
      expect(response.body).not.toContain('private');
    }
    expect((await app.inject('/line/')).statusCode).toBe(200);
  });
  it('trusted public lookup resolves real names and stops inactive, missing or failed entries before redirect', async () => {
    const f = fixture(),
      app = appFor(f);
    const path = '/venue-checkin?venue=tw-test-one&channel=line';
    expect((await app.inject(path)).statusCode).toBe(303);
    const page = await app.inject('/venue-checkin?venue=tw-test-one');
    expect(page.body).toContain('&lt;Synthetic venue&gt;');
    expect(page.body).not.toContain('場地代碼（未驗證）');
    f.managed.value = { code: 'tw-test-one', name: '<Synthetic venue>', active: false };
    const inactive = await app.inject(path);
    expect(inactive.statusCode).toBe(410);
    expect(inactive.headers.location).toBeUndefined();
    expect(inactive.body).toContain('場地已停用');
    expect(inactive.body).not.toContain('<a href=');
    f.managed.value = null;
    expect((await app.inject(path)).statusCode).toBe(404);
    f.managed.fail = true;
    const failed = await app.inject(path);
    expect(failed.statusCode).toBe(503);
    expect(failed.body).not.toContain('private diagnostics');
  });
  it('API binds verified self only; body identity overrides and cross-origin requests fail before verification', async () => {
    const f = fixture();
    const app = appFor(f);
    const headers = { origin, 'x-venue-history': '1' };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/line/venue-history',
          headers,
          payload: { idToken: 'synthetic', personId }
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/line/venue-history',
          headers: { ...headers, origin: 'https://evil.invalid' },
          payload: { idToken: 'synthetic' }
        })
      ).statusCode
    ).toBe(403);
    expect(line.verifyIdentity).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/line/venue-history',
          headers,
          payload: { idToken: 'synthetic' }
        })
      ).statusCode
    ).toBe(200);
    expect(f.query).toHaveBeenCalledWith(
      'SELECT platform.venue_personal_history($1,$2,$3,$4,$5) AS data',
      ['line', subject, null, null, 1]
    );
  });
  it('executes the served renderer/controller against real Fastify transports, including independent export and revoked session', async () => {
    const f = fixture(),
      app = appFor(f);
    const cookie = '__Host-qigong-admin=' + session + '; __Host-qigong-admin-csrf=' + csrf;
    const page = await app.inject({ url: '/admin/venue-people', headers: { cookie } });
    expect(page.statusCode).toBe(200);
    class Node {
      value = '';
      disabled = false;
      type = '';
      scope = '';
      href = '';
      download = '';
      children: Node[] = [];
      listeners = new Map<string, Array<(event: { preventDefault(): void }) => void>>();
      private text = '';
      constructor(readonly tag: string) {}
      set textContent(value: string) {
        this.text = value;
        this.children = [];
      }
      get textContent(): string {
        return this.text + this.children.map((c) => c.textContent).join('');
      }
      set innerHTML(_value: string) {
        throw new Error('unsafe HTML');
      }
      append(...children: Node[]) {
        this.children.push(...children);
      }
      replaceChildren() {
        this.text = '';
        this.children = [];
      }
      addEventListener(event: string, listener: (event: { preventDefault(): void }) => void) {
        this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      }
      emit(event: string) {
        for (const fn of this.listeners.get(event) ?? []) fn({ preventDefault() {} });
      }
      click() {
        this.emit('click');
      }
    }
    const nodes = new Map<string, Node>();
    for (const match of page.body.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g))
      nodes.set(match[3]!, new Node(match[1]!));
    const get = (id: string) => nodes.get(id)!;
    get('region').value = personId;
    get('month').value = '2026-10';
    get('sort').value = 'recent';
    get('direction').value = 'desc';
    get('limit').value = '20';
    const descendants = (node: Node): Node[] => [node, ...node.children.flatMap(descendants)];
    const requests: string[] = [];
    let pending: Promise<unknown> | undefined;
    const transport = (path: string, init: { headers: Record<string, string>; body: string }) => {
      requests.push(path);
      const response = app.inject({
        method: 'POST',
        url: path,
        headers: { ...init.headers, origin, cookie },
        payload: init.body
      });
      const result = (async () => {
        const res = await response;
        return {
          ok: res.statusCode === 200,
          status: res.statusCode,
          json: async () => res.json<unknown>(),
          blob: async () => new Blob([res.body])
        };
      })();
      pending = result;
      return result;
    };
    const drain = async () => {
      await pending;
      await new Promise<void>((r) => setImmediate(r));
    };
    const revokeObjectURL = vi.fn();
    runInNewContext(page.body.match(/<script>([\s\S]*?)<\/script>/)![1]!, {
      document: {
        getElementById: get,
        cookie,
        createElement: (tag: string) => new Node(tag),
        querySelectorAll: () => [...nodes.values()].flatMap(descendants)
      },
      fetch: transport,
      URL: { createObjectURL: () => 'blob:synthetic', revokeObjectURL },
      setTimeout: (fn: () => void) => fn()
    });
    expect(requests).toEqual([]);
    get('verify').click();
    await drain();
    expect(get('read').disabled).toBe(false);
    expect(get('export').disabled).toBe(true);
    get('filters').emit('submit');
    await drain();
    expect(get('records').textContent).toContain('<Synthetic learner>');
    expect(get('summary').textContent).toContain('完整篩選結果：出席 1 次');
    f.permissions.canReadPeople = false;
    f.permissions.canExportPeople = true;
    get('verify').click();
    await drain();
    expect(get('read').disabled).toBe(true);
    expect(get('export').disabled).toBe(false);
    get('export').click();
    await drain();
    expect(get('status').textContent).toContain('CSV 已產生');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
    expect(requests.at(-1)).toBe('/admin/venue-people/api/export');
    f.permissions.revoked = true;
    get('verify').click();
    await drain();
    expect(get('read').disabled).toBe(true);
    expect(get('export').disabled).toBe(true);
    expect(get('records').textContent).toBe('');
    expect(get('status').textContent).toContain('登入已失效');
    expect(get('manual-add').disabled).toBe(true);
    expect(get('manual-void').disabled).toBe(true);
  });
  it('navigation and scoped controls fail closed, preserve independent export, and recheck live session', async () => {
    const f = fixture(),
      app = appFor(f);
    const cookie = '__Host-qigong-admin=' + session + '; __Host-qigong-admin-csrf=' + csrf;
    const navigation = () => app.inject({ url: '/admin/api/venue-suite', headers: { cookie } });
    const scoped = (regionId = personId, extra = {}) =>
      app.inject({
        method: 'POST',
        url: '/admin/api/venue-suite/capabilities',
        headers: { origin, cookie, 'x-csrf-token': csrf, ...extra },
        payload: { regionId }
      });
    expect((await navigation()).json()).toEqual({ management: true, people: true });
    f.permissions.management = false;
    f.permissions.canReadPeople = false;
    expect((await navigation()).json()).toEqual({ management: false, people: false });
    f.permissions.canExportPeople = true;
    expect((await navigation()).json()).toEqual({ management: false, people: true });
    expect((await scoped()).json()).toMatchObject({ canReadPeople: false, canExportPeople: true });
    expect((await scoped(principal)).json()).toMatchObject({
      people: false,
      canExportPeople: false
    });
    for (const extra of [
      { origin: 'https://evil.invalid' },
      { 'x-csrf-token': '' },
      { cookie: cookie + '; __Host-qigong-admin-csrf=' + csrf },
      { 'sec-fetch-site': 'cross-site' }
    ]) {
      const calls = f.query.mock.calls.length;
      expect((await scoped(personId, extra)).statusCode).toBe(403);
      expect(f.query.mock.calls).toHaveLength(calls);
    }
    expect((await scoped('invalid')).statusCode).toBe(400);
    f.permissions.fail = true;
    const unavailable = await navigation();
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).not.toContain('private');
    f.permissions.fail = false;
    f.permissions.revoked = true;
    expect((await navigation()).statusCode).toBe(401);
    expect((await scoped()).statusCode).toBe(401);
    expect(f.query.mock.calls.some(([sql]) => sql.includes('venue_people_read('))).toBe(false);
    const off = appFor(fixture(), {});
    expect(
      (
        await off.inject({
          method: 'POST',
          url: '/admin/api/venue-suite/capabilities',
          payload: { regionId: personId }
        })
      ).statusCode
    ).toBe(404);
  });
  it('feature configuration vetoes permission hints and malformed capability input has fixed errors', async () => {
    const f = fixture(),
      app = appFor(f, { management: enabled });
    f.permissions.canExportPeople = true;
    const cookie = '__Host-qigong-admin=' + session + '; __Host-qigong-admin-csrf=' + csrf;
    expect(
      (await app.inject({ url: '/admin/api/venue-suite', headers: { cookie } })).json()
    ).toEqual({ management: true, people: false });
    for (const payload of [
      { regionId: personId, principalId: principal },
      '{"private":"fragment",'
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/api/venue-suite/capabilities',
        headers: { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
        payload
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('fragment');
    }
  });
  it('admin shells and navigation require fresh private credentials, not body principal claims', async () => {
    const app = appFor();
    for (const url of [
      '/admin/venue-management',
      '/admin/venue-people',
      '/admin/api/venue-suite'
    ]) {
      expect((await app.inject(url)).statusCode).toBe(401);
      expect(
        (await app.inject({ url, headers: { cookie: '__Host-qigong-admin=' + session } }))
          .statusCode
      ).toBe(200);
      expect(
        (
          await app.inject({
            url,
            headers: {
              cookie: '__Host-qigong-admin=' + session + '; __Host-qigong-admin=' + session
            }
          })
        ).statusCode
      ).toBe(401);
    }
    const read = '/admin/venue-people/api/read';
    expect(
      (await app.inject({ method: 'POST', url: read, payload: { principalId: principal } }))
        .statusCode
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: read,
          headers: { cookie: '__Host-qigong-admin=' + session },
          payload: {}
        })
      ).statusCode
    ).toBe(403);
    const management = '/admin/api/venue-management/list';
    expect(
      (
        await app.inject({
          method: 'POST',
          url: management,
          headers: {
            origin,
            cookie: '__Host-qigong-admin=' + session + '; __Host-qigong-admin-csrf=' + csrf,
            'x-csrf-token': csrf
          },
          payload: { regionId: personId, principalId: principal }
        })
      ).statusCode
    ).toBe(400);
    expect((await app.inject('/admin/field-checkin')).statusCode).toBe(404);
  });
});
