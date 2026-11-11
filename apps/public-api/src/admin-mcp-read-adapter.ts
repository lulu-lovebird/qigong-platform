/**
 * Internal dispatcher -> bounded read service bridge, NOT a database/OAuth/HTTP adapter.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 */
import type { AdminMcpReadCall } from './admin-mcp-contract.js';
import {
  AdminMcpReadAdapterFailure,
  type AdminMcpReadAdapter,
  type AdminMcpReadContext
} from './admin-mcp-dispatch.js';
import { adminMcpImplementedReadTools } from './admin-mcp-read-model.js';
import {
  createAdminMcpReadService,
  type TrustedAdminMcpReadAdapter
} from './admin-mcp-read-service.js';

/**
 * Explicit trusted-backend injection only. This factory does not create a production
 * backend, authenticate claims, enable tools, mount routes or reuse browser sessions.
 * The dispatcher still requires explicit enabledTools, a current verifier and a budget.
 */
export const createAdminMcpReadServiceAdapter = (
  backend: TrustedAdminMcpReadAdapter
): AdminMcpReadAdapter => {
  const service = createAdminMcpReadService(backend);
  return Object.freeze({
    supportedTools: adminMcpImplementedReadTools,
    async execute(call: AdminMcpReadCall, context: AdminMcpReadContext) {
      if (
        call.tool !== 'guidance_list' &&
        call.tool !== 'guidance_get' &&
        call.tool !== 'venues_list'
      )
        throw new AdminMcpReadAdapterFailure('tool_unavailable');
      const result = await service.read(call, context);
      if (!result.ok) throw new AdminMcpReadAdapterFailure(result.error.code);
      return Object.freeze({
        data: result.data,
        asOf: result.asOf,
        nextCursor: result.nextCursor,
        truncated: result.truncated,
        warnings: result.warnings
      });
    }
  });
};
