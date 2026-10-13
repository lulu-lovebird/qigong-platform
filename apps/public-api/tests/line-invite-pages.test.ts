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
  data: Record<string, string>;
  onclick?: () => Promise<void>;
  onsubmit?: (event: { preventDefault: () => void }) => Promise<void>;
}
const fixture = (
  states: ReadonlyArray<{
    status: string;
    regionName?: string;
    privacy?: { token: string; version: string; hash: string };
  }>,
  failRedeem = false
) => {
  const nodes = new Map<string, Node>(),
    get = (id: string) => {
      if (!nodes.has(id))
        nodes.set(id, {
          hidden: false,
          disabled: false,
          checked: false,
          textContent: '',
          value: '',
          data: { name: 'Synthetic learner', email: 'demo@example.invalid', phone: '+65960000001' }
        });
      return nodes.get(id)!;
    };
  let index = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (typeof input !== 'string') throw Error('String expected');
    if (input.endsWith('/status'))
      return Response.json(states[Math.min(index++, states.length - 1)]);
    if (input.endsWith('/accept')) return Response.json({ accepted: true });
    if (init?.method !== 'POST') throw Error('POST required');
    return Response.json(
      failRedeem ? { error: 'line_invite_unavailable' } : { status: 'approved' },
      { status: failRedeem ? 409 : 200 }
    );
  });
  const replace = vi.fn(),
    cleanup = vi.fn(),
    init = vi.fn(async () => {});
  class TestFormData {
    constructor(private readonly form: Node) {}
    [Symbol.iterator]() {
      return Object.entries(this.form.data)[Symbol.iterator]();
    }
  }
  const context = vm.createContext({
    location: {
      hash: '#' + 'a'.repeat(43),
      pathname: '/line/invite',
      search: '',
      href: 'https://checkin.baiyinqigong.org/line/invite#' + 'a'.repeat(43),
      replace
    },
    history: { replaceState: cleanup },
    document: { getElementById: get },
    liff: {
      init,
      isLoggedIn: () => true,
      isInClient: () => true,
      getIDToken: () => 'verified-id',
      getAccessToken: () => 'verified-access'
    },
    fetch,
    FormData: TestFormData,
    URL,
    URLSearchParams
  });
  const html = renderLineInvitePage('123-test'),
    script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!script) throw Error('Missing script');
  new vm.Script(script).runInContext(context);
  return { get, fetch, replace, cleanup, init };
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
  it('takes an already-approved account directly to the canonical checkin LIFF with no form or new redemption', async () => {
    const f = fixture([{ status: 'approved' }]);
    await tick();
    expect(f.replace).toHaveBeenCalledWith('https://liff.line.me/123-test/checkin');
    expect(f.fetch).toHaveBeenCalledTimes(1);
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
    expect(f.replace).toHaveBeenCalledWith('https://liff.line.me/123-test/checkin');
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
    expect(f.fetch).toHaveBeenCalledTimes(1);
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
      expect(f.get('invite-form').hidden).toBe(true);
      expect(f.fetch).toHaveBeenCalledTimes(1);
      expect(f.get('status').textContent).toBeTruthy();
    }
  );
  it('retains the entered draft on quota/expiry failure and does not show success', async () => {
    const f = fixture([{ status: 'form', regionName: '台灣' }], true);
    await tick();
    await f.get('invite-form').onsubmit?.({ preventDefault: () => {} });
    expect(f.replace).not.toHaveBeenCalled();
    expect(f.get('status').textContent).toContain('失效');
    expect(f.get('invite-form').data.name).toBe('Synthetic learner');
    expect(f.get('join').disabled).toBe(false);
  });
});
