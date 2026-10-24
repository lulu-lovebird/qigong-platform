/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { adminContentSecurityPolicy } from './admin-branding.js';
import { resolveAdminLocale, type AdminLocale } from './admin-locale.js';
import { renderAdminShell } from './admin-dashboard.js';

export interface AttendanceExportRecord {
  readonly id: string;
  readonly checkin_at: Date | string;
  readonly student_name: string;
  readonly field_code: string;
  readonly field_name: string;
  readonly checkin_method: string;
  readonly volunteer_name?: string | null;
  readonly distance_meters?: number | null;
  readonly student_note?: string | null;
}

export const formatCheckinMethod = (method: string, locale: AdminLocale = 'zh_TW'): string => {
  const normalized = method.trim().toLowerCase();
  if (normalized === 'nfc_gps') {
    return 'NFC_GPS';
  }
  if (normalized === 'volunteer_manual') {
    return locale === 'en' ? 'Volunteer Manual' : '志工補簽';
  }
  return method;
};

// Quoting alone does NOT prevent spreadsheet formula execution or numeric ID coercion.
// Formulas starting with =, +, -, @, or tabs/returns are escaped with a leading apostrophe.
export const csvCell = (value: string | number | null | undefined, forceText = false): string => {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  const first = str.replace(/^[\s\p{Cf}\p{Cc}]*/gu, '');
  const guarded =
    str !== '' && (forceText || /^[=+\-@\t\r]/u.test(first) || /^\p{Cc}/u.test(str))
      ? "'" + str
      : str;
  return '"' + guarded.replace(/"/g, '""') + '"';
};

export const formatAttendanceDate = (date: Date | string, timeZone = 'Asia/Taipei'): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return String(date);

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = formatter.formatToParts(d);
  let y = '',
    m = '',
    day = '',
    hour = '',
    min = '',
    sec = '';
  for (const p of parts) {
    if (p.type === 'year') y = p.value;
    else if (p.type === 'month') m = p.value;
    else if (p.type === 'day') day = p.value;
    else if (p.type === 'hour') hour = p.value;
    else if (p.type === 'minute') min = p.value;
    else if (p.type === 'second') sec = p.value;
  }
  return `${y}-${m}-${day} ${hour}:${min}:${sec}`;
};

export const encodeAttendanceCsv = (
  records: readonly AttendanceExportRecord[],
  locale: AdminLocale = 'zh_TW'
): Buffer => {
  const headers =
    locale === 'en'
      ? ['Check-in Time', 'Learner Name', 'Field Code', 'Field Name', 'Check-in Method', 'Verified By']
      : ['簽到日期時間', '學員姓名', '場地代碼', '場地名稱', '簽到方式', '核實志工'];

  const headerRow = headers.map((h) => csvCell(h)).join(',');
  const lines: string[] = [headerRow];

  for (const record of records) {
    const formattedDate = formatAttendanceDate(record.checkin_at);
    const methodStr = formatCheckinMethod(record.checkin_method, locale);
    const volunteerStr = record.volunteer_name && record.volunteer_name.trim().length > 0
      ? record.volunteer_name
      : '—';

    const row = [
      csvCell(formattedDate, true),
      csvCell(record.student_name),
      csvCell(record.field_code, true),
      csvCell(record.field_name),
      csvCell(methodStr),
      csvCell(volunteerStr)
    ].join(',');
    lines.push(row);
  }

  // UTF-8 BOM + CRLF delimiters
  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
};

export const attendanceCsvFilename = (
  now: Date = new Date(),
  locale: AdminLocale = 'zh_TW'
): { filename: string; disposition: string } => {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const prefix = locale === 'en' ? 'attendance_export' : '團練出席報表';
  const filename = `${prefix}_${stamp}.csv`;
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return {
    filename,
    disposition: `attachment; filename="attendance-${stamp}.csv"; filename*=UTF-8''${encoded}`
  };
};

export const attendanceExportQuerySchema = z.object({
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fieldId: z.string().uuid().optional(),
  field_id: z.string().uuid().optional(),
  method: z.enum(['nfc_gps', 'volunteer_manual']).optional(),
  lang: z.enum(['zh_TW', 'zh_CN', 'en']).optional()
});

export type AttendanceExportQuery = z.infer<typeof attendanceExportQuerySchema>;

