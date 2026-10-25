/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */
import { z } from 'zod';
import type { AdminLocale } from './admin-locale.js';

export const venueAttendanceTitle = '團練場出席管理';
export const attendanceTimeZone = 'Asia/Taipei';
const calendarDate = z.iso.date().refine((value) => value >= '0001-01-01' && value <= '9998-12-31');

export const attendanceExportQuerySchema = z
  .object({
    startDate: calendarDate.optional(),
    start_date: calendarDate.optional(),
    endDate: calendarDate.optional(),
    end_date: calendarDate.optional(),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .refine((value) => value >= '0001-01' && value <= '9998-12')
      .optional(),
    fieldId: z.uuid().optional(),
    field_id: z.uuid().optional(),
    regionId: z.uuid().optional(),
    method: z.enum(['nfc_gps', 'volunteer_manual']).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    lang: z.enum(['zh_TW', 'zh_CN', 'en']).optional()
  })
  .strict()
  .superRefine((query, context) => {
    const conflict =
      (query.startDate !== undefined &&
        query.start_date !== undefined &&
        query.startDate !== query.start_date) ||
      (query.endDate !== undefined &&
        query.end_date !== undefined &&
        query.endDate !== query.end_date) ||
      (query.fieldId !== undefined &&
        query.field_id !== undefined &&
        query.fieldId !== query.field_id);
    const start = query.startDate ?? query.start_date;
    const end = query.endDate ?? query.end_date;
    if (conflict || (start && end && start > end) || (query.month && (start || end))) {
      context.addIssue({ code: 'custom', message: 'Conflicting attendance filters' });
    }
  });
export type AttendanceExportQuery = z.infer<typeof attendanceExportQuerySchema>;
export interface AttendanceRange {
  readonly startDate: string;
  readonly endDate: string;
  readonly startInclusive: string;
  readonly endExclusive: string;
  readonly timezone: typeof attendanceTimeZone;
}

const nextDate = (value: string): string => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

