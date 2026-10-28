/** Synthetic credentials only; no external LINE calls. */
import { createHash, createHmac } from 'node:crypto';
import type { Pool } from '@qigong/database';
import { describe, expect, it, vi } from 'vitest';
import { apiLogRedaction, buildApp, checkStartupReadiness } from '../src/app.js';
import { createVenueQrCheckin } from '../src/venue-qr.js';
import { ownLogValue } from '../src/log-privacy.js';
import { loadVenueDebugConfig, validateVenueDebugConfig } from '../src/venue-debug.js';

const token = 'synthetic-distance-fixture-only-token';
const debug = () => ({
  enabled: true as const,
  venueCode: 'tw-taipei-cks' as const,
  tokenHash: createHash('sha256').update(token).digest('hex'),
  expiresAt: new Date(Date.now() + 3600000).toISOString()
});
const subject = 'U' + 'a'.repeat(32);
const requestId = '30000000-0000-4000-8000-000000000001';
const input = {
  idToken: 'synthetic-id-token',
  venue: 'tw-taipei-cks',
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
    if (sql.includes(' AS ready')) return { rows: [{ ready: true }] };
    if (sql.includes('schema_migrations'))
      return { rows: [{ version: '0058_venue_early_checkin_window.sql' }] };
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
    if (sql.includes('SELECT id FROM identity.people')) return { rows: [], rowCount: 0 };
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
    expect(() =>
      validateVenueDebugConfig({
        ...debug(),
        expiresAt: new Date(Date.now() + 3601000).toISOString()
      })
    ).toThrow();
    for (const venueCode of [undefined, '', 'tw-other', 'tw-location-test,tw-taipei-cks', '*']) {
      expect(() =>
        loadVenueDebugConfig({
          VENUE_DISTANCE_DEBUG_ENABLED: 'true',
          VENUE_DISTANCE_DEBUG_VENUE_CODE: venueCode,
          VENUE_DISTANCE_DEBUG_EXPIRES_AT: debug().expiresAt,
          VENUE_DISTANCE_DEBUG_TOKEN_SHA256: debug().tokenHash
        })
      ).toThrow('invalid venue debug configuration');
    }
    expect(
      loadVenueDebugConfig({
        VENUE_DISTANCE_DEBUG_ENABLED: 'true',
        VENUE_DISTANCE_DEBUG_VENUE_CODE: 'tw-taipei-cks',
        VENUE_DISTANCE_DEBUG_EXPIRES_AT: debug().expiresAt,
        VENUE_DISTANCE_DEBUG_TOKEN_SHA256: debug().tokenHash
      })
    ).toMatchObject({ venueCode: 'tw-taipei-cks' });
  });
  it.each(['tw-location-test', 'tw-taipei-cks'] as const)(
    'binds each configuration/token to exactly one venue (%s)',
    async (venueCode) => {
      const m = mock();
      const checkin = createVenueQrCheckin(m.pool, m.line, { ...debug(), venueCode });
      m.write.mockResolvedValue({ ...testResult, venue: { ...formal.venue, code: venueCode } });
      expect((await checkin(requestId, { ...input, venue: venueCode }, token)).status).toBe(200);
      const other = venueCode === 'tw-location-test' ? 'tw-taipei-cks' : 'tw-location-test';
      expect(await checkin(requestId, { ...input, venue: other }, token)).toMatchObject({
        status: 403,
        body: { error: 'venue_debug_denied' }
      });
    }
  );
  it('test site without a header never enters identity lookup or the normal DB writer', async () => {
    for (const config of [
      undefined,
      debug(),
      { ...debug(), venueCode: 'tw-location-test' as const }
    ]) {
      const m = mock();
      expect(
        await createVenueQrCheckin(
          m.pool,
          m.line,
          config
        )(requestId, { ...input, venue: 'tw-location-test' })
      ).toMatchObject({
        status: 403,
        body: { error: 'venue_test_code_required' }
      });
      expect(m.query).not.toHaveBeenCalled();
      expect(m.line.verifyIdentity).not.toHaveBeenCalled();
    }
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
      const logger = vi.fn();
      expect(
        await checkin(requestId, input, candidate === undefined ? token : candidate, logger)
      ).toMatchObject({ status: 403, body: { error: 'venue_debug_denied' } });
      expect(logger).not.toHaveBeenCalled();
      expect(m.query).not.toHaveBeenCalled();
      expect(m.line.verifyIdentity).not.toHaveBeenCalled();
    }
  );
  it('valid header generates short lived context-bound proof; SQL never receives raw tokens', async () => {
    const m = mock(),
      config = debug();
    const logger = vi.fn(() => {
      throw new Error('synthetic unavailable diagnostic sink');
    });
    const result = await createVenueQrCheckin(m.pool, m.line, config)(
      requestId,
      input,
      token,
      logger
    );
    expect(result).toEqual({ status: 200, body: testResult });
    const call = m.query.mock.calls.find(([sql]) => sql.includes('venue_debug_checkin'))!;
    const params = call[1]!;
    expect(params.slice(0, 4)).toEqual([subject, input.venue, -25, 121]);
    expect(params[4]).toBeGreaterThan(Math.floor(Date.now() / 1000) - 3);
    const nonces = m.query.mock.calls.filter(([sql]) =>
      sql.includes("set_config('qigong.request_id'")
    );
    const nonce = nonces.at(-1)![1]![0];
    expect(nonce).not.toBe(requestId);
    expect(nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(logger).toHaveBeenCalledExactlyOnceWith({ auditRequestId: nonce });
    expect(params[5]).toBe(Date.parse(config.expiresAt));
    expect(params[6]).toBe(
      createHmac('sha256', Buffer.from(config.tokenHash, 'hex'))
        .update([nonce, subject, input.venue, params[4], params[5]].join('|'))
        .digest('hex')
    );
    expect(JSON.stringify(m.query.mock.calls)).not.toContain(token);
    expect(JSON.stringify(result)).not.toMatch(/token|latitude|longitude|personId/);
    await createVenueQrCheckin(m.pool, m.line, config)(requestId, input, token);
    const replayNonce = m.query.mock.calls
      .filter(([sql]) => sql.includes("set_config('qigong.request_id'"))
      .at(-1)![1]![0];
    expect(replayNonce).not.toBe(nonce);
  });
  it('wrong venue and expiry fail closed; no token still uses formal function', async () => {
    const m = mock(),
      config = debug();
    const checkin = createVenueQrCheckin(m.pool, m.line, config);
    for (const venue of ['tw-other-venue', 'tw-location-test'])
      expect((await checkin(requestId, { ...input, venue }, token)).status).toBe(403);
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
  it('requires exact 0058 and independent debug capability; feature-off stays compatible', async () => {
    const m = mock();
    expect(await checkStartupReadiness(m.pool, true, {}, true)).toMatchObject({ ready: true });
    expect(await checkStartupReadiness(m.pool, false)).toMatchObject({ ready: true });
    expect(await checkStartupReadiness(m.pool, false, {}, true)).toMatchObject({ ready: false });
    expect(apiLogRedaction.paths).toContain('req.headers.x-venue-debug-token');
    for (const version of [
      '0054_venue_people_read.sql',
      '0055_venue_distance_debug.sql',
      '0056_venue_cks_distance_debug.sql',
      '0057_venue_test_scope.sql',
      '0058_future.sql',
      '0059_future.sql'
    ]) {
      const query = vi.fn(async () => ({ rows: [{ version }] }));
      const pool = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool;
      expect(await checkStartupReadiness(pool, true, {}, true)).toMatchObject({
        ready: false,
        reason: 'schema_version_mismatch'
      });
    }
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
          'x-venue-debug-token': token,
          'x-request-id': requestId
        },
        payload: input
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(testResult);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-request-id']).toBe(requestId);
      const mappings = () =>
        logs
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as unknown)
          .filter((record) => ownLogValue(record, 'event') === 'venue_debug_audit_attempt');
      const nonce = m.query.mock.calls
        .filter(([sql]) => sql.includes("set_config('qigong.request_id'"))
        .at(-1)![1]![0];
      expect(mappings()).toEqual([
        expect.objectContaining({ reqId: requestId, auditRequestId: nonce })
      ]);
      expect(nonce).not.toBe(requestId);
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
      expect(mappings()).toHaveLength(1);
      for (const incoming of ['injected\\r\\nprivate', token, 'a'.repeat(300), input.idToken]) {
        const rejected = await app.inject({
          method: 'POST',
          url: '/api/line/venue-checkin',
          headers: { origin: 'https://app.test', 'x-venue-checkin': '1', 'x-request-id': incoming },
          payload: { ...input, isTest: true }
        });
        expect(rejected.statusCode).toBe(400);
        expect(rejected.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
        expect(rejected.headers['x-request-id']).not.toBe(incoming);
        expect(logs).not.toContain(incoming);
      }
      const proofs = m.query.mock.calls.filter(([sql]) => sql.includes('venue_debug_checkin'));
      for (const [, params] of proofs) expect(logs).not.toContain(String(params![5]));
      expect(logs).not.toContain(debug().tokenHash);
      expect(logs).not.toMatch(
        /synthetic-distance|synthetic-id-token|latitude|longitude|wrongwrong/
      );
    } finally {
      await app.close();
    }
  });
});
