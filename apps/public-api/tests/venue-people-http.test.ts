/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeVenuePeopleResult, type VenuePeopleQuery } from '../src/venue-people-helpers.js';
import {
  registerVenuePeopleRoutes,
  validateVenuePeopleConfig
} from '../src/venue-people-routes.js';

const origin = 'https://synthetic.invalid';
const token = 's'.repeat(43),
  csrf = 'c'.repeat(43);
const regionId = '01000000-0000-4000-8000-000000000003';
const payload = {
  mode: 'people',
  regionId,
  fieldId: null,
  personId: null,
  period: { month: '2026-10' },
  search: '',
  sort: 'recent',
  direction: 'desc',
  page: 1,
  limit: 20
};
const headers = {
  origin,
  cookie: `__Host-qigong-admin=${token}; __Host-qigong-admin-csrf=${csrf}`,
  'x-csrf-token': csrf
};
const mockRead = vi.fn(
  async (_requestId: string, _session: string, q: VenuePeopleQuery, exporting: boolean) =>
    decodeVenuePeopleResult(
      {
        ...q,
        version: 1,
        exporting,
        page: exporting ? 1 : q.page,
        limit: exporting ? 1000 : q.limit,
        total: 0,
        totals: { attendanceCount: 0, attendanceDays: 0, learnerCount: 0 },
        rows: []
      },
      q,
      exporting
    )
);
const principalFor = vi.fn(async (): Promise<string | null> => regionId);
const apps: ReturnType<typeof Fastify>[] = [];
const app = () => {
  const instance = Fastify({ logger: false, genReqId: () => crypto.randomUUID() });
  registerVenuePeopleRoutes(instance, {
    config: { enabled: true, publicOrigin: origin },
    service: { read: mockRead },
    pagePrincipalFor: principalFor
  });
  apps.push(instance);
  return instance;
};
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  mockRead.mockClear();
  principalFor.mockClear();
});
const post = (
  instance: ReturnType<typeof Fastify>,
  body: unknown = payload,
  h: Record<string, string> = headers,
  exporting = false
) =>
  instance.inject({
    method: 'POST',
    url: '/admin/venue-people/api/' + (exporting ? 'export' : 'read'),
    headers: h,
    payload: body
  });

describe('venue people standalone HTTP', () => {
  it('requires explicit HTTPS composition configuration', () => {
    expect(validateVenuePeopleConfig({ enabled: true, publicOrigin: origin })).toEqual({
      enabled: true,
      publicOrigin: origin
    });
    for (const publicOrigin of [
      'http://synthetic.invalid',
      origin + '/',
      origin + '/path',
      'https://user:pass@synthetic.invalid'
    ])
      expect(() => validateVenuePeopleConfig({ enabled: true, publicOrigin })).toThrow();
  });
  it('serves no-store authenticated shell with strict CSP, not data or implicit view access', async () => {
    const instance = app();
    expect((await instance.inject('/admin/venue-people')).statusCode).toBe(401);
    const response = await instance.inject({
      url: '/admin/venue-people',
      headers: { cookie: headers.cookie }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-security-policy']).toContain("script-src 'sha256-");
    expect(response.headers['content-security-policy']).not.toContain('unsafe-inline');
    expect(response.body).toContain('Bean, Bird &amp; Badminton Tech Consulting');
    expect(mockRead).not.toHaveBeenCalled();
    principalFor.mockResolvedValueOnce(null);
    expect(
      (await instance.inject({ url: '/admin/venue-people', headers: { cookie: headers.cookie } }))
        .statusCode
    ).toBe(401);
    expect(
      (
        await instance.inject({
          url: '/admin/venue-people?name=secret',
          headers: { cookie: headers.cookie }
        })
      ).statusCode
    ).toBe(400);
  });
  it('passes only server-resolved cookie and strict canonical selector, operation set by route', async () => {
    const instance = app();
    const response = await post(instance);
    expect(response.statusCode).toBe(200);
    expect(mockRead.mock.calls[0]?.slice(1)).toEqual([
      token,
      expect.objectContaining({ from: '2026-10-01', until: '2026-11-01' }),
      false
    ]);
    const csv = await post(instance, payload, headers, true);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(mockRead.mock.calls[1]?.[3]).toBe(true);
  });
  it.each([
    { origin: 'https://attacker.invalid' },
    { origin: '' },
    { 'x-csrf-token': 'x'.repeat(43) },
    { 'x-csrf-token': '' },
    { cookie: `__Host-qigong-admin=${token}` },
    { cookie: headers.cookie + `; __Host-qigong-admin-csrf=${csrf}` },
    { 'sec-fetch-site': 'cross-site' }
  ])('rejects CSRF/origin/header ambiguity %j without querying service', async (patch) => {
    expect((await post(app(), payload, { ...headers, ...patch })).statusCode).toBe(403);
    expect(mockRead).not.toHaveBeenCalled();
  });
  it.each([
    '',
    `__Host-qigong-admin=${token}; __Host-qigong-admin=${token}`,
    `__Host-qigong-admin=not-a-token`
  ])('rejects absent/duplicate/invalid session %j', async (cookie) => {
    expect((await post(app(), payload, { ...headers, cookie })).statusCode).toBe(401);
    expect(mockRead).not.toHaveBeenCalled();
  });
  it.each([
    { principalId: regionId },
    { personContext: regionId },
    { exporting: true },
    { mode: 'manual' },
    { page: '1' },
    { fieldId: '../x' }
  ])('rejects unauthorized selector shape %j', async (patch) => {
    expect((await post(app(), { ...payload, ...patch })).statusCode).toBe(400);
    expect(mockRead).not.toHaveBeenCalled();
  });
  it.each([
    ['28000', 401],
    ['42501', 403],
    ['22023', 400],
    ['54000', 413],
    ['XX000', 503]
  ] as const)('maps SQL code %s without diagnostic/PII echoes', async (code, status) => {
    mockRead.mockRejectedValueOnce(Object.assign(new Error('secret SQL diagnostic'), { code }));
    const response = await post(app());
    expect(response.statusCode).toBe(status);
    expect(response.body).not.toContain('secret');
    expect(response.headers['cache-control']).toBe('no-store');
    if (code === '54000')
      expect(response.json()).toEqual({ error: 'export_too_large', maximumRows: 1000 });
  });
  it('handles malformed/oversized JSON without fragments or service calls', async () => {
    const instance = app();
    const malformed = await post(instance, '{"private":"fragment",', {
      ...headers,
      'content-type': 'application/json'
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain('fragment');
    const large = await post(instance, { ...payload, search: 'secret'.repeat(1000) });
    expect(large.statusCode).toBe(413);
    expect(large.body).not.toContain('secret');
    expect(mockRead).not.toHaveBeenCalled();
  });
});
