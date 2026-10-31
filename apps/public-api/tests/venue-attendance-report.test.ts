/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from '@qigong/database';
import { registerAdminAttendanceRoutes } from '../src/admin-attendance-routes.js';
import { adminContentSecurityPolicy } from '../src/admin-branding.js';
import {
  renderVenueAttendanceReportPage,
  venueAttendancePageScript
} from '../src/venue-attendance-report-page.js';
import {
  attendanceExportQuerySchema,
  attendanceRange,
  attendancePage,
  attendanceQueryString,
  summarizeAttendance,
  summarizeAttendanceMonths,
  csvCell,
  encodeVenueAttendanceCsv,
  formatAttendanceDate,
  attendanceCsvFilename,
  type VenueAttendanceRecord
} from '../src/venue-attendance-report.js';

const record = (changes: Partial<VenueAttendanceRecord> = {}): VenueAttendanceRecord => ({
  id: 'row-1',
  person_id: 'learner-1',
  field_id: 'field-1',
  student_name: '小明',
  field_code: '001',
  field_name: '公園',
  checkin_at: '2026-10-24T00:00:00Z',
  checkin_method: 'nfc_gps',
  distance_meters: 0,
  ...changes
});

// All records below are local test fixtures, not DB authorization evidence.
describe('attendance calendar and pagination', () => {
  it.each([
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '0000-01-01',
    '9999-12-31',
    '2026-1-01',
    '2026-10-01T00:00:00Z'
  ])('rejects invalid calendar date %s', (startDate) => {
    expect(attendanceExportQuerySchema.safeParse({ startDate }).success).toBe(false);
  });
  it.each([
    { startDate: '2026-10-31', endDate: '2026-10-01' },
    { startDate: '2026-10-01', start_date: '2026-10-02' },
    { endDate: '2026-10-01', end_date: '2026-10-02' },
    {
      fieldId: 'a0000000-0000-4000-8000-000000000001',
      field_id: 'a0000000-0000-4000-8000-000000000002'
    },
    { month: '2026-10', startDate: '2026-10-01' },
    { month: '2026-00' },
    { month: '0000-01' },
    { page: '0' },
    { page: '1.5' },
    { page: '10001' },
    { limit: '101' },
    { limit: '0' },
    { principalId: 'forged' },
    { student_note: 'private' },
    { timezone: 'UTC' },
    { method: 'manual' },
    { fieldId: 'forged' }
  ])('rejects invalid/ambiguous query %j', (query) => {
    expect(attendanceExportQuerySchema.safeParse(query).success).toBe(false);
  });
  it.each([
    ['2024-02', '2024-02-01T00:00:00+08:00', '2024-03-01T00:00:00+08:00'],
    ['2026-12', '2026-12-01T00:00:00+08:00', '2027-01-01T00:00:00+08:00'],
    ['0001-01', '0001-01-01T00:00:00+08:00', '0001-02-01T00:00:00+08:00']
  ])('uses half-open month %s', (month, startInclusive, endExclusive) => {
    expect(attendanceRange(attendanceExportQuerySchema.parse({ month }))).toMatchObject({
      startInclusive,
      endExclusive,
      timezone: 'Asia/Taipei'
    });
  });
  it('includes the final fractional second but not next local midnight', () => {
    const range = attendanceRange(
      attendanceExportQuerySchema.parse({ start_date: '2026-10-31', end_date: '2026-10-31' })
    );
    expect(Date.parse('2026-10-31T15:59:59.999Z')).toBeLessThan(Date.parse(range.endExclusive));
    expect(Date.parse('2026-10-31T16:00:00Z')).toBe(Date.parse(range.endExclusive));
    expect(Date.parse('2026-10-30T16:00:00Z')).toBe(Date.parse(range.startInclusive));
  });
  it('defaults to the Taipei month, not UTC month', () => {
    expect(
      attendanceRange(attendanceExportQuerySchema.parse({}), new Date('2026-10-31T16:01:00Z'))
        .startDate
    ).toBe('2026-11-01');
  });
  it('rejects a partial range inverted by its monthly default', () => {
    expect(() =>
      attendanceRange(
        attendanceExportQuerySchema.parse({ startDate: '2027-01-01' }),
        new Date('2026-10-01Z')
      )
    ).toThrow();
  });
  it('paginates without mutating and preserves filters in links', () => {
    const rows = [1, 2, 3];
    expect(attendancePage(rows, 2, 2)).toEqual([3]);
    expect(attendancePage(rows, 3, 2)).toEqual([]);
    expect(rows).toEqual([1, 2, 3]);
    expect(() => attendancePage(rows, 0, 20)).toThrow();
    const params = new URLSearchParams(
      attendanceQueryString(
        attendanceExportQuerySchema.parse({ month: '2026-10', method: 'nfc_gps', limit: '2' }),
        2
      )
    );
    expect(Object.fromEntries(params)).toMatchObject({
      month: '2026-10',
      method: 'nfc_gps',
      page: '2',
      limit: '2'
    });
  });
});

