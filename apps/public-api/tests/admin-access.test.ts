import { describe, expect, it } from 'vitest';
import { Script } from 'node:vm';
import { renderAccessPendingPage, renderAdminAccessPage } from '../src/admin-access-pages.js';
import { grantSchema, accessRequestSchema, accessDecisionSchema } from '../src/admin-access.js';
import { renderAdminDashboard } from '../src/admin-dashboard.js';
import { adminAccessTexts } from '../src/admin-access-locale.js';
describe('administrator access vocabulary', () => {
  it.each(['zh_TW', 'en'] as const)(
    'generates valid, local-only %s scripts and keeps access navigation manager-only',
    (locale) => {
      for (const html of [renderAccessPendingPage(locale), renderAdminAccessPage(locale)]) {
        const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
        if (!script) throw new Error('No page script');
        expect(() => new Script(script)).not.toThrow();
        expect(html).not.toContain('innerHTML');
        expect(html).toContain('Bean, Bird &amp; Badminton Tech Consulting');
      }
      expect(renderAdminDashboard('overview', locale, false)).not.toContain(
        'href="/admin/administrators'
      );
      expect(renderAdminDashboard('overview', locale, true)).toContain(
        'href="/admin/administrators'
      );
    }
  );
  it('validates role/scope combinations and denies arbitrary permission lists or self-selected super admin roles', () => {
    const id = '12345678-1234-4234-8234-123456789abc';
    expect(
      grantSchema.safeParse({ role: 'regional_admin', regionId: id, reason: 'Verified' }).success
    ).toBe(true);
    expect(
      grantSchema.safeParse({ role: 'regional_viewer', regionId: id, reason: 'Verified' }).success
    ).toBe(true);
    expect(
      grantSchema.safeParse({ role: 'regional_viewer', reason: 'Missing region' }).success
    ).toBe(false);
    expect(
      grantSchema.safeParse({ role: 'regional_viewer', cohortId: id, reason: 'Wrong scope' })
        .success
    ).toBe(false);
    for (const role of ['global_viewer', 'coach_admin', 'master_admin']) {
      expect(grantSchema.safeParse({ role, reason: 'Verified' }).success).toBe(true);
      expect(grantSchema.safeParse({ role, regionId: id, reason: 'Wrong' }).success).toBe(false);
      expect(grantSchema.safeParse({ role, cohortId: id, reason: 'Wrong' }).success).toBe(false);
    }
    for (const body of [
      { role: 'super_admin', reason: 'Promote' },
      { role: 'coach', regionId: id, reason: 'Wrong scope' },
      { role: 'regional_admin', regionId: id, cohortId: id, reason: 'Both scopes' },
      { role: 'coach', cohortId: id, reason: 'Override', permissions: ['stats.read'] }
    ])
      expect(grantSchema.safeParse(body).success).toBe(false);
    expect(
      accessRequestSchema.safeParse({
        version: 1,
        role: 'super_admin',
        scopeDescription: 'Global',
        reason: 'Elevate'
      }).success
    ).toBe(false);
    expect(
      accessDecisionSchema.safeParse({
        version: 1,
        decision: 'rejected',
        reason: 'No',
        role: 'coach'
      }).success
    ).toBe(false);
    expect(
      accessDecisionSchema.safeParse({
        version: 1,
        decision: 'approved',
        role: 'coach',
        regionId: id,
        reason: 'Wrong'
      }).success
    ).toBe(false);
  });
  it('offers all five applicant identities as a single select, never a super-admin option', () => {
    const html = renderAccessPendingPage('zh_TW');
    const options = html.match(/<select id="role">([\s\S]*?)<\/select>/)?.[1];
    expect(options).toBeDefined();
    for (const label of [
      '地區管理員',
      '地區心得檢視員',
      '白雁協會人員',
      '白雁氣功教練',
      '老師（Master）'
    ])
      expect(options).toContain(label);
    expect(options?.match(/<option /g)).toHaveLength(5);
    expect(options).not.toContain('super_admin');
  });
  it('covers both locales and explicitly discloses private note access for coaches', () => {
    const en = adminAccessTexts('en');
    const zh = adminAccessTexts('zh_TW');
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    expect(en.privateNoteRead).toContain('private notes');
    expect(zh.privateNoteRead).toContain('私密心得');
    expect(en.pendingIntro).toContain('approval');
    expect(zh.pendingIntro).toContain('核准');
    for (const dictionary of [en, zh])
      for (const text of Object.values(dictionary)) expect(text.length).toBeGreaterThan(0);
  });
});
