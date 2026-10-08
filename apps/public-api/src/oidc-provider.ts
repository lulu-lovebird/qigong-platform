import * as oidc from 'openid-client';
import { loadAdminOidcEnvironment, validateVerifiedAdminClaims } from '@qigong/identity';
import type { AdminAuthProvider } from './admin-auth.js';

export const createAdminOidcProvider = async (): Promise<AdminAuthProvider> => {
  const environment = loadAdminOidcEnvironment();
  const configuration = await oidc.discovery(
    new URL(environment.ADMIN_OIDC_ISSUER_URL),
    environment.ADMIN_OIDC_CLIENT_ID,
    undefined,
    oidc.None()
  );
  return {
    callbackUrl: environment.ADMIN_OIDC_REDIRECT_URI,
    async begin(verifier, state, nonce) {
      return oidc.buildAuthorizationUrl(configuration, {
        redirect_uri: environment.ADMIN_OIDC_REDIRECT_URI,
        scope: environment.ADMIN_OIDC_SCOPES,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce
      });
    },
    async complete(url, verifier, state, nonce) {
      const tokens = await oidc.authorizationCodeGrant(configuration, url, {
        pkceCodeVerifier: verifier,
        expectedState: state,
        expectedNonce: nonce,
        idTokenExpected: true
      });
      const claims = validateVerifiedAdminClaims(tokens.claims(), environment);
      return {
        iss: claims.iss,
        sub: claims.sub,
        ...(claims.name ? { name: claims.name } : {}),
        ...(claims.email && claims.email_verified === true ? { verifiedEmail: claims.email } : {})
      };
    }
  };
};
