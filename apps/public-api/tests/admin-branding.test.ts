import { describe, expect, it } from 'vitest';
import {
  adminBrandColors,
  adminContentSecurityPolicy,
  adminLogoUrl,
  renderAdminLogo
} from '../src/admin-branding.js';
import { renderAdminDashboard, type AdminPage } from '../src/admin-dashboard.js';
import { renderReviewPage } from '../src/admin-pages.js';
import { renderAccessPendingPage, renderAdminAccessPage } from '../src/admin-access-pages.js';
import { renderAdminJournalPage } from '../src/admin-journal-pages.js';
import { renderAdminLearnerPage } from '../src/admin-learner-pages.js';
import { renderReviewNotificationPage } from '../src/admin-review-notification-page.js';
import { renderAdminLineInvites } from '../src/admin-line-invite-pages.js';
import { renderAdminAchievementsPage } from '../src/admin-achievement-page.js';
import type { AdminLocale } from '../src/admin-locale.js';

const renderers: Readonly<Record<AdminPage, (locale: AdminLocale) => string>> = {
  overview: (locale) => renderAdminDashboard('overview', locale, true),
  leaderboard: (locale) => renderAdminDashboard('leaderboard', locale, true),
  achievements: (locale) => renderAdminAchievementsPage(locale, true),
  methods: (locale) => renderAdminDashboard('methods', locale, true),
  review: (locale) => renderReviewPage(locale, true),
  access: renderAdminAccessPage,
  journal: (locale) => renderAdminJournalPage('journal', locale, true),
  tags: (locale) => renderAdminJournalPage('tags', locale, true),
  learners: (locale) => renderAdminLearnerPage('learners', locale, true),
  shared: (locale) => renderAdminLearnerPage('shared', locale, true),
  privacy: (locale) => renderAdminLearnerPage('privacy', locale, true),
  invites: renderAdminLineInvites,
  notifications: (locale) => renderReviewNotificationPage(locale, true)
};
const oldColors = /#(?:285c3b|203027|193e2b|366448|62976e|61746b|edf3ee|82352f|a12c24)\b/i;
const luminance = (hex: string) => {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels.reduce(
    (total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index]!,
    0
  );
};
const contrast = (a: string, b: string) => {
  const values = [luminance(a), luminance(b)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
};

describe('Admin brand consistency and image isolation', () => {
  it.each(Object.entries(renderers))(
    'brands both locales of %s without changing navigation or user content',
    (_page, render) => {
      for (const locale of ['zh_TW', 'en'] as const) {
        const html = render(locale);
        for (const color of Object.values(adminBrandColors)) expect(html).toContain(color);
        expect(html).not.toMatch(oldColors);
        expect(html).toContain(renderAdminLogo(locale));
        expect(html).toContain(
          '<div class="brand-title">' + renderAdminLogo(locale) + '<span class="brand-title-text">'
        );
        expect(html).toContain('height:1em;');
        expect(html).toContain('flex:0 0 1em; margin:0;');
        expect(html).toContain('align-items:center; gap:.45em; line-height:1;');
        expect(html).not.toContain('.sidebar .admin-logo { width:80px; }');
        expect(html.indexOf('class="admin-logo"')).toBeGreaterThan(
          html.indexOf('<aside class="sidebar">')
        );
        expect(html.indexOf('class="admin-logo"')).toBeLessThan(
          html.indexOf('id="admin-navigation"')
        );
        expect(html).toContain('referrerpolicy="no-referrer"');
        expect(html).toContain('width="112" height="112"');
        expect(html).toContain('object-fit:contain');
        expect(html).toContain('aspect-ratio:1');
        expect(html).toContain('max-width:760px');
        expect(html).toContain('.card,article { min-width:0;');
        expect(html).toContain('border:2px dashed var(--brand-deep)');
        expect(html).toContain('id="admin-language"');
        expect(html).toContain('id="logout"');
      }
    }
  );
  it.each(['zh_TW', 'en'] as const)(
    'brands the standalone pending %s page without exposing admin navigation',
    (locale) => {
      const html = renderAccessPendingPage(locale);
      for (const color of Object.values(adminBrandColors)) expect(html).toContain(color);
      expect(html).not.toMatch(oldColors);
      expect(html).toContain(renderAdminLogo(locale));
      expect(html).not.toContain('id="admin-navigation"');
      expect(html).not.toContain('<div class="brand-title">');
      expect(html).not.toContain('/admin/api/reports');
      expect(html).toContain('id="pending-language"');
      expect(html).toContain('id="request" hidden');
    }
  );
  it('allows only the specified logo image while retaining other CSP restrictions', () => {
    expect(adminLogoUrl).toBe('https://e-qi.org/wp-content/uploads/2024/09/light-mode-logo.png');
    expect(adminContentSecurityPolicy.split(';').map((value) => value.trim())).toEqual([
      "default-src 'none'",
      'img-src ' + adminLogoUrl,
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'"
    ]);
    expect(adminContentSecurityPolicy).not.toContain('*');
    expect(renderAdminLogo('en')).not.toContain('onerror=');
  });
  it.each([
    [adminBrandColors.primary, '#ffffff', 4.5],
    [adminBrandColors.secondary, '#ffffff', 4.5],
    [adminBrandColors.secondary, '#eef4f8', 4.5],
    [adminBrandColors.primary, adminBrandColors.accent, 4.5],
    [adminBrandColors.accent, adminBrandColors.deep, 4.5],
    ['#ffffff', adminBrandColors.deep, 4.5],
    [adminBrandColors.secondary, adminBrandColors.accent, 3]
  ] as const)('maintains contrast for %s against %s', (foreground, background, minimum) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });
});
