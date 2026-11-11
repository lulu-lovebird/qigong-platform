/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { Buffer } from 'node:buffer';
import { generateKeyPairSync, sign as rsaSign, type JsonWebKey } from 'node:crypto';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminMcpReadScopes, type AdminMcpReadScope } from '../src/admin-mcp-contract.js';
import type { AdminMcpAuthVerifier } from '../src/admin-mcp-dispatch.js';
import {
  createAdminMcpOidcVerifier,
  type AdminMcpOidcVerifierOptions
} from '../src/admin-mcp-oidc-verifier.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rotatedKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk: JsonWebKey = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'authgear-key-1',
  alg: 'RS256',
  use: 'sig',
  key_ops: ['verify']
};
const now = Date.parse('2026-11-11T08:00:00Z');
const issuer = 'https://synthetic.authgear.cloud';
const clientId = 'admin-mcp-client';
const principalId = 'a1000000-0000-4000-8000-00000000000a';
const subject = 'authgear-user:opaque-subject';
const requestId = '20000000-0000-4000-8000-000000000002';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const authorize = (
  verifier: AdminMcpAuthVerifier,
  credential: string,
  signal = new AbortController().signal
) => verifier.verifyCurrentAuthorization({ credential, requestId, signal });

const setup = (overrides: Partial<AdminMcpOidcVerifierOptions> = {}) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  const claims = {
    iss: issuer,
    aud: clientId,
    sub: subject,
    scope: adminMcpReadScopes.join(' '),
    exp: now / 1000 + 60
  };
  // Model the authoritative filtered query. A separate assertion checks every SQL predicate.
  const grant = {
    id: principalId.toUpperCase(),
    status: 'active',
    role_code: 'super_admin',
    scope_type: 'global',
    oidc_issuer: issuer,
    oidc_subject: subject,
    valid_from: now - 1000,
    valid_to: null as number | null
  };
  const query = vi
    .fn<(sql: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }>>()
    .mockImplementation(async () => ({
      rows:
        grant.status === 'active' &&
        grant.role_code === 'super_admin' &&
        grant.scope_type === 'global' &&
        grant.oidc_issuer === issuer &&
        grant.oidc_subject === subject &&
        grant.valid_from <= Date.now() &&
        (grant.valid_to === null || grant.valid_to > Date.now())
          ? [{ id: grant.id, status: grant.status, role_code: grant.role_code }]
          : []
    }));
  const pool = { query } as unknown as Pool;
  const fetchJwks = vi
    .fn<(url: string) => Promise<{ keys: JsonWebKey[] }>>()
    .mockResolvedValue({ keys: [jwk] });
  const options: AdminMcpOidcVerifierOptions = { pool, issuer, clientId, fetchJwks, ...overrides };
  const verifier = createAdminMcpOidcVerifier(options);
  const sign = (
    payload: unknown = claims,
    header: unknown = { alg: 'RS256', kid: jwk.kid, typ: 'JWT' },
    key = privateKey
  ) => {
    const unsigned = `${encode(header)}.${encode(payload)}`;
    return `${unsigned}.${rsaSign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
  };
  const verify = (credential = sign(), signal = new AbortController().signal) =>
    authorize(verifier, credential, signal);
  return { claims, grant, query, pool, fetchJwks, options, verifier, sign, verify };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Admin MCP Authgear OIDC verifier', () => {
  it('verifies native RS256 and returns the current database Super Admin, not the OIDC subject', async () => {
    const { verify, query, fetchJwks } = setup();
    const result = await verify();
    expect(result).toEqual({
      principalId,
      clientId,
      principalActive: true,
      isSuperAdmin: true,
      clientAuthorized: true,
      scopes: adminMcpReadScopes,
      expiresAt: new Date(now + 60_000).toISOString()
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result?.scopes)).toBe(true);
    expect(fetchJwks).toHaveBeenCalledExactlyOnceWith(`${issuer}/oauth2/jwks`);
    expect(query).toHaveBeenCalledExactlyOnceWith(
      `SELECT p.id, p.status, r.code AS role_code
FROM admin.principals p
JOIN admin.role_grants g ON g.principal_id = p.id
JOIN admin.roles r ON r.id = g.role_id
WHERE p.oidc_issuer = $1
  AND p.oidc_subject = $2
  AND p.status = 'active'
  AND r.code = 'super_admin'
  AND g.scope_type = 'global'
  AND g.valid_from <= clock_timestamp()
  AND (g.valid_to IS NULL OR g.valid_to > clock_timestamp())
LIMIT 1`,
      [issuer, subject]
    );
  });

  it.each([
    { exp: now / 1000 },
    { exp: now / 1000 - 1 },
    { exp: undefined },
    { exp: '2099-01-01' },
    { exp: 1e20 },
    { exp: now / 1000 + 0.5 },
    { iss: 'https://untrusted.example.test' },
    { aud: 'browser-client' },
    { aud: ['browser-client'] },
    { aud: undefined },
    { client_id: 'unapproved-client' },
    { sub: undefined },
    { sub: '' },
    { sub: ' ' },
    { nbf: now / 1000 + 1 },
    { iat: now / 1000 + 1 },
    { scope: undefined },
    { scope: '' },
    { scope: ['admin:venues:read'] },
    { scope: 'admin:venues:read' }
  ])('rejects invalid signed claims before JWKS or database access: %j', async (change) => {
    const { claims, verify, sign, query, fetchJwks } = setup();
    expect(await verify(sign({ ...claims, ...change }))).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(fetchJwks).not.toHaveBeenCalled();
  });

  it('supports audience arrays and the explicit client_id alternative', async () => {
    const { claims, verify, sign } = setup();
    for (const change of [
      { aud: ['other-resource', clientId] },
      { aud: undefined, client_id: clientId },
      { aud: 'authgear-resource', client_id: clientId }
    ]) {
      expect(await verify(sign({ ...claims, ...change }))).toMatchObject({ clientId });
    }
  });

  it('allows only explicitly configured additional clients', async () => {
    const { claims, verify, sign } = setup({ allowedClientIds: ['additional-admin-client'] });
    expect(await verify(sign({ ...claims, aud: 'additional-admin-client' }))).toMatchObject({
      clientId: 'additional-admin-client'
    });
    expect(
      await verify(sign({ ...claims, aud: undefined, client_id: 'additional-admin-client' }))
    ).toMatchObject({ clientId: 'additional-admin-client' });
    expect(await verify(sign({ ...claims, client_id: 'browser-client' }))).toBeNull();
  });

  it('returns only signed canonical scopes, enforcing a configured required subset', async () => {
    const { claims, verify, sign } = setup({ requiredScopes: ['admin:venues:read'] });
    expect(
      await verify(sign({ ...claims, scope: 'openid profile admin:venues:read arbitrary:read' }))
    ).toMatchObject({ scopes: ['admin:venues:read'] });
    expect(await verify(sign({ ...claims, scope: 'openid admin:learners:read' }))).toBeNull();
  });

  it.each([
    { role_code: 'master_admin' },
    { role_code: 'regional_admin' },
    { status: 'suspended' },
    { status: 'disabled' },
    { scope_type: 'region' },
    { valid_from: now + 1 },
    { valid_to: now },
    { valid_to: now - 1 },
    { oidc_issuer: 'https://other.authgear.cloud' },
    { oidc_subject: 'other-user' }
  ])(
    'denies principals or grants excluded by the authoritative database query: %j',
    async (change) => {
      const { grant, claims, verify, sign, query } = setup();
      Object.assign(grant, change);
      // Signed role/activity assertions must not substitute for current database authority.
      expect(
        await verify(sign({ ...claims, role: 'super_admin', principalActive: true }))
      ).toBeNull();
      expect(query).toHaveBeenCalledOnce();
    }
  );

  it('queries current authority on every verification even when JWKS is cached', async () => {
    const { grant, verify, query, fetchJwks } = setup();
    expect(await verify()).not.toBeNull();
    grant.valid_to = now;
    expect(await verify()).toBeNull();
    expect(query).toHaveBeenCalledTimes(2);
    expect(fetchJwks).toHaveBeenCalledOnce();
  });

  it.each([
    [],
    [{ id: principalId, status: 'active', role_code: 'master_admin' }],
    [{ id: principalId, status: 'active', role_code: 'regional_admin' }],
    [{ id: principalId, status: 'disabled', role_code: 'super_admin' }],
    [{ id: principalId, status: 'suspended', role_code: 'super_admin' }],
    [{ id: subject, status: 'active', role_code: 'super_admin' }],
    [null],
    [{}, {}]
  ])('fails closed for missing or malformed database rows: %j', async (...rows) => {
    const { verify, query } = setup();
    query.mockResolvedValueOnce({ rows });
    expect(await verify()).toBeNull();
  });

  it.each([
    { alg: 'none', kid: jwk.kid },
    { alg: 'HS256', kid: jwk.kid },
    { alg: 'PS256', kid: jwk.kid },
    { alg: 'RS256' },
    { alg: 'RS256', kid: '' },
    { alg: 'RS256', kid: 1 },
    { alg: 'RS256', kid: jwk.kid, crit: ['custom'] },
    { alg: 'RS256', kid: jwk.kid, b64: false }
  ])('rejects unsupported JWT headers: %j', async (header) => {
    const { verify, sign, claims, query, fetchJwks } = setup();
    expect(await verify(sign(claims, header))).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(fetchJwks).not.toHaveBeenCalled();
  });

  it('rejects tampered signatures, payloads, malformed tokens, and noncanonical encoding', async () => {
    const { claims, sign, verify, query } = setup();
    const token = sign();
    const [header, payload, signature] = token.split('.');
    for (const credential of [
      '',
      'browser-session-cookie',
      'x'.repeat(8193),
      token + '.extra',
      `${header}.${payload}.`,
      `${header}.${payload}.x`,
      `${header}.${payload}.${signature}=`,
      `${header}.${payload}.${Buffer.alloc(256).toString('base64url')}`,
      `${header}.${encode({ ...claims, sub: 'tampered-user' })}.${signature}`,
      `${encode({ alg: 'RS256', kid: jwk.kid, typ: 'changed' })}.${payload}.${signature}`,
      `${header}.${Buffer.from('not-json').toString('base64url')}.${signature}`,
      sign(claims, undefined, rotatedKeys.privateKey)
    ]) {
      expect(await verify(credential)).toBeNull();
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects unknown or duplicate kids and never follows token-supplied key URLs', async () => {
    const { verify, sign, claims, query, fetchJwks } = setup();
    expect(
      await verify(sign(claims, { alg: 'RS256', kid: 'unknown', jku: 'https://attacker.test' }))
    ).toBeNull();
    expect(fetchJwks).toHaveBeenCalledExactlyOnceWith(`${issuer}/oauth2/jwks`);
    expect(query).not.toHaveBeenCalled();
    const duplicate = setup({ fetchJwks: async () => ({ keys: [jwk, jwk] }) });
    expect(await duplicate.verify()).toBeNull();
    expect(duplicate.query).not.toHaveBeenCalled();
  });

  it.each([
    { kty: 'EC' },
    { alg: 'HS256' },
    { use: 'enc' },
    { key_ops: ['encrypt'] },
    { n: 'invalid!' },
    { e: '' },
    { d: 'private-key-material' }
  ])('rejects unsuitable JWKs: %j', async (change) => {
    const { verify, query } = setup({ fetchJwks: async () => ({ keys: [{ ...jwk, ...change }] }) });
    expect(await verify()).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects RSA keys smaller than 2048 bits', async () => {
    const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const { verify, sign, claims, query } = setup({
      fetchJwks: async () => ({
        keys: [{ ...weak.publicKey.export({ format: 'jwk' }), kid: jwk.kid }]
      })
    });
    expect(await verify(sign(claims, undefined, weak.privateKey))).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('coalesces JWKS requests, bounds unknown-kid fetches, and refreshes rotated keys after TTL', async () => {
    const { verify, sign, claims, fetchJwks, query } = setup();
    const payload = { ...claims, exp: now / 1000 + 600 };
    const token = sign(payload);
    expect((await Promise.all([verify(token), verify(token)])).every(Boolean)).toBe(true);
    expect(fetchJwks).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledTimes(2);
    const rotated = sign(payload, { alg: 'RS256', kid: 'rotated-key' }, rotatedKeys.privateKey);
    fetchJwks.mockResolvedValue({
      keys: [{ ...rotatedKeys.publicKey.export({ format: 'jwk' }), kid: 'rotated-key' }]
    });
    vi.setSystemTime(now + 299_999);
    expect(await verify(rotated)).toBeNull();
    expect(fetchJwks).toHaveBeenCalledOnce();
    vi.setSystemTime(now + 300_000);
    expect(await verify(rotated)).not.toBeNull();
    expect(await verify(token)).toBeNull();
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it('fails closed on JWKS errors, retries failed loads, and never uses stale keys', async () => {
    const { verify, sign, claims, fetchJwks, query } = setup();
    fetchJwks.mockRejectedValueOnce(new Error('private network details'));
    const token = sign({ ...claims, exp: now / 1000 + 600 });
    expect(await verify(token)).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(await verify(token)).not.toBeNull();
    vi.setSystemTime(now + 300_000);
    fetchJwks.mockRejectedValueOnce(new Error('offline'));
    expect(await verify(token)).toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });

  it('uses global fetch with a deadline, a configured URL, and cached validated JWKS', async () => {
    const { pool, sign } = setup();
    const fetch = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] })));
    vi.stubGlobal('fetch', fetch);
    const verifier = createAdminMcpOidcVerifier({
      pool,
      issuer: `${issuer}/tenant`,
      clientId,
      jwksUri: 'https://keys.example.test/jwks'
    });
    const token = sign({
      iss: `${issuer}/tenant`,
      aud: clientId,
      sub: subject,
      scope: adminMcpReadScopes.join(' '),
      exp: now / 1000 + 60
    });
    expect(await authorize(verifier, token)).not.toBeNull();
    expect(await authorize(verifier, token)).not.toBeNull();
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://keys.example.test/jwks', {
      signal: expect.any(AbortSignal),
      redirect: 'error',
      headers: { accept: 'application/json' }
    });
  });

  it.each([
    () => new Response('unavailable', { status: 503 }),
    () => new Response('not-json'),
    () => new Response(JSON.stringify({ keys: [] })),
    () => new Response(JSON.stringify({ keys: null })),
    () => new Response(JSON.stringify({ keys: Array.from({ length: 101 }, () => jwk) })),
    () => new Response('x'.repeat(131_073))
  ])('fails closed on invalid default JWKS responses', async (response) => {
    const { pool, sign, query } = setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response())
    );
    const verifier = createAdminMcpOidcVerifier({ pool, issuer, clientId });
    expect(await authorize(verifier, sign())).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed on database failures and expiration during asynchronous work', async () => {
    const { verify, query, fetchJwks } = setup();
    query.mockRejectedValueOnce(new Error('private database details'));
    expect(await verify()).toBeNull();
    query.mockImplementationOnce(async () => {
      vi.setSystemTime(now + 60_000);
      return { rows: [{ id: principalId, status: 'active', role_code: 'super_admin' }] };
    });
    expect(await verify()).toBeNull();
    const second = setup();
    second.fetchJwks.mockImplementationOnce(async () => {
      vi.setSystemTime(now + 60_000);
      return { keys: [jwk] };
    });
    expect(await second.verify()).toBeNull();
    expect(second.query).not.toHaveBeenCalled();
    expect(fetchJwks).toHaveBeenCalledOnce();
  });

  it('honors pre-abort without touching JWKS or the database', async () => {
    const { verify, query, fetchJwks } = setup();
    expect(await verify(undefined, AbortSignal.abort())).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(fetchJwks).not.toHaveBeenCalled();
  });

  it('returns promptly on an in-flight JWKS abort and handles a late rejection safely', async () => {
    const { verify, fetchJwks, query } = setup();
    const controller = new AbortController();
    let fail: (error: Error) => void = () => undefined;
    fetchJwks.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
          controller.abort();
        })
    );
    expect(await verify(undefined, controller.signal)).toBeNull();
    expect(query).not.toHaveBeenCalled();
    fail(new Error('late private network failure'));
    await Promise.resolve();
  });

  it('returns promptly on an in-flight database abort and handles a late rejection safely', async () => {
    const { verify, query } = setup();
    const controller = new AbortController();
    let fail: (error: Error) => void = () => undefined;
    query.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
          controller.abort();
        })
    );
    expect(await verify(undefined, controller.signal)).toBeNull();
    fail(new Error('late private database failure'));
    await Promise.resolve();
  });

  it('snapshots trusted client/scope configuration and rejects unsafe configuration', async () => {
    const allowedClientIds = ['additional-admin-client'];
    const requiredScopes: AdminMcpReadScope[] = ['admin:venues:read'];
    const { options, verify, sign, claims } = setup({ allowedClientIds, requiredScopes });
    allowedClientIds[0] = 'untrusted-client';
    requiredScopes[0] = 'admin:audit:read';
    expect(
      await verify(sign({ ...claims, aud: 'additional-admin-client', scope: 'admin:venues:read' }))
    ).not.toBeNull();
    expect(await verify(sign({ ...claims, aud: 'untrusted-client' }))).toBeNull();
    expect(() =>
      createAdminMcpOidcVerifier({ ...options, issuer: 'http://insecure.test' })
    ).toThrow();
    expect(() => createAdminMcpOidcVerifier({ ...options, clientId: '' })).toThrow();
    expect(() => createAdminMcpOidcVerifier({ ...options, allowedClientIds: [''] })).toThrow();
    expect(() => createAdminMcpOidcVerifier({ ...options, requiredScopes: [] })).toThrow();
    expect(() => createAdminMcpOidcVerifier({ ...options, jwksUri: 'file:///tmp/keys' })).toThrow();
    expect(() =>
      createAdminMcpOidcVerifier({ ...options, jwksUri: 'https://user:pass@example.test/jwks' })
    ).toThrow();
  });
});
