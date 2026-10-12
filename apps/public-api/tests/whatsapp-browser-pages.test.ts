import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { whatsappBrowserBootstrap } from '../src/whatsapp-browser-bootstrap.js';
import { renderChannelWorkspacePage } from '../src/channel-workspace-pages.js';
interface Node {
  hidden: boolean;
  disabled: boolean;
  checked: boolean;
  textContent: string;
  onclick?: () => void | Promise<void>;
}
const jsonBody = (body: unknown): Record<string, unknown> => {
  if (typeof body !== 'string') throw Error('Expected JSON body');
  return JSON.parse(body) as Record<string, unknown>;
};
interface Auth {
  workspaceAuthorization: () => Promise<string>;
  whatsappCsrf: () => string;
}
const fixture = (
  options: {
    authenticated?: boolean;
    hash?: string;
    failLogin?: boolean;
    failLogout?: boolean;
    csrfMissing?: boolean;
  } = {}
) => {
  const nodes = new Map<string, Node>(),
    get = (id: string) => {
      if (!nodes.has(id))
        nodes.set(id, { hidden: false, disabled: false, checked: false, textContent: '' });
      return nodes.get(id)!;
    };
  let authenticated = options.authenticated ?? false;
  const fetch = vi.fn<typeof globalThis.fetch>(async (_path, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET')
      return Response.json(
        authenticated
          ? { authenticated: true, remembered: true, expiresAt: '2026-12-01T00:00:00Z' }
          : { authenticated: false },
        { status: authenticated ? 200 : 401 }
      );
    if (
      (typeof _path === 'string' ? _path : _path instanceof URL ? _path.href : _path.url).endsWith(
        '/logout'
      )
    )
      return Response.json({ ok: !options.failLogout }, { status: options.failLogout ? 503 : 200 });
    if (options.failLogin)
      return Response.json({ error: 'browser_login_unavailable' }, { status: 401 });
    authenticated = true;
    return Response.json({
      authenticated: true,
      remembered: true,
      expiresAt: '2026-12-01T00:00:00Z'
    });
  });
  const addEventListener = vi.fn<(event: string, listener: () => void) => void>(),
    reload = vi.fn();
  const replaceState = vi.fn(),
    replace = vi.fn(),
    mayLeave = vi.fn(() => true),
    cancelled = vi.fn();
  const context = vm.createContext({
    location: {
      hash: options.hash ?? '#' + 'a'.repeat(43),
      pathname: '/whatsapp/checkin',
      search: '?lang=zh_TW',
      replace,
      reload
    },
    history: { replaceState },
    document: {
      getElementById: get,
      cookie: options.csrfMissing ? '' : '__Host-qigong-whatsapp-csrf=' + 'b'.repeat(43)
    },
    window: { whatsappMayLeave: mayLeave, whatsappLeaveCancelled: cancelled, addEventListener },
    fetch
  });
  new vm.Script(
    whatsappBrowserBootstrap('zh_TW') +
      '\nglobalThis.previewAuth={workspaceAuthorization,whatsappCsrf};'
  ).runInContext(context);
  const auth = context.previewAuth as Auth;
  return { get, fetch, replaceState, replace, mayLeave, cancelled, auth, addEventListener, reload };
};
const tick = async () => {
  await setImmediate();
  await setImmediate();
};
describe('WhatsApp browser login and fixed bookmarks', () => {
  it('defaults remember to checked but waits for an explicit login action', async () => {
    const f = fixture();
    await tick();
    expect(f.get('wa-remember').checked).toBe(true);
    expect(f.get('wa-login-panel').hidden).toBe(false);
    expect(f.fetch.mock.calls).toHaveLength(1);
    expect(f.fetch.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(f.replaceState).toHaveBeenCalledWith(null, '', '/whatsapp/checkin?lang=zh_TW');
    await f.get('wa-login').onclick?.();
    expect(jsonBody(f.fetch.mock.calls[1]?.[1]?.body)).toEqual({
      token: 'a'.repeat(43),
      remember: true
    });
    expect(await f.auth.workspaceAuthorization()).toBe('');
  });
  it('reloads a new private fragment on an already-open anonymous bookmark', async () => {
    const f = fixture();
    await tick();
    f.addEventListener.mock.calls[0]![1]();
    expect(f.reload).toHaveBeenCalled();
  });
  it('does not discard a dirty signed-in page when a new private fragment arrives', async () => {
    const f = fixture({ authenticated: true });
    await tick();
    f.mayLeave.mockReturnValue(false);
    f.addEventListener.mock.calls[0]![1]();
    expect(f.reload).not.toHaveBeenCalled();
  });
  it('allows disabling remember on a shared device', async () => {
    const f = fixture();
    await tick();
    f.get('wa-remember').checked = false;
    await f.get('wa-login').onclick?.();
    expect(jsonBody(f.fetch.mock.calls[1]?.[1]?.body).remember).toBe(false);
  });
  it('opens a fixed bookmark through an existing cookie without a new message or exchange', async () => {
    const f = fixture({ authenticated: true, hash: '' });
    await tick();
    expect(await f.auth.workspaceAuthorization()).toBe('');
    expect(f.get('wa-login-panel').hidden).toBe(true);
    expect(f.get('wa-session-panel').hidden).toBe(false);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.get('wa-session-status').textContent).toContain('不回傳聊天摘要');
  });
  it('asks for a fresh private link when a bookmark has no valid login', async () => {
    const f = fixture({ hash: '' });
    await tick();
    expect(f.get('wa-login').disabled).toBe(true);
    expect(f.get('wa-login-status').textContent).toContain('checkin');
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps failed or cookie-blocked login on the page rather than falsely resolving authentication', async () => {
    for (const options of [{ failLogin: true }, { csrfMissing: true }]) {
      const f = fixture(options);
      await tick();
      await f.get('wa-login').onclick?.();
      expect(f.get('wa-login-panel').hidden).toBe(false);
      expect(f.get('wa-login-status').textContent).toContain('登入未完成');
      expect(f.replace).not.toHaveBeenCalled();
    }
  });
  it('honors the unsaved-content guard and validates logout with a CSRF header', async () => {
    const f = fixture({ authenticated: true });
    await tick();
    f.mayLeave.mockReturnValueOnce(false);
    await f.get('wa-logout').onclick?.();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    await f.get('wa-logout').onclick?.();
    expect(f.fetch.mock.calls[1]?.[1]?.headers).toMatchObject({
      'x-whatsapp-csrf-token': 'b'.repeat(43)
    });
    expect(f.replace).toHaveBeenCalledWith('/whatsapp/checkin?lang=zh_TW');
  });
  it('restores leaving state and retains the current login on failed logout', async () => {
    const f = fixture({ authenticated: true, failLogout: true });
    await tick();
    await f.get('wa-logout').onclick?.();
    expect(f.cancelled).toHaveBeenCalled();
    expect(f.replace).not.toHaveBeenCalled();
    expect(f.get('wa-session-status').textContent).toContain('登出失敗');
  });
  it.each(['checkin', 'leaderboard', 'methods', 'achievements', 'journal'] as const)(
    'renders %s cookie-only APIs, no session bearer in URLs, and safe logout integration',
    (page) => {
      const html = renderChannelWorkspacePage({ platform: 'whatsapp' }, page);
      for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
        expect(() => new vm.Script(match[1]!)).not.toThrow();
      expect(html).toContain('id="wa-remember" type="checkbox" checked');
      expect(html).toContain('x-whatsapp-csrf-token');
      expect(html).toContain('window.whatsappMayLeave');
      expect(html).not.toContain('JSON.stringify({token,locale,...values})');
      expect(html).not.toContain('localStorage');
      expect(html).not.toContain('sessionStorage');
      expect(html).not.toContain('A private summary may be sent');
    }
  );
});
