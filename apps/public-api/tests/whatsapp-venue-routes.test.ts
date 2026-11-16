import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from '@qigong/database';
import { registerWhatsAppVenueRoutes } from '../src/whatsapp-venue-routes.js';
import { whatsappCsrfCookie, whatsappSessionCookie } from '../src/whatsapp-browser-session.js';
const origin = 'https://checkin.baiyinqigong.org';
const session = 's'.repeat(43),
  csrf = 'c'.repeat(43);
const headers = {
  origin,
  'content-type': 'application/json',
  cookie: `${whatsappSessionCookie}=${session}; ${whatsappCsrfCookie}=${csrf}`,
  'x-whatsapp-csrf-token': csrf
};
const input = { venue: 'my-demo-hall', latitude: 3, longitude: 101 };
const receipt = {
  ok: true,
  venue: { code: input.venue, name: 'Synthetic venue', timezone: 'Asia/Kuala_Lumpur' },
  checkedInAt: '2026-11-16T00:10:00Z',
  attendanceDate: '2026-11-16',
  replayed: false
};
const status = { version: 1, status: 'approved', privacy: 'clear' };
const history = {
  ok: true,
  dateBasis: 'venue_local_date',
  totals: { attendanceCount: 1, attendanceDays: 1, monthCount: 1 },
  page: 1,
  pageSize: 20,
  hasMore: false,
  entries: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      venueCode: input.venue,
      venueName: receipt.venue.name,
      checkedInAt: receipt.checkedInAt,
      venueLocalDate: receipt.attendanceDate,
      venueTimezone: receipt.venue.timezone
    }
  ]
};
describe('dedicated WhatsApp venue API adapter, explicitly registered test app', () => {
  let app: FastifyInstance;
  let data: unknown;
  let sqlError: Error | undefined;
  let commitError: Error | undefined;
  const events: string[] = [];
  const query = vi.fn(async (sql: string) => {
    events.push(sql);
    if (sql === 'COMMIT' && commitError) throw commitError;
    if (sql.startsWith('SELECT platform.whatsapp_venue_')) {
      if (sqlError) throw sqlError;
      return { rows: [{ data }] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const pool = { connect } as unknown as Pool;
  beforeEach(() => {
    events.length = 0;
    query.mockClear();
    release.mockClear();
    connect.mockClear();
    data = receipt;
    sqlError = undefined;
    commitError = undefined;
    app = Fastify({ genReqId: () => randomUUID() });
    registerWhatsAppVenueRoutes(app, pool, { enabled: true, publicOrigin: origin });
  });
  afterEach(async () => {
    await app.close();
  });
  const post = (
    payload: unknown = input,
    requestHeaders: Record<string, string> = headers,
    url = '/api/whatsapp/venue-checkin'
  ) =>
    app.inject({ method: 'POST', url, headers: requestHeaders, payload: JSON.stringify(payload) });
  it('passes only Cookie credentials and validated data to the dedicated SQL facade, then commits', async () => {
    const r = await post();
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(receipt);
    expect(query).toHaveBeenCalledWith(
      'SELECT platform.whatsapp_venue_checkin($1,$2,$3,$4,$5) data',
      [session, csrf, input.venue, 3, 101]
    );
    expect(events).toContain('SET LOCAL ROLE qigong_api_runtime');
    expect(events.at(-1)).toBe('COMMIT');
    expect(events.some((s) => s.includes('whatsapp_venue_session_status'))).toBe(false);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.body).not.toContain(session);
    expect(r.body).not.toContain(csrf);
  });
  it('reads bounded status separately without treating it as write authorization', async () => {
    data = status;
    const r = await post({}, headers, '/api/whatsapp/venue-entry-status');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(status);
    expect(query).toHaveBeenCalledWith(
      'SELECT platform.whatsapp_venue_session_status($1,$2) data',
      [session, csrf]
    );
  });
  it.each([
    { token: session },
    { personId: randomUUID() },
    { source: 'nfc' },
    { isTest: true },
    { debugToken: 'bypass' },
    { latitude: '3' },
    { latitude: 91 }
  ])('rejects untrusted input %j before accessing DB', async (extra) => {
    const r = await post({ ...input, ...extra });
    expect(r.statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each([
    { ...headers, origin: 'https://evil.example' },
    { ...headers, cookie: '' },
    { ...headers, 'x-whatsapp-csrf-token': 'wrong' },
    { ...headers, cookie: headers.cookie + `; ${whatsappSessionCookie}=${session}` }
  ])('rejects invalid transport before connecting %j', async (h) => {
    const r = await post(input, h);
    expect([401, 403]).toContain(r.statusCode);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each([
    { ok: false },
    { ...receipt, venue: { ...receipt.venue, code: 'sg-another-venue' } },
    { ...receipt, isTest: true, verificationMode: 'distance_debug' },
    { ...receipt, attendanceDate: '2026-11-15' }
  ])('rolls back malformed/test/unbound receipt %j before commit', async (value) => {
    data = value;
    const r = await post();
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ ok: false, error: 'venue_result_unconfirmed' });
    expect(events.at(-1)).toBe('ROLLBACK');
    expect(events).not.toContain('COMMIT');
  });
  it.each([
    ['42501', 'WhatsApp venue session unavailable', 401, 'venue_access_unavailable'],
    ['42501', 'WhatsApp venue consent unavailable', 403, 'venue_access_unavailable'],
    ['P0001', 'venue_outside_window', 409, 'outside_window'],
    ['P0001', 'venue_outside_radius', 403, 'outside_radius'],
    ['40P01', 'deadlock detected', 503, 'venue_result_unconfirmed'],
    ['40001', 'serialization failed', 503, 'venue_result_unconfirmed'],
    ['XX000', 'private SQL detail ' + session, 503, 'venue_result_unconfirmed']
  ] as const)(
    'maps SQLSTATE %s without leaking SQL details',
    async (code, message, http, error) => {
      sqlError = Object.assign(Error(message), { code });
      const r = await post();
      expect(r.statusCode).toBe(http);
      expect(r.json()).toEqual({ ok: false, error });
      expect(r.body).not.toContain(session);
      expect(events.at(-1)).toBe('ROLLBACK');
    }
  );
  it('keeps an ambiguous commit failure uncertain and does not clear browser cookies', async () => {
    commitError = Error('connection dropped');
    const r = await post();
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ ok: false, error: 'venue_result_unconfirmed' });
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(events).toContain('COMMIT');
    expect(events.at(-1)).toBe('ROLLBACK');
  });
  it('rejects extra status fields without a DB call', async () => {
    const r = await post({ venue: input.venue }, headers, '/api/whatsapp/venue-entry-status');
    expect(r.statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
  it('does not expose SQL on a status failure', async () => {
    sqlError = Object.assign(Error('private ' + session), { code: 'XX000' });
    const r = await post({}, headers, '/api/whatsapp/venue-entry-status');
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ ok: false, error: 'venue_service_unavailable' });
    expect(r.body).not.toContain(session);
  });
  it('reads own history with Cookie credentials and explicit venue-local date semantics', async () => {
    data = history;
    const response = await post({}, headers, '/api/whatsapp/venue-history');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(history);
    expect(query).toHaveBeenCalledWith(
      'SELECT platform.whatsapp_venue_history($1,$2,$3,$4,$5) data',
      [session, csrf, null, null, 1]
    );
    expect(events.at(-1)).toBe('COMMIT');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain(session);
  });
  it('binds history filters to the SQL arguments', async () => {
    data = history;
    expect(
      (await post({ month: '2026-11', venue: input.venue }, headers, '/api/whatsapp/venue-history'))
        .statusCode
    ).toBe(200);
    expect(query).toHaveBeenCalledWith(
      'SELECT platform.whatsapp_venue_history($1,$2,$3,$4,$5) data',
      [session, csrf, '2026-11', input.venue, 1]
    );
  });
  it.each([
    { personId: randomUUID() },
    { view: 'test' },
    { month: '2026-11\n' },
    { page: 0 },
    { page: 10001 },
    { page: '1' }
  ])('rejects unsafe history request %j without DB access', async (payload) => {
    expect((await post(payload, headers, '/api/whatsapp/venue-history')).statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each([
    { ...history, page: 2 },
    { ...history, entries: [{ ...history.entries[0], venueCode: 'sg-other-hall' }] },
    {
      ...history,
      entries: [
        { ...history.entries[0], checkedInAt: '2026-10-16T00:10:00Z', venueLocalDate: '2026-10-16' }
      ]
    },
    { ...history, entries: [{ ...history.entries[0], isTest: true }] },
    { ...history, hasMore: true },
    { ...history, totals: { attendanceCount: 0, attendanceDays: 0, monthCount: 0 } }
  ])('rejects unbound or inconsistent history response %j before commit', async (value) => {
    data = value;
    const response = await post(
      { venue: input.venue, month: '2026-11' },
      headers,
      '/api/whatsapp/venue-history'
    );
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false, error: 'venue_service_unavailable' });
    expect(events).not.toContain('COMMIT');
    expect(events.at(-1)).toBe('ROLLBACK');
  });
  it('rejects history timestamps in ascending order', async () => {
    data = {
      ...history,
      totals: { attendanceCount: 2, attendanceDays: 1, monthCount: 2 },
      entries: [
        history.entries[0],
        {
          ...history.entries[0],
          id: '00000000-0000-4000-8000-000000000002',
          checkedInAt: '2026-11-16T00:20:00Z'
        }
      ]
    };
    expect((await post({}, headers, '/api/whatsapp/venue-history')).statusCode).toBe(503);
    expect(events).not.toContain('COMMIT');
  });
  it('does not confuse different PostgreSQL microseconds with an identical timestamp', async () => {
    data = {
      ...history,
      totals: { attendanceCount: 2, attendanceDays: 1, monthCount: 2 },
      entries: [
        { ...history.entries[0], checkedInAt: '2026-11-16T00:10:00.000900Z' },
        {
          ...history.entries[0],
          id: '00000000-0000-4000-8000-000000000002',
          checkedInAt: '2026-11-16T00:10:00.000100Z'
        }
      ]
    };
    expect((await post({}, headers, '/api/whatsapp/venue-history')).statusCode).toBe(200);
  });
  it('returns only a bounded history error on a database failure', async () => {
    sqlError = Object.assign(Error('private SQL ' + session), { code: 'XX000' });
    const response = await post({}, headers, '/api/whatsapp/venue-history');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false, error: 'venue_service_unavailable' });
    expect(response.body).not.toContain(session);
  });
  it('is not registered unless the composition root deliberately calls the adapter', async () => {
    const plain = Fastify();
    try {
      expect(
        (await plain.inject({ method: 'POST', url: '/api/whatsapp/venue-checkin', payload: input }))
          .statusCode
      ).toBe(404);
    } finally {
      await plain.close();
    }
  });
});
