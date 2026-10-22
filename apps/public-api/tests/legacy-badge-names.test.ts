import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  legacyBadgeNames,
  legacyBadgeDisplayName,
  addLegacyBadgeDisplayNames,
  type LegacyBadgeName
} from '../src/legacy-badge-names.js';
import { uiText, type Locale } from '../src/ui-localization.js';
import { encodeAchievementCsv } from '../src/admin-achievement-export.js';

const original = z
  .object({ names: z.record(z.string(), z.string()) })
  .parse(
    JSON.parse(
      readFileSync(new URL('./fixtures/legacy-line-badge-catalog.json', import.meta.url), 'utf8')
    )
  );
const source = (entry: LegacyBadgeName, locale: Locale = 'zh_TW') => ({
  code: entry.code,
  name: locale === 'en' ? entry.originalEn : entry.originalZhTw,
  kind: entry.kind,
  threshold: entry.threshold,
  methodCodes: [...entry.methodCodes],
  ruleVersion: 1,
  configurationKnown: true
});
const method = legacyBadgeNames.find((e) => e.code === 'method_dayan_100');
if (!method) throw Error('Missing expected source mapping');

describe('traceable legacy badge display aliases', () => {
  it('maps exactly49 old identities,33 exact method-day codes and8 explicit code changes', () => {
    expect(legacyBadgeNames).toHaveLength(49);
    expect(new Set(legacyBadgeNames.map((e) => e.code)).size).toBe(49);
    expect(new Set(legacyBadgeNames.map((e) => e.legacyCode))).toEqual(
      new Set(Object.keys(original.names))
    );
    expect(legacyBadgeNames.filter((e) => e.kind === 'method')).toHaveLength(33);
    expect(legacyBadgeNames.filter((e) => e.code !== e.legacyCode)).toHaveLength(8);
    for (const e of legacyBadgeNames) expect(e.title).toBe(original.names[e.legacyCode]);
    expect(legacyBadgeNames.find((e) => e.code === 'combo_jinggong_7')?.methodCodes).toEqual([
      'jinggong_zhoutian',
      'jinggong_qixing',
      'jinggong_songjing'
    ]);
  });
  it.each(
    legacyBadgeNames.flatMap((entry) =>
      (['zh_TW', 'zh_CN', 'en'] as const).map((locale) => ({ entry, locale }))
    )
  )('uses only the verified $entry.code/$locale v1 default label', ({ entry, locale }) => {
    expect(legacyBadgeDisplayName(source(entry, locale), locale)).toBe(
      uiText(locale, original.names[entry.legacyCode]!)
    );
    const badge = source(entry, locale),
      before = structuredClone(badge);
    const result = addLegacyBadgeDisplayNames({ versioned: true, badges: [badge] }, locale);
    expect(result.badges).toEqual([{ ...badge, displayName: uiText(locale, entry.title) }]);
    expect(badge).toEqual(before);
  });
  it.each([
    { ruleVersion: 2 },
    { ruleVersion: '1' },
    { ruleVersion: undefined },
    { configurationKnown: false },
    { configurationKnown: undefined },
    { provenance: 'published_snapshot' },
    { provenance: 'unknown_legacy' },
    { provenance: 'custom' },
    { continuous: false },
    { methodMatch: 'any' },
    { effectiveDate: '2026-10-22' },
    { startDate: null },
    { endDate: null },
    { progressStartDate: '2026-10-22' },
    { activationState: 'published' },
    { name: 'Publisher custom name' },
    { threshold: 99 },
    { kind: 'challenge' },
    { code: '__proto__' },
    { code: 'challenge_12345678901234567890123456789012' },
    { methodCodes: ['dayan_chu'] },
    { methodCodes: ['dayan_chu', 'dayan_chu'] },
    { methodCodes: ['dayan_chu', 'dayan_gao', 'new_leaf'] }
  ])('fails closed for changed, unknown or custom metadata: %j', (patch) => {
    const badge = { ...source(method), ...patch, displayName: 'stale alias' };
    expect(legacyBadgeDisplayName(badge, 'zh_TW')).toBeUndefined();
    const data = addLegacyBadgeDisplayNames({ versioned: true, badges: [badge] }, 'zh_TW');
    expect(data.badges).toEqual([{ ...source(method), ...patch }]);
  });
  it('does not infer English/Chinese original names or alias unversioned42 fallback', () => {
    expect(legacyBadgeDisplayName(source(method), 'en')).toBeUndefined();
    expect(addLegacyBadgeDisplayNames({ badges: [source(method)] }, 'zh_TW').badges).toEqual([
      source(method)
    ]);
    expect(
      legacyBadgeDisplayName({ ...source(method), provenance: 'legacy_snapshot' }, 'zh_TW')
    ).toBe('大雁功｜雁歸太和');
  });
  it('decorates known nested versions independently and preserves names, conditions, hashes and awards', () => {
    const current = {
      ...source(method),
      awards: [{ period: 'lifetime', earnedAt: '2026-10-01', revoked: true }],
      snapshotHash: 'frozen',
      versions: [
        source(method),
        {
          ...source(method),
          ruleVersion: 7,
          configurationKnown: false,
          name: 'method_dayan_100 · v7',
          displayName: 'incorrect old alias'
        },
        {
          ...source(method),
          ruleVersion: 2,
          provenance: 'published_snapshot',
          name: '<literal publisher name>'
        }
      ]
    };
    const before = structuredClone(current);
    const result = addLegacyBadgeDisplayNames(
      { versioned: true, badges: [current], people: [{ name: 'Untranslated person' }] },
      'zh_TW'
    );
    expect(result).toEqual({
      versioned: true,
      badges: [
        {
          ...current,
          displayName: method.title,
          versions: [
            { ...source(method), displayName: method.title },
            {
              ...source(method),
              ruleVersion: 7,
              configurationKnown: false,
              name: 'method_dayan_100 · v7'
            },
            {
              ...source(method),
              ruleVersion: 2,
              provenance: 'published_snapshot',
              name: '<literal publisher name>'
            }
          ]
        }
      ],
      people: [{ name: 'Untranslated person' }]
    });
    expect(current).toEqual(before);
  });
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'keeps %s CSV original version names even when a display alias is present',
    (locale) => {
      const data = {
        code: method.code,
        name: locale === 'en' ? method.originalEn : method.originalZhTw,
        ruleVersion: 1,
        displayName: method.title,
        count: 1,
        rows: [
          {
            lineId: '',
            telegramId: 'synthetic',
            whatsappId: '',
            name: 'Synthetic learner',
            phone: '',
            email: '',
            periods: 'lifetime',
            contactStatus: 'missing_current_application' as const
          }
        ]
      };
      const csv = encodeAchievementCsv(data, locale).toString('utf8');
      expect(csv).toContain('"' + uiText(locale, data.name) + '"');
      expect(csv).not.toContain(method.title);
      expect(csv).not.toContain(uiText(locale, method.title));
      expect(csv).toContain('"rule_version"');
    }
  );
});
