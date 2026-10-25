import { z } from 'zod';

const id = z.uuid();
export const venueManualDateSchema = z.iso.date().refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const reason = z.string().trim().min(1).max(1000);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const label = z.string().trim().min(1).max(200);
const timezone = z
  .string()
  .min(1)
  .max(100)
  .regex(/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });

export const venueManualLearnerSchema = z.strictObject({
  id,
  displayName: label,
  regionLabel: label
});
export const venueManualVenueSchema = z.strictObject({ id, displayName: label, timezone });
export const venueManualRecordSchema = z.strictObject({
  id,
  version,
  learnerId: id,
  venueId: id,
  attendanceDate: venueManualDateSchema,
  attendanceTimezone: timezone,
  status: z.enum(['active', 'voided'])
});
export const venueManualServerModelSchema = z
  .strictObject({
    capabilities: z.strictObject({
      canSearchLearners: z.boolean(),
      canReadRecords: z.boolean(),
      canManual: z.boolean(),
      canVoid: z.boolean()
    }),
    venues: z.array(venueManualVenueSchema).max(200),
    minDate: venueManualDateSchema,
    maxDate: venueManualDateSchema
  })
  .refine(
    (model) =>
      model.minDate <= model.maxDate &&
      new Set(model.venues.map((venue) => venue.id)).size === model.venues.length
  );

export const venueManualSelectionSchema = z.strictObject({
  learnerId: id,
  venueId: id,
  attendanceDate: venueManualDateSchema
});
export const venueManualSearchSchema = z.strictObject({ query: z.string().trim().min(2).max(80) });
export const venueManualDraftSchema = venueManualSelectionSchema.extend({ reason });
export const venueManualVoidDraftSchema = z.strictObject({
  recordId: id,
  expectedVersion: version,
  reason
});
export const venueManualRequestSchema = z.discriminatedUnion('operation', [
  venueManualDraftSchema.extend({ operation: z.literal('manual'), idempotencyKey: id }),
  venueManualVoidDraftSchema.extend({ operation: z.literal('void'), idempotencyKey: id })
]);
export const venueManualConfirmationSchema = z.strictObject({
  confirmed: z.literal(true),
  secondConfirmed: z.boolean()
});
export const venueManualLookupSchema = z
  .strictObject({
    learners: z.array(venueManualLearnerSchema).max(50)
  })
  .refine(
    ({ learners }) => new Set(learners.map((learner) => learner.id)).size === learners.length
  );
export const venueManualRecordsSchema = z
  .strictObject({
    records: z.array(venueManualRecordSchema).max(100)
  })
  .refine(({ records }) => new Set(records.map((record) => record.id)).size === records.length);
export const venueManualOutcomeSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('applied'),
    operation: z.enum(['manual', 'void']),
    idempotencyKey: id,
    record: venueManualRecordSchema
  }),
  z.strictObject({
    status: z.literal('rejected'),
    code: z.enum(['unauthenticated', 'forbidden', 'conflict', 'unavailable', 'invalid'])
  })
]);

export type VenueManualServerModel = z.infer<typeof venueManualServerModelSchema>;
export type VenueManualLearner = z.infer<typeof venueManualLearnerSchema>;
export type VenueManualVenue = z.infer<typeof venueManualVenueSchema>;
export type VenueManualRecord = z.infer<typeof venueManualRecordSchema>;
export type VenueManualSelection = z.infer<typeof venueManualSelectionSchema>;
export type VenueManualRequest = z.infer<typeof venueManualRequestSchema>;

/** A composition-root dependency, never discovered from browser flags, URLs or storage.
 * This is NOT an authorization credential. The eventual server must authorize every call.
 * No default network implementation is supplied in this work package.
 */
export interface TrustedVenueManualAdapter {
  readonly kind: 'trusted-venue-manual-adapter';
  searchLearners(query: Readonly<{ query: string }>): Promise<unknown>;
  readRecords(selection: Readonly<VenueManualSelection>): Promise<unknown>;
  operate(
    request: Readonly<VenueManualRequest>,
    context: Readonly<{
      credentials: 'same-origin';
      headers: Readonly<{ 'x-csrf-token': string }>;
    }>
  ): Promise<unknown>;
}

/** Mirrors admin-auth.ts's cookie/header names. Server equality/session checks remain mandatory. */
export const venueManualCsrfToken = (cookie: string): string | null => {
  const values = cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('__Host-qigong-admin-csrf='));
  if (values.length !== 1) return null;
  const value = values[0]!.slice('__Host-qigong-admin-csrf='.length);
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
};
