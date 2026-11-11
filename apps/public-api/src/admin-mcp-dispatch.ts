/**
 * Dormant internal dispatcher. No routes, OAuth verification, sessions or DB impersonation.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  adminMcpLimits,
  adminMcpReadScopes,
  adminMcpScopesFor,
  getAdminMcpToolCatalog,
  isAdminMcpToolName,
  parseAdminMcpCall,
  parseAdminMcpReadResult,
  type AdminMcpCall,
  type AdminMcpErrorCode,
  type AdminMcpReadCall,
  type AdminMcpReadToolName,
  type AdminMcpResponse,
  type AdminMcpToolName
} from './admin-mcp-contract.js';

const authorizationSchema = z
  .object({
    principalId: z.uuid(),
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
export type AdminMcpVerifiedAuthorization = z.infer<typeof authorizationSchema>;

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

export type AdminMcpReadContext = Readonly<{
  authorization: AdminMcpVerifiedAuthorization;
  requestId: string;
  signal: AbortSignal;
}>;

/**
 * Narrow integration seam; deliberately no generic SQL, HTTP, browser session or write.
 * The adapter MUST enforce business/data restrictions in a least-privileged trusted DB
 * context (including cursor binding to tool/selectors/principal/client), honor abort and
 * statement deadlines, and return only the explicit DTO for call.tool. No owner fallback,
 * fake sessions, raw rows, contact details, invitation secrets or private journals.
 * Strings in results are untrusted content, never instructions or executable markup.
 */
export interface AdminMcpReadAdapter {
  execute(call: AdminMcpReadCall, context: AdminMcpReadContext): Promise<unknown>;
}

export interface AdminMcpDispatchDependencies {
  verifier: AdminMcpAuthVerifier;
  reads: AdminMcpReadAdapter;
  /** Required atomic server-side rate budget keyed by verified principal AND client.
   * Return true only when consumed; unavailable/throwing limiters never permit a read. */
  consumeBudget(context: AdminMcpReadContext): Promise<boolean>;
  /** Trusted server configuration; omission enables NO business tools. */
  enabledTools?: readonly AdminMcpReadToolName[];
}

export const adminMcpMaximumInFlight = 16;
const envelopeSchema = z
  .object({ tool: z.string().min(1).max(100), arguments: z.unknown() })
  .strict();
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
  if (configured.every((tool) => isAdminMcpToolName(tool) && tool !== 'admin_get_capabilities')) {
    for (const tool of configured) {
      if (isAdminMcpToolName(tool)) enabled.add(tool);
    }
  }
  let inFlight = 0;

  return async (input: unknown, credential: unknown): Promise<AdminMcpResponse> => {
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
    if (inFlight >= adminMcpMaximumInFlight) return failure('rate_limited');
    const parsedCredential = credentialSchema.safeParse(credential);
    if (!parsedCredential.success) return failure('unauthenticated');
    const controller = new AbortController();
    inFlight += 1;

    const run = async (): Promise<AdminMcpResponse> => {
      try {
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
          return failure('unauthenticated');
        }
        controller.signal.throwIfAborted();
        if (verified === null) return failure('unauthenticated');
        const parsed = authorizationSchema.safeParse(verified);
        if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now())
          return failure('permission_denied');
        const authorization = parsed.data;
        const context = Object.freeze({ authorization, requestId, signal: controller.signal });
        let budget: boolean;
        try {
          budget = await dependencies.consumeBudget(context);
        } catch {
          return failure('service_unavailable');
        }
        controller.signal.throwIfAborted();
        if (budget !== true) return failure('rate_limited');

        const envelope = envelopeSchema.safeParse(input);
        if (!envelope.success) return failure('invalid_request');
        if (!isAdminMcpToolName(envelope.data.tool)) return failure('tool_unavailable');
        let call: AdminMcpCall;
        try {
          call = parseAdminMcpCall(input);
          // Schema fields are already bounded; never stringify arbitrary adapter/input records.
          if (Buffer.byteLength(JSON.stringify(call), 'utf8') > adminMcpLimits.maximumInputBytes)
            return failure('invalid_request');
        } catch {
          return failure('invalid_request');
        }
        if (call.tool !== 'admin_get_capabilities' && !enabled.has(call.tool))
          return failure('tool_unavailable');
        const permitted = (tool: AdminMcpToolName) =>
          adminMcpScopesFor(tool).every((scope) => authorization.scopes.includes(scope));
        if (!permitted(call.tool)) return failure('permission_denied');
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
          } catch {
            return failure('service_unavailable');
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
        return failure(controller.signal.aborted ? 'timeout' : 'service_unavailable');
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
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
};
