/** Planned WhatsApp venue API data contracts only. No authentication, routes or writes.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { z } from 'zod';
import { venueEntryCodeSchema } from './venue-entry-guidance.js';
import { venueQrSuccessSchema } from './venue-qr.js';

/** Session and CSRF belong to checked cookies/headers, never JSON body credentials.
 * source, personId, request clock and debug fields cannot grant attendance authority. */
export const whatsappVenueCheckinInputSchema = z.strictObject({
  venue: venueEntryCodeSchema,
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180)
});
export const whatsappVenueHistoryInputSchema = z.strictObject({
  month: z
    .string()
    .length(7)
    .regex(/^(?!0000)[0-9]{4}-(?:0[1-9]|1[0-2])$/)
    .optional(),
  venue: venueEntryCodeSchema.optional(),
  page: z.number().int().min(1).max(10000).default(1)
});

const venueLocalDate = (stamp: string, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(stamp));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const validStampDate = (stamp: string, timezone: string, date: string) => {
  try {
    return venueLocalDate(stamp, timezone) === date;
  } catch {
    return false;
  }
};

/** Formal-only transport schema, not proof of a DB save or of the caller's identity.
 * Future adapters must ALSO bind venue.code to the requested venue in the same request. */
export const whatsappVenueReceiptSchema = venueQrSuccessSchema.options[0].superRefine(
  (receipt, context) => {
    if (!venueEntryCodeSchema.safeParse(receipt.venue.code).success)
      context.addIssue({ code: 'custom', path: ['venue', 'code'], message: 'Invalid venue code' });
    if (!validStampDate(receipt.checkedInAt, receipt.venue.timezone, receipt.attendanceDate))
      context.addIssue({
        code: 'custom',
        path: ['attendanceDate'],
        message: 'Venue-local date mismatch'
      });
  }
);
const count = z.number().int().nonnegative();
const entry = z.strictObject({
  id: z.uuid(),
  venueCode: venueEntryCodeSchema,
  venueName: z.string().min(1).max(120),
  checkedInAt: z.iso.datetime({ offset: true }),
  venueLocalDate: z.iso.date(),
  venueTimezone: z.string().min(1).max(100)
});
/** No Taipei-only aggregate timezone: month/day counts use stored venue-local dates.
 * This additive WhatsApp contract does not change the existing LINE history contract. */
export const whatsappVenueHistorySchema = z
  .strictObject({
    ok: z.literal(true),
    dateBasis: z.literal('venue_local_date'),
    totals: z.strictObject({ attendanceCount: count, attendanceDays: count, monthCount: count }),
    page: z.number().int().min(1).max(10000),
    pageSize: z.literal(20),
    hasMore: z.boolean(),
    entries: z.array(entry).max(20)
  })
  .superRefine((history, context) => {
    if (
      history.totals.attendanceDays > history.totals.attendanceCount ||
      history.totals.monthCount > history.totals.attendanceCount
    )
      context.addIssue({
        code: 'custom',
        path: ['totals'],
        message: 'Inconsistent attendance counts'
      });
    history.entries.forEach((value, index) => {
      if (!validStampDate(value.checkedInAt, value.venueTimezone, value.venueLocalDate))
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'venueLocalDate'],
          message: 'Venue-local date mismatch'
        });
    });
  });
export type WhatsAppVenueCheckinInput = z.infer<typeof whatsappVenueCheckinInputSchema>;
export type WhatsAppVenueHistoryInput = z.infer<typeof whatsappVenueHistoryInputSchema>;
export type WhatsAppVenueReceipt = z.infer<typeof whatsappVenueReceiptSchema>;
export type WhatsAppVenueHistory = z.infer<typeof whatsappVenueHistorySchema>;
