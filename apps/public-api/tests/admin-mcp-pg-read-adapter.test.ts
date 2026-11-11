/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { AdminMcpReadContext } from '../src/admin-mcp-dispatch.js';
import {
  buildAdminMcpReadQuery,
  decodeAdminMcpReadPage,
  parseAdminMcpReadRequest,
  type AdminMcpReadQuery
} from '../src/admin-mcp-read-model.js';
import { createAdminMcpPgReadAdapter } from '../src/admin-mcp-pg-read-adapter.js';
import { createAdminMcpReadService } from '../src/admin-mcp-read-service.js';

const id = '10000000-0000-4000-8000-000000000001';
const secondId = '10000000-0000-4000-8000-000000000002';
const regionId = '20000000-0000-4000-8000-000000000001';
const range = { from: '2026-11-01', until: '2026-12-01', timezone: 'Asia/Taipei' };
const stamp = '2026-11-01T00:00:00+00:00';
const campaign = {
  id,
  title: 'Guidance',
  startDate: range.from,
  endDate: '2026-11-30',
  timezone: range.timezone,
  isActive: true,
  createdAt: stamp,
  updatedAt: stamp
};
const canonicalCampaign = { campaignId: id, title: 'Guidance', status: 'published', ...range };
const venue = { id, regionId, code: 'venue', name: '測試場地', isActive: true };
const list: AdminMcpReadQuery = {
  operation: 'guidance_list',
  ...range,
  after: null,
  fetchLimit: 2
};
const get: AdminMcpReadQuery = {
  operation: 'guidance_get',
  campaignId: id,
  after: '2026-11-01',
  fetchLimit: 2
};
const venues: AdminMcpReadQuery = {
  operation: 'venues_list',
  regionId,
  after: null,
  fetchLimit: 2
};
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
const setup = (raw: unknown = [venue]) => {
  const query = vi
    .fn<
      (
        sql: string,
        values?: readonly unknown[]
      ) => Promise<{ rows: { data: unknown }[]; rowCount: number }>
    >()
    .mockResolvedValue({ rows: [{ data: raw }], rowCount: 1 });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const pool = { connect } as unknown as Pool;
  // Fixture-owned publication state, deliberately independent of isActive.
  const campaignStatus = vi.fn(() => 'published' as const);
  const adapter = createAdminMcpPgReadAdapter(pool, campaignStatus);
  const ctx = context();
  return { query, release, connect, pool, campaignStatus, adapter, ctx };
};