describe('independent attendance statistics', () => {
  it('counts same learner across fields twice but the local day once; deduplicates legacy rows', () => {
    const rows = [record(), record({ id: 'duplicate' }), record({ field_id: 'field-2' })];
    expect(summarizeAttendance(rows)).toEqual({
      practiceCount: 2,
      attendanceDays: 1,
      learnerCount: 1
    });
  });
  it('deduplicates learners by stable ID, never by equal display names', () => {
    expect(summarizeAttendance([record(), record({ person_id: 'learner-2' })])).toEqual({
      practiceCount: 2,
      attendanceDays: 1,
      learnerCount: 2
    });
  });
  it('groups by Taipei calendar month and day independently of UTC and daily-practice checkins', () => {
    expect(
      summarizeAttendanceMonths([
        record({ checkin_at: '2026-10-31T15:59:59.999Z' }),
        record({ checkin_at: '2026-10-31T16:00:00Z' }),
        record({ checkin_at: '2026-11-01T16:00:00Z', field_id: 'field-2' })
      ])
    ).toEqual([
      { month: '2026-10', practiceCount: 1, attendanceDays: 1, learnerCount: 1 },
      { month: '2026-11', practiceCount: 2, attendanceDays: 2, learnerCount: 1 }
    ]);
  });
  it('allows genuine empty results but refuses missing identities or invalid dates', () => {
    expect(summarizeAttendance([])).toEqual({
      practiceCount: 0,
      attendanceDays: 0,
      learnerCount: 0
    });
    expect(() => summarizeAttendance([record({ person_id: '' })])).toThrow();
    expect(() => summarizeAttendance([record({ checkin_at: 'invalid' })])).toThrow();
    expect(() => formatAttendanceDate('invalid')).toThrow();
  });
});

