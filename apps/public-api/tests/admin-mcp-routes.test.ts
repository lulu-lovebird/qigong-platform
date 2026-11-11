/**
 * HTTP integration with real verifier/dispatcher/read adapters and a MOCKED PostgreSQL pool.
 * No real database, deployed TLS, OAuth issuance or multi-replica quota evidence.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 */
import { Buffer } from 'node:buffer';
import { createHmac, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMcpAuthVerifier,
  type AdminMcpCredentialState
} from '../src/admin-mcp-auth-verifier.js';
import {
  adminMcpLimits,
  adminMcpReadScopes,
  type AdminMcpResponse
} from '../src/admin-mcp-contract.js';
import type { AdminMcpReadContext } from '../src/admin-mcp-dispatch.js';
import {
  adminMcpRoutes,
  createAdminMcpMemoryBudget,
  type AdminMcpRoutesOptions
} from '../src/admin-mcp-routes.js';

const principalId = '10000000-0000-4000-8000-000000000001';
const regionId = '20000000-0000-4000-8000-000000000001';
const origin = 'https://admin.example.test';
const issuer = 'https://identity.example.test/admin-mcp';
const audience = 'https://api.example.test/mcp/admin';
const venue = { id: principalId, regionId, code: 'venue', name: '測試場地', isActive: true };
const call = { tool: 'venues_list', arguments: { regionId, cursor: null, limit: 1 } };
const apps: FastifyInstance[] = [];
const setup = async (overrides: Partial<AdminMcpRoutesOptions> = {}) => {
  const app = Fastify({ logger: false });
  apps.push(app);
  const key = randomBytes(32);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = {
    iss: issuer,
    aud: audience,
    sub: principalId,
    jti: 'token-1',
    client_id: 'admin-client',
    scope: adminMcpReadScopes.join(' '),
    exp: Math.floor(Date.now() / 1000) + 3600
  };
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  const token = `${unsigned}.${createHmac('sha256', key).update(unsigned).digest('base64url')}`;
  const state: AdminMcpCredentialState = {
    tokenId: claims.jti,
    principalId,
    clientId: claims.client_id,
    issuer,
    audience,
    principalActive: true,
    role: 'super_admin',
    clientAuthorized: true,
    revoked: false,
    scopes: adminMcpReadScopes,
    expiresAt: '2099-01-01T00:00:00Z'
  };
  const resolveCurrentAuthorization = vi.fn(async () => state as AdminMcpCredentialState | null);
  const verifier = createAdminMcpAuthVerifier({
    signingKey: key,
    issuer,
    audience,
    authorizedClientIds: [claims.client_id],
    resolveCurrentAuthorization
  });
  const query = vi
    .fn<
      (
        sql: string,
        values?: readonly unknown[]
      ) => Promise<{
        rows: { data: unknown }[];
        rowCount: number;
      }>
    >()
    .mockResolvedValue({ rows: [{ data: [venue] }], rowCount: 1 });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const pool = { connect } as unknown as Pool;
  await app.register(adminMcpRoutes, {
    pool,
    verifier,
    allowedOrigins: [origin],
    enabledTools: ['venues_list'],
    ...overrides
  });
  const headers = { authorization: `Bearer ${token}`, origin };
  const post = (payload: unknown = call) =>
    app.inject({
      method: 'POST',
      url: '/mcp/admin',
      headers,
      payload
    });
  return { app, token, state, headers, post, query, connect, release, resolveCurrentAuthorization };
};
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

