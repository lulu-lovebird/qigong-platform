/**
 * Opt-in admin MCP JSON transport. GET is a bounded capabilities handshake, not SSE.
 * Mount only behind TLS with a reviewed current-state verifier and least-privileged pool.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { FastifyPluginCallback } from 'fastify';
import type { Pool } from 'pg';
import {
  adminMcpLimits,
  type AdminMcpErrorCode,
  type AdminMcpReadToolName,
  type AdminMcpResponse
} from './admin-mcp-contract.js';
import {
  createAdminMcpDispatcher,
  type AdminMcpAuthVerifier,
  type AdminMcpDispatchDependencies
} from './admin-mcp-dispatch.js';
import {
  createAdminMcpPgReadAdapter,
  type AdminMcpCampaignStatusPolicy
} from './admin-mcp-pg-read-adapter.js';
import { createAdminMcpReadServiceAdapter } from './admin-mcp-read-adapter.js';

export interface AdminMcpMemoryBudgetOptions {
  readonly maximumCalls?: number;
  readonly windowMs?: number;
  readonly maximumKeys?: number;
}

/**
 * Atomic within ONE Node process: no await between checking and consuming a slot.
 * Shared across GET/POST/tools for each verified principal+client, never raw credentials.
 * Bounded key storage fails closed when full; expired keys can be reclaimed without timers.
 * Multiple workers/replicas require a shared atomic limiter before production scale-out.
 */
export const createAdminMcpMemoryBudget = (
  options: AdminMcpMemoryBudgetOptions = {}
): AdminMcpDispatchDependencies['consumeBudget'] => {
  const maximumCalls = options.maximumCalls ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const maximumKeys = options.maximumKeys ?? 10_000;
  for (const [value, ceiling] of [
    [maximumCalls, 10_000],
    [windowMs, 86_400_000],
    [maximumKeys, 100_000]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling)
      throw new Error('invalid admin MCP budget configuration');
  }
  const windows = new Map<string, number[]>();
  return (context) => {
    if (context.signal.aborted) return Promise.resolve(false);
    const now = performance.now();
    const cutoff = now - windowMs;
    const key = JSON.stringify([context.authorization.principalId, context.authorization.clientId]);
    const active = (windows.get(key) ?? []).filter((time) => time > cutoff);
    if (active.length >= maximumCalls) return Promise.resolve(false);
    if (!windows.has(key) && windows.size >= maximumKeys) {
      for (const [candidate, times] of windows) {
        if ((times.at(-1) ?? -Infinity) <= cutoff) windows.delete(candidate);
      }
      if (windows.size >= maximumKeys) return Promise.resolve(false);
    }
    active.push(now);
    windows.set(key, active);
    return Promise.resolve(true);
  };
};

export interface AdminMcpRoutesOptions {
  readonly verifier: AdminMcpAuthVerifier;
  /** Runtime pool, never an owner pool; the PG adapter enforces the existing DB facade. */
  readonly pool: Pool;
  /** Exact trusted browser origins, not derived from Host, Forwarded or the request URL.
   * Missing Origin is allowed for native bearer clients; any supplied Origin must match. */
  readonly allowedOrigins: readonly string[];
  readonly enabledTools?: readonly AdminMcpReadToolName[];
  readonly campaignStatus?: AdminMcpCampaignStatusPolicy;
  readonly budget?: AdminMcpMemoryBudgetOptions;
}

const statusCodes: Readonly<Record<AdminMcpErrorCode, number>> = Object.freeze({
  unauthenticated: 401,
  permission_denied: 403,
  invalid_request: 400,
  tool_unavailable: 404,
  rate_limited: 429,
  service_unavailable: 503,
  timeout: 504,
  cancelled: 408,
  result_unavailable: 502
});
const failure = (code: AdminMcpErrorCode): AdminMcpResponse => ({
  schemaVersion: 1,
  requestId: randomUUID(),
  ok: false,
  error: { code }
});
const bearer = (value: string | undefined): string | null => {
  if (value === undefined || value.length > 8199) return null;
  return /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(value)?.[1] ?? null;
};

export const adminMcpRoutes: FastifyPluginCallback<AdminMcpRoutesOptions> = (
  app,
  options,
  done
) => {
  try {
    const origins = new Set(
      options.allowedOrigins.map((origin) => {
        const url = new URL(origin);
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (
          url.origin !== origin ||
          (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))
        )
          throw new Error('invalid admin MCP allowed origin');
        return origin;
      })
    );
    const dispatch = createAdminMcpDispatcher({
      verifier: options.verifier,
      reads: createAdminMcpReadServiceAdapter(
        createAdminMcpPgReadAdapter(options.pool, options.campaignStatus)
      ),
      consumeBudget: createAdminMcpMemoryBudget(options.budget),
      ...(options.enabledTools === undefined ? {} : { enabledTools: options.enabledTools })
    });

    app.route({
      method: ['GET', 'POST'],
      url: '/mcp/admin',
      bodyLimit: adminMcpLimits.maximumInputBytes,
      onRequest(request, reply, next) {
        reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff');
        // Node can discard duplicate Authorization headers; inspect the raw header names too.
        const counts = new Map<string, number>();
        for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
          const name = request.raw.rawHeaders[index]?.toLowerCase();
          if (name === 'authorization' || name === 'origin')
            counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        if (
          (counts.get('authorization') ?? 0) > 1 ||
          bearer(request.headers.authorization) === null
        ) {
          void reply
            .code(401)
            .header('WWW-Authenticate', 'Bearer realm="admin-mcp"')
            .send(failure('unauthenticated'));
          return;
        }
        const origin = request.headers.origin;
        if (
          (counts.get('origin') ?? 0) > 1 ||
          (origin !== undefined && (typeof origin !== 'string' || !origins.has(origin)))
        ) {
          void reply.code(403).send(failure('permission_denied'));
          return;
        }
        next();
      },
      errorHandler(error, _request, reply) {
        // Fastify's standard JSON parser enforces bodyLimit BEFORE JSON.parse, including
        // streams without Content-Length. Never echo parser errors, input or credentials.
        const status =
          error.code === 'FST_ERR_CTP_BODY_TOO_LARGE'
            ? 413
            : error.statusCode === 415
              ? 415
              : error.statusCode !== undefined && error.statusCode < 500
                ? 400
                : 503;
        void reply
          .code(status)
          .send(failure(status === 503 ? 'service_unavailable' : 'invalid_request'));
      },
      async handler(request, reply) {
        const credential = bearer(request.headers.authorization);
        if (credential === null) {
          return reply
            .code(401)
            .header('WWW-Authenticate', 'Bearer realm="admin-mcp"')
            .send(failure('unauthenticated'));
        }
        const controller = new AbortController();
        const abort = () => controller.abort();
        const onClose = () => {
          if (!reply.raw.writableEnded) abort();
        };
        request.raw.once('aborted', abort);
        reply.raw.once('close', onClose);
        try {
          const response = await dispatch(
            request.method === 'GET'
              ? { tool: 'admin_get_capabilities', arguments: {} }
              : request.body,
            credential,
            controller.signal
          );
          const status = response.ok ? 200 : statusCodes[response.error.code];
          if (status === 401) reply.header('WWW-Authenticate', 'Bearer realm="admin-mcp"');
          if (status === 429) reply.header('Retry-After', '1');
          return reply.code(status).send(response);
        } finally {
          request.raw.removeListener('aborted', abort);
          reply.raw.removeListener('close', onClose);
          controller.abort();
        }
      }
    });
    done();
  } catch {
    done(new Error('invalid admin MCP route configuration'));
  }
};
