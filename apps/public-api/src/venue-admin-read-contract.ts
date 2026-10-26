/**
 * Scoped read/export DTOs. Shape validation is not authorization.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */
import { z } from 'zod';

export const venueExportMaximumRows = 1000;
const date = z.iso.date().refine((value) => value >= '0001-01-01' && value <= '9999-12-31');
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const page = z.number().int().min(1).max(10000);
const limit = z.number().int().min(1).max(100);
const text = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim() === value && !/[\p{Cc}]/u.test(value));
const method = z.enum(['nfc_gps', 'qr_gps', 'volunteer_manual']);
const filters = z
  .object({ fieldId: z.uuid().nullable(), method: method.nullable() })
  .strict()
  .readonly();
const attendanceSelector = {
  regionId: z.uuid(),
  from: date,
  until: date,
  filters
};

const requestSchema = z
  .discriminatedUnion('operation', [
    z
      .object({ operation: z.literal('field.read'), regionId: z.uuid(), page, limit })
      .strict()
      .readonly(),
    z
      .object({ operation: z.literal('attendance.read'), ...attendanceSelector, page, limit })
      .strict()
      .readonly(),
    z
      .object({ operation: z.literal('attendance.export'), ...attendanceSelector })
      .strict()
      .readonly()
  ])
  .refine((value) => {
    if (value.operation === 'field.read') return true;
    const days =
      (Date.parse(`${value.until}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86400000;
    return days > 0 && days <= 366;
  });

export type VenueReadRequest = z.infer<typeof requestSchema>;
/** No defaults, coercion, aliases, principal, credential, person or arbitrary filter. */
export const parseVenueReadRequest = (input: unknown): VenueReadRequest =>
  requestSchema.parse(input);

const fieldShape = { fieldId: z.uuid(), code: text(80), nameZhTw: text(120) };
const field = z
  .object({ ...fieldShape, isActive: z.boolean() })
  .strict()
  .readonly();
const attendanceField = z.object(fieldShape).strict().readonly();
const row = z
  .object({
    date,
    learnerName: text(120).nullable(),
    field: attendanceField,
    method,
    distanceMeters: z.number().finite().min(0).max(999999.99).nullable()
  })
  .strict()
  .readonly();
const totals = z
  .object({ attendanceCount: count, attendanceDays: count.max(366), learnerCount: count })
  .strict()
  .readonly();
const attendanceData = {
  ...attendanceSelector,
  timezone: z.literal('venue-local'),
  nameVisibility: z.enum(['visible', 'redacted']),
  totals
};
const availableSchema = z.discriminatedUnion('operation', [
  z
    .object({
      version: z.literal(1),
      state: z.literal('available'),
      operation: z.literal('field.read'),
      regionId: z.uuid(),
      page,
      limit,
      total: count,
      fields: z.array(field).max(100).readonly()
    })
    .strict()
    .readonly(),
  z
    .object({
      version: z.literal(1),
      state: z.literal('available'),
      operation: z.literal('attendance.read'),
      ...attendanceData,
      page,
      limit,
      rows: z.array(row).max(100).readonly()
    })
    .strict()
    .readonly(),
  z
    .object({
      version: z.literal(1),
      state: z.literal('available'),
      operation: z.literal('attendance.export'),
      ...attendanceData,
      rowCount: count.max(venueExportMaximumRows),
      rows: z.array(row).max(venueExportMaximumRows).readonly()
    })
    .strict()
    .readonly()
]);
const noDataSchema = z
  .object({
    version: z.literal(1),
    state: z.enum(['suppressed', 'unavailable'])
  })
  .strict()
  .readonly();
export type VenueReadAvailable = z.infer<typeof availableSchema>;
export type VenueReadResult = VenueReadAvailable | z.infer<typeof noDataSchema>;
const unavailable = (): VenueReadResult => Object.freeze({ version: 1, state: 'unavailable' });

/**
 * Server-owned release decision; never take it from query/body/DB JSON.
 * Existing scoped view access includes learner names. No extra name permission,
 * minimum group size or anti-differencing policy is required by the product.
 * This decoder cannot prove RLS, distinct-person totals, audit or authority.
 */
export const decodeVenueReadResult = (
  input: unknown,
  expected: VenueReadRequest,
  names: 'visible' | 'redacted' = 'visible'
): VenueReadResult => {
  try {
    const request = requestSchema.parse(expected);
    const noData = noDataSchema.safeParse(input);
    if (noData.success)
      return noData.data.state === 'suppressed' && request.operation === 'field.read'
        ? unavailable()
        : noData.data;
    const data = availableSchema.parse(input);
    if (data.operation !== request.operation || data.regionId !== request.regionId)
      return unavailable();
    if (data.operation === 'field.read' && request.operation === 'field.read') {
      const remaining = Math.max(0, data.total - (request.page - 1) * request.limit);
      if (
        data.page !== request.page ||
        data.limit !== request.limit ||
        data.fields.length !== Math.min(request.limit, remaining) ||
        new Set(data.fields.map((item) => item.fieldId)).size !== data.fields.length
      )
        return unavailable();
      return data;
    }
    if (data.operation === 'field.read' || request.operation === 'field.read') return unavailable();
    if (
      data.from !== request.from ||
      data.until !== request.until ||
      data.filters.fieldId !== request.filters.fieldId ||
      data.filters.method !== request.filters.method ||
      data.nameVisibility !== names
    )
      return unavailable();
    const { attendanceCount, attendanceDays, learnerCount } = data.totals;
    const rangeDays =
      (Date.parse(`${request.until}T00:00:00Z`) - Date.parse(`${request.from}T00:00:00Z`)) /
      86400000;
    if (
      attendanceDays > rangeDays ||
      attendanceDays > attendanceCount ||
      learnerCount > attendanceCount ||
      (attendanceCount === 0) !== (learnerCount === 0) ||
      (attendanceCount === 0) !== (attendanceDays === 0)
    )
      return unavailable();
    if (data.operation === 'attendance.read' && request.operation === 'attendance.read') {
      const remaining = Math.max(0, attendanceCount - (request.page - 1) * request.limit);
      if (
        data.page !== request.page ||
        data.limit !== request.limit ||
        data.rows.length !== Math.min(request.limit, remaining)
      )
        return unavailable();
    } else if (
      data.operation === 'attendance.export' &&
      request.operation === 'attendance.export'
    ) {
      if (data.rowCount !== attendanceCount || data.rows.length !== data.rowCount)
        return unavailable();
    } else return unavailable();
    for (const item of data.rows) {
      if (
        item.date < request.from ||
        item.date >= request.until ||
        (request.filters.fieldId !== null && item.field.fieldId !== request.filters.fieldId) ||
        (request.filters.method !== null && item.method !== request.filters.method) ||
        (names === 'redacted' ? item.learnerName !== null : item.learnerName === null)
      )
        return unavailable();
    }
    // Distinct-person and same-person/day uniqueness are NOT inferable from these DTOs.
    const visibleDays = new Set(data.rows.map((item) => item.date)).size;
    const complete = data.operation === 'attendance.export' || data.rows.length === attendanceCount;
    if (visibleDays > attendanceDays || (complete && visibleDays !== attendanceDays))
      return unavailable();
    return data;
  } catch {
    // Never return Zod/DB diagnostics, arbitrary JSON or a partial successful export.
    return unavailable();
  }
};
