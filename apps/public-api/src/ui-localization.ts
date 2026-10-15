import { z } from 'zod';
import { simplifiedUiPhrases } from './ui-zh-cn.js';
export const supportedLocales = ['zh_TW', 'zh_CN', 'en'] as const;
export type Locale = (typeof supportedLocales)[number];
export const localeSchema = z.enum(supportedLocales);
export const isLocale = (value: unknown): value is Locale =>
  supportedLocales.some((locale) => locale === value);
export const normalizeLocale = (value: unknown): Locale => (isLocale(value) ? value : 'zh_TW');
export const htmlLocale = (locale: Locale) =>
  locale === 'en' ? 'en' : locale === 'zh_CN' ? 'zh-Hans' : 'zh-Hant';
export const intlLocale = (locale: Locale) =>
  locale === 'en' ? 'en-GB' : locale === 'zh_CN' ? 'zh-CN' : 'zh-TW';
export const learnerLocaleCookie = '__Host-qigong-learner-locale';
export const resolveLocale = (
  query: unknown,
  cookieHeader?: string,
  cookieName = learnerLocaleCookie
): Locale => {
  const value =
    typeof query === 'object' && query !== null && 'lang' in query ? query.lang : undefined;
  if (isLocale(value)) return value;
  const saved = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookieName + '='))
    ?.slice(cookieName.length + 1);
  return normalizeLocale(saved);
};
// Call only for source-owned UI literals or explicitly identified live system labels.
// Never pass a rendered page, a learner name/nickname/note/reason or historical snapshot.
export const uiText = (locale: Locale, ownedText: string): string =>
  locale === 'zh_CN'
    ? ownedText.replace(/[\p{Script=Han}]+/gu, (phrase) => simplifiedUiPhrases[phrase] ?? phrase)
    : ownedText;
export const uiDictionary = <T extends Record<string, string>>(
  locale: Locale,
  dictionary: T
): { [K in keyof T]: string } =>
  Object.fromEntries(
    Object.entries(dictionary).map(([key, value]) => [key, uiText(locale, value)])
  ) as { [K in keyof T]: string };
type TemplateValue = string | number | boolean | null | undefined;
// Translate only literal segments. Interpolated values are preserved byte-for-byte.
export const uiTemplate =
  (locale: Locale) =>
  (parts: TemplateStringsArray, ...values: readonly TemplateValue[]): string =>
    parts
      .map(
        (part, index) => uiText(locale, part) + (index < values.length ? String(values[index]) : '')
      )
      .join('');
export const languageOptions = (locale: Locale): string =>
  supportedLocales
    .map(
      (value) =>
        '<option value="' +
        value +
        '" lang="' +
        htmlLocale(value) +
        '"' +
        (locale === value ? ' selected' : '') +
        '>' +
        { zh_TW: '繁體中文', zh_CN: '简体中文', en: 'English' }[value] +
        '</option>'
    )
    .join('');
// A simplified interface is not a new approved legal-document translation.
export const privacyDocumentLocale = (locale: Locale): 'zh_TW' | 'en' =>
  locale === 'en' ? 'en' : 'zh_TW';
