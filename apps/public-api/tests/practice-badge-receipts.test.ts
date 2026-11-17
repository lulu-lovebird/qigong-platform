import { describe, expect, it } from 'vitest';
import { buildTelegramPracticeSummary } from '../src/telegram-practice-receipts.js';
import { legacyBadgeNames } from '../src/legacy-badge-names.js';
const entry = legacyBadgeNames.find((v) => v.code === 'combo_zhengyang_7')!;
const badge = {
  code: entry.code,
  name: entry.originalZhTw,
  kind: entry.kind,
  threshold: entry.threshold,
  methodCodes: [...entry.methodCodes],
  configurationKnown: true,
  ruleVersion: 1,
  period: 'lifetime'
};
const payload = {
  date: '2026-11-17',
  action: 'regular',
  locale: 'zh_TW',
  methods: ['正陽功 晨功', '正陽功 夜功'],
  currentStreak: 7,
  totalDays: 7
};
describe('newly unlocked achievements in privacy-safe chat receipts', () => {
  it('includes the same approved Zhengyang combo display name as the achievements UI', () => {
    const text = buildTelegramPracticeSummary({ ...payload, unlockedBadges: [badge] });
    expect(text).toContain('🎉 新解鎖成就：');
    expect(text).toContain(entry.title);
    expect(text).toContain('晨功');
    expect(text).toContain('夜功');
  });
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'keeps secrets and feelings out of %s receipts',
    (locale) => {
      const text = buildTelegramPracticeSummary({
        ...payload,
        locale,
        practiceNote: 'private-note-sentinel',
        feelingTags: ['private-feeling-sentinel'],
        token: 'private-token-sentinel',
        unlockedBadges: [
          {
            ...badge,
            name: locale === 'en' ? entry.originalEn : entry.originalZhTw,
            practiceNote: 'private-badge-note-sentinel'
          }
        ]
      });
      for (const secret of [
        'private-note-sentinel',
        'private-feeling-sentinel',
        'private-token-sentinel',
        'private-badge-note-sentinel'
      ])
        expect(text).not.toContain(secret);
    }
  );
  it.each([{ ruleVersion: 2 }, { provenance: 'published_snapshot' }, { continuous: false }])(
    'never guesses a legacy alias for changed/published metadata %j',
    (extra) => {
      const text = buildTelegramPracticeSummary({
        ...payload,
        unlockedBadges: [{ ...badge, ...extra }]
      });
      expect(text).toContain(entry.originalZhTw);
      expect(text).not.toContain(entry.title);
    }
  );
  it('identifies seasonal periods and different rule versions without collapsing them', () => {
    const text = buildTelegramPracticeSummary({
      ...payload,
      unlockedBadges: [
        { code: 'publisher_badge', name: 'Published achievement', period: '2026', ruleVersion: 3 }
      ]
    });
    expect(text).toContain('Published achievement (2026年) · v3');
  });
  it('does not congratulate when no new award exists', () => {
    expect(buildTelegramPracticeSummary(payload)).not.toContain('🎉');
    expect(buildTelegramPracticeSummary({ ...payload, unlockedBadges: [] })).not.toContain('🎉');
  });
  it('keeps badge names visible before guidance and bounds messages without splitting emoji', () => {
    const text = buildTelegramPracticeSummary({
      ...payload,
      unlockedBadges: Array.from({ length: 200 }, (_, i) => ({
        code: 'custom_' + i,
        name: '成就' + i + '😀'.repeat(200),
        period: 'lifetime',
        ruleVersion: 1
      })),
      guidance: { title: 'Public guidance', content: '😀'.repeat(10000) }
    });
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain('新解鎖成就');
    expect(text).toContain('成就0');
    expect(text).toContain('其餘');
    const last = text.charCodeAt(text.length - 1);
    expect(last >= 0xd800 && last <= 0xdfff).toBe(false);
  });
});