export const attendanceRange = (
  query: AttendanceExportQuery,
  now = new Date()
): AttendanceRange => {
  const month = query.month ?? formatAttendanceDate(now).slice(0, 7);
  const first = `${month}-01`;
  const nextMonth = new Date(`${first}T00:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  nextMonth.setUTCDate(nextMonth.getUTCDate() - 1);
  const startDate = query.startDate ?? query.start_date ?? first;
  const endDate = query.endDate ?? query.end_date ?? nextMonth.toISOString().slice(0, 10);
  if (startDate > endDate) throw new Error('invalid_attendance_range');
  return {
    startDate,
    endDate,
    startInclusive: `${startDate}T00:00:00+08:00`,
    endExclusive: `${nextDate(endDate)}T00:00:00+08:00`,
    timezone: attendanceTimeZone
  };
};

export interface AttendanceExportRecord {
  readonly id: string;
  readonly checkin_at: Date | string;
  readonly student_name: string;
  readonly field_code: string;
  readonly field_name: string;
  readonly checkin_method: string;
  readonly volunteer_name?: string | null;
  readonly distance_meters?: number | null;
}

// Internal stable IDs are for deduplication only, never display names or CSV columns.
export interface VenueAttendanceRecord extends AttendanceExportRecord {
  readonly person_id: string;
  readonly field_id: string;
}
export interface AttendanceSummary {
  readonly practiceCount: number;
  readonly attendanceDays: number;
  readonly learnerCount: number;
}
export interface AttendanceMonthSummary extends AttendanceSummary {
  readonly month: string;
}

export const formatCheckinMethod = (method: string, locale: AdminLocale = 'zh_TW'): string => {
  const normalized = method.trim().toLowerCase();
  if (normalized === 'nfc_gps') return 'NFC_GPS';
  if (normalized === 'volunteer_manual') return locale === 'en' ? 'Volunteer Manual' : '志工補簽';
  return method;
};

export const formatAttendanceDate = (
  date: Date | string,
  timeZone = attendanceTimeZone
): string => {
  const parsed = typeof date === 'string' ? new Date(date) : date;
  if (!Number.isFinite(parsed.getTime())) throw new Error('invalid_attendance_timestamp');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
};

// Input must be the COMPLETE authorized filtered set, not just the current page.
// Count learner/field/Taipei-date once, including duplicate legacy rows only once.
export const summarizeAttendance = (
  records: readonly VenueAttendanceRecord[]
): AttendanceSummary => {
  const sessions = new Set<string>();
  const days = new Set<string>();
  const learners = new Set<string>();
  for (const record of records) {
    if (!record.person_id || !record.field_id) throw new Error('missing_attendance_identity');
    const day = formatAttendanceDate(record.checkin_at).slice(0, 10);
    sessions.add(JSON.stringify([record.person_id, record.field_id, day]));
    days.add(day);
    learners.add(record.person_id);
  }
  return { practiceCount: sessions.size, attendanceDays: days.size, learnerCount: learners.size };
};

export const summarizeAttendanceMonths = (
  records: readonly VenueAttendanceRecord[]
): readonly AttendanceMonthSummary[] => {
  const months = new Map<string, VenueAttendanceRecord[]>();
  for (const record of records) {
    const month = formatAttendanceDate(record.checkin_at).slice(0, 7);
    const group = months.get(month) ?? [];
    group.push(record);
    months.set(month, group);
  }
  return [...months]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, rows]) => ({ month, ...summarizeAttendance(rows) }));
};

// Quoting alone does not neutralize formulas. Also guard whitespace/control/format prefixes.
export const csvCell = (value: string | number | null | undefined, forceText = false): string => {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  const first = str.replace(/^[\s\p{Cf}\p{Cc}]*/gu, '');
  const guarded =
    str !== '' && (forceText || /^[=+\-@]/u.test(first) || /^\p{Cc}/u.test(str)) ? "'" + str : str;
  return '"' + guarded.replace(/"/g, '""') + '"';
};

// Compatibility encoder retains the original six-column contract; new reports use
// encodeVenueAttendanceCsv, which also preserves the stored distance (never infers verification).
export const encodeAttendanceCsv = (
  records: readonly AttendanceExportRecord[],
  locale: AdminLocale = 'zh_TW',
  includeDistance = false
): Buffer => {
  const headers =
    locale === 'en'
      ? [
          'Check-in Time',
          'Learner Name',
          'Field Code',
          'Field Name',
          'Check-in Method',
          'Verified By'
        ]
      : ['簽到日期時間', '學員姓名', '場地代碼', '場地名稱', '簽到方式', '核實志工'];
  if (includeDistance) headers.push(locale === 'en' ? 'Stored Distance (m)' : '紀錄距離（公尺）');
  const lines = [headers.map((header) => csvCell(header)).join(',')];
  for (const record of records) {
    const cells = [
      csvCell(formatAttendanceDate(record.checkin_at), true),
      csvCell(record.student_name),
      csvCell(record.field_code, true),
      csvCell(record.field_name),
      csvCell(formatCheckinMethod(record.checkin_method, locale)),
      csvCell(record.volunteer_name?.trim() ? record.volunteer_name : '—')
    ];
    if (includeDistance) cells.push(csvCell(record.distance_meters));
    lines.push(cells.join(','));
  }
  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
};
export const encodeVenueAttendanceCsv = (
  records: readonly AttendanceExportRecord[],
  locale: AdminLocale = 'zh_TW'
): Buffer => encodeAttendanceCsv(records, locale, true);

// Retained for existing callers; the new report download uses the unified title.
export const attendanceCsvFilename = (
  now = new Date(),
  locale: AdminLocale = 'zh_TW',
  unifiedTitle = false
): { filename: string; disposition: string } => {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const filename = `${unifiedTitle ? venueAttendanceTitle : locale === 'en' ? 'attendance_export' : '團練出席報表'}_${stamp}.csv`;
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase()
  );
  return {
    filename,
    disposition: `attachment; filename="attendance-${stamp}.csv"; filename*=UTF-8''${encoded}`
  };
};

export const attendancePage = <T>(
  records: readonly T[],
  page: number,
  limit: number
): readonly T[] => {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('invalid_attendance_page');
  return records.slice((page - 1) * limit, page * limit);
};

export const attendanceQueryString = (query: AttendanceExportQuery, page?: number): string => {
  const values = { ...query, ...(page === undefined ? {} : { page }) };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) params.set(key, String(value));
  return params.toString();
};