describe('actual report renderer (local authorized-data fixtures only)', () => {
  const query = attendanceExportQuerySchema.parse({
    month: '2026-10',
    method: 'nfc_gps',
    page: '2',
    limit: '2'
  });
  const range = attendanceRange(query);
  const rows = [
    record({
      student_name: '<script>alert("learner")</script>',
      field_name: 'A&B',
      volunteer_name: '<img src=x onerror=alert(1)>'
    })
  ];
  const renderReady = (canExport = true) =>
    renderVenueAttendanceReportPage(query, range, {
      status: 'ready',
      rows,
      total: 5,
      summary: { practiceCount: 5, attendanceDays: 3, learnerCount: 4 },
      months: [{ month: '2026-10', practiceCount: 5, attendanceDays: 3, learnerCount: 4 }],
      canExport
    });
  it('renders real filters, list, complete-scope monthly counts and pagination', () => {
    const html = renderReady();
    for (const name of [
      'month',
      'startDate',
      'endDate',
      'regionId',
      'fieldId',
      'method',
      'limit'
    ]) {
      expect(html).toContain(`name="${name}"`);
    }
    expect(html).toContain('value="nfc_gps" selected');
    expect(html).toContain('<td>5</td><td>3</td><td>4</td>');
    expect(html).toContain('第 2 頁／共 3 頁，5 筆');
    expect(html).toContain('page=1');
    expect(html).toContain('page=3');
    expect(html).toContain('month=2026-10&amp;method=nfc_gps');
    expect(html).toContain('0 公尺');
    expect(html).toContain('NFC_GPS');
    expect(html).toContain('2026-10-24 08:00:00');
    expect(html).not.toMatch(/出席率|全勤/);
    expect(html).toContain('不推定定位或身份驗證成功');
    expect(html).toContain('每位學員同場同日計一次');
  });
  it('escapes real table values, allowlists source fields, and never embeds records in scripts', () => {
    const sensitive = {
      ...record(),
      student_note: 'SECRET_NOTE',
      user_latitude: 'SECRET_GPS',
      phone: 'SECRET_PHONE',
      verification_result: 'FAKE_VERIFIED'
    };
    const html = renderReady();
    expect(html).toContain('&lt;script&gt;alert(&quot;learner&quot;)&lt;/script&gt;');
    expect(html).toContain('A&amp;B');
    expect(html).not.toContain('<script>alert(');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toMatch(/learner-1|field-1|row-1/);
    const minimal = renderVenueAttendanceReportPage(query, range, {
      status: 'ready',
      rows: [sensitive],
      total: 1,
      summary: summarizeAttendance([sensitive]),
      months: summarizeAttendanceMonths([sensitive]),
      canExport: false
    });
    expect(minimal).not.toMatch(/SECRET|FAKE/);
    expect(minimal).not.toContain('href="/admin/attendance/export.csv');
  });
  it('uses the unified title, mobile layout, semantic labels and company footer', () => {
    const html = renderReady();
    expect(html).toContain('<title>團練場出席管理｜');
    expect(html).toContain('<h1>團練場出席管理</h1>');
    expect(html).not.toContain('團練出席報表');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('@media(max-width:600px)');
    expect(html).toContain('aria-label="出席紀錄分頁"');
    expect(html).toContain('Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting');
    expect(html).not.toContain('method="POST"');
  });
  it('keeps export filters but excludes page/limit, and disables export without authority', () => {
    const link = /href="(\/admin\/attendance\/export.csv\?[^"]+)"/.exec(renderReady())?.[1];
    expect(link).toBeDefined();
    const params = new URL(link!.replaceAll('&amp;', '&'), 'https://test.invalid').searchParams;
    expect(params.get('month')).toBe('2026-10');
    expect(params.get('method')).toBe('nfc_gps');
    expect(params.has('page')).toBe(false);
    expect(params.has('limit')).toBe(false);
    expect(renderReady(false)).toContain('disabled>下載 CSV');
    expect(renderReady(false)).not.toContain('href="/admin/attendance/export.csv');
  });
  it.each(['unavailable', 'invalid', 'denied'] as const)(
    'renders %s without fake empty success or zero counts',
    (status) => {
      const html = renderVenueAttendanceReportPage(query, range, { status });
      expect(html).toContain('尚未查詢，不代表沒有出席紀錄');
      expect(html).toContain('<dd>—</dd>');
      expect(html).not.toContain('<dd>0</dd>');
      expect(html).not.toContain('查無符合條件');
      expect(html).not.toContain('href="/admin/attendance/export.csv');
    }
  );
  it('distinguishes an authorized empty result from unavailable data', () => {
    const emptyQuery = attendanceExportQuerySchema.parse({ month: '2026-10' });
    const html = renderVenueAttendanceReportPage(emptyQuery, range, {
      status: 'ready',
      rows: [],
      total: 0,
      summary: summarizeAttendance([]),
      months: [],
      canExport: true
    });
    expect(html).toContain('查無符合條件');
    expect(html).toContain('<dd>0</dd>');
    const paginationNav = html.slice(
      html.indexOf('class="pagination"'),
      html.indexOf('</nav>', html.indexOf('class="pagination"'))
    );
    expect(paginationNav).not.toContain('上一頁');
    expect(paginationNav).not.toContain('下一頁');
  });
  it('executes the real CSP-compatible filter controller without fetch, inline handlers or injected data', () => {
    let submit: ((event: { preventDefault: () => void }) => void) | undefined;
    const assign = vi.fn();
    const preventDefault = vi.fn();
    const values = [
      ['month', '2026-10'],
      ['startDate', '2026-10-24'],
      ['endDate', '2026-10-31'],
      ['method', 'nfc_gps'],
      ['fieldId', 'a0000000-0000-4000-8000-000000000001'],
      ['regionId', ''],
      ['lang', 'en']
    ];
    runInNewContext(venueAttendancePageScript, {
      document: {
        getElementById: () => ({
          addEventListener: (_event: string, handler: typeof submit) => {
            submit = handler;
          }
        })
      },
      FormData: class {
        [Symbol.iterator]() {
          return values[Symbol.iterator]();
        }
      },
      URLSearchParams,
      location: { assign }
    });
    expect(submit).toBeDefined();
    submit!({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    const target = String(assign.mock.calls[0]?.[0]);
    const url = new URL(target, 'https://test.invalid');
    expect(url.pathname).toBe('/admin/attendance');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.has('month')).toBe(false);
    expect(url.searchParams.has('regionId')).toBe(false);
    expect(url.searchParams.get('fieldId')).toBe('a0000000-0000-4000-8000-000000000001');
    expect(url.searchParams.get('lang')).toBe('en');
    expect(adminContentSecurityPolicy).toContain("form-action 'none'");
  });
});

