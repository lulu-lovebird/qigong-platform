/** Synthetic credentials only; no external LINE calls. */
import { createHash, createHmac } from 'node:crypto';
import type { Pool } from '@qigong/database';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { createVenueQrCheckin } from '../src/venue-qr.js';
import { loadVenueDebugConfig, validateVenueDebugConfig } from '../src/venue-debug.js';

const token = 'synthetic-distance-fixture-only-token';
const debug = () => ({
  enabled: true as const,
  tokenHash: createHash('sha256').update(token).digest('hex'),
  expiresAt: new Date(Date.now() + 3600000).toISOString()
});
const subject = 'U' + 'a'.repeat(32);
const requestId = '30000000-0000-4000-8000-000000000001';
const input = {
  idToken: 'synthetic-id-token',
  venue: 'tw-location-test',
  latitude: -25,
  longitude: 121
};
const formal = {
  ok: true,
  venue: { code: input.venue, name: '合成場地', timezone: 'Asia/Taipei' },
  checkedInAt: '2026-10-25T00:00:00Z',
  attendanceDate: '2026-10-25',
  replayed: false
};
const testResult = { ...formal, isTest: true, verificationMode: 'distance_debug' };
const mock = () => {
  const write = vi.fn(async (): Promise<unknown> => testResult);
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    void params;
    if (sql.includes('resolve_line_learner_identity'))
      return {
        rows: [
          {
            data: {
              subject,
              personId: '10000000-0000-4000-8000-000000000001',
              identityId: '20000000-0000-4000-8000-000000000001',
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
    if (sql.includes('venue_debug_checkin') || sql.includes('venue_qr_checkin'))
      return { rows: [{ data: await write() }] };
    return { rows: [] };
  });
  const pool = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool;
  const line = {
    channelSecret: 'synthetic-secret',
    channelAccessToken: 'synthetic-access',
    loginChannelId: '123',
    liffId: '123-test',
    verifyIdentity: vi.fn(async () => ({ subject }))
  };
  return { pool, query, write, line };
};
describe('distance debug API authority (mock SQL / LINE)', () => {
  it('default off, finite explicit expiry and hash-only config', () => {
    expect(loadVenueDebugConfig({})).toBeUndefined();
    for (const value of [undefined, '', 'yes'])
      expect(() =>
        loadVenueDebugConfig({ VENUE_DISTANCE_DEBUG_ENABLED: value === undefined ? 'true' : value })
      ).toThrow();
    expect(() => validateVenueDebugConfig({ ...debug(), expiresAt: 'infinity' })).toThrow();
    expect(() =>
      validateVenueDebugConfig({ ...debug(), expiresAt: new Date(0).toISOString() })
    ).toThrow();
    expect(() => validateVenueDebugConfig({ ...debug(), tokenHash: token })).toThrow();
  });
  it.each([undefined, '', 'wrong'.repeat(8), [token, token]])(
    'rejects supplied invalid token or disabled configuration (%s)',
    async (candidate) => {
      const m = mock();
      const checkin = createVenueQrCheckin(
        m.pool,
        m.line,
        candidate === undefined ? undefined : debug()
      );
      expect(
        await checkin(requestId, input, candidate === undefined ? token : candidate)
      ).toMatchObject({ status: 403, body: { error: 'venue_debug_denied' } });
      expect(m.query).not.toHaveBeenCalled();
      expect(m.line.verifyIdentity).not.toHaveBeenCalled();
    }
  );
  it('valid header generates short lived context-bound proof; SQL never receives raw tokens', async () => {
    const m = mock(),
      config = debug();
    const result = await createVenueQrCheckin(m.pool, m.line, config)(requestId, input, token);
    expect(result).toEqual({ status: 200, body: testResult });
    const call = m.query.mock.calls.find(([sql]) => sql.includes('venue_debug_checkin'))!;
    const params = call[1]!;
    expect(params.slice(0, 4)).toEqual([subject, input.venue, -25, 121]);
    expect(params[4]).toBeGreaterThan(Math.floor(Date.now() / 1000) - 3);
    expect(params[5]).toBe(
      createHmac('sha256', Buffer.from(config.tokenHash, 'hex'))
        .update([requestId, subject, input.venue, params[4]].join('|'))
        .digest('hex')
    );
    expect(JSON.stringify(m.query.mock.calls)).not.toContain(token);
    expect(JSON.stringify(result)).not.toMatch(/token|latitude|longitude|personId/);
  });
  it('wrong venue and expiry fail closed; no token still uses formal function', async () => {
    const m = mock(),
      config = debug();
    const checkin = createVenueQrCheckin(m.pool, m.line, config);
    expect((await checkin(requestId, { ...input, venue: 'tw-other-venue' }, token)).status).toBe(
      403
    );
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(config.expiresAt) + 1);
    try {
      expect((await checkin(requestId, input, token)).status).toBe(403);
    } finally {
      vi.restoreAllMocks();
    }
    m.write.mockResolvedValue(formal);
    expect((await checkin(requestId, input)).status).toBe(200);
    expect(m.query.mock.calls.some(([sql]) => sql.includes('venue_qr_checkin'))).toBe(true);
    expect(m.query.mock.calls.some(([sql]) => sql.includes('venue_debug_checkin'))).toBe(false);
  });
  it('does not confuse formal and test success; rejects client boolean and unsafe diagnostics', async () => {
    const m = mock(),
      checkin = createVenueQrCheckin(m.pool, m.line, debug());
    expect((await checkin(requestId, { ...input, isTest: true }, token)).status).toBe(400);
    m.write.mockResolvedValue(formal);
    expect((await checkin(requestId, input, token)).status).toBe(503);
    m.write.mockResolvedValue(testResult);
    expect((await checkin(requestId, input)).status).toBe(503);
    m.write.mockRejectedValue(
      Object.assign(new Error('venue_debug_denied'), { code: '42501', detail: token })
    );
    const result = await checkin(requestId, input, token);
    expect(result).toMatchObject({ status: 403, body: { error: 'venue_debug_denied' } });
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it('actual router forwards header only; never logs secret or coordinates', async () => {
    const m = mock();
    let logs = '';
    const app = buildApp({
      pool: m.pool,
      line: m.line,
      venueQr: { enabled: true, publicOrigin: 'https://app.test', debug: debug() },
      logStream: {
        write: (chunk: string) => {
          logs += chunk;
        }
      }
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/line/venue-checkin',
        headers: {
          origin: 'https://app.test',
          'x-venue-checkin': '1',
          'x-venue-debug-token': token
        },
        payload: input
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(testResult);
      expect(response.headers['cache-control']).toBe('no-store');
      const invalid = await app.inject({
        method: 'POST',
        url: '/api/line/venue-checkin',
        headers: {
          origin: 'https://app.test',
          'x-venue-checkin': '1',
          'x-venue-debug-token': 'wrong'.repeat(8)
        },
        payload: input
      });
      expect(invalid.statusCode).toBe(403);
      expect(logs).not.toMatch(
        /synthetic-distance|synthetic-id-token|latitude|longitude|wrongwrong/
      );
    } finally {
      await app.close();
    }
  });
});
