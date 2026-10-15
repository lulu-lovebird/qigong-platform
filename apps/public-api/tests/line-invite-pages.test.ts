import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { renderLineInvitePage } from '../src/line-invite-page.js';
interface Node {
  hidden: boolean;
  disabled: boolean;
  checked: boolean;
  textContent: string;
  value: string;
  href: string;
  data: Record<string, string>;
  onclick?: (event?: { preventDefault: () => void }) => void | Promise<void>;
  onsubmit?: (event: { preventDefault: () => void }) => Promise<void>;
}
const fixture = (
  states: ReadonlyArray<{
    status: string;
    regionName?: string;
    resumeToken?: string;
    pendingApplication?: boolean;
    privacy?: { token: string; version: string; hash: string };
  }>,
  failRedeem = false,
  hash = '#' + 'a'.repeat(43),
  options: {
    inClient?: boolean;
    uiLocale?: 'zh_TW' | 'zh_CN' | 'en';
    storedLocale?: 'zh_TW' | 'zh_CN' | 'en';
    search?: string;
    cookie?: string;
    os?: 'ios' | 'android' | 'web';
    missingBridge?: boolean;
    missingOS?: boolean;
    bridgeThrows?: boolean;
    contextThrows?: boolean;
    statusGate?: Promise<void>;
    statusError?: 'invalid_line_identity' | 'line_friendship_unavailable';
    init?: () => Promise<void>;
  } = {}
) => {
  const listeners = new Map<string, () => void>();
  const nodes = new Map<string, Node>(),
    get = (id: string) => {
      if (!nodes.has(id))
        nodes.set(id, {
          hidden: false,
          disabled: false,
          checked: false,
          textContent: '',
          value: '',
          href: '',
          data: { name: 'Synthetic learner', email: 'demo@example.invalid', phone: '+65960000001' }
        });
      return nodes.get(id)!;
    };
  let index = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (typeof input !== 'string') throw Error('String expected');
    if (input === '/line/preferences/language')
      return Response.json({ locale: options.storedLocale ?? 'zh_TW' });
    if (input.endsWith('/status')) {
      await options.statusGate;
      if (options.statusError)
        return Response.json(
          { error: options.statusError },
          { status: options.statusError === 'invalid_line_identity' ? 401 : 503 }
        );
      return Response.json(states[Math.min(index++, states.length - 1)]);
    }
    if (input.endsWith('/accept')) return Response.json({ accepted: true });
    if (init?.method !== 'POST') throw Error('POST required');
    return Response.json(
      failRedeem ? { error: 'line_invite_unavailable' } : { status: 'approved' },
      { status: failRedeem ? 409 : 200 }
    );
  });
  const replace = vi.fn(),
    cleanup = vi.fn(),
    init = vi.fn(options.init ?? (async () => {})),
    openWindow = vi.fn<(value: { url: string; external: boolean }) => void>(() => {
      if (options.bridgeThrows) throw Error('synthetic bridge failure');
    }),
    closeWindow = vi.fn(),
    sendMessages = vi.fn();
  class TestFormData {
    constructor(private readonly form: Node) {}
    [Symbol.iterator]() {
      return Object.entries(this.form.data)[Symbol.iterator]();
    }
  }
  const context = vm.createContext({
    location: {
      hash,
      pathname: '/line/invite',
      search: options.search ?? '',
      href: 'https://checkin.baiyinqigong.org/line/invite' + (options.search ?? '') + hash,
      replace
    },
    history: { replaceState: cleanup },
    document: {
      cookie: options.cookie ?? '',
      getElementById: get,
      visibilityState: 'visible',
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback)
    },
    liff: {
      init,
      isLoggedIn: () => true,
      isInClient: () => {
        if (options.contextThrows) throw Error('Context unavailable');
        return options.inClient ?? true;
      },
      getOS: options.missingOS ? undefined : () => options.os ?? 'ios',
      openWindow: options.missingBridge ? undefined : openWindow,
      closeWindow,
      sendMessages,
      getIDToken: () => 'verified-id',
      getAccessToken: () => 'verified-access'
    },
    fetch,
    FormData: TestFormData,
    URL,
    URLSearchParams
  });
  const html = renderLineInvitePage('123-test', options.uiLocale ?? 'zh_TW'),
    script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!script) throw Error('Missing script');
  new vm.Script(script).runInContext(context);
  return {
    get,
    fetch,
    replace,
    cleanup,
    init,
    listeners,
    openWindow,
    closeWindow,
    sendMessages,
    html
  };
};
const tick = async () => {
  await setImmediate();
  await setImmediate();
};
const payload = (init: RequestInit | undefined): Record<string, unknown> => {
  if (typeof init?.body !== 'string') throw Error('JSON expected');
  return JSON.parse(init.body) as Record<string, unknown>;
};
describe('LINE invitation browser flow', () => {
  it('loads the verified saved Simplified choice without losing its private invitation or qualifying early', async () => {
    const bearer = 'a'.repeat(43),
      f = fixture([{ status: 'approved' }], false, '#' + bearer, { storedLocale: 'zh_CN' });
    await tick();
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(f.fetch.mock.calls[0]?.[0]).toBe('/line/preferences/language');
    expect(payload(f.fetch.mock.calls[0]?.[1])).toEqual({ idToken: 'verified-id' });
    expect(f.replace).toHaveBeenCalledWith('/line/invite?lang=zh_CN#' + bearer);
    expect(f.openWindow).not.toHaveBeenCalled();
  });
  it('respects an explicit Simplified choice over a different saved preference and keeps the fixed helper chat target', async () => {
    const f = fixture([{ status: 'approved' }], false, '#' + 'a'.repeat(43), {
      uiLocale: 'zh_CN',
      storedLocale: 'en',
      search: '?lang=zh_CN'
    });
    await tick();
    expect(f.html).toContain('<html lang="zh-Hans">');
    expect(f.fetch).toHaveBeenCalledOnce();
    expect(f.fetch.mock.calls[0]?.[0]).toBe('/line/invite/status');
    expect(f.openWindow).toHaveBeenCalledWith({
      url: 'https://line.me/R/oaMessage/%40556fjenc',
      external: true
    });
    expect(f.replace).not.toHaveBeenCalled();
  });
  it('hands an already-approved account to the helper chat without opening checkin, redeeming or closing the source LIFF', async () => {
    const f = fixture([{ status: 'approved' }]);
    await tick();
    expect(f.openWindow).toHaveBeenCalledWith({
      url: 'https://line.me/R/oaMessage/%40556fjenc',
      external: true
    });
    expect(f.replace).not.toHaveBeenCalled();
    expect(f.closeWindow).not.toHaveBeenCalled();
    expect(f.sendMessages).not.toHaveBeenCalled();
    expect(f.get('invite-form').hidden).toBe(true);
    expect(f.get('helper-chat').hidden).toBe(false);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.cleanup).toHaveBeenCalledWith(null, '', '/line/invite');
    expect(f.init).toHaveBeenCalled();
  });
  it('requires friendship then submits only basic details and verified credentials', async () => {
    const f = fixture([{ status: 'friend' }, { status: 'form', regionName: '台灣' }]);
    await tick();
    expect(f.get('friend').hidden).toBe(false);
    expect(f.replace).not.toHaveBeenCalled();
    await f.get('friend-retry').onclick?.();
    expect(f.get('invite-form').hidden).toBe(false);
    expect(f.get('region').textContent).toBe('台灣');
    await f.get('invite-form').onsubmit?.({ preventDefault: () => {} });
    expect(payload(f.fetch.mock.calls.at(-1)?.[1])).toEqual({
      token: 'a'.repeat(43),
      idToken: 'verified-id',
      accessToken: 'verified-access',
      name: 'Synthetic learner',
      email: 'demo@example.invalid',
      phone: '+65960000001'
    });
    expect(f.openWindow).toHaveBeenCalledWith({
      url: 'https://line.me/R/oaMessage/%40556fjenc',
      external: true
    });
    expect(f.replace).not.toHaveBeenCalled();
  });
  it('uses a private per-subject consent proof, explicit unchecked acceptance, then resumes the invite', async () => {
    const privacy = { token: 'b'.repeat(43), version: 'synthetic-v1', hash: 'c'.repeat(64) },
      f = fixture([
        { status: 'privacy', privacy },
        { status: 'form', regionName: '台灣' }
      ]);
    await tick();
    expect(f.get('privacy-accepted').checked).toBe(false);
    await f.get('privacy-submit').onclick?.();
    expect(f.fetch).toHaveBeenCalledTimes(2);
    f.get('privacy-accepted').checked = true;
    await f.get('privacy-submit').onclick?.();
    const call = f.fetch.mock.calls.find(([url]) => url === '/learner/privacy/accept');
    expect(payload(call?.[1])).toEqual({
      platform: 'line',
      ...privacy,
      accepted: true,
      reflectionConsent: false,
      locale: 'zh_TW'
    });
    expect(f.get('invite-form').hidden).toBe(false);
  });
  it.each(['pending', 'blocked', 'invalid'])(
    'never silently overrides %s or redirects it',
    async (status) => {
      const f = fixture([{ status }]);
      await tick();
      expect(f.replace).not.toHaveBeenCalled();
      expect(f.openWindow).not.toHaveBeenCalled();
      expect(f.get('helper-chat').hidden).toBe(true);
      const preventDefault = vi.fn();
      await f.get('helper-chat-link').onclick?.({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(f.get('invite-form').hidden).toBe(true);
      expect(f.fetch).toHaveBeenCalledTimes(2);
      expect(f.get('status').textContent).toBeTruthy();
    }
  );
  it('keeps the subject-bound continuation through friendship and redemption without browser storage', async () => {
    const resumeToken = 'r'.repeat(43);
    const f = fixture([
      { status: 'friend', resumeToken },
      { status: 'form', regionName: '台灣', resumeToken }
    ]);
    await tick();
    f.listeners.get('visibilitychange')?.();
    await tick();
    expect(f.get('invite-form').hidden).toBe(false);
    expect(payload(f.fetch.mock.calls[2]?.[1]).token).toBe(resumeToken);
    await f.get('invite-form').onsubmit?.({ preventDefault: () => {} });
    expect(payload(f.fetch.mock.calls.at(-1)?.[1]).token).toBe(resumeToken);
    expect(f.openWindow).toHaveBeenCalledWith({
      url: 'https://line.me/R/oaMessage/%40556fjenc',
      external: true
    });
    expect(f.replace).not.toHaveBeenCalled();
    f.listeners.get('visibilitychange')?.();
    await tick();
    expect(f.fetch).toHaveBeenCalledTimes(4);
  });
  it('resumes a cleaned-fragment reload only from the verified server continuation and waits for explicit pending confirmation', async () => {
    const resumeToken = 'r'.repeat(43);
    const f = fixture(
      [{ status: 'form', regionName: '台灣', resumeToken, pendingApplication: true }],
      false,
      ''
    );
    await tick();
    expect(payload(f.fetch.mock.calls[1]?.[1])).not.toHaveProperty('token');
    expect(f.get('status').textContent).toContain('待審申請');
    expect(f.replace).not.toHaveBeenCalled();
    expect(f.fetch).toHaveBeenCalledTimes(2);
    await f.get('invite-form').onsubmit?.({ preventDefault: () => {} });
    expect(payload(f.fetch.mock.calls[2]?.[1]).token).toBe(resumeToken);
    expect(f.openWindow).toHaveBeenCalledWith({
      url: 'https://line.me/R/oaMessage/%40556fjenc',
      external: true
    });
    expect(f.replace).not.toHaveBeenCalled();
  });
  it('waits for both LIFF initialization and server qualification before a single Android native handoff', async () => {
    let ready!: () => void, qualified!: () => void;
    const initialized = new Promise<void>((r) => {
        ready = r;
      }),
      statusGate = new Promise<void>((r) => {
        qualified = r;
      });
    const f = fixture([{ status: 'approved' }], false, undefined, {
      os: 'android',
      init: () => initialized,
      statusGate
    });
    await tick();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.openWindow).not.toHaveBeenCalled();
    expect(f.get('helper-chat').hidden).toBe(true);
    ready();
    await tick();
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.openWindow).not.toHaveBeenCalled();
    qualified();
    await tick();
    expect(f.openWindow).toHaveBeenCalledTimes(1);
    expect(f.openWindow).toHaveBeenCalledWith({
      url: 'https://line.me/R/oaMessage/%40556fjenc',
      external: true
    });
    expect(f.get('helper-chat-open').href).toBe('https://line.me/R/oaMessage/%40556fjenc');
    const target = new URL(f.get('helper-chat-open').href);
    expect(target.search).toBe('');
    expect(target.hash).toBe('');
    expect(target.username).toBe('');
    expect(JSON.stringify(f.openWindow.mock.calls)).not.toMatch(/verified-id|verified-access/);
    expect(JSON.stringify(f.openWindow.mock.calls)).not.toContain('a'.repeat(43));
    expect(f.replace).not.toHaveBeenCalled();
    expect(f.closeWindow).not.toHaveBeenCalled();
    expect(f.sendMessages).not.toHaveBeenCalled();
  });
  it('keeps a retry link after a silent bridge call without claiming success or repeating server writes on return', async () => {
    const f = fixture([{ status: 'approved' }]);
    await tick();
    expect(f.get('status').textContent).toContain('已嘗試');
    expect(f.get('helper-chat').hidden).toBe(false);
    expect(f.get('retry').hidden).toBe(true);
    for (let i = 0; i < 3; i++) f.listeners.get('visibilitychange')?.();
    await tick();
    await f.get('retry').onclick?.();
    await f.get('invite-form').onsubmit?.({ preventDefault: () => {} });
    await f.get('privacy-submit').onclick?.();
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.openWindow).toHaveBeenCalledTimes(1);
    const preventDefault = vi.fn();
    await f.get('helper-chat-open').onclick?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(f.openWindow).toHaveBeenCalledTimes(2);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    const plainPreventDefault = vi.fn();
    await f.get('helper-chat-link').onclick?.({ preventDefault: plainPreventDefault });
    expect(plainPreventDefault).not.toHaveBeenCalled();
    expect(f.get('helper-chat-link').href).toBe('https://line.me/R/oaMessage/%40556fjenc');
    expect(f.openWindow).toHaveBeenCalledTimes(2);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(f.html).toContain('桌面 LINE');
    expect(f.html).toContain('練功打卡');
    expect(f.html).not.toContain('/checkin');
    expect(f.html).not.toContain('liff.closeWindow(');
    expect(f.html).not.toContain('liff.sendMessages(');
  });
  it.each([
    { inClient: false },
    { os: 'web' as const },
    { missingBridge: true },
    { missingOS: true },
    { contextThrows: true }
  ])(
    'uses the fixed manual chat link instead of an unsupported automatic handoff: %j',
    async (options) => {
      const f = fixture([{ status: 'approved' }], false, undefined, options);
      await tick();
      expect(f.openWindow).not.toHaveBeenCalled();
      expect(f.get('helper-chat').hidden).toBe(false);
      expect(f.get('invite-form').hidden).toBe(true);
      const preventDefault = vi.fn();
      await f.get('helper-chat-open').onclick?.({ preventDefault });
      expect(preventDefault).not.toHaveBeenCalled();
      expect(f.openWindow).not.toHaveBeenCalled();
      expect(f.get('helper-chat-open').href).toBe('https://line.me/R/oaMessage/%40556fjenc');
      expect(f.fetch).toHaveBeenCalledTimes(2);
      expect(f.replace).not.toHaveBeenCalled();
    }
  );
  it('allows the ordinary link fallback if the native bridge throws, then supports a manual native retry without replaying approval', async () => {
    const f = fixture([{ status: 'approved' }], false, undefined, { bridgeThrows: true });
    await tick();
    expect(f.get('helper-chat').hidden).toBe(false);
    expect(f.get('status').textContent).not.toContain('synthetic bridge failure');
    const preventDefault = vi.fn();
    await f.get('helper-chat-open').onclick?.({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(f.openWindow).toHaveBeenCalledTimes(2);
    f.openWindow.mockImplementation(() => {});
    await f.get('helper-chat-open').onclick?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(f.openWindow).toHaveBeenCalledTimes(3);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.closeWindow).not.toHaveBeenCalled();
  });
  it.each(['invalid_line_identity', 'line_friendship_unavailable'] as const)(
    'does not open helper chat when server validation fails: %s',
    async (statusError) => {
      const f = fixture([{ status: 'approved' }], false, undefined, { statusError });
      await tick();
      expect(f.openWindow).not.toHaveBeenCalled();
      expect(f.get('helper-chat').hidden).toBe(true);
      expect(f.get('retry').hidden).toBe(false);
      expect(f.replace).not.toHaveBeenCalled();
    }
  );
  it('does not navigate or query the API when LIFF initialization fails', async () => {
    const f = fixture([{ status: 'approved' }], false, undefined, {
      init: async () => {
        throw Error('Synthetic init failure');
      }
    });
    await tick();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.openWindow).not.toHaveBeenCalled();
    expect(f.get('helper-chat').hidden).toBe(true);
  });
  it('requires explicit applicable consent before returning an existing member to helper chat', async () => {
    const privacy = { token: 'b'.repeat(43), version: 'synthetic-v1', hash: 'c'.repeat(64) };
    const f = fixture([{ status: 'privacy', privacy }, { status: 'approved' }]);
    await tick();
    expect(f.openWindow).not.toHaveBeenCalled();
    await f.get('privacy-submit').onclick?.();
    expect(f.fetch).toHaveBeenCalledTimes(2);
    f.get('privacy-accepted').checked = true;
    await f.get('privacy-submit').onclick?.();
    expect(f.openWindow).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls.some(([path]) => path === '/line/invite/redeem')).toBe(false);
    expect(f.get('invite-form').hidden).toBe(true);
  });
  it('retains the entered draft on quota/expiry failure and does not show success', async () => {
    const f = fixture([{ status: 'form', regionName: '台灣' }], true);
    await tick();
    await f.get('invite-form').onsubmit?.({ preventDefault: () => {} });
    expect(f.replace).not.toHaveBeenCalled();
    expect(f.openWindow).not.toHaveBeenCalled();
    expect(f.get('helper-chat').hidden).toBe(true);
    expect(f.get('status').textContent).toContain('失效');
    expect(f.get('invite-form').data.name).toBe('Synthetic learner');
    expect(f.get('join').disabled).toBe(false);
  });
});