describe('attendance route quarantine and negative authorization', () => {
  const apps: FastifyInstance[] = [];
  const connect = vi.fn(() => {
    throw new Error('TEST MUST NOT CONNECT TO DB');
  });
  const queryDb = vi.fn(() => {
    throw new Error('TEST MUST NOT QUERY DB');
  });
  // Deliberately unusable DB object: no actual pg instance, connection, credential or network.
  const pool = { connect, query: queryDb } as unknown as Pool;
  const create = async (
    principal: string | null = 'server-session-principal',
    failAuth = false
  ) => {
    const app = Fastify();
    apps.push(app);
    registerAdminAttendanceRoutes(app, pool, async () => {
      if (failAuth) throw new Error('SECRET_AUTH_DIAGNOSTIC');
      return principal;
    });
    await app.ready();
    return app;
  };
  beforeEach(() => {
    connect.mockClear();
    queryDb.mockClear();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('TEST MUST NOT CALL API'));
  });
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    expect(connect).not.toHaveBeenCalled();
    expect(queryDb).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it.each([
    '/admin/api/attendance',
    '/admin/attendance/export.csv',
    '/admin/api/attendance/capabilities'
  ])('rejects anonymous access to %s regardless of forged claims', async (url) => {
    const app = await create(null);
    const response = await app.inject({
      url,
      headers: {
        'x-principal-id': 'forged',
        'x-person-id': 'forged',
        'x-admin-role': 'super_admin',
        cookie: 'principalId=forged'
      }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthenticated' });
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('redirects anonymous page requests without displaying data', async () => {
    const app = await create(null);
    const response = await app.inject('/admin/attendance');
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/admin/auth/login');
    expect(response.headers['content-security-policy']).toBe(adminContentSecurityPolicy);
  });
  it('fails capabilities closed, never treating login or administrator access as read/export authority', async () => {
    const app = await create('global-administrator-session');
    const response = await app.inject('/admin/api/attendance/capabilities');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      canRead: false,
      canExport: false,
      error: 'attendance_reporting_unavailable'
    });
  });
  it.each(['/admin/api/attendance', '/admin/attendance/export.csv'])(
    'denies unwired scoped operation %s instead of broad SQL or mock success',
    async (path) => {
      const app = await create();
      for (const filters of [
        '',
        '?month=2026-10',
        '?regionId=a0000000-0000-4000-8000-000000000001&fieldId=b0000000-0000-4000-8000-000000000002&method=nfc_gps',
        '?startDate=2026-10-31&endDate=2026-10-31'
      ]) {
        const response = await app.inject(path + filters);
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({
          error: 'attendance_reporting_unavailable',
          reason: 'controlled_operation_and_region_scope_not_wired'
        });
        expect(response.json()).not.toHaveProperty('attendance');
        expect(response.headers['content-disposition']).toBeUndefined();
        expect(response.headers['content-type']).not.toContain('text/csv');
        expect(response.headers['referrer-policy']).toBe('no-referrer');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
      }
    }
  );
  it.each(['/admin/api/attendance', '/admin/attendance/export.csv', '/admin/attendance'])(
    'rejects invalid dates, pagination and forged context in %s',
    async (path) => {
      const app = await create();
      for (const filter of [
        'startDate=2026-02-29',
        'startDate=2026-10-31&endDate=2026-10-01',
        'principalId=forged',
        'page=0',
        'limit=101',
        'fieldId=forged',
        'month=2026-10&endDate=2026-10-31'
      ]) {
        const response = await app.inject(`${path}?${filter}`);
        expect(response.statusCode).toBe(400);
        expect(response.body).not.toContain('forged');
      }
    }
  );
  it('renders the real page as explicitly unavailable, with unchanged CSP and no false statistics', async () => {
    const app = await create();
    const response = await app.inject('/admin/attendance?month=2026-10&method=volunteer_manual');
    expect(response.statusCode).toBe(503);
    expect(response.headers['content-security-policy']).toBe(adminContentSecurityPolicy);
    expect(response.body).toContain('<h1>團練場出席管理</h1>');
    expect(response.body).toContain('value="volunteer_manual" selected');
    expect(response.body).toContain('待接線（503）');
    expect(response.body).toContain('<dd>—</dd>');
    expect(response.body).not.toContain('查無符合條件');
    expect(response.body).not.toContain('href="/admin/attendance/export.csv');
  });
  it.each([
    '/admin/api/attendance',
    '/admin/attendance/export.csv',
    '/admin/api/attendance/capabilities',
    '/admin/attendance'
  ])('does not fail open or disclose diagnostic on authentication failure: %s', async (url) => {
    const app = await create(null, true);
    const response = await app.inject(url);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'admin_authentication_unavailable' });
    expect(response.body).not.toContain('SECRET');
  });
  it.each(['POST', 'PUT', 'DELETE'] as const)(
    'does not add unauthorized %s operations',
    async (method) => {
      const app = await create();
      const response = await app.inject({
        method,
        url: '/admin/api/attendance',
        payload: { volunteerPersonId: 'forged' }
      });
      expect(response.statusCode).toBe(404);
    }
  );
});

