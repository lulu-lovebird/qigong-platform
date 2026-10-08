import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  renderTelegramWorkspacePage,
  type TelegramWorkspacePage
} from '../src/telegram-workspace-pages.js';
import { telegramWorkspaceTexts } from '../src/telegram-workspace-locale.js';

type Event = { preventDefault: () => void; returnValue?: string };
type Handler = (event?: Event) => void | Promise<void>;
interface Element {
  tagName: string;
  children: Element[];
  dataset: Record<string, string>;
  attributes: Map<string, string>;
  textContent: string;
  value: string;
  hidden: boolean;
  disabled: boolean;
  checked: boolean;
  indeterminate: boolean;
  className: string;
  type: string;
  style: Record<string, string>;
  onclick?: Handler;
  onchange?: Handler;
  oninput?: (event?: Event) => void;
  append: (...elements: Element[]) => void;
  prepend: (...elements: Element[]) => void;
  replaceChildren: (...elements: Element[]) => void;
  setAttribute: (key: string, value: string) => void;
  getAttribute: (key: string) => string | null;
  querySelectorAll: (selector: string) => Element[];
  focus: ReturnType<typeof vi.fn>;
}
const jsonBody = (body: unknown): Record<string, unknown> => {
  if (typeof body !== 'string') throw new Error('Expected JSON request');
  return JSON.parse(body) as Record<string, unknown>;
};
const matches = (element: Element, selector: string) => {
  if (selector === 'input') return element.tagName === 'input';
  if (selector.includes('data-method'))
    return 'method' in element.dataset && (!selector.includes(':checked') || element.checked);
  if (selector.includes('data-group')) return 'group' in element.dataset;
  if (selector.includes('data-feeling'))
    return (
      'feeling' in element.dataset &&
      (!selector.includes('aria-pressed') || element.getAttribute('aria-pressed') === 'true')
    );
  return false;
};
const element = (tagName = 'div'): Element => {
  const item: Element = {
    tagName,
    children: [],
    dataset: {},
    attributes: new Map(),
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    checked: false,
    indeterminate: false,
    className: '',
    type: '',
    style: {},
    append: (...children) => {
      item.children.push(...children);
    },
    prepend: (...children) => {
      item.children.unshift(...children);
    },
    replaceChildren: (...children) => {
      item.children = children;
    },
    setAttribute: (key, value) => {
      item.attributes.set(key, value);
    },
    getAttribute: (key) => item.attributes.get(key) ?? null,
    querySelectorAll: (selector) =>
      item.children.flatMap((child) => [
        ...(matches(child, selector) ? [child] : []),
        ...child.querySelectorAll(selector)
      ]),
    focus: vi.fn()
  };
  Object.defineProperty(item, 'innerHTML', {
    set() {
      throw new Error('Unsafe HTML write');
    }
  });
  return item;
};
interface Entry {
  id: string;
  date: string;
  version: number;
  kind: string;
  timezone: string;
  practiceNote: string;
  methods: { code: string; name: string; group: string }[];
  feelingTags: { id: string; name: string }[];
}
const entry = (date: string, note = ''): Entry => ({
  id: randomUUID(),
  date,
  version: 3,
  kind: 'regular',
  timezone: 'UTC',
  practiceNote: note,
  methods: [{ code: 'dayan_chu', name: 'Dayan 1', group: 'Dayan' }],
  feelingTags: []
});
const fixture = (
  page: TelegramWorkspacePage = 'checkin',
  options: { entries?: Entry[]; confirmed?: boolean; hash?: string; locale?: 'en' | 'zh_TW' } = {}
) => {
  const nodes = new Map<string, Element>();
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id)!;
  };
  get('period').value = 'month';
  get('days').value = '30';
  get('language').value = options.locale ?? 'en';
  get('monthly').hidden = true;
  const links = (['checkin', 'leaderboard', 'methods', 'achievements'] as const).map((view) => {
    const link = element('a');
    link.dataset.page = view;
    return link;
  });
  get('nav').append(...links);
  const all = (selector: string) =>
    selector === 'nav a'
      ? links
      : Array.from(nodes.values()).flatMap((root) => [
          ...(matches(root, selector) ? [root] : []),
          ...root.querySelectorAll(selector)
        ]);
  const profile = {
    today: '2026-10-09',
    timezone: 'UTC',
    makeupOpen: true,
    confirmed: options.confirmed ?? true,
    totalDays: 1,
    currentStreak: 1,
    longestStreak: 1,
    entries: options.entries ?? [],
    feelingTags: [{ id: '00000000-0000-4000-8000-000000000001', name: '<script>Relaxed</script>' }],
    methods: [
      { code: 'dayan_chu', name: 'Dayan 1', groupCode: 'dayan', group: 'Dayan' },
      { code: 'dayan_gao', name: 'Dayan 2', groupCode: 'dayan', group: 'Dayan' }
    ]
  };
  const location = {
    hash: options.hash ?? '#' + 'a'.repeat(43),
    pathname: '/telegram/checkin',
    search: '?lang=en',
    href: ''
  };
  const history = { replaceState: vi.fn() },
    confirm = vi.fn(() => true),
    listeners = new Map<string, Handler>();
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = jsonBody(init?.body);
    let data: unknown = { ok: true };
    if (path.endsWith('/profile')) data = profile;
    else if (path.endsWith('/save'))
      data = { checkinId: randomUUID(), version: 4, action: 'regular', receiptQueued: true };
    else if (body.view === 'methods')
      data = {
        days: 30,
        start: '2026-09-10',
        end: profile.today,
        mix: [{ code: 'dayan', name: 'Dayan', days: 3 }],
        entries: profile.entries
      };
    else if (body.view === 'leaderboard')
      data = {
        start: '2026-10-01',
        end: profile.today,
        ownRank: 1,
        ownDays: 3,
        rows: [{ rank: 1, days: 3, label: 'You', self: true }]
      };
    else if (body.view === 'history') data = { month: body.month, entries: profile.entries };
    else if (body.view === 'achievements')
      data = {
        ...profile,
        badges: [
          {
            code: 'seasonal_winter',
            kind: 'winter',
            name: 'Winter',
            configured: false,
            threshold: 27,
            awards: []
          }
        ]
      };
    return new Response(JSON.stringify(data), { status: 200 });
  });
  const html = renderTelegramWorkspacePage(page, options.locale ?? 'en');
  const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .join('\n');
  new Script(source).runInNewContext({
    document: { getElementById: get, createElement: element, querySelectorAll: all },
    location,
    history,
    window: {
      confirm,
      addEventListener: (name: string, handler: Handler) => {
        listeners.set(name, handler);
      }
    },
    fetch: fetchMock,
    crypto: { randomUUID },
    AbortSignal,
    URLSearchParams,
    Intl: { supportedValuesOf: () => ['UTC'] }
  });
  const texts = (root: Element): string => root.textContent + root.children.map(texts).join(' ');
  return {
    get,
    all,
    links,
    profile,
    location,
    history,
    confirm,
    fetchMock,
    listeners,
    html,
    texts
  };
};
const click = (item: Element) => item.onclick?.({ preventDefault: vi.fn() });
const tick = async () => {
  await setImmediate();
  await setImmediate();
};

