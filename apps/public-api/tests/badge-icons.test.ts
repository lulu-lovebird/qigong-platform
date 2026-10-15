import { describe, expect, it } from 'vitest';
import { badgeIcons, fallbackBadgeIcon } from '../src/badge-icons.js';

// Legacy reference: qigong-line-bot/schema.sql; method/combo migrations 008/005.
// Kept in this repository so CI does not depend on a sibling checkout.
const legacyIcons: ReadonlyArray<readonly [string, string]> = [
  ['streak_3', '🥉'],
  ['streak_7', '🥈'],
  ['streak_21', '🥇'],
  ['streak_100', '💎'],
  ['total_10', '🌱'],
  ['total_100', '🌳'],
  ['time_morning', '🌅'],
  ['time_night', '🦉'],
  ['seasonal_summer_27', '☀️'],
  ['seasonal_winter_27', '❄️'],
  ['combo_dayan', '🦢'],
  ['combo_wuqinxi', '🐅'],
  ['combo_huichun', '🌱'],
  ['combo_guishou', '🐢'],
  ['combo_zhengyang', '☀️'],
  ['combo_jinggong', '🧘'],
  ['method_dayan_7', '🪶'],
  ['method_dayan_30', '🪽'],
  ['method_dayan_100', '🌤️'],
  ['method_wuqinxi_7', '🕊️'],
  ['method_wuqinxi_30', '🐾'],
  ['method_wuqinxi_100', '🦚'],
  ['method_huichun_7', '🌱'],
  ['method_huichun_30', '🍃'],
  ['method_huichun_100', '🌿'],
  ['method_guishou_7', '🐢'],
  ['method_guishou_30', '🪷'],
  ['method_guishou_100', '🏞️'],
  ['method_zhengyang_7', '🌅'],
  ['method_zhengyang_30', '☀️'],
  ['method_zhengyang_100', '🌞'],
  ['method_huanghai_7', '🌊'],
  ['method_huanghai_30', '🌌'],
  ['method_huanghai_100', '🌐'],
  ['method_lotus_7', '🪷'],
  ['method_lotus_30', '💮'],
  ['method_lotus_100', '🌺'],
  ['method_heqi_7', '🍀'],
  ['method_heqi_30', '🌫️'],
  ['method_heqi_100', '🌈'],
  ['method_sanwo_7', '🌀'],
  ['method_sanwo_30', '🫧'],
  ['method_sanwo_100', '🪨'],
  ['method_liuyin_7', '🎵'],
  ['method_liuyin_30', '🎶'],
  ['method_liuyin_100', '🔔'],
  ['method_jinggong_7', '🧘'],
  ['method_jinggong_30', '🪷'],
  ['method_jinggong_100', '🌌']
];
const platformCode = (code: string) =>
  code.startsWith('combo_')
    ? code + '_7'
    : code.replace(/^seasonal_(summer|winter)_27$/, 'seasonal_$1');
describe('Shared legacy badge icons', () => {
  it('preserves every legacy icon with explicit platform code aliases', () => {
    expect(legacyIcons).toHaveLength(49);
    expect(Object.keys(badgeIcons).sort()).toEqual(
      legacyIcons.map(([code]) => platformCode(code)).sort()
    );
    for (const [code, icon] of legacyIcons) expect(badgeIcons[platformCode(code)]).toBe(icon);
    expect(badgeIcons.seasonal_summer).toBe('☀️');
    expect(badgeIcons.seasonal_winter).toBe('❄️');
    expect(badgeIcons.combo_dayan_7).toBe('🦢');
    expect(badgeIcons.combo_jinggong_7).toBe('🧘');
  });
  it('covers the existing 49-code catalog rather than guessing by badge name or language', () => {
    const groups = [
      'dayan',
      'wuqinxi',
      'huichun',
      'guishou',
      'zhengyang',
      'huanghai',
      'lotus',
      'heqi',
      'sanwo',
      'liuyin',
      'jinggong'
    ];
    const combos = ['dayan', 'wuqinxi', 'huichun', 'guishou', 'zhengyang', 'jinggong'];
    const codes = [
      ...[3, 7, 21, 100].map((n) => 'streak_' + n),
      ...[10, 100].map((n) => 'total_' + n),
      'time_morning',
      'time_night',
      'seasonal_summer',
      'seasonal_winter',
      ...groups.flatMap((g) => [7, 30, 100].map((n) => 'method_' + g + '_' + n)),
      ...combos.map((g) => 'combo_' + g + '_7')
    ];
    expect(Object.keys(badgeIcons).sort()).toEqual(codes.sort());
  });
  it('retains complete Unicode emoji graphemes and uses a neutral future-code fallback', () => {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    for (const icon of Object.values(badgeIcons)) {
      expect([...segmenter.segment(icon)]).toHaveLength(1);
      expect(icon).not.toMatch(/[<>]/);
      expect(icon).not.toBe('🔒');
      expect(icon).not.toBe('🏆');
    }
    expect(fallbackBadgeIcon).toBe('🏅');
    expect(Object.isFrozen(badgeIcons)).toBe(true);
    expect(Object.hasOwn(badgeIcons, 'constructor')).toBe(false);
    expect(Object.hasOwn(badgeIcons, '__proto__')).toBe(false);
  });
});
