/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */
import {
  parseVenueAttendanceAdminOperation,
  type VenueAttendanceAdminDenied,
  type VenueAttendanceAdminOperation
} from '@qigong/database';

export type VenueAdminDenial =
  VenueAttendanceAdminDenied | { readonly ok: false; readonly error: 'invalid_csrf' };

/** Server-only capability, bound by admin-auth to ONE request. Never accepts identity. */
export type VenueAdminExecute = (
  operation: VenueAttendanceAdminOperation
) => Promise<VenueAdminDenial>;

export interface VenueAdminResponse {
  readonly status: 400 | 401 | 403 | 503;
  readonly body: { readonly error: VenueAdminDenial['error'] };
}

export interface VenueAdminService {
  execute(input: unknown): Promise<VenueAdminResponse>;
}

const response = (
  status: VenueAdminResponse['status'],
  error: VenueAdminDenial['error']
): VenueAdminResponse => Object.freeze({ status, body: Object.freeze({ error }) });

/**
 * No HTTP, cookies, pool, cached principal/capability, logging or success adapter.
 * The injected closure must revalidate the real session and action + region for
 * every call. The existing runner/0049 contract owns transaction + authorization.
 * Unexpected dependency success/output is unavailable, never data or fake CRUD.
 */
export const createVenueAdminService = (execute: VenueAdminExecute): VenueAdminService =>
  Object.freeze({
    async execute(input: unknown): Promise<VenueAdminResponse> {
      let operation: VenueAttendanceAdminOperation;
      try {
        operation = parseVenueAttendanceAdminOperation(input);
      } catch {
        return response(400, 'invalid_request');
      }
      try {
        const result = await execute(operation);
        if (result.ok !== false) return response(503, 'unavailable');
        switch (result.error) {
          case 'invalid_request':
            return response(400, 'invalid_request');
          case 'unauthenticated':
            return response(401, 'unauthenticated');
          case 'forbidden':
          case 'invalid_csrf':
            return response(403, result.error);
          case 'quarantined':
            return response(503, 'quarantined');
          default:
            return response(503, 'unavailable');
        }
      } catch {
        return response(503, 'unavailable');
      }
    }
  });
