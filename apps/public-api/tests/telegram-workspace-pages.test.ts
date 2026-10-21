import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  renderTelegramWorkspacePage,
  type TelegramWorkspacePage
} from '../src/telegram-workspace-pages.js';
import { telegramWorkspaceTexts } from '../src/telegram-workspace-locale.js';
import { renderChannelWorkspacePage } from '../src/channel-workspace-pages.js';
import { badgeIcons, fallbackBadgeIcon } from '../src/badge-icons.js';

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
interface Badge {
  code: string;
  name: string;
  kind: string;
  configured: boolean;
  threshold: number;
  awards: ReadonlyArray<{ period: string; earnedAt: string; revoked: boolean }>;
}
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
const workspaceRequestPath = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
const fixture = (
  page: TelegramWorkspacePage = 'checkin',
  options: {
    entries?: Entry[];
    confirmed?: boolean;
    savedSharing?: 'automatic' | 'legacy_private' | 'manual';
    hash?: string;
    locale?: 'en' | 'zh_TW' | 'zh_CN';
    channel?: 'line' | 'whatsapp';
    badges?: ReadonlyArray<Badge>;
    lineNative?: boolean;
    lineInit?: () => Promise<void>;
    lineSearch?: string;
    lineCloseAvailable?: boolean;
    lineCloseThrows?: boolean;
    native?: boolean;
    clock?: { value: number };
  } = {}
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
  get('wa-completion').hidden = true;
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
    search: options.lineSearch ?? '?lang=en',
    href: ''
  };
  let timerId = 0;
  const completionTimers = new Map<number, { callback: () => void; delay: number }>();
  const browserClose = vi.fn();
  const history = { replaceState: vi.fn() },
    confirm = vi.fn(() => true),
    listeners = new Map<string, Handler>();
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = init?.body === undefined ? {} : jsonBody(init.body);
    let data: unknown = { ok: true };
    if (path === '/whatsapp/auth/session') data = { authenticated: true };
    else if (path.endsWith('/session'))
      data = { status: 'ready', token: 'a'.repeat(43), expiresIn: 840 };
    else if (path.endsWith('/profile')) data = profile;
    else if (path.endsWith('/save'))
      data = {
        checkinId: randomUUID(),
        version: 4,
        action: body.version ? 'corrected' : body.date === profile.today ? 'regular' : 'makeup',
        receiptQueued: options.channel !== 'whatsapp',
        ...(options.savedSharing ? { communitySharing: options.savedSharing } : {})
      };
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
        badges: options.badges ?? [
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
  const html =
    options.channel === 'line'
      ? renderChannelWorkspacePage(
          { platform: 'line', liffId: '123456-test' },
          page,
          options.locale ?? 'zh_TW'
        )
      : options.channel === 'whatsapp'
        ? renderChannelWorkspacePage({ platform: 'whatsapp' }, page, options.locale ?? 'en')
        : renderTelegramWorkspacePage(page, options.locale ?? 'en');
  const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .join('\n');
  const app = {
    initData: 'signed-native-proof',
    platform: 'android',
    ready: vi.fn(),
    expand: vi.fn(),
    close: vi.fn(),
    enableClosingConfirmation: vi.fn(),
    disableClosingConfirmation: vi.fn()
  };
  const lineClose = vi.fn(() => {
    if (options.lineCloseThrows) throw Error('LIFF bridge unavailable');
  });
  const lineSdk = {
    init: options.lineInit ?? (async () => {}),
    isLoggedIn: () => true,
    isInClient: () => options.lineNative === true,
    closeWindow: options.lineCloseAvailable === false ? undefined : lineClose,
    getIDToken: () => 'verified-line-token',
    login: vi.fn()
  };
  new Script(source).runInNewContext({
    document: {
      getElementById: get,
      createElement: element,
      querySelectorAll: all,
      cookie: '__Host-qigong-whatsapp-csrf=' + 'c'.repeat(43)
    },
    location,
    history,
    setTimeout: (callback: () => void, delay: number) => {
      completionTimers.set(++timerId, { callback, delay });
      return timerId;
    },
    clearTimeout: (id: number) => {
      completionTimers.delete(id);
    },
    window: {
      closed: false,
      close: browserClose,
      Telegram: options.native ? { WebApp: app } : undefined,
      confirm,
      addEventListener: (name: string, handler: Handler) => {
        listeners.set(name, handler);
      }
    },
    liff: lineSdk,
    fetch: fetchMock,
    Date: new Proxy(Date, {
      get: (target, key) =>
        key === 'now' ? () => options.clock?.value ?? Date.now() : Reflect.get(target, key)
    }),
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
    app,
    lineClose,
    texts,
    browserClose,
    completionTimers
  };
};
const click = (item: Element) => item.onclick?.({ preventDefault: vi.fn() });
const tick = async () => {
  await setImmediate();
  await setImmediate();
};

describe('Telegram workspace generated scripts and unsaved private drafts', () => {
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'shows the %s WhatsApp receipt only after save, without leaking reflections or saving twice',
    async (locale) => {
      const f = fixture('checkin', { channel: 'whatsapp', locale });
      await tick();
      f.all('[data-method]')[0]!.checked = true;
      f.get('note').value = 'PRIVATE COMPLETION NOTE';
      await click(f.get('submit'));
      expect(f.get('wa-completion').hidden).toBe(false);
      expect(f.get('editor').hidden).toBe(true);
      expect(f.texts(f.get('wa-completion-record'))).toContain(f.profile.today);
      expect(f.texts(f.get('wa-completion-record'))).toContain('Dayan 1');
      expect(f.texts(f.get('wa-completion-record'))).not.toContain('PRIVATE COMPLETION NOTE');
      expect(f.texts(f.get('wa-completion-record'))).not.toContain('Relaxed');
      expect(f.browserClose).not.toHaveBeenCalled();
      expect([...f.completionTimers.values()].map((t) => t.delay)).toEqual([3000]);
      await click(f.get('submit'));
      const saves = f.fetchMock.mock.calls.filter(([path]) => path === '/whatsapp/workspace/save');
      expect(saves).toHaveLength(1);
      expect(saves[0]?.[1]?.headers).toMatchObject({ 'x-whatsapp-csrf-token': 'c'.repeat(43) });
      expect(jsonBody(saves[0]?.[1]?.body)).not.toHaveProperty('token');
      for (const timer of [...f.completionTimers.values()]) timer.callback();
      expect(f.browserClose).toHaveBeenCalledTimes(1);
      expect(f.get('wa-completion').hidden).toBe(false);
      expect(
        f.fetchMock.mock.calls.some(
          ([path]) =>
            workspaceRequestPath(path).includes('/logout') ||
            workspaceRequestPath(path).includes('/webhook')
        )
      ).toBe(false);
    }
  );
  it.each(['makeup', 'corrected'] as const)(
    'displays the actual WhatsApp %s operation',
    async (action) => {
      const f = fixture('checkin', {
        channel: 'whatsapp',
        entries: action === 'corrected' ? [entry('2026-10-09')] : []
      });
      await tick();
      if (action === 'makeup') await click(f.get('yesterdayTab'));
      f.all('[data-method]')[0]!.checked = true;
      await click(f.get('submit'));
      expect(f.get('wa-completion').hidden).toBe(false);
      expect(f.texts(f.get('wa-completion-record'))).toContain(
        action === 'makeup' ? 'Makeup check-in' : 'Correction'
      );
      expect(f.texts(f.get('wa-completion-record'))).toContain(
        action === 'makeup' ? '2026-10-08' : '2026-10-09'
      );
    }
  );
  it('does not show a WhatsApp completion while the save response is still pending', async () => {
    const f = fixture('checkin', { channel: 'whatsapp' });
    await tick();
    f.all('[data-method]')[0]!.checked = true;
    const original = f.fetchMock.getMockImplementation();
    if (!original) throw Error('Missing fetch implementation');
    let finish: ((response: Response) => void) | undefined;
    f.fetchMock.mockImplementation((input, init) =>
      workspaceRequestPath(input) === '/whatsapp/workspace/save'
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : original(input, init)
    );
    const pending = click(f.get('submit'));
    await tick();
    expect(f.get('wa-completion').hidden).toBe(true);
    expect(f.completionTimers.size).toBe(0);
    expect(f.browserClose).not.toHaveBeenCalled();
    if (!finish) throw Error('Missing save response callback');
    finish(
      new Response(
        JSON.stringify({
          checkinId: randomUUID(),
          version: 1,
          action: 'regular',
          receiptQueued: false
        })
      )
    );
    await pending;
    expect(f.get('wa-completion').hidden).toBe(false);
  });
  it.each([401, 403, 409, 503, 'network', 'malformed'] as const)(
    'does not complete or close on WhatsApp save result %s',
    async (failure) => {
      const f = fixture('checkin', { channel: 'whatsapp' });
      await tick();
      f.all('[data-method]')[0]!.checked = true;
      f.get('note').value = 'Retained after uncertainty';
      const original = f.fetchMock.getMockImplementation();
      if (!original) throw Error('Missing fetch implementation');
      f.fetchMock.mockImplementation(async (input, init) => {
        if (workspaceRequestPath(input) === '/whatsapp/workspace/save') {
          if (failure === 'network') throw Error('Unknown transport result');
          return failure === 'malformed'
            ? new Response(
                JSON.stringify({
                  checkinId: 'invalid',
                  version: 4,
                  action: 'regular',
                  receiptQueued: false
                })
              )
            : new Response('{}', { status: failure });
        }
        return original(input, init);
      });
      await click(f.get('submit'));
      expect(f.get('wa-completion').hidden).not.toBe(false);
      expect(f.browserClose).not.toHaveBeenCalled();
      expect(f.completionTimers.size).toBe(0);
      expect(f.get('note').value).toBe('Retained after uncertainty');
      expect(f.all('[data-method]')[0]!.checked).toBe(true);
      if (failure === 503 || failure === 'network' || failure === 'malformed') {
        const first = f.fetchMock.mock.calls.find(([path]) => path === '/whatsapp/workspace/save');
        f.fetchMock.mockImplementation(original);
        await click(f.get('submit'));
        const last = f.fetchMock.mock.calls
          .filter(([path]) => path === '/whatsapp/workspace/save')
          .at(-1);
        expect(jsonBody(last?.[1]?.body)).toEqual(jsonBody(first?.[1]?.body));
        expect(f.get('wa-completion').hidden).toBe(false);
      }
    }
  );
  it('keeps the confirmed WhatsApp receipt visible after refresh fails, without another save or automatic closing', async () => {
    const f = fixture('checkin', { channel: 'whatsapp' });
    await tick();
    f.all('[data-method]')[0]!.checked = true;
    const original = f.fetchMock.getMockImplementation();
    if (!original) throw Error('Missing fetch implementation');
    f.fetchMock.mockImplementation((input, init) =>
      workspaceRequestPath(input) === '/whatsapp/workspace/profile'
        ? Promise.resolve(new Response('{}', { status: 503 }))
        : original(input, init)
    );
    await click(f.get('submit'));
    expect(f.get('wa-completion').hidden).toBe(false);
    expect(f.texts(f.get('wa-completion-record'))).toContain('Dayan 1');
    expect(f.get('wa-completion-hint').textContent).toContain('refreshing failed');
    expect(f.completionTimers.size).toBe(0);
    expect(f.browserClose).not.toHaveBeenCalled();
    expect(
      f.fetchMock.mock.calls.filter(([path]) => path === '/whatsapp/workspace/save')
    ).toHaveLength(1);
  });
  it('does not close over another WhatsApp date draft and restores it on return to editing', async () => {
    const f = fixture('checkin', { channel: 'whatsapp' });
    await tick();
    await click(f.get('yesterdayTab'));
    f.all('[data-method]')[0]!.checked = true;
    f.get('note').value = 'OTHER DATE PRIVATE DRAFT';
    await click(f.get('todayTab'));
    f.all('[data-method]')[0]!.checked = true;
    await click(f.get('submit'));
    expect(f.get('wa-completion').hidden).toBe(false);
    expect(f.completionTimers.size).toBe(0);
    await click(f.get('wa-completion-close'));
    expect(f.browserClose).not.toHaveBeenCalled();
    await click(f.get('wa-completion-edit'));
    await click(f.get('yesterdayTab'));
    expect(f.get('note').value).toBe('OTHER DATE PRIVATE DRAFT');
    expect(f.all('[data-method]')[0]!.checked).toBe(true);
  });
  it.each(['line', 'telegram'] as const)(
    'does not add a WhatsApp completion or browser-close call to %s',
    (channel) => {
      const f = fixture('checkin', channel === 'line' ? { channel } : {});
      expect(f.html).not.toContain('wa-completion');
      expect(f.html).not.toContain('window.close(');
    }
  );
  it.each(['telegram', 'line', 'whatsapp'] as const)(
    'renders all language choices in Simplified %s and preserves a cancelled unsent reflection',
    async (channel) => {
      const f = fixture('checkin', {
        locale: 'zh_CN',
        lineSearch: '?lang=zh_CN',
        ...(channel === 'telegram' ? {} : { channel })
      });
      await tick();
      expect(f.html).toContain('<html lang="zh-Hans">');
      for (const code of ['zh_TW', 'zh_CN', 'en']) expect(f.html).toContain('value="' + code + '"');
      expect(f.texts(f.get('stats'))).toContain(telegramWorkspaceTexts('zh_CN').total);
      if (channel !== 'whatsapp') expect(f.html).toContain('打卡心得供所有学员阅读');
      f.get('note').value = '心靜，練功後的私人原文';
      f.get('note').oninput?.();
      f.confirm.mockReturnValueOnce(false);
      const before = f.fetchMock.mock.calls.length;
      f.get('language').value = 'en';
      await f.get('language').onchange?.();
      expect(f.confirm).toHaveBeenCalledOnce();
      expect(f.get('language').value).toBe('zh_CN');
      expect(f.get('note').value).toBe('心靜，練功後的私人原文');
      expect(f.fetchMock).toHaveBeenCalledTimes(before);
      expect(f.location.href).toBe('');
    }
  );
  it.each(['telegram', 'line'] as const)(
    'shows the explicit non-checkbox notice and submits its version for %s',
    async (channel) => {
      const f = fixture('checkin', {
        locale: 'zh_TW',
        ...(channel === 'line' ? { channel: 'line' as const } : {})
      });
      await tick();
      expect(f.html).toContain('id="community-note-disclosure"');
      expect(f.html).toContain('打卡心得供所有學員閱讀');
      expect(f.html).not.toMatch(/type="checkbox"[^>]*(?:share|community)/);
      const method = f.all('[data-method]')[0]!;
      method.checked = true;
      await method.onchange?.();
      f.get('note').value = 'Shared text';
      f.get('note').oninput?.();
      await click(f.get('submit'));
      const call = f.fetchMock.mock.calls.find(
        ([path]) => typeof path === 'string' && path.endsWith('/workspace/save')
      );
      expect(jsonBody(call?.[1]?.body)).toMatchObject({
        communityNotice: 'student-community-notes-v1',
        practiceNote: 'Shared text'
      });
      expect(jsonBody(call?.[1]?.body)).not.toHaveProperty('externalEnabled');
    }
  );
  it.each(['legacy_private', 'manual'] as const)(
    'keeps the native page open and reports preserved %s visibility instead of implying a public save',
    async (savedSharing) => {
      const f = fixture('checkin', { native: true, hash: '', locale: 'zh_TW', savedSharing });
      await tick();
      const method = f.all('[data-method]')[0]!;
      method.checked = true;
      await method.onchange?.();
      f.get('note').value = 'Edited existing note';
      f.get('note').oninput?.();
      await click(f.get('submit'));
      expect(f.app.close).not.toHaveBeenCalled();
      expect(f.get('status').textContent).toContain(
        savedSharing === 'manual' ? '保留原分享設定' : '私人紀錄'
      );
    }
  );
  it('does not change the WhatsApp writing notice or enable its community mode', () => {
    const html = renderChannelWorkspacePage({ platform: 'whatsapp' }, 'checkin', 'zh_TW');
    expect(html).not.toContain('id="community-note-disclosure"');
    expect(html).toContain('workspaceCommunityNotes=false');
  });
  it.each([
    ['line', 'zh_TW'],
    ['telegram', 'zh_TW'],
    ['telegram', 'en'],
    ['whatsapp', 'zh_TW'],
    ['whatsapp', 'en']
  ] as const)(
    'renders all 49 legacy icons independently of award status for %s/%s',
    async (channel, locale) => {
      const badges: Badge[] = Object.keys(badgeIcons).map((code, index) => ({
        code,
        name: 'Badge ' + code,
        kind: 'method',
        threshold: 7,
        configured: index % 4 !== 3,
        awards:
          index % 4 === 0
            ? [
                { period: '2026', earnedAt: '2026-10-01T00:00:00Z', revoked: false },
                { period: '2025', earnedAt: '2025-10-01T00:00:00Z', revoked: true }
              ]
            : index % 4 === 2
              ? [{ period: '2026', earnedAt: '2026-10-01T00:00:00Z', revoked: true }]
              : []
      }));
      const before = structuredClone(badges);
      const f = fixture('achievements', {
        locale,
        badges,
        ...(channel === 'telegram' ? {} : { channel })
      });
      await tick();
      const cards = f.get('badges').children;
      expect(cards).toHaveLength(49);
      for (const [index, card] of cards.entries()) {
        const badge = badges[index]!,
          earned = badge.awards.some((a) => !a.revoked),
          heading = card.children[0]!,
          icon = heading.children[0]!;
        expect(card.dataset.badgeCode).toBe(badge.code);
        expect(icon.textContent).toBe(badgeIcons[badge.code]);
        expect(icon.className).toBe('badge-icon');
        expect(icon.getAttribute('aria-hidden')).toBe('true');
        expect(card.children[1]!.textContent).toBe(badge.name);
        expect(card.className.includes(' earned')).toBe(earned);
        expect(heading.children.slice(1).map((n) => n.textContent)).toEqual(earned ? [] : ['🔒']);
        if (!badge.configured)
          expect(f.texts(card)).toContain(telegramWorkspaceTexts(locale).unavailable);
        if (badge.awards.some((a) => a.revoked))
          expect(f.texts(card)).toContain(telegramWorkspaceTexts(locale).revoked);
      }
      expect(badges).toEqual(before);
      expect(
        f.fetchMock.mock.calls.some(
          ([path]) => typeof path === 'string' && /save|publish|submit/.test(path)
        )
      ).toBe(false);
      expect(f.html).toContain('.badge:not(.earned) .badge-icon{filter:grayscale(1);opacity:.45}');
    }
  );
  it('uses a neutral icon for unknown/prototype-named codes and keeps badge names as literal text', async () => {
    const f = fixture('achievements', {
      badges: ['constructor', '__proto__', 'future_badge'].map((code) => ({
        code,
        name: '<img src=x onerror=alert(1)>',
        kind: 'total',
        threshold: 10,
        configured: true,
        awards: []
      }))
    });
    await tick();
    expect(f.get('badges').children).toHaveLength(3);
    for (const card of f.get('badges').children) {
      expect(card.children[0]!.children[0]!.textContent).toBe(fallbackBadgeIcon);
      expect(card.children[1]!.textContent).toBe('<img src=x onerror=alert(1)>');
      expect(f.texts(card)).not.toContain('[object Object]');
    }
  });
  it('exchanges a native launch without a private link and preserves signed SDK parameters', async () => {
    const f = fixture('checkin', {
      native: true,
      hash: '#tgWebAppData=signed%3Dpayload&tgWebAppVersion=8.0'
    });
    await tick();
    expect(f.history.replaceState.mock.calls[0]?.[2]).toContain('tgWebAppData=signed%3Dpayload');
    expect(f.fetchMock.mock.calls[0]?.[0]).toBe('/telegram/workspace/session');
    expect(jsonBody(f.fetchMock.mock.calls[0]?.[1]?.body)).toMatchObject({
      initData: 'signed-native-proof'
    });
    expect(f.get('editor').disabled).toBe(false);
  });
  it('renews short native sessions automatically without changing the permanent entry URL', async () => {
    const clock = { value: Date.now() },
      f = fixture('checkin', { native: true, hash: '', clock });
    await tick();
    expect(
      f.fetchMock.mock.calls.filter(([path]) => path === '/telegram/workspace/session')
    ).toHaveLength(1);
    clock.value += 841000;
    await f.get('reload').onclick?.();
    await tick();
    expect(
      f.fetchMock.mock.calls.filter(([path]) => path === '/telegram/workspace/session')
    ).toHaveLength(2);
    expect(f.location.href).toBe('');
  });
  it('closes only after committed native save and leaves other actual drafts open', async () => {
    const f = fixture('checkin', { native: true, hash: '' });
    await tick();
    const method = f.all('[data-method]')[0]!;
    method.checked = true;
    await method.onchange?.();
    await f.get('submit').onclick?.();
    expect(f.app.close).toHaveBeenCalledTimes(1);
    expect(f.app.disableClosingConfirmation).toHaveBeenCalled();
    const other = fixture('checkin', { native: true, hash: '' });
    await tick();
    other.get('note').value = 'Today draft';
    other.get('note').oninput?.();
    await other.get('yesterdayTab').onclick?.();
    other.all('[data-method]')[0]!.checked = true;
    await other.all('[data-method]')[0]!.onchange?.();
    await other.get('submit').onclick?.();
    expect(other.app.close).not.toHaveBeenCalled();
  });
  it('does not close on failed native saves or force-close ordinary browsers', async () => {
    const f = fixture('checkin', { native: true, hash: '' });
    await tick();
    f.all('[data-method]')[0]!.checked = true;
    await f.all('[data-method]')[0]!.onchange?.();
    f.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 409 }));
    await f.get('submit').onclick?.();
    expect(f.app.close).not.toHaveBeenCalled();
  });
  it('runs the LINE-derived editor only after LIFF identity is available and sends no browser user ID', async () => {
    const f = fixture('checkin', { channel: 'line' });
    await tick();
    expect(f.fetchMock).toHaveBeenCalled();
    const first = jsonBody(f.fetchMock.mock.calls[0]?.[1]?.body);
    expect(first.idToken).toBe('verified-line-token');
    expect(first.token).toBeUndefined();
    expect(first.userId).toBeUndefined();
    expect(first.locale).toBe('zh_TW');
  });
  it('preserves LIFF authentication parameters until initialization resolves', async () => {
    let complete: () => void = () => {
      throw Error('Initialization not started');
    };
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const f = fixture('checkin', {
      channel: 'line',
      hash: '#access_token=synthetic-sdk-state',
      lineInit: () => pending
    });
    await tick();
    expect(f.history.replaceState).not.toHaveBeenCalled();
    expect(f.fetchMock).not.toHaveBeenCalled();
    expect(f.location.hash).toBe('#access_token=synthetic-sdk-state');
    complete();
    await tick();
    expect(f.fetchMock).toHaveBeenCalled();
    expect(f.history.replaceState).toHaveBeenCalledTimes(1);
  });
  it('lets the SDK complete a LINE primary redirect without URL cleanup or profile requests', async () => {
    const f = fixture('checkin', {
      channel: 'line',
      lineSearch: '?liff.state=' + encodeURIComponent('/apply#' + 'b'.repeat(43))
    });
    await tick();
    expect(f.history.replaceState).not.toHaveBeenCalled();
    expect(f.fetchMock).not.toHaveBeenCalled();
  });
  it('closes LIFF only after the confirmed save without waiting for refresh or sending another message', async () => {
    const f = fixture('checkin', { channel: 'line', lineNative: true });
    await tick();
    expect(f.get('return-chat').hidden).toBe(false);
    f.all('[data-method]')[0]!.checked = true;
    await f.all('[data-method]')[0]!.onchange?.();
    let resolveSave: (response: Response) => void = () => {
      throw Error('Save not started');
    };
    const pending = new Promise<Response>((resolve) => {
      resolveSave = resolve;
    });
    f.fetchMock.mockReturnValueOnce(pending);
    const saving = f.get('submit').onclick?.();
    await tick();
    expect(f.lineClose).not.toHaveBeenCalled();
    resolveSave(
      new Response(JSON.stringify({ checkinId: randomUUID(), version: 4, receiptQueued: true }), {
        status: 200
      })
    );
    await saving;
    expect(f.lineClose).toHaveBeenCalledTimes(1);
    expect(f.confirm).not.toHaveBeenCalled();
    expect(
      f.fetchMock.mock.calls.filter(([path]) => path === '/line/workspace/profile')
    ).toHaveLength(1);
    expect(f.fetchMock.mock.calls.filter(([path]) => path === '/line/workspace/save')).toHaveLength(
      1
    );
    const event = { preventDefault: vi.fn() };
    await f.listeners.get('beforeunload')?.(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it.each([
    {
      name: 'failed save',
      native: true,
      available: true,
      throws: false,
      failed: true,
      attempts: 0
    },
    {
      name: 'external browser',
      native: false,
      available: true,
      throws: false,
      failed: false,
      attempts: 0
    },
    {
      name: 'missing bridge',
      native: true,
      available: false,
      throws: false,
      failed: false,
      attempts: 0
    },
    {
      name: 'throwing bridge',
      native: true,
      available: true,
      throws: true,
      failed: false,
      attempts: 1
    }
  ])(
    'keeps the LINE page open on $name',
    async ({ native, available, throws, failed, attempts }) => {
      const f = fixture('checkin', {
        channel: 'line',
        lineNative: native,
        lineCloseAvailable: available,
        lineCloseThrows: throws
      });
      await tick();
      f.all('[data-method]')[0]!.checked = true;
      await f.all('[data-method]')[0]!.onchange?.();
      if (failed) f.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 409 }));
      await f.get('submit').onclick?.();
      expect(f.lineClose).toHaveBeenCalledTimes(attempts);
      expect(f.location.href).toBe('');
      expect(f.get('return-chat').hidden).toBe(!native || !available);
      if (failed) {
        expect(f.all('[data-method]')[0]!.checked).toBe(true);
        const event = { preventDefault: vi.fn() };
        await f.listeners.get('beforeunload')?.(event);
        expect(event.preventDefault).toHaveBeenCalled();
      } else
        expect(
          f.fetchMock.mock.calls.filter(([path]) => path === '/line/workspace/profile')
        ).toHaveLength(2);
    }
  );
  it('preserves another LINE date draft and confirms manual return to chat', async () => {
    const f = fixture('checkin', { channel: 'line', lineNative: true });
    await tick();
    f.get('note').value = 'Unsaved today';
    f.get('note').oninput?.();
    await f.get('yesterdayTab').onclick?.();
    f.all('[data-method]')[0]!.checked = true;
    await f.all('[data-method]')[0]!.onchange?.();
    await f.get('submit').onclick?.();
    expect(f.lineClose).not.toHaveBeenCalled();
    await f.get('todayTab').onclick?.();
    expect(f.get('note').value).toBe('Unsaved today');
    f.confirm.mockReturnValueOnce(false);
    await f.get('return-chat').onclick?.();
    expect(f.lineClose).not.toHaveBeenCalled();
    f.confirm.mockReturnValueOnce(true);
    await f.get('return-chat').onclick?.();
    expect(f.lineClose).toHaveBeenCalledTimes(1);
  });
  it('does not discard an unsaved LINE timezone change after saving', async () => {
    const f = fixture('checkin', { channel: 'line', lineNative: true });
    await tick();
    f.get('zone').value = 'Asia/Taipei';
    f.all('[data-method]')[0]!.checked = true;
    await f.all('[data-method]')[0]!.onchange?.();
    await f.get('submit').onclick?.();
    expect(f.lineClose).not.toHaveBeenCalled();
  });
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
  it.each(
    (['telegram', 'line', 'whatsapp'] as const).flatMap((channel) =>
      (['zh_TW', 'zh_CN', 'en'] as const).map((locale) => ({ channel, locale }))
    )
  )(
    'starts groups collapsed and toggles only visibility for $channel / $locale',
    async ({ channel, locale }) => {
      const f = fixture('checkin', { locale, ...(channel === 'telegram' ? {} : { channel }) });
      await tick();
      const wrapper = f.get('methodsList').children[0]!,
        head = wrapper.children[0]!,
        children = wrapper.children[1]!,
        toggle = head.children.find((child) => child.className === 'toggle');
      if (!toggle) throw Error('Missing method toggle fixture');
      expect(children.hidden).toBe(true);
      expect(toggle.textContent).toBe('+');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe(children.getAttribute('id'));
      const calls = f.fetchMock.mock.calls.length;
      await click(toggle);
      expect(children.hidden).toBe(false);
      expect(toggle.textContent).toBe('−');
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(f.all('[data-method]').every((input) => !input.checked)).toBe(true);
      await click(toggle);
      expect(children.hidden).toBe(true);
      expect(toggle.textContent).toBe('+');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(f.fetchMock).toHaveBeenCalledTimes(calls);
      await click(f.links[1]!);
      expect(f.confirm).not.toHaveBeenCalled();
    }
  );
  it('retains hidden selections and parent all/partial states without turning a collapsed parent into a submitted method', async () => {
    const f = fixture('checkin', { entries: [entry('2026-10-09')] });
    await tick();
    const wrapper = f.get('methodsList').children[0]!,
      children = wrapper.children[1]!,
      toggle = wrapper.children[0]!.children.find((child) => child.className === 'toggle');
    if (!toggle) throw Error('Missing method toggle fixture');
    const parent = f.all('[data-group]')[0]!;
    expect(children.hidden).toBe(true);
    expect(parent.checked).toBe(false);
    expect(parent.indeterminate).toBe(true);
    expect(f.all('[data-method]')[0]!.checked).toBe(true);
    parent.checked = true;
    await parent.onchange?.();
    expect(children.hidden).toBe(true);
    expect(f.all('[data-method]').every((input) => input.checked)).toBe(true);
    expect(parent.indeterminate).toBe(false);
    await click(toggle);
    const leaf = f.all('[data-method]')[1]!;
    leaf.checked = false;
    await leaf.onchange?.();
    await click(toggle);
    expect(parent.indeterminate).toBe(true);
    expect(f.all('[data-method]')[0]!.checked).toBe(true);
    expect(leaf.checked).toBe(false);
    await click(f.get('submit'));
    const save = f.fetchMock.mock.calls.find(
      ([input]) => typeof input === 'string' && input.endsWith('/save')
    );
    expect(jsonBody(save?.[1]?.body).methods).toEqual(['dayan_chu']);
  });
  it('preserves expansion through date redraws together with separate method and note drafts', async () => {
    const f = fixture();
    await tick();
    const initial = f.get('methodsList').children[0]!,
      toggle = initial.children[0]!.children.find((child) => child.className === 'toggle');
    if (!toggle) throw Error('Missing method toggle fixture');
    await click(toggle);
    f.all('[data-method]')[0]!.checked = true;
    await f.all('[data-method]')[0]!.onchange?.();
    f.get('note').value = 'Synthetic today draft';
    f.get('note').oninput?.();
    await click(f.get('yesterdayTab'));
    expect(f.get('methodsList').children[0]!.children[1]!.hidden).toBe(false);
    expect(f.all('[data-method]').every((input) => !input.checked)).toBe(true);
    f.get('note').value = 'Synthetic yesterday draft';
    f.get('note').oninput?.();
    await click(f.get('todayTab'));
    expect(f.get('note').value).toBe('Synthetic today draft');
    expect(f.all('[data-method]')[0]!.checked).toBe(true);
    expect(f.get('methodsList').children[0]!.children[1]!.hidden).toBe(false);
    const fresh = fixture();
    await tick();
    expect(fresh.get('methodsList').children[0]!.children[1]!.hidden).toBe(true);
  });
  it('keeps expansion and failed-save request identity stable when visibility changes between retries', async () => {
    const f = fixture();
    await tick();
    const toggle = () => {
      const control = f
        .get('methodsList')
        .children[0]!.children[0]!.children.find((child) => child.className === 'toggle');
      if (!control) throw Error('Missing method toggle fixture');
      return control;
    };
    await click(toggle());
    f.all('[data-method]')[0]!.checked = true;
    await f.all('[data-method]')[0]!.onchange?.();
    f.fetchMock.mockResolvedValueOnce(
      new Response('{"error":"synthetic_failure"}', { status: 503 })
    );
    await click(f.get('submit'));
    const first = jsonBody(f.fetchMock.mock.calls[1]![1]?.body);
    expect(f.get('methodsList').children[0]!.children[1]!.hidden).toBe(false);
    await click(toggle());
    f.fetchMock.mockResolvedValueOnce(
      new Response('{"error":"synthetic_failure"}', { status: 503 })
    );
    await click(f.get('submit'));
    const second = jsonBody(f.fetchMock.mock.calls[2]![1]?.body);
    expect(second.requestId).toBe(first.requestId);
    expect(second.methods).toEqual(first.methods);
    expect(f.get('methodsList').children[0]!.children[1]!.hidden).toBe(true);
  });
  it('does not treat native Mini App disclosure changes as unsaved practice edits', async () => {
    const f = fixture('checkin', { native: true });
    await tick();
    const wrapper = f.get('methodsList').children[0]!,
      toggle = wrapper.children[0]!.children.find((child) => child.className === 'toggle');
    if (!toggle) throw Error('Missing method toggle fixture');
    const before = f.app.enableClosingConfirmation.mock.calls.length;
    await click(toggle);
    await click(toggle);
    expect(f.app.enableClosingConfirmation).toHaveBeenCalledTimes(before);
    await click(f.links[1]!);
    expect(f.confirm).not.toHaveBeenCalled();
  });
  it('forgets expansion for a group that disappears from the available method profile', async () => {
    const f = fixture();
    await tick();
    const saved = [...f.profile.methods],
      toggle = f
        .get('methodsList')
        .children[0]!.children[0]!.children.find((child) => child.className === 'toggle');
    if (!toggle) throw Error('Missing method toggle fixture');
    await click(toggle);
    f.profile.methods.splice(0, f.profile.methods.length, {
      code: 'huanghai',
      name: 'Swaying Sea',
      groupCode: 'huanghai',
      group: 'Swaying Sea'
    });
    await click(f.get('reload'));
    await tick();
    expect(f.all('[data-group]')).toHaveLength(0);
    f.profile.methods.splice(0, f.profile.methods.length, ...saved);
    await click(f.get('reload'));
    await tick();
    expect(f.get('methodsList').children[0]!.children[1]!.hidden).toBe(true);
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
