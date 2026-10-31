/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved. */
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerVenueReportingRoutes } from '../src/venue-reporting-routes.js';
import {
  formatAttendeeCsv,
  type LearnerHistoryDetailResult,
  type LearnerSearchResult,
  type VenueReportingService,
  type WeekendExportAttendeeItem,
  type WeekendExportResult,
  type WeekendSummaryResult
} from '../src/venue-reporting-service.js';

describe('formatAttendeeCsv helper', () => {
  it('formats attendees with UTF-8 BOM, escaped values and correct columns', () => {
    const attendees: readonly WeekendExportAttendeeItem[] = [
      {
        attendanceId: 'att-1',
        attendanceDate: '2026-10-31',
        checkinAt: '2026-10-31T06:30:00Z',
        checkinMethod: 'nfc_gps',
        fieldCode: 'tw-taipei-1',
        fieldName: '台北大安, "公園"',
        personId: 'p-1',
        learnerName: '陳小明',
        email: 'ming_a@example.com',
        phone: '+886912345678',
        lineId: 'U_LINE_1',
        telegramId: '',
        whatsappId: ''
      },
      {
        attendanceId: 'att-2',
        attendanceDate: '2026-10-31',
        checkinAt: '2026-10-31T07:00:00Z',
        checkinMethod: 'volunteer_manual',
        fieldCode: 'tw-hsinchu-1',
        fieldName: '新竹團練場',
        personId: 'p-2',
        learnerName: '陳小明',
        email: 'ming_b@example.com',
        phone: '+886987654321',
        lineId: '',
        telegramId: 'tg_user',
        whatsappId: '+886987654321'
      }
    ];

    const csv = formatAttendeeCsv(attendees);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      '場地代碼,場地名稱,出席日期,簽到時間(UTC),簽到方式,學員姓名,電子郵件,電話,LINE ID,Telegram ID,WhatsApp ID'
    );
    expect(lines[1]).toContain('"台北大安, ""公園"""');
    expect(lines[1]).toContain('+886912345678');
    expect(lines[1]).toContain('U_LINE_1');
    expect(lines[2]).toContain('新竹團練場');
    expect(lines[2]).toContain('tg_user');
    expect(lines[2]).toContain('+886987654321');
  });
});