describe('minimal, formula-safe CSV', () => {
  it.each([
    '=1+1',
    '+cmd',
    '-1+2',
    '@SUM(A1)',
    '\tvalue',
    '\rvalue',
    '\nvalue',
    ' \u200B=HYPERLINK("evil")',
    '\u0000 @cmd',
    '\uFEFF+1',
    '  -1'
  ])('neutralizes spreadsheet prefix %j', (value) => {
    expect(csvCell(value).startsWith('"\'')).toBe(true);
  });
  it('quotes separators/newlines and preserves numeric-looking field codes as text', () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    const csv = encodeVenueAttendanceCsv([
      record({ student_name: '=1', volunteer_name: '@cmd', distance_meters: 12.5 })
    ]).toString('utf8');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).toContain('紀錄距離（公尺）');
    expect(csv).toContain('"\'001"');
    expect(csv).toContain('"\'=1"');
    expect(csv).toContain('"\'@cmd"');
    expect(csv).toContain('"12.5"');
  });
  it('allowlists columns even when a source object contains sensitive extras', () => {
    const sensitive = {
      ...record(),
      student_note: 'SECRET_NOTE',
      user_latitude: 'SECRET_GPS',
      phone: 'SECRET_PHONE',
      verification_result: 'FAKE_VERIFIED'
    };
    const csv = encodeVenueAttendanceCsv([sensitive]).toString('utf8');
    expect(csv).not.toMatch(/SECRET|FAKE|learner-1|field-1|row-1/);
    expect(csv).not.toMatch(/驗證成功|verified/i);
    expect(
      encodeVenueAttendanceCsv([record({ distance_meters: null })]).toString('utf8')
    ).toContain(',""\r\n');
  });
  it('uses a safe attachment header and the unified report name', () => {
    const file = attendanceCsvFilename(new Date('2026-10-24T00:00:00Z'), 'zh_TW', true);
    expect(file.filename).toBe('團練場出席管理_20261024T000000Z.csv');
    expect(file.disposition).toContain("filename*=UTF-8''" + encodeURIComponent(file.filename));
    expect(file.disposition).not.toMatch(/[\r\n]/);
  });
});
