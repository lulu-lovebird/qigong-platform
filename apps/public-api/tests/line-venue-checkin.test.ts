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
const canonical = valid + '&lang=zh_TW';
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
  onchange?: () => void;
}
type GeoRequest = (
  success: (position: unknown) => void,
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
  } = {}
) => {
  const nodes = new Map<string, NodeStub>();
  const get = (id: string) => {
    let node = nodes.get(id);
    if (!node) {
      node = {
        textContent: '',
        disabled: id === 'preview-test' || id === 'preview-language',
        value: 'zh_TW'
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
  new Script(script).runInNewContext({
    URL,
    URLSearchParams,
    document: { getElementById: get, cookie: '' },
    location,
    history,
    liff,
    navigator: options.geolocation === false ? {} : { geolocation: { getCurrentPosition: geo } },
    fetch: fetchMock,
    localStorage: storage,
    sessionStorage: storage,
    console: { log, error: log, warn: log },
    window: {}
  });
  return { get, location, history, liff, geo, storage, log };
};
const routeBrowser = async (route = valid, options: Parameters<typeof browser>[2] = {}) =>
  browser((await app.inject(route)).body, 'https://app.test' + route, options);
const finishInit = () => setImmediate();

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
    const vm = browser(response.body);
    await finishInit();
    expect(vm.history.replaceState).toHaveBeenCalledWith(null, '', valid + '&lang=en');
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
      second.get('preview-language').onchange?.();
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
      redirectUri: 'https://app.test' + canonical + '&_line_login_attempt=1'
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
    let success: ((position: unknown) => void) | undefined;
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
    success?.(Object.defineProperty({}, 'coords', { get: coordinates }));
    expect(coordinates).not.toHaveBeenCalled();
    expect(vm.get('preview-status').textContent).toContain('定位已取得，但未經後端場地驗證');
    expect(vm.get('preview-status').textContent).toContain('尚未記錄出席');
    expect(vm.get('preview-status').textContent).not.toContain('簽到成功');
    expect(vm.get('preview-test').disabled).toBe(false);
    expect(vm.get('preview-language').disabled).toBe(false);
    expect(vm.storage.getItem).not.toHaveBeenCalled();
    expect(vm.storage.setItem).not.toHaveBeenCalled();
    expect(vm.log).not.toHaveBeenCalled();
    expect(vm.history.replaceState).toHaveBeenCalledWith(null, '', canonical);
  });
});
