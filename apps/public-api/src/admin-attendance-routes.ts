/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool } from '@qigong/database';
import { adminContentSecurityPolicy } from './admin-branding.js';
import { resolveAdminLocale } from './admin-locale.js';
import { renderVenueAttendanceReportPage } from './venue-attendance-report-page.js';
import type { VenueAdminService } from './venue-admin-service.js';
import {
  attendanceExportQuerySchema,
  attendanceRange,
  type AttendanceRange
} from './venue-attendance-report.js';

// Preserve the existing public helper imports. New report rendering/encoding is standalone.
export {
  formatCheckinMethod,
  csvCell,
  formatAttendanceDate,
  encodeAttendanceCsv,
  attendanceCsvFilename,
  attendanceExportQuerySchema,
  type AttendanceExportRecord,
  type AttendanceExportQuery
} from './venue-attendance-report.js';

export const attendanceReportingUnavailable = Object.freeze({
  error: 'attendance_reporting_unavailable',
  reason: 'controlled_operation_and_region_scope_not_wired',
  message: '團練場出席管理：受控出席查詢／匯出待接線；NFC 安全隔離維持中。'
});

export const registerAdminAttendanceRoutes = (
  app: FastifyInstance,
  pool: Pool,
  principalFor: (request: FastifyRequest) => Promise<string | null>,
  liffId?: string,
  serviceFor?: (request: FastifyRequest) => VenueAdminService
): void => {
  // Neither pool nor LIFF identity grants attendance access. Production injects
  // the session-bound service; no-service registrations remain unavailable.
  // 0049 is denial-only, never a reason to query quarantined tables directly.
  void pool;
  void liffId;
  const headers = (reply: FastifyReply): FastifyReply =>
    reply
      .header('cache-control', 'no-store')
      .header('pragma', 'no-cache')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff');

  const authenticate = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<string | null | undefined> => {
    try {
      return await principalFor(request);
    } catch {
      // Do not log identity/session errors or DB diagnostics that may contain PII.
      await reply.code(503).send({ error: 'admin_authentication_unavailable' });
      return undefined;
    }
  };

  const controlledRead = async (
    request: FastifyRequest,
    reply: FastifyReply,
    html = false
  ): Promise<FastifyReply> => {
    headers(reply);
    if (!serviceFor) return reply.code(503).send({ error: 'unavailable' });
    const parsed = attendanceExportQuerySchema.safeParse(request.query);
    if (!parsed.success || !parsed.data.regionId)
      return reply.code(400).send({ error: 'invalid_attendance_parameters' });
    // 0049 cannot filter by field/method or paginate. Even valid legacy filters
    // must be rejected, not silently converted into an unfiltered operation.
    if (
      ['fieldId', 'field_id', 'method', 'page', 'limit'].some((key) =>
        Object.hasOwn(request.query as object, key)
      )
    )
      return reply.code(400).send({ error: 'unsupported_filters' });
    let range: AttendanceRange;
    try {
      range = attendanceRange(parsed.data);
    } catch {
      return reply.code(400).send({ error: 'invalid_attendance_parameters' });
    }
    const result = await serviceFor(request).execute({
      operation:
        request.routeOptions.url === '/admin/attendance/export.csv'
          ? 'attendance.export'
          : 'attendance.read',
      regionId: parsed.data.regionId,
      from: range.startDate,
      // UI endDate is inclusive; the runner requires half-open Taipei dates and
      // enforces <=366 days. Do not convert to UTC or add a day twice.
      until: range.endExclusive.slice(0, 10)
    });
    if (html && result.status !== 401) {
      return reply
        .code(result.status)
        .type('text/html; charset=utf-8')
        .send(
          renderVenueAttendanceReportPage(
            parsed.data,
            range,
            {
              status:
                result.status === 400 ? 'invalid' : result.status === 403 ? 'denied' : 'unavailable'
            },
            resolveAdminLocale(request.query, request.headers.cookie)
          )
        );
    }
    // Denials never produce rows, success CSV headers or an attachment.
    return reply.code(result.status).send(result.body);
  };

  app.get('/admin/api/attendance/capabilities', async (request, reply) => {
    if (serviceFor) return controlledRead(request, reply);
    headers(reply);
    const principalId = await authenticate(request, reply);
    if (principalId === undefined) return reply;
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    // Fail closed even for a logged-in global administrator. This is NOT an ACL verdict.
    return reply
      .code(503)
      .send({ ...attendanceReportingUnavailable, canRead: false, canExport: false });
  });

  const unavailableRead = async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply> => {
    if (serviceFor) return controlledRead(request, reply);
    headers(reply);
    const principalId = await authenticate(request, reply);
    if (principalId === undefined) return reply;
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    const parsed = attendanceExportQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_attendance_parameters' });
    try {
      attendanceRange(parsed.data);
    } catch {
      return reply.code(400).send({ error: 'invalid_attendance_parameters' });
    }
    // No records, fake empty success, CSV attachment or privileged query on unavailable scope.
    return reply.code(503).send(attendanceReportingUnavailable);
  };
  app.get('/admin/api/attendance', unavailableRead);
  app.get('/admin/attendance/export.csv', unavailableRead);

  app.get('/admin/attendance', async (request, reply) => {
    headers(reply).header('content-security-policy', adminContentSecurityPolicy);
    if (serviceFor) return controlledRead(request, reply, true);
    const principalId = await authenticate(request, reply);
    if (principalId === undefined) return reply;
    if (!principalId) return reply.redirect('/admin/auth/login');
    const locale = resolveAdminLocale(request.query, request.headers.cookie);
    const parsed = attendanceExportQuerySchema.safeParse(request.query);
    let query = parsed.success ? parsed.data : attendanceExportQuerySchema.parse({});
    let range: AttendanceRange;
    let invalid = !parsed.success;
    try {
      range = attendanceRange(query);
    } catch {
      invalid = true;
      query = attendanceExportQuerySchema.parse({});
      range = attendanceRange(query);
    }
    // Shell access exposes no attendance data. Future reads MUST independently check
    // action + field operational region + dated learner scope in a runtime transaction.
    return reply
      .code(invalid ? 400 : 503)
      .type('text/html; charset=utf-8')
      .send(
        renderVenueAttendanceReportPage(
          query,
          range,
          { status: invalid ? 'invalid' : 'unavailable' },
          locale
        )
      );
  });
};
