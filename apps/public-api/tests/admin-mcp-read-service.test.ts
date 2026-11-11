/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  adminMcpReadMaximumBytes,
  buildAdminMcpReadQuery,
  decodeAdminMcpReadPage,
  parseAdminMcpReadRequest
} from '../src/admin-mcp-read-model.js';
import {
  adminMcpReadRequiredScopes,
  createAdminMcpReadService,
  type AdminMcpReadAdapterResult,
  type TrustedAdminMcpReadAdapter
} from '../src/admin-mcp-read-service.js';
import type { AdminMcpReadContext } from '../src/admin-mcp-dispatch.js';

const id = '10000000-0000-4000-8000-000000000001';
const secondId = '10000000-0000-4000-8000-000000000002';
const regionId = '20000000-0000-4000-8000-000000000001';
const range = { from: '2026-11-01', until: '2026-12-01', timezone: 'Asia/Taipei' };
const pagination = { limit: 1, cursor: null };
const campaign = (campaignId = id) => ({
  campaignId,
  title: 'Guidance',
  status: 'published',
  ...range
});
const list = { tool: 'guidance_list', arguments: { ...range, ...pagination } };
const get = { tool: 'guidance_get', arguments: { campaignId: id, ...pagination } };
const venues = { tool: 'venues_list', arguments: { regionId, ...pagination } };
const context = (): AdminMcpReadContext => ({
  authorization: {
    principalId: id,
    clientId: 'synthetic-client',
    principalActive: true,
    isSuperAdmin: true,
    clientAuthorized: true,
    scopes: ['admin:guidance:read', 'admin:venues:read'],
    expiresAt: '2099-01-01T00:00:00Z'
  },
  requestId: secondId,
  signal: new AbortController().signal
});
const mockAdapter = () => {
  const read = vi.fn<TrustedAdminMcpReadAdapter['read']>();
  const ctx = context();
  const service = createAdminMcpReadService({ read });
  return { read, ctx, service, call: (input: unknown) => service.read(input, ctx) };
};

