/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
import { createAdminMcpPgReadAdapter } from '../../../apps/public-api/src/admin-mcp-pg-read-adapter.js';
import { createAdminMcpReadService } from '../../../apps/public-api/src/admin-mcp-read-service.js';
import type { AdminMcpReadContext } from '../../../apps/public-api/src/admin-mcp-dispatch.js';

const directory = fileURLToPath(new URL('../../../migrations/', import.meta.url));
const sql = readFileSync(
  new URL('../../../migrations/0064_admin_mcp_read_facade.sql', import.meta.url),
  'utf8'
);
const campaignKeys = [
  'id',
  'title',
  'startDate',
  'endDate',
  'timezone',
  'isActive',
  'createdAt',
  'updatedAt'
].sort();
const entryKeys = ['id', 'guideDate', 'title', 'content', 'createdAt', 'updatedAt'].sort();
const venueKeys = ['id', 'regionId', 'code', 'name', 'isActive'].sort();
const campaignId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const venueId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const range = { from: '2026-11-01', until: '2026-12-01', timezone: 'Asia/Taipei' };
const calls = [
  ['SELECT admin.mcp_read_guidance_campaigns($1::uuid, $2::integer) AS data', [null, 2]],
  [
    'SELECT admin.mcp_read_guidance_entries($1::uuid, $2::date, $3::integer) AS data',
    [campaignId(1), null, 2]
  ],
  ['SELECT admin.mcp_read_venues($1::uuid, $2::uuid, $3::integer) AS data', [venueId(1), null, 2]]
] as const;

