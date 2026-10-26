/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { describe, expect, it } from 'vitest';
import {
  decodeVenuePeopleResult,
  encodeVenuePeopleCsv,
  parseVenuePeopleQuery,
  venuePeopleMonthRange,
  venuePeopleTaipeiMonth
} from '../src/venue-people-helpers.js';

const regionId = '10000000-0000-4000-8000-000000000001';
const personId = '20000000-0000-4000-8000-000000000001';
const input = {
  mode: 'people',
  regionId,
  fieldId: null,
  personId: null,
  period: { month: '2026-10' },
  search: '',
  sort: 'recent',
  direction: 'desc',
  page: 1,
  limit: 20
};
const query = () => parseVenuePeopleQuery(input);
const data = (exporting = false) => ({
  ...query(),
  version: 1,
  page: 1,
  limit: exporting ? 1000 : 20,
  exporting,
  total: 1,
  totals: { attendanceCount: 2, attendanceDays: 1, learnerCount: 1 },
  rows: [
    {
      personId,
      name: '=SYNTHETIC()',
      attendanceCount: 2,
      attendanceDays: 1,
      latestDate: '2026-10-01'
    }
  ]
});
describe('venue people strict selectors, bound results and CSV', () => {
  it('uses Taipei for initial month, calendar ranges for venue-local dates', () => {
    expect(venuePeopleTaipeiMonth(new Date('2026-09-30T16:00:00Z'))).toBe('2026-10');
    expect(venuePeopleMonthRange('2024-02')).toEqual({ from: '2024-02-01', until: '2024-03-01' });
    expect(venuePeopleMonthRange('2026-12')).toEqual({ from: '2026-12-01', until: '2027-01-01' });
    expect(query()).toMatchObject({ from: '2026-10-01', until: '2026-11-01' });
  });
  it.each([
    { principalId: regionId },
    { personContext: personId },
    { exporting: true },
    { mode: 'manual' },
    { regionId: 'x' },
    { fieldId: 'x' },
    { personId },
    { page: '1' },
    { limit: 101 },
    { page: 0 },
    { sort: 'name;DROP TABLE' },
    { direction: 'DESC' },
    { search: ' x' },
    { search: '\nx' },
    { search: 'x'.repeat(81) },
    { period: { month: '2026-13' } },
    { period: { month: '2026-10', from: '2026-10-01' } },
    { period: { from: '2026-02-30', until: '2026-03-01' } },
    { period: { from: '2026-10-01', until: '2026-10-01' } },
    { period: { from: '2020-01-01', until: '2026-10-01' } }
  ])('rejects illegal selector %j', (patch) =>
    expect(() => parseVenuePeopleQuery({ ...input, ...patch })).toThrow()
  );
  it('accepts literal search and dates, requires selected person only for detail', () => {
    expect(
      parseVenuePeopleQuery({
        ...input,
        search: "%' OR true --",
        period: { from: '2026-10-01', until: '2026-10-02' }
      }).search
    ).toBe("%' OR true --");
    expect(() => parseVenuePeopleQuery({ ...input, mode: 'detail' })).toThrow();
    expect(parseVenuePeopleQuery({ ...input, mode: 'detail', personId })).toMatchObject({
      personId
    });
  });
  it('accepts real aggregate totals exceeding the page, not page totals', () => {
    expect(decodeVenuePeopleResult(data(), query(), false).totals.attendanceCount).toBe(2);
    expect(
      decodeVenuePeopleResult({ ...data(), page: 2, rows: [] }, { ...query(), page: 2 }, false)
        .total
    ).toBe(1);
  });
  it.each([
    { regionId: personId },
    { search: 'other' },
    { from: '2026-09-01' },
    { exporting: true },
    { page: 2 },
    { total: 2 },
    { rows: [] },
    { totals: { attendanceCount: 1, attendanceDays: 2, learnerCount: 1 } },
    { rawGps: true }
  ])('fails closed on invalid DB output %j', (patch) =>
    expect(() => decodeVenuePeopleResult({ ...data(), ...patch }, query(), false)).toThrow()
  );
  it.each(['=SUM(1)', '+cmd', '-2+3', '@cmd', ' \u200b=cmd', '\tcmd'])(
    'guards CSV formulas/escaping %j',
    (name) => {
      const output = decodeVenuePeopleResult(
        { ...data(true), rows: [{ ...data(true).rows[0]!, name }] },
        query(),
        true
      );
      const csv = encodeVenuePeopleCsv(output);
      expect(csv).toContain('"\'');
      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv.endsWith('\r\n')).toBe(true);
    }
  );
  it('quotes embedded CSV quotes and newlines without creating a new cell', () => {
    const name = '"\r\n=cmd';
    const output = decodeVenuePeopleResult(
      { ...data(true), rows: [{ ...data(true).rows[0]!, name }] },
      query(),
      true
    );
    expect(encodeVenuePeopleCsv(output)).toContain('"""\r\n=cmd"');
  });
  it('refuses partial/non-export CSV', () =>
    expect(() => encodeVenuePeopleCsv(decodeVenuePeopleResult(data(), query(), false))).toThrow());
});
