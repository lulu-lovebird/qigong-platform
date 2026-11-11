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

const id = '10000000-0000-4000-8000-000000000001';
const secondId = '10000000-0000-4000-8000-000000000002';
const regionId = '20000000-0000-4000-8000-000000000001';
const campaign = (campaignId = id) => ({
  id: campaignId,
  title: 'Guidance',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  timezone: 'Asia/Taipei',
  isActive: true
});
const mockAdapter = () => {
  const read = vi.fn<TrustedAdminMcpReadAdapter['read']>();
  return { adapter: { read }, read };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('adapter-only bounded read service', () => {
  it('delegates only normalized read selectors and emits a versioned response', async () => {
    const { adapter, read } = mockAdapter();
    read.mockResolvedValue({ status: 'ok', data: { campaigns: [campaign(), campaign(secondId)] } });
    const before = Date.now();
    const result = await createAdminMcpReadService(adapter).read({
      operation: 'guidance_list',
      limit: 1
    });
    expect(read).toHaveBeenCalledExactlyOnceWith({
      operation: 'guidance_list',
      after: null,
      fetchLimit: 2
    });
    expect(result).toMatchObject({
      ok: true,
      schemaVersion: 1,
      data: { operation: 'guidance_list', campaigns: [campaign()] },
      truncated: true
    });
    expect(result.requestId).toMatch(uuid);
    if (!result.ok) throw new Error('Expected a successful synthetic read');
    expect(Date.parse(result.asOf)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(result.asOf)).toBeLessThanOrEqual(Date.now());
    expect(result.warnings).toEqual(['Pagination is not a snapshot; asOf is the response time.']);
    expect(result.nextCursor).toBeTypeOf('string');
    expect(Object.isFrozen(read.mock.calls[0]?.[0])).toBe(true);
  });
  it('supports paginated guidance content and region-scoped minimized venue data', async () => {
    const { adapter, read } = mockAdapter();
    read
      .mockResolvedValueOnce({
        status: 'ok',
        data: {
          campaign: campaign(),
          entries: [
            {
              id,
              guideDate: '2026-11-01',
              title: null,
              content: 'Read as data',
              token: 'do-not-return'
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        status: 'ok',
        data: {
          fields: [
            {
              id,
              region_id: regionId,
              code: 'tpe-test',
              name_zh_tw: '測試',
              name_en: null,
              timezone: 'Asia/Taipei',
              is_active: true,
              phone: 'do-not-return',
              qr_token: 'do-not-return'
            }
          ]
        }
      });
    const service = createAdminMcpReadService(adapter);
    const guidance = await service.read({ operation: 'guidance_get', id });
    const venues = await service.read({ operation: 'venues_list', regionId, limit: 50 });
    expect(read).toHaveBeenNthCalledWith(1, {
      operation: 'guidance_get',
      id,
      after: null,
      fetchLimit: 21
    });
    expect(read).toHaveBeenNthCalledWith(2, {
      operation: 'venues_list',
      regionId,
      after: null,
      fetchLimit: 51
    });
    expect(guidance).toMatchObject({
      ok: true,
      data: { operation: 'guidance_get', campaign: campaign() },
      nextCursor: null,
      truncated: false
    });
    expect(venues).toMatchObject({
      ok: true,
      data: { operation: 'venues_list', regionId, venues: [{ id, nameZhTw: '測試' }] }
    });
    expect(JSON.stringify([guidance, venues])).not.toContain('do-not-return');
    expect(guidance.requestId).not.toBe(venues.requestId);
    expect(adminMcpReadRequiredScopes).toEqual({
      guidance_list: 'admin:guidance:read',
      guidance_get: 'admin:guidance:read',
      venues_list: 'admin:venues:read'
    });
  });
  it.each([
    { operation: 'guidance_list', principalId: id },
    { operation: 'guidance_list', role: 'super_admin' },
    { operation: 'guidance_list', session: 'pretend-session' },
    { operation: 'guidance_list', oauthToken: 'pretend-token' },
    { operation: 'guidance_list', limit: 51 },
    { operation: 'guidance_list', cursor: 'not-json' },
    { operation: 'venues_list' },
    { operation: 'attendance_get_summary' },
    { operation: 'guidance_update', id, title: 'forbidden' }
  ])('rejects malformed input before touching the adapter: %j', async (input) => {
    const { adapter, read } = mockAdapter();
    const result = await createAdminMcpReadService(adapter).read(input);
    expect(result).toEqual({
      ok: false,
      schemaVersion: 1,
      requestId: expect.stringMatching(uuid),
      error: 'invalid_request'
    });
    expect(read).not.toHaveBeenCalled();
  });
  it('does not cache a successful grant across pages or calls', async () => {
    const { adapter, read } = mockAdapter();
    read
      .mockResolvedValueOnce({
        status: 'ok',
        data: { campaigns: [campaign(), campaign(secondId)] }
      })
      .mockResolvedValue({ status: 'permission_denied' });
    const service = createAdminMcpReadService(adapter);
    const first = await service.read({ operation: 'guidance_list', limit: 1 });
    if (!first.ok) throw new Error('Expected first synthetic page');
    const revoked = await service.read({
      operation: 'guidance_list',
      limit: 1,
      cursor: first.nextCursor
    });
    const repeated = await service.read({ operation: 'guidance_list', limit: 1 });
    expect(revoked).toMatchObject({ ok: false, error: 'permission_denied' });
    expect(repeated).toMatchObject({ ok: false, error: 'permission_denied' });
    expect(read).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenNthCalledWith(2, {
      operation: 'guidance_list',
      after: id,
      fetchLimit: 2
    });
    expect(JSON.stringify([revoked, repeated])).not.toContain('campaigns');
  });
  it('honors adapter denial for every operation without exposing resource existence', async () => {
    const { adapter, read } = mockAdapter();
    read.mockResolvedValue({ status: 'permission_denied' });
    const service = createAdminMcpReadService(adapter);
    for (const input of [
      { operation: 'guidance_list' },
      { operation: 'guidance_get', id },
      { operation: 'venues_list', regionId }
    ]) {
      expect(await service.read(input)).toMatchObject({ ok: false, error: 'permission_denied' });
    }
    // These are mocked denials, NOT proof of OAuth or database authorization.
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('permits not-found only for a single authorized guidance selector', async () => {
    const { adapter, read } = mockAdapter();
    read.mockResolvedValue({ status: 'not_found' });
    const service = createAdminMcpReadService(adapter);
    expect(await service.read({ operation: 'guidance_get', id })).toMatchObject({
      ok: false,
      error: 'not_found'
    });
    expect(await service.read({ operation: 'guidance_list' })).toMatchObject({
      ok: false,
      error: 'read_unavailable'
    });
    expect(await service.read({ operation: 'venues_list', regionId })).toMatchObject({
      ok: false,
      error: 'read_unavailable'
    });
  });
  it.each<AdminMcpReadAdapterResult>([
    { status: 'unavailable' },
    { status: 'ok', data: null },
    { status: 'ok', data: { campaigns: [{ secret: 'do-not-return' }] } },
    { status: 'ok', data: { campaigns: [campaign(secondId), campaign()] } },
    { status: 'ok', data: { campaigns: Array.from({ length: 22 }, () => campaign()) } }
  ])('fails closed on unavailable or invalid source responses', async (source) => {
    const { adapter, read } = mockAdapter();
    read.mockResolvedValue(source);
    const result = await createAdminMcpReadService(adapter).read({ operation: 'guidance_list' });
    expect(result).toEqual({
      ok: false,
      schemaVersion: 1,
      requestId: expect.stringMatching(uuid),
      error: 'read_unavailable'
    });
    expect(JSON.stringify(result)).not.toContain('do-not-return');
  });
  it('counts envelope metadata toward the total serialized response bound', async () => {
    const { adapter, read } = mockAdapter();
    const sourceCampaign = { ...campaign(), startDate: '2026-01-01', endDate: '2026-12-31' };
    const entries = Array.from({ length: 50 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      guideDate: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      title: 'a'.repeat(100),
      content: 'a'.repeat(500)
    }));
    const input = { operation: 'guidance_get', id, limit: 50 };
    const query = buildAdminMcpReadQuery(parseAdminMcpReadRequest(input));
    const source = { campaign: sourceCampaign, entries };
    const initialBytes = Buffer.byteLength(JSON.stringify(decodeAdminMcpReadPage(source, query)));
    let remaining = Math.floor((adminMcpReadMaximumBytes - 30 - initialBytes) / 5);
    const adjusted = entries.map((row) => {
      const escaped = Math.min(500, remaining);
      remaining -= escaped;
      return { ...row, content: '\u0000'.repeat(escaped) + 'a'.repeat(500 - escaped) };
    });
    const boundedSource = { campaign: sourceCampaign, entries: adjusted };
    const pageBytes = Buffer.byteLength(
      JSON.stringify(decodeAdminMcpReadPage(boundedSource, query))
    );
    expect(pageBytes).toBeGreaterThan(adminMcpReadMaximumBytes - 100);
    expect(pageBytes).toBeLessThan(adminMcpReadMaximumBytes);
    read.mockResolvedValue({ status: 'ok', data: boundedSource });
    expect(await createAdminMcpReadService(adapter).read(input)).toMatchObject({
      ok: false,
      error: 'read_unavailable'
    });
  });
  it('never echoes/logs adapter exceptions or retries a failed read', async () => {
    const { adapter, read } = mockAdapter();
    read.mockRejectedValue(
      new Error('SELECT secret FROM private; Cookie=do-not-return; phone=do-not-return')
    );
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    try {
      const result = await createAdminMcpReadService(adapter).read({
        operation: 'guidance_get',
        id
      });
      expect(result).toEqual({
        ok: false,
        schemaVersion: 1,
        requestId: expect.stringMatching(uuid),
        error: 'read_unavailable'
      });
      expect(read).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(/SELECT|private|Cookie|do-not-return/);
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
