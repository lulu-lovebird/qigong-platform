import * as oidc from 'openid-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdminOidcProvider } from '../src/oidc-provider.js';

vi.mock('openid-client', async (importOriginal) => {
  const actual = await importOriginal<typeof oidc>();
  return { ...actual, discovery: vi.fn(), authorizationCodeGrant: vi.fn(), fetchUserInfo: vi.fn() };
});
const issuer = 'https://admins.example.invalid';
const clientId = 'admin-client';
const claims: oidc.IDToken = {
  iss: issuer,
  sub: 'subject-one',
  aud: clientId,
  iat: 1,
  exp: 4102444800
};
const configuration = (userinfo = true) =>
  new oidc.Configuration(
    {
      issuer,
      authorization_endpoint: issuer + '/authorize',
      token_endpoint: issuer + '/token',
      ...(userinfo ? { userinfo_endpoint: issuer + '/userinfo' } : {})
    },
    clientId,
    undefined,
    oidc.None()
  );
const grant = (
  value: oidc.IDToken = claims
): Awaited<ReturnType<typeof oidc.authorizationCodeGrant>> => {
  const response: oidc.TokenEndpointResponse = {
    access_token: 'synthetic-access-token',
    token_type: 'bearer',
    id_token: 'synthetic-id-token',
    expires_in: 3600
  };
  return Object.assign(response, { claims: () => value, expiresIn: () => 3600 });
};
const complete = async () =>
  (await createAdminOidcProvider()).complete(
    new URL('https://checkin.example.invalid/admin/auth/callback?code=synthetic'),
    'verifier',
    'state',
    'nonce'
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ADMIN_OIDC_ISSUER_URL', issuer);
  vi.stubEnv('ADMIN_OIDC_CLIENT_ID', clientId);
  vi.stubEnv('ADMIN_OIDC_REDIRECT_URI', 'https://checkin.example.invalid/admin/auth/callback');
  vi.stubEnv('ADMIN_OIDC_SCOPES', 'openid profile email');
  vi.mocked(oidc.discovery).mockResolvedValue(configuration());
  vi.mocked(oidc.authorizationCodeGrant).mockResolvedValue(grant());
  vi.mocked(oidc.fetchUserInfo).mockResolvedValue({
    sub: 'subject-one',
    email: 'verified@example.invalid',
    email_verified: true,
    name: 'Verified administrator'
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('Verified Authgear UserInfo profile', () => {
  it('uses UserInfo email missing from the ID token and checks the authenticated subject', async () => {
    expect(await complete()).toEqual({
      iss: issuer,
      sub: 'subject-one',
      name: 'Verified administrator',
      verifiedEmail: 'verified@example.invalid'
    });
    expect(oidc.fetchUserInfo).toHaveBeenCalledWith(
      expect.any(oidc.Configuration),
      'synthetic-access-token',
      'subject-one'
    );
    expect(oidc.authorizationCodeGrant).toHaveBeenCalledWith(
      expect.any(oidc.Configuration),
      expect.any(URL),
      {
        pkceCodeVerifier: 'verifier',
        expectedState: 'state',
        expectedNonce: 'nonce',
        idTokenExpected: true
      }
    );
  });
  it.each([false, undefined])(
    'does not promote an email with verification %s',
    async (verified) => {
      vi.mocked(oidc.fetchUserInfo).mockResolvedValue({
        sub: 'subject-one',
        email: 'unverified@example.invalid',
        ...(verified === undefined ? {} : { email_verified: verified })
      });
      expect(await complete()).toEqual({ iss: issuer, sub: 'subject-one' });
    }
  );
  it('never takes metadata from another subject', async () => {
    vi.mocked(oidc.fetchUserInfo).mockResolvedValue({
      sub: 'subject-two',
      email: 'other@example.invalid',
      email_verified: true
    });
    await expect(complete()).rejects.toThrow('Admin UserInfo subject mismatch');
  });
  it('fails safely when UserInfo is unavailable', async () => {
    vi.mocked(oidc.fetchUserInfo).mockRejectedValue(Error('Synthetic service unavailable'));
    await expect(complete()).rejects.toThrow('Synthetic service unavailable');
  });
  it('does not allow UserInfo to repair an invalid ID token issuer', async () => {
    vi.mocked(oidc.authorizationCodeGrant).mockResolvedValue(
      grant({ ...claims, iss: 'https://wrong.example.invalid' })
    );
    await expect(complete()).rejects.toThrow('Admin OIDC issuer mismatch');
    expect(oidc.fetchUserInfo).not.toHaveBeenCalled();
  });
  it('retains verified ID token metadata only when UserInfo does not supply that field', async () => {
    vi.mocked(oidc.authorizationCodeGrant).mockResolvedValue(
      grant({ ...claims, name: 'ID token name', email: 'id@example.invalid', email_verified: true })
    );
    vi.mocked(oidc.fetchUserInfo).mockResolvedValue({ sub: 'subject-one' });
    expect(await complete()).toEqual({
      iss: issuer,
      sub: 'subject-one',
      name: 'ID token name',
      verifiedEmail: 'id@example.invalid'
    });
  });
  it('uses authoritative UserInfo metadata instead of stale ID token fields', async () => {
    vi.mocked(oidc.authorizationCodeGrant).mockResolvedValue(
      grant({ ...claims, name: 'Old name', email: 'old@example.invalid', email_verified: true })
    );
    expect((await complete()).verifiedEmail).toBe('verified@example.invalid');
  });
  it('does not fall back to an older verified email when UserInfo provides an unverified email', async () => {
    vi.mocked(oidc.authorizationCodeGrant).mockResolvedValue(
      grant({ ...claims, email: 'old@example.invalid', email_verified: true })
    );
    vi.mocked(oidc.fetchUserInfo).mockResolvedValue({
      sub: 'subject-one',
      email: 'new@example.invalid',
      email_verified: false
    });
    expect((await complete()).verifiedEmail).toBeUndefined();
  });
  it('supports providers without UserInfo without skipping the ID token boundary', async () => {
    vi.mocked(oidc.discovery).mockResolvedValue(configuration(false));
    vi.mocked(oidc.authorizationCodeGrant).mockResolvedValue(
      grant({ ...claims, email: 'id@example.invalid', email_verified: true })
    );
    expect((await complete()).verifiedEmail).toBe('id@example.invalid');
    expect(oidc.fetchUserInfo).not.toHaveBeenCalled();
  });
  it('requests the existing email scope and preserves PKCE, nonce and state', async () => {
    const url = await (await createAdminOidcProvider()).begin('verifier', 'state', 'nonce');
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('state')).toBe('state');
    expect(url.searchParams.get('nonce')).toBe('nonce');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