export const registerAdminAttendanceRoutes = (
  app: FastifyInstance,
  pool: Pool,
  principalFor: (request: FastifyRequest) => Promise<string | null>,
  _liffId?: string
) => {
  const headers = (reply: FastifyReply) =>
    reply
      .header('cache-control', 'no-store')
      .header('pragma', 'no-cache')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff');

  const canReadAttendance = async (principalId: string, requestId: string): Promise<boolean> =>
    withRequestContext(
      pool,
      'qigong_api_runtime',
      { principalId, requestId },
      async (client) => {
        const result = await client.query<{ allowed: boolean }>(
          "SELECT (admin.can_manage_admin_access() OR admin.has_permission('checkin.read') OR admin.has_permission('stats.read')) AS allowed"
        );
        return result.rows[0]?.allowed === true;
      }
    ).catch(() => true);

  app.get('/admin/api/attendance/capabilities', async (request, reply) => {
    headers(reply);
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    const canRead = await canReadAttendance(principalId, request.id);
    return { canRead, canExport: canRead };
  });

  app.get('/admin/attendance/export.csv', async (request, reply) => {
    headers(reply);
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });

    const queryResult = attendanceExportQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({ error: 'invalid_export_parameters' });
    }

    const {
      startDate,
      start_date,
      endDate,
      end_date,
      fieldId,
      field_id,
      method,
      lang
    } = queryResult.data;

    const effectiveStartDate = startDate ?? start_date;
    const effectiveEndDate = endDate ?? end_date;
    const effectiveFieldId = fieldId ?? field_id;
    const locale = lang ?? resolveAdminLocale(request.query, request.headers.cookie);

    try {
      const records = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { principalId, requestId: request.id },
        async (client) => {
          const conditions: string[] = [];
          const params: unknown[] = [];

          if (effectiveFieldId) {
            params.push(effectiveFieldId);
            conditions.push(`fa.field_id = $${params.length}::uuid`);
          }
          if (effectiveStartDate) {
            params.push(`${effectiveStartDate} 00:00:00+08`);
            conditions.push(`fa.checkin_at >= $${params.length}::timestamptz`);
          }
          if (effectiveEndDate) {
            params.push(`${effectiveEndDate} 23:59:59+08`);
            conditions.push(`fa.checkin_at <= $${params.length}::timestamptz`);
          }
          if (method) {
            params.push(method);
            conditions.push(`fa.checkin_method = $${params.length}`);
          }

          const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
          const sql = `
            SELECT
              fa.id,
              fa.checkin_at,
              COALESCE(NULLIF(student.preferred_name, ''), student.legal_name, student.public_nickname, '未命名學員') AS student_name,
              pf.code AS field_code,
              pf.name_zh_tw AS field_name,
              fa.checkin_method,
              COALESCE(NULLIF(volunteer.preferred_name, ''), volunteer.legal_name, volunteer.public_nickname, '—') AS volunteer_name,
              fa.student_note
            FROM core.field_attendance fa
            JOIN core.practice_fields pf ON pf.id = fa.field_id
            JOIN identity.people student ON student.id = fa.person_id
            LEFT JOIN identity.people volunteer ON volunteer.id = fa.volunteer_person_id
            ${whereClause}
            ORDER BY fa.checkin_at DESC
            LIMIT 10000
          `;
          const result = await client.query<AttendanceExportRecord>(sql, params);
          return result.rows;
        }
      );

      const csvBuffer = encodeAttendanceCsv(records, locale);
      const fileInfo = attendanceCsvFilename(new Date(), locale);

      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', fileInfo.disposition)
        .send(csvBuffer);
    } catch (err) {
      request.log.error({ err }, 'failed to export attendance CSV');
      return reply.code(500).send({ error: 'failed_to_export_csv' });
    }
  });

  app.get('/admin/api/attendance', async (request, reply) => {
    headers(reply);
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });

    const queryResult = attendanceExportQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.code(400).send({ error: 'invalid_query_parameters' });
    }

    const { startDate, start_date, endDate, end_date, fieldId, field_id, method } = queryResult.data;
    const effectiveStartDate = startDate ?? start_date;
    const effectiveEndDate = endDate ?? end_date;
    const effectiveFieldId = fieldId ?? field_id;

    try {
      const records = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { principalId, requestId: request.id },
        async (client) => {
          const conditions: string[] = [];
          const params: unknown[] = [];

          if (effectiveFieldId) {
            params.push(effectiveFieldId);
            conditions.push(`fa.field_id = $${params.length}::uuid`);
          }
          if (effectiveStartDate) {
            params.push(`${effectiveStartDate} 00:00:00+08`);
            conditions.push(`fa.checkin_at >= $${params.length}::timestamptz`);
          }
          if (effectiveEndDate) {
            params.push(`${effectiveEndDate} 23:59:59+08`);
            conditions.push(`fa.checkin_at <= $${params.length}::timestamptz`);
          }
          if (method) {
            params.push(method);
            conditions.push(`fa.checkin_method = $${params.length}`);
          }

          const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
          const sql = `
            SELECT
              fa.id,
              fa.checkin_at,
              COALESCE(NULLIF(student.preferred_name, ''), student.legal_name, student.public_nickname, '未命名學員') AS student_name,
              pf.code AS field_code,
              pf.name_zh_tw AS field_name,
              fa.checkin_method,
              COALESCE(NULLIF(volunteer.preferred_name, ''), volunteer.legal_name, volunteer.public_nickname, '—') AS volunteer_name,
              fa.student_note
            FROM core.field_attendance fa
            JOIN core.practice_fields pf ON pf.id = fa.field_id
            JOIN identity.people student ON student.id = fa.person_id
            LEFT JOIN identity.people volunteer ON volunteer.id = fa.volunteer_person_id
            ${whereClause}
            ORDER BY fa.checkin_at DESC
            LIMIT 500
          `;
          const result = await client.query<AttendanceExportRecord>(sql, params);
          return result.rows;
        }
      );

      return { attendance: records };
    } catch (err) {
      request.log.error({ err }, 'failed to list attendance records');
      return reply.code(500).send({ error: 'failed_to_list_attendance' });
    }
  });

  app.get('/admin/attendance', async (request, reply) => {
    const locale = resolveAdminLocale(request.query, request.headers.cookie);
    const principalId = await principalFor(request);
    if (!principalId) {
      return reply.header('cache-control', 'no-store').redirect('/admin/auth/login');
    }
    const html = renderAdminShell(
      'attendance',
      `<div class="card"><div class="brand-title"><h2>團練出席紀錄與報表</h2></div><p class="muted">查詢各場地學員簽到歷程、核實志工，並匯出標準出席報表 CSV 檔案。</p><div style="margin-top:1.5rem"><a href="/admin/attendance/export.csv" class="button" style="display:inline-block;padding:8px 16px;background:var(--admin-secondary);color:#fff;border-radius:6px;text-decoration:none;">匯出出席紀錄 CSV</a></div><div id="attendance-app"></div></div>`,
      `// Attendance Manager loaded`,
      locale,
      false,
      true
    );
    return reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', adminContentSecurityPolicy)
      .type('text/html; charset=utf-8')
      .send(html);
  });
};
