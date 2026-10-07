import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import {
  adminLocale,
  adminLocaleCookie,
  adminLocaleScript,
  adminTexts,
  resolveAdminLocale,
  type AdminTextKey
} from '../src/admin-locale.js';
describe('administrator translations and preference resolution', () => {
  it('provides both languages with matching keys and interpolation parameters', () => {
    const en = adminTexts('en'),
      zh = adminTexts('zh_TW');
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const key of Object.keys(en) as AdminTextKey[]) {
      expect(en[key].length).toBeGreaterThan(0);
      expect(zh[key].length).toBeGreaterThan(0);
      const placeholders = (value: string) =>
        [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]));
    }
  });
  it('prefers a valid URL choice over a saved browser preference and safely defaults on invalid input', () => {
    const cookie = adminLocaleCookie + '=en';
    expect(resolveAdminLocale({}, cookie)).toBe('en');
    expect(resolveAdminLocale({ lang: 'zh_TW' }, cookie)).toBe('zh_TW');
    expect(resolveAdminLocale({ lang: 'en' })).toBe('en');
    expect(resolveAdminLocale({ lang: 'evil' }, cookie)).toBe('en');
    expect(resolveAdminLocale({ lang: ['en', 'zh_TW'] })).toBe('zh_TW');
    expect(resolveAdminLocale(null, adminLocaleCookie + '=__proto__')).toBe('zh_TW');
    expect(adminLocale('<script>')).toBe('zh_TW');
  });
  it('interpolates browser messages once without treating learner names or reasons as templates', () => {
    const result: unknown = vm.runInNewContext(
      adminLocaleScript('en') + "message('personalTitle',{name:'<img src=x> {days}'})"
    );
    expect(result).toBe('<img src=x> {days} · personal method analysis');
  });
});
