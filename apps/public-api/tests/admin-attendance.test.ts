/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { Pool } from '@qigong/database';
import { apiLogRedaction, buildApp } from '../src/app.js';
import { registerAdminRoutes, type AdminAuthProvider } from '../src/admin-auth.js';
import {
  activeTimeRulesSchema,
  createFieldInputSchema,
  updateFieldInputSchema,
  defaultActiveTimeRules,
  generateFieldNfcUrl,
  generateFieldQrCodeUrl,
  buildFieldUrls
} from '../src/admin-field-routes.js';
import {
  registerAdminAttendanceRoutes,
  encodeAttendanceCsv,
  formatCheckinMethod,
  formatAttendanceDate,
  csvCell,
  attendanceCsvFilename,
  attendanceExportQuerySchema,
  type AttendanceExportRecord
} from '../src/admin-attendance-routes.js';
import { renderAdminShell } from '../src/admin-dashboard.js';

// Actual report routes consume the factory returned by real admin-auth. No
// service/runner mock and no pg instance, credentials, migration or external API.
describe('attendance routes → cookie-bound service → controlled runner', () => {
  const session = 'S'.repeat(43);
  const region = '20000000-0000-4000-8000-000000000001';
  const otherRegion = '20000000-0000-4000-8000-000000000002';
  const principal = '40000000-0000-4000-8000-000000000001';
  const cookie = `__Host-qigong-admin=${session}`;
  const filters = `regionId=${region}&startDate=2026-10-31&endDate=2026-10-31`;
  const createFixture = () => {
    vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', 'false');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('external API forbidden');
      })
    );
    const state: {
      principal: string | null;
      failure: 'quarantine' | 'diagnostic' | 'success';
      deniedOperation: 'read' | 'export' | undefined;
      version: string;
    } = {
      principal,
      failure: 'quarantine',
      deniedOperation: undefined,
      version: '0049_venue_attendance_security_contract.sql'
    };
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      if (sql === 'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1')
        return { rows: [{ version: state.version }] };
      if (sql === 'SELECT admin.session_principal($1) AS principal_id')
        return { rows: [{ principal_id: values?.[0] === session ? state.principal : null }] };
      if (sql === 'SELECT admin.venue_attendance_read_attendance($1, $2, $3, $4, $5) AS data') {
        if (
          values?.[1] === otherRegion ||
          state.deniedOperation === (values?.[4] === true ? 'export' : 'read')
        )
          throw Object.assign(new Error('venue_attendance_forbidden'), { code: '42501' });
        if (state.failure === 'diagnostic') throw new Error(`SECRET_DB ${session} private learner`);
        if (state.failure === 'success')
          return { rows: [{ data: { token: session, phone: 'SECRET_PHONE' } }] };
        throw Object.assign(new Error('venue_attendance_quarantined'), { code: '55000' });
      }
      if (
        !['BEGIN', 'ROLLBACK', 'COMMIT', 'SET LOCAL ROLE qigong_api_runtime'].includes(sql) &&
        !sql.startsWith("SELECT set_config('qigong.")
      )
        throw new Error('unexpected SQL');
      return { rows: [] };
    });
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query, release }));
    const rawQuery = vi.fn(() => {
      throw new Error('raw pool query forbidden');
    });
    const pool = { connect, query: rawQuery } as unknown as Pool;
    const logs: string[] = [];
    const app = Fastify({
      genReqId: () => '30000000-0000-4000-8000-000000000001',
      logger: {
        level: 'info',
        redact: apiLogRedaction,
        stream: { write: (line: string) => logs.push(line) }
      }
    });
    const forbiddenIdentity = vi.fn(async (): Promise<string | null> => {
      throw new Error('API must authenticate with real session');
    });
    const provider: AdminAuthProvider = {
      callbackUrl: 'https://admin.example.test/admin/auth/callback',
      begin: async () => {
        throw new Error('external auth forbidden');
      },
      complete: async () => {
        throw new Error('external auth forbidden');
      }
    };
    const { venueAdminServiceFor } = registerAdminRoutes(app, pool, provider);
    registerAdminAttendanceRoutes(app, pool, forbiddenIdentity, undefined, venueAdminServiceFor);
    const h = {
      app,
      pool,
      provider,
      state,
      query,
      connect,
      release,
      rawQuery,
      forbiddenIdentity,
      logs
    };
    return h;
  };
  const fixtures: ReturnType<typeof createFixture>[] = [];
  const fixture = () => {
    const h = createFixture();
    fixtures.push(h);
    return h;
  };
  afterEach(async () => {
    for (const h of fixtures.splice(0)) {
      await h.app.close();
      expect(h.rawQuery).not.toHaveBeenCalled();
      expect(h.forbiddenIdentity).not.toHaveBeenCalled();
      expect(h.release).toHaveBeenCalledTimes(h.connect.mock.calls.length);
      expect(h.logs.join('')).not.toMatch(
        new RegExp(`${session}|SECRET_DB|SECRET_PHONE|private learner`)
      );
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it.each([
    '/admin/api/attendance',
    '/admin/attendance/export.csv',
    '/admin/api/attendance/capabilities',
    '/admin/attendance'
  ])('executes real runner denial for %s without rows or CSV', async (path) => {
    const h = fixture();
    const response = await h.app.inject({ url: `${path}?${filters}`, headers: { cookie } });
    expect(response.statusCode).toBe(503);
    if (path === '/admin/attendance') {
      expect(response.body).toContain('<dd>—</dd>');
      expect(response.body).not.toContain('查無符合條件');
    } else expect(response.json()).toEqual({ error: 'quarantined' });
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(response.headers['content-type']).not.toContain('text/csv');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(h.query).toHaveBeenCalledWith('SELECT admin.session_principal($1) AS principal_id', [
      session
    ]);
    expect(h.query).toHaveBeenCalledWith(
      'SELECT admin.venue_attendance_read_attendance($1, $2, $3, $4, $5) AS data',
      [session, region, '2026-10-31', '2026-11-01', path.endsWith('export.csv')]
    );
    expect(h.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
  });
  it.each([
    '',
    `__Host-qigong-admin=${principal}`,
    `__Host-qigong-admin-access=${session}`,
    `__Host-qigong-admin=${session}; __Host-qigong-admin=${session}`
  ])('does not use bearer/header/query identity as a session: %s', async (badCookie) => {
    const h = fixture();
    const response = await h.app.inject({
      url: `/admin/attendance/export.csv?${filters}`,
      headers: {
        cookie: badCookie,
        authorization: `Bearer ${session}`,
        'x-principal-id': principal
      }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthenticated' });
    expect(response.headers['content-disposition']).toBeUndefined();
    expect(h.connect).not.toHaveBeenCalled();
  });
  it.each([
    'fieldId=10000000-0000-4000-8000-000000000001',
    'field_id=10000000-0000-4000-8000-000000000001',
    'method=nfc_gps',
    'page=1',
    'limit=20'
  ])('rejects unsupported filter %s rather than issuing an unfiltered export', async (filter) => {
    const h = fixture();
    for (const path of [
      '/admin/api/attendance',
      '/admin/attendance/export.csv',
      '/admin/attendance'
    ]) {
      const response = await h.app.inject({
        url: `${path}?${filters}&${filter}`,
        headers: { cookie }
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'unsupported_filters' });
      expect(response.headers['content-disposition']).toBeUndefined();
    }
    expect(h.connect).not.toHaveBeenCalled();
  });
  it.each([
    '',
    'regionId=invalid',
    `${filters}&regionId=${otherRegion}`,
    `${filters}&principalId=${principal}`,
    `${filters}&sessionToken=${session}`,
    `regionId=${region}&startDate=2026-02-29`,
    `regionId=${region}&month=2026-10&endDate=2026-10-31`
  ])('requires explicit unambiguous region and strict query %s', async (filter) => {
    const h = fixture();
    const response = await h.app.inject({
      url: `/admin/attendance/export.csv?${filter}`,
      headers: { cookie }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_attendance_parameters' });
    expect(h.connect).not.toHaveBeenCalled();
  });
  it.each([
    ['month=2024-02', '2024-02-01', '2024-03-01', 503],
    ['start_date=2026-10-31&end_date=2026-10-31', '2026-10-31', '2026-11-01', 503],
    ['startDate=2024-01-01&endDate=2024-12-31', '2024-01-01', '2025-01-01', 503],
    ['startDate=2024-01-01&endDate=2025-01-01', '', '', 400]
  ] as const)(
    'maps inclusive UI dates to half-open Taipei dates within 366 days: %s',
    async (dates, from, until, status) => {
      const h = fixture();
      const response = await h.app.inject({
        url: `/admin/attendance/export.csv?regionId=${region}&${dates}`,
        headers: { cookie }
      });
      expect(response.statusCode).toBe(status);
      if (status === 503)
        expect(h.query).toHaveBeenCalledWith(
          'SELECT admin.venue_attendance_read_attendance($1, $2, $3, $4, $5) AS data',
          [session, region, from, until, true]
        );
      else expect(h.connect).not.toHaveBeenCalled();
    }
  );
  it('checks read/export separately on every call and never falls back after cross-region denial or revocation', async () => {
    const h = fixture();
    h.state.deniedOperation = 'export';
    const read = await h.app.inject({
      url: `/admin/api/attendance?${filters}`,
      headers: { cookie }
    });
    expect(read.statusCode).toBe(503);
    const deniedExport = await h.app.inject({
      url: `/admin/attendance/export.csv?${filters}`,
      headers: { cookie }
    });
    expect(deniedExport.statusCode).toBe(403);
    expect(deniedExport.json()).toEqual({ error: 'forbidden' });
    h.state.deniedOperation = 'read';
    expect(
      (await h.app.inject({ url: `/admin/api/attendance?${filters}`, headers: { cookie } }))
        .statusCode
    ).toBe(403);
    const cross = await h.app.inject({
      url: `/admin/attendance/export.csv?${filters.replace(region, otherRegion)}`,
      headers: { cookie }
    });
    expect(cross.statusCode).toBe(403);
    h.state.principal = null;
    const revoked = await h.app.inject({
      url: `/admin/attendance/export.csv?${filters}`,
      headers: { cookie }
    });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json()).toEqual({ error: 'unauthenticated' });
    expect(
      h.query.mock.calls.filter(([sql]) => sql.includes('admin.session_principal'))
    ).toHaveLength(5);
    expect(
      h.query.mock.calls
        .filter(([sql]) => sql.includes('admin.venue_attendance_read_attendance'))
        .map(([, values]) => values?.[4])
    ).toEqual([false, true, false, true]);
  });
  it.each(['diagnostic', 'success'] as const)(
    'quarantines unexpected DB %s without private output or attachment',
    async (failure) => {
      const h = fixture();
      h.state.failure = failure;
      const response = await h.app.inject({
        url: `/admin/attendance/export.csv?${filters}`,
        headers: { cookie }
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'unavailable' });
      expect(response.headers['content-disposition']).toBeUndefined();
      expect(response.headers['content-type']).not.toContain('text/csv');
      expect(h.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
    }
  );
  it('keeps actual buildApp routes and manual writes unmounted while NFC is off', async () => {
    const h = fixture();
    vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', undefined);
    const app = buildApp({ pool: h.pool, adminAuth: h.provider, logger: false });
    try {
      for (const url of [
        '/admin/api/fields',
        '/admin/api/attendance',
        '/admin/attendance/export.csv',
        '/admin/attendance/manual'
      ])
        expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(404);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/admin/api/attendance',
            payload: { personId: principal }
          })
        ).statusCode
      ).toBe(404);
      expect(h.connect).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it.each([
    ['0048_nfc_attendance_security_quarantine.sql', 'nfc_security_quarantined'],
    ['0049_venue_attendance_security_contract.sql', 'nfc_schema_not_ready']
  ])('actual buildApp still refuses opt-in on %s', async (version, reason) => {
    const h = fixture();
    h.state.version = version;
    vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', 'true');
    const app = buildApp({ pool: h.pool, adminAuth: h.provider, logger: false });
    try {
      await expect(app.ready()).rejects.toThrow(reason);
      expect(app.hasRoute({ method: 'GET', url: '/admin/api/fields' })).toBe(false);
      expect(app.hasRoute({ method: 'GET', url: '/admin/api/attendance' })).toBe(false);
      expect(h.query.mock.calls.some(([sql]) => sql.includes('admin.venue_attendance_'))).toBe(
        false
      );
    } finally {
      await app.close();
    }
  });
});

describe('Admin Field & Attendance Management', () => {
  describe('Field Management Data Structures & Validation', () => {
    it('validates activeTimeRules with valid weekend schedule', () => {
      const validRules = {
        day_of_week: [0, 6],
        start_time: '06:30',
        end_time: '09:00'
      };
      const parsed = activeTimeRulesSchema.parse(validRules);
      expect(parsed.day_of_week).toEqual([0, 6]);
      expect(parsed.start_time).toBe('06:30');
      expect(parsed.end_time).toBe('09:00');
    });

    it('rejects activeTimeRules when end_time is earlier than or equal to start_time', () => {
      expect(() =>
        activeTimeRulesSchema.parse({
          day_of_week: [6],
          start_time: '09:00',
          end_time: '06:30'
        })
      ).toThrow(/end_time must be strictly after start_time/);

      expect(() =>
        activeTimeRulesSchema.parse({
          day_of_week: [6],
          start_time: '07:00',
          end_time: '07:00'
        })
      ).toThrow(/end_time must be strictly after start_time/);
    });

    it('rejects activeTimeRules with invalid time format or invalid day of week', () => {
      expect(() =>
        activeTimeRulesSchema.parse({
          day_of_week: [7], // 7 is invalid (0-6)
          start_time: '06:30',
          end_time: '09:00'
        })
      ).toThrow();

      expect(() =>
        activeTimeRulesSchema.parse({
          day_of_week: [0],
          start_time: '25:00', // 25 is invalid hour
          end_time: '09:00'
        })
      ).toThrow();

      expect(() =>
        activeTimeRulesSchema.parse({
          day_of_week: [], // empty
          start_time: '06:30',
          end_time: '09:00'
        })
      ).toThrow();
    });

    it('validates complete practice field creation input and applies defaults', () => {
      const input = {
        region_id: 'a0000000-0000-4000-8000-000000000001',
        code: 'TW-TPE-DAAN',
        name_zh_tw: '大安森林公園',
        name_en: 'Daan Forest Park',
        latitude: 25.033,
        longitude: 121.535
      };

      const parsed = createFieldInputSchema.parse(input);
      expect(parsed.code).toBe('TW-TPE-DAAN');
      expect(parsed.name_zh_tw).toBe('大安森林公園');
      expect(parsed.name_en).toBe('Daan Forest Park');
      expect(parsed.radius_meters).toBe(50); // default
      expect(parsed.is_active).toBe(true); // default
      expect(parsed.active_time_rules).toEqual(defaultActiveTimeRules);
    });

    it('rejects field creation with invalid coordinates or code characters', () => {
      expect(() =>
        createFieldInputSchema.parse({
          region_id: 'a0000000-0000-4000-8000-000000000001',
          code: 'TW TPE INVALID', // spaces not allowed
          name_zh_tw: '無效代碼場地',
          latitude: 25.033,
          longitude: 121.535
        })
      ).toThrow();

      expect(() =>
        createFieldInputSchema.parse({
          region_id: 'a0000000-0000-4000-8000-000000000001',
          code: 'TW-TPE-LAT',
          name_zh_tw: '超界緯度場地',
          latitude: 95.0, // > 90
          longitude: 121.535
        })
      ).toThrow();
    });

    it('validates partial update input schema', () => {
      const partial = updateFieldInputSchema.parse({
        radius_meters: 100,
        is_active: false
      });
      expect(partial.radius_meters).toBe(100);
      expect(partial.is_active).toBe(false);
      expect(partial.code).toBeUndefined();
    });
  });

  describe('NFC & QR Code URL Generation', () => {
    // Entry previews now match line-venue-checkin-page.ts; these are not attendance credentials.
    it('does not generate an entry URL without LIFF configuration', () => {
      expect(generateFieldNfcUrl('tw-tpe-daan')).toBe('');
      expect(generateFieldQrCodeUrl('tw-tpe-daan')).toBe('');
    });

    it('ignores the legacy custom base URL rather than providing an unsafe fallback', () => {
      const options = { baseUrl: 'https://staging.baiyinqigong.org/' };
      expect(generateFieldNfcUrl('tw-khh-arena', options)).toBe('');
      expect(generateFieldNfcUrl('tw-khh-arena', { ...options, liffId: '123-liff' })).toBe(
        'https://liff.line.me/123-liff/venue-checkin?venue=tw-khh-arena&source=nfc'
      );
    });

    it('generates a venue/source LIFF preview URL when liffId is provided', () => {
      const url = generateFieldNfcUrl('tw-txg-park', {
        liffId: '2001234567-AbCdEfG'
      });
      expect(url).toBe(
        'https://liff.line.me/2001234567-AbCdEfG/venue-checkin?venue=tw-txg-park&source=nfc'
      );
    });

    it('rejects special characters and legacy field codes without silently rewriting them', () => {
      for (const code of ['TW TPE+SPECIAL#1', 'TW-TPE-DAAN', 'tw_tpe_daan']) {
        expect(generateFieldNfcUrl(code, { liffId: '123-liff' })).toBe('');
        expect(generateFieldQrCodeUrl(code, { liffId: '123-liff' })).toBe('');
      }
    });

    it('returns only a QR target URL, never a third-party image URL', () => {
      const qrUrl = generateFieldQrCodeUrl('tw-tpe-daan', {
        liffId: '123-liff',
        qrCodeSize: 400,
        baseUrl: 'https://untrusted.invalid'
      });
      expect(qrUrl).toBe('https://liff.line.me/123-liff/venue-checkin?venue=tw-tpe-daan&source=qr');
      expect(qrUrl).not.toMatch(/qrserver|untrusted|size=|data=/);
    });

    it('buildFieldUrls distinguishes NFC, QR and link preview sources', () => {
      const bundle = buildFieldUrls('tw-tpe-daan', { liffId: '123-liff' });
      const target = 'https://liff.line.me/123-liff/venue-checkin?venue=tw-tpe-daan&source=';
      expect(bundle).toEqual({
        nfc_url: target + 'nfc',
        qrcode_url: target + 'qr',
        target_url: target + 'link'
      });
      expect(Object.isFrozen(bundle)).toBe(true);
    });

    it('rejects unsafe LIFF configuration for every preview source', () => {
      for (const liffId of [
        '../bad',
        'https://untrusted.invalid',
        '123?redirect=bad',
        '<script>'
      ]) {
        expect(buildFieldUrls('tw-tpe-daan', { liffId })).toEqual({
          nfc_url: '',
          qrcode_url: '',
          target_url: ''
        });
      }
    });
  });

  describe('Attendance CSV Export', () => {
    const mockAttendanceRecords: AttendanceExportRecord[] = [
      {
        id: 'b0000000-0000-0000-0000-000000000001',
        checkin_at: new Date('2026-10-24T06:45:00.000Z'),
        student_name: '陳小明',
        field_code: 'TW-TPE-DAAN',
        field_name: '大安森林公園',
        checkin_method: 'nfc_gps',
        volunteer_name: null
      },
      {
        id: 'b0000000-0000-0000-0000-000000000002',
        checkin_at: new Date('2026-10-24T07:15:30.000Z'),
        student_name: '林美華',
        field_code: 'TW-TPE-DAAN',
        field_name: '大安森林公園',
        checkin_method: 'volunteer_manual',
        volunteer_name: '張志工'
      }
    ];

    it('encodes attendance CSV with UTF-8 BOM, required headers, and localized methods', () => {
      const buffer = encodeAttendanceCsv(mockAttendanceRecords, 'zh_TW');
      const csv = buffer.toString('utf8');

      // BOM verification
      expect(csv.startsWith('\uFEFF')).toBe(true);

      // Header verification
      const lines = csv.replace('\uFEFF', '').split('\r\n');
      expect(lines[0]).toBe(
        '"簽到日期時間","學員姓名","場地代碼","場地名稱","簽到方式","核實志工"'
      );

      // Row 1 verification: NFC GPS
      expect(lines[1]).toContain('"陳小明"');
      expect(lines[1]).toContain(csvCell('TW-TPE-DAAN', true));
      expect(lines[1]).toContain('"大安森林公園"');
      expect(lines[1]).toContain('"NFC_GPS"');
      expect(lines[1]).toContain('"—"'); // no volunteer

      // Row 2 verification: Volunteer Manual
      expect(lines[2]).toContain('"林美華"');
      expect(lines[2]).toContain(csvCell('TW-TPE-DAAN', true));
      expect(lines[2]).toContain('"志工補簽"');
      expect(lines[2]).toContain('"張志工"');
    });

    it('encodes English headers and method names when locale is en', () => {
      const buffer = encodeAttendanceCsv(mockAttendanceRecords, 'en');
      const csv = buffer.toString('utf8').replace('\uFEFF', '');
      const lines = csv.split('\r\n');

      expect(lines[0]).toBe(
        '"Check-in Time","Learner Name","Field Code","Field Name","Check-in Method","Verified By"'
      );
      expect(lines[1]).toContain('"NFC_GPS"');
      expect(lines[2]).toContain('"Volunteer Manual"');
    });

    it('defends against CSV spreadsheet formula injection', () => {
      const maliciousRecords: AttendanceExportRecord[] = [
        {
          id: 'c0000000-0000-0000-0000-000000000001',
          checkin_at: '2026-10-24 07:00:00',
          student_name: '=cmd|"/C calc"!A0',
          field_code: '+TW-MALICIOUS',
          field_name: '@HYPERLINK("http://evil.com")',
          checkin_method: '-test',
          volunteer_name: '\t@admin'
        }
      ];

      const buffer = encodeAttendanceCsv(maliciousRecords, 'zh_TW');
      const csv = buffer.toString('utf8').replace('\uFEFF', '');
      const lines = csv.split('\r\n');
      const dataRow = lines[1];

      // All formula injection characters must be prefixed with apostrophe '
      expect(dataRow).toContain('"\x27=cmd|""/C calc""!A0"');
      expect(dataRow).toContain('"\x27+TW-MALICIOUS"');
      expect(dataRow).toContain('"\x27@HYPERLINK(""http://evil.com"")"');
    });

    it('generates filename with ISO timestamp and Content-Disposition header', () => {
      const fixedDate = new Date('2026-10-24T08:30:00.000Z');
      const fileInfo = attendanceCsvFilename(fixedDate, 'zh_TW');

      expect(fileInfo.filename).toBe('團練出席報表_20261024T083000Z.csv');
      expect(fileInfo.disposition).toContain('filename="attendance-20261024T083000Z.csv"');
      expect(fileInfo.disposition).toContain("filename*=UTF-8''");
    });

    it('validates attendance query filters', () => {
      const validQuery = {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        fieldId: 'a0000000-0000-4000-8000-000000000001',
        method: 'nfc_gps',
        lang: 'zh_TW'
      };
      const parsed = attendanceExportQuerySchema.parse(validQuery);
      expect(parsed.startDate).toBe('2026-10-01');
      expect(parsed.method).toBe('nfc_gps');

      expect(() =>
        attendanceExportQuerySchema.parse({
          startDate: 'invalid-date'
        })
      ).toThrow();
    });

    it('formats attendance date in Taipei time zone', () => {
      const utcDate = new Date('2026-10-24T00:30:00.000Z');
      // UTC 00:30 is 08:30 in Asia/Taipei (UTC+8)
      const formatted = formatAttendanceDate(utcDate);
      expect(formatted).toBe('2026-10-24 08:30:00');
    });

    it('formatCheckinMethod handles unknown methods gracefully', () => {
      expect(formatCheckinMethod('custom_method')).toBe('custom_method');
    });

    it('csvCell safely handles null, numbers, and quotes', () => {
      expect(csvCell(null)).toBe('""');
      expect(csvCell(12345)).toBe('"12345"');
      expect(csvCell('Hello "World"')).toBe('"Hello ""World"""');
    });
  });

  describe('Admin Dashboard Navigation (not server authorization)', () => {
    it('includes capability-hidden venue navigation when the feature shell is requested', () => {
      const html = renderAdminShell('overview', '', '', 'zh_TW', false, true);

      expect(html).toContain('/admin/attendance?lang=zh_TW');
      expect(html).toContain('/admin/fields?lang=zh_TW');
      expect(html).toContain('團練場出席管理 · 出席報表');
      expect(html).toContain('團練場出席管理 · 場地設定');
      expect(html).toContain('data-fields-nav hidden');
      expect(html).toContain('data-attendance-nav hidden');
      expect(html).toContain('Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting');
    });

    it('renders fieldSchedule page shell with proper page title and active page marker', () => {
      const html = renderAdminShell('fieldSchedule', '<div id="test">Content</div>', '', 'zh_TW');

      expect(html).toContain('<title>團練場出席管理｜白雁氣功管理平台</title>');
      expect(html).toContain('<h1>團練場出席管理</h1>');
      expect(html).toContain(
        'href="/admin/fields?lang=zh_TW" class="journal-nav" data-fields-nav hidden aria-current="page"'
      );
    });

    it('renders attendance page shell with proper English localization', () => {
      const html = renderAdminShell('attendance', '<div id="test">Content</div>', '', 'en');

      expect(html).toContain(
        '<title>Group Practice Attendance · Reports｜Qigong Admin Dashboard</title>'
      );
      expect(html).toContain('<h1>Group Practice Attendance · Reports</h1>');
      expect(html).toContain(
        'href="/admin/attendance?lang=en" class="journal-nav" data-attendance-nav hidden aria-current="page"'
      );
    });
  });
});
