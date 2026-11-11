/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { adminMcpReadScopes, type AdminMcpReadScope } from './admin-mcp-contract.js';
import { adminMcpAuthorizationSchema, type AdminMcpAuthVerifier } from './admin-mcp-dispatch.js';

const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);
const scope = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9:_-]+$/);
const scopes = z.array(scope).max(32).readonly();
const instant = z.number().int().min(0).max(253402300799);
const claimsSchema = z
  .object({
    iss: z.string().min(1).max(2048),
    aud: z.string().min(1).max(2048),
    sub: z.uuid().toLowerCase(),
    jti: identifier,
    client_id: identifier,
    scope: z
      .string()
      .max(3231)
      .transform((value) => value.split(' '))
      .pipe(z.array(scope).max(32))
      .readonly(),
    exp: instant,
    iat: instant.optional(),
    nbf: instant.optional()
  })
  .strict();

const credentialStateSchema = z
  .object({
    tokenId: identifier,
    principalId: z.uuid().toLowerCase(),
    clientId: identifier,
    issuer: z.string().min(1).max(2048),
    audience: z.string().min(1).max(2048),
    principalActive: z.boolean(),
    role: z.string().min(1).max(100),
    clientAuthorized: z.boolean(),
    revoked: z.boolean(),
    scopes,
    expiresAt: z.iso.datetime({ offset: true })
  })
  .strict()
  .readonly();

export type AdminMcpCredentialState = z.infer<typeof credentialStateSchema>;
export interface AdminMcpAuthVerifierOptions {
  /** Dedicated admin-MCP HS256 key, at least 32 random bytes; never a browser-session key. */
  readonly signingKey: Uint8Array;
  readonly issuer: string;
  readonly audience: string;
  readonly authorizedClientIds: readonly string[];
  /** Defaults to all canonical MCP read scopes. Narrow deployments may require a subset. */
  readonly requiredScopes?: readonly AdminMcpReadScope[];
  /**
   * REQUIRED authoritative lookup on EVERY call, keyed by the signed token ID and identity.
   * Resolve current principal role/activity, token revocation and client/scope grants from
   * trusted server storage. No decoded-claims fallback or authorization cache is permitted.
   * Honor signal and a bounded storage deadline; null means unknown/revoked credentials.
   */
  resolveCurrentAuthorization(
    input: Readonly<{
      tokenId: string;
      principalId: string;
      clientId: string;
      requestId: string;
      signal: AbortSignal;
    }>
  ): Promise<AdminMcpCredentialState | null>;
}

/** HS256 JWT profile, not an OAuth authorization server or a Web Admin cookie verifier. */
export const createAdminMcpAuthVerifier = (
  options: AdminMcpAuthVerifierOptions
): AdminMcpAuthVerifier => {
  const key = Buffer.from(options.signingKey);
  const issuer = z.string().min(1).max(2048).parse(options.issuer);
  const audience = z.string().min(1).max(2048).parse(options.audience);
  const clients = new Set(z.array(identifier).min(1).parse(options.authorizedClientIds));
  const required = z
    .array(z.enum(adminMcpReadScopes))
    .min(1)
    .parse(options.requiredScopes ?? adminMcpReadScopes);
  if (key.length < 32) throw new Error('admin MCP signing key must contain at least 32 bytes');
  const resolveCurrent = options.resolveCurrentAuthorization.bind(options);
  const decode = (part: string) => {
    if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('invalid credential');
    const bytes = Buffer.from(part, 'base64url');
    if (bytes.toString('base64url') !== part) throw new Error('invalid credential');
    return bytes;
  };

  return Object.freeze({
    async verifyCurrentAuthorization({ credential, requestId, signal }) {
      try {
        if (signal.aborted || credential.length === 0 || credential.length > 8192) return null;
        const parts = credential.split('.');
        const [header, payload, signature] = parts;
        if (parts.length !== 3 || !header || !payload || !signature) return null;
        const actual = decode(signature);
        const expected = createHmac('sha256', key).update(`${header}.${payload}`).digest();
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
        z.object({ alg: z.literal('HS256'), typ: z.literal('JWT') })
          .strict()
          .parse(JSON.parse(decode(header).toString('utf8')) as unknown);
        const claims = claimsSchema.parse(JSON.parse(decode(payload).toString('utf8')) as unknown);
        const now = Date.now();
        if (
          claims.iss !== issuer ||
          claims.aud !== audience ||
          !clients.has(claims.client_id) ||
          claims.exp * 1000 <= now ||
          (claims.nbf !== undefined && claims.nbf * 1000 > now) ||
          (claims.iat !== undefined && claims.iat * 1000 > now) ||
          !required.every((value) => claims.scope.includes(value))
        )
          return null;
        const state = credentialStateSchema.safeParse(
          await resolveCurrent(
            Object.freeze({
              tokenId: claims.jti,
              principalId: claims.sub,
              clientId: claims.client_id,
              requestId,
              signal
            })
          )
        );
        if (!state.success || signal.aborted) return null;
        const current = state.data;
        const effectiveScopes = adminMcpReadScopes.filter(
          (value) => claims.scope.includes(value) && current.scopes.includes(value)
        );
        const expiresAt = Math.min(claims.exp * 1000, Date.parse(current.expiresAt));
        if (
          current.tokenId !== claims.jti ||
          current.principalId !== claims.sub ||
          current.clientId !== claims.client_id ||
          current.issuer !== issuer ||
          current.audience !== audience ||
          !current.principalActive ||
          current.role !== 'super_admin' ||
          !current.clientAuthorized ||
          current.revoked ||
          expiresAt <= Date.now() ||
          !required.every((value) => effectiveScopes.includes(value))
        )
          return null;
        return adminMcpAuthorizationSchema.parse({
          principalId: current.principalId,
          clientId: current.clientId,
          principalActive: true,
          isSuperAdmin: true,
          clientAuthorized: true,
          scopes: effectiveScopes,
          expiresAt: new Date(expiresAt).toISOString()
        });
      } catch {
        return null;
      }
    }
  } satisfies AdminMcpAuthVerifier);
};
