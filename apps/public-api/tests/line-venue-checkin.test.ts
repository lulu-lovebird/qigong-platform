import { setImmediate } from 'node:timers/promises';
import { Script } from 'node:vm';
import type { Pool } from '@qigong/database';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { LineConfig } from '../src/line-onboarding.js';
import { renderChannelWorkspacePage } from '../src/channel-workspace-pages.js';
import {
  renderVenuePreview,
  venuePreviewRequest,
  venuePreviewUrl
} from '../src/line-venue-checkin-page.js';

const base = '/line/venue-checkin';
const valid = base + '?venue=tw-tpe-daan&source=qr';
const primary = (suffix = '/venue-checkin?venue=tw-tpe-daan&source=qr') =>
  '/line/?liff.state=' + encodeURIComponent(suffix);
const query = vi.fn(async () => {
  throw new Error('DB forbidden');
});
const connect = vi.fn(async () => {
  throw new Error('DB forbidden');
});
const verifyIdentity = vi.fn(async () => {
  throw new Error('Verifier forbidden');
});
const verifyIdToken = vi.fn(async () => {
  throw new Error('Verifier forbidden');
});
const verifyFriendship = vi.fn(async () => {
  throw new Error('Verifier forbidden');
});
const reply = vi.fn(async () => {
  throw new Error('Push forbidden');
});
const fetchMock = vi.fn(async () => {
  throw new Error('Network forbidden');
});
const config: LineConfig = {
  channelSecret: 'mock-channel-secret',
  channelAccessToken: 'mock-access-token',
  loginChannelId: 'mock-login-channel',
  liffId: 'mock-liff',
  verifyIdentity,
  verifyIdToken,
  verifyFriendship,
  reply
};
let app: FastifyInstance;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', undefined);
  vi.stubGlobal('fetch', fetchMock);
  app = buildApp({ pool: { query, connect } as unknown as Pool, logger: false, line: config });
});
afterEach(async () => {
  await app.close();
  for (const forbidden of [
    query,
    connect,
    verifyIdentity,
    verifyIdToken,
    verifyFriendship,
    reply,
    fetchMock
  ])
    expect(forbidden).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

interface NodeStub {
  textContent: string;
  disabled: boolean;
  value: string;
  onclick?: () => void;
  onchange?: () => void | Promise<void>;
  checked: boolean;
  hidden: boolean;
}
type BrowserRequest = Omit<RequestInit, 'body'> & { body: string };
type GeoRequest = (
  success: (position: unknown) => void | Promise<void>,
  error: (error: { code: number }) => void,
  options: { enableHighAccuracy: boolean; timeout: number; maximumAge: number }
) => void;
const browser = (
  html: string,
  url = 'https://app.test' + valid,
  options: {
    loggedIn?: boolean;
    inClient?: boolean;
    idToken?: string;
    init?: () => Promise<void>;
    geolocation?: boolean;
    cookie?: string;
    preferences?: (url: string, options: BrowserRequest) => Promise<Response>;
    fetch?: (url: string, options: BrowserRequest) => Promise<Response>;
  } = {}
) => {
  const nodes = new Map<string, NodeStub>();
  const get = (id: string) => {
    let node = nodes.get(id);
    if (!node) {
      node = {
        textContent: '',
        disabled: id === 'preview-test' || id === 'preview-language',
        value:
          id === 'preview-language' ? (/value="([^"]*)"[^>]* selected/.exec(html)?.[1] ?? '') : '',
        checked: false,
        hidden: true
      };
      nodes.set(id, node);
    }
    return node;
  };
  const entry = new URL(url);
  const location = {
    href: entry.href,
    pathname: entry.pathname,
    search: entry.search,
    hash: entry.hash,
    replace: vi.fn()
  };
  const history = { replaceState: vi.fn() };
  const liff = {
    init: vi.fn(options.init ?? (async () => {})),
    isLoggedIn: vi.fn(() => options.loggedIn ?? true),
    isInClient: vi.fn(() => options.inClient ?? false),
    getIDToken: vi.fn(() => options.idToken ?? 'mock-credential-never-sent'),
    login: vi.fn()
  };
  const geo = vi.fn<GeoRequest>();
  const storage = {
    getItem: vi.fn(() => {
      throw new Error('Storage forbidden');
    }),
    setItem: vi.fn(() => {
      throw new Error('Storage forbidden');
    })
  };
  const log = vi.fn(() => {
    throw new Error('Logging forbidden');
  });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Missing script');
  const document = { getElementById: get, cookie: options.cookie ?? '' };
  const preferences = vi.fn(
    options.preferences ?? (async () => new Response(JSON.stringify({ locale: 'zh_TW' })))
  );
  const fetch = vi.fn(
    options.fetch ??
      (async () => {
        throw new Error('Check-in forbidden');
      })
  );
  new Script(script).runInNewContext({
    URL,
    URLSearchParams,
    document,
    location,
    history,
    liff,
    navigator: options.geolocation === false ? {} : { geolocation: { getCurrentPosition: geo } },
    fetch: (url: string, options: BrowserRequest) =>
      url === '/line/preferences/language' ? preferences(url, options) : fetch(url, options),
    localStorage: storage,
    sessionStorage: storage,
    console: { log, error: log, warn: log },
    window: {}
  });
  return { get, location, history, liff, geo, storage, log, document, preferences, fetch };
};
const routeBrowser = async (route = valid, options: Parameters<typeof browser>[2] = {}) =>
  browser(
    (await app.inject({ url: route, headers: { cookie: options.cookie ?? '' } })).body,
    'https://app.test' + route,
    options
  );
const finishInit = () => setImmediate();

const liveBrowser = (route = valid, options: Parameters<typeof browser>[2] = {}) => {
  const parsed = venuePreviewRequest(route, options.cookie);
  if (parsed.kind !== 'preview') throw new Error('Invalid fixture');
  return browser(
    renderVenuePreview('mock-liff', parsed.entry, 'checkin', true, 'tw-taipei-cks'),
    'https://app.test' + route,
    options
  );
};
const attendanceResponse = () =>
  new Response(
    JSON.stringify({
      ok: true,
      venue: { name: 'Synthetic venue', timezone: 'Asia/Taipei' },
      checkedInAt: '2026-10-27T00:00:00Z'
    })
  );

describe('check-in language preference integration (real renderer, synthetic SDK/network)', () => {
  it.each(['zh_TW', 'zh_CN', 'en'])(
    'reads stored %s only after authentication, never writes on load',
    async (locale) => {
      let complete: (() => void) | undefined;
      const init = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const ui = liveBrowser(valid, {
        init: () => init,
        preferences: async () => new Response(JSON.stringify({ locale }))
      });
      expect(ui.preferences).not.toHaveBeenCalled();
      ui.get('preview-test').onclick?.();
      expect(ui.geo).not.toHaveBeenCalled();
      complete?.();
      await finishInit();
      expect(ui.preferences).toHaveBeenCalledExactlyOnceWith(
        '/line/preferences/language',
        expect.objectContaining({
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          body: JSON.stringify({ idToken: 'mock-credential-never-sent' })
        })
      );
      expect(ui.document.cookie).toBe('');
      expect(ui.fetch).not.toHaveBeenCalled();
      expect(ui.history.replaceState).toHaveBeenCalledWith(null, '', valid);
      if (locale === 'zh_TW') {
        expect(ui.location.replace).not.toHaveBeenCalled();
        expect(ui.get('preview-test').disabled).toBe(false);
      } else {
        expect(ui.location.replace).toHaveBeenCalledExactlyOnceWith(valid + '&lang=' + locale);
        expect(ui.get('preview-status').textContent).toContain('正在切換介面語言');
        expect(ui.get('preview-status').textContent).not.toContain('登入未完成');
        expect(ui.get('preview-test').disabled).toBe(true);
        expect(ui.get('preview-language').disabled).toBe(true);
        ui.get('preview-test').onclick?.();
        ui.get('preview-language').value = 'en';
        await ui.get('preview-language').onchange?.();
        expect(ui.geo).not.toHaveBeenCalled();
        expect(ui.preferences).toHaveBeenCalledOnce();
        const next = liveBrowser(valid + '&lang=' + locale);
        await finishInit();
        expect(next.preferences).not.toHaveBeenCalled();
        expect(next.location.replace).not.toHaveBeenCalled();
      }
      expect(ui.storage.getItem).not.toHaveBeenCalled();
      expect(ui.storage.setItem).not.toHaveBeenCalled();
      expect(ui.log).not.toHaveBeenCalled();
    }
  );
  it.each([
    ['&lang=en', 'zh_CN', 'en'],
    ['&lang=zh_CN', 'en', 'zh_CN'],
    ['&lang=zh_TW', 'en', 'zh_TW'],
    ['', 'zh_TW', 'zh_TW'],
    ['', 'zh_CN', 'zh_CN'],
    ['', 'en', 'en']
  ])(
    'preserves explicit > cookie > stored precedence: %s / %s',
    async (query, cookie, expected) => {
      const ui = liveBrowser(valid + query, { cookie: '__Host-qigong-learner-locale=' + cookie });
      await finishInit();
      expect(ui.get('preview-language').value).toBe(expected);
      expect(ui.preferences).not.toHaveBeenCalled();
      expect(ui.location.replace).not.toHaveBeenCalled();
      expect(ui.document.cookie).toBe('__Host-qigong-learner-locale=' + cookie);
      const parsed = venuePreviewRequest(valid + query, '__Host-qigong-learner-locale=' + cookie);
      expect(parsed).toMatchObject({ kind: 'preview', entry: { explicitLang: query.length > 0 } });
      if (parsed.kind === 'preview') expect(venuePreviewUrl(parsed.entry)).toBe(valid + query);
    }
  );
  it('invalid cookie is not an explicit choice and old localized callers retain their URL contract', async () => {
    const ui = liveBrowser(valid, {
      cookie: '__Host-qigong-learner-locale=fr',
      preferences: async () => new Response(JSON.stringify({ locale: 'en' }))
    });
    await finishInit();
    expect(ui.preferences).toHaveBeenCalledOnce();
    expect(ui.location.replace).toHaveBeenCalledWith(valid + '&lang=en');
    expect(venuePreviewUrl({ venue: 'tw-tpe-daan', source: 'qr', lang: 'en' })).toBe(
      valid + '&lang=en'
    );
  });
  it.each(['network', 'http', 'invalid', 'malicious'])(
    'preference read %s failure falls back without an implicit write',
    async (failure) => {
      const ui = liveBrowser(valid, {
        preferences: async () => {
          if (failure === 'network') throw new Error('private-credential');
          return new Response(
            JSON.stringify({
              locale: failure === 'malicious' ? '<script>private-credential</script>' : 'fr'
            }),
            { status: failure === 'http' ? 503 : 200 }
          );
        }
      });
      await finishInit();
      expect(ui.get('preview-test').disabled).toBe(false);
      expect(ui.location.replace).not.toHaveBeenCalled();
      expect(ui.document.cookie).toBe('');
      expect(ui.get('preview-language').value).toBe('zh_TW');
      expect(ui.get('preview-status').textContent).not.toContain('private-credential');
      expect(JSON.parse(String(ui.preferences.mock.calls[0]?.[1].body))).toEqual({
        idToken: 'mock-credential-never-sent'
      });
      expect(ui.fetch).not.toHaveBeenCalled();
    }
  );
  it('preserves only venue/source on no-lang login, callback cleanup and preference navigation', async () => {
    const route = base + '?venue=tw-taipei-cks&source=nfc';
    const first = liveBrowser(route, { loggedIn: false });
    await finishInit();
    expect(first.liff.login).toHaveBeenCalledWith({
      redirectUri: 'https://app.test' + route + '&_line_login_attempt=1'
    });
    expect(first.preferences).not.toHaveBeenCalled();
    const ui = liveBrowser(
      route +
        '&_line_login_attempt=1&code=private-code&state=private-state&liffRedirectUri=https%3A%2F%2Fevil.test#private-fragment',
      {
        preferences: async () => new Response(JSON.stringify({ locale: 'en' }))
      }
    );
    await finishInit();
    expect(ui.history.replaceState).toHaveBeenCalledExactlyOnceWith(null, '', route);
    expect(ui.location.replace).toHaveBeenCalledExactlyOnceWith(route + '&lang=en');
    expect(ui.preferences.mock.calls[0]?.[1].body).toBe(
      JSON.stringify({ idToken: 'mock-credential-never-sent' })
    );
    expect(ui.geo).not.toHaveBeenCalled();
    expect(ui.fetch).not.toHaveBeenCalled();
    expect(ui.get('preview-debug-enabled').disabled).toBe(true);
    expect(ui.get('preview-status').textContent).not.toContain('private-');
  });
  it('primary state is SDK-only, including check-in and preference controls', async () => {
    const ui = liveBrowser(primary('/venue-checkin?venue=tw-taipei-cks&source=qr'));
    await finishInit();
    ui.get('preview-test').onclick?.();
    ui.get('preview-language').value = 'en';
    await ui.get('preview-language').onchange?.();
    expect(ui.liff.init).toHaveBeenCalledOnce();
    expect(ui.liff.isLoggedIn).not.toHaveBeenCalled();
    expect(ui.liff.getIDToken).not.toHaveBeenCalled();
    expect(ui.preferences).not.toHaveBeenCalled();
    expect(ui.fetch).not.toHaveBeenCalled();
    expect(ui.geo).not.toHaveBeenCalled();
    expect(ui.history.replaceState).not.toHaveBeenCalled();
    expect(ui.location.replace).not.toHaveBeenCalled();
  });
  it('manual selection POST uses the fresh SDK token, clears debug memory, cookies only after success and remains busy through unload', async () => {
    let resolve: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const route = base + '?venue=tw-taipei-cks&source=link&lang=zh_TW';
    const ui = liveBrowser(route, { preferences: async () => pending });
    await finishInit();
    ui.liff.getIDToken.mockReturnValue('fresh-language-credential');
    ui.get('preview-debug-enabled').checked = true;
    ui.get('preview-debug-token').value = 'synthetic-manual-memory-only-debug-token';
    ui.get('preview-language').value = 'en';
    const switching = ui.get('preview-language').onchange?.();
    expect(ui.preferences).toHaveBeenCalledExactlyOnceWith(
      '/line/preferences/language',
      expect.objectContaining({
        body: JSON.stringify({ idToken: 'fresh-language-credential', locale: 'en' }),
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store'
      })
    );
    expect(ui.document.cookie).toBe('');
    expect(ui.location.replace).not.toHaveBeenCalled();
    expect(ui.get('preview-debug-token').value).toBe('');
    expect(ui.get('preview-debug-enabled').checked).toBe(false);
    for (const id of [
      'preview-language',
      'preview-test',
      'preview-debug-token',
      'preview-debug-enabled'
    ])
      expect(ui.get(id).disabled).toBe(true);
    ui.get('preview-language').value = 'zh_CN';
    await ui.get('preview-language').onchange?.();
    ui.get('preview-test').onclick?.();
    expect(ui.preferences).toHaveBeenCalledOnce();
    expect(ui.geo).not.toHaveBeenCalled();
    resolve?.(new Response('{}'));
    await switching;
    expect(ui.document.cookie).toBe(
      '__Host-qigong-learner-locale=en; Path=/; Max-Age=31536000; Secure; SameSite=Lax'
    );
    expect(ui.location.replace).toHaveBeenCalledExactlyOnceWith(
      base + '?venue=tw-taipei-cks&source=link&lang=en'
    );
    for (const id of [
      'preview-language',
      'preview-test',
      'preview-debug-token',
      'preview-debug-enabled'
    ])
      expect(ui.get(id).disabled).toBe(true);
    ui.get('preview-test').onclick?.();
    ui.get('preview-language').value = 'zh_CN';
    await ui.get('preview-language').onchange?.();
    expect(ui.geo).not.toHaveBeenCalled();
    expect(ui.fetch).not.toHaveBeenCalled();
    expect(ui.preferences).toHaveBeenCalledOnce();
    expect(ui.storage.setItem).not.toHaveBeenCalled();
    expect(ui.log).not.toHaveBeenCalled();
  });
  it.each([
    ['zh_TW', '語言偏好未儲存'],
    ['zh_CN', '语言偏好未保存'],
    ['en', 'Language preference was not saved']
  ])(
    'manual language HTTP/network failures restore %s and permit deliberate retry',
    async (locale, message) => {
      const route = valid + '&lang=' + locale;
      const ui = liveBrowser(route, {
        preferences: async () => new Response('private-server-error', { status: 503 })
      });
      await finishInit();
      const selected = locale === 'en' ? 'zh_CN' : 'en';
      for (const network of [false, true]) {
        if (network) ui.preferences.mockRejectedValueOnce(new Error('private-credential'));
        ui.get('preview-language').value = selected;
        await ui.get('preview-language').onchange?.();
        expect(ui.get('preview-language').value).toBe(locale);
        expect(ui.get('preview-status').textContent).toContain(message);
        expect(ui.get('preview-status').textContent).not.toContain('private-');
        expect(ui.get('preview-test').disabled).toBe(false);
        expect(ui.get('preview-language').disabled).toBe(false);
        expect(ui.document.cookie).toBe('');
        expect(ui.location.replace).not.toHaveBeenCalled();
      }
      ui.preferences.mockResolvedValueOnce(new Response('{}'));
      ui.get('preview-language').value = selected;
      await ui.get('preview-language').onchange?.();
      expect(ui.preferences).toHaveBeenCalledTimes(3);
      expect(ui.location.replace).toHaveBeenCalledWith(valid + '&lang=' + selected);
    }
  );
  it.each(['fr', '<script>attack-marker</script>', 'zh_TW'])(
    'ignores invalid/unchanged selection %s without writes',
    async (selected) => {
      const ui = liveBrowser(valid + '&lang=zh_TW');
      await finishInit();
      ui.get('preview-language').value = selected;
      await ui.get('preview-language').onchange?.();
      expect(ui.get('preview-language').value).toBe('zh_TW');
      expect(ui.preferences).not.toHaveBeenCalled();
      expect(ui.location.replace).not.toHaveBeenCalled();
    }
  );
  it.each(['logged-out', 'missing-token', 'sdk-error', 'http-401'])(
    'language auth failure %s never enables unauthorized check-in',
    async (failure) => {
      const ui = liveBrowser(valid + '&lang=zh_TW', {
        preferences: async () => new Response('{}', { status: 401 })
      });
      await finishInit();
      if (failure === 'logged-out') ui.liff.isLoggedIn.mockReturnValue(false);
      if (failure === 'missing-token') ui.liff.getIDToken.mockReturnValue('');
      if (failure === 'sdk-error')
        ui.liff.getIDToken.mockImplementation(() => {
          throw new Error('private-sdk-credential');
        });
      ui.get('preview-language').value = 'en';
      await ui.get('preview-language').onchange?.();
      expect(ui.preferences).toHaveBeenCalledTimes(failure === 'http-401' ? 1 : 0);
      expect(ui.get('preview-status').textContent).toContain('登入未完成');
      expect(ui.get('preview-language').value).toBe('zh_TW');
      expect(ui.get('preview-test').disabled).toBe(true);
      ui.get('preview-test').disabled = false;
      ui.get('preview-test').onclick?.();
      expect(ui.geo).not.toHaveBeenCalled();
      expect(ui.fetch).not.toHaveBeenCalled();
      expect(ui.document.cookie).toBe('');
      expect(ui.location.replace).not.toHaveBeenCalled();
    }
  );
  it('geolocation and POST pending freeze language/debug state and resist programmatic duplicate check-in', async () => {
    let resolve: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const ui = liveBrowser(valid + '&lang=zh_TW', { fetch: async () => pending });
    await finishInit();
    ui.get('preview-test').onclick?.();
    expect(ui.geo).toHaveBeenCalledOnce();
    ui.get('preview-language').value = 'en';
    await ui.get('preview-language').onchange?.();
    expect(ui.get('preview-language').value).toBe('zh_TW');
    expect(ui.preferences).not.toHaveBeenCalled();
    ui.get('preview-test').disabled = false;
    ui.get('preview-test').onclick?.();
    expect(ui.geo).toHaveBeenCalledOnce();
    ui.liff.getIDToken.mockReturnValue('fresh-checkin-credential');
    const submit = ui.geo.mock.calls[0]![0]({ coords: { latitude: 25, longitude: 121 } });
    expect(ui.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(ui.fetch.mock.calls[0]?.[1].body))).toEqual({
      idToken: 'fresh-checkin-credential',
      venue: 'tw-tpe-daan',
      latitude: 25,
      longitude: 121
    });
    ui.get('preview-language').value = 'en';
    await ui.get('preview-language').onchange?.();
    ui.get('preview-test').onclick?.();
    expect(ui.preferences).not.toHaveBeenCalled();
    expect(ui.geo).toHaveBeenCalledOnce();
    resolve?.(attendanceResponse());
    await submit;
    await finishInit();
    expect(ui.get('preview-status').textContent).toContain('出席已記錄');
    expect(ui.get('preview-history').hidden).toBe(false);
    expect(ui.get('preview-test').disabled).toBe(true);
    expect(ui.get('preview-language').disabled).toBe(false);
    ui.get('preview-test').disabled = false;
    ui.get('preview-test').onclick?.();
    expect(ui.geo).toHaveBeenCalledOnce();
    expect(ui.storage.setItem).not.toHaveBeenCalled();
    expect(ui.log).not.toHaveBeenCalled();
  });
  it('pending debug GPS keeps its mode/header and a language retry cannot retain the manual secret', async () => {
    const route = base + '?venue=tw-taipei-cks&source=qr&lang=zh_TW';
    const token = 'synthetic-manual-memory-only-debug-token';
    const ui = liveBrowser(route, {
      fetch: async () => new Response('{}', { status: 503 }),
      preferences: async () => new Response('{}', { status: 503 })
    });
    await finishInit();
    ui.get('preview-debug-enabled').checked = true;
    ui.get('preview-debug-token').value = token;
    ui.get('preview-test').onclick?.();
    expect(ui.get('preview-debug-token').value).toBe('');
    expect(ui.get('preview-debug-enabled').checked).toBe(true);
    ui.get('preview-language').value = 'en';
    await ui.get('preview-language').onchange?.();
    expect(ui.get('preview-debug-enabled').checked).toBe(true);
    expect(ui.preferences).not.toHaveBeenCalled();
    await ui.geo.mock.calls[0]![0]({ coords: { latitude: -25, longitude: 121 } });
    await finishInit();
    expect(ui.fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/line/venue-checkin',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Venue-Debug-Token': token })
      })
    );
    expect(ui.get('preview-debug-token').value).toBe('');
    expect(ui.get('preview-debug-enabled').checked).toBe(true);
    ui.get('preview-test').onclick?.();
    expect(ui.geo).toHaveBeenCalledOnce();
    expect(ui.get('preview-status').textContent).toContain('測試碼無效');
    ui.get('preview-debug-token').value = token;
    ui.get('preview-language').value = 'en';
    await ui.get('preview-language').onchange?.();
    expect(ui.get('preview-debug-token').value).toBe('');
    expect(ui.get('preview-debug-enabled').checked).toBe(false);
    expect(ui.get('preview-language').value).toBe('zh_TW');
    expect(ui.document.cookie).toBe('');
    expect(ui.location.replace).not.toHaveBeenCalled();
    expect(String(ui.preferences.mock.calls[0]?.[1].body)).not.toContain(token);
    expect(ui.storage.setItem).not.toHaveBeenCalled();
    expect(ui.log).not.toHaveBeenCalled();
  });
  it.each(['before-click', 'before-post', 'http-401'])(
    'check-in authentication expiry %s fails closed without reopening submit',
    async (failure) => {
      const ui = liveBrowser(valid + '&lang=zh_TW', {
        fetch: async () => new Response('{}', { status: 401 })
      });
      await finishInit();
      if (failure === 'before-click') ui.liff.getIDToken.mockReturnValue('');
      ui.get('preview-test').onclick?.();
      if (failure !== 'before-click') {
        if (failure === 'before-post') ui.liff.getIDToken.mockReturnValue('');
        await ui.geo.mock.calls[0]![0]({ coords: { latitude: 25, longitude: 121 } });
        await finishInit();
      }
      expect(ui.fetch).toHaveBeenCalledTimes(failure === 'http-401' ? 1 : 0);
      expect(ui.get('preview-status').textContent).toContain('登入未完成');
      expect(ui.get('preview-test').disabled).toBe(true);
      ui.get('preview-test').disabled = false;
      ui.get('preview-test').onclick?.();
      expect(ui.geo).toHaveBeenCalledTimes(failure === 'before-click' ? 0 : 1);
      expect(ui.get('preview-history').hidden).toBe(true);
    }
  );
});

