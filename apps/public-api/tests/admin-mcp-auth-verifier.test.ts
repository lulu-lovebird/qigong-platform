/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { Buffer } from 'node:buffer';
import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMcpAuthVerifier,
  type AdminMcpCredentialState
} from '../src/admin-mcp-auth-verifier.js';
import { adminMcpReadScopes } from '../src/admin-mcp-contract.js';

const principalId = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000001';
const now = Date.parse('2026-11-11T00:00:00Z');
const issuer = 'https://identity.example.test/admin-mcp';
const audience = 'https://api.example.test/mcp/admin';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const setup = () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const key = randomBytes(32);
  const claims = {
    iss: issuer,
    aud: audience,
    sub: principalId,
    jti: 'token-1',
    client_id: 'admin-client',
    scope: adminMcpReadScopes.join(' '),
    exp: now / 1000 + 60
  };
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
    expiresAt: new Date(now + 120_000).toISOString()
  };
  const resolveCurrentAuthorization = vi.fn(async () => state as AdminMcpCredentialState | null);
  const options = {
    signingKey: key,
    issuer,
    audience,
    authorizedClientIds: [claims.client_id],
    resolveCurrentAuthorization
  };
  const verifier = createAdminMcpAuthVerifier(options);
  const sign = (payload: unknown = claims, header: unknown = { alg: 'HS256', typ: 'JWT' }) => {
    const unsigned = `${encode(header)}.${encode(payload)}`;
    return `${unsigned}.${createHmac('sha256', key).update(unsigned).digest('base64url')}`;
  };
  const verify = (credential = sign(), signal = new AbortController().signal) =>
    verifier.verifyCurrentAuthorization({ credential, requestId, signal });
  return { key, claims, state, options, verifier, resolveCurrentAuthorization, sign, verify };
};
afterEach(() => vi.useRealTimers());

