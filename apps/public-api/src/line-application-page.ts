import { renderApplicationPage } from './application-page.js';

export const lineApplicationPage = (liffId: string) =>
  renderApplicationPage({ platform: 'line', liffId });
