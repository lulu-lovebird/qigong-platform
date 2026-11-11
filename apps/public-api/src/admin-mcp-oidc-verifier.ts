/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { Buffer } from 'node:buffer';
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  adminMcpLimits,
  adminMcpReadScopes,
  type AdminMcpReadScope
} from './admin-mcp-contract.js';
import { adminMcpAuthorizationSchema, type AdminMcpAuthVerifier } from './admin-mcp-dispatch.js';

export interface AdminMcpOidcVerifierOptions {
  /** Trusted server pool; configure bounded connection and server-side statement timeouts. */
  readonly pool: Pool;
  readonly issuer: string;
  readonly clientId: string;
  /** Additional explicitly authorized Admin MCP clients, never arbitrary browser clients. */
  readonly allowedClientIds?: readonly string[];
  /** Defaults to all canonical MCP read scopes. */
  readonly requiredScopes?: readonly AdminMcpReadScope[];
  readonly jwksUri?: string;
  readonly fetchJwks?: (url: string) => Promise<{ keys: JsonWebKey[] }>;
}

const clientIdentifier = adminMcpAuthorizationSchema.unwrap().shape.clientId;
const text = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[^\p{Cc}\s]+$/u);
const instant = z.number().int().min(0).max(253402300799);
const headerSchema = z.object({
  alg: z.literal('RS256'),
  kid: text,
  // No critical extensions or unencoded payload profile is implemented.
  crit: z.never().optional(),
  b64: z.never().optional()
});
const claimsSchema = z.object({
  iss: text,
  aud: z.union([text, z.array(text).min(1).max(32)]).optional(),
  client_id: clientIdentifier.optional(),
  sub: text,
  exp: instant,
  nbf: instant.optional(),
  iat: instant.optional(),
  scope: z
    .string()
    .max(3231)
    .transform((value) => value.split(' '))
    .pipe(
      z
        .array(
          z
            .string()
            .min(1)
            .max(100)
            .regex(/^[A-Za-z0-9:_-]+$/)
        )
        .max(32)
    )
});
const jwksSchema = z.object({
  keys: z.array(z.record(z.string(), z.unknown())).min(1).max(100)
});
const rsaKeySchema = z.object({
  kty: z.literal('RSA'),
  n: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/),
  e: z
    .string()
    .min(1)
    .max(16)
    .regex(/^[A-Za-z0-9_-]+$/),
  alg: z.literal('RS256').optional(),
  use: z.literal('sig').optional(),
  key_ops: z
    .array(z.string())
    .refine((ops) => ops.includes('verify'))
    .optional(),
  d: z.never().optional()
});
const principalSchema = z.object({
  id: z.uuid().toLowerCase(),
  status: z.literal('active'),
  role_code: z.literal('super_admin')
});
const authorizationSql = `SELECT p.id, p.status, r.code AS role_code
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
LIMIT 1`;
const jwksTtlMs = 300_000;
const maximumJwksBytes = 131_072;

const trustedUrl = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('admin MCP OIDC requires an HTTPS issuer and JWKS URL');
  return url.href;
};
const decode = (part: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('invalid credential');
  const bytes = Buffer.from(part, 'base64url');
  if (bytes.toString('base64url') !== part) throw new Error('invalid credential');
  return bytes;
};

// Cancellation stops waiting, not ownership of a pending pool query or shared JWKS load.
// Both rejection handlers remain attached even if the caller has already aborted.
const abortable = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T | null> =>
  new Promise((resolve, reject) => {
    const abort = () => resolve(null);
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      () => {
        signal.removeEventListener('abort', abort);
        reject(new Error('authorization unavailable'));
      }
    );
    if (signal.aborted) abort();
  });

const fetchDefaultJwks = async (url: string): Promise<unknown> => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(adminMcpLimits.timeoutMs),
    redirect: 'error',
    headers: { accept: 'application/json' }
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('JWKS unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumJwksBytes) throw new Error('JWKS too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
};

