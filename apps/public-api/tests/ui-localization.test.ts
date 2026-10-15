import { describe, expect, it } from 'vitest';
import { adminAccessTexts } from '../src/admin-access-locale.js';
import { adminTexts } from '../src/admin-locale.js';
import { learnerTexts } from '../src/learner-locale.js';
import { journalTexts } from '../src/journal-locale.js';
import { learnerPrivacyTexts } from '../src/learner-privacy-locale.js';
import { telegramWorkspaceTexts } from '../src/telegram-workspace-locale.js';
import {
  learnerPrivacyDocument,
  learnerPrivacyHash,
  learnerPrivacyVersion
} from '../src/learner-privacy-policy.js';
import { lineUiTemplate } from '../src/line-ui-localization.js';
import { localizeSystemLabels } from '../src/system-label-localization.js';
import {
  htmlLocale,
  intlLocale,
  isLocale,
  languageOptions,
  learnerLocaleCookie,
  normalizeLocale,
  privacyDocumentLocale,
  resolveLocale,
  supportedLocales,
  uiDictionary,
  uiTemplate,
  uiText
} from '../src/ui-localization.js';
describe('Three-locale UI boundary', () => {
  it('keeps all six dictionaries key-complete across three languages and leaves formal legal bytes unchanged', () => {
    for (const dictionary of [
      adminAccessTexts,
      adminTexts,
      learnerTexts,
      journalTexts,
      learnerPrivacyTexts,
      telegramWorkspaceTexts
    ]) {
      const traditional = dictionary('zh_TW'),
        simplified = dictionary('zh_CN'),
        english = dictionary('en');
      expect(Object.keys(simplified).sort()).toEqual(Object.keys(traditional).sort());
      expect(Object.keys(simplified).sort()).toEqual(Object.keys(english).sort());
      expect(
        Object.values(simplified).every((value) => typeof value === 'string' && value.length > 0)
      ).toBe(true);
      expect(simplified).not.toEqual(traditional);
    }
    expect(learnerPrivacyDocument('zh_CN')).toBe(learnerPrivacyDocument('zh_TW'));
    expect(learnerPrivacyVersion).toBe('baiyin-checkin-supplement-v1');
    expect(learnerPrivacyHash).toBe(
      '4a16db1e9eb64f957bf1966be45fbc471c0795a42ec4700c08fa46e8640b1184'
    );
  });
  it('accepts only the canonical three codes, never treating a locale as a region or SQL identifier', () => {
    expect(supportedLocales).toEqual(['zh_TW', 'zh_CN', 'en']);
    for (const locale of supportedLocales) {
      expect(isLocale(locale)).toBe(true);
      expect(normalizeLocale(locale)).toBe(locale);
    }
    for (const value of [
      'zh_SG',
      'zh_MY',
      'zh_cn',
      '__proto__',
      "zh_CN';DROP TABLE x",
      null,
      {},
      []
    ])
      expect(normalizeLocale(value)).toBe('zh_TW');
    expect(htmlLocale('zh_CN')).toBe('zh-Hans');
    expect(intlLocale('zh_CN')).toBe('zh-CN');
  });
  it('resolves explicit query then the presentation cookie then the existing traditional default', () => {
    expect(resolveLocale({ lang: 'zh_CN' }, learnerLocaleCookie + '=en')).toBe('zh_CN');
    expect(resolveLocale({}, learnerLocaleCookie + '=zh_CN')).toBe('zh_CN');
    expect(resolveLocale({ lang: 'invalid' }, learnerLocaleCookie + '=en')).toBe('en');
    expect(resolveLocale({ region: 'sg-general' })).toBe('zh_TW');
  });
  it('translates owned UI text but never interpolated content, even when content equals a UI phrase', () => {
    const content = '練功打卡';
    const secret = 'a'.repeat(43);
    expect(uiText('zh_CN', content)).toBe('练功打卡');
    const rendered = uiTemplate(
      'zh_CN'
    )`練功打卡：${content} ${secret} ${JSON.stringify({ name: '臺灣學員', practiceNote: '我感覺很好' })}`;
    expect(rendered).toBe(
      '练功打卡：' +
        content +
        ' ' +
        secret +
        ' ' +
        JSON.stringify({ name: '臺灣學員', practiceNote: '我感覺很好' })
    );
    expect(uiText('en', content)).toBe(content);
    expect(uiText('zh_TW', content)).toBe(content);
    expect(uiDictionary('zh_CN', { checkin: '練功打卡', count: '{count} 天' })).toEqual({
      checkin: '练功打卡',
      count: '{count} 天'
    });
  });
  it('localizes source-owned LINE fragments, not dynamic names or reasons', () => {
    const name = '姓名',
      reason = '已核准加入。';
    expect(lineUiTemplate('en')`姓名：${name} ${reason}`).toBe('Learner name：姓名 已核准加入。');
    expect(lineUiTemplate('zh_CN')`你已核准，不必重新申請。${reason}`).toBe(
      '你已核准，不必重新申请。已核准加入。'
    );
  });
  it('localizes only live system-label DTO fields and preserves private and historical text', () => {
    const data = {
      methods: [{ code: 'dayan_chu', name: '大雁初級' }],
      badges: [{ code: 'streak_3', name: '連續練功 3 天' }],
      rows: [{ display_name: '練功打卡', region_name: '馬來西亞' }],
      entries: [
        {
          alias: '匿名學員',
          practiceNote: '練功打卡',
          methods: ['大雁初級'],
          feelingTags: [{ name: '練功打卡' }]
        }
      ],
      applications: [{ learner_name: '練功打卡', region_name: '馬來西亞', reason: '練功打卡' }],
      applicantReason: '練功打卡'
    };
    const copy = structuredClone(data),
      result = localizeSystemLabels('zh_CN', data) as typeof data;
    expect(result.methods[0]!.name).toBe('大雁初级');
    expect(result.rows[0]!.region_name).toBe('马来西亚');
    expect(result.rows[0]!.display_name).toBe('練功打卡');
    expect(result.entries).toEqual(data.entries);
    expect(result.applications).toEqual([
      { learner_name: '練功打卡', region_name: '马来西亚', reason: '練功打卡' }
    ]);
    expect(result.applicantReason).toBe(data.applicantReason);
    expect(data).toEqual(copy);
  });
  it('keeps language self-names and preserves original legal-document identity', () => {
    const options = languageOptions('zh_CN');
    expect(options).toContain('value="zh_CN" lang="zh-Hans" selected>简体中文');
    expect(options).toContain('繁體中文');
    expect(options).toContain('English');
    expect(privacyDocumentLocale('zh_CN')).toBe('zh_TW');
    expect(privacyDocumentLocale('en')).toBe('en');
  });
});