describe('real buildApp venue preview routing', () => {
  it.each(['/line/', '/line/checkin', '/line/?liff.state=%2Fapply%23private'])(
    'keeps ordinary page unchanged: %s',
    async (url) => {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(
        renderChannelWorkspacePage({ platform: 'line', liffId: config.liffId }, 'checkin', 'zh_TW')
      );
    }
  );
  it.each([
    valid,
    base + '?venue=tw-tpe-daan',
    primary(),
    primary() + '&code=mock-sdk-code&state=mock-sdk-state'
  ])('serves a no-store, non-indexed isolated preview: %s', async (url) => {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff'
    });
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['content-security-policy']).not.toContain("connect-src 'self'");
    expect(response.body).toContain('測試預覽，尚未記錄出席');
    expect(response.body).toContain('tw-tpe-daan');
    expect(response.body).toContain('尚無可信場地資料');
    expect(response.body).toContain('min-height:48px');
    expect(response.body).toContain('aria-live="polite"');
    expect(response.body).not.toContain('user-scalable=no');
    expect(response.body).toContain(
      'Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting'
    );
    expect(response.body).toContain('href="/line/checkin?lang=zh_TW"');
    expect(response.body).not.toMatch(
      /簽到成功|\/api\/v1\/|localStorage|sessionStorage|sendBeacon|qrserver/
    );
  });
  const invalidQueries = [
    '',
    '?source=qr',
    '?venue=',
    '?venue=tw-tpe-daan&venue=tw-other',
    '?venue=tw-tpe-daan&source=qr&source=nfc',
    '?venue=tw-tpe-daan&lang=en&lang=zh_TW',
    '?venue=tw-tpe-daan&source=evil',
    '?venue=tw-tpe-daan&lang=fr',
    '?venue=TW-DAAN',
    '?venue=tw_tpe_daan',
    '?venue=tw--daan',
    '?venue=' + 'a'.repeat(65) + '-tw',
    '?venue=%00tw-daan',
    '?venue=%3C%2Fscript%3E%3Cscript%3Eattack-marker%3C%2Fscript%3E',
    '?venue=tw-tpe-daan&attack-marker=%3Cscript%3E',
    ...[
      'token',
      'idToken',
      'id_token',
      'person',
      'personId',
      'volunteerId',
      'latitude',
      'longitude',
      'gps',
      'date',
      'test',
      'bypass',
      'redirect'
    ].map((key) => '?venue=tw-tpe-daan&' + key + '=attack-marker')
  ];
  it.each(invalidQueries)(
    'rejects malformed/unknown/identity/location query without reflection: %s',
    async (suffix) => {
      for (const route of [base + suffix, primary('/venue-checkin' + suffix)]) {
        const response = await app.inject(route);
        expect(response.statusCode).toBe(400);
        expect(response.body).toContain('入口參數無效');
        expect(response.body).not.toContain('<script');
        expect(response.body).not.toContain('attack-marker');
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
      }
    }
  );
  it.each([
    primary() + '&liff.state=%2Fvenue-checkin%3Fvenue%3Dtw-other',
    primary() + '&personId=attack-marker',
    primary('/venue-checkin?venue=tw-tpe-daan#attack-marker'),
    primary('/venue-checkin/../other?venue=tw-tpe-daan'),
    primary('/venue-checkin?venue=tw-tpe-daan&lang=en&lang=zh_TW'),
    primary('/venue-checkin?venue=tw-tpe-daan&x=' + 'a'.repeat(600))
  ])('rejects malformed primary states: %s', async (route) => {
    const response = await app.inject(route);
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('attack-marker');
    expect(response.body).not.toContain('<script');
  });
  it.each(['zh_TW', 'zh_CN', 'en'])(
    'preserves supported language from appended state: %s',
    async (lang) => {
      const response = await app.inject(
        primary('/venue-checkin?venue=tw-tpe-daan&source=nfc&lang=' + lang)
      );
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('source=nfc&lang=' + lang);
      expect(response.body).toContain('href="/line/checkin?lang=' + lang + '"');
      const result = venuePreviewRequest(valid + '&lang=' + lang);
      expect(result.kind).toBe('preview');
      if (result.kind === 'preview')
        expect(venuePreviewUrl(result.entry)).toBe(valid + '&lang=' + lang);
    }
  );
  it('uses presentation cookie when lang is absent, without calling preference API', async () => {
    const response = await app.inject({
      url: valid,
      headers: { cookie: '__Host-qigong-learner-locale=en' }
    });
    expect(response.body).toContain('<html lang="en">');
    const vm = browser(response.body, 'https://app.test' + valid, {
      cookie: '__Host-qigong-learner-locale=en'
    });
    await finishInit();
    expect(vm.history.replaceState).toHaveBeenCalledWith(null, '', valid);
    expect(vm.preferences).not.toHaveBeenCalled();
  });
  it('does not exist without LINE configuration and does not expose old NFC routes', async () => {
    const disabled = buildApp({ pool: { query, connect } as unknown as Pool, logger: false });
    try {
      expect((await disabled.inject(valid)).statusCode).toBe(404);
    } finally {
      await disabled.close();
    }
    expect((await app.inject('/api/v1/fields/active')).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/field-checkin', payload: {} })).statusCode
    ).toBe(404);
    expect((await app.inject({ method: 'POST', url: base, payload: {} })).statusCode).toBe(404);
  });
  it('escapes configured LIFF ID as inline script data', async () => {
    const html = renderVenuePreview('</script><script>attack-marker()</script>', {
      venue: 'tw-tpe-daan',
      lang: 'zh_TW'
    });
    expect(html).not.toContain('</script><script>attack-marker');
    const vm = browser(html);
    await finishInit();
    expect(vm.liff.init).toHaveBeenCalledWith({
      liffId: '</script><script>attack-marker()</script>'
    });
  });
});

