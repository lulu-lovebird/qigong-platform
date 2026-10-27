/** Real buildApp composition; synthetic SQL/LINE only. Live RLS has separate PG coverage. */
import type { Pool } from '@qigong/database';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, checkStartupReadiness } from '../src/app.js';
import type { AdminAuthProvider } from '../src/admin-auth.js';
import { venueSuiteMigrationVersion, type VenueSuiteConfig } from '../src/venue-suite.js';

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
const fixture = (version = venueSuiteMigrationVersion, capable = true) => {
  const managed: { value: { code: string; name: string; active: boolean } | null; fail: boolean } =
    {
      value: { code: 'tw-test-one', name: '<Synthetic venue>', active: true },
      fail: false
    };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes('venue_management_lookup')) {
      if (managed.fail) throw new Error('private diagnostics');
      return { rows: [{ data: managed.value }] };
    }
    if (sql.includes(' AS ready')) return { rows: [{ ready: capable }] };
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
      return { rows: [{ principal_id: values?.[0] === session ? principal : null }] };
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
  const pool = {
    connect: async () => ({ query, release: vi.fn() }),
    query: async () => ({ rows: [] })
  } as unknown as Pool;
  return { pool, query, managed };
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
  it.each(['0051_venue_qr_attendance.sql', venueSuiteMigrationVersion])(
    'supports %s with all new features default off',
    async (version) => {
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
    }
  );
  it.each([
    '0052_venue_personal_history.sql',
    '0053_venue_management.sql',
    '0054_unknown.sql',
    '0055_future.sql'
  ])('does not admit unknown/transition schema %s', async (version) => {
    expect(await checkStartupReadiness(fixture(version).pool)).toMatchObject({
      ready: false,
      reason: 'schema_version_mismatch'
    });
    const app = appFor(fixture(version));
    await expect(app.ready()).rejects.toThrow('venue suite readiness failed');
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