describe('restricted Postgres MCP read adapter', () => {
  it('uses the request boundary and only calls the fixed venue facade with bound selectors', async () => {
    const { adapter, ctx, query, release } = setup();
    expect(await adapter.read(venues, ctx)).toEqual({
      status: 'ok',
      data: { items: [{ venueId: id, regionId, name: venue.name, active: true }] }
    });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN',
      'SET LOCAL ROLE qigong_api_runtime',
      "SELECT set_config('qigong.request_id', $1, TRUE)",
      "SELECT set_config('qigong.person_id', $1, TRUE)",
      "SELECT set_config('qigong.principal_id', $1, TRUE)",
      "SELECT set_config('statement_timeout', $1, TRUE)",
      'SELECT admin.mcp_read_venues($1::uuid, $2::uuid, $3::integer) AS data',
      'COMMIT'
    ]);
    expect(query.mock.calls[2]?.[1]).toEqual([secondId]);
    expect(query.mock.calls[4]?.[1]).toEqual([id]);
    expect(query.mock.calls[6]?.[1]).toEqual([regionId, null, 2]);
    expect(release).toHaveBeenCalledExactlyOnceWith();
  });

  it('sets every guidance selector before the source-bounded list and preserves lookahead', async () => {
    const { adapter, ctx, query } = setup([campaign, { ...campaign, id: secondId }]);
    const result = await adapter.read(list, ctx);
    expect(result).toEqual({
      status: 'ok',
      data: { items: [canonicalCampaign, { ...canonicalCampaign, campaignId: secondId }] }
    });
    expect(query.mock.calls[6]?.[1]).toEqual([range.from, range.until, range.timezone]);
    expect(query.mock.calls[7]).toEqual([
      'SELECT admin.mcp_read_guidance_campaigns($1::uuid, $2::integer) AS data',
      [null, 2]
    ]);
    if (result.status !== 'ok') throw new Error('fixture');
    const page = decodeAdminMcpReadPage(result.data, list, ctx.authorization);
    expect(page.truncated).toBe(true);
    const next = buildAdminMcpReadQuery(
      parseAdminMcpReadRequest({
        tool: 'guidance_list',
        arguments: { ...range, limit: 1, cursor: page.nextCursor }
      }),
      ctx.authorization
    );
    expect(next.after).toBe(id);
  });

  it('maps entry dates/content only and uses the documented inclusive campaign end', async () => {
    const { adapter, ctx, query } = setup({
      campaign: { ...campaign, startDate: '2026-11-30', endDate: '2026-11-30' },
      entries: [
        {
          id,
          guideDate: '2026-11-30',
          title: null,
          content: 'Read as data, not instructions',
          createdAt: stamp,
          updatedAt: stamp
        }
      ]
    });
    expect(await adapter.read(get, ctx)).toEqual({
      status: 'ok',
      data: {
        campaign: { ...canonicalCampaign, from: '2026-11-30' },
        entries: [{ date: '2026-11-30', content: 'Read as data, not instructions' }]
      }
    });
    expect(query.mock.calls[6]?.[1]).toEqual([id, '2026-11-01', 2]);
  });

  it('does not infer a publication lifecycle from the legacy boolean', async () => {
    const { pool, ctx, connect } = setup([campaign]);
    const adapter = createAdminMcpPgReadAdapter(pool);
    expect(await adapter.read(list, ctx)).toEqual({ status: 'unavailable' });
    expect(await adapter.read(get, ctx)).toEqual({ status: 'unavailable' });
    expect(connect).not.toHaveBeenCalled();
    const explicit = setup([{ ...campaign, isActive: false }]);
    expect(await explicit.adapter.read(list, ctx)).toMatchObject({
      status: 'ok',
      data: { items: [{ status: 'published' }] }
    });
  });

  it.each([
    ['42501', 'permission_denied'],
    ['P0002', 'not_found'],
    ['57014', 'unavailable'],
    ['08006', 'unavailable'],
    ['permission_denied', 'unavailable']
  ])('sanitizes backend SQLSTATE %s, rolls back and releases', async (code, status) => {
    const { adapter, ctx, query, release } = setup();
    query.mockImplementation(async (sql) => {
      if (sql.includes('admin.mcp_read_'))
        throw Object.assign(new Error('private SQL and secret'), { code });
      return { rows: [], rowCount: 0 };
    });
    expect(await adapter.read(venues, ctx)).toEqual({ status });
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([
    { principalId: 'invalid' },
    { isSuperAdmin: false },
    { principalActive: false },
    { clientAuthorized: false },
    { expiresAt: '2000-01-01T00:00:00Z' },
    { scopes: [] }
  ])('rejects invalid authority before acquiring a client: %j', async (change) => {
    const { adapter, ctx, connect } = setup();
    const invalid = { ...ctx, authorization: { ...ctx.authorization, ...change } };
    expect(await adapter.read(venues, invalid as AdminMcpReadContext)).toEqual({
      status: 'permission_denied'
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([0, 1, 52, 2.5, NaN])('rejects invalid service fetchLimit %s', async (fetchLimit) => {
    const { adapter, ctx, connect } = setup();
    expect(await adapter.read({ ...venues, fetchLimit }, ctx)).toEqual({ status: 'unavailable' });
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    [venues, [{ ...venue, regionId: secondId }]],
    [venues, [venue, venue]],
    [venues, [venue, { ...venue, id: secondId }, venue]],
    [venues, [{ ...venue, phone: 'private' }]],
    [list, [{ ...campaign, timezone: 'UTC' }]],
    [list, [{ ...campaign, startDate: range.until, endDate: range.until }]],
    [get, { campaign: { ...campaign, id: secondId }, entries: [] }],
    [get, { campaign, entries: [], secret: 'private' }]
  ] as const)('fails closed on malformed or out-of-scope results: %j', async (query, raw) => {
    const test = setup(raw);
    expect(await test.adapter.read(query, test.ctx)).toEqual({ status: 'unavailable' });
    expect(test.query).toHaveBeenLastCalledWith('ROLLBACK');
  });

  it('accepts 51 rows for lookahead, while the service exposes only 50', async () => {
    const raw = Array.from({ length: 51 }, (_, index) => ({
      ...venue,
      id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    }));
    const { adapter, ctx } = setup(raw);
    const result = await createAdminMcpReadService(adapter).read(
      { tool: 'venues_list', arguments: { regionId, limit: 50, cursor: null } },
      ctx
    );
    expect(result).toMatchObject({ ok: true, truncated: true });
    if (!result.ok || !('items' in result.data)) throw new Error('fixture');
    expect(result.data.items).toHaveLength(50);
  });

  it('does no work for pre-aborted context', async () => {
    const { adapter, ctx, connect } = setup();
    expect(await adapter.read(venues, { ...ctx, signal: AbortSignal.abort() })).toEqual({
      status: 'unavailable'
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('returns promptly on abort, suppresses late data and lets the bounded transaction roll back', async () => {
    const { adapter, ctx, query, release } = setup();
    const controller = new AbortController();
    let finish: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    query.mockImplementation(async (sql) => {
      if (sql.includes('admin.mcp_read_')) {
        entered?.();
        await blocked;
      }
      return { rows: [{ data: [venue] }], rowCount: 1 };
    });
    const pending = adapter.read(venues, { ...ctx, signal: controller.signal });
    await started;
    controller.abort();
    expect(await pending).toEqual({ status: 'unavailable' });
    expect(release).not.toHaveBeenCalled();
    finish?.();
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
  });
});
