import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { renderAdminDashboard, type AdminPage } from '../src/admin-dashboard.js';
import { renderReviewPage } from '../src/admin-pages.js';
import { adminLocaleCookie, type AdminLocale } from '../src/admin-locale.js';

type Handler = (event: { preventDefault: () => void }) => unknown;
interface Element {
  tag: string;
  children: Element[];
  textContent: string;
  value: string;
  className: string;
  disabled: boolean;
  checked: boolean;
  indeterminate: boolean;
  hidden: boolean;
  href: string;
  type: string;
  dataset: Record<string, string>;
  style: Record<string, string>;
  attributes: Record<string, string>;
  listeners: Map<string, Handler>;
  append(...elements: Element[]): void;
  replaceChildren(...elements: Element[]): void;
  addEventListener(event: string, handler: Handler): void;
  setAttribute(name: string, value: string): void;
  focus(): void;
}
const element = (tag = 'div'): Element => {
  let text = '';
  const result: Element = {
    tag,
    children: [],
    get textContent() {
      return text + this.children.map((child) => child.textContent).join(' ');
    },
    set textContent(value) {
      text = value;
      this.children = [];
    },
    value: '',
    className: '',
    disabled: false,
    checked: false,
    indeterminate: false,
    hidden: false,
    href: '',
    type: '',
    dataset: {},
    style: {},
    attributes: {},
    listeners: new Map(),
    append(...elements) {
      this.children.push(...elements);
    },
    replaceChildren(...elements) {
      text = '';
      this.children = [...elements];
    },
    addEventListener(event, handler) {
      this.listeners.set(event, handler);
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus() {}
  };
  return result;
};
const unsafeName = '<img src=x onerror=alert(1)>';
const personId = 'ea1346d9-85b5-4382-9742-8857d6e56858';
const learner = {
  id: personId,
  display_name: unsafeName,
  region_name: '甲區',
  platforms: 'telegram',
  practice_timezone: 'Asia/Taipei'
};
const methods = [
  { code: 'dayan_chu', name: '大雁初級', parent_name: '大雁', days: 2, share: 50 },
  { code: 'dayan_gao', name: '大雁高級', parent_name: '大雁', days: 2, share: 50 }
];
const overview = {
  range: { start: '2026-10-01', today: '2026-10-08', end: '2026-10-09', timezone: 'Asia/Taipei' },
  kpis: { total_checkins: 7, active_users: 3, average_daily: 0.9, learners: 4 },
  trend: [
    { date: '2026-10-01', count: 0 },
    { date: '2026-10-02', count: 7 }
  ],
  regions: [{ id: personId, name: '甲區' }]
};
const paginated = { rows: [learner], total: 21, page: 1, totalPages: 2, limit: 20 };
const ranking = {
  ...learner,
  total_days: 7,
  period_days: 3,
  max_streak: 2,
  current_streak: 2,
  last_checkin: '2026-10-08'
};
const requestUrl = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
const translatedFixture = (value: unknown): unknown => {
  const names: Readonly<Record<string, string>> = {
    甲區: 'Region A',
    大雁初級: 'Dayan Basic',
    大雁高級: 'Dayan Advanced',
    大雁: 'Wild Goose'
  };
  if (typeof value === 'string') return names[value] ?? value;
  if (Array.isArray(value)) return value.map(translatedFixture);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, translatedFixture(item)])
    );
  return value;
};
const mockResponse = (url: string): Response => {
  const parsed = new URL(url, 'https://checkin.baiyinqigong.org');
  const view = parsed.pathname.split('/').at(-1);
  const page = Number(parsed.searchParams.get('page') || 1);
  const json = (value: unknown) =>
    Response.json(parsed.searchParams.get('lang') === 'en' ? translatedFixture(value) : value);
  if (view === 'applications')
    return json({
      applications: [
        {
          ...learner,
          learner_name: unsafeName,
          display_name: unsafeName,
          platform: 'telegram',
          created_at: '2026-10-08T00:00:00Z',
          website_email: 'mock@example.com',
          phone_e164: '+886912345600'
        }
      ]
    });
  if (view === 'logout') return json({ ok: true });
  if (view === 'overview') return json(overview);
  if (view === 'status' || view === 'search') return json({ ...paginated, page });
  if (view === 'leaderboard')
    return json({
      ...paginated,
      rows: [ranking],
      top: [ranking],
      streaks: [ranking],
      page
    });
  if (view === 'methods') return json({ methods });
  if (view === 'person')
    return json({
      person: learner,
      analyses: [
        { days: 30, totalDays: 2, methods },
        { days: 90, totalDays: 7, methods }
      ],
      history: {
        ...paginated,
        page,
        rows: [
          {
            id: personId,
            practice_date: '2026-10-08',
            practice_timezone: 'Asia/Taipei',
            entry_kind: 'makeup',
            platform: 'telegram',
            methods: ['大雁初級']
          }
        ]
      }
    });
  return Response.json({ error: 'unknown' }, { status: 400 });
};
const fixture = (
  page: Exclude<AdminPage, 'access'>,
  search = '',
  fetchImpl?: typeof fetch,
  locale: AdminLocale = 'zh_TW',
  confirmSwitch = true
) => {
  const html = page === 'review' ? renderReviewPage(locale) : renderAdminDashboard(page, locale);
  const fields = new Map<string, Element>();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) fields.set(match[1]!, element());
  if (fields.has('period')) fields.get('period')!.value = 'week';
  if (fields.has('top')) fields.get('top')!.value = '10';
  const tags: string[] = [];
  const create = (tag: string) => {
    tags.push(tag);
    return element(tag);
  };
  const fetchMock = vi.fn<typeof fetch>(
    fetchImpl ?? (async (input) => mockResponse(requestUrl(input)))
  );
  let url = new URL('https://checkin.baiyinqigong.org/admin/' + search);
  const location = {
    get href() {
      return url.href;
    },
    get search() {
      return url.search;
    },
    assign: vi.fn<(url: string) => void>()
  };
  const history = {
    replaceState: vi.fn((_state: unknown, _unused: string, path: string) => {
      url = new URL(path, url);
    })
  };
  const cookieJar = new Map([['__Host-qigong-admin-csrf', 'mock-csrf']]);
  const cookieWrites: string[] = [];
  const confirmMock = vi.fn(() => confirmSwitch);
  const document = {
    get cookie() {
      return [...cookieJar].map(([key, value]) => key + '=' + value).join('; ');
    },
    set cookie(value: string) {
      cookieWrites.push(value);
      const pair = value.split(';')[0]!;
      const index = pair.indexOf('=');
      cookieJar.set(pair.slice(0, index), pair.slice(index + 1));
    },
    getElementById: (id: string) => fields.get(id),
    createElement: create,
    createElementNS: (_namespace: string, tag: string) => create(tag)
  };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Missing script');
  vm.runInNewContext(
    script,
    { document, fetch: fetchMock, URL, URLSearchParams, location, history, confirm: confirmMock },
    { timeout: 1000 }
  );
  return { html, fields, fetchMock, location, history, tags, cookieJar, cookieWrites, confirmMock };
};
const settle = async () => {
  for (let i = 0; i < 5; i++) await setImmediate();
};
const descendants = (root: Element): Element[] => [root, ...root.children.flatMap(descendants)];
const dispatch = (target: Element, event: string) =>
  target.listeners.get(event)?.({ preventDefault: () => {} });

