import { z } from 'zod';

const oidcUrl = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    context.addIssue({ code: 'custom', message: 'HTTPS required' });
  }
  if (url.username || url.password || url.search || url.hash) {
    context.addIssue({
      code: 'custom',
      message: 'OIDC URLs cannot contain credentials, query, or fragment'
    });
  }
});

export const oidcEnvironmentSchema = z.object({
  OIDC_ISSUER_URL: oidcUrl,
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(16),
  OIDC_REDIRECT_URI: oidcUrl,
  OIDC_POST_LOGOUT_REDIRECT_URI: oidcUrl.optional(),
  OIDC_SCOPES: z
    .string()
    .trim()
    .min(1)
    .refine((value) => value.split(/\s+/).includes('openid'), 'OIDC scopes must include openid')
    .default('openid profile email')
});

export type OidcEnvironment = z.infer<typeof oidcEnvironmentSchema>;

export const loadOidcEnvironment = (source: NodeJS.ProcessEnv = process.env): OidcEnvironment =>
  oidcEnvironmentSchema.parse(source);

// Administrator authentication is deliberately separate from the future learner membership IdP.
export const adminOidcEnvironmentSchema = z.object({
  ADMIN_OIDC_ISSUER_URL: oidcUrl,
  ADMIN_OIDC_CLIENT_ID: z.string().min(1),
  ADMIN_OIDC_REDIRECT_URI: oidcUrl,
  ADMIN_OIDC_POST_LOGOUT_REDIRECT_URI: oidcUrl.optional(),
  ADMIN_OIDC_SCOPES: z
    .string()
    .trim()
    .min(1)
    .refine((value) => value.split(/\s+/).includes('openid'), 'OIDC scopes must include openid')
    .default('openid profile email')
});

export type AdminOidcEnvironment = z.infer<typeof adminOidcEnvironmentSchema>;

export const loadAdminOidcEnvironment = (
  source: NodeJS.ProcessEnv = process.env
): AdminOidcEnvironment => adminOidcEnvironmentSchema.parse(source);

export const verifiedAdminClaimsSchema = z.object({
  iss: oidcUrl,
  sub: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  azp: z.string().min(1).optional(),
  email: z.email().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().min(1).optional()
});

export type VerifiedAdminClaims = z.infer<typeof verifiedAdminClaimsSchema>;

// This validates the claims contract AFTER an OIDC library has verified signature,
// expiry, nonce, issuer and audience. It must never be used on an unverified JWT.
export const validateVerifiedAdminClaims = (
  claims: unknown,
  environment: AdminOidcEnvironment
): VerifiedAdminClaims => {
  const parsed = verifiedAdminClaimsSchema.parse(claims);
  if (parsed.iss !== environment.ADMIN_OIDC_ISSUER_URL) {
    throw new Error('Admin OIDC issuer mismatch');
  }
  const audiences = Array.isArray(parsed.aud) ? parsed.aud : [parsed.aud];
  if (!audiences.includes(environment.ADMIN_OIDC_CLIENT_ID)) {
    throw new Error('Admin OIDC audience mismatch');
  }
  if (
    (audiences.length > 1 || parsed.azp !== undefined) &&
    parsed.azp !== environment.ADMIN_OIDC_CLIENT_ID
  ) {
    throw new Error('Admin OIDC authorized party mismatch');
  }
  return parsed;
};

export const verifiedWebsiteClaimsSchema = z.object({
  iss: oidcUrl,
  sub: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  azp: z.string().min(1).optional(),
  email: z.email().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().min(1),
  preferred_username: z.string().optional(),
  membership_id: z.string().min(1).optional(),
  membership_status: z.enum(['pending', 'active', 'suspended', 'expired'])
});

export type VerifiedWebsiteClaims = z.infer<typeof verifiedWebsiteClaimsSchema>;

export const validateVerifiedWebsiteClaims = (
  claims: unknown,
  environment: OidcEnvironment
): VerifiedWebsiteClaims => {
  const parsed = verifiedWebsiteClaimsSchema.parse(claims);
  if (parsed.iss !== environment.OIDC_ISSUER_URL) {
    throw new Error('OIDC issuer mismatch');
  }
  const audiences = Array.isArray(parsed.aud) ? parsed.aud : [parsed.aud];
  if (!audiences.includes(environment.OIDC_CLIENT_ID)) {
    throw new Error('OIDC audience mismatch');
  }
  if (
    (audiences.length > 1 || parsed.azp !== undefined) &&
    parsed.azp !== environment.OIDC_CLIENT_ID
  ) {
    throw new Error('OIDC authorized party mismatch');
  }
  return parsed;
};

export type Platform = 'line' | 'telegram' | 'whatsapp';

export interface VerifiedPlatformIdentity {
  platform: Platform;
  externalSubjectId: string;
  displayName?: string;
  username?: string;
  providerLocale?: string;
}