describe('/mcp/admin HTTP authorization and dispatch', () => {
  it.each([
    undefined,
    '',
    'Basic secret',
    'Bearer',
    'Bearer ',
    'Bearer a b',
    'Bearer a,b',
    'Bearer\ta'
  ])(
    'rejects missing/malformed bearer authorization before verification or database access: %j',
    async (authorization) => {
      const { app, connect, resolveCurrentAuthorization } = await setup();
      const response = await app.inject({
        method: 'POST',
        url: '/mcp/admin',
        headers: authorization === undefined ? {} : { authorization },
        payload: call
      });
      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Bearer realm="admin-mcp"');
      expect(response.json<AdminMcpResponse>()).toMatchObject({
        schemaVersion: 1,
        ok: false,
        error: { code: 'unauthenticated' },
        requestId: expect.stringMatching(/^[a-f0-9-]{36}$/)
      });
      expect(connect).not.toHaveBeenCalled();
      expect(resolveCurrentAuthorization).not.toHaveBeenCalled();
    }
  );

  it('rejects an invalid signature and browser cookies without returning sensitive details', async () => {
    const { app, post, token, connect } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/mcp/admin',
      headers: { authorization: `Bearer ${token.slice(0, -5)}wrong`, cookie: 'admin=private' },
      payload: call
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<AdminMcpResponse>()).toMatchObject({
      ok: false,
      error: { code: 'unauthenticated' }
    });
    expect(response.body).not.toMatch(/private|stack|signature|token/);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/mcp/admin',
          headers: { cookie: 'admin=private' }
        })
      ).statusCode
    ).toBe(401);
    expect(connect).not.toHaveBeenCalled();
    expect((await post()).statusCode).toBe(200);
  });

  it.each([
    { revoked: true },
    { role: 'master_admin' },
    { principalActive: false },
    { clientAuthorized: false },
    { scopes: [] },
    { expiresAt: '2000-01-01T00:00:00Z' }
  ])('returns 401 for invalid current authorization: %j', async (change) => {
    const { state, post, resolveCurrentAuthorization, connect } = await setup();
    resolveCurrentAuthorization.mockResolvedValue({ ...state, ...change });
    const response = await post();
    expect(response.statusCode).toBe(401);
    expect(response.json<AdminMcpResponse>()).toMatchObject({ error: { code: 'unauthenticated' } });
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    'https://evil.example.test',
    'null',
    origin + '/',
    origin + '.evil.test',
    origin + ', ' + origin
  ])(
    'fails closed for unauthorized/malformed origins, regardless of spoofed Host/Forwarded: %s',
    async (untrusted) => {
      const { app, headers, connect, resolveCurrentAuthorization } = await setup();
      const response = await app.inject({
        method: 'POST',
        url: '/mcp/admin',
        payload: call,
        headers: {
          ...headers,
          origin: untrusted,
          host: 'admin.example.test',
          'x-forwarded-host': 'admin.example.test'
        }
      });
      expect(response.statusCode).toBe(403);
      expect(response.json<AdminMcpResponse>()).toMatchObject({
        error: { code: 'permission_denied' }
      });
      expect(resolveCurrentAuthorization).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
    }
  );

  it('rejects duplicate authorization/origin headers', async () => {
    const { app, headers, connect } = await setup();
    for (const duplicate of [
      { ...headers, authorization: [headers.authorization, headers.authorization] },
      { ...headers, origin: [origin, origin] }
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/mcp/admin',
        headers: duplicate,
        payload: call
      });
      expect([401, 403]).toContain(response.statusCode);
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it('allows native bearer clients without Origin and treats bearer scheme case-insensitively', async () => {
    const { app, token } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/mcp/admin',
      payload: call,
      headers: { authorization: `bearer ${token}` }
    });
    expect(response.statusCode).toBe(200);
  });

  it('runs signed HTTP calls through dispatcher, read service and restricted PG facade', async () => {
    const { post, query, release, resolveCurrentAuthorization, token } = await setup();
    const response = await post();
    expect(response.statusCode).toBe(200);
    const envelope = response.json<AdminMcpResponse>();
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      ok: true,
      requestId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      data: { items: [{ venueId: venue.id, regionId, name: venue.name, active: true }] },
      nextCursor: null,
      truncated: false,
      warnings: ['pagination_not_snapshot'],
      asOf: expect.any(String)
    });
    expect(query).toHaveBeenCalledWith('SET LOCAL ROLE qigong_api_runtime');
    expect(query).toHaveBeenCalledWith("SELECT set_config('qigong.principal_id', $1, TRUE)", [
      principalId
    ]);
    expect(query).toHaveBeenCalledWith(
      'SELECT admin.mcp_read_venues($1::uuid, $2::uuid, $3::integer) AS data',
      [regionId, null, 2]
    );
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
    expect(resolveCurrentAuthorization).toHaveBeenCalledOnce();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(JSON.stringify(query.mock.calls)).not.toContain(token);
    expect(response.body).not.toMatch(/code|isActive|tokenId|principalId|clientId/);
  });

  it('provides authenticated JSON capabilities on GET without executing a query-selected tool', async () => {
    const { app, headers, connect, post, state, resolveCurrentAuthorization } = await setup();
    const response = await app.inject({
      method: 'GET',
      url: '/mcp/admin?tool=venues_list',
      headers
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json<AdminMcpResponse>()).toMatchObject({
      schemaVersion: 1,
      ok: true,
      data: {
        phase: 'read_only',
        scopes: adminMcpReadScopes,
        tools: ['admin_get_capabilities', 'venues_list']
      }
    });
    expect(connect).not.toHaveBeenCalled();
    resolveCurrentAuthorization.mockResolvedValue({ ...state, revoked: true });
    expect((await post()).statusCode).toBe(401);
  });

  it.each(['operations_commit', '__proto__', 'learners_get', 'guidance_list'])(
    'returns tool_unavailable for unknown/unsupported/disabled tools: %s',
    async (tool) => {
      const { post, connect } = await setup();
      const response = await post({ tool, arguments: {} });
      expect(response.statusCode).toBe(404);
      expect(response.json<AdminMcpResponse>()).toMatchObject({
        error: { code: 'tool_unavailable' }
      });
      expect(connect).not.toHaveBeenCalled();
    }
  );

  it('enables no business tools without explicit switches', async () => {
    const { post, connect } = await setup({ enabledTools: [] });
    expect((await post()).statusCode).toBe(404);
    expect(connect).not.toHaveBeenCalled();
  });

  it('returns safe error envelopes for malformed selectors and identity injection', async () => {
    const { post, connect } = await setup();
    for (const payload of [
      null,
      [],
      {},
      { ...call, principalId },
      {
        ...call,
        arguments: { ...call.arguments, principalId }
      },
      { ...call, arguments: { ...call.arguments, regionId: 'bad' } }
    ]) {
      const response = await post(payload);
      expect(response.statusCode).toBe(400);
      expect(response.json<AdminMcpResponse>()).toMatchObject({
        schemaVersion: 1,
        ok: false,
        error: { code: 'invalid_request' }
      });
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it('sanitizes database failures without leaking SQL or token details', async () => {
    const { query, post } = await setup();
    query.mockRejectedValueOnce(new Error('SELECT private; token=private; Cookie=private'));
    const response = await post();
    expect(response.statusCode).toBe(503);
    expect(response.json<AdminMcpResponse>()).toMatchObject({
      error: { code: 'service_unavailable' }
    });
    expect(response.body).not.toMatch(/private|SELECT|Cookie|stack/);
  });
});

describe('/mcp/admin pre-parse limits and shared atomic budget', () => {
  it.each(['declared', 'streamed', 'multibyte'] as const)(
    'rejects >16 KB input before dispatch/JSON parsing (%s)',
    async (kind) => {
      const { app, headers, resolveCurrentAuthorization, connect } = await setup();
      const raw = '{"tool":"' + (kind === 'multibyte' ? '學'.repeat(6000) : 'x'.repeat(16384));
      const response = await app.inject({
        method: 'POST',
        url: '/mcp/admin',
        headers: { ...headers, 'content-type': 'application/json' },
        payload: kind === 'streamed' ? Readable.from([raw.slice(0, 8000), raw.slice(8000)]) : raw
      });
      expect(Buffer.byteLength(raw)).toBeGreaterThan(adminMcpLimits.maximumInputBytes);
      expect(response.statusCode).toBe(413);
      expect(response.json<AdminMcpResponse>()).toMatchObject({
        schemaVersion: 1,
        ok: false,
        error: { code: 'invalid_request' }
      });
      expect(resolveCurrentAuthorization).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
      expect(response.body).not.toContain(raw);
    }
  );

  it('accepts an exactly 16 KB JSON body and returns safe parser/media errors', async () => {
    const { app, headers } = await setup();
    const json = JSON.stringify({ tool: 'admin_get_capabilities', arguments: {} });
    const raw = json + ' '.repeat(adminMcpLimits.maximumInputBytes - Buffer.byteLength(json));
    const inject = (payload: string, contentType = 'application/json') =>
      app.inject({
        method: 'POST',
        url: '/mcp/admin',
        payload,
        headers: { ...headers, 'content-type': contentType }
      });
    expect((await inject(raw)).statusCode).toBe(200);
    for (const payload of ['{invalid-secret', '']) {
      const response = await inject(payload);
      expect(response.statusCode).toBe(400);
      expect(response.json<AdminMcpResponse>()).toMatchObject({
        error: { code: 'invalid_request' }
      });
      expect(response.body).not.toMatch(/secret|SyntaxError|stack/);
    }
    expect((await inject('raw', 'application/octet-stream')).statusCode).toBe(415);
  });

  it('does not alter unrelated routes or their body limits/error handling', async () => {
    const { app } = await setup();
    app.post('/unrelated', { bodyLimit: 32_768 }, () => ({ ok: true }));
    const response = await app.inject({
      method: 'POST',
      url: '/unrelated',
      payload: { data: 'x'.repeat(20_000) }
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBeUndefined();
  });

  it('allows exactly the configured number of concurrent calls, then returns 429', async () => {
    const { post, connect } = await setup({ budget: { maximumCalls: 2 } });
    const responses = await Promise.all(Array.from({ length: 8 }, () => post()));
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 200, 429, 429, 429, 429, 429, 429
    ]);
    expect(connect).toHaveBeenCalledTimes(2);
    const denied = responses.find((response) => response.statusCode === 429);
    expect(denied?.json<AdminMcpResponse>()).toMatchObject({ error: { code: 'rate_limited' } });
    expect(denied?.headers['retry-after']).toBe('1');
  });

  it('shares one quota across GET/POST, and counts malformed/disabled authenticated calls', async () => {
    for (const payload of [{}, { tool: 'operations_commit', arguments: {} }]) {
      const { app, post, headers, connect } = await setup({ budget: { maximumCalls: 1 } });
      expect([400, 404]).toContain((await post(payload)).statusCode);
      const response = await app.inject({ method: 'GET', url: '/mcp/admin', headers });
      expect(response.statusCode).toBe(429);
      expect(connect).not.toHaveBeenCalled();
    }
  });

  it('does not consume the verified budget on invalid authentication', async () => {
    const { state, post, resolveCurrentAuthorization } = await setup({
      budget: { maximumCalls: 1 }
    });
    resolveCurrentAuthorization.mockResolvedValueOnce(null);
    expect((await post()).statusCode).toBe(401);
    resolveCurrentAuthorization.mockResolvedValue(state);
    expect((await post()).statusCode).toBe(200);
    expect((await post()).statusCode).toBe(429);
  });

  it.each([
    'null',
    origin + '/',
    'http://admin.example.test',
    'https://user:pass@admin.example.test',
    origin + '/path'
  ])('refuses invalid trusted origin configuration: %s', async (invalid) => {
    await expect(setup({ allowedOrigins: [invalid] })).rejects.toThrow();
  });
});

const budgetContext = (clientId = 'client-1', id = principalId): AdminMcpReadContext => ({
  authorization: {
    principalId: id,
    clientId,
    principalActive: true,
    isSuperAdmin: true,
    clientAuthorized: true,
    scopes: adminMcpReadScopes,
    expiresAt: '2099-01-01T00:00:00Z'
  },
  requestId: regionId,
  signal: new AbortController().signal
});
describe('bounded atomic in-memory sliding window', () => {
  it('isolates principal/client pairs and expires calls at the exact sliding boundary', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const consume = createAdminMcpMemoryBudget({ maximumCalls: 2, windowMs: 1000 });
    expect(await consume(budgetContext())).toBe(true);
    clock.mockReturnValue(500);
    expect(await consume(budgetContext())).toBe(true);
    expect(await consume(budgetContext())).toBe(false);
    expect(await consume(budgetContext('client-2'))).toBe(true);
    expect(await consume(budgetContext('client-1', regionId))).toBe(true);
    clock.mockReturnValue(1000);
    expect(await consume(budgetContext())).toBe(true);
    expect(await consume(budgetContext())).toBe(false);
    clock.mockReturnValue(1500);
    expect(await consume(budgetContext())).toBe(true);
  });

  it('fails closed at key capacity, reclaims expired keys and ignores aborted calls', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const consume = createAdminMcpMemoryBudget({ maximumCalls: 1, maximumKeys: 1, windowMs: 1000 });
    const context = budgetContext();
    expect(await consume({ ...context, signal: AbortSignal.abort() })).toBe(false);
    expect(await consume(context)).toBe(true);
    expect(await consume(budgetContext('client-2'))).toBe(false);
    clock.mockReturnValue(1000);
    expect(await consume(budgetContext('client-2'))).toBe(true);
    expect(await consume(context)).toBe(false);
  });

  it.each([
    { maximumCalls: 0 },
    { maximumCalls: 1.5 },
    { maximumCalls: 10_001 },
    { windowMs: -1 },
    { windowMs: Infinity },
    { maximumKeys: 0 },
    { maximumKeys: 100_001 }
  ])('rejects invalid limiter configuration: %j', (options) => {
    expect(() => createAdminMcpMemoryBudget(options)).toThrow();
  });
});