describe('administrator language navigation placement', () => {
  it.each([
    ['overview', 'zh_TW'],
    ['overview', 'en'],
    ['leaderboard', 'zh_TW'],
    ['leaderboard', 'en'],
    ['methods', 'zh_TW'],
    ['methods', 'en'],
    ['review', 'zh_TW'],
    ['review', 'en']
  ] as const)('places %s language controls above the navigation in %s', (page, locale) => {
    const html = page === 'review' ? renderReviewPage(locale) : renderAdminDashboard(page, locale);
    const sidebar = html.match(/<aside class="sidebar">([\s\S]*?)<\/aside>/)?.[1];
    const header = html.match(/<header>([\s\S]*?)<\/header>/)?.[1];
    if (!sidebar || !header) throw new Error('Missing sidebar or workspace header');
    const languages = sidebar.indexOf('class="languages"');
    expect(languages).toBeGreaterThan(sidebar.indexOf('class="brand"'));
    expect(languages).toBeLessThan(sidebar.indexOf('<nav'));
    expect(sidebar.indexOf('</div>', languages)).toBeLessThan(sidebar.indexOf('<nav'));
    expect(sidebar).toContain('id="admin-language"');
    expect(sidebar).toContain(
      'value="' + locale + '" lang="' + (locale === 'en' ? 'en' : 'zh-Hant') + '" selected'
    );
    expect(html.match(/id="admin-language"/g)).toHaveLength(1);
    expect(sidebar.indexOf('id="logout"')).toBeGreaterThan(sidebar.indexOf('</nav>'));
    expect(header).not.toContain('class="languages"');
    expect(header).not.toContain('id="logout"');
    expect(html).toContain('@media(max-width:760px)');
    expect(html).toContain('.sidebar .languages select:focus-visible');
  });
});

