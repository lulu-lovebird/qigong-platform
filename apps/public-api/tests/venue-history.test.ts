/** Synthetic HTTP/adapter contract tests; real RLS is tested separately. */
import type { Pool, PoolClient } from '@qigong/database';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVenueHistory, registerVenueHistoryRoutes } from '../src/venue-history.js';

const subject = 'U' + 'a'.repeat(32);
const requestId = '11111111-1111-4111-8111-111111111111';
const personId = '22222222-2222-4222-8222-222222222222';
const origin = 'https://synthetic.invalid';
const token = 'synthetic-private-token';
const historySql = 'SELECT platform.venue_personal_history($1,$2,$3,$4,$5) AS data';
const empty = {
  ok: true,
  timezone: 'Asia/Taipei',
  totals: { attendanceCount: 0, attendanceDays: 0, monthCount: 0 },
  page: 1,
  pageSize: 20,
  hasMore: false,
  entries: []
};
const fixture = () => {
  const state: { data: unknown; mapping: unknown; historyError?: Error } = {
    data: empty,
    mapping: {
      subject,
      personId,
      identityId: '33333333-3333-4333-8333-333333333333',
      revoked: false,
      learnerActive: true,
      channelActive: true,
      applicationApproved: true
    }
  };
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === historySql) expect(values?.[0]).toBe('line');
    if (sql.includes('resolve_line_learner_identity')) return { rows: [{ data: state.mapping }] };
    if (sql.includes('privacy_usage'))
      return { rows: [{ data: { active: false, reflectionConsent: true } }] };
    if (sql === historySql) {
      if (state.historyError) throw state.historyError;
      return { rows: [{ data: state.data }] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect } as unknown as Pool;
  const verifyIdentity = vi.fn(async (credential: string, channel: string) => {
    expect(credential).toBe(token);
    expect(channel).toBe('123');
    return { subject };
  });
  const config = { publicOrigin: origin, loginChannelId: '123', verifyIdentity };
  const history = createVenueHistory(pool, config);
  return { state, query, release, connect, pool, verifyIdentity, config, history };
};
beforeEach(() =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('No external APIs');
    })
  )
);
afterEach(() => vi.unstubAllGlobals());

