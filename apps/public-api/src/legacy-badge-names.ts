import { uiText, type Locale } from './ui-localization.js';

type LegacyKind =
  'streak' | 'total' | 'morning' | 'night' | 'summer' | 'winter' | 'method' | 'combo';
export interface LegacyBadgeName {
  readonly legacyCode: string;
  readonly code: string;
  readonly title: string;
  readonly kind: LegacyKind;
  readonly threshold: number;
  readonly methodCodes: readonly string[];
  readonly originalZhTw: string;
  readonly originalEn: string;
  readonly source:
    | 'schema.sql'
    | 'migrations/005_line_combo_badges.sql'
    | 'migrations/008_line_method_day_badges.sql';
}
const groups = [
  {
    code: 'dayan',
    zh: '大雁功',
    en: 'Dayan',
    leaves: ['dayan_chu', 'dayan_gao'],
    titles: ['大雁功｜雁行入雲', '大雁功｜雁翥沖虛', '大雁功｜雁歸太和'],
    combo: '大雁雙修'
  },
  {
    code: 'wuqinxi',
    zh: '五禽戲',
    en: 'Wuqinxi',
    leaves: ['wuqinxi_he', 'wuqinxi_yuan', 'wuqinxi_hu', 'wuqinxi_xiong', 'wuqinxi_lu'],
    titles: ['五禽戲｜五行啟藏', '五禽戲｜五靈調炁', '五禽戲｜五禽歸真'],
    combo: '五禽圓滿'
  },
  {
    code: 'huichun',
    zh: '回春功',
    en: 'Huichun',
    leaves: ['huichun_chu', 'huichun_zhong'],
    titles: ['回春功｜春芽復炁', '回春功｜春和養真', '回春功｜回春長青'],
    combo: '回春雙式'
  },
  {
    code: 'guishou',
    zh: '龜壽功',
    en: 'Guishou',
    leaves: ['guishou_bagua', 'guishou_qiankun', 'guishou_fengxiang_guishuo'],
    titles: ['龜壽功｜龜息守一', '龜壽功｜龜鶴養元', '龜壽功｜壽炁綿長'],
    combo: '龜壽全式'
  },
  {
    code: 'zhengyang',
    zh: '正陽功',
    en: 'Zhengyang',
    leaves: ['zhengyang_morning', 'zhengyang_night'],
    titles: ['正陽功｜朝陽啟炁', '正陽功｜正陽養正', '正陽功｜陽和充盈'],
    combo: '正陽雙照'
  },
  {
    code: 'huanghai',
    zh: '神奇晃海功',
    en: 'Swaying Sea',
    leaves: ['huanghai'],
    titles: ['晃海功｜晃海聽潮', '晃海功｜海定神凝', '晃海功｜海天一炁']
  },
  {
    code: 'lotus',
    zh: '蓮花養心法',
    en: 'Lotus',
    leaves: ['lotus'],
    titles: ['蓮花養心法｜蓮心初照', '蓮花養心法｜蓮臺澄心', '蓮花養心法｜蓮華見性']
  },
  {
    code: 'heqi',
    zh: '和氣舒壓法',
    en: 'Heqi',
    leaves: ['heqi'],
    titles: ['和氣舒壓法｜和氣舒懷', '和氣舒壓法｜和光同塵', '和氣舒壓法｜氣和神泰']
  },
  {
    code: 'sanwo',
    zh: '三窩功',
    en: 'Sanwo',
    leaves: ['sanwo'],
    titles: ['三窩功｜三窩聚炁', '三窩功｜三田歸元', '三窩功｜窩藏元和']
  },
  {
    code: 'liuyin',
    zh: '六音理臟法',
    en: 'Liuyin',
    leaves: ['liuyin'],
    titles: ['六音理臟法｜六音調藏', '六音理臟法｜六律和臟', '六音理臟法｜六炁周流']
  },
  {
    code: 'jinggong',
    zh: '靜功',
    en: 'Quiet practice',
    leaves: ['jinggong_zhoutian', 'jinggong_qixing', 'jinggong_songjing'],
    titles: ['靜功｜守靜入門', '靜功｜澄心守一', '靜功｜虛極靜篤'],
    combo: '靜功雙法'
  }
] as const;
// Catalog labels only, not claims that the old evaluator and current immutable rules are equivalent.
export const legacyBadgeNames: readonly LegacyBadgeName[] = [
  ...(
    [
      [3, '入門'],
      [7, '小成'],
      [21, '結丹'],
      [100, '百日築基']
    ] as const
  ).map(([n, title]) => ({
    legacyCode: 'streak_' + n,
    code: 'streak_' + n,
    title,
    kind: 'streak' as const,
    threshold: n,
    methodCodes: [],
    originalZhTw: '連續練功 ' + n + ' 天',
    originalEn: n + '-day practice streak',
    source: 'schema.sql' as const
  })),
  ...(
    [
      [10, '初芽'],
      [100, '大樹']
    ] as const
  ).map(([n, title]) => ({
    legacyCode: 'total_' + n,
    code: 'total_' + n,
    title,
    kind: 'total' as const,
    threshold: n,
    methodCodes: [],
    originalZhTw: '累計練功 ' + n + ' 天',
    originalEn: n + ' practice days',
    source: 'schema.sql' as const
  })),
  {
    legacyCode: 'time_morning',
    code: 'time_morning',
    title: '晨露',
    kind: 'morning',
    threshold: 5,
    methodCodes: [],
    originalZhTw: '晨光修練',
    originalEn: 'Morning practice',
    source: 'schema.sql'
  },
  {
    legacyCode: 'time_night',
    code: 'time_night',
    title: '夜靜',
    kind: 'night',
    threshold: 5,
    methodCodes: [],
    originalZhTw: '月下修練',
    originalEn: 'Night practice',
    source: 'schema.sql'
  },
  {
    legacyCode: 'seasonal_summer_27',
    code: 'seasonal_summer',
    title: '夏練三伏',
    kind: 'summer',
    threshold: 27,
    methodCodes: [],
    originalZhTw: '三伏修練',
    originalEn: 'Summer practice',
    source: 'schema.sql'
  },
  {
    legacyCode: 'seasonal_winter_27',
    code: 'seasonal_winter',
    title: '冬練三九',
    kind: 'winter',
    threshold: 27,
    methodCodes: [],
    originalZhTw: '冬至龜壽功',
    originalEn: 'Winter Guishou practice',
    source: 'schema.sql'
  },
  ...groups.flatMap((group) =>
    ([7, 30, 100] as const).map((threshold, index) => ({
      legacyCode: 'method_' + group.code + '_' + threshold,
      code: 'method_' + group.code + '_' + threshold,
      title: group.titles[index]!,
      kind: 'method' as const,
      threshold,
      methodCodes: group.leaves,
      originalZhTw: group.zh + ' ' + threshold + ' 天',
      originalEn: group.en + ' · ' + threshold + ' days',
      source: 'migrations/008_line_method_day_badges.sql' as const
    }))
  ),
  ...groups.flatMap((group) =>
    'combo' in group
      ? [
          {
            legacyCode: 'combo_' + group.code,
            code: 'combo_' + group.code + '_7',
            title: group.combo,
            kind: 'combo' as const,
            threshold: 1,
            methodCodes: group.leaves,
            originalZhTw: group.zh + '全套',
            originalEn: group.en + ' · complete set',
            source: 'migrations/005_line_combo_badges.sql' as const
          }
        ]
      : []
  )
];
const byCode = new Map(legacyBadgeNames.map((entry) => [entry.code, entry]));
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const legacyBadgeDisplayName = (badge: unknown, locale: Locale): string | undefined => {
  if (!object(badge) || typeof badge.code !== 'string') return undefined;
  const entry = byCode.get(badge.code);
  const methods = badge.methodCodes;
  if (
    !entry ||
    badge.ruleVersion !== 1 ||
    badge.configurationKnown !== true ||
    [
      'continuous',
      'methodMatch',
      'effectiveDate',
      'startDate',
      'endDate',
      'progressStartDate',
      'activationState'
    ].some((key) => Object.hasOwn(badge, key)) ||
    (badge.provenance !== undefined &&
      badge.provenance !== null &&
      badge.provenance !== 'legacy_snapshot') ||
    badge.kind !== entry.kind ||
    badge.threshold !== entry.threshold ||
    badge.name !== (locale === 'en' ? entry.originalEn : entry.originalZhTw) ||
    !Array.isArray(methods) ||
    methods.length !== entry.methodCodes.length ||
    !methods.every((code: unknown) => typeof code === 'string') ||
    new Set(methods).size !== entry.methodCodes.length ||
    !entry.methodCodes.every((code) => methods.includes(code))
  )
    return undefined;
  // These whitelisted titles are source-owned UI labels. Publisher names never reach this mapping.
  // The old bot has no English names: retain its literal title rather than invent a translation.
  return uiText(locale, entry.title);
};

export const addLegacyBadgeDisplayNames = (
  data: Record<string, unknown>,
  locale: Locale
): Record<string, unknown> => {
  if (!Array.isArray(data.badges)) return data;
  const decorate = (value: unknown): unknown => {
    if (!object(value)) return value;
    const result = { ...value };
    delete result.displayName;
    const name = data.versioned === true ? legacyBadgeDisplayName(value, locale) : undefined;
    return name === undefined ? result : { ...result, displayName: name };
  };
  return {
    ...data,
    badges: data.badges.map((value: unknown) => {
      const badge = decorate(value);
      return object(badge) && Array.isArray(badge.versions)
        ? { ...badge, versions: badge.versions.map(decorate) }
        : badge;
    })
  };
};

export const legacyBadgeAliasNotice = (locale: Locale): string =>
  locale === 'en'
    ? 'Legacy display name only. Original version / CSV name: {name}'
    : uiText(locale, '僅為舊版顯示別名；版本快照與CSV原名：{name}');