describe('canonical adapter-only bounded read service', () => {
  it('delegates all selectors and trusted context, preserving the dispatcher request ID', async () => {
    const { read, ctx, call } = mockAdapter();
    read.mockResolvedValue({ status: 'ok', data: { items: [campaign(), campaign(secondId)] } });
    const before = Date.now();
    const result = await call(list);
    expect(read).toHaveBeenCalledExactlyOnceWith(
      { operation: 'guidance_list', ...range, after: null, fetchLimit: 2 },
      ctx
    );
    expect(result).toMatchObject({
      ok: true,
      schemaVersion: 1,
      requestId: ctx.requestId,
      data: { items: [campaign()] },
      truncated: true
    });
    if (!result.ok) throw new Error('Expected a successful synthetic read');
    expect(Date.parse(result.asOf)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(result.asOf)).toBeLessThanOrEqual(Date.now());
    expect(result.warnings).toEqual(['pagination_not_snapshot']);
    expect(result.nextCursor).toBeTypeOf('string');
    expect(Object.isFrozen(read.mock.calls[0]?.[0])).toBe(true);
  });
  it('supports paginated guidance content and region-scoped minimized venue data', async () => {
    const { read, call } = mockAdapter();
    read
      .mockResolvedValueOnce({
        status: 'ok',
        data: {
          campaign: campaign(),
          entries: [{ date: range.from, content: 'Read as data', token: 'do-not-return' }]
        }
      })
      .mockResolvedValueOnce({
        status: 'ok',
        data: {
          items: [
            {
              venueId: id,
              regionId,
              name: '測試',
              active: true,
              phone: 'do-not-return',
              qr_token: 'do-not-return'
            }
          ]
        }
      });
    const guidance = await call(get);
    const venueResult = await call({ ...venues, arguments: { ...venues.arguments, limit: 50 } });
    expect(read).toHaveBeenNthCalledWith(
      1,
      { operation: 'guidance_get', campaignId: id, after: null, fetchLimit: 2 },
      expect.anything()
    );
    expect(read).toHaveBeenNthCalledWith(
      2,
      { operation: 'venues_list', regionId, after: null, fetchLimit: 51 },
      expect.anything()
    );
    expect(guidance).toMatchObject({
      ok: true,
      data: { campaign: campaign() },
      nextCursor: null,
      truncated: false
    });
    expect(venueResult).toMatchObject({
      ok: true,
      data: { items: [{ venueId: id, name: '測試' }] }
    });
    expect(JSON.stringify([guidance, venueResult])).not.toContain('do-not-return');
    expect(adminMcpReadRequiredScopes).toEqual({
      guidance_list: 'admin:guidance:read',
      guidance_get: 'admin:guidance:read',
      venues_list: 'admin:venues:read'
    });
  });
  it.each([
    ...['principalId', 'role', 'session', 'oauthToken'].map((field) => ({
      ...list,
      arguments: { ...list.arguments, [field]: 'pretend' }
    })),
    { ...list, arguments: { ...list.arguments, limit: 51 } },
    { ...list, arguments: { ...list.arguments, cursor: 'not-json' } },
    { ...venues, arguments: pagination },
    { tool: 'attendance_get_summary', arguments: {} },
    { tool: 'guidance_update', arguments: { campaignId: id, title: 'forbidden' } },
    { operation: 'guidance_list' }
  ])('rejects malformed input before touching the adapter: %j', async (input) => {
    const { read, ctx, call } = mockAdapter();
    expect(await call(input)).toEqual({
      ok: false,
      schemaVersion: 1,
      requestId: ctx.requestId,
      error: { code: 'invalid_request' }
    });
    expect(read).not.toHaveBeenCalled();
  });
  it('does not cache a successful grant across pages or calls', async () => {
    const { read, call } = mockAdapter();
    read
      .mockResolvedValueOnce({ status: 'ok', data: { items: [campaign(), campaign(secondId)] } })
      .mockResolvedValue({ status: 'permission_denied' });
    const first = await call(list);
    if (!first.ok) throw new Error('Expected first synthetic page');
    const revoked = await call({
      ...list,
      arguments: { ...list.arguments, cursor: first.nextCursor }
    });
    const repeated = await call(list);
    expect(revoked).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    expect(repeated).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    expect(read).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenNthCalledWith(
      2,
      { operation: 'guidance_list', ...range, after: id, fetchLimit: 2 },
      expect.anything()
    );
    expect(JSON.stringify([revoked, repeated])).not.toContain('campaignId');
  });
  it('honors adapter denial for every operation without resource-existence disclosure', async () => {
    const { read, call } = mockAdapter();
    read.mockResolvedValue({ status: 'permission_denied' });
    for (const input of [list, get, venues])
      expect(await call(input)).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('maps not-found to the canonical safe unavailable-result error, not an empty success', async () => {
    const { read, call } = mockAdapter();
    read.mockResolvedValue({ status: 'not_found' });
    for (const input of [list, get, venues])
      expect(await call(input)).toMatchObject({ ok: false, error: { code: 'result_unavailable' } });
  });
  it.each<AdminMcpReadAdapterResult>([
    { status: 'unavailable' },
    { status: 'ok', data: null },
    { status: 'ok', data: { items: [{ secret: 'do-not-return' }] } },
    { status: 'ok', data: { items: [campaign(secondId), campaign()] } },
    { status: 'ok', data: { items: Array.from({ length: 3 }, () => campaign()) } }
  ])('fails closed on unavailable or invalid source responses', async (source) => {
    const { read, call } = mockAdapter();
    read.mockResolvedValue(source);
    const result = await call(list);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: source.status === 'unavailable' ? 'service_unavailable' : 'result_unavailable'
      }
    });
    expect(JSON.stringify(result)).not.toContain('do-not-return');
  });
  it('fails safely on malformed backend status envelopes', async () => {
    const { read, call } = mockAdapter();
    for (const raw of [null, undefined, {}, { status: 'SQL secret' }]) {
      read.mockResolvedValue(raw as AdminMcpReadAdapterResult);
      expect(await call(list)).toMatchObject({ ok: false, error: { code: 'service_unavailable' } });
    }
  });
  it('counts canonical envelope metadata toward the total serialized response bound', async () => {
    const { read, ctx, call } = mockAdapter();
    const sourceCampaign = { ...campaign(), from: '2026-10-01' };
    const entries = Array.from({ length: 50 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 9, index + 1)).toISOString().slice(0, 10),
      content: 'a'.repeat(1000)
    }));
    const input = { ...get, arguments: { ...get.arguments, limit: 50 } };
    const selected = buildAdminMcpReadQuery(parseAdminMcpReadRequest(input), ctx.authorization);
    const source = { campaign: sourceCampaign, entries };
    const initialBytes = Buffer.byteLength(
      JSON.stringify(decodeAdminMcpReadPage(source, selected, ctx.authorization))
    );
    let remaining = adminMcpReadMaximumBytes - 150 - initialBytes;
    const adjusted = entries.map((row) => {
      const extra = Math.min(3000, remaining);
      remaining -= extra;
      return { ...row, content: row.content + 'a'.repeat(extra) };
    });
    expect(remaining).toBe(0);
    const boundedSource = { campaign: sourceCampaign, entries: adjusted };
    const pageBytes = Buffer.byteLength(
      JSON.stringify(decodeAdminMcpReadPage(boundedSource, selected, ctx.authorization))
    );
    expect(pageBytes).toBe(adminMcpReadMaximumBytes - 150);
    read.mockResolvedValue({ status: 'ok', data: boundedSource });
    expect(await call(input)).toMatchObject({ ok: false, error: { code: 'result_unavailable' } });
  });
  it('never echoes/logs adapter exceptions or retries a failed read', async () => {
    const { read, call } = mockAdapter();
    read.mockRejectedValue(
      new Error('SELECT secret FROM private; Cookie=do-not-return; phone=do-not-return')
    );
    const spies = ['log', 'warn', 'error'].map((method) =>
      vi.spyOn(console, method as 'log' | 'warn' | 'error')
    );
    try {
      const result = await call(get);
      expect(result).toMatchObject({ ok: false, error: { code: 'service_unavailable' } });
      expect(read).toHaveBeenCalledTimes(1);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(/SELECT|private|Cookie|do-not-return/);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
  it('refuses absent scopes, inactive/expired authority and pre-aborted work before the backend', async () => {
    const { read, service, ctx } = mockAdapter();
    for (const authorization of [
      { ...ctx.authorization, scopes: [] },
      { ...ctx.authorization, isSuperAdmin: false },
      { ...ctx.authorization, principalActive: false },
      { ...ctx.authorization, clientAuthorized: false },
      { ...ctx.authorization, expiresAt: '2000-01-01T00:00:00Z' }
    ])
      expect(
        await service.read(list, { ...ctx, authorization } as AdminMcpReadContext)
      ).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    const controller = new AbortController();
    controller.abort();
    expect(await service.read(list, { ...ctx, signal: controller.signal })).toMatchObject({
      ok: false,
      error: { code: 'timeout' }
    });
    expect(read).not.toHaveBeenCalled();
  });
  it('passes abort to the backend and does not release a late response', async () => {
    const { read, ctx, service } = mockAdapter();
    const controller = new AbortController();
    read.mockImplementation(async (_query, received) => {
      expect(received.signal).toBe(controller.signal);
      controller.abort();
      return { status: 'ok', data: { items: [campaign()] } };
    });
    expect(await service.read(list, { ...ctx, signal: controller.signal })).toMatchObject({
      ok: false,
      error: { code: 'timeout' }
    });
  });
});