describe('venue reporting HTTP routes & admin shell integration', () => {
  const origin = 'https://admin.example.invalid';
  const sessionToken = 's'.repeat(43);
  const csrfToken = 'c'.repeat(43);

  const mockService: VenueReportingService = {
    getWeekendAttendanceSummary: vi.fn(async (): Promise<WeekendSummaryResult> => ({
      mode: 'summary',
      regionId: 'reg-tw',
      dateFrom: '2026-10-30',
      dateUntil: '2026-11-01',
      fields: [
        {
          fieldId: 'f-1',
          fieldCode: 'tw-tp-1',
          fieldName: '大安',
          timezone: 'Asia/Taipei',
          isActive: true,
          attendanceCount: 15,
          learnerCount: 15,
          attendanceDays: 2
        }
      ]
    })),
    getWeekendAttendanceExport: vi.fn(async (): Promise<WeekendExportResult> => ({
      mode: 'export',
      regionId: 'reg-tw',
      dateFrom: '2026-10-30',
      dateUntil: '2026-11-01',
      rowCount: 1,
      rows: [
        {
          attendanceId: 'att-1',
          attendanceDate: '2026-10-31',
          checkinAt: '2026-10-31T06:30:00Z',
          checkinMethod: 'nfc_gps',
          fieldCode: 'tw-tp-1',
          fieldName: '大安',
          personId: 'p-1',
          learnerName: '林大華',
          email: 'lin@example.com',
          phone: '+886900111222',
          lineId: 'line-lin',
          telegramId: '',
          whatsappId: ''
        }
      ]
    })),
    searchLearners: vi.fn(async (): Promise<LearnerSearchResult> => ({
      mode: 'search',
      regionId: 'reg-tw',
      search: '小明',
      total: 1,
      page: 1,
      limit: 20,
      rows: [
        {
          personId: 'p-10',
          learnerName: '王小明',
          email: 'wang@example.com',
          phone: '+886933444555',
          attendanceCount: 8,
          attendanceDays: 8,
          latestDate: '2026-10-25',
          latestFieldCode: 'tw-tp-1',
          latestFieldName: '大安'
        }
      ]
    })),
    getLearnerHistory: vi.fn(async (): Promise<LearnerHistoryDetailResult> => ({
      mode: 'detail',
      regionId: 'reg-tw',
      learner: {
        personId: 'p-10',
        learnerName: '王小明',
        email: 'wang@example.com',
        phone: '+886933444555',
        lineId: 'line-wang',
        telegramId: '',
        whatsappId: ''
      },
      annualSummary: [{ year: 2026, attendanceCount: 8, attendanceDays: 8 }],
      total: 1,
      page: 1,
      limit: 20,
      history: [
        {
          attendanceId: 'att-10',
          attendanceDate: '2026-10-25',
          checkinAt: '2026-10-25T07:00:00Z',
          timezone: 'Asia/Taipei',
          checkinMethod: 'nfc_gps',
          fieldCode: 'tw-tp-1',
          fieldName: '大安'
        }
      ]
    }))
  };

  const createApp = (principal: string | null = 'admin-user') => {
    const app = Fastify();
    registerVenueReportingRoutes(app, {
      config: { enabled: true, publicOrigin: origin },
      service: mockService,
      pagePrincipalFor: async () => principal
    });
    return app;
  };

  it('GET /admin/venue-weekend-attendance rejects unauthenticated and renders shell for admin', async () => {
    const unauthApp = createApp(null);
    const unauthRes = await unauthApp.inject({
      method: 'GET',
      url: '/admin/venue-weekend-attendance'
    });
    expect(unauthRes.statusCode).toBe(401);

    const app = createApp('admin-1');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/venue-weekend-attendance',
      headers: {
        cookie: `__Host-qigong-admin=${sessionToken}`
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('週末團練出席報表');
    expect(res.body).toContain('所屬大地區');
    expect(res.body).toContain('本週週末');
    expect(res.body).toContain('匯出全區 CSV');
    expect(res.body).toContain('admin-navigation'); // Verifies Admin Shell Sidebar is rendered
  });

  it('GET /admin/venue-learner-attendance rejects unauthenticated and renders shell for admin', async () => {
    const app = createApp('admin-1');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/venue-learner-attendance',
      headers: {
        cookie: `__Host-qigong-admin=${sessionToken}`
      }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('學員團練出席歷程');
    expect(res.body).toContain('搜尋學員姓名');
    expect(res.body).toContain('聯絡電話（同名辨識）');
    expect(res.body).toContain('歷年團練出席總次數（分年度統計）');
    expect(res.body).toContain('admin-navigation'); // Verifies Admin Shell Sidebar is rendered
  });

  it('POST /admin/api/venue-reporting/* rejects missing or invalid origin / CSRF', async () => {
    const app = createApp('admin-1');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/api/venue-reporting/weekend-summary',
      headers: {
        origin: 'https://evil.attacker.invalid',
        cookie: `__Host-qigong-admin=${sessionToken}; __Host-qigong-admin-csrf=${csrfToken}`,
        'x-csrf-token': csrfToken
      },
      payload: { regionId: 'reg-tw', dateFrom: '2026-10-30', dateUntil: '2026-11-01' }
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'invalid_origin_or_csrf' });
  });

  it('POST /admin/api/venue-reporting/weekend-summary returns venue attendance summary', async () => {
    const app = createApp('admin-1');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/api/venue-reporting/weekend-summary',
      headers: {
        origin,
        cookie: `__Host-qigong-admin=${sessionToken}; __Host-qigong-admin-csrf=${csrfToken}`,
        'x-csrf-token': csrfToken
      },
      payload: { regionId: 'reg-tw', dateFrom: '2026-10-30', dateUntil: '2026-11-01' }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('summary');
    expect(body.fields[0].fieldCode).toBe('tw-tp-1');
    expect(body.fields[0].attendanceCount).toBe(15);
  });

  it('POST /admin/api/venue-reporting/weekend-export streams CSV attachment with attendee details', async () => {
    const app = createApp('admin-1');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/api/venue-reporting/weekend-export',
      headers: {
        origin,
        cookie: `__Host-qigong-admin=${sessionToken}; __Host-qigong-admin-csrf=${csrfToken}`,
        'x-csrf-token': csrfToken
      },
      payload: { regionId: 'reg-tw', dateFrom: '2026-10-30', dateUntil: '2026-11-01' }
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment; filename=');
    expect(res.body).toContain('林大華');
    expect(res.body).toContain('lin@example.com');
    expect(res.body).toContain('+886900111222');
    expect(res.body).toContain('line-lin');
  });

  it('POST /admin/api/venue-reporting/learner-search returns search results with disambiguating fields', async () => {
    const app = createApp('admin-1');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/api/venue-reporting/learner-search',
      headers: {
        origin,
        cookie: `__Host-qigong-admin=${sessionToken}; __Host-qigong-admin-csrf=${csrfToken}`,
        'x-csrf-token': csrfToken
      },
      payload: { regionId: 'reg-tw', search: '小明', page: 1, limit: 20 }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('search');
    expect(body.rows[0].learnerName).toBe('王小明');
    expect(body.rows[0].phone).toBe('+886933444555');
    expect(body.rows[0].email).toBe('wang@example.com');
  });

  it('POST /admin/api/venue-reporting/learner-history returns annual breakdown and checkin logs', async () => {
    const app = createApp('admin-1');
    const res = await app.inject({
      method: 'POST',
      url: '/admin/api/venue-reporting/learner-history',
      headers: {
        origin,
        cookie: `__Host-qigong-admin=${sessionToken}; __Host-qigong-admin-csrf=${csrfToken}`,
        'x-csrf-token': csrfToken
      },
      payload: { regionId: 'reg-tw', personId: 'p-10', page: 1, limit: 20 }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('detail');
    expect(body.learner.learnerName).toBe('王小明');
    expect(body.annualSummary[0]).toEqual({ year: 2026, attendanceCount: 8, attendanceDays: 8 });
    expect(body.history[0].fieldCode).toBe('tw-tp-1');
    expect(body.history[0].attendanceDate).toBe('2026-10-25');
  });
});
