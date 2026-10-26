/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { describe, expect, it, vi } from 'vitest';
import {
  decodeVenueReadResult,
  parseVenueReadRequest,
  venueExportMaximumRows
} from '../src/venue-admin-read-contract.js';
import { createVenueAdminService, type VenueAdminDenial } from '../src/venue-admin-service.js';

const regionId = '10000000-0000-4000-8000-000000000001';
const fieldId = '20000000-0000-4000-8000-000000000001';
const otherId = '30000000-0000-4000-8000-000000000001';
const filters = { fieldId: null, method: null };
const selector = { regionId, from: '2026-10-01', until: '2026-11-01', filters };
const readInput = { operation: 'attendance.read', ...selector, page: 1, limit: 20 };
const read = parseVenueReadRequest(readInput);
const fieldsInput = { operation: 'field.read', regionId, page: 1, limit: 20 };
const fields = parseVenueReadRequest(fieldsInput);
const exporting = parseVenueReadRequest({ operation: 'attendance.export', ...selector });
const unavailable = { version: 1, state: 'unavailable' };
const entry = () => ({
  date: '2026-10-25',
  learnerName: '學員' as string | null,
  field: { fieldId, code: 'TPE-01', nameZhTw: '團練場' },
  method: 'nfc_gps',
  distanceMeters: 12.34 as number | null
});
const attendance = () => ({
  version: 1,
  state: 'available',
  operation: 'attendance.read',
  ...selector,
  timezone: 'venue-local',
  nameVisibility: 'visible',
  totals: { attendanceCount: 5, attendanceDays: 1, learnerCount: 5 },
  page: 1,
  limit: 20,
  rows: Array.from({ length: 5 }, entry)
});
const exported = () => {
  const { page: _page, limit: _limit, ...data } = attendance();
  void _page;
  void _limit;
  return { ...data, operation: 'attendance.export', rowCount: 5 };
};
const fieldData = () => ({
  version: 1,
  state: 'available',
  operation: 'field.read',
  regionId,
  page: 1,
  limit: 20,
  total: 1,
  fields: [{ fieldId, code: 'TPE-01', nameZhTw: '團練場', isActive: false }]
});

const rejects = (value: unknown) => expect(decodeVenueReadResult(value, read)).toEqual(unavailable);

describe('dormant forward request contract', () => {
  it('parses immutable, explicit selectors without defaults', () => {
    const parsed = parseVenueReadRequest(readInput);
    expect(parsed).toEqual(readInput);
    expect(parsed).not.toBe(readInput);
    expect(Object.isFrozen(parsed)).toBe(true);
    if (parsed.operation !== 'field.read') expect(Object.isFrozen(parsed.filters)).toBe(true);
    expect(parseVenueReadRequest(fieldsInput)).toEqual(fieldsInput);
    expect(exporting.operation).toBe('attendance.export');
  });
  it.each([
    { ...readInput, from: '2024-01-01', until: '2025-01-01' },
    { ...readInput, from: '2024-02-29', until: '2024-03-01' },
    { ...readInput, from: '2026-10-25', until: '2026-10-26' },
    { ...readInput, filters: { fieldId, method: 'volunteer_manual' } }
  ])('accepts canonical half-open ranges and allowlisted filters: %j', (input) => {
    expect(parseVenueReadRequest(input)).toEqual(input);
  });
  it.each([
    { ...readInput, from: '2024-01-01', until: '2025-01-02' },
    { ...readInput, until: readInput.from },
    { ...readInput, until: '2026-09-01' },
    { ...readInput, from: '2026-02-29' },
    { ...readInput, from: '0000-01-01' },
    { ...readInput, from: '2026-10-01T00:00:00+08:00' },
    { ...readInput, regionId: undefined },
    { ...readInput, regionId: 'global' },
    { ...readInput, page: '1' },
    { ...readInput, page: 0 },
    { ...readInput, limit: 101 },
    { ...readInput, filters: {} },
    { ...readInput, filters: { ...filters, personId: otherId } },
    { ...readInput, filters: { ...filters, method: 'all' } },
    { ...readInput, principalId: otherId },
    { ...readInput, sessionToken: 'do-not-return' },
    { ...readInput, names: true },
    { ...readInput, month: '2026-10' },
    { ...readInput, operation: 'attendance.export' }, // export cannot silently ignore pagination
    { ...readInput, operation: 'field.write' }
  ])('rejects unsupported or ambiguous request: %j', (input) => {
    expect(() => parseVenueReadRequest(input)).toThrow();
  });
});

