import { localeQuery, type LearnerLocale } from './learner-locale.js';
import { uiDictionary } from './ui-localization.js';
import { helpLabel } from './learner-help-content.js';
export type TelegramFeature =
  'checkin' | 'leaderboard' | 'methods' | 'achievements' | 'journal' | 'help';
const features: ReadonlyArray<TelegramFeature> = [
  'checkin',
  'leaderboard',
  'methods',
  'achievements',
  'journal',
  'help'
];
const aliases: Readonly<Record<string, TelegramFeature>> = {
  checkin: 'checkin',
  leaderboard: 'leaderboard',
  methods: 'methods',
  methodanalysis: 'methods',
  achievements: 'achievements',
  history: 'achievements',
  mystats: 'achievements',
  badges: 'achievements',
  journal: 'journal',
  share: 'journal',
  help: 'help'
};
const paths: Readonly<Record<TelegramFeature, string>> = {
  checkin: '/telegram/checkin',
  leaderboard: '/telegram/leaderboard',
  methods: '/telegram/method-analysis',
  achievements: '/telegram/achievements',
  journal: '/telegram/journal',
  help: '/telegram/help'
};
const labels = {
  zh_TW: {
    checkin: '✅ 開始打卡',
    leaderboard: '🏆 排行榜',
    methods: '📈 功法分析',
    achievements: '🏮 開啟成就頁',
    journal: '📝 練功心得'
  },
  en: {
    checkin: '✅ Start check-in',
    leaderboard: '🏆 Leaderboard',
    methods: '📈 Practice analysis',
    achievements: '🏮 Achievements',
    journal: '📝 Practice journal'
  }
} as const;
export const telegramFeatureButtons = (locale: LearnerLocale, command?: string) => {
  const feature = command ? aliases[command.toLowerCase()] : undefined;
  if (command && !feature) throw Error('Unknown Telegram feature');
  return (feature ? [feature] : features).map((page) => ({
    text:
      page === 'help'
        ? '❓ ' + helpLabel(locale)
        : (locale === 'en' ? labels.en : uiDictionary(locale, labels.zh_TW))[page],
    url: 'https://checkin.baiyinqigong.org' + paths[page] + localeQuery(locale),
    ...(page === 'help' ? { webApp: false } : {})
  }));
};
