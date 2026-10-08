import { Script } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { renderAdminAccessPage, renderAccessPendingPage } from '../src/admin-access-pages.js';
import { adminAccessTexts } from '../src/admin-access-locale.js';
import { adminTexts, type AdminLocale } from '../src/admin-locale.js';
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
  authority: 'super' | 'master' | 'protected' = 'super',
  options: { total?: number; url?: string } = {}
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
        total: options.total ?? 1,
        entries: [
          {
            principalId: applicant,
            name: unsafe,
            email: 'verified@example.com',
            issuer: 'https://auth.example',
            subject: 'opaque-uid',
            status: state === 'granted' ? 'approved' : 'pending',
            grantVersion: 7,
            canRevokeAll: state === 'granted' && authority !== 'protected',
            canManage: authority !== 'protected',
            accountStatus: 'active',
            version: 2,
            requestedRole: 'regional_admin',
            scopeDescription: 'Request scope',
            applicantReason: 'Applicant text',
            grants:
              state === 'granted'
                ? [
                    {
                      id: cohort,
                      role: 'regional_admin',
                      regionId: region,
                      scopeType: 'region',
                      active: true,
                      effective: true,
                      canEdit: authority !== 'protected',
                      canRevoke: authority !== 'protected',
                      validFrom: '2026-10-08'
                    }
                  ]
                : []
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
  const confirmMock = vi.fn<(message: string) => boolean>(() => true);
  const location = {
    href: options.url ?? 'https://platform.example/admin/administrators?lang=' + locale,
    assign: vi.fn()
  };
  const history = {
    replaceState: vi.fn((_state: unknown, _title: string, url: string | URL) => {
      location.href = new URL(url, location.href).href;
    })
  };
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error('No inline script');
  new Script(source).runInNewContext({
    fetch: fetchMock,
    URL,
    location,
    history,
    confirm: confirmMock,
    document: {
      cookie: '__Host-qigong-admin-csrf=csrf-test',
      getElementById: (id: string) => fields.get(id),
      createElement: (tag: string) => {
        tags.push(tag);
        return node(tag);
      }
    }
  });
  return { fields, fetchMock, location, history, tags, kind, confirmMock };
};
const event = (n: Node, type: string) => n.listeners.get(type)?.({ preventDefault: () => {} });
const body = (request: RequestInit | undefined): unknown => {
  if (typeof request?.body !== 'string') throw new Error('No JSON body');
  return JSON.parse(request.body);
};
describe('administrator access generated browser behavior', () => {
  it.each(['zh_TW', 'en'] as const)(
    'explains the distinct %s administrator review and existing-access workflows without renaming statuses',
    (locale) => {
      const html = renderAdminAccessPage(locale);
      const ui = adminAccessTexts(locale);
      expect(html).toContain(
        `id="show-pending" aria-describedby="pending-purpose">${ui.reviewRequests}</button>`
      );
      expect(html).toContain(`<p id="pending-purpose">${ui.reviewRequestsHelp}</p>`);
      expect(html).toContain(
        `id="show-authorized" aria-describedby="authorized-purpose">${ui.manageGrants}</button>`
      );
      expect(html).toContain(`<p id="authorized-purpose">${ui.manageGrantsHelp}</p>`);
      expect(html).toContain(`<option value="pending">${ui.pending}</option>`);
      expect(html).toContain(`<option value="authorized">${ui.authorized}</option>`);
      expect(html).toContain(ui.manageIntro);
      expect(ui.reviewRequestsHelp).toContain(
        locale === 'en' ? 'not learner enrollment review' : '不是學員報名審核'
      );
      expect(ui.manageGrantsHelp).toContain(
        locale === 'en' ? 'preconfigured accounts' : '預先配置的帳號'
      );
      expect(ui.manageGrantsHelp).toContain(locale === 'en' ? 'ineffective' : '不一定有效');
    }
  );
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
  it.each(['zh_TW', 'en'] as const)(
    'edits an existing grant and sends versioned removal with explicit confirmation in %s',
    async (locale) => {
      const f = fixture(renderAdminAccessPage(locale), 'manage', locale, 'granted');
      await settle();
      const ui = adminAccessTexts(locale);
      event(f.fields.get('show-authorized')!, 'click');
      await settle();
      expect(
        f.fetchMock.mock.calls.some(
          ([url]) => typeof url === 'string' && url.includes('status=authorized')
        )
      ).toBe(true);
      expect(f.fields.get('show-authorized')!.attributes['aria-pressed']).toBe('true');
      const card = f.fields.get('accounts')!;
      const editor = descendants(card).find((n) => n.tag === 'fieldset')!;
      expect(editor.hidden).toBe(true);
      event(
        descendants(card).find((n) => n.tag === 'button' && n.textContent === ui.edit)!,
        'click'
      );
      expect(editor.hidden).toBe(false);
      const role = descendants(editor).find(
        (n) => n.tag === 'select' && n.attributes['aria-label'] === ui.role
      )!;
      const scope = descendants(editor).find(
        (n) => n.tag === 'select' && n.attributes['aria-label'] === ui.scope
      )!;
      expect(role.value).toBe('regional_admin');
      expect(scope.value).toBe(region);
      role.value = 'coach_admin';
      event(role, 'change');
      expect(scope.hidden).toBe(true);
      descendants(editor).find((n) => n.tag === 'input')!.value = '教練職務核對';
      event(
        descendants(editor).find((n) => n.tag === 'button' && n.textContent === ui.saveEdit)!,
        'click'
      );
      await settle();
      const edited = f.fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.endsWith('/edit')
      );
      expect(body(edited?.[1])).toEqual({
        version: 7,
        role: 'coach_admin',
        reason: '教練職務核對'
      });
      const fresh = f.fields.get('accounts')!;
      const remove = descendants(fresh).find(
        (n) => n.tag === 'button' && n.textContent === ui.revokeAll
      )!;
      const line = descendants(fresh).find((n) => n.children.includes(remove))!;
      line.children.find((n) => n.tag === 'input')!.value = '職務結束';
      f.confirmMock.mockReturnValueOnce(false);
      event(remove, 'click');
      await settle();
      expect(
        f.fetchMock.mock.calls.some(
          ([url]) => typeof url === 'string' && url.endsWith('/revoke-all')
        )
      ).toBe(false);
      event(remove, 'click');
      await settle();
      const removed = f.fetchMock.mock.calls.find(
        ([url]) => typeof url === 'string' && url.endsWith('/revoke-all')
      );
      expect(body(removed?.[1])).toEqual({ version: 7, reason: '職務結束' });
      expect(
        f.confirmMock.mock.calls.some(([message]) => String(message).includes(ui.revokeAllConfirm))
      ).toBe(true);
    }
  );
  it.each(['zh_TW', 'en'] as const)(
    'switches lists, filters, pages and refreshes without prompting for untouched %s forms',
    async (locale) => {
      const f = fixture(renderAdminAccessPage(locale), 'manage', locale, 'granted', 'super', {
        total: 41
      });
      await settle();
      const ui = adminAccessTexts(locale);
      const originalCard = f.fields.get('accounts')!.children[0];
      event(f.fields.get('show-pending')!, 'click');
      event(f.fields.get('previous')!, 'click');
      expect(f.fields.get('accounts')!.children[0]).toBe(originalCard);
      event(
        descendants(f.fields.get('accounts')!).find(
          (n) => n.tag === 'button' && n.textContent === ui.edit
        )!,
        'click'
      );
      event(f.fields.get('show-authorized')!, 'click');
      await settle();
      event(f.fields.get('next')!, 'click');
      await settle();
      expect(new URL(f.location.href).searchParams.get('page')).toBe('2');
      event(f.fields.get('previous')!, 'click');
      await settle();
      f.fields.get('access-filter')!.value = 'approved';
      event(f.fields.get('filter')!, 'submit');
      await settle();
      event(f.fields.get('filter')!, 'submit');
      await settle();
      event(f.fields.get('show-pending')!, 'click');
      await settle();
      expect(f.confirmMock).not.toHaveBeenCalled();
      expect(f.fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
      expect(new URL(f.location.href).searchParams.get('lang')).toBe(locale);
      expect(f.location.assign).not.toHaveBeenCalled();
    }
  );
  it.each(['zh_TW', 'en'] as const)(
    'preserves unsaved %s values, applied filters, page and URL when navigation is cancelled',
    async (locale) => {
      const ui = adminAccessTexts(locale);
      const actions = [
        ['show-authorized', 'click', ui.listSwitchConfirm, false],
        ['filter', 'submit', ui.listSwitchConfirm, true],
        ['filter', 'submit', ui.reloadConfirm, false],
        ['next', 'click', ui.pageSwitchConfirm, false],
        ['previous', 'click', ui.pageSwitchConfirm, false]
      ] as const;
      for (const [id, type, message, changeFilter] of actions) {
        const f = fixture(renderAdminAccessPage(locale), 'manage', locale, 'draft', 'super', {
          total: 81,
          url:
            'https://platform.example/admin/administrators?lang=' +
            locale +
            '&status=pending&page=2'
        });
        await settle();
        const card = f.fields.get('accounts')!.children[0];
        const reason = descendants(f.fields.get('accounts')!).find((n) => n.tag === 'input')!;
        reason.value = '未送出的理由';
        if (changeFilter) f.fields.get('access-filter')!.value = 'authorized';
        const href = f.location.href;
        const calls = f.fetchMock.mock.calls.length;
        const updates = f.history.replaceState.mock.calls.length;
        f.confirmMock.mockReturnValue(false);
        event(f.fields.get(id)!, type);
        await settle();
        expect(f.confirmMock).toHaveBeenCalledExactlyOnceWith(message);
        expect(message).not.toBe(ui.switchConfirm);
        expect(f.fields.get('accounts')!.children[0]).toBe(card);
        expect(reason.value).toBe('未送出的理由');
        expect(f.fields.get('access-filter')!.value).toBe('pending');
        expect(f.location.href).toBe(href);
        expect(f.fetchMock).toHaveBeenCalledTimes(calls);
        expect(f.history.replaceState).toHaveBeenCalledTimes(updates);
      }
    }
  );
  it.each(['zh_TW', 'en'] as const)(
    'discards confirmed %s edits on list, filter, page or reload without submitting changes',
    async (locale) => {
      const ui = adminAccessTexts(locale);
      const actions = [
        ['show-authorized', 'click', ui.listSwitchConfirm, false],
        ['filter', 'submit', ui.listSwitchConfirm, true],
        ['filter', 'submit', ui.reloadConfirm, false],
        ['next', 'click', ui.pageSwitchConfirm, false]
      ] as const;
      for (const [id, type, message, changeFilter] of actions) {
        const f = fixture(renderAdminAccessPage(locale), 'manage', locale, 'draft', 'super', {
          total: 41
        });
        await settle();
        descendants(f.fields.get('accounts')!).find((n) => n.tag === 'input')!.value = '未送出';
        if (changeFilter) f.fields.get('access-filter')!.value = 'authorized';
        event(f.fields.get(id)!, type);
        await settle();
        expect(f.confirmMock).toHaveBeenCalledExactlyOnceWith(message);
        expect(descendants(f.fields.get('accounts')!).find((n) => n.tag === 'input')!.value).toBe(
          ''
        );
        expect(f.fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
        f.confirmMock.mockClear();
        event(f.fields.get('filter')!, 'submit');
        await settle();
        expect(f.confirmMock).not.toHaveBeenCalled();
      }
    }
  );
  it.each(['zh_TW', 'en'] as const)(
    'tracks %s role, scope, review, single removal and all-removal edits independently',
    async (locale) => {
      const ui = adminAccessTexts(locale);
      for (const state of ['draft', 'granted']) {
        const initial = fixture(renderAdminAccessPage(locale), 'manage', locale, state);
        await settle();
        const editable = descendants(initial.fields.get('accounts')!).filter(
          (n) => n.tag === 'select' || n.tag === 'input'
        );
        for (let index = 0; index < editable.length; index++) {
          const f = fixture(renderAdminAccessPage(locale), 'manage', locale, state);
          await settle();
          const field = descendants(f.fields.get('accounts')!).filter(
            (n) => n.tag === 'select' || n.tag === 'input'
          )[index]!;
          const baseline = field.value;
          field.value =
            field.tag === 'input'
              ? '異動理由'
              : field.attributes['aria-label'] === ui.role
                ? 'global_viewer'
                : region === baseline
                  ? ''
                  : region;
          f.confirmMock.mockReturnValue(false);
          event(f.fields.get('show-authorized')!, 'click');
          await settle();
          expect(f.confirmMock).toHaveBeenCalledExactlyOnceWith(ui.listSwitchConfirm);
          field.value = baseline;
          f.confirmMock.mockClear();
          event(f.fields.get('show-authorized')!, 'click');
          await settle();
          expect(f.confirmMock).not.toHaveBeenCalled();
          expect(f.fields.get('show-authorized')!.attributes['aria-pressed']).toBe('true');
        }
      }
    }
  );
  it.each(['zh_TW', 'en'] as const)(
    'keeps unsaved %s grant edits after a failed save and clears tracking after a successful save',
    async (locale) => {
      const f = fixture(renderAdminAccessPage(locale), 'manage', locale, 'granted');
      await settle();
      const ui = adminAccessTexts(locale);
      const editor = descendants(f.fields.get('accounts')!).find((n) => n.tag === 'fieldset')!;
      const reason = descendants(editor).find((n) => n.tag === 'input')!;
      reason.value = '異動理由';
      const save = descendants(editor).find(
        (n) => n.tag === 'button' && n.textContent === ui.saveEdit
      )!;
      f.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 400 }));
      event(save, 'click');
      await settle();
      expect(f.fields.get('status')!.textContent).toBe(ui.failed);
      f.confirmMock.mockClear();
      f.confirmMock.mockReturnValueOnce(false);
      event(f.fields.get('show-authorized')!, 'click');
      await settle();
      expect(f.confirmMock).toHaveBeenCalledExactlyOnceWith(ui.listSwitchConfirm);
      expect(reason.value).toBe('異動理由');
      event(save, 'click');
      await settle();
      f.confirmMock.mockClear();
      event(f.fields.get('show-authorized')!, 'click');
      await settle();
      expect(f.confirmMock).not.toHaveBeenCalled();
    }
  );
  it.each(['zh_TW', 'en'] as const)(
    'retains the distinct %s language confirmation and cancels without sending access changes',
    async (locale) => {
      const f = fixture(renderAdminAccessPage(locale), 'manage', locale);
      await settle();
      descendants(f.fields.get('accounts')!).find((n) => n.tag === 'input')!.value = '未送出';
      const language = f.fields.get('admin-language')!;
      language.value = locale === 'en' ? 'zh_TW' : 'en';
      f.confirmMock.mockReturnValue(false);
      event(language, 'change');
      expect(f.confirmMock).toHaveBeenCalledExactlyOnceWith(adminTexts(locale).accessSwitchConfirm);
      expect(language.value).toBe(locale);
      expect(f.location.assign).not.toHaveBeenCalled();
      expect(f.fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    }
  );
  it.each(['zh_TW', 'en'] as const)(
    'refreshes pristine %s pending requests silently, protects changed values and uses language-specific warnings',
    async (locale) => {
      const f = fixture(renderAccessPendingPage(locale), 'pending', locale);
      await settle();
      const ui = adminAccessTexts(locale);
      event(f.fields.get('refresh')!, 'click');
      await settle();
      expect(f.confirmMock).not.toHaveBeenCalled();
      for (const id of ['role', 'scope', 'reason']) {
        const field = f.fields.get(id)!;
        const baseline = field.value;
        field.value = id === 'role' ? 'coach_admin' : '未送出';
        const calls = f.fetchMock.mock.calls.length;
        f.confirmMock.mockReturnValue(false);
        event(f.fields.get('refresh')!, 'click');
        await settle();
        expect(f.confirmMock).toHaveBeenLastCalledWith(ui.reloadConfirm);
        expect(f.fetchMock).toHaveBeenCalledTimes(calls);
        field.value = baseline;
      }
      f.fields.get('reason')!.value = '未送出';
      const language = f.fields.get('pending-language')!;
      language.value = locale === 'en' ? 'zh_TW' : 'en';
      event(language, 'change');
      expect(f.confirmMock).toHaveBeenLastCalledWith(ui.switchConfirm);
      expect(language.value).toBe(locale);
      expect(f.location.assign).not.toHaveBeenCalled();
      f.confirmMock.mockReturnValue(true);
      event(f.fields.get('refresh')!, 'click');
      await settle();
      expect(f.fields.get('reason')!.value).toBe('');
      f.confirmMock.mockClear();
      event(f.fields.get('refresh')!, 'click');
      await settle();
      expect(f.confirmMock).not.toHaveBeenCalled();
      expect(f.fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
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