/** Native Authgear RS256 verification; no transport wiring or browser-session fallback. */
export const createAdminMcpOidcVerifier = (
  options: AdminMcpOidcVerifierOptions
): AdminMcpAuthVerifier => {
  const { pool } = options;
  const issuer = text.parse(options.issuer);
  trustedUrl(issuer);
  const clientId = clientIdentifier.parse(options.clientId);
  const clients = new Set([
    clientId,
    ...z
      .array(clientIdentifier)
      .max(32)
      .parse(options.allowedClientIds ?? [])
  ]);
  const required = z
    .array(z.enum(adminMcpReadScopes))
    .min(1)
    .parse(options.requiredScopes ?? adminMcpReadScopes);
  const jwksUri = trustedUrl(options.jwksUri ?? new URL('/oauth2/jwks', issuer).href);
  const fetchJwks = options.fetchJwks ?? fetchDefaultJwks;
  let cache: { keys: z.infer<typeof jwksSchema>['keys']; expiresAt: number } | undefined;
  let pending: Promise<z.infer<typeof jwksSchema>['keys']> | undefined;
  const loadKeys = () => {
    if (cache && cache.expiresAt > Date.now()) return Promise.resolve(cache.keys);
    // Coalesce refreshes; unknown kids cannot trigger a fetch per attacker-supplied token.
    pending ??= Promise.resolve()
      .then(() => fetchJwks(jwksUri))
      .then((raw) => {
        const { keys } = jwksSchema.parse(raw);
        cache = { keys, expiresAt: Date.now() + jwksTtlMs };
        return keys;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };

  return Object.freeze({
    async verifyCurrentAuthorization({ credential, signal: callerSignal }) {
      try {
        if (callerSignal.aborted || credential.length === 0 || credential.length > 8192)
          return null;
        const signal = AbortSignal.any([
          callerSignal,
          AbortSignal.timeout(adminMcpLimits.timeoutMs)
        ]);
        const parts = credential.split('.');
        const [headerPart, payloadPart, signaturePart] = parts;
        if (parts.length !== 3 || !headerPart || !payloadPart || !signaturePart) return null;
        const header = headerSchema.parse(
          JSON.parse(decode(headerPart).toString('utf8')) as unknown
        );
        const claims = claimsSchema.parse(
          JSON.parse(decode(payloadPart).toString('utf8')) as unknown
        );
        const signature = decode(signaturePart);
        const audiences = typeof claims.aud === 'string' ? [claims.aud] : (claims.aud ?? []);
        const parsedClientId =
          claims.client_id ?? audiences.find((audience) => clients.has(audience));
        const scopes = adminMcpReadScopes.filter((scope) => claims.scope.includes(scope));
        const unexpired = () => claims.exp * 1000 > Date.now();
        if (
          claims.iss !== issuer ||
          !parsedClientId ||
          !clients.has(parsedClientId) ||
          !unexpired() ||
          (claims.nbf !== undefined && claims.nbf * 1000 > Date.now()) ||
          (claims.iat !== undefined && claims.iat * 1000 > Date.now()) ||
          !required.every((scope) => scopes.includes(scope))
        )
          return null;
        const keys = await abortable(loadKeys(), signal);
        if (!keys || signal.aborted || !unexpired()) return null;
        const matching = keys.filter((key) => key.kid === header.kid);
        if (matching.length !== 1) return null;
        const jwk = rsaKeySchema.parse(matching[0]);
        const key = createPublicKey({
          key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
          format: 'jwk'
        });
        if (
          (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
          !verify('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), key, signature)
        )
          return null;
        if (signal.aborted || !unexpired()) return null;
        // NEVER cache principal or grant state. SQL, not token role claims, is authoritative.
        const result = await abortable(
          pool.query<{ id: unknown; status: unknown; role_code: unknown }>(authorizationSql, [
            issuer,
            claims.sub
          ]),
          signal
        );
        if (!result || signal.aborted || !unexpired() || result.rows.length !== 1) return null;
        const row = principalSchema.parse(result.rows[0]);
        return adminMcpAuthorizationSchema.parse({
          principalId: row.id,
          clientId: parsedClientId,
          principalActive: true,
          isSuperAdmin: true,
          clientAuthorized: true,
          scopes,
          expiresAt: new Date(claims.exp * 1000).toISOString()
        });
      } catch {
        return null;
      }
    }
  } satisfies AdminMcpAuthVerifier);
};
