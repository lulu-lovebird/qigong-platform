import { Script } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { renderAdminAccessPage, renderAccessPendingPage } from '../src/admin-access-pages.js';
import { adminAccessTexts } from '../src/admin-access-locale.js';
import type { AdminLocale } from '../src/admin-locale.js';
type Handler = (event: { preventDefault: () => void }) => unknown;
interface Node {
  tag: string;
  children: Node[];
  textContent: string;
  value: string;
  hidden: boolean;
  disabled: boolean;
  type: string;
  style: Record<string, string>;
  attributes: Record<string, string>;
  listeners: Map<string, Handler>;
  append(...nodes: Node[]): void;
  replaceChildren(): void;
  setAttribute(key: string, value: string): void;
  addEventListener(event: string, handler: Handler): void;
  querySelector(tag: string): Node | undefined;
}
const node = (tag = 'div'): Node => {
  let text = '';
  const n: Node = {
    tag,
    children: [],
    get textContent() {
      return text + this.children.map((c) => c.textContent).join(' ');
    },
    set textContent(v) {
      text = v;
      this.children = [];
    },
    value: '',
    hidden: false,
    disabled: false,
    type: '',
    style: {},
    attributes: {},
    listeners: new Map(),
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren() {
      this.children = [];
      text = '';
    },
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    addEventListener(event, handler) {
      this.listeners.set(event, handler);
    },
    querySelector(tag) {
      return this.children.find((c) => c.tag === tag);
    }
  };
  return n;
};
const descendants = (n: Node): Node[] => [n, ...n.children.flatMap(descendants)];
const settle = async () => {
  for (let i = 0; i < 8; i++) await setImmediate();
};
const actor = '11111111-1111-4111-8111-111111111111';
const applicant = '22222222-2222-4222-8222-222222222222';
const region = '33333333-3333-4333-8333-333333333333';
const cohort = '44444444-4444-4444-8444-444444444444';
const unsafe = '<img src=x onerror=alert(1)>';
const fixture = (
  html: string,
  kind: 'pending' | 'manage',
  locale: AdminLocale,
  state = 'draft',
  authority: 'super' | 'master' | 'protected' = 'super'
) => {
  const fields = new Map<string, Node>();
  for (const m of html.matchAll(/id="([^"]+)"/g)) fields.set(m[1]!, node());
  if (fields.has('access-filter')) fields.get('access-filter')!.value = 'pending';
  fields.get('request')?.append(node('button'));
  const tags: string[] = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let data: unknown = { ok: true };
    if (path.endsWith('/auth/me')) data = { principalId: actor };
    if (path.endsWith('/access/status'))
      data = {
        principalId: applicant,
        name: unsafe,
        status: state,
        version: 2,
        requestedRole: 'regional_admin',
        scopeDescription: '',
        applicantReason: '',
        decisionReason: state === 'rejected' ? '原文理由' : null
      };
    if (path.includes('/access/accounts?') && !init?.method)
      data = {
        page: 1,
        total: 1,
        entries: [
          {
            principalId: applicant,
            name: unsafe,
            email: 'verified@example.com',
            issuer: 'https://auth.example',
            subject: 'opaque-uid',
            status: 'pending',
            canManage: authority !== 'protected',
            accountStatus: 'active',
            version: 2,
            requestedRole: 'regional_admin',
            scopeDescription: 'Request scope',
            applicantReason: 'Applicant text',
            grants: []
          }
        ],
        regions: [{ id: region, nameZhTw: '甲區', nameEn: 'Region A' }],
        cohorts: [{ id: cohort, name: '原文班級', regionId: region }],
        roles: [
          { code: 'regional_admin', permissions: ['learner.read', 'stats.read'] },
          { code: 'global_viewer', permissions: ['learner.read', 'checkin.read', 'stats.read'] },
          { code: 'coach_admin', permissions: ['checkin.read_private_note'] },
          ...(authority === 'super'
            ? [
                {
                  code: 'master_admin',
                  permissions: ['checkin.read_private_note', 'admin_access.manage']
                }
              ]
            : [])
        ]
      };
    return new Response(JSON.stringify(data), { status: 200 });
  });
  const location = {
    href: 'https://platform.example/admin/administrators?lang=' + locale,
    assign: vi.fn()
  };
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error('No inline script');
  new Script(source).runInNewContext({
    fetch: fetchMock,
    URL,
    location,
    confirm: () => true,
    document: {
      cookie: '__Host-qigong-admin-csrf=csrf-test',
      getElementById: (id: string) => fields.get(id),
      createElement: (tag: string) => {
        tags.push(tag);
        return node(tag);
      }
    }
  });
  return { fields, fetchMock, location, tags, kind };
};
const event = (n: Node, type: string) => n.listeners.get(type)?.({ preventDefault: () => {} });
const body = (request: RequestInit | undefined): unknown => {
  if (typeof request?.body !== 'string') throw new Error('No JSON body');
  return JSON.parse(request.body);
};
describe('administrator access generated browser behavior', () => {
  it.each(['zh_TW', 'en'] as const)(
    'renders %s data as text and submits global private-read scope without region or cohort fields',
    async (locale) => {
      const f = fixture(renderAdminAccessPage(locale), 'manage', locale);
      await settle();
      const ui = adminAccessTexts(locale);
      const card = f.fields.get('accounts')!;
      expect(card.textContent).toContain(unsafe);
      expect(f.tags).not.toContain('img');
      const role = descendants(card).find(
        (n) => n.tag === 'select' && n.attributes['aria-label'] === ui.role
      )!;
      role.value = 'coach_admin';
      event(role, 'change');
      expect(card.textContent).toContain(ui.privateNoteRead);
      const scope = descendants(card).find(
        (n) => n.tag === 'select' && n.attributes['aria-label'] === ui.scope
      )!;
      expect(scope.hidden).toBe(true);
      expect(scope.disabled).toBe(true);
      scope.value = region;
      const reason = descendants(card).find((n) => n.tag === 'input')!;
      reason.value = '身份與班級已核對';
      const approve = descendants(card).find(
        (n) => n.tag === 'button' && n.textContent === ui.approve
      )!;
      event(approve, 'click');
      await settle();
      const write = f.fetchMock.mock.calls.find(
        ([url, init]) =>
          String(typeof url === 'string' ? url : '').endsWith('/decision') &&
          init?.method === 'POST'
      );
      expect(body(write?.[1])).toEqual({
        version: 2,
        decision: 'approved',
        role: 'coach_admin',
        reason: '身份與班級已核對'
      });
      expect(write?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'csrf-test' });
      expect(
        f.fetchMock.mock.calls.every(([url]) => typeof url !== 'string' || !url.includes(unsafe))
      ).toBe(true);
    }
  );
  it.each(['zh_TW', 'en'] as const)(
    'sends only rejection metadata and never submits a selected role for %s rejection',
    async (locale) => {
      const f = fixture(renderAdminAccessPage(locale), 'manage', locale);
      await settle();
      const card = f.fields.get('accounts')!;
      const ui = adminAccessTexts(locale);
      descendants(card).find((n) => n.tag === 'input')!.value = '未通過核對';
      event(
        descendants(card).find((n) => n.tag === 'button' && n.textContent === ui.reject)!,
        'click'
      );
      await settle();
      const write = f.fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(body(write?.[1])).toEqual({ version: 2, decision: 'rejected', reason: '未通過核對' });
    }
  );
  it.each(['zh_TW', 'en'] as const)(
    'submits the pending %s request without granting permissions and uses the shared CSRF logout',
    async (locale) => {
      const f = fixture(renderAccessPendingPage(locale), 'pending', locale);
      await settle();
      expect(f.fields.get('identity')!.textContent).toContain(unsafe);
      expect(f.tags).not.toContain('img');
      f.fields.get('role')!.value = 'coach_admin';
      f.fields.get('scope')!.value = '希望管理甲區班級';
      f.fields.get('reason')!.value = '教練身份已申請';
      await event(f.fields.get('request')!, 'submit');
      const write = f.fetchMock.mock.calls.find(([url]) => url === '/admin/access/request');
      expect(body(write?.[1])).toEqual({
        version: 2,
        role: 'coach_admin',
        scopeDescription: '希望管理甲區班級',
        reason: '教練身份已申請'
      });
      await event(f.fields.get('logout')!, 'click');
      expect(f.location.assign).toHaveBeenCalledWith('/admin/auth/login');
    }
  );
  it.each(['zh_TW', 'en'] as const)(
    'does not offer master delegation or protected-account edits in %s',
    async (locale) => {
      const f = fixture(renderAdminAccessPage(locale), 'manage', locale, 'draft', 'master');
      await settle();
      const ui = adminAccessTexts(locale);
      const card = f.fields.get('accounts')!;
      const role = descendants(card).find(
        (n) => n.tag === 'select' && n.attributes['aria-label'] === ui.role
      )!;
      expect(role.children.map((n) => n.value)).not.toContain('master_admin');
      role.value = 'global_viewer';
      event(role, 'change');
      expect(card.textContent).not.toContain(ui.privateNoteRead);
      const scope = descendants(card).find(
        (n) => n.tag === 'select' && n.attributes['aria-label'] === ui.scope
      )!;
      expect(scope.hidden).toBe(true);
      role.value = 'regional_admin';
      event(role, 'change');
      expect(scope.hidden).toBe(false);
      expect(scope.value).toBe('');
      expect(scope.children[1]?.textContent).toBe(locale === 'en' ? 'Region A' : '甲區');
      const locked = fixture(renderAdminAccessPage(locale), 'manage', locale, 'draft', 'protected');
      await settle();
      const lockedCard = locked.fields.get('accounts')!;
      expect(lockedCard.textContent).toContain(ui.protected);
      expect(
        descendants(lockedCard).filter(
          (n) => n.tag === 'button' || n.tag === 'input' || n.tag === 'select'
        )
      ).toEqual([]);
    }
  );
  it('approved pending accounts see a fresh-login action rather than an editable form or automatic privilege switch', async () => {
    const f = fixture(renderAccessPendingPage('en'), 'pending', 'en', 'approved');
    await settle();
    expect(f.fields.get('request')!.hidden).toBe(true);
    expect(f.fields.get('login')!.hidden).toBe(false);
    expect(f.fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    expect(f.location.assign).not.toHaveBeenCalled();
  });
});
