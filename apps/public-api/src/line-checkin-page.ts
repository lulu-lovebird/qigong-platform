import { renderCheckinPage, type CheckinPageQuery } from './checkin-page.js';

export const lineCheckinPage = (liffId: string, query?: CheckinPageQuery) =>
  renderCheckinPage({ platform: 'line', liffId }, query);