describe('admin MCP current bearer authorization', () => {
  it('verifies a signed credential and authoritative active Super Admin on every call', async () => {
    const { verify, state, resolveCurrentAuthorization } = setup();
    const result = await verify();
    expect(result).toEqual({
      principalId,
      clientId: 'admin-client',
      principalActive: true,
      isSuperAdmin: true,
      clientAuthorized: true,
      scopes: adminMcpReadScopes,
      expiresAt: new Date(now + 60_000).toISOString()
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(resolveCurrentAuthorization).toHaveBeenCalledWith({
      tokenId: state.tokenId,
      principalId,
      clientId: state.clientId,
      requestId,
      signal: expect.any(AbortSignal)
    });
    resolveCurrentAuthorization.mockResolvedValue({ ...state, revoked: true });
    expect(await verify()).toBeNull();
    expect(resolveCurrentAuthorization).toHaveBeenCalledTimes(2);
  });

  it.each([
    { exp: now / 1000 },
    { exp: now / 1000 - 1 },
    { exp: '2099-01-01' },
    { iss: 'https://untrusted.example.test' },
    { aud: 'browser-admin' },
    { aud: [audience] },
    { client_id: 'unapproved-client' },
    { nbf: now / 1000 + 1 },
    { iat: now / 1000 + 1 },
    { scope: '' },
    { scope: 'admin:venues:read' },
    { scope: ['admin:venues:read'] },
    { sub: 'not-a-uuid' },
    { role: 'super_admin' }
  ])('rejects invalid signed claims before storage lookup: %j', async (change) => {
    const { claims, sign, verify, resolveCurrentAuthorization } = setup();
    expect(await verify(sign({ ...claims, ...change }))).toBeNull();
    expect(resolveCurrentAuthorization).not.toHaveBeenCalled();
  });

  it.each([
    { role: 'master_admin' },
    { role: 'region_admin' },
    { role: 'SUPER_ADMIN' },
    { principalActive: false },
    { clientAuthorized: false },
    { revoked: true },
    { scopes: [] },
    { scopes: ['admin:venues:read'] },
    { tokenId: 'other-token' },
    { clientId: 'other-client' },
    { principalId: requestId },
    { issuer: 'other-issuer' },
    { audience: 'other-audience' },
    { expiresAt: new Date(now).toISOString() },
    { expiresAt: 'invalid' }
  ])('rejects invalid current authority: %j', async (change) => {
    const { state, verify, resolveCurrentAuthorization } = setup();
    resolveCurrentAuthorization.mockResolvedValue({ ...state, ...change });
    expect(await verify()).toBeNull();
  });

  it('honors the shorter storage expiry and intersects grants without elevating token scopes', async () => {
    const { claims, state, options, sign, resolveCurrentAuthorization } = setup();
    resolveCurrentAuthorization.mockResolvedValue({
      ...state,
      expiresAt: new Date(now + 20_000).toISOString()
    });
    const verifier = createAdminMcpAuthVerifier({
      ...options,
      requiredScopes: ['admin:venues:read']
    });
    const result = await verifier.verifyCurrentAuthorization({
      credential: sign({ ...claims, scope: 'admin:venues:read unrelated:read' }),
      requestId,
      signal: new AbortController().signal
    });
    expect(result).toMatchObject({
      scopes: ['admin:venues:read'],
      expiresAt: new Date(now + 20_000).toISOString()
    });
  });

  it('rejects payload/header/signature tampering, unsigned tokens and noncanonical encoding', async () => {
    const { claims, sign, verify, resolveCurrentAuthorization } = setup();
    const token = sign();
    const [header, payload, signature] = token.split('.');
    for (const credential of [
      '',
      'opaque-browser-cookie',
      token + '.extra',
      'x'.repeat(8193),
      `${header}.${encode({ ...claims, sub: requestId })}.${signature}`,
      `${encode({ alg: 'none', typ: 'JWT' })}.${payload}.${signature}`,
      `${header}.${payload}.${Buffer.alloc(32).toString('base64url')}`,
      `${header}.${payload}.${signature}=`,
      `${header}.${payload}.x`,
      sign(claims, { alg: 'none', typ: 'JWT' }),
      sign(claims, { alg: 'HS384', typ: 'JWT' }),
      sign(claims, { alg: 'HS256', typ: 'JWT', jku: issuer })
    ])
      expect(await verify(credential)).toBeNull();
    expect(resolveCurrentAuthorization).not.toHaveBeenCalled();
  });

  it('fails closed on unknown tokens, storage errors, cancellation and expiry during lookup', async () => {
    const { state, verify, resolveCurrentAuthorization } = setup();
    resolveCurrentAuthorization
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('private'));
    expect(await verify()).toBeNull();
    expect(await verify()).toBeNull();
    expect(await verify(undefined, AbortSignal.abort())).toBeNull();
    const controller = new AbortController();
    resolveCurrentAuthorization.mockImplementationOnce(async () => {
      controller.abort();
      return state;
    });
    expect(await verify(undefined, controller.signal)).toBeNull();
    resolveCurrentAuthorization.mockImplementationOnce(async () => {
      vi.setSystemTime(now + 60_000);
      return state;
    });
    expect(await verify()).toBeNull();
  });

  it('snapshots trusted configuration and refuses weak keys or invalid scope/client configuration', async () => {
    const { options, sign, key, claims } = setup();
    const token = sign();
    const verifier = createAdminMcpAuthVerifier(options);
    key.fill(0);
    options.authorizedClientIds[0] = 'other-client';
    expect(
      await verifier.verifyCurrentAuthorization({
        credential: token,
        requestId,
        signal: new AbortController().signal
      })
    ).not.toBeNull();
    expect(
      await verifier.verifyCurrentAuthorization({
        credential: sign(claims),
        requestId,
        signal: new AbortController().signal
      })
    ).toBeNull();
    expect(() => createAdminMcpAuthVerifier({ ...options, signingKey: randomBytes(16) })).toThrow();
    expect(() => createAdminMcpAuthVerifier({ ...options, requiredScopes: [] })).toThrow();
    expect(() => createAdminMcpAuthVerifier({ ...options, authorizedClientIds: [] })).toThrow();
  });
});