describe('venue personal history backend contract', () => {
  it.each([
    null,
    {},
    { idToken: '' },
    { idToken: ' ' },
    { idToken: 42 },
    { idToken: 'x'.repeat(4097) },
    ...['personId', 'principal', 'channel', 'subject', 'pageSize', 'platform', 'principalId'].map(
      (key) => ({ idToken: token, [key]: personId })
    ),
    ...['2026-00', '2026-13', '2026-1', '0000-01', '2026-01-01', null].map((month) => ({
      idToken: token,
      month
    })),
    ...[0, -1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 1].map((page) => ({
      idToken: token,
      page
    })),
    ...['', '../venue', 'tw_test', personId, 'a'.repeat(65)].map((venue) => ({
      idToken: token,
      venue
    }))
  ])('strict request rejects %j before credential/DB', async (input) => {
    const f = fixture();
    expect(await f.history(requestId, input)).toEqual({
      status: 400,
      body: { ok: false, error: 'invalid_input' }
    });
    expect(f.verifyIdentity).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
  });
  it('binds only verified subject, filters and default page; clears both contexts in both transactions', async () => {
    const f = fixture();
    expect(await f.history(requestId, { idToken: token })).toEqual({ status: 200, body: empty });
    expect(f.verifyIdentity).toHaveBeenCalledWith(token, '123');
    expect(f.query).toHaveBeenCalledWith(historySql, ['line', subject, null, null, 1]);
    for (const key of ['person_id', 'principal_id']) {
      expect(
        f.query.mock.calls.filter(
          ([sql, values]) => sql.includes(`qigong.${key}`) && values?.[0] === ''
        )
      ).toHaveLength(2);
    }
    expect(f.query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(2);
    expect(f.release).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('binds supplied month/venue/page without accepting identity overrides', async () => {
    const f = fixture();
    f.state.data = { ...empty, page: 2 };
    expect(
      (
        await f.history(requestId, {
          idToken: token,
          month: '2026-10',
          venue: 'tw-test-one',
          page: 2
        })
      ).status
    ).toBe(200);
    expect(f.query).toHaveBeenCalledWith(historySql, [
      'line',
      subject,
      '2026-10',
      'tw-test-one',
      2
    ]);
  });
  it('expired/rejected token never reaches the database or leaks diagnostics', async () => {
    const f = fixture();
    f.verifyIdentity.mockRejectedValue(new Error(token + personId));
    expect(await f.history(requestId, { idToken: token })).toEqual({
      status: 401,
      body: { ok: false, error: 'invalid_line_identity' }
    });
    expect(f.connect).not.toHaveBeenCalled();
  });
  it('unknown mapping fails closed before history', async () => {
    const f = fixture();
    f.state.mapping = null;
    expect((await f.history(requestId, { idToken: token })).status).toBe(403);
    expect(f.query.mock.calls.some(([sql]) => sql === historySql)).toBe(false);
  });
  it.each([
    ['42501', 403, 'identity_consent_or_venue_unavailable'],
    ['22023', 400, 'invalid_input'],
    ['XX000', 503, 'venue_unavailable']
  ])('sanitizes DB error %s and rolls back', async (code, status, error) => {
    const f = fixture();
    f.state.historyError = Object.assign(new Error(token + personId), { code });
    expect(await f.history(requestId, { idToken: token })).toEqual({
      status,
      body: { ok: false, error }
    });
    expect(f.query).toHaveBeenCalledWith('ROLLBACK');
    expect(f.release).toHaveBeenCalledTimes(2);
  });
  it.each([
    { ...empty, personId },
    { ...empty, page: 2 },
    {
      ...empty,
      entries: [
        {
          id: personId,
          venueCode: 'tw-test-one',
          venueName: 'Synthetic',
          checkedInAt: '2026-10-01T00:00:00Z',
          venueLocalDate: '2026-10-01',
          venueTimezone: 'fake/timezone'
        }
      ]
    },
    { ...empty, totals: { attendanceCount: 0, attendanceDays: 1, monthCount: 0 } }
  ])('does not forward malformed or overbroad DB data', async (data) => {
    const f = fixture();
    f.state.data = data;
    expect((await f.history(requestId, { idToken: token })).status).toBe(503);
    expect(f.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('HTTP same-origin JSON + custom header boundary (unwired module)', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });
  const setup = () => {
    const f = fixture();
    const app = Fastify({ logger: false, genReqId: () => crypto.randomUUID() });
    apps.push(app);
    registerVenueHistoryRoutes(app, f.pool, f.config);
    return { ...f, app };
  };
  it('serves exact success with no-store and no-referrer', async () => {
    const f = setup();
    const res = await f.app.inject({
      method: 'POST',
      url: '/api/line/venue-history',
      headers: { origin, 'x-venue-history': '1' },
      payload: { idToken: token }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(empty);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
  it.each([
    {},
    { origin },
    { origin: 'https://evil.invalid', 'x-venue-history': '1' },
    { origin: 'null', 'x-venue-history': '1' },
    { origin, 'x-venue-history': '0' },
    { origin: origin + '/', 'x-venue-history': '1' },
    { origin, 'x-venue-history': '1', 'content-type': 'text/plain' }
  ])(
    'denies missing/foreign origin or incorrect header/content-type %j before verifier',
    async (headers) => {
      const f = setup();
      const res = await f.app.inject({
        method: 'POST',
        url: '/api/line/venue-history',
        headers: { 'content-type': 'application/json', ...headers },
        payload: JSON.stringify({ idToken: token })
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().ok).toBe(false);
      expect(f.verifyIdentity).not.toHaveBeenCalled();
      expect(f.connect).not.toHaveBeenCalled();
    }
  );
  it.each(['{"idToken":"' + token, JSON.stringify({ idToken: token.repeat(1000) })])(
    'sanitizes parser and oversized body errors',
    async (payload) => {
      const f = setup();
      const res = await f.app.inject({
        method: 'POST',
        url: '/api/line/venue-history',
        headers: { origin, 'x-venue-history': '1', 'content-type': 'application/json' },
        payload
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toContain(token);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(f.verifyIdentity).not.toHaveBeenCalled();
    }
  );
  it.each(['http://synthetic.invalid', origin + '/', origin + '/path', 'invalid'])(
    'refuses unsafe composition origin %s',
    (publicOrigin) => {
      const f = fixture();
      const app = Fastify();
      apps.push(app);
      expect(() =>
        registerVenueHistoryRoutes(app, f.pool, { ...f.config, publicOrigin })
      ).toThrow();
    }
  );
});
