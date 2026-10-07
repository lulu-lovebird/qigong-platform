import { renderCheckinPage } from './checkin-page.js';

export const lineCheckinPage = (liffId: string) => renderCheckinPage({ platform: 'line', liffId });