describe('0064 source safety contracts (not execution evidence)', () => {
  it('has exactly three pinned definer reads, each guarded before limit/selectors', () => {
    expect(sql.match(/CREATE FUNCTION admin\.mcp_read_/g)).toHaveLength(3);
    expect(sql.match(/SECURITY DEFINER SET search_path = pg_catalog/g)).toHaveLength(3);
    expect(sql.match(/IF admin\.is_super_admin\(\) IS NOT TRUE THEN/g)).toHaveLength(3);
    expect(sql.match(/p_fetch_limit IS NULL OR p_fetch_limit NOT BETWEEN 1 AND 51/g)).toHaveLength(
      3
    );
    expect(sql.match(/LIMIT p_fetch_limit/g)).toHaveLength(3);
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|EXECUTE)\b(?! ON| TO)/);
  });
  it('restricts execute grants and never selects whole rows', () => {
    expect(sql).toContain('FROM PUBLIC, qigong_worker_runtime');
    expect(sql).toContain('TO qigong_api_runtime');
    expect(sql).not.toMatch(
      /SELECT \*|to_jsonb\(|jsonb_build_object\([^)]*(?:latitude|longitude|created_by|email|token)/
    );
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY|BYPASSRLS|GRANT SELECT/);
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.runIf(Boolean(databaseUrl))('0064 real PostgreSQL restricted read facade', () => {
  let pool: Pool;
  let dispose: (() => Promise<void>) | undefined;
  let superPrincipal: string;
  let region: string;
  const deniedPrincipals = new Map<string, string>();
  const read = async (
    statement: string,
    values: readonly unknown[],
    principalId: string | null = superPrincipal,
    selectors = true,
    role: 'qigong_api_runtime' | 'qigong_worker_runtime' = 'qigong_api_runtime'
  ): Promise<unknown> =>
    withRequestContext(
      pool,
      role,
      { requestId: randomUUID(), ...(principalId === null ? {} : { principalId }) },
      async (client) => {
        if (selectors)
          await client.query(
            `SELECT set_config('qigong.mcp_read_from', $1, TRUE),
                    set_config('qigong.mcp_read_until', $2, TRUE),
                    set_config('qigong.mcp_read_timezone', $3, TRUE)`,
            [range.from, range.until, range.timezone]
          );
        const result = await client.query<{ data: unknown }>(statement, [...values]);
        return result.rows[0]?.data;
      }
    );

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase(databaseUrl!);
    pool = database.pool;
    dispose = () => database.dispose();
    const first = await runMigrations(pool, directory);
    expect(first.applied.at(-1)).toBe('0064_admin_mcp_read_facade.sql');
    expect((await runMigrations(pool, directory)).applied).toEqual([]);
    const regions = await pool.query<{ id: string }>(
      `WITH g AS (
         INSERT INTO core.regions(code, region_type, name_zh_tw, name_en)
         VALUES ('mcp-global', 'global', '測試', 'Test') RETURNING id
       ), c AS (
         INSERT INTO core.regions(parent_region_id, code, region_type, name_zh_tw, name_en)
         SELECT id, 'mcp-country', 'country', '測試', 'Test' FROM g RETURNING id
       ) INSERT INTO core.regions(parent_region_id, code, region_type, name_zh_tw, name_en)
         SELECT c.id, 'mcp-region-' || n, 'operational', '測試', 'Test'
         FROM c CROSS JOIN generate_series(1, 2) n RETURNING id`
    );
    region = regions.rows[0]!.id;
    for (const kind of [
      'super',
      'master',
      'viewer',
      'none',
      'suspended',
      'disabled',
      'expired',
      'future',
      'revoked'
    ]) {
      const principal = await pool.query<{ id: string }>(
        `INSERT INTO admin.principals(oidc_issuer, oidc_subject, display_name, status)
         VALUES ('https://mcp.example.invalid', $1, 'Synthetic reviewer', $2) RETURNING id`,
        [kind, kind === 'suspended' || kind === 'disabled' ? kind : 'active']
      );
      const id = principal.rows[0]!.id;
      if (kind === 'super') superPrincipal = id;
      else deniedPrincipals.set(kind, id);
      if (kind !== 'none')
        await pool.query(
          `INSERT INTO admin.role_grants(principal_id, role_id, scope_type, reason, valid_from, valid_to)
           SELECT $1, id, 'global', 'synthetic test grant',
             CASE WHEN $3 = 'future' THEN clock_timestamp() + interval '1 day' ELSE clock_timestamp() - interval '2 days' END,
             CASE WHEN $3 IN ('expired', 'revoked') THEN clock_timestamp() - interval '1 day' ELSE NULL END
           FROM admin.roles WHERE code = $2`,
          [
            id,
            kind === 'master'
              ? 'master_admin'
              : kind === 'viewer'
                ? 'global_viewer'
                : 'super_admin',
            kind
          ]
        );
    }
    await pool.query(
      `INSERT INTO core.practice_guidance_campaigns(id, title, start_date, end_date, timezone, created_by)
       SELECT ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, 'Guidance ' || n,
         '2026-11-01'::date, '2026-12-31'::date, 'Asia/Taipei', $1
       FROM generate_series(1,60) n`,
      [superPrincipal]
    );
    // Low IDs outside each selector must be excluded BEFORE LIMIT, not filtered in JS.
    await pool.query(
      `INSERT INTO core.practice_guidance_campaigns(id, title, start_date, end_date, timezone, created_by)
       VALUES ('00000000-0000-4000-8000-000000000001', 'wrong zone', '2026-11-01', '2026-11-30', 'UTC', $1),
         ('00000000-0000-4000-8000-000000000002', 'ends before window', '2026-10-01', '2026-10-31', 'Asia/Taipei', $1),
         ('00000000-0000-4000-8000-000000000003', 'starts at until', '2026-12-01', '2026-12-31', 'Asia/Taipei', $1)`,
      [superPrincipal]
    );
    await pool.query(
      `INSERT INTO core.practice_guidance_entries(campaign_id, guide_date, title, content)
       SELECT $1, '2026-11-01'::date + n, NULL, 'Inert guidance ' || n FROM generate_series(0,59) n`,
      [campaignId(1)]
    );
    await pool.query(
      `INSERT INTO core.practice_fields(id, region_id, code, name_zh_tw, latitude, longitude, is_active)
       SELECT ('20000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, $1,
         'mcp-venue-' || n, '測試場地', 25, 121, n % 2 = 0 FROM generate_series(1,60) n`,
      [region]
    );
    await pool.query(
      `INSERT INTO core.practice_fields(id, region_id, code, name_zh_tw, latitude, longitude)
       VALUES ('00000000-0000-4000-8000-000000000001', $1, 'other-region', 'Other', 25, 121)`,
      [regions.rows[1]!.id]
    );
  }, 30_000);
  afterAll(async () => {
    await dispose?.();
  });

  it('returns only approved campaign/entry/venue fields in ordered bounded pages', async () => {
    const campaigns = await read(calls[0][0], [null, 51]);
    expect(campaigns).toBeInstanceOf(Array);
    const rows = campaigns as Record<string, unknown>[];
    expect(rows).toHaveLength(51);
    expect(rows[0]?.id).toBe(campaignId(1));
    expect(rows.at(-1)?.id).toBe(campaignId(51));
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(campaignKeys);
    expect(await read(calls[0][0], [campaignId(51), 51])).toHaveLength(9);
    const guidance = (await read(calls[1][0], [campaignId(1), '2026-11-01', 51])) as {
      campaign: Record<string, unknown>;
      entries: Record<string, unknown>[];
    };
    expect(Object.keys(guidance).sort()).toEqual(['campaign', 'entries']);
    expect(Object.keys(guidance.campaign).sort()).toEqual(campaignKeys);
    expect(guidance.entries).toHaveLength(51);
    expect(guidance.entries[0]?.guideDate).toBe('2026-11-02');
    for (const row of guidance.entries) expect(Object.keys(row).sort()).toEqual(entryKeys);
    const fields = (await read(calls[2][0], [region, venueId(1), 51])) as Record<string, unknown>[];
    expect(fields).toHaveLength(51);
    expect(fields[0]?.id).toBe(venueId(2));
    for (const row of fields) {
      expect(Object.keys(row).sort()).toEqual(venueKeys);
      expect(row.regionId).toBe(region);
    }
  });

  it.each([0, -1, 52, null])(
    'rejects invalid SQL fetch limit %s in every function',
    async (limit) => {
      for (const [statement, values] of calls) {
        const parameters: unknown[] = [...values];
        parameters[parameters.length - 1] = limit;
        await expect(read(statement, parameters)).rejects.toMatchObject({ code: '22023' });
      }
    }
  );

  it('denies missing/non-Super-Admin/inactive/expired/future principals before existence or selectors', async () => {
    for (const principal of [null, ...deniedPrincipals.values()])
      for (const [statement, values] of calls)
        await expect(read(statement, values, principal, false)).rejects.toMatchObject({
          code: '42501'
        });
  });

  it('denies worker execution even with a valid active global Super Admin', async () => {
    for (const [statement, values] of calls)
      await expect(
        read(statement, values, superPrincipal, true, 'qigong_worker_runtime')
      ).rejects.toMatchObject({ code: '42501' });
  });

  it('requires complete transaction-local guidance selectors and does not leak them between reads', async () => {
    await read(calls[0][0], [null, 2]);
    await expect(read(calls[0][0], [null, 2], superPrincipal, false)).rejects.toMatchObject({
      code: '22023'
    });
  });

  it('returns empty pages and reports authorized missing campaigns as P0002 only', async () => {
    expect(await read(calls[0][0], [campaignId(999), 2])).toEqual([]);
    expect(await read(calls[2][0], [randomUUID(), null, 2])).toEqual([]);
    expect(await read(calls[1][0], [campaignId(2), null, 2])).toMatchObject({ entries: [] });
    await expect(read(calls[1][0], [randomUUID(), null, 2])).rejects.toMatchObject({
      code: 'P0002'
    });
  });

  it('catalog ACLs deny PUBLIC/workers; all functions pin search_path and are security definers', async () => {
    const result = await pool.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[];
      api: boolean;
      worker: boolean;
      public_execute: boolean;
    }>(
      `SELECT p.proname, p.prosecdef, p.proconfig,
         has_function_privilege('qigong_api_runtime', p.oid, 'EXECUTE') AS api,
         has_function_privilege('qigong_worker_runtime', p.oid, 'EXECUTE') AS worker,
         EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='admin' AND p.proname LIKE 'mcp_read_%'`
    );
    expect(result.rows).toHaveLength(3);
    for (const row of result.rows)
      expect(row).toMatchObject({
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
        api: true,
        worker: false,
        public_execute: false
      });
  });

  it('runs all operations through the real adapter/service and rechecks grants on the next page', async () => {
    const ctx: AdminMcpReadContext = {
      requestId: randomUUID(),
      signal: new AbortController().signal,
      authorization: {
        principalId: superPrincipal,
        clientId: 'fixture-client',
        principalActive: true,
        isSuperAdmin: true,
        clientAuthorized: true,
        expiresAt: '2099-01-01T00:00:00Z',
        scopes: ['admin:guidance:read', 'admin:venues:read']
      }
    };
    const service = createAdminMcpReadService(createAdminMcpPgReadAdapter(pool, () => 'published'));
    const request = { tool: 'guidance_list', arguments: { ...range, limit: 50, cursor: null } };
    const first = await service.read(request, ctx);
    expect(first).toMatchObject({ ok: true, truncated: true });
    if (!first.ok) throw new Error('fixture');
    expect(
      await service.read(
        { ...request, arguments: { ...request.arguments, cursor: first.nextCursor } },
        ctx
      )
    ).toMatchObject({ ok: true, truncated: false });
    expect(
      await service.read(
        { tool: 'guidance_get', arguments: { campaignId: campaignId(1), limit: 50, cursor: null } },
        ctx
      )
    ).toMatchObject({ ok: true, truncated: true });
    expect(
      await service.read(
        { tool: 'venues_list', arguments: { regionId: region, limit: 50, cursor: null } },
        ctx
      )
    ).toMatchObject({ ok: true, truncated: true });
    await pool.query(
      'UPDATE admin.role_grants SET valid_to=clock_timestamp() WHERE principal_id=$1',
      [superPrincipal]
    );
    try {
      const denied = await service.read(
        { ...request, arguments: { ...request.arguments, cursor: first.nextCursor } },
        ctx
      );
      expect(denied).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    } finally {
      await pool.query('UPDATE admin.role_grants SET valid_to=NULL WHERE principal_id=$1', [
        superPrincipal
      ]);
    }
  });
});
