import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { renderReviewNotificationPage } from '../src/admin-review-notification-page.js';
import type { AdminLocale } from '../src/admin-locale.js';
interface Element {
  value: string;
  checked: boolean;
  disabled: boolean;
  hidden: boolean;
  textContent: string;
  children: Element[];
  href: string;
  elements: Record<string, Element>;
  append: (...nodes: Element[]) => void;
  replaceChildren: () => void;
  reset: () => void;
  addEventListener: () => void;
  onclick?: () => Promise<void>;
  onsubmit?: (event: { target: Element; preventDefault: () => void }) => void;
}
const tick = async () => {
  await setImmediate();
  await setImmediate();
};
const fixture = (locale: AdminLocale, options: { bound?: boolean; failSave?: boolean } = {}) => {
  const nodes = new Map<string, Element>();
  const element = (): Element => ({
      value: '',
      checked: false,
      disabled: false,
      hidden: false,
      textContent: '',
      children: [],
      href: '',
      elements: {},
      append(...children) {
        this.children.push(...children);
      },
      replaceChildren() {
        this.children = [];
      },
      reset() {
        for (const input of Object.values(this.elements)) input.value = '';
      },
      addEventListener() {}
    }),
    get = (id: string) => {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id)!;
    };
  const admin = element(),
    learner = element(),
    code = element();
  get('notify-preferences').elements = { adminEnabled: admin, learnerEnabled: learner };
  get('notify-confirm').elements = { code };
  const buttons = [
    'notify-begin',
    'notify-disconnect',
    'notify-test',
    'notify-reload',
    'save-submit',
    'confirm-submit'
  ].map(get);
  let current = {
    revision: 3,
    bound: options.bound ?? true,
    recipientHint: '••••0032',
    adminEnabled: false,
    learnerEnabled: false,
    locale,
    pendingCount: 2,
    unroutedCount: 0,
    failedCount: 0,
    link: null as { id: string; claimed: boolean; expiresAt: string } | null,
    events: [
      { kind: 'admin', createdAt: '2026-10-15T01:00:00Z', region: null },
      { kind: 'learner', createdAt: '2026-10-15T01:00:00Z', region: '台灣' }
    ]
  };
  const fetch = vi.fn<typeof globalThis.fetch>(async (path, init) => {
    if (typeof path !== 'string') throw Error('String URL expected');
    if (init?.method === 'GET' || !init?.method) return Response.json(current);
    if (typeof init.body !== 'string') throw Error('JSON expected');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (path.endsWith('/preferences')) {
      if (options.failSave)
        return Response.json({ error: 'notification_conflict' }, { status: 409 });
      current = {
        ...current,
        revision: current.revision + 1,
        bound: body.disconnect ? false : current.bound,
        adminEnabled: body.adminEnabled === true,
        learnerEnabled: body.learnerEnabled === true
      };
      return Response.json({ saved: true, revision: current.revision });
    }
    if (path.endsWith('/link')) {
      current.link = {
        id: '00000000-0000-4000-8000-000000000032',
        claimed: true,
        expiresAt: '2026-10-15T01:10:00Z'
      };
      return Response.json({ ...current.link, token: 'a'.repeat(43) });
    }
    if (path.endsWith('/confirm')) {
      current = { ...current, bound: true, revision: current.revision + 1, link: null };
      return Response.json({ confirmed: true, revision: current.revision });
    }
    return Response.json({ queued: true });
  });
  const context = vm.createContext({
    document: {
      getElementById: get,
      createElement: () => element(),
      querySelectorAll: (selector: string) => (selector === '#main button' ? buttons : []),
      cookie: '__Host-qigong-admin-csrf=synthetic-csrf'
    },
    window: {},
    fetch,
    confirm: () => true
  });
  const html = renderReviewNotificationPage(locale, true);
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    new vm.Script(script[1]!).runInContext(context);
  const submit = async (id: string) => {
    const form = get(id);
    form.onsubmit?.({ target: form, preventDefault: () => {} });
    await tick();
  };
  return { get, admin, learner, code, fetch, submit, context, html };
};
const body = (request: RequestInit | undefined): Record<string, unknown> => {
  if (typeof request?.body !== 'string') throw Error('JSON required');
  return JSON.parse(request.body) as Record<string, unknown>;
};
describe('Reviewer notification page runtime and checkbox layout', () => {
  it.each(['zh_TW', 'en'] as const)(
    'executes the actual %s HTML script, renders events and saves both checked preferences with the right locale',
    async (locale) => {
      const f = fixture(locale);
      await tick();
      expect(f.get('status').textContent).toBe('');
      expect(f.get('notify-events').children).toHaveLength(2);
      expect(f.get('notify-events').children[0]!.children[1]!.textContent).toBe(
        locale === 'en' ? 'Review in admin portal' : '登入後台審核'
      );
      f.admin.checked = true;
      f.learner.checked = true;
      await f.submit('notify-preferences');
      const saved = f.fetch.mock.calls.find(
        ([url]) => typeof url === 'string' && url.endsWith('/preferences')
      );
      expect(body(saved?.[1])).toEqual({
        version: 3,
        adminEnabled: true,
        learnerEnabled: true,
        locale
      });
      expect(saved?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'synthetic-csrf' });
      expect(f.get('status').textContent).toContain(locale === 'en' ? 'Saved.' : '已儲存');
      expect(f.context.locale).toBeUndefined();
    }
  );
  it.each(['zh_TW', 'en'] as const)(
    'uses the page-local %s locale for disconnect, without leaving locale in global scope',
    async (locale) => {
      const f = fixture(locale);
      await tick();
      await f.get('notify-disconnect').onclick?.();
      await tick();
      const call = f.fetch.mock.calls.find(
        ([url]) => typeof url === 'string' && url.endsWith('/preferences')
      );
      expect(body(call?.[1])).toEqual({
        version: 3,
        adminEnabled: false,
        learnerEnabled: false,
        locale,
        disconnect: true
      });
      expect(f.get('notify-test').disabled).toBe(true);
      expect(f.context.locale).toBeUndefined();
    }
  );
  it('retains both selected choices and shows a failure when the API rejects the save', async () => {
    const f = fixture('zh_TW', { failSave: true });
    await tick();
    f.admin.checked = true;
    f.learner.checked = true;
    await f.submit('notify-preferences');
    expect(f.admin.checked && f.learner.checked).toBe(true);
    expect(f.get('status').textContent).toContain('操作未完成');
    expect(f.get('save-submit').disabled).toBe(false);
  });
  it('keeps binding confirmation and private test functional after script isolation', async () => {
    const f = fixture('en', { bound: false });
    await tick();
    expect(f.get('notify-test').disabled).toBe(true);
    await f.get('notify-begin').onclick?.();
    await tick();
    expect(f.get('notify-command').value).toBe('/admin_notify ' + 'a'.repeat(43));
    f.code.value = '123456';
    await f.submit('notify-confirm');
    const call = f.fetch.mock.calls.find(
      ([url]) => typeof url === 'string' && url.endsWith('/confirm')
    );
    expect(body(call?.[1])).toMatchObject({ code: '123456', version: 3 });
    expect(f.get('notify-command').value).toBe('');
    await f.get('notify-test').onclick?.();
    expect(
      f.fetch.mock.calls.some(([url]) => typeof url === 'string' && url.endsWith('/test'))
    ).toBe(true);
  });
  it('scopes flex checkbox rows to this preferences form and leaves normal labels unchanged', () => {
    const f = fixture('zh_TW');
    expect(f.html).toContain(
      '#notify-preferences .notify-option{display:flex;align-items:flex-start;'
    );
    expect(f.html).toContain(
      '<label class="notify-option"><input name="adminEnabled" type="checkbox"><span>'
    );
    expect(f.html).toContain(
      '<label class="notify-option"><input name="learnerEnabled" type="checkbox"><span>'
    );
    expect(f.html).toContain('min-width:0;flex:1;overflow-wrap:anywhere');
  });
});
