/**
 * 團練場出席管理 — controlled DB boundary, not feature readiness.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */
import type { Pool, PoolClient } from 'pg';
import { withRequestContext } from './request-context.js';

export const VENUE_ATTENDANCE_PERMISSIONS = Object.freeze({
  'field.read': 'venue_attendance.field.read',
  'field.write': 'venue_attendance.field.manage',
  'attendance.read': 'venue_attendance.attendance.read',
  'attendance.export': 'venue_attendance.attendance.export'
} as const);
export const VENUE_ATTENDANCE_TIME_ZONE = 'Asia/Taipei';

export interface LineLearnerIdentityMapping {
  readonly subject: string;
  readonly identityId: string;
  readonly personId: string;
  readonly revoked: false;
  readonly learnerActive: true;
  readonly channelActive: true;
  readonly applicationApproved: true;
}

export type VenueAttendanceAdminOperation =
  | { readonly operation: 'field.read'; readonly regionId: string }
  | {
      readonly operation: 'field.write';
      readonly regionId: string;
      readonly fieldId: string;
      readonly change: { readonly nameZhTw: string; readonly isActive: boolean };
    }
  | {
      readonly operation: 'attendance.read' | 'attendance.export';
      readonly regionId: string;
      /** Half-open dates in Asia/Taipei, at most 366 days. */
      readonly from: string;
      readonly until: string;
    };

// Deliberately NO success branch: 0048 is still in force. Unexpected SQL success
// is a contract failure, not permission to expose data or pretend a write happened.
export interface VenueAttendanceAdminDenied {
  readonly ok: false;
  readonly error:
    'invalid_request' | 'unauthenticated' | 'forbidden' | 'quarantined' | 'unavailable';
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lineSubject = /^U[0-9a-f]{32}$/;
const invalidInput = () => new Error('invalid venue attendance input');
const invalidContract = () => new Error('invalid venue attendance database contract');
const record = (input: unknown): Record<string, unknown> => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw invalidInput();
  return input as Record<string, unknown>;
};
const exactKeys = (input: Record<string, unknown>, keys: readonly string[]) => {
  if (Object.keys(input).length !== keys.length || !keys.every((key) => Object.hasOwn(input, key)))
    throw invalidInput();
};
const requireUuid = (value: unknown): string => {
  if (typeof value !== 'string' || !uuid.test(value)) throw invalidInput();
  return value;
};
const dateMillis = (input: unknown): number => {
  if (
    typeof input !== 'string' ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input) ||
    input.startsWith('0000-')
  )
    throw invalidInput();
  const millis = Date.parse(`${input}T00:00:00Z`);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== input)
    throw invalidInput();
  return millis;
};

export const parseVenueAttendanceAdminOperation = (
  input: unknown
): VenueAttendanceAdminOperation => {
  const value = record(input);
  const regionId = requireUuid(value.regionId);
  switch (value.operation) {
    case 'field.read':
      exactKeys(value, ['operation', 'regionId']);
      return Object.freeze({ operation: value.operation, regionId });
    case 'field.write': {
      exactKeys(value, ['operation', 'regionId', 'fieldId', 'change']);
      const fieldId = requireUuid(value.fieldId);
      const change = record(value.change);
      exactKeys(change, ['nameZhTw', 'isActive']);
      if (
        typeof change.nameZhTw !== 'string' ||
        [...change.nameZhTw.trim()].length < 1 ||
        [...change.nameZhTw.trim()].length > 120 ||
        change.nameZhTw.includes('\u0000') ||
        typeof change.isActive !== 'boolean'
      )
        throw invalidInput();
      return Object.freeze({
        operation: value.operation,
        regionId,
        fieldId,
        change: Object.freeze({ nameZhTw: change.nameZhTw.trim(), isActive: change.isActive })
      });
    }
    case 'attendance.read':
    case 'attendance.export': {
      exactKeys(value, ['operation', 'regionId', 'from', 'until']);
      const from = dateMillis(value.from);
      const until = dateMillis(value.until);
      if (until <= from || until - from > 366 * 86_400_000) throw invalidInput();
      // dateMillis validated these strings; retain their exact canonical date form.
      return Object.freeze({
        operation: value.operation,
        regionId,
        from: new Date(from).toISOString().slice(0, 10),
        until: new Date(until).toISOString().slice(0, 10)
      });
    }
    default:
      throw invalidInput();
  }
};

/**
 * Adapter-compatible resolver. The server MUST verify the LINE credential first;
 * format validation is not authentication. No token verification/network here.
 * Only call on the runtime client inside withRequestContext({ requestId }), with
 * person/principal cleared. This snapshot is NOT a check-in authorization.
 */
