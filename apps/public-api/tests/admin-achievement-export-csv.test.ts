import { describe, expect, it } from 'vitest';
import {
  achievementCsvFilename,
  achievementExportInput,
  csvCell,
  encodeAchievementCsv,
  exportFiltersSchema,
  personalExportSchema,
  type PersonalExport
} from '../src/admin-achievement-export.js';
const data = (): PersonalExport => ({
  code: 'streak_3',
  name: '連續練功 3 天',
  ruleVersion: 1,
  count: 1,
  rows: [
    {
      lineId: 'U123',
      telegramId: '01234567890123456789',
      whatsappId: '659900000001',
      name: '姓名 "quoted", line\nsecond',
      phone: '+886912345678',
      email: 'synthetic@example.invalid',
      periods: '2025;2026',
      contactStatus: 'matched_current_application'
    }
  ]
});
describe('Bounded UTF8 CSV personal export presentation', () => {
  it('uses BOM, quoted RFC4180 fields, CRLF and unchanged source objects', () => {
    const value = data(),
      before = JSON.stringify(value),
      csv = encodeAchievementCsv(value, 'zh_CN');
    expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = csv.toString('utf8');
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text).toContain('"姓名 ""quoted"", line\nsecond"');
    expect(text).toContain('"连续练功 3 天"');
    expect(text).toContain('"2025;2026"');
    expect(JSON.stringify(value)).toBe(before);
  });
  it('guards IDs and phone strings without rounding, stripping zeros or treating plus as a formula', () => {
    const text = encodeAchievementCsv(data(), 'en').toString('utf8');
    expect(text).toContain('"\'01234567890123456789"');
    expect(text).toContain('"\'+886912345678"');
    expect(text).toContain('"\'U123"');
    expect(text).toContain('"synthetic@example.invalid"');
    expect(text).not.toContain('1.234567890123');
  });
  it.each([
    '=1+1',
    '+SUM(1,2)',
    '-2+3',
    '@SUM(1,2)',
    '  =1+1',
    '\t=1+1',
    '\r=1+1',
    '\n=1+1',
    '\u200b=1+1',
    '\0=1+1'
  ])('neutralizes leading spreadsheet execution markers %j', (value) => {
    const cell = csvCell(value);
    expect(cell.startsWith('"\'')).toBe(true);
    expect(cell.endsWith('"')).toBe(true);
  });
  it('leaves absent data truly blank and does not invent contacts or platform IDs', () => {
    const value = data();
    value.rows[0] = {
      lineId: '',
      telegramId: '',
      whatsappId: '',
      name: 'Basic name',
      phone: '',
      email: '',
      periods: 'lifetime',
      contactStatus: 'missing_current_application'
    };
    const text = encodeAchievementCsv(value, 'zh_TW').toString('utf8');
    expect(text).toContain('\r\n"","","","Basic name","","",');
    expect(csvCell('', true)).toBe('""');
  });
  it('includes the achievement in a safe localized filename with an ASCII fallback', () => {
    const result = achievementCsvFilename(
      'streak_3',
      '連續練功 3 天',
      'zh_CN',
      new Date('2026-10-18T09:30:00Z')
    );
    expect(result.filename).toBe('成就_连续练功 3 天_streak_3_20261018T093000Z.csv');
    expect(result.disposition).toContain('filename="achievement-streak_3-20261018T093000Z.csv"');
    expect(result.disposition).toContain("filename*=UTF-8''");
    const hostile = achievementCsvFilename('streak_3', '../name"\r\nInjected:\u202e/\\', 'en');
    expect(/[\r\n\\/\u202e]/u.test(hostile.filename)).toBe(false);
    expect(/[\r\n]/u.test(hostile.disposition)).toBe(false);
  });
  it('rejects wrong metadata counts, unconfirmed purposes and current-page-only parameters', () => {
    expect(personalExportSchema.safeParse({ ...data(), count: 2 }).success).toBe(false);
    for (const value of [
      { confirmed: false, purpose: 'award_contact' },
      { confirmed: true, purpose: 'public_broadcast' },
      { confirmed: true, purpose: 'award_contact', page: 1 },
      { confirmed: true, purpose: 'award_contact', unexpected: 'secret' }
    ])
      expect(achievementExportInput.safeParse(value).success).toBe(false);
    expect(
      achievementExportInput.safeParse({
        confirmed: true,
        purpose: 'award_contact',
        q: 'literal_%'
      }).success
    ).toBe(true);
    expect(exportFiltersSchema.safeParse({ page: 1 }).success).toBe(false);
  });
  it('refuses an oversize output rather than returning a partial file', () => {
    const value = data();
    value.count = 250;
    value.rows = Array.from({ length: 250 }, () => ({
      ...value.rows[0]!,
      name: 'x'.repeat(50000)
    }));
    expect(() => encodeAchievementCsv(value, 'en')).toThrow('achievement export too large');
  });
});
