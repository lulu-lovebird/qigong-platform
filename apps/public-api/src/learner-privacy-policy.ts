import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { LearnerLocale } from './learner-locale.js';

export const learnerPrivacyVersion = 'baiyin-checkin-supplement-v1';
export const learnerPrivacyContact = { name: '邱伶婷', email: 'eqibaiyin@gmail.com' } as const;
export const officialPrivacyUrl = 'https://app.getterms.io/view/4ZncR/privacy/en-us';
const documents = {
  zh: readFileSync(
    new URL('../../../docs/legal/checkin-helper-supplement.zh-TW.md', import.meta.url),
    'utf8'
  ),
  en: readFileSync(
    new URL('../../../docs/legal/checkin-helper-supplement.en.md', import.meta.url),
    'utf8'
  )
};
export const learnerPrivacyHash = createHash('sha256')
  .update(JSON.stringify({ version: learnerPrivacyVersion, ...documents }))
  .digest('hex');
export const learnerPrivacyDocument = (locale: LearnerLocale): string =>
  locale === 'en' ? documents.en : documents.zh;