export const resolveLineLearnerIdentity = async (
  client: Pick<PoolClient, 'query'>,
  verifiedSubject: string
): Promise<LineLearnerIdentityMapping | null> => {
  if (typeof verifiedSubject !== 'string' || !lineSubject.test(verifiedSubject))
    throw invalidInput();
  const result = await client.query<{ data: unknown }>(
    'SELECT platform.resolve_line_learner_identity($1) AS data',
    [verifiedSubject]
  );
  if (result.rows.length !== 1) throw invalidContract();
  const data = result.rows[0]?.data;
  if (data === null) return null;
  try {
    const mapping = record(data);
    exactKeys(mapping, [
      'subject',
      'identityId',
      'personId',
      'revoked',
      'learnerActive',
      'channelActive',
      'applicationApproved'
    ]);
    const identityId = requireUuid(mapping.identityId);
    const personId = requireUuid(mapping.personId);
    if (
      mapping.subject !== verifiedSubject ||
      mapping.revoked !== false ||
      mapping.learnerActive !== true ||
      mapping.channelActive !== true ||
      mapping.applicationApproved !== true
    )
      throw invalidContract();
    return Object.freeze({
      subject: verifiedSubject,
      identityId,
      personId,
      revoked: false,
      learnerActive: true,
      channelActive: true,
      applicationApproved: true
    });
  } catch {
    throw invalidContract();
  }
};

/**
 * Server-owned admin boundary, not a route. sessionToken must come from existing
 * authenticated admin session handling (and HTTP writes still require CSRF).
 * No caller-supplied person/principal/volunteer can establish request context.
 * No pool.query bootstrap, logs, privileged fallback, or table queries.
 */
export const runVenueAttendanceAdminOperation = async (
  pool: Pool,
  requestId: string,
  sessionToken: string,
  input: unknown
): Promise<VenueAttendanceAdminDenied> => {
  let operation: VenueAttendanceAdminOperation;
  try {
    requireUuid(requestId);
    operation = parseVenueAttendanceAdminOperation(input);
  } catch {
    return { ok: false, error: 'invalid_request' };
  }
  if (typeof sessionToken !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(sessionToken))
    return { ok: false, error: 'unauthenticated' };
  try {
    return await withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId },
      async (client): Promise<VenueAttendanceAdminDenied> => {
        const session = await client.query<{ principal_id: unknown }>(
          'SELECT admin.session_principal($1) AS principal_id',
          [sessionToken]
        );
        if (session.rows.length !== 1) throw invalidContract();
        const principalId = session.rows[0]?.principal_id;
        if (principalId === null) return { ok: false, error: 'unauthenticated' };
        requireUuid(principalId);
        await client.query("SELECT set_config('qigong.principal_id', $1, TRUE)", [principalId]);
        switch (operation.operation) {
          case 'field.read':
            await client.query('SELECT admin.venue_attendance_read_fields($1, $2) AS data', [
              sessionToken,
              operation.regionId
            ]);
            break;
          case 'field.write':
            await client.query(
              'SELECT admin.venue_attendance_write_field($1, $2, $3, $4) AS data',
              [
                sessionToken,
                operation.regionId,
                operation.fieldId,
                JSON.stringify(operation.change)
              ]
            );
            break;
          case 'attendance.read':
          case 'attendance.export':
            await client.query(
              'SELECT admin.venue_attendance_read_attendance($1, $2, $3, $4, $5) AS data',
              [
                sessionToken,
                operation.regionId,
                operation.from,
                operation.until,
                operation.operation === 'attendance.export'
              ]
            );
        }
        throw invalidContract();
      }
    );
  } catch (error) {
    // Only fixed SQLSTATE + message pairs can classify a denial. Never echo DB
    // diagnostics, credentials, field names, request bodies or other private data.
    if (error instanceof Error && 'code' in error) {
      if (error.code === '42501' && error.message === 'venue_attendance_forbidden')
        return { ok: false, error: 'forbidden' };
      if (error.code === '55000' && error.message === 'venue_attendance_quarantined')
        return { ok: false, error: 'quarantined' };
      if (error.code === '22023' && error.message === 'venue_attendance_invalid_input')
        return { ok: false, error: 'invalid_request' };
    }
    return { ok: false, error: 'unavailable' };
  }
};

/** Pure reporting rule for ONE already-authorized learner; never an access check. */
export const countVenueAttendanceDays = (instants: readonly string[]): number => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: VENUE_ATTENDANCE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return new Set(
    instants.map((instant) => {
      if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(instant))
        throw invalidInput();
      dateMillis(instant.slice(0, 10));
      const date = new Date(instant);
      if (!Number.isFinite(date.getTime())) throw invalidInput();
      return formatter.format(date);
    })
  ).size;
};
