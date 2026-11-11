/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { Buffer } from 'node:buffer';
import {
  adminMcpScopesFor,
  parseAdminMcpReadResult,
  type AdminMcpErrorCode,
  type AdminMcpResponse
} from './admin-mcp-contract.js';
import type { AdminMcpReadContext } from './admin-mcp-dispatch.js';
import {
  adminMcpReadMaximumBytes,
  buildAdminMcpReadQuery,
  decodeAdminMcpReadPage,
  parseAdminMcpReadRequest,
  type AdminMcpReadRequest,
  type AdminMcpReadQuery
} from './admin-mcp-read-model.js';

export const adminMcpReadRequiredScopes = Object.freeze({
  guidance_list: adminMcpScopesFor('guidance_list')[0],
  guidance_get: adminMcpScopesFor('guidance_get')[0],
  venues_list: adminMcpScopesFor('venues_list')[0]
});
export type AdminMcpReadAdapterResult =
  | Readonly<{ status: 'ok'; data: unknown }>
  | Readonly<{ status: 'permission_denied' | 'not_found' | 'unavailable' }>;

/**
 * TRUSTED SERVER dependency, not an implementation of OAuth or database authorization.
 * Each read MUST revalidate current active Super Admin status, issuer/audience/expiry,
 * client/revocation, scopes, feature gates and selected business resources. The context
 * is server-resolved, never tool input, and is not itself proof of ongoing authorization.
 * Authorization and the bounded read must share a trusted operation boundary; denial
 * precedes resource-existence disclosure. No authorization is cached between pages.
 *
 * Enforce every query selector, half-open guidance overlap in the supplied timezone,
 * fetchLimit and ascending keyset ordering AT SOURCE. Honor context.signal and database
 * statement deadlines. Do not silently ignore a filter or fetch an unbounded list.
 * Return the canonical DTO wire shapes documented in decodeAdminMcpReadPage.
 *
 * PRODUCTION WIRING BLOCKED: admin.manage_guidance_campaign (migration 0063) needs a
 * browser session, also permits Master Admin, and returns unbounded lists/entries.
 * runVenueManagement likewise needs a browser session and has no bounded list contract.
 * Neither is an MCP credential adapter. A reviewed MCP identity + restricted bounded
 * DB facade is required. Never invent sessions, set caller-controlled principal context,
 * query raw tables or use an owner pool. Legacy status/date mapping requires review too.
 * NO production adapter, OAuth verifier, HTTP route or MCP transport is supplied here.
 */
export interface TrustedAdminMcpReadAdapter {
  read(query: AdminMcpReadQuery, context: AdminMcpReadContext): Promise<AdminMcpReadAdapterResult>;
}
export interface AdminMcpReadService {
  read(input: unknown, context: AdminMcpReadContext): Promise<AdminMcpResponse>;
}

/** Canonical input/output only; real authorization and DB trust remain external. */
export const createAdminMcpReadService = (
  adapter: TrustedAdminMcpReadAdapter
): AdminMcpReadService =>
  Object.freeze({
    async read(input: unknown, context: AdminMcpReadContext): Promise<AdminMcpResponse> {
      const failure = (code: AdminMcpErrorCode): AdminMcpResponse =>
        Object.freeze({
          ok: false,
          schemaVersion: 1,
          requestId: context.requestId,
          error: Object.freeze({ code })
        });
      const permitted = () => {
        const auth = context.authorization;
        return (
          auth.principalActive === true &&
          auth.isSuperAdmin === true &&
          auth.clientAuthorized === true &&
          Date.parse(auth.expiresAt) > Date.now()
        );
      };
      if (context.signal.aborted) return failure('timeout');
      if (!permitted()) return failure('permission_denied');
      let request: AdminMcpReadRequest;
      let query: AdminMcpReadQuery;
      try {
        request = parseAdminMcpReadRequest(input);
        if (
          !adminMcpScopesFor(request.tool).every((scope) =>
            context.authorization.scopes.includes(scope)
          )
        )
          return failure('permission_denied');
        query = buildAdminMcpReadQuery(request, context.authorization);
      } catch {
        return failure('invalid_request');
      }
      let source: unknown;
      try {
        const result = await adapter.read(query, context);
        context.signal.throwIfAborted();
        if (!permitted()) return failure('permission_denied');
        if (result.status === 'permission_denied') return failure('permission_denied');
        // No new not_found wire contract or resource-existence disclosure is introduced.
        if (result.status === 'not_found') return failure('result_unavailable');
        if (result.status !== 'ok') return failure('service_unavailable');
        source = result.data;
      } catch {
        return failure(context.signal.aborted ? 'timeout' : 'service_unavailable');
      }
      try {
        const page = decodeAdminMcpReadPage(source, query, context.authorization);
        const parsed = parseAdminMcpReadResult(request, {
          ...page,
          asOf: new Date().toISOString(),
          warnings: ['pagination_not_snapshot']
        });
        const response: AdminMcpResponse = Object.freeze({
          ok: true,
          schemaVersion: 1,
          requestId: context.requestId,
          ...parsed
        });
        return Buffer.byteLength(JSON.stringify(response), 'utf8') <= adminMcpReadMaximumBytes
          ? response
          : failure('result_unavailable');
      } catch {
        return failure('result_unavailable');
      }
    }
  });
