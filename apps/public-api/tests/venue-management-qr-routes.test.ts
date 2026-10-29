/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import type { Pool } from '@qigong/database';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as encoder from '../src/venue-management-qr.js';
import { registerVenueManagementRoutes } from '../src/venue-management-routes.js';
import { adminContentSecurityPolicy, adminLogoUrl } from '../src/admin-branding.js';

const id = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000001';
const origin = 'https://synthetic.example';
const adminOrigin = 'https://admin.synthetic.example';
const field = {
  id,
  region_id: id,
  version: 2,
  created_at: '',
  updated_at: '',
  code: 'tw-synthetic-park',
  name_zh_tw: 'Synthetic practice',
  name_en: null,
  address: 'Synthetic',
  latitude: 0,
  longitude: 0,
  radius_meters: 200,
  timezone: 'Asia/Taipei',
  is_active: true,
  active_time_rules: { day_of_week: [6], start_time: '08:00', end_time: '10:00' }
};
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const state = { session: 's'.repeat(43), active: true, csrf: true, read: true, disabled: false };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes('session_principal'))
      return { rows: [{ principal: state.active ? id : null }] };
    if (sql.includes('admin.venue_management(')) {
      if (!state.read || values?.[2] !== id)
        throw Object.assign(new Error('private scope'), { code: '42501' });
      if (values?.[1] === 'list') return { rows: [{ data: { fields: [field] } }] };
      if (values?.[1] === 'capabilities')
        return { rows: [{ data: { canRead: true, canManage: false } }] };
      if (values?.[3] !== id) throw Object.assign(new Error('private venue'), { code: 'P0002' });
      return { rows: [{ data: { field: { ...field, is_active: !state.disabled } } }] };
    }
    return { rows: [] };
  });
  const connect = vi.fn(async () => ({ query, release() {} }));
  const app = Fastify({ genReqId: () => id });
  registerVenueManagementRoutes(app, { connect } as unknown as Pool, {
    enabled: true,
    publicOrigin: origin,
    adminOrigin,
    sessionFor: () => state.session,
    validCsrf: () => state.csrf,
    principalFor: async () => (state.active ? id : null)
  });
  const request = (
    payload: object = { regionId: id, id },
    headers: Record<string, string> = { origin: adminOrigin },
    query = ''
  ) =>
    app.inject({ method: 'POST', url: '/admin/api/venue-management/qr' + query, headers, payload });
  return { app, state, query, connect, request };
}
describe('QR route uses existing fresh authenticated read transaction (synthetic transport)', () => {
  it('returns only the canonical PNG and saved row; caller Host/forwarded cannot change it; SQL action is get only', async () => {
    const f = fixture();
    const encode = vi.spyOn(encoder, 'encodeVenueQr');
    try {
      const response = await f.request(undefined, {
        origin: adminOrigin,
        host: 'evil.invalid',
        'x-forwarded-host': 'evil.invalid',
        'x-forwarded-proto': 'http'
      });
      expect(response.statusCode).toBe(200);
      const data = response.json<{
        target: string;
        pngDataUrl: string;
        filename: string;
        field: typeof field;
      }>();
      expect(data.target).toBe(origin + '/venue-checkin?venue=tw-synthetic-park&source=qr');
      expect(data.pngDataUrl).toMatch(/^data:image\/png;base64,iVBOR/);
      expect(data.field).toMatchObject(field);
      expect(encode).toHaveBeenCalledWith(field.code, origin);
      expect(f.query.mock.calls.filter(([sql]) => sql.includes('venue_management('))).toEqual([
        [
          'SELECT admin.venue_management($1,$2,$3,$4,$5,$6,$7) data',
          [f.state.session, 'get', id, id, null, null, null]
        ]
      ]);
      expect(
        f.query.mock.calls.some(([sql]) => /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i.test(sql))
      ).toBe(false);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await f.app.close();
    }
  });
  it.each([
    [{}, 403],
    [{ origin: 'https://evil.invalid' }, 403],
    [{ origin: adminOrigin, 'sec-fetch-site': 'cross-site' }, 403],
    [{ origin: adminOrigin, 'sec-fetch-site': 'same-site' }, 403]
  ] as const)('rejects origin/fetch-site before SQL/encoder: %j', async (headers, status) => {
    const f = fixture();
    const encode = vi.spyOn(encoder, 'encodeVenueQr');
    try {
      expect((await f.request(undefined, headers)).statusCode).toBe(status);
      expect(f.connect).not.toHaveBeenCalled();
      expect(encode).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
  it.each(['csrf', 'session', 'revoked', 'forbidden', 'cross-region', 'missing'])(
    'fails closed on %s without encoding or revealing private detail',
    async (scenario) => {
      const f = fixture();
      const encode = vi.spyOn(encoder, 'encodeVenueQr');
      if (scenario === 'csrf') f.state.csrf = false;
      if (scenario === 'session') f.state.session = '';
      if (scenario === 'revoked') f.state.active = false;
      if (scenario === 'forbidden') f.state.read = false;
      const expected =
        scenario === 'session' || scenario === 'revoked' ? 401 : scenario === 'missing' ? 404 : 403;
      try {
        const response = await f.request({
          regionId: scenario === 'cross-region' ? other : id,
          id: scenario === 'missing' ? other : id
        });
        expect(response.statusCode).toBe(expected);
        expect(response.body).not.toMatch(/private|synthetic-park/);
        expect(encode).not.toHaveBeenCalled();
      } finally {
        await f.app.close();
      }
    }
  );
  it.each([
    { url: 'https://evil.invalid' },
    { target: origin },
    { principal: id },
    { principalId: id },
    { action: 'get' },
    { version: 2 },
    { field },
    { source: 'qr' }
  ])('rejects injected body claims before SQL: %j', async (extra) => {
    const f = fixture();
    const encode = vi.spyOn(encoder, 'encodeVenueQr');
    try {
      expect((await f.request({ regionId: id, id, ...extra })).statusCode).toBe(400);
      expect(f.connect).not.toHaveBeenCalled();
      expect(encode).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
  it.each(['?url=https://evil.invalid', '?principal=' + id, '?action=get', '?regionId=' + other])(
    'rejects query claims %s',
    async (query) => {
      const f = fixture();
      const encode = vi.spyOn(encoder, 'encodeVenueQr');
      try {
        expect((await f.request(undefined, undefined, query)).statusCode).toBe(400);
        expect(f.connect).not.toHaveBeenCalled();
        expect(encode).not.toHaveBeenCalled();
      } finally {
        await f.app.close();
      }
    }
  );
  it.each(['list', 'capabilities'])('never bulk-encodes images for %s', async (action) => {
    const f = fixture();
    const encode = vi.spyOn(encoder, 'encodeVenueQr');
    try {
      const response = await f.app.inject({
        method: 'POST',
        url: '/admin/api/venue-management/' + action,
        headers: { origin: adminOrigin },
        payload: { regionId: id }
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain('pngDataUrl');
      expect(encode).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
  it('preserves existing list query compatibility without accepting query authority', async () => {
    const f = fixture();
    const encode = vi.spyOn(encoder, 'encodeVenueQr');
    try {
      const response = await f.app.inject({
        method: 'POST',
        url: '/admin/api/venue-management/list?regionId=' + other,
        headers: { origin: adminOrigin },
        payload: { regionId: id }
      });
      expect(response.statusCode).toBe(200);
      expect(f.query.mock.calls.filter(([sql]) => sql.includes('venue_management('))).toEqual([
        [
          'SELECT admin.venue_management($1,$2,$3,$4,$5,$6,$7) data',
          [f.state.session, 'list', id, null, null, null, null]
        ]
      ]);
      expect(encode).not.toHaveBeenCalled();
    } finally {
      await f.app.close();
    }
  });
  it('sanitizes encoder failure instead of returning internals', async () => {
    const f = fixture();
    vi.spyOn(encoder, 'encodeVenueQr').mockRejectedValue(
      Object.assign(new Error('private SQL and tokens'), { code: '23505' })
    );
    try {
      const response = await f.request();
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'venue_management_unavailable' });
    } finally {
      await f.app.close();
    }
  });
  it('allows disabled read-only QR generation, returning disabled saved metadata', async () => {
    const f = fixture();
    f.state.disabled = true;
    try {
      const response = await f.request();
      expect(response.statusCode).toBe(200);
      expect(response.json<{ field: typeof field }>().field.is_active).toBe(false);
    } finally {
      await f.app.close();
    }
  });
  it('adds data images to this page alone without changing other CSP directives', async () => {
    const f = fixture();
    try {
      const page = await f.app.inject('/admin/venue-management');
      const policy = page.headers['content-security-policy'];
      expect(policy).toBe(
        adminContentSecurityPolicy.replace(
          `img-src ${adminLogoUrl}`,
          `img-src ${adminLogoUrl} data:`
        )
      );
      expect(adminContentSecurityPolicy).not.toContain('data:');
      expect(policy).not.toMatch(/connect-src[^;]*data:|script-src[^;]*data:|frame-src|\*/);
      f.state.active = false;
      expect((await f.app.inject('/admin/venue-management')).statusCode).toBe(401);
    } finally {
      await f.app.close();
    }
  });
});
