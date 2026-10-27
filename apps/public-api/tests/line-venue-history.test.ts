import { setImmediate } from 'node:timers/promises';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { renderVenuePreview } from '../src/line-venue-checkin-page.js';
import {
  renderLineVenueHistoryPage,
  venueHistoryRequest,
  venueHistoryUrl
} from '../src/line-venue-history-page.js';

const base = '/line/venue-history';
const primary = (suffix = '/venue-history') => '/line/?liff.state=' + encodeURIComponent(suffix);
const htmlFor = (url = base, liffId = 'existing-liff') => {
  const request = venueHistoryRequest(url);
  return renderLineVenueHistoryPage({
    liffId,
    entry: request.kind === 'history' ? request.entry : null
  });
};
const row = {
  id: 'synthetic-attendance-1',
  venueCode: 'tw-test-one',
  venueName: 'Synthetic venue',
  checkedInAt: '2026-10-25T23:30:00.000Z',
  venueLocalDate: '2026-10-26',
  venueTimezone: 'Asia/Taipei'
};
const success = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  timezone: 'Asia/Taipei',
  totals: { attendanceCount: 31, attendanceDays: 25, monthCount: 7 },
  page: 1,
  pageSize: 20,
  hasMore: false,
  entries: [row],
  ...overrides
});
const response = (data: unknown = success(), status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: vi.fn(async (): Promise<unknown> => data)
});
type MockResponse = ReturnType<typeof response>;
type HistoryRequestInit = Omit<RequestInit, 'body'> & { body: string };
interface NodeStub {
  textContent: string;
  disabled: boolean;
  hidden: boolean;
  value: string;
  children: NodeStub[];
  attributes: Record<string, string>;
  onclick?: () => void;
  onchange?: () => void;
  onsubmit?: (event: { preventDefault: () => void }) => void;
  replaceChildren: (...children: NodeStub[]) => void;
  setAttribute: (key: string, value: string) => void;
}
const settle = () => setImmediate();
const browser = (
  url = base,
  options: {
    html?: string;
    loggedIn?: boolean;
    inClient?: boolean;
    idToken?: string;
    init?: () => Promise<void>;
    fetch?: (url: string, init: HistoryRequestInit) => Promise<MockResponse>;
  } = {}
) => {
  const html = options.html ?? htmlFor(url);
  const nodes = new Map<string, NodeStub>();
  const forbidden = vi.fn(() => {
    throw new Error('Forbidden storage / logging / GPS / HTML sink');
  });
  const createNode = (): NodeStub => {
    const node: NodeStub = {
      textContent: '',
      disabled: false,
      hidden: false,
      value: '',
      children: [],
      attributes: {},
      replaceChildren: (...children) => {
        node.children = children;
      },
      setAttribute: (key, value) => {
        node.attributes[key] = value;
      }
    };
    Object.defineProperty(node, 'innerHTML', { set: forbidden });
    return node;
  };
  const get = (id: string): NodeStub => {
    const key = 'history-' + id;
    const existing = nodes.get(key);
    if (existing) return existing;
    const node = createNode();
    const tag = new RegExp('<[a-z]+\\b[^>]*\\bid="' + key + '"[^>]*>').exec(html)?.[0] ?? '';
    node.disabled = /\sdisabled(?:\s|>)/.test(tag);
    node.hidden = /\shidden(?:\s|>)/.test(tag);
    node.value = /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? '';
    if (id === 'language') node.value = /value="([^"]*)"[^>]* selected/.exec(html)?.[1] ?? '';
    if (id === 'status')
      node.textContent = /id="history-status"[^>]*>([^<]*)/.exec(html)?.[1] ?? '';
    nodes.set(key, node);
    return node;
  };
  const entry = new URL(url, 'https://app.test');
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
    getIDToken: vi.fn(() => options.idToken ?? 'mock-token-memory-only'),
    login: vi.fn()
  };
  const fetch = vi.fn<(url: string, init: HistoryRequestInit) => Promise<MockResponse>>(
    options.fetch ?? (async () => response())
  );
  const timeout = vi.fn(() => ({}));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Missing controller');
  new Script(script).runInNewContext({
    URL,
    URLSearchParams,
    Intl,
    document: {
      cookie: '',
      getElementById: (id: string) => get(id.replace(/^history-/, '')),
      createElement: createNode
    },
    location,
    history,
    liff,
    fetch,
    AbortSignal: { timeout },
    localStorage: { getItem: forbidden, setItem: forbidden },
    sessionStorage: { getItem: forbidden, setItem: forbidden },
    console: { log: forbidden, warn: forbidden, error: forbidden },
    navigator: { geolocation: { getCurrentPosition: forbidden }, vibrate: forbidden }
  });
  const submit = async () => {
    const preventDefault = vi.fn();
    get('filters').onsubmit?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    await settle();
  };
  return { get, liff, fetch, history, location, forbidden, submit, timeout };
};

