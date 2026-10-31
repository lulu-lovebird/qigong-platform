/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved. */
import { withRequestContext, type Pool } from '@qigong/database';

export const venueReportingMigrationVersion = '0061_venue_attendance_reporting.sql';

export interface WeekendVenueSummaryItem {
  readonly fieldId: string;
  readonly fieldCode: string;
  readonly fieldName: string;
  readonly timezone: string;
  readonly isActive: boolean;
  readonly attendanceCount: number;
  readonly learnerCount: number;
  readonly attendanceDays: number;
}

export interface WeekendSummaryResult {
  readonly mode: 'summary';
  readonly regionId: string;
  readonly dateFrom: string;
  readonly dateUntil: string;
  readonly fields: readonly WeekendVenueSummaryItem[];
}

export interface WeekendExportAttendeeItem {
  readonly attendanceId: string;
  readonly attendanceDate: string;
  readonly checkinAt: string;
  readonly checkinMethod: string;
  readonly fieldCode: string;
  readonly fieldName: string;
  readonly personId: string;
  readonly learnerName: string;
  readonly email: string;
  readonly phone: string;
  readonly lineId: string;
  readonly telegramId: string;
  readonly whatsappId: string;
}

export interface WeekendExportResult {
  readonly mode: 'export';
  readonly regionId: string;
  readonly dateFrom: string;
  readonly dateUntil: string;
  readonly rowCount: number;
  readonly rows: readonly WeekendExportAttendeeItem[];
}

export interface LearnerSearchItem {
  readonly personId: string;
  readonly learnerName: string;
  readonly email: string;
  readonly phone: string;
  readonly attendanceCount: number;
  readonly attendanceDays: number;
  readonly latestDate: string;
  readonly latestFieldCode: string;
  readonly latestFieldName: string;
}

export interface LearnerSearchResult {
  readonly mode: 'search';
  readonly regionId: string;
  readonly search: string;
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly rows: readonly LearnerSearchItem[];
}

export interface AnnualSummaryItem {
  readonly year: number;
  readonly attendanceCount: number;
  readonly attendanceDays: number;
}

export interface LearnerHistoryRecord {
  readonly attendanceId: string;
  readonly attendanceDate: string;
  readonly checkinAt: string;
  readonly timezone: string;
  readonly checkinMethod: string;
  readonly fieldCode: string;
  readonly fieldName: string;
}

export interface LearnerHistoryDetailResult {
  readonly mode: 'detail';
  readonly regionId: string;
  readonly learner: {
    readonly personId: string;
    readonly learnerName: string;
    readonly email: string;
    readonly phone: string;
    readonly lineId: string;
    readonly telegramId: string;
    readonly whatsappId: string;
  };
  readonly annualSummary: readonly AnnualSummaryItem[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly history: readonly LearnerHistoryRecord[];
}

export interface VenueReportingService {
  getWeekendAttendanceSummary(
    requestId: string,
    session: string,
    regionId: string,
    dateFrom: string,
    dateUntil: string,
    fieldId: string | null,
    exporting: false
  ): Promise<WeekendSummaryResult>;

  getWeekendAttendanceExport(
    requestId: string,
    session: string,
    regionId: string,
    dateFrom: string,
    dateUntil: string,
    fieldId: string | null
  ): Promise<WeekendExportResult>;

  searchLearners(
    requestId: string,
    session: string,
    regionId: string,
    search: string,
    page: number,
    limit: number
  ): Promise<LearnerSearchResult>;

  getLearnerHistory(
    requestId: string,
    session: string,
    regionId: string,
    personId: string,
    page: number,
    limit: number
  ): Promise<LearnerHistoryDetailResult>;
}

export const createVenueReportingService = (pool: Pool): VenueReportingService =>
  Object.freeze({
    getWeekendAttendanceSummary: (
      requestId: string,
      session: string,
      regionId: string,
      dateFrom: string,
      dateUntil: string,
      fieldId: string | null
    ): Promise<WeekendSummaryResult> =>
      withRequestContext(pool, 'qigong_api_runtime', { requestId }, async (client) => {
        const result = await client.query<{ data: WeekendSummaryResult }>(
          'SELECT admin.venue_weekend_attendance_summary($1,$2,$3,$4,$5,$6) AS data',
          [session, regionId, dateFrom, dateUntil, fieldId, false]
        );
        if (result.rows.length !== 1 || !result.rows[0]?.data)
          throw new Error('invalid weekend summary result');
        return result.rows[0].data;
      }),

    getWeekendAttendanceExport: (
      requestId: string,
      session: string,
      regionId: string,
      dateFrom: string,
      dateUntil: string,
      fieldId: string | null
    ): Promise<WeekendExportResult> =>
      withRequestContext(pool, 'qigong_api_runtime', { requestId }, async (client) => {
        const result = await client.query<{ data: WeekendExportResult }>(
          'SELECT admin.venue_weekend_attendance_summary($1,$2,$3,$4,$5,$6) AS data',
          [session, regionId, dateFrom, dateUntil, fieldId, true]
        );
        if (result.rows.length !== 1 || !result.rows[0]?.data)
          throw new Error('invalid weekend export result');
        return result.rows[0].data;
      }),

    searchLearners: (
      requestId: string,
      session: string,
      regionId: string,
      search: string,
      page: number,
      limit: number
    ): Promise<LearnerSearchResult> =>
      withRequestContext(pool, 'qigong_api_runtime', { requestId }, async (client) => {
        const result = await client.query<{ data: LearnerSearchResult }>(
          'SELECT admin.venue_learner_attendance_history($1,$2,$3,$4,$5,$6) AS data',
          [session, regionId, search, null, page, limit]
        );
        if (result.rows.length !== 1 || !result.rows[0]?.data)
          throw new Error('invalid learner search result');
        return result.rows[0].data;
      }),

    getLearnerHistory: (
      requestId: string,
      session: string,
      regionId: string,
      personId: string,
      page: number,
      limit: number
    ): Promise<LearnerHistoryDetailResult> =>
      withRequestContext(pool, 'qigong_api_runtime', { requestId }, async (client) => {
        const result = await client.query<{ data: LearnerHistoryDetailResult }>(
          'SELECT admin.venue_learner_attendance_history($1,$2,$3,$4,$5,$6) AS data',
          [session, regionId, '', personId, page, limit]
        );
        if (result.rows.length !== 1 || !result.rows[0]?.data)
          throw new Error('invalid learner history result');
        return result.rows[0].data;
      })
  });

export const formatAttendeeCsv = (records: readonly WeekendExportAttendeeItem[]): string => {
  const headers = [
    '場地代碼',
    '場地名稱',
    '出席日期',
    '簽到時間(UTC)',
    '簽到方式',
    '學員姓名',
    '電子郵件',
    '電話',
    'LINE ID',
    'Telegram ID',
    'WhatsApp ID'
  ];

  const escapeCell = (value: string): string => {
    if (/[",\r\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const rows = records.map((r) =>
    [
      r.fieldCode,
      r.fieldName,
      r.attendanceDate,
      r.checkinAt,
      r.checkinMethod,
      r.learnerName,
      r.email,
      r.phone,
      r.lineId,
      r.telegramId,
      r.whatsappId
    ]
      .map((val) => escapeCell(val ?? ''))
      .join(',')
  );

  return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
};
