/**
 * Dormant internal dispatcher. No routes, OAuth verification, sessions or DB impersonation.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  adminMcpErrorCodes,
  adminMcpLimits,
  adminMcpReadScopes,
  adminMcpScopesFor,
  getAdminMcpToolCatalog,
  isAdminMcpToolName,
  parseAdminMcpCall,
  parseAdminMcpEnvelope,
  parseAdminMcpReadResult,
  type AdminMcpCall,
  type AdminMcpErrorCode,
  type AdminMcpReadCall,
  type AdminMcpReadToolName,
  type AdminMcpResponse,
  type AdminMcpToolName
} from './admin-mcp-contract.js';

export const adminMcpAuthorizationSchema = z
  .object({
    principalId: z.uuid().toLowerCase(),
    clientId: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/),
    principalActive: z.literal(true),
    isSuperAdmin: z.literal(true),
    clientAuthorized: z.literal(true),
    scopes: z
      .array(
        z
          .string()
          .min(1)
          .max(100)
          .regex(/^[A-Za-z0-9:_-]+$/)
      )
      .max(32)
      .readonly(),
    expiresAt: z.iso.datetime({ offset: true })
  })
  .strict()
  .readonly();
export type AdminMcpVerifiedAuthorization = z.infer<typeof adminMcpAuthorizationSchema>;

/**
 * Trusted SERVER dependency, not a browser claims parser. Every invocation MUST verify
 * issuer, resource audience, expiry, revocation, the authorized client and its scopes,
 * then resolve CURRENT active Super Admin status from authoritative server state.
 * Return null on invalid/revoked credentials. Never trust decoded claims alone or reuse
 * a Web Admin cookie/transport session ID as authorization. No implementation is supplied.
 */
export interface AdminMcpAuthVerifier {
  verifyCurrentAuthorization(
    input: Readonly<{
      credential: string;
      requestId: string;
      signal: AbortSignal;
    }>
  ): Promise<AdminMcpVerifiedAuthorization | null>;
}

export const adminMcpReadContextSchema = z
  .object({
    authorization: adminMcpAuthorizationSchema,
    requestId: z.uuid().toLowerCase(),
    signal: z.instanceof(AbortSignal)
  })
  .strict()
  .readonly();
export type AdminMcpReadContext = z.infer<typeof adminMcpReadContextSchema>;

/**
 * Narrow integration seam; deliberately no generic SQL, HTTP, browser session or write.
 * The adapter MUST enforce business/data restrictions in a least-privileged trusted DB
 * context (including cursor binding to tool/selectors/principal/client), honor abort and
 * statement deadlines, and return only the explicit DTO for call.tool. No owner fallback,
 * fake sessions, raw rows, contact details, invitation secrets or private journals.
 * Strings in results are untrusted content, never instructions or executable markup.
 */
export interface AdminMcpReadAdapter {
  /** Optional for legacy internal mocks; concrete adapters declare their implemented subset. */
  readonly supportedTools?: readonly AdminMcpReadToolName[];
  execute(call: AdminMcpReadCall, context: AdminMcpReadContext): Promise<unknown>;
}

/** Only trusted integration code may translate safe service failures into dispatcher codes. */
export class AdminMcpReadAdapterFailure extends Error {
  constructor(readonly code: AdminMcpErrorCode) {
    super(code);
    Object.freeze(this);
  }
}

export interface AdminMcpDispatchDependencies {
  verifier: AdminMcpAuthVerifier;
  reads: AdminMcpReadAdapter;
  /** Required atomic GLOBAL call budget keyed by verified principal AND client, including
   * malformed/disabled calls. Deliberately before tool parsing: no raw identity/tool keys.
   * Optional future per-tool quotas cannot replace this or the preauth in-flight cap.
   * Return true only when consumed; unavailable/throwing limiters never permit a read. */
  consumeBudget(context: AdminMcpReadContext): Promise<boolean>;
  /** Trusted server configuration; omission enables NO business tools. */
  enabledTools?: readonly AdminMcpReadToolName[];
}

export const adminMcpMaximumInFlight = 16;
const credentialSchema = z
  .string()
  .min(1)
  .max(8192)
  .refine((value) => !/[\p{Cc}]/u.test(value));

/**
 * Internal value boundary only. A future transport still needs pre-parse body limits,
 * TLS/Origin checks, OAuth/MCP protocol handling, durable audit and deployment review.
 * No token or principal is ever accepted in the tool envelope or forwarded to the adapter.
 */