describe('ported administrator interface generated scripts', () => {
  it.each(['overview', 'leaderboard', 'methods'] as const)(
    'renders %s entirely in English with localized API queries',
    async (mode) => {
      const page = fixture(mode, '?lang=en&personId=' + personId, undefined, 'en');
      await settle();
      expect(page.html).toContain('<html lang="en">');
      expect(page.html).toContain('id="admin-language"');
      expect(page.html).toContain('Interface language');
      const labels = {
        overview: 'Check-in person-days',
        leaderboard: 'Lifetime check-in list',
        methods: 'Method distribution'
      };
      expect(page.fields.get('report')!.textContent).toContain(labels[mode]);
      expect(page.fields.get('status')!.textContent).toContain('has loaded');
      expect(page.fields.get('report')!.textContent).not.toMatch(/[㐀-鿿]/u);
      expect(page.tags).not.toContain('img');
      expect(
        page.fetchMock.mock.calls.every(
          (call) =>
            new URL(requestUrl(call[0]), 'https://test.example').searchParams.get('lang') === 'en'
        )
      ).toBe(true);
      if (mode === 'methods') {
        expect(page.fields.get('report')!.textContent).toContain('Last 30 days');
        expect(page.fields.get('report')!.textContent).toContain('Makeup');
        expect(page.fields.get('report')!.textContent).toContain('Dayan Basic');
      }
    }
  );
  it.each([
    ['overview', 'zh_TW'],
    ['overview', 'en'],
    ['review', 'zh_TW'],
    ['review', 'en']
  ] as const)(
    'localizes %s network errors in %s without exposing transport diagnostics',
    async (mode, locale) => {
      const page = fixture(
        mode,
        '',
        async () => {
          throw new Error('private upstream diagnostic');
        },
        locale
      );
      await settle();
      const expected =
        mode === 'review'
          ? locale === 'en'
            ? 'Unable to load pending applications. Please try again.'
            : '無法載入待審名單，請稍後重試。'
          : locale === 'en'
            ? 'Unable to load data. Please try again.'
            : '無法載入，請稍後重試。';
      expect(page.fields.get('status')!.textContent).toBe(expected);
      expect(page.fields.get('status')!.textContent).not.toContain('upstream');
    }
  );

  it('switches in the sidebar while preserving applied filters/person/date and writing only a safe preference cookie', async () => {
    const search =
      '?lang=zh_TW&period=month&region=' +
      personId +
      '&platform=telegram&q=Alice&date=2026-10-02&personId=' +
      personId;
    const page = fixture('overview', search);
    await settle();
    page.fields.get('admin-language')!.value = 'en';
    dispatch(page.fields.get('admin-language')!, 'change');
    const target = new URL(page.location.assign.mock.calls[0]![0], 'https://test.example');
    for (const [key, value] of new URLSearchParams(search))
      expect(target.searchParams.get(key)).toBe(key === 'lang' ? 'en' : value);
    expect(page.cookieJar.get(adminLocaleCookie)).toBe('en');
    expect(page.cookieJar.get('__Host-qigong-admin-csrf')).toBe('mock-csrf');
    expect(page.cookieWrites).toEqual([
      adminLocaleCookie + '=en; Path=/; Max-Age=31536000; Secure; SameSite=Lax'
    ]);
    expect(page.fetchMock.mock.calls.every((call) => call[1]?.method !== 'POST')).toBe(true);
  });
  it('ignores unchanged or forged dropdown values without writing cookies or submitting decisions', async () => {
    const page = fixture('overview');
    await settle();
    dispatch(page.fields.get('admin-language')!, 'change');
    page.fields.get('admin-language')!.value = 'unexpected';
    dispatch(page.fields.get('admin-language')!, 'change');
    expect(page.fields.get('admin-language')!.value).toBe('zh_TW');
    expect(page.cookieWrites).toEqual([]);
    expect(page.location.assign).not.toHaveBeenCalled();
  });
  it('confirms English review language changes without auto-submitting selections or rejection reasons', async () => {
    const page = fixture('review', '?lang=en', undefined, 'en');
    await settle();
    expect(page.fields.get('status')!.textContent).toContain('Pending: 1');
    expect(page.fields.get('applications')!.textContent).toContain('Region A');
    page.fields.get('select-all')!.checked = true;
    dispatch(page.fields.get('select-all')!, 'change');
    const reject = descendants(page.fields.get('applications')!).find(
      (node) => node.tag === 'button' && node.textContent === 'Reject'
    )!;
    await dispatch(reject, 'click');
    expect(page.fields.get('status')!.textContent).toBe('Enter a rejection reason.');
    const reason = descendants(page.fields.get('applications')!).find(
      (node) => node.tag === 'input' && node.attributes['aria-label'] === 'Rejection reason'
    )!;
    reason.value = '未送出的理由';
    page.fields.get('admin-language')!.value = 'zh_TW';
    dispatch(page.fields.get('admin-language')!, 'change');
    expect(page.confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('No review decisions will be submitted')
    );
    expect(page.cookieJar.get(adminLocaleCookie)).toBe('zh_TW');
    expect(page.fetchMock.mock.calls.every((call) => call[1]?.method !== 'POST')).toBe(true);
  });
  it('lets administrators cancel a language switch without losing review selections', async () => {
    const page = fixture('review', '?lang=en', undefined, 'en', false);
    await settle();
    page.fields.get('select-all')!.checked = true;
    dispatch(page.fields.get('select-all')!, 'change');
    page.fields.get('admin-language')!.value = 'zh_TW';
    dispatch(page.fields.get('admin-language')!, 'change');
    expect(page.fields.get('admin-language')!.value).toBe('en');
    expect(page.fields.get('approve-selected')!.textContent).toBe('Approve selected (1)');
    expect(page.location.assign).not.toHaveBeenCalled();
    expect(page.cookieWrites).toEqual([]);
  });
  it('translates batch confirmations/results while leaving rejection text and decision codes unchanged', async () => {
    const page = fixture(
      'review',
      '?lang=en',
      async (input) => {
        const url = requestUrl(input);
        if (url.endsWith('/batch-approve'))
          return Response.json({ results: [{ id: personId, status: 'approved' }] });
        if (url.endsWith('/decision')) return Response.json({ personId });
        return mockResponse(url);
      },
      'en'
    );
    await settle();
    page.fields.get('select-all')!.checked = true;
    dispatch(page.fields.get('select-all')!, 'change');
    await dispatch(page.fields.get('approve-selected')!, 'click');
    expect(page.confirmMock).toHaveBeenCalledWith(
      expect.stringContaining('Approve these 1 applications')
    );
    expect(page.fields.get('status')!.textContent).toContain('Approved 1; failed 0');
    const reason = descendants(page.fields.get('applications')!).find(
      (node) => node.tag === 'input' && node.attributes['aria-label'] === 'Rejection reason'
    )!;
    reason.value = '管理員原文 <script> {name}';
    const reject = descendants(page.fields.get('applications')!).find(
      (node) => node.tag === 'button' && node.textContent === 'Reject'
    )!;
    await dispatch(reject, 'click');
    const request = page.fetchMock.mock.calls.find((call) =>
      requestUrl(call[0]).endsWith('/decision')
    );
    const body = request?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected JSON body');
    expect(JSON.parse(body)).toEqual({
      decision: 'rejected',
      reason: '管理員原文 <script> {name}'
    });
  });

  it('renders an accessible responsive overview, zero-date chart and both paginated rosters safely', async () => {
    const page = fixture('overview', '?period=month');
    await settle();
    expect(page.fields.get('status')!.textContent).toContain('已載入');
    expect(page.fields.get('report')!.textContent).toContain('打卡人日');
    expect(page.fields.get('report')!.textContent).toContain(unsafeName);
    expect(page.tags).not.toContain('img');
    expect(page.tags).toContain('svg');
    expect(page.tags).toContain('rect');
    expect(page.html).toContain('@media(max-width:760px)');
    expect(page.html).toContain('aria-current="page"');
    expect(page.html).toContain('/admin/applications');
    expect(page.html).not.toContain('cdn.jsdelivr');
    const calls = page.fetchMock.mock.calls.map(
      (call) => new URL(requestUrl(call[0]), 'https://checkin.baiyinqigong.org')
    );
    expect(calls.map((call) => call.pathname)).toEqual([
      '/admin/api/reports/overview',
      '/admin/api/reports/status',
      '/admin/api/reports/status'
    ]);
    expect(calls.every((call) => call.searchParams.get('period') === 'month')).toBe(true);
    expect(calls.slice(1).map((call) => call.searchParams.get('state'))).toEqual([
      'checked',
      'pending'
    ]);
    const next = descendants(page.fields.get('report')!).find(
      (el) => el.tag === 'button' && el.textContent === '下一頁'
    )!;
    dispatch(next, 'click');
    await settle();
    expect(
      page.fetchMock.mock.calls
        .map((call) => requestUrl(call[0]))
        .some((url) => url.includes('state=checked&page=2'))
    ).toBe(true);
  });
  it('ports leaderboard tables with independent period and lifetime statistics', async () => {
    const page = fixture('leaderboard');
    await settle();
    const text = page.fields.get('report')!.textContent;
    expect(text).toContain('期間最長連續排名');
    expect(text).toContain('累計打卡名單');
    expect(text).toContain('目前連續');
    page.fields.get('period')!.value = 'year';
    page.fields.get('platform')!.value = 'whatsapp';
    page.fields.get('top')!.value = '30';
    dispatch(page.fields.get('filters')!, 'submit');
    await settle();
    const last = new URL(
      requestUrl(page.fetchMock.mock.calls.at(-1)![0]),
      'https://checkin.baiyinqigong.org'
    );
    expect(last.searchParams.get('platform')).toBe('whatsapp');
    expect(last.searchParams.get('period')).toBe('year');
    expect(last.searchParams.get('top')).toBe('30');
  });
  it('shows 30/90-day individual analysis and history, uses personal-day percentages and safe deep links', async () => {
    const page = fixture('methods', '?personId=' + personId);
    await settle();
    const root = page.fields.get('report')!;
    expect(root.textContent).toContain('近 30 日');
    expect(root.textContent).toContain('近 90 日');
    expect(root.textContent).toContain('補登');
    expect(root.textContent).toContain('100.0%');
    expect(descendants(root).some((el) => el.style.width === '100%')).toBe(true);
    expect(page.tags).not.toContain('img');
    const choice = descendants(root).find(
      (el) => el.tag === 'button' && el.textContent === unsafeName
    )!;
    dispatch(choice, 'click');
    await settle();
    expect(page.history.replaceState).toHaveBeenCalled();
    expect(new URL(page.location.href).searchParams.get('personId')).toBe(personId);
    const next = descendants(page.fields.get('report')!)
      .filter((el) => el.tag === 'button' && el.textContent === '下一頁')
      .at(-1)!;
    dispatch(next, 'click');
    await settle();
    expect(requestUrl(page.fetchMock.mock.calls.at(-1)![0])).toContain('page=2');
  });
  it('retains the scoped review UI and uses same-origin CSRF logout without duplicate handlers', async () => {
    const page = fixture('review');
    await settle();
    expect(page.fields.get('applications')!.textContent).toContain(unsafeName);
    expect(page.fields.get('status')!.textContent).toContain('待審核：1');
    expect(page.tags).not.toContain('img');
    await dispatch(page.fields.get('logout')!, 'click');
    expect(page.fetchMock.mock.calls.at(-1)![1]).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-csrf-token': 'mock-csrf' }
    });
    expect(page.location.assign).toHaveBeenCalledWith('/admin/auth/login');
    expect(
      page.fetchMock.mock.calls.filter((call) => call[0] === '/admin/auth/logout')
    ).toHaveLength(1);
  });
  it.each([401, 403, 404, 503])(
    'handles HTTP %s without displaying stale report data',
    async (status) => {
      const page = fixture('overview', '', async () =>
        Response.json({ error: 'failure' }, { status })
      );
      await settle();
      expect(page.fields.get('status')!.dataset.error).toBe('true');
      expect(page.fields.get('report')!.children).toHaveLength(0);
      if (status === 401) expect(page.location.assign).toHaveBeenCalledWith('/admin/auth/login');
    }
  );
  it('discards out-of-order responses after a new filter request', async () => {
    let finish: ((value: Response) => void) | undefined;
    let first = true;
    const page = fixture('overview', '', async (input) => {
      if (first) {
        first = false;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return mockResponse(requestUrl(input));
    });
    page.fields.get('period')!.value = 'year';
    dispatch(page.fields.get('filters')!, 'submit');
    await settle();
    expect(page.fields.get('status')!.textContent).toContain('已載入');
    finish!(Response.json({ ...overview, kpis: { ...overview.kpis, total_checkins: 999 } }));
    await settle();
    expect(page.fields.get('report')!.textContent).not.toContain('999');
  });
});