describe('Telegram workspace generated scripts and unsaved private drafts', () => {
  it.each(['checkin', 'leaderboard', 'methods', 'achievements'] as const)(
    'renders a bilingual, syntax-valid %s page with safe dynamic DOM writes',
    async (page) => {
      for (const locale of ['zh_TW', 'en'] as const) {
        const f = fixture(page, { locale });
        await tick();
        expect(f.fetchMock).toHaveBeenCalled();
        expect(f.html).toContain('Bean, Bird &amp; Badminton Tech Consulting');
        expect(f.history.replaceState).toHaveBeenCalledWith(null, '', '/telegram/checkin?lang=en');
        expect(f.html).not.toContain('innerHTML');
      }
    }
  );
  it.each(['?', '&'])(
    'accepts Telegram service parameters appended with %s without forwarding init data',
    async (separator) => {
      const f = fixture('checkin', {
        hash:
          '#' +
          'a'.repeat(43) +
          separator +
          'tgWebAppData=private-telegram-init&tgWebAppVersion=8.0'
      });
      await tick();
      expect(f.fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(f.fetchMock.mock.calls)).not.toContain('private-telegram-init');
      expect(f.history.replaceState.mock.calls[0]?.[2]).toContain('tgWebAppData=');
      expect(f.history.replaceState.mock.calls[0]?.[2]).not.toContain('a'.repeat(43));
    }
  );
  it('does not double-prompt browser navigation after accepting a discard warning', async () => {
    const f = fixture();
    await tick();
    f.get('note').value = 'Unsaved';
    f.get('note').oninput?.();
    await click(f.links[1]!);
    const preventDefault = vi.fn();
    await f.listeners.get('beforeunload')?.({ preventDefault });
    expect(f.confirm).toHaveBeenCalledTimes(1);
    expect(preventDefault).not.toHaveBeenCalled();
  });
  it('uses a complete matching bilingual dictionary', () => {
    expect(Object.keys(telegramWorkspaceTexts('en')).sort()).toEqual(
      Object.keys(telegramWorkspaceTexts('zh_TW')).sort()
    );
  });
  it('rejects invalid fragments without making an API call', async () => {
    const f = fixture('checkin', { hash: '#invalid' });
    await tick();
    expect(f.fetchMock).not.toHaveBeenCalled();
    expect(f.get('status').textContent).toContain('expired');
  });
  it('requires timezone confirmation before enabling the editor', async () => {
    const f = fixture('checkin', { confirmed: false });
    await tick();
    expect(f.get('editor').disabled).toBe(true);
    expect(f.get('zoneCard').hidden).toBe(false);
    expect(f.get('status').textContent).toContain('Confirm');
  });
  it('guards unsaved time zone choices but does not ask to discard the choice being saved', async () => {
    const f = fixture();
    await tick();
    f.get('zone').value = 'Etc/UTC';
    f.confirm.mockReturnValue(false);
    await click(f.links[1]!);
    expect(f.location.href).toBe('');
    expect(f.get('zone').value).toBe('Etc/UTC');
    expect(f.confirm).toHaveBeenCalledTimes(1);
    f.confirm.mockClear();
    await click(f.get('confirmZone'));
    expect(f.confirm).not.toHaveBeenCalled();
  });
  it('retains the correct month navigation limits after reloading history', async () => {
    const f = fixture('achievements');
    await tick();
    await click(f.get('historyTab'));
    await tick();
    await click(f.get('reload'));
    await tick();
    expect(f.get('next').disabled).toBe(true);
  });
  it('ignores stale failed report requests after a newer period loads', async () => {
    const f = fixture('leaderboard');
    await tick();
    let rejectOld: ((error: Error) => void) | undefined;
    f.fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectOld = reject;
        })
    );
    f.get('period').value = 'week';
    void f.get('period').onchange?.();
    await tick();
    f.get('period').value = 'year';
    void f.get('period').onchange?.();
    await tick();
    rejectOld?.(new Error('Stale failure'));
    await tick();
    expect(f.get('status').textContent).toBe('');
    expect(f.get('ownRank').textContent).toContain('1');
  });
  it('does not warn when navigating or changing language without edits', async () => {
    const f = fixture();
    await tick();
    await click(f.links[1]!);
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.location.href).toContain('/telegram/leaderboard?lang=en#');
    f.get('language').value = 'zh_TW';
    await f.get('language').onchange?.();
    expect(f.confirm).not.toHaveBeenCalled();
    expect(f.location.href).toContain('/telegram/checkin?lang=zh_TW#');
  });
  it('retains notes, selections and locale after cancelled navigation and language changes', async () => {
    const f = fixture();
    await tick();
    f.all('[data-method]')[0]!.checked = true;
    f.get('note').value = '私密草稿';
    f.get('note').oninput?.();
    f.confirm.mockReturnValue(false);
    await click(f.links[1]!);
    expect(f.location.href).toBe('');
    f.get('language').value = 'zh_TW';
    await f.get('language').onchange?.();
    expect(f.get('language').value).toBe('en');
    expect(f.get('note').value).toBe('私密草稿');
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
  });
  it('suppresses discard warnings when the draft is restored to its baseline', async () => {
    const f = fixture('checkin', { entries: [entry('2026-10-09', 'Original')] });
    await tick();
    f.get('note').value = 'Changed';
    f.get('note').oninput?.();
    f.get('note').value = 'Original';
    f.get('note').oninput?.();
    await click(f.links[2]!);
    expect(f.confirm).not.toHaveBeenCalled();
  });
  it('preserves separate date drafts and updates group selection state', async () => {
    const f = fixture();
    await tick();
    f.get('note').value = 'Today draft';
    f.get('note').oninput?.();
    f.all('[data-group]')[0]!.checked = true;
    await f.all('[data-group]')[0]!.onchange?.();
    expect(f.all('[data-method]').every((input) => input.checked)).toBe(true);
    await click(f.get('yesterdayTab'));
    f.get('note').value = 'Yesterday draft';
    f.get('note').oninput?.();
    await click(f.get('todayTab'));
    expect(f.get('note').value).toBe('Today draft');
    expect(f.all('[data-method]').every((input) => input.checked)).toBe(true);
  });
  it('renders a standalone method once without a redundant group selector', async () => {
    const f = fixture();
    await tick();
    f.profile.methods.push({
      code: 'huanghai',
      name: 'Swaying Sea',
      groupCode: 'huanghai',
      group: 'Swaying Sea'
    });
    await click(f.get('reload'));
    await tick();
    expect(f.all('[data-method]')).toHaveLength(3);
    expect(f.all('[data-group]')).toHaveLength(1);
    expect(f.texts(f.get('methodsList')).match(/Swaying Sea/g)).toHaveLength(1);
  });
  it('renders tag labels as text and keeps them separate from free text', async () => {
    const f = fixture();
    await tick();
    f.get('note').value = 'Handwritten';
    f.get('note').oninput?.();
    const tag = f.all('[data-feeling]')[0]!;
    await click(tag);
    expect(tag.textContent).toBe('<script>Relaxed</script>');
    expect(f.get('note').value).toBe('Handwritten');
    expect(tag.getAttribute('aria-pressed')).toBe('true');
  });
  it('rejects NUL and overlong notes while allowing 1000 Unicode emoji', async () => {
    const f = fixture();
    await tick();
    f.all('[data-method]')[0]!.checked = true;
    for (const note of ['x\0', '🙂'.repeat(1001)]) {
      f.get('note').value = note;
      f.get('note').oninput?.();
      await click(f.get('submit'));
      expect(f.get('status').textContent).toContain('1000');
    }
    expect(f.fetchMock).toHaveBeenCalledTimes(1);
    f.get('note').value = '🙂'.repeat(1000);
    f.get('note').oninput?.();
    await click(f.get('submit'));
    expect(f.fetchMock).toHaveBeenCalledTimes(3);
  });
  it('retains edits and request identity across 400/403/409/503 failed saves', async () => {
    for (const status of [400, 403, 409, 503]) {
      const f = fixture();
      await tick();
      f.all('[data-method]')[0]!.checked = true;
      f.get('note').value = 'Keep me';
      f.get('note').oninput?.();
      f.fetchMock.mockResolvedValueOnce(new Response('{"error":"workspace_conflict"}', { status }));
      await click(f.get('submit'));
      expect(f.get('note').value).toBe('Keep me');
      expect(f.all('[data-method]')[0]!.checked).toBe(true);
      const first = jsonBody(f.fetchMock.mock.calls[1]![1]?.body);
      f.fetchMock.mockResolvedValueOnce(new Response('{"error":"workspace_conflict"}', { status }));
      await click(f.get('submit'));
      const second = jsonBody(f.fetchMock.mock.calls[2]![1]?.body);
      expect(second.requestId).toBe(first.requestId);
    }
  });
  it('guards duplicate submission and navigation while a write is in flight', async () => {
    const f = fixture();
    await tick();
    f.all('[data-method]')[0]!.checked = true;
    let finish: ((value: Response) => void) | undefined;
    f.fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    );
    const saving = click(f.get('submit'));
    await tick();
    await click(f.get('submit'));
    await click(f.links[1]!);
    expect(f.fetchMock).toHaveBeenCalledTimes(2);
    expect(f.location.href).toBe('');
    expect(f.get('editor').disabled).toBe(true);
    finish?.(new Response(JSON.stringify({ version: 4, receiptQueued: true })));
    await saving;
    expect(f.get('editor').disabled).toBe(false);
  });
  it('keeps a different date draft after saving the current date', async () => {
    const f = fixture();
    await tick();
    await click(f.get('yesterdayTab'));
    f.get('note').value = 'Unsaved yesterday';
    f.get('note').oninput?.();
    await click(f.get('todayTab'));
    f.all('[data-method]')[0]!.checked = true;
    f.profile.entries.push(entry('2026-10-09', 'Saved today'));
    await click(f.get('submit'));
    await click(f.get('yesterdayTab'));
    expect(f.get('note').value).toBe('Unsaved yesterday');
    f.confirm.mockReturnValue(false);
    await click(f.links[3]!);
    expect(f.confirm).toHaveBeenCalled();
  });
  it('does not resubmit a committed write after refresh fails', async () => {
    const f = fixture();
    await tick();
    f.all('[data-method]')[0]!.checked = true;
    f.fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ version: 4, receiptQueued: true }))
    );
    f.fetchMock.mockRejectedValueOnce(new Error('Refresh failed'));
    await click(f.get('submit'));
    expect(f.get('status').textContent).toContain('Saved and queued');
    expect(f.get('submit').disabled).toBe(true);
    await click(f.get('submit'));
    expect(f.fetchMock).toHaveBeenCalledTimes(3);
  });
  it('shows own monthly private history and unconfigured seasonal badges honestly', async () => {
    const f = fixture('achievements', {
      entries: [entry('2026-10-09', '<img src=x onerror=alert(1)>')]
    });
    await tick();
    expect(f.texts(f.get('badges'))).toContain('Not open');
    await click(f.get('historyTab'));
    await tick();
    expect(f.get('monthly').hidden).toBe(false);
    expect(f.texts(f.get('historyEntries'))).toContain('<img src=x onerror=alert(1)>');
  });
  it('ignores stale leaderboard responses when switching period quickly', async () => {
    const f = fixture('leaderboard');
    await tick();
    let resolveOld: ((value: Response) => void) | undefined;
    f.fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveOld = resolve;
        })
    );
    f.get('period').value = 'week';
    void f.get('period').onchange?.();
    await tick();
    f.get('period').value = 'year';
    void f.get('period').onchange?.();
    await tick();
    resolveOld?.(
      new Response(
        JSON.stringify({
          start: '2000-01-01',
          end: '2000-01-02',
          ownRank: 99,
          ownDays: 0,
          rows: []
        })
      )
    );
    await tick();
    expect(f.get('ownRank').textContent).not.toContain('99');
    expect(f.get('range').textContent).toContain('2026');
  });
});
