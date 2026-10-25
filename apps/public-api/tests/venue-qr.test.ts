import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from '@qigong/database';
import { buildApp } from '../src/app.js';
import { createVenueQrCheckin, venueQrMigrationVersion } from '../src/venue-qr.js';
import type { LineConfig } from '../src/line-onboarding.js';

const subject = 'U' + 'a'.repeat(32);
const personId = '10000000-0000-4000-8000-000000000001';
const identityId = '20000000-0000-4000-8000-000000000001';
const requestId = '30000000-0000-4000-8000-000000000001';
const input = { idToken: 'mock-token', venue: 'tw-test-venue', latitude: 25, longitude: 121 };
const success = {
  ok: true,
  venue: { code: input.venue, name: '合成場地', timezone: 'Asia/Taipei' },
  checkedInAt: '2026-10-25T00:00:00+00:00',
  attendanceDate: '2026-10-25',
  replayed: false
};
const config = { enabled: true as const, publicOrigin: 'https://app.test' };
const headers = { origin: config.publicOrigin, 'x-venue-checkin': '1' };
const mock = () => {
  const write = vi.fn(async (): Promise<unknown> => success);
  const mapping = {
    subject,
    personId,
    identityId,
    revoked: false,
    learnerActive: true,
    channelActive: true,
    applicationApproved: true
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('resolve_line_learner_identity')) return { rows: [{ data: mapping }] };
    if (sql.includes('privacy_usage'))
      return { rows: [{ data: { active: false, reflectionConsent: true } }] };
    if (sql.includes('venue_qr_checkin')) return { rows: [{ data: await write() }] };
    if (sql.includes('schema_migrations')) return { rows: [{ version: venueQrMigrationVersion }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const pool = {
    connect: vi.fn(async () => ({ query, release })),
    query: vi.fn()
  } as unknown as Pool;
  const verifyIdentity = vi.fn(async () => ({ subject }));
  const line: LineConfig = {
    channelSecret: 'mock-secret',
    channelAccessToken: 'mock-access-token',
    loginChannelId: '123',
    liffId: '123-test',
    verifyIdentity
  };
  return { pool, query, release, write, line, verifyIdentity };
};
afterEach(() => vi.unstubAllEnvs());
describe('reviewed QR path through actual buildApp (mock LINE and SQL)', () => {
  it('default-off remains preview, QR API and old NFC API are unavailable', async () => {
    const m = mock();
    const app = buildApp({ pool: m.pool, logger: false, line: m.line });
    try {
      expect(
        (await app.inject('/line/venue-checkin?venue=tw-test-venue&source=qr')).body
      ).toContain('測試預覽');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/line/venue-checkin',
            headers,
            payload: input
          })
        ).statusCode
      ).toBe(404);
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/field-checkin', payload: input }))
          .statusCode
      ).toBe(404);
      expect(m.query).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('server enablement connects verifier → 0049 resolver → consent → transactional writer', async () => {
    const m = mock();
    const app = buildApp({ pool: m.pool, logger: false, line: m.line, venueQr: config });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/line/venue-checkin',
        headers,
        payload: input
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(success);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(m.verifyIdentity).toHaveBeenCalledWith('mock-token');
      expect(m.query).toHaveBeenCalledWith(
        'SELECT platform.resolve_line_learner_identity($1) AS data',
        [subject]
      );
      expect(m.query).toHaveBeenCalledWith(
        'SELECT platform.venue_qr_checkin($1,$2,$3,$4) AS data',
        [subject, input.venue, 25, 121]
      );
      expect(m.query.mock.calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(2);
      expect(m.query.mock.calls.filter(([sql]) => sql.includes('qigong.person_id'))).toHaveLength(
        2
      );
      expect(m.release).toHaveBeenCalledTimes(2);
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/field-checkin', payload: input }))
          .statusCode
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it.each([
    {},
    { origin: 'https://evil.test', 'x-venue-checkin': '1' },
    { origin: config.publicOrigin }
  ])('rejects origin/custom-header CSRF failures before identity: %j', async (badHeaders) => {
    const m = mock();
    const app = buildApp({ pool: m.pool, logger: false, line: m.line, venueQr: config });
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/line/venue-checkin',
            headers: badHeaders,
            payload: input
          })
        ).statusCode
      ).toBe(403);
      expect(m.verifyIdentity).not.toHaveBeenCalled();
      expect(m.query).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it.each([
    { ...input, personId },
    { ...input, checkinId: identityId },
    { ...input, subject },
    { ...input, mode: 'test' },
    { ...input, latitude: 91 },
    { ...input, longitude: '121' },
    { ...input, idToken: '' },
    { ...input, venue: 'bad' }
  ])('rejects untrusted selectors and malformed coordinates', async (badInput) => {
    const m = mock();
    expect((await createVenueQrCheckin(m.pool, m.line)(requestId, badInput)).status).toBe(400);
    expect(m.verifyIdentity).not.toHaveBeenCalled();
  });
  it('rejects invalid LINE credentials before opening any DB transaction', async () => {
    const m = mock();
    m.verifyIdentity.mockRejectedValueOnce(new Error('private token'));
    const result = await createVenueQrCheckin(m.pool, m.line)(requestId, input);
    expect(result.status).toBe(401);
    expect(m.query).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it.each([
    ['P0001', 'venue_outside_window', 409],
    ['P0001', 'venue_outside_radius', 409],
    ['42501', 'private revocation details', 403],
    ['XX000', 'private SQL details', 503]
  ] as const)('maps writer failure %s/%s and rolls back', async (code, message, status) => {
    const m = mock();
    m.write.mockRejectedValueOnce(Object.assign(new Error(message), { code }));
    const result = await createVenueQrCheckin(m.pool, m.line)(requestId, input);
    expect(result.status).toBe(status);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(m.query).toHaveBeenCalledWith('ROLLBACK');
    expect(m.release).toHaveBeenCalledTimes(2);
  });
  it.each([
    { ...success, attendanceDate: '2026-10-24' },
    { ...success, venue: { ...success.venue, code: 'other-venue' } },
    { ...success, user_latitude: 25 }
  ])('rolls back unexpected DB successes instead of returning false success', async (body) => {
    const m = mock();
    m.write.mockResolvedValueOnce(body);
    expect((await createVenueQrCheckin(m.pool, m.line)(requestId, input)).status).toBe(503);
    expect(m.query).toHaveBeenCalledWith('ROLLBACK');
  });
  it('preserves database replay success; no client-provided checkin IDs', async () => {
    const m = mock();
    m.write.mockResolvedValueOnce({ ...success, replayed: true });
    expect(await createVenueQrCheckin(m.pool, m.line)(requestId, input)).toEqual({
      status: 200,
      body: { ...success, replayed: true }
    });
  });
  it('requires explicit HTTPS origin and LINE config, never a URL bypass', () => {
    const m = mock();
    expect(() => buildApp({ pool: m.pool, logger: false, venueQr: config })).toThrow();
    expect(() =>
      buildApp({
        pool: m.pool,
        logger: false,
        line: m.line,
        venueQr: { ...config, publicOrigin: 'http://app.test' }
      })
    ).toThrow();
  });
});