describe('check-in success history link', () => {
  it.each([200, 503])(
    'reveals the link only on validated check-in success: HTTP %s',
    async (status) => {
      const html = renderVenuePreview(
        'existing-liff',
        { venue: 'tw-test-one', lang: 'zh_TW' },
        'checkin',
        true
      );
      expect(html).toContain('href="https://liff.line.me/existing-liff/venue-history?lang=zh_TW"');
      expect(html).toContain('href="/line/checkin?lang=zh_TW"');
      expect(html).toContain('referrerpolicy="no-referrer" hidden>查看我的團練紀錄');
      expect(html).not.toMatch(/venue-history\?[^"\s]*(?:idToken|personId|token|venue)=/);
      const nodes = new Map<
        string,
        Pick<NodeStub, 'textContent' | 'disabled' | 'hidden' | 'value' | 'onclick' | 'onchange'>
      >();
      const get = (id: string) => {
        const existing = nodes.get(id);
        if (existing) return existing;
        const node: Pick<
          NodeStub,
          'textContent' | 'disabled' | 'hidden' | 'value' | 'onclick' | 'onchange'
        > = {
          textContent: '',
          disabled: true,
          hidden: id === 'preview-history',
          value: 'zh_TW'
        };
        nodes.set(id, node);
        return node;
      };
      const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
      if (!script) throw new Error('Missing check-in controller');
      const fetch = vi.fn(async () =>
        response(
          {
            ok: true,
            venue: { name: 'Synthetic venue', timezone: 'Asia/Taipei' },
            checkedInAt: row.checkedInAt
          },
          status
        )
      );
      new Script(script).runInNewContext({
        URL,
        URLSearchParams,
        document: { cookie: '', getElementById: get },
        location: {
          href: 'https://app.test/line/venue-checkin?venue=tw-test-one',
          search: '',
          hash: ''
        },
        history: { replaceState: vi.fn() },
        liff: { init: async () => {}, isLoggedIn: () => true, getIDToken: () => 'mock-token' },
        navigator: {
          geolocation: {
            getCurrentPosition: (callback: (position: unknown) => void) =>
              callback({ coords: { latitude: 0, longitude: 0 } })
          }
        },
        fetch
      });
      await settle();
      expect(get('preview-history').hidden).toBe(true);
      get('preview-test').onclick?.();
      await settle();
      expect(get('preview-history').hidden).toBe(status !== 200);
      expect(fetch).toHaveBeenCalledOnce();
    }
  );
  it('leaves preview mode unchanged and uses a same-origin fallback for invalid configuration', () => {
    const entry = { venue: 'tw-test-one', lang: 'en' } as const;
    expect(renderVenuePreview('existing-liff', entry)).not.toContain('id="preview-history"');
    expect(renderVenuePreview('existing-liff', entry, 'checkin')).not.toContain(
      'id="preview-history"'
    );
    expect(renderVenuePreview('</script>unsafe', entry, 'checkin', true)).toContain(
      'href="/line/venue-history?lang=en"'
    );
  });
});

// No app, DB, real SDK, real fetch or credentials are used by this suite.
describe('history request discriminator and safe renderer', () => {
  it.each([base, primary(), base + '?month=2026-10', base + '?venue=tw-test-one'])(
    'does not require a venue: %s',
    (url) => expect(venueHistoryRequest(url).kind).toBe('history')
  );
  it.each(['/line/', '/line/checkin', '/line/?liff.state=%2Fvenue-checkin%3Fvenue%3Dtw-test'])(
    'leaves other routes alone: %s',
    (url) => expect(venueHistoryRequest(url).kind).toBe('none')
  );
  const invalidQueries = [
    '?month=',
    '?month=0000-01',
    '?month=2026-00',
    '?month=2026-13',
    '?month=26-10',
    '?month=2026-10&month=2026-09',
    '?venue=',
    '?venue=TW-test',
    '?venue=tw--test',
    '?venue=' + 'a'.repeat(65) + '-test',
    '?venue=tw-test&venue=sg-test',
    '?page=0',
    '?page=-1',
    '?page=1.5',
    '?page=01',
    '?page=1e2',
    '?page=9007199254740992',
    '?page=1&page=2',
    '?lang=fr',
    '?lang=en&lang=zh_TW',
    '?month=%FF',
    '?venue=%3Cscript%3Eattack-marker%3C%2Fscript%3E',
    ...[
      'personId',
      'person',
      'idToken',
      'token',
      'latitude',
      'longitude',
      'redirect',
      'source',
      'unknown'
    ].map((key) => '?' + key + '=attack-marker')
  ];
  it.each(invalidQueries)('rejects unknown, identity and malformed queries: %s', (query) => {
    for (const url of [base + query, primary('/venue-history' + query)]) {
      expect(venueHistoryRequest(url).kind).toBe('invalid');
      const html = htmlFor(url);
      expect(html).not.toContain('<script');
      expect(html).not.toContain('attack-marker');
      expect(html).toContain('查詢參數無效');
    }
  });
  it.each([
    primary() + '&personId=attack-marker',
    primary() + '&liff.state=%2Fvenue-history',
    primary('/venue-history/../checkin'),
    primary('/venue-history#attack-marker'),
    primary('/venue-history?month=%FF'),
    primary('/venue-history?venue=' + 'a'.repeat(513)),
    base + '#attack-marker',
    base + '?liff.state=%2Fvenue-history',
    base + '?error=' + 'a'.repeat(8192)
  ])('rejects unsafe primary state / callback combinations: %s', (url) => {
    expect(venueHistoryRequest(url).kind).toBe('invalid');
  });
  it('uses enumerated locale or the existing presentation cookie', () => {
    expect(venueHistoryRequest(base, '__Host-qigong-learner-locale=en')).toEqual({
      kind: 'history',
      entry: { lang: 'en' }
    });
    expect(venueHistoryUrl({ lang: 'zh_CN', month: '2026-10', venue: 'tw-test', page: 2 })).toBe(
      base + '?month=2026-10&venue=tw-test&page=2&lang=zh_CN'
    );
  });
  it.each(['zh_TW', 'zh_CN', 'en'])('renders accessible, zoomable %s UI', (lang) => {
    const html = htmlFor(base + '?lang=' + lang);
    expect(html).toContain('font:20px/');
    expect(html).toContain('min-height:48px');
    expect(html).toContain('font-size:18px');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-describedby="history-filter-help"');
    expect(html).toContain('id="history-venue" type="text"');
    expect(html).toContain('href="/line/checkin?lang=' + lang + '"');
    expect(html).toContain('Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting');
    expect(html).not.toMatch(
      /user-scalable=no|maximum-scale|localStorage|sessionStorage|geolocation|sendBeacon/
    );
  });
  it('escapes configured inline script data without executing it', async () => {
    const evil = '</script><script>attack-marker()</script>\u2028\u2029&';
    const vm = browser(base, { html: htmlFor(base, evil) });
    await settle();
    expect(vm.liff.init).toHaveBeenCalledWith({ liffId: evil });
    expect(htmlFor(base, evil)).not.toContain('</script><script>attack-marker');
    expect(vm.forbidden).not.toHaveBeenCalled();
  });
});

describe('actual inline controller in VM with mocked SDK and fetch', () => {
  it('shows loading, blocks actions, then renders authenticated lifetime totals and local date/timezone', async () => {
    let complete: ((result: MockResponse) => void) | undefined;
    const pending = new Promise<MockResponse>((resolve) => {
      complete = resolve;
    });
    const vm = browser(base, { fetch: async () => pending });
    await settle();
    expect(vm.get('status').textContent).toContain('正在載入');
    expect(vm.get('main').attributes['aria-busy']).toBe('true');
    expect(vm.get('totals').hidden).toBe(true);
    expect(vm.get('apply').disabled).toBe(true);
    await vm.submit();
    vm.get('next').onclick?.();
    expect(vm.fetch).toHaveBeenCalledOnce();
    const [url, init] = vm.fetch.mock.calls[0] ?? [];
    expect(url).toBe('/api/line/venue-history');
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-venue-history': '1' }
    });
    expect(JSON.parse(String(init?.body))).toEqual({ idToken: 'mock-token-memory-only', page: 1 });
    expect(vm.timeout).toHaveBeenCalledWith(15000);
    complete?.(response());
    await settle();
    expect(vm.get('status').textContent).toContain('由新到舊');
    expect(vm.get('count').textContent).toBe('31');
    expect(vm.get('days').textContent).toBe('25');
    expect(vm.get('month-count').textContent).toBe('7');
    expect(vm.get('month-period').textContent).toMatch(/^[0-9]{4}-[0-9]{2}$/);
    expect(vm.get('totals').hidden).toBe(false);
    expect(vm.get('entries').children[0]?.textContent).toContain(
      '2026-10-26 07:30:00 (Asia/Taipei)'
    );
    expect(vm.get('apply').disabled).toBe(false);
    expect(vm.get('main').attributes['aria-busy']).toBe('false');
    expect(vm.forbidden).not.toHaveBeenCalled();
  });
  it('renders truthful empty state and zero totals only after success', async () => {
    const vm = browser(base, {
      fetch: async () =>
        response(
          success({
            totals: { attendanceCount: 0, attendanceDays: 0, monthCount: 0 },
            entries: []
          })
        )
    });
    await settle();
    expect(vm.get('status').textContent).toContain('沒有團練紀錄');
    expect(vm.get('entries').children).toEqual([]);
    expect(vm.get('count').textContent).toBe('0');
    expect(vm.get('previous').disabled).toBe(true);
    expect(vm.get('next').disabled).toBe(true);
  });
  it('applies month and full venue code, paginates, resets page and retains filters on language switch', async () => {
    const vm = browser();
    await settle();
    vm.fetch.mockResolvedValueOnce(response(success({ hasMore: true })));
    vm.get('month').value = '2026-10';
    vm.get('venue').value = ' tw-test-one ';
    await vm.submit();
    expect(JSON.parse(String(vm.fetch.mock.calls[1]?.[1].body))).toEqual({
      idToken: 'mock-token-memory-only',
      month: '2026-10',
      venue: 'tw-test-one',
      page: 1
    });
    expect(vm.get('month-period').textContent).toBe('2026-10');
    vm.fetch.mockResolvedValueOnce(response(success({ page: 2, entries: [], hasMore: false })));
    vm.get('next').onclick?.();
    await settle();
    expect(JSON.parse(String(vm.fetch.mock.calls[2]?.[1].body)).page).toBe(2);
    expect(vm.get('page').textContent).toBe('頁次 2');
    expect(vm.get('previous').disabled).toBe(false);
    expect(vm.get('next').disabled).toBe(true);
    vm.get('previous').onclick?.();
    await settle();
    expect(JSON.parse(String(vm.fetch.mock.calls[3]?.[1].body)).page).toBe(1);
    vm.get('language').value = 'en';
    vm.get('language').onchange?.();
    expect(vm.location.replace).toHaveBeenCalledWith(
      base + '?month=2026-10&venue=tw-test-one&lang=en'
    );
    vm.get('month').value = '';
    vm.get('venue').value = '';
    await vm.submit();
    expect(JSON.parse(String(vm.fetch.mock.calls[4]?.[1].body))).toEqual({
      idToken: 'mock-token-memory-only',
      page: 1
    });
    expect(vm.forbidden).not.toHaveBeenCalled();
  });
  it.each([
    ['2026-13', ''],
    ['', '<img src=x>'],
    ['', 'tw--test']
  ])('rejects malformed UI filters without fetching: %s / %s', async (month, venue) => {
    const vm = browser();
    await settle();
    vm.get('month').value = month;
    vm.get('venue').value = venue;
    await vm.submit();
    expect(vm.fetch).toHaveBeenCalledOnce();
    expect(vm.get('totals').hidden).toBe(true);
    expect(vm.get('entries').children).toEqual([]);
    expect(vm.get('next').disabled).toBe(true);
    expect(vm.get('status').textContent).toContain('查詢參數無效');
  });
  it('clears stale records on fetch rejection and retries without fabricated success', async () => {
    const vm = browser();
    await settle();
    vm.fetch.mockRejectedValueOnce(new Error('private-token-in-transport-error'));
    await vm.submit();
    expect(vm.get('status').textContent).toContain('服務尚未就緒');
    expect(vm.get('status').textContent).not.toContain('private-token');
    expect(vm.get('totals').hidden).toBe(true);
    expect(vm.get('count').textContent).toBe('');
    expect(vm.get('entries').children).toEqual([]);
    expect(vm.get('retry').hidden).toBe(false);
    vm.get('retry').onclick?.();
    await settle();
    expect(vm.fetch).toHaveBeenCalledTimes(3);
    expect(vm.get('totals').hidden).toBe(false);
    expect(vm.forbidden).not.toHaveBeenCalled();
  });
  it.each([400, 403, 404, 503])(
    'handles stable HTTP %s without echoing error payload',
    async (status) => {
      const error = response({ error: '<script>private-sensitive-value</script>' }, status);
      const vm = browser(base, { fetch: async () => error });
      await settle();
      expect(error.json).not.toHaveBeenCalled();
      expect(vm.get('status').textContent).toContain(
        status === 400 ? '查詢參數無效' : status === 403 ? '隱私同意' : '服務尚未就緒'
      );
      expect(vm.get('status').textContent).not.toContain('private-sensitive');
      expect(vm.get('totals').hidden).toBe(true);
      expect(vm.get('entries').children).toEqual([]);
      expect(vm.get('retry').disabled).toBe(false);
    }
  );
  it('fails closed on expired token and reopens the same official LIFF with public filters only', async () => {
    const route = base + '?month=2026-10&venue=tw-test-one&page=2&lang=en';
    const vm = browser(route, { fetch: async () => response({ error: 'unauthenticated' }, 401) });
    await settle();
    expect(vm.get('status').textContent).toContain('expired');
    expect(vm.get('apply').disabled).toBe(true);
    expect(vm.get('entries').children).toEqual([]);
    vm.get('retry').onclick?.();
    expect(vm.location.replace).toHaveBeenCalledWith(
      'https://liff.line.me/existing-liff/venue-history?month=2026-10&venue=tw-test-one&page=2&lang=en'
    );
    expect(vm.fetch).toHaveBeenCalledOnce();
    expect(vm.liff.login).not.toHaveBeenCalled();
  });
  it('rechecks the current SDK credential before each request', async () => {
    const vm = browser();
    await settle();
    vm.liff.getIDToken.mockReturnValue('');
    await vm.submit();
    expect(vm.fetch).toHaveBeenCalledOnce();
    expect(vm.get('status').textContent).toContain('已失效');
    expect(vm.get('totals').hidden).toBe(true);
    expect(vm.get('apply').disabled).toBe(true);
  });
  it.each([
    {},
    success({ pageSize: 10 }),
    success({ page: 2 }),
    success({ timezone: 'UTC' }),
    success({ totals: { attendanceCount: -1, attendanceDays: 1, monthCount: 1 } }),
    success({ entries: [{ ...row, checkedInAt: 'not-a-date' }] }),
    success({ entries: [{ ...row, venueTimezone: 'unknown/zone' }] }),
    success({ entries: [{ ...row, venueLocalDate: '2026-02-30' }] }),
    success({ entries: Array.from({ length: 21 }, () => row) })
  ])('rejects malformed success data rather than displaying invented totals: %#', async (data) => {
    const vm = browser(base, { fetch: async () => response(data) });
    await settle();
    expect(vm.get('status').textContent).toContain('服務尚未就緒');
    expect(vm.get('totals').hidden).toBe(true);
    expect(vm.get('entries').children).toEqual([]);
  });
  it('uses textContent for untrusted names/codes, sorts newest first, and keeps venue-local dates', async () => {
    const evil = '<img src=x onerror="attack-marker()">&';
    const newer = {
      ...row,
      id: 'newer',
      checkedInAt: '2026-10-26T03:00:00Z',
      venueName: evil,
      venueCode: evil
    };
    const older = {
      ...row,
      id: 'older',
      venueTimezone: 'Pacific/Honolulu',
      venueLocalDate: '2026-10-25'
    };
    const vm = browser(base, { fetch: async () => response(success({ entries: [older, newer] })) });
    await settle();
    const displayed = vm.get('entries').children.map((node) => node.textContent);
    expect(displayed[0]).toContain(evil);
    expect(displayed[1]).toContain('2026-10-25 13:30:00 (Pacific/Honolulu)');
    expect(vm.forbidden).not.toHaveBeenCalled();
  });
  it('leaves primary state untouched and lets the SDK own secondary navigation', async () => {
    let complete: (() => void) | undefined;
    const init = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const vm = browser(primary('/venue-history?month=2026-10&lang=en'), {
      loggedIn: false,
      init: () => init
    });
    expect(vm.liff.init).toHaveBeenCalledOnce();
    expect(vm.history.replaceState).not.toHaveBeenCalled();
    expect(vm.get('apply').disabled).toBe(true);
    complete?.();
    await settle();
    expect(vm.liff.isLoggedIn).not.toHaveBeenCalled();
    expect(vm.liff.login).not.toHaveBeenCalled();
    expect(vm.fetch).not.toHaveBeenCalled();
    expect(vm.history.replaceState).not.toHaveBeenCalled();
    expect(vm.location.replace).not.toHaveBeenCalled();
    expect(vm.get('status').textContent).toContain('Opening the LINE page');
  });
  it('preserves only allowlisted filters through login and callback cleanup', async () => {
    const route = base + '?month=2026-10&venue=tw-test-one&page=2&lang=en';
    const first = browser(route, { loggedIn: false });
    await settle();
    expect(first.liff.login).toHaveBeenCalledWith({
      redirectUri: 'https://app.test' + route + '&_line_login_attempt=1'
    });
    expect(first.fetch).not.toHaveBeenCalled();
    const second = browser(
      route +
        '&_line_login_attempt=1&code=private-code&state=private-state&liffRedirectUri=https%3A%2F%2Fevil.test',
      {
        fetch: async () => response(success({ page: 2 }))
      }
    );
    await settle();
    expect(second.history.replaceState).toHaveBeenCalledWith(null, '', route);
    expect(second.location.replace).not.toHaveBeenCalled();
    expect(second.fetch.mock.calls[0]?.[0]).toBe('/api/line/venue-history');
    expect(second.fetch.mock.calls[0]?.[1].body).not.toContain('private-code');
    expect(second.forbidden).not.toHaveBeenCalled();
  });
  it.each([
    { route: base + '?_line_login_attempt=1', options: { loggedIn: false } },
    { route: base + '?code=private-code', options: { loggedIn: false } },
    { route: base + '?error=access_denied', options: { loggedIn: false } },
    { route: base, options: { loggedIn: false, inClient: true } },
    { route: base, options: { idToken: '' } },
    {
      route: base,
      options: {
        init: async () => {
          throw new Error('private-sdk-error');
        }
      }
    }
  ])('does not loop login or leak SDK errors: %#', async ({ route, options }) => {
    const vm = browser(route, options);
    await settle();
    expect(vm.liff.login).not.toHaveBeenCalled();
    expect(vm.fetch).not.toHaveBeenCalled();
    expect(vm.get('status').textContent).toContain('LINE 登入未完成或已失效');
    expect(vm.get('status').textContent).not.toContain('private-');
    expect(vm.get('apply').disabled).toBe(true);
    expect(vm.forbidden).not.toHaveBeenCalled();
  });
});
