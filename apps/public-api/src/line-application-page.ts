import { renderApplicationPage } from './application-page.js';
import type { LearnerLocale } from './learner-locale.js';

export const lineApplicationPage = (liffId: string, locale: LearnerLocale = 'zh_TW') =>
  renderApplicationPage({ platform: 'line', liffId, locale });
