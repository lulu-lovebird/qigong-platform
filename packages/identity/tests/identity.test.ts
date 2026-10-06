import { describe, expect, it } from 'vitest';
import {
  loadAdminOidcEnvironment,
  loadOidcEnvironment,
  validateVerifiedAdminClaims,
  validateVerifiedWebsiteClaims
} from '../src/index.js';

const environment = loadOidcEnvironment({
  OIDC_ISSUER_URL: 'https://members.example.com',
  OIDC_CLIENT_ID: 'qigong-platform',
  OIDC_CLIENT_SECRET: '0123456789abcdef',
  OIDC_REDIRECT_URI: 'https://checkin.example.com/auth/callback'
});

describe('Authgear administrator identity contract', () => {
  const adminEnvironment = loadAdminOidcEnvironment({
    ADMIN_OIDC_ISSUER_URL: 'https://administrators.authgear.cloud',
    ADMIN_OIDC_CLIENT_ID: 'platform-admin',
    ADMIN_OIDC_REDIRECT_URI: 'https://platform.example.com/admin/auth/callback'
  });

  it('uses a separate issuer and immutable administrator subject', () => {
    expect(adminEnvironment.ADMIN_OIDC_SCOPES).toBe('openid profile email');
    expect('ADMIN_OIDC_CLIENT_SECRET' in adminEnvironment).toBe(false);
    expect(
      validateVerifiedAdminClaims(
        {
          iss: adminEnvironment.ADMIN_OIDC_ISSUER_URL,
          sub: 'admin-subject-123',
          aud: adminEnvironment.ADMIN_OIDC_CLIENT_ID
        },
        adminEnvironment
      ).sub
    ).toBe('admin-subject-123');
  });

  it('rejects claims for another issuer, audience or authorized party', () => {
    const claims = {
      iss: adminEnvironment.ADMIN_OIDC_ISSUER_URL,
      sub: 'admin-subject-123',
      aud: adminEnvironment.ADMIN_OIDC_CLIENT_ID
    };
    expect(() =>
      validateVerifiedAdminClaims({ ...claims, iss: 'https://other.example.com' }, adminEnvironment)
    ).toThrow('Admin OIDC issuer mismatch');
    expect(() =>
      validateVerifiedAdminClaims({ ...claims, aud: 'another-client' }, adminEnvironment)
    ).toThrow('Admin OIDC audience mismatch');
    expect(() =>
      validateVerifiedAdminClaims(
        { ...claims, aud: ['platform-admin', 'another-client'], azp: 'another-client' },
        adminEnvironment
      )
    ).toThrow('Admin OIDC authorized party mismatch');
  });
});

describe('OIDC contracts', () => {
  it('loads an HTTPS OIDC configuration', () => {
    expect(
      loadOidcEnvironment({
        OIDC_ISSUER_URL: 'https://members.example.com',
        OIDC_CLIENT_ID: 'qigong-platform',
        OIDC_CLIENT_SECRET: '0123456789abcdef',
        OIDC_REDIRECT_URI: 'https://checkin.example.com/auth/callback'
      })
    ).toMatchObject({ OIDC_SCOPES: 'openid profile email' });
  });

  it('rejects insecure issuer and redirect URLs', () => {
    expect(() =>
      loadOidcEnvironment({
        OIDC_ISSUER_URL: 'http://members.example.com',
        OIDC_CLIENT_ID: 'qigong-platform',
        OIDC_CLIENT_SECRET: '0123456789abcdef',
        OIDC_REDIRECT_URI: 'https://checkin.example.com/auth/callback'
      })
    ).toThrow('HTTPS required');
    expect(() =>
      loadOidcEnvironment({
        OIDC_ISSUER_URL: 'https://members.example.com?tenant=production',
        OIDC_CLIENT_ID: 'qigong-platform',
        OIDC_CLIENT_SECRET: '0123456789abcdef',
        OIDC_REDIRECT_URI: 'https://checkin.example.com/auth/callback'
      })
    ).toThrow('OIDC URLs cannot contain credentials, query, or fragment');
    expect(() => loadOidcEnvironment({ ...environment, OIDC_SCOPES: 'profile email' })).toThrow(
      'OIDC scopes must include openid'
    );
  });

  it('requires issuer-qualified claims from the verified-token boundary', () => {
    expect(
      validateVerifiedWebsiteClaims(
        {
          iss: 'https://members.example.com',
          sub: 'member-123',
          aud: 'qigong-platform',
          email: 'learner@example.com',
          email_verified: true,
          name: 'Learner Name',
          membership_status: 'active'
        },
        environment
      )
    ).toMatchObject({ sub: 'member-123', membership_status: 'active' });
    expect(() =>
      validateVerifiedWebsiteClaims(
        {
          iss: 'https://other.example.com',
          sub: 'member-123',
          aud: 'qigong-platform',
          name: 'Name',
          membership_status: 'active'
        },
        environment
      )
    ).toThrow('OIDC issuer mismatch');
    expect(() =>
      validateVerifiedWebsiteClaims(
        {
          iss: 'https://members.example.com',
          sub: 'member-123',
          aud: 'another-client',
          name: 'Name',
          membership_status: 'active'
        },
        environment
      )
    ).toThrow('OIDC audience mismatch');
    expect(() =>
      validateVerifiedWebsiteClaims(
        {
          iss: 'https://members.example.com',
          sub: 'member-123',
          aud: ['qigong-platform', 'another-client'],
          azp: 'another-client',
          name: 'Name',
          membership_status: 'active'
        },
        environment
      )
    ).toThrow('OIDC authorized party mismatch');
    expect(() =>
      validateVerifiedWebsiteClaims(
        { sub: 'member-123', aud: 'qigong-platform', name: 'Name', membership_status: 'active' },
        environment
      )
    ).toThrow();
  });
});
