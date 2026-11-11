/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
  adminMcpReadMaximumBytes,
  buildAdminMcpReadQuery,
  decodeAdminMcpReadPage,
  parseAdminMcpReadRequest,
  type AdminMcpReadData,
  type AdminMcpReadQuery
} from './admin-mcp-read-model.js';

export const adminMcpReadRequiredScopes = Object.freeze({
  guidance_list: 'admin:guidance:read',
  guidance_get: 'admin:guidance:read',
  venues_list: 'admin:venues:read'
} as const);

export type AdminMcpReadAdapterResult =
  | Readonly<{ status: 'ok'; data: unknown }>
  | Readonly<{ status: 'permission_denied' | 'not_found' | 'unavailable' }>;

/**
 * TRUSTED SERVER dependency, never tool input or an agent-selected dependency.
 * Bind it to the authenticated request in server code, not a principal UUID,
 * agent-supplied role, browser cookie obtained by an agent, or cached grant.
 *
 * Each read MUST revalidate issuer/audience/expiry/client/revocation, current
 * active Super Admin status (NOT Master Admin), the required scope above, the
 * read feature gate, and the selected business region/resource. Authorization
 * and the bounded read must share a trusted operation boundary; denial must
 * precede resource-existence disclosure. A cursor is only a position hint.
 *
 * The implementation MUST use an authorization-preserving restricted DB facade,
 * enforce query.fetchLimit at the data source, and return normalized shapes
 * documented in decodeAdminMcpReadPage. Lists order by canonical UUID ascending;
 * guidance_get entries order by guideDate ascending. Return one lookahead row,
 * not an unbounded list, export, aggregate inferred from a page, or raw SQL.
 *
 * PRODUCTION WIRING BLOCKED: existing admin.manage_guidance_campaign(list/get)
 * in migration 0063 requires a browser session, permits Master Admin too, and
 * returns unbounded campaigns/entries. runVenueManagement similarly requires a
 * browser session and its list is not paginated. Neither is an MCP credential
 * adapter. A reviewed trusted MCP identity + bounded DB authorization contract
 * is required before implementing this dependency. Never invent a session,
 * set caller-supplied principal context, query raw tables, or use an owner pool.
 *
 * This module intentionally supplies NO production adapter, OAuth verifier,
 * HTTP route, MCP transport, or advertised runnable tool registration.
 */
export interface TrustedAdminMcpReadAdapter {
  read(query: AdminMcpReadQuery): Promise<AdminMcpReadAdapterResult>;
}

export type AdminMcpReadError =
  'invalid_request' | 'permission_denied' | 'not_found' | 'read_unavailable';
export type AdminMcpReadResult =
  | Readonly<{
      ok: true;
      schemaVersion: 1;
      requestId: string;
      data: AdminMcpReadData;
      asOf: string;
      nextCursor: string | null;
      truncated: boolean;
      warnings: readonly string[];
    }>
  | Readonly<{
      ok: false;
      schemaVersion: 1;
      requestId: string;
      error: AdminMcpReadError;
    }>;
export interface AdminMcpReadService {
  read(input: unknown): Promise<AdminMcpReadResult>;
}

/** Validated, minimized service foundation only; adapter trust is external. */
export const createAdminMcpReadService = (
  adapter: TrustedAdminMcpReadAdapter
): AdminMcpReadService =>
  Object.freeze({
    async read(input: unknown): Promise<AdminMcpReadResult> {
      const requestId = randomUUID();
      const failure = (error: AdminMcpReadError): AdminMcpReadResult => ({
        ok: false,
        schemaVersion: 1,
        requestId,
        error
      });
      let query: AdminMcpReadQuery;
      try {
        query = buildAdminMcpReadQuery(parseAdminMcpReadRequest(input));
      } catch {
        return failure('invalid_request');
      }
      try {
        // No authorization snapshot is cached, including between cursor pages.
        const result = await adapter.read(query);
        if (result.status === 'permission_denied') return failure('permission_denied');
        if (result.status === 'not_found') {
          return failure(query.operation === 'guidance_get' ? 'not_found' : 'read_unavailable');
        }
        if (result.status !== 'ok') return failure('read_unavailable');
        const page = decodeAdminMcpReadPage(result.data, query);
        const response = {
          ok: true,
          schemaVersion: 1,
          requestId,
          data: page.data,
          asOf: new Date().toISOString(),
          nextCursor: page.nextCursor,
          truncated: page.truncated,
          warnings: ['Pagination is not a snapshot; asOf is the response time.']
        } satisfies AdminMcpReadResult;
        // Include envelope metadata in the wire-size bound, not just data rows.
        return Buffer.byteLength(JSON.stringify(response), 'utf8') <= adminMcpReadMaximumBytes
          ? response
          : failure('read_unavailable');
      } catch {
        // Do not inspect/echo adapter messages: they may contain SQL, tokens,
        // browser sessions, contact details, or raw validation diagnostics.
        return failure('read_unavailable');
      }
    }
  });