describe('strict successful DTO decoding, not authorization', () => {
  it('returns cloned, deeply frozen minimal fields and read records', () => {
    const original = attendance();
    const decoded = decodeVenueReadResult(original, read);
    expect(decoded).toEqual(original);
    expect(decoded).not.toBe(original);
    if (decoded.state !== 'available' || decoded.operation !== 'attendance.read')
      throw new Error('fixture');
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.rows)).toBe(true);
    expect(Object.isFrozen(decoded.rows[0])).toBe(true);
    expect(Object.isFrozen(decoded.rows[0]?.field)).toBe(true);
    expect(Object.isFrozen(decoded.totals)).toBe(true);
    original.rows[0]!.field.nameZhTw = 'changed';
    expect(decoded.rows[0]?.field.nameZhTw).toBe('團練場');
    expect(decodeVenueReadResult(fieldData(), fields)).toEqual(fieldData());
  });
  it('accepts complete bounded export, never arbitrary CSV/JSON', () => {
    expect(decodeVenueReadResult(exported(), exporting)).toEqual(exported());
    expect(venueExportMaximumRows).toBe(1000);
    expect(decodeVenueReadResult(attendance(), exporting)).toEqual(unavailable);
    expect(decodeVenueReadResult(exported(), read)).toEqual(unavailable);
  });
  it('includes names under existing scoped view access, even for one learner', () => {
    const single = {
      ...attendance(),
      totals: { attendanceCount: 1, attendanceDays: 1, learnerCount: 1 },
      rows: [entry()]
    };
    expect(decodeVenueReadResult(single, read)).toEqual(single);
    expect(decodeVenueReadResult(single, read, 'redacted')).toEqual(unavailable);
    const redacted = {
      ...single,
      nameVisibility: 'redacted',
      rows: [{ ...entry(), learnerName: null }]
    };
    expect(decodeVenueReadResult(redacted, read, 'redacted')).toEqual(redacted);
    expect(decodeVenueReadResult(redacted, read)).toEqual(unavailable);
  });
  it('supports actual authorized empty sets, but never manufactures them on failure', () => {
    const empty = {
      ...attendance(),
      totals: { attendanceCount: 0, attendanceDays: 0, learnerCount: 0 },
      rows: []
    };
    expect(decodeVenueReadResult(empty, read)).toEqual(empty);
    expect(
      decodeVenueReadResult(
        {
          ...empty,
          operation: 'attendance.export',
          page: undefined,
          limit: undefined,
          rowCount: 0
        },
        exporting
      )
    ).toEqual(unavailable);
    const emptyExport = { ...exported(), totals: empty.totals, rows: [], rowCount: 0 };
    expect(decodeVenueReadResult(emptyExport, exporting)).toEqual(emptyExport);
    const page2 = parseVenueReadRequest({ ...readInput, page: 2 });
    expect(decodeVenueReadResult({ ...attendance(), page: 2, rows: [] }, page2).state).toBe(
      'available'
    );
  });
  it('binds allowlisted filters to both envelope and every row', () => {
    const selected = parseVenueReadRequest({
      ...readInput,
      filters: { fieldId, method: 'nfc_gps' }
    });
    const data = { ...attendance(), filters: { fieldId, method: 'nfc_gps' } };
    expect(decodeVenueReadResult(data, selected)).toEqual(data);
    expect(decodeVenueReadResult(attendance(), selected)).toEqual(unavailable);
    expect(
      decodeVenueReadResult(
        {
          ...data,
          rows: [
            { ...entry(), field: { ...entry().field, fieldId: otherId } },
            ...data.rows.slice(1)
          ]
        },
        selected
      )
    ).toEqual(unavailable);
    expect(
      decodeVenueReadResult(
        { ...data, rows: [{ ...entry(), method: 'volunteer_manual' }, ...data.rows.slice(1)] },
        selected
      )
    ).toEqual(unavailable);
  });
  it.each(['suppressed', 'unavailable'] as const)(
    'no-data %s has no counts, reason, rows, audit or existence hint',
    (state) => {
      expect(decodeVenueReadResult({ version: 1, state }, read)).toEqual({ version: 1, state });
      rejects({ version: 1, state, total: 4 });
      rejects({ version: 1, state, rows: [] });
      rejects({ version: 1, state, reason: 'private' });
      expect(decodeVenueReadResult({ version: 1, state }, exporting)).toEqual({
        version: 1,
        state
      });
    }
  );
  it.each([
    null,
    [],
    'raw csv',
    {},
    { ok: true, data: attendance() },
    { ...attendance(), version: 2 },
    { ...attendance(), regionId: otherId },
    { ...attendance(), from: '2026-09-01' },
    { ...attendance(), until: '2026-12-01' },
    { ...attendance(), timezone: 'UTC' },
    { ...attendance(), page: 2 },
    { ...attendance(), limit: 10 },
    { ...attendance(), rows: [] },
    { ...attendance(), total: 5 },
    { ...attendance(), session: 'never' },
    { ...attendance(), totals: { attendanceCount: 5, attendanceDays: 0, learnerCount: 5 } },
    { ...attendance(), totals: { attendanceCount: 5, attendanceDays: 6, learnerCount: 5 } },
    { ...attendance(), totals: { attendanceCount: 5, attendanceDays: 1, learnerCount: 6 } },
    { ...attendance(), totals: { attendanceCount: 5, attendanceDays: 1, learnerCount: 0 } },
    {
      ...attendance(),
      totals: { attendanceCount: 5, attendanceDays: 1, learnerCount: 5, rawCount: 6 }
    }
  ])('fails closed for malformed or mismatched output: %j', rejects);
  it.each([
    { student_note: 'private' },
    { user_latitude: 25 },
    { user_longitude: 121 },
    { phone: 'not-real' },
    { personId: otherId },
    { session: 'never' },
    { volunteerName: 'not-required' },
    { checkinId: otherId },
    { timestamp: '2026-10-25T00:00:00Z' },
    { date: '2026-11-01' },
    { date: '2026-09-30' },
    { date: '2026-02-30' },
    { method: 'unknown' },
    { distanceMeters: -1 },
    { distanceMeters: Number.NaN },
    { distanceMeters: Number.POSITIVE_INFINITY },
    { distanceMeters: '12.34' },
    { learnerName: '' },
    { field: { ...entry().field, latitude: 25 } }
  ])('rejects forbidden/invalid nested fields rather than stripping: %j', (change) => {
    rejects({ ...attendance(), rows: [{ ...entry(), ...change }, ...attendance().rows.slice(1)] });
  });
  it('rejects range-inconsistent day counts and malformed expected requests', () => {
    const oneDay = { ...readInput, from: '2026-10-25', until: '2026-10-26' };
    expect(
      decodeVenueReadResult(
        {
          ...attendance(),
          ...oneDay,
          totals: { attendanceCount: 5, attendanceDays: 2, learnerCount: 5 }
        },
        parseVenueReadRequest(oneDay)
      )
    ).toEqual(unavailable);
    expect(decodeVenueReadResult(attendance(), { ...read, regionId: '' })).toEqual(unavailable);
  });
  it.each([
    { ...fieldData(), total: 2 },
    { ...fieldData(), regionId: otherId },
    { ...fieldData(), fields: [{ ...fieldData().fields[0], longitude: 121 }] },
    { ...fieldData(), total: 2, fields: [...fieldData().fields, ...fieldData().fields] }
  ])('rejects invalid field list: %j', (data) => {
    expect(decodeVenueReadResult(data, fields)).toEqual(unavailable);
  });
  it.each([
    { ...exported(), rowCount: 4 },
    { ...exported(), totals: { ...exported().totals, attendanceDays: 2 } },
    { ...exported(), rows: [] },
    { ...exported(), csv: 'untrusted' },
    {
      ...exported(),
      rowCount: 1001,
      totals: { attendanceCount: 1001, attendanceDays: 1, learnerCount: 1001 },
      rows: Array.from({ length: 1001 }, entry)
    }
  ])('rejects partial/oversized/raw exports %#', (data) => {
    expect(decodeVenueReadResult(data, exporting)).toEqual(unavailable);
  });
  it('accepts the exact export bound and nullable stored distance, including manual records', () => {
    const data = {
      ...exported(),
      rowCount: 1000,
      totals: { attendanceCount: 1000, attendanceDays: 1, learnerCount: 1000 },
      rows: Array.from({ length: 1000 }, () => ({
        ...entry(),
        method: 'volunteer_manual',
        distanceMeters: null
      }))
    };
    expect(decodeVenueReadResult(data, exporting)).toEqual(data);
  });
  it('negative dependency mock: the real deny-only service still refuses future success', async () => {
    const execute = vi.fn(async () => exported() as unknown as VenueAdminDenial);
    const service = createVenueAdminService(execute);
    expect(
      await service.execute({
        operation: 'attendance.export',
        regionId,
        from: selector.from,
        until: selector.until
      })
    ).toEqual({ status: 503, body: { error: 'unavailable' } });
    expect(execute).toHaveBeenCalledOnce();
    execute.mockRejectedValueOnce(new Error('private diagnostic'));
    expect(await service.execute({ operation: 'field.read', regionId })).toEqual({
      status: 503,
      body: { error: 'unavailable' }
    });
  });
});