describe('mock SDK/VM probes against real route HTML (no external SDK loaded)', () => {
  it('waits for init; keeps primary URL untouched and leaves secondary navigation to SDK', async () => {
    let complete: (() => void) | undefined;
    const init = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const vm = await routeBrowser(primary(), { init: () => init, loggedIn: false });
    expect(vm.liff.init).toHaveBeenCalledOnce();
    expect(vm.history.replaceState).not.toHaveBeenCalled();
    expect(vm.get('preview-test').disabled).toBe(true);
    vm.get('preview-test').onclick?.();
    expect(vm.geo).not.toHaveBeenCalled();
    complete?.();
    await finishInit();
    expect(vm.liff.isLoggedIn).not.toHaveBeenCalled();
    expect(vm.liff.login).not.toHaveBeenCalled();
    expect(vm.history.replaceState).not.toHaveBeenCalled();
    expect(vm.location.replace).not.toHaveBeenCalled();
    expect(vm.geo).not.toHaveBeenCalled();
    expect(vm.get('preview-language').disabled).toBe(true);
    expect(vm.get('preview-status').textContent).toContain('正在開啟 LINE 頁面');
  });
  it.each(['nfc', 'qr', 'link'])(
    'retains venue/source/lang through external login and secondary cleanup: %s',
    async (source) => {
      const route = base + '?venue=tw-tpe-daan&source=' + source + '&lang=en';
      const first = await routeBrowser(route, { loggedIn: false });
      await finishInit();
      expect(first.liff.login).toHaveBeenCalledOnce();
      const redirectUri = 'https://app.test' + route + '&_line_login_attempt=1';
      expect(first.liff.login).toHaveBeenCalledWith({ redirectUri });
      expect(first.history.replaceState).not.toHaveBeenCalled();
      expect(first.get('preview-test').disabled).toBe(true);
      const second = await routeBrowser(
        route + '&_line_login_attempt=1&code=mock-secret&state=mock-oauth'
      );
      await finishInit();
      expect(second.history.replaceState).toHaveBeenCalledWith(null, '', route);
      expect(second.liff.login).not.toHaveBeenCalled();
      expect(second.get('preview-test').disabled).toBe(false);
      expect(second.geo).not.toHaveBeenCalled();
      second.get('preview-language').value = 'zh_CN';
      await second.get('preview-language').onchange?.();
      expect(second.location.replace).toHaveBeenCalledWith(
        base + '?venue=tw-tpe-daan&source=' + source + '&lang=zh_CN'
      );
    }
  );
  it.each([
    { route: valid + '&_line_login_attempt=1', options: { loggedIn: false } },
    { route: valid + '&code=mock-code', options: { loggedIn: false } },
    { route: valid + '&error=access_denied', options: { loggedIn: false } },
    { route: valid, options: { loggedIn: false, inClient: true } },
    { route: valid, options: { idToken: '' } },
    {
      route: valid,
      options: {
        init: async () => {
          throw new Error('private-sdk-error');
        }
      }
    }
  ])('fails closed without login loops or GPS: %#', async ({ route, options }) => {
    const vm = await routeBrowser(route, options);
    await finishInit();
    expect(vm.liff.login).not.toHaveBeenCalled();
    expect(vm.geo).not.toHaveBeenCalled();
    expect(vm.get('preview-test').disabled).toBe(true);
    expect(vm.get('preview-status').textContent).toContain('尚未記錄出席');
    expect(vm.get('preview-status').textContent).not.toContain('private-sdk-error');
  });
  it('does not persist or reuse a private fragment in the external login redirect', async () => {
    const html = (await app.inject(valid)).body;
    const vm = browser(html, 'https://app.test' + valid + '#' + 'a'.repeat(43), {
      loggedIn: false
    });
    await finishInit();
    expect(vm.liff.login).toHaveBeenCalledWith({
      redirectUri: 'https://app.test' + valid + '&_line_login_attempt=1'
    });
    expect(vm.storage.getItem).not.toHaveBeenCalled();
    expect(vm.storage.setItem).not.toHaveBeenCalled();
  });
  it.each([
    [1, '未允許定位'],
    [2, '無法取得定位'],
    [3, '定位逾時']
  ])('shows readable GPS failure %s only after a user click', async (code, message) => {
    const vm = await routeBrowser();
    await finishInit();
    expect(vm.geo).not.toHaveBeenCalled();
    vm.geo.mockImplementation((_success, failure, settings) => {
      expect(settings).toEqual({ enableHighAccuracy: false, timeout: 10000, maximumAge: 0 });
      failure({ code: Number(code) });
    });
    vm.get('preview-test').onclick?.();
    expect(vm.geo).toHaveBeenCalledOnce();
    expect(vm.get('preview-status').textContent).toContain(message);
    expect(vm.get('preview-status').textContent).toContain('尚未記錄出席');
    expect(vm.get('preview-test').disabled).toBe(false);
  });
  it('handles unsupported and throwing geolocation', async () => {
    const unsupported = await routeBrowser(valid, { geolocation: false });
    await finishInit();
    unsupported.get('preview-test').onclick?.();
    expect(unsupported.get('preview-status').textContent).toContain('不支援定位');
    const throwing = await routeBrowser();
    await finishInit();
    throwing.geo.mockImplementation(() => {
      throw new Error('private-gps-error');
    });
    throwing.get('preview-test').onclick?.();
    expect(throwing.get('preview-status').textContent).toContain('無法取得定位');
    expect(throwing.get('preview-status').textContent).not.toContain('private-gps-error');
    expect(throwing.get('preview-test').disabled).toBe(false);
  });
  it('discards raw coordinates; no false attendance success, storage, logs, API or duplicate requests', async () => {
    const vm = await routeBrowser();
    await finishInit();
    let success: ((position: unknown) => void | Promise<void>) | undefined;
    vm.geo.mockImplementation((callback) => {
      success = callback;
    });
    vm.get('preview-test').onclick?.();
    vm.get('preview-test').onclick?.();
    expect(vm.geo).toHaveBeenCalledOnce();
    expect(vm.get('preview-language').disabled).toBe(true);
    const coordinates = vi.fn(() => {
      throw new Error('Coordinates must not be read or serialized');
    });
    await success?.(Object.defineProperty({}, 'coords', { get: coordinates }));
    expect(coordinates).not.toHaveBeenCalled();
    expect(vm.get('preview-status').textContent).toContain('定位已取得，但未經後端場地驗證');
    expect(vm.get('preview-status').textContent).toContain('尚未記錄出席');
    expect(vm.get('preview-status').textContent).not.toContain('簽到成功');
    expect(vm.get('preview-test').disabled).toBe(false);
    expect(vm.get('preview-language').disabled).toBe(false);
    expect(vm.storage.getItem).not.toHaveBeenCalled();
    expect(vm.storage.setItem).not.toHaveBeenCalled();
    expect(vm.log).not.toHaveBeenCalled();
    expect(vm.history.replaceState).toHaveBeenCalledWith(null, '', valid);
  });
});
