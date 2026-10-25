import { describe, expect, it, vi } from 'vitest';
import type { Pool } from '@qigong/database';
import { buildApp } from '../src/app.js';
import type { AdminAuthProvider } from '../src/admin-auth.js';

const regionId = '10000000-0000-4000-8000-000000000001';
const principal = '20000000-0000-4000-8000-000000000001';
const fieldId = '30000000-0000-4000-8000-000000000001';
const selector = {
  regionId,
  from: '2026-10-01',
  until: '2026-11-01',
  filters: { fieldId: null, method: null }
};
const read = { operation: 'attendance.read', ...selector, page: 1, limit: 100 };
const exporting = { operation: 'attendance.export', ...selector };
const session = 's'.repeat(43),
  csrf = 'c'.repeat(43);
const headers = {
  origin: 'https://app.test',
  cookie: `__Host-qigong-admin=${session}; __Host-qigong-admin-csrf=${csrf}`,
  'x-csrf-token': csrf
};
const provider: AdminAuthProvider = {
  callbackUrl: 'https://app.test/admin/auth/callback',
  begin: async () => new URL('https://issuer.test'),
  complete: async () => ({ iss: 'https://issuer.test', sub: 'synthetic' })
};
const setup = (enabled = true) => {
  const readSql = vi.fn(async (isExport: boolean): Promise<unknown> => ({
    version: 1,
    state: 'available',
    operation: isExport ? 'attendance.export' : 'attendance.read',
    ...selector,
    timezone: 'venue-local',
    nameVisibility: 'visible',
    totals: { attendanceCount: 1, attendanceDays: 1, learnerCount: 1 },
    ...(isExport ? { rowCount: 1 } : { page: 1, limit: 100 }),
    rows: [
      {
        date: '2026-10-25',
        learnerName: '=FORMULA()',
        field: { fieldId, code: 'tw-test-venue', nameZhTw: '合成場地' },
        method: 'qr_gps',
        distanceMeters: 0
      }
    ]
  }));
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    if (sql.includes('session_principal')) return { rows: [{ principal_id: principal }] };
    if (sql.includes('venue_qr_read'))
      return { rows: [{ data: await readSql(values?.[6] === true) }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
  const app = buildApp({
    pool,
    logger: false,
    adminAuth: provider,
    line: {
      channelSecret: 'mock-secret',
      channelAccessToken: 'mock-access',
      loginChannelId: '123',
      liffId: '123-test'
    },
    ...(enabled ? { venueQr: { enabled: true, publicOrigin: 'https://app.test' } } : {})
  });
  return { app, query, readSql, release };
};
describe('new admin QR reporting through buildApp and private cookie → real runner (mock DB)', () => {
  it('sanitizes parser failures without logging/echoing private body fragments', async () => {
    const m = setup();
    try {
      const result = await m.app.inject({
        method: 'POST',
        url: '/admin/venue-qr/api/read',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: '{"private":"do-not-echo",'
      });
      expect(result.statusCode).toBe(400);
      expect(result.body).not.toContain('do-not-echo');
      expect(result.headers['cache-control']).toBe('no-store');
      expect(m.query).not.toHaveBeenCalled();
    } finally {
      await m.app.close();
    }
  });
  it('is default-off without re-opening any NFC routes', async () => {
    const m = setup(false);
    try {
      expect((await m.app.inject('/admin/venue-qr')).statusCode).toBe(404);
      expect(
        (
          await m.app.inject({
            method: 'POST',
            url: '/admin/venue-qr/api/read',
            headers,
            payload: read
          })
        ).statusCode
      ).toBe(404);
      expect(m.query).not.toHaveBeenCalled();
    } finally {
      await m.app.close();
    }
  });
  it('reads a named one-person group under existing scoped view permission', async () => {
    const m = setup();
    try {
      const result = await m.app.inject({
        method: 'POST',
        url: '/admin/venue-qr/api/read',
        headers,
        payload: read
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().rows[0].learnerName).toBe('=FORMULA()');
      expect(result.json().totals.learnerCount).toBe(1);
      expect(m.query).toHaveBeenCalledWith('SELECT admin.session_principal($1) AS principal_id', [
        session
      ]);
      expect(m.query).toHaveBeenCalledWith(
        'SELECT admin.venue_qr_read($1,$2,$3,$4,$5,$6,$7,$8,$9) AS data',
        [session, regionId, selector.from, selector.until, 1, 100, false, null, null]
      );
      expect(m.query).toHaveBeenCalledWith('COMMIT');
      expect(result.headers['cache-control']).toBe('no-store');
    } finally {
      await m.app.close();
    }
  });
  it('exports complete bounded CSV with formula protection and explicit export operation', async () => {
    const m = setup();
    try {
      const result = await m.app.inject({
        method: 'POST',
        url: '/admin/venue-qr/api/export',
        headers,
        payload: exporting
      });
      expect(result.statusCode).toBe(200);
      expect(result.headers['content-type']).toContain('text/csv');
      expect(result.body).toContain("'=FORMULA()");
      expect(result.body).not.toMatch(/personId|user_latitude|idToken/);
      expect(m.readSql).toHaveBeenCalledWith(true);
    } finally {
      await m.app.close();
    }
  });
  it.each([
    { ...headers, cookie: '' },
    { ...headers, 'x-csrf-token': 'wrong' },
    { ...headers, origin: 'https://evil.test' },
    { ...headers, cookie: headers.cookie + `; __Host-qigong-admin=${session}` },
    { ...headers, cookie: headers.cookie + `; __Host-qigong-admin-csrf=${csrf}` }
  ])('rejects forged/missing/ambiguous credential or CSRF before DB', async (badHeaders) => {
    const m = setup();
    try {
      const result = await m.app.inject({
        method: 'POST',
        url: '/admin/venue-qr/api/export',
        headers: badHeaders,
        payload: exporting
      });
      expect(result.statusCode).toBe(403);
      expect(m.query).not.toHaveBeenCalled();
    } finally {
      await m.app.close();
    }
  });
  it('does not accept body identity, export-on-read or read-on-export', async () => {
    const m = setup();
    try {
      for (const [path, payload] of [
        ['read', { ...read, principalId: principal }],
        ['read', exporting],
        ['export', read]
      ] as const) {
        expect(
          (
            await m.app.inject({
              method: 'POST',
              url: '/admin/venue-qr/api/' + path,
              headers,
              payload
            })
          ).statusCode
        ).toBe(400);
      }
      expect(m.query).not.toHaveBeenCalled();
    } finally {
      await m.app.close();
    }
  });
  it.each([
    ['42501', 403],
    ['54000', 413],
    ['XX000', 503]
  ] as const)('does not fall back on scoped/export DB denial %s', async (code, status) => {
    const m = setup();
    m.readSql.mockRejectedValueOnce(Object.assign(new Error('private diagnostics'), { code }));
    try {
      const result = await m.app.inject({
        method: 'POST',
        url: '/admin/venue-qr/api/export',
        headers,
        payload: exporting
      });
      expect(result.statusCode).toBe(status);
      expect(result.body).not.toContain('private');
      expect(m.readSql).toHaveBeenCalledOnce();
      expect(m.query).toHaveBeenCalledWith('ROLLBACK');
    } finally {
      await m.app.close();
    }
  });
  it('rolls back malformed/partial DB JSON, never produces partial CSV', async () => {
    const m = setup();
    m.readSql.mockResolvedValueOnce({ state: 'available', rows: [] });
    try {
      expect(
        (
          await m.app.inject({
            method: 'POST',
            url: '/admin/venue-qr/api/export',
            headers,
            payload: exporting
          })
        ).statusCode
      ).toBe(503);
      expect(m.query).toHaveBeenCalledWith('ROLLBACK');
    } finally {
      await m.app.close();
    }
  });
  it('renders a usable authenticated query/export page without exposing the session', async () => {
    const m = setup();
    try {
      const result = await m.app.inject({ url: '/admin/venue-qr', headers });
      expect(result.statusCode).toBe(200);
      expect(result.body).toContain('匯出 CSV');
      expect(result.body).not.toContain(session);
    } finally {
      await m.app.close();
    }
  });
});
