import type { Locale } from './ui-localization.js';
import { uiText } from './ui-localization.js';
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const fields = (value: unknown, locale: Locale, keys: readonly string[]): unknown => {
  if (!object(value)) return value;
  const result: Record<string, unknown> = { ...value };
  for (const key of keys)
    if (typeof result[key] === 'string') result[key] = uiText(locale, result[key]);
  return result;
};
// Explicit presentation-only paths. Never recursively translate arbitrary name/alias/note/reason fields.
// Feeling labels are selected from stored translations/snapshots by SQL, never converted here.
export const localizeSystemLabels = (locale: Locale, value: unknown): unknown => {
  if (locale !== 'zh_CN' || !object(value)) return value;
  const result: Record<string, unknown> = { ...value };
  const regions = ['region', 'regionName', 'region_name'];
  for (const key of regions)
    if (typeof result[key] === 'string') result[key] = uiText(locale, result[key]);
  for (const key of ['rows', 'entries', 'grants', 'top', 'streaks', 'applications'])
    if (Array.isArray(result[key]))
      result[key] = result[key].map((item) => fields(item, locale, regions));
  for (const key of ['methods', 'badges', 'mix'])
    if (Array.isArray(result[key]))
      result[key] = result[key].map((item) => {
        const label =
          key === 'badges' && object(item) && item.provenance === 'published_snapshot'
            ? item
            : fields(item, locale, ['name', 'group', 'parent_name']);
        if (key === 'methods' && object(label) && typeof label.name_zh_tw === 'string')
          return {
            ...label,
            name_zh_cn: uiText(locale, label.name_zh_tw),
            parent_name_zh_cn:
              typeof label.parent_name_zh_tw === 'string'
                ? uiText(locale, label.parent_name_zh_tw)
                : null
          };
        return label;
      });
  // Region options are system metadata, not editable tag names or learner identity fields.
  for (const key of ['regions', 'countries'])
    if (Array.isArray(result[key]))
      result[key] = result[key].map((item) => {
        const localized = fields(item, locale, ['name', 'region_name']);
        if (object(localized) && typeof localized.nameZhTw === 'string')
          return { ...localized, nameZhCn: uiText(locale, localized.nameZhTw) };
        return localized;
      });
  if (object(result.person)) result.person = fields(result.person, locale, regions);
  if (Array.isArray(result.analyses))
    result.analyses = result.analyses.map((item: unknown) =>
      object(item) && Array.isArray(item.methods)
        ? {
            ...item,
            methods: item.methods.map((method) => fields(method, locale, ['name', 'parent_name']))
          }
        : item
    );
  return result;
};