export const createAdminMcpDispatcher = (dependencies: AdminMcpDispatchDependencies) => {
  // Snapshot trusted configuration; fail closed if a JS integrator supplies a write/unknown tool.
  const enabled = new Set<AdminMcpToolName>();
  const configured: readonly string[] = dependencies.enabledTools ?? [];
  const supported: readonly string[] | undefined = dependencies.reads.supportedTools;
  const validReadTool = (tool: string) =>
    isAdminMcpToolName(tool) && tool !== 'admin_get_capabilities';
  if (
    configured.every(validReadTool) &&
    (supported === undefined || supported.every(validReadTool))
  ) {
    const implemented = supported === undefined ? null : new Set(supported);
    for (const tool of configured) {
      if (isAdminMcpToolName(tool) && (implemented === null || implemented.has(tool)))
        enabled.add(tool);
    }
  }
  let inFlight = 0;

  return async (
    input: unknown,
    credential: unknown,
    signal?: AbortSignal
  ): Promise<AdminMcpResponse> => {
    const requestId = randomUUID();
    const failure = (code: AdminMcpErrorCode): AdminMcpResponse =>
      Object.freeze({
        schemaVersion: 1,
        requestId,
        ok: false,
        error: Object.freeze({ code })
      });
    // Counts timed-out dependencies until they actually settle; ignored aborts cannot
    // create an unbounded backlog. This local bound does not replace the shared budget.
    if (signal?.aborted) return failure('cancelled');
    if (inFlight >= adminMcpMaximumInFlight) return failure('rate_limited');
    const parsedCredential = credentialSchema.safeParse(credential);
    if (!parsedCredential.success) return failure('unauthenticated');
    const controller = new AbortController();
    let abortCode: 'timeout' | 'cancelled' = 'timeout';
    let onAbort: (() => void) | undefined;
    const cancellation = new Promise<AdminMcpResponse>((resolve) => {
      onAbort = () => {
        abortCode = 'cancelled';
        controller.abort();
        resolve(failure('cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    inFlight += 1;

    const run = async (): Promise<AdminMcpResponse> => {
      try {
        controller.signal.throwIfAborted();
        let verified: AdminMcpVerifiedAuthorization | null;
        try {
          verified = await dependencies.verifier.verifyCurrentAuthorization(
            Object.freeze({
              credential: parsedCredential.data,
              requestId,
              signal: controller.signal
            })
          );
        } catch {
          return failure(controller.signal.aborted ? abortCode : 'unauthenticated');
        }
        controller.signal.throwIfAborted();
        if (verified === null) return failure('unauthenticated');
        const parsed = adminMcpAuthorizationSchema.safeParse(verified);
        if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now())
          return failure('permission_denied');
        const authorization = parsed.data;
        const context = Object.freeze({ authorization, requestId, signal: controller.signal });
        let budget: boolean;
        try {
          budget = await dependencies.consumeBudget(context);
        } catch {
          return failure(controller.signal.aborted ? abortCode : 'service_unavailable');
        }
        controller.signal.throwIfAborted();
        if (budget !== true) return failure('rate_limited');

        let envelope: ReturnType<typeof parseAdminMcpEnvelope>;
        try {
          envelope = parseAdminMcpEnvelope(input);
        } catch {
          return failure('invalid_request');
        }
        if (!isAdminMcpToolName(envelope.tool)) return failure('tool_unavailable');
        const permitted = (tool: AdminMcpToolName) =>
          adminMcpScopesFor(tool).every((scope) => authorization.scopes.includes(scope));
        // Missing scopes reveal neither selector validation nor enablement/support state.
        if (!permitted(envelope.tool)) return failure('permission_denied');
        if (envelope.tool !== 'admin_get_capabilities' && !enabled.has(envelope.tool))
          return failure('tool_unavailable');
        let call: AdminMcpCall;
        try {
          call = parseAdminMcpCall(input);
          // Parsed DTO cap only, NOT protection against raw HTTP/JSON parser allocation.
          if (Buffer.byteLength(JSON.stringify(call), 'utf8') > adminMcpLimits.maximumInputBytes)
            return failure('invalid_request');
        } catch {
          return failure('invalid_request');
        }
        if (Date.parse(authorization.expiresAt) <= Date.now()) return failure('permission_denied');

        let raw: unknown;
        if (call.tool === 'admin_get_capabilities') {
          raw = {
            data: {
              phase: 'read_only',
              scopes: adminMcpReadScopes.filter((scope) => authorization.scopes.includes(scope)),
              tools: getAdminMcpToolCatalog()
                .map((tool) => tool.name)
                .filter(
                  (tool) =>
                    tool === 'admin_get_capabilities' || (enabled.has(tool) && permitted(tool))
                )
            },
            asOf: new Date().toISOString(),
            nextCursor: null,
            truncated: false,
            warnings: []
          };
        } else {
          try {
            raw = await dependencies.reads.execute(call, context);
          } catch (error) {
            if (controller.signal.aborted) return failure(abortCode);
            return failure(
              error instanceof AdminMcpReadAdapterFailure && adminMcpErrorCodes.includes(error.code)
                ? error.code
                : 'service_unavailable'
            );
          }
        }
        controller.signal.throwIfAborted();
        if (Date.parse(authorization.expiresAt) <= Date.now()) return failure('permission_denied');
        try {
          const result = parseAdminMcpReadResult(call, raw);
          const response: AdminMcpResponse = Object.freeze({
            schemaVersion: 1,
            requestId,
            ok: true,
            ...result
          });
          if (
            Buffer.byteLength(JSON.stringify(response), 'utf8') > adminMcpLimits.maximumOutputBytes
          )
            return failure('result_unavailable');
          return response;
        } catch {
          return failure('result_unavailable');
        }
      } catch {
        return failure(controller.signal.aborted ? abortCode : 'service_unavailable');
      }
    };
    const work = run().finally(() => {
      inFlight -= 1;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<AdminMcpResponse>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(failure('timeout'));
      }, adminMcpLimits.timeoutMs);
    });
    try {
      return await Promise.race([work, deadline, cancellation]);
    } finally {
      if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
      controller.abort();
    }
  };
};
