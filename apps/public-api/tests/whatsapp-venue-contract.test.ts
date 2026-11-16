import { describe, expect, it } from 'vitest';
import {
  whatsappVenueCheckinInputSchema,
  whatsappVenueHistoryInputSchema,
  whatsappVenueHistorySchema,
  whatsappVenueReceiptSchema
} from '../src/whatsapp-venue-contract.js';

const input = { venue: 'my-demo-hall', latitude: 3.139, longitude: 101.6869 };
const receipt = {
  ok: true,
  venue: { code: 'my-demo-hall', name: '示範場地', timezone: 'Asia/Kuala_Lumpur' },
  checkedInAt: '2026-11-16T16:15:00Z',
  attendanceDate: '2026-11-17',
  replayed: false
};
const history = {
  ok: true,
  dateBasis: 'venue_local_date',
  totals: { attendanceCount: 1, attendanceDays: 1, monthCount: 1 },
  page: 1,
  pageSize: 20,
  hasMore: false,
  entries: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      venueCode: receipt.venue.code,
      venueName: receipt.venue.name,
      checkedInAt: receipt.checkedInAt,
      venueLocalDate: receipt.attendanceDate,
      venueTimezone: receipt.venue.timezone
    }
  ]
};

describe('planned WhatsApp venue transport contracts (not authentication)', () => {
  it('accepts only bounded location and a venue code for a write', () => {
    expect(whatsappVenueCheckinInputSchema.parse(input)).toEqual(input);
  });
  it.each([
    { token: 'opaque-token' },
    { session: 'opaque-session' },
    { csrf: 'opaque-csrf' },
    { idToken: 'line-token' },
    { subject: 'another-subject' },
    { personId: 'another-person' },
    { channel: 'line' },
    { isTest: true },
    { debugToken: 'distance-bypass' },
    { source: 'nfc' },
    { atTime: '2026-11-16T00:00:00Z' },
    { venue: 'my-demo-hall\n' },
    { latitude: NaN },
    { latitude: Infinity },
    { longitude: -Infinity },
    { latitude: 90.0001 },
    { longitude: -180.0001 },
    { latitude: '3.139' }
  ])('rejects client authority and invalid coordinate fields: %j', (value) => {
    expect(whatsappVenueCheckinInputSchema.safeParse({ ...input, ...value }).success).toBe(false);
  });

  it('history defaults page but does not accept an identity or test view', () => {
    expect(whatsappVenueHistoryInputSchema.parse({})).toEqual({ page: 1 });
    expect(
      whatsappVenueHistoryInputSchema.parse({ month: '2026-11', venue: 'hk-demo-hall', page: 2 })
    ).toEqual({ month: '2026-11', venue: 'hk-demo-hall', page: 2 });
  });
  it.each([
    { personId: 'someone-else' },
    { token: 'legacy-token' },
    { view: 'test' },
    { timezone: 'Asia/Taipei' },
    { month: '0000-01' },
    { month: '2026-13' },
    { month: '2026-11\n' },
    { month: '2026-11\r' },
    { month: '2026-11\r\n' },
    { month: '2026-11\u2028' },
    { month: '2026-11\u2029' },
    { page: 0 },
    { page: 1.5 },
    { page: 10001 },
    { page: '1' }
  ])('rejects unbounded or authority-bearing history request: %j', (value) => {
    expect(whatsappVenueHistoryInputSchema.safeParse(value).success).toBe(false);
  });

  it.each(['Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Hong_Kong'])(
    'keeps the stored local date rather than UTC for %s',
    (timezone) => {
      const value = { ...receipt, venue: { ...receipt.venue, timezone } };
      expect(whatsappVenueReceiptSchema.safeParse(value).success).toBe(true);
      expect(
        whatsappVenueReceiptSchema.safeParse({ ...value, attendanceDate: '2026-11-16' }).success
      ).toBe(false);
    }
  );
  it.each([
    { isTest: true, verificationMode: 'distance_debug' },
    { isTest: false },
    { venue: { ...receipt.venue, timezone: 'invalid/zone' } },
    { venue: { ...receipt.venue, code: 'MY-DEMO-HALL' } },
    { attendanceDate: '2026-02-30' },
    { checkedInAt: 'bad-stamp' }
  ])('rejects test or malformed receipts: %j', (value) => {
    expect(whatsappVenueReceiptSchema.safeParse({ ...receipt, ...value }).success).toBe(false);
  });

  it('accepts original stored replay timestamps without inventing a new write', () => {
    expect(whatsappVenueReceiptSchema.parse({ ...receipt, replayed: true }).checkedInAt).toBe(
      receipt.checkedInAt
    );
  });

  it('makes the history calendar explicit and preserves venue-local dates', () => {
    expect(whatsappVenueHistorySchema.parse(history).dateBasis).toBe('venue_local_date');
  });
  it.each([
    { timezone: 'Asia/Taipei' },
    { dateBasis: 'utc' },
    { totals: { attendanceCount: 1, attendanceDays: 2, monthCount: 1 } },
    { entries: Array.from({ length: 21 }, () => history.entries[0]) },
    { entries: [{ ...history.entries[0], isTest: true }] },
    { entries: [{ ...history.entries[0], venueLocalDate: '2026-11-16' }] },
    { entries: [{ ...history.entries[0], venueTimezone: 'bad/zone' }] }
  ])('rejects ambiguous, test or inconsistent history responses: %j', (value) => {
    expect(whatsappVenueHistorySchema.safeParse({ ...history, ...value }).success).toBe(false);
  });
});
