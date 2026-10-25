/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

import { describe, expect, it } from 'vitest';
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
  encodeAttendanceCsv,
  formatCheckinMethod,
  formatAttendanceDate,
  csvCell,
  attendanceCsvFilename,
  attendanceExportQuerySchema,
  type AttendanceExportRecord
} from '../src/admin-attendance-routes.js';
import { renderAdminShell } from '../src/admin-dashboard.js';

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
