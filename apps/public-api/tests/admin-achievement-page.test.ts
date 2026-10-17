import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { renderAdminAchievementsPage } from '../src/admin-achievement-page.js';
import { achievementTexts } from '../src/admin-achievement-locale.js';
import type { AdminLocale } from '../src/admin-locale.js';
import type { AchievementCatalog, AchievementRecipients } from '../src/admin-achievements.js';
type Handler = (event: { preventDefault: () => void }) => unknown;
interface Element {
  tagName: string;
  value: string;
  hidden: boolean;
  disabled: boolean;
  className: string;
  textContent: string;
  href: string;
  dataset: Record<string, string>;
  children: Element[];
  listeners: Map<string, Handler>;
  attributes: Map<string, string>;
  append: (...children: Element[]) => void;
  replaceChildren: (...children: Element[]) => void;
  addEventListener: (name: string, handler: Handler) => void;
  setAttribute: (name: string, value: string) => void;
  scrollIntoView: (options: { block: string; behavior: string }) => void;
  focus: (options: { preventScroll: boolean }) => void;
}
const element = (tagName = 'div'): Element => {
  let text = '';
  const n: Element = {
    tagName,
    value: '',
    hidden: false,
    disabled: false,
    className: '',
    href: '',
    dataset: {},
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    scrollIntoView: vi.fn(),
    focus: vi.fn(),
    get textContent() {
      return text + n.children.map((c) => c.textContent).join('');
    },
    set textContent(value) {
      text = value;
      n.children = [];
    },
    append: (...children) => {
      n.children.push(...children);
    },
    replaceChildren: (...children) => {
      text = '';
      n.children = children;
    },
    addEventListener: (name, handler) => {
      n.listeners.set(name, handler);
    },
    setAttribute: (name, value) => {
      n.attributes.set(name, value);
    }
  };
  Object.defineProperty(n, 'innerHTML', {
    set: () => {
      throw Error('No HTML insertion permitted');
    }
  });
  return n;
};
const region = '11111111-1111-4111-8111-111111111111';
const person = '22222222-2222-4222-8222-222222222222';
const catalog = (): AchievementCatalog => ({
  readOnly: true,
  observedAt: '2026-10-17T00:00:00Z',
  seasonYear: null,
  regions: [{ id: region, name: 'Synthetic region' }],
  badges: [
    {
      code: 'streak_3',
      kind: 'streak',
      name: 'Literal badge <b>😀</b>',
      threshold: 3,
      methodCodes: [],
      ruleVersion: 1,
      configured: true,
      recipientCount: 1,
      periods: [{ period: 'lifetime', recipientCount: 1 }],
      seasons: []
    },
    {
      code: 'total_10',
      kind: 'total',
      name: 'Second badge',
      threshold: 10,
      methodCodes: [],
      ruleVersion: 1,
      configured: true,
      recipientCount: 0,
      periods: [],
      seasons: []
    }
  ]
});
const recipients = (): AchievementRecipients => ({
  code: 'streak_3',
  ruleVersion: 1,
  page: 1,
  limit: 20,
  total: 1,
  totalPages: 1,
  rows: [
    {
      personId: person,
      displayName: 'Learner <img src=x>😀',
      regionId: region,
      regionName: 'Synthetic region',
      platform: 'telegram',
      awards: [{ period: 'lifetime', ruleVersion: 1, earnedAt: '2026-10-16T23:00:00Z' }]
    }
  ]
});
const all = (root: Element): Element[] => [root, ...root.children.flatMap(all)];
const requestUrl = (input: Parameters<typeof fetch>[0]) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
const fixture = (locale: AdminLocale = 'zh_TW', fetcher?: typeof fetch) => {
  const nodes = new Map<string, Element>(),
    html = renderAdminAchievementsPage(locale);
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id)!;
  };
  const fetch = vi.fn<typeof globalThis.fetch>(
    fetcher ??
      (async (input) => {
        const url = requestUrl(input);
        return Response.json(url.includes('/recipients?') ? recipients() : catalog());
      })
  );
  const location = { href: 'https://checkin.baiyinqigong.org/admin/achievements?lang=' + locale };
  const history = {
    replaceState: vi.fn((_data: unknown, _title: string, url: string) => {
      location.href = new URL(url, location.href).href;
    })
  };
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const code = scripts.at(-1)?.[1];
  if (!code) throw Error('Missing achievement script');
  new vm.Script(code).runInNewContext({
    document: {
      getElementById: get,
      createElement: element,
      createTextNode: (value: string) => {
        const n = element('text');
        n.textContent = value;
        return n;
      }
    },
    location,
    history,
    fetch,
    URL,
    URLSearchParams,
    Intl,
    Date,
    AbortController
  });
  return {
    get,
    fetch,
    location,
    html,
    buttons: () => all(get('achievements-catalog')).filter((n) => n.tagName === 'button')
  };
};
const settle = async () => {
  for (let i = 0; i < 8; i++) await setImmediate();
};
const click = async (node: Element) => {
  const handler = node.listeners.get('click');
  if (!handler) throw Error('Missing click');
  await handler({ preventDefault: vi.fn() });
  await settle();
};
const submit = async (f: ReturnType<typeof fixture>) => {
  const handler = f.get('achievements-filters').listeners.get('submit');
  if (!handler) throw Error('Missing submit');
  await handler({ preventDefault: vi.fn() });
  await settle();
};
const deferred = () => {
  let finish: ((response: Response) => void) | undefined;
  const promise = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  return {
    promise,
    resolve: (response: Response) => {
      if (!finish) throw Error('Missing resolver');
      finish(response);
    }
  };
};
describe('Read-only achievement view controller', () => {
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'renders literal DTO content and key-complete static labels in %s',
    async (locale) => {
      const f = fixture(locale);
      await settle();
      expect(Object.keys(achievementTexts(locale)).sort()).toEqual(
        Object.keys(achievementTexts('en')).sort()
      );
      expect(f.get('achievements-catalog').textContent).toContain('Literal badge <b>😀</b>');
      expect(f.get('achievements-catalog').textContent).not.toContain('{version}');
      const button = f.buttons().find((b) => b.dataset.badgeCode === 'streak_3')!;
      expect(button.textContent).toContain('1');
      await click(button);
      const detail = f.get('achievements-recipients');
      expect(detail.textContent).toContain('Learner <img src=x>😀');
      expect(
        all(detail).some((n) => n.tagName === 'img' || n.tagName === 'script' || n.tagName === 'b')
      ).toBe(false);
      expect(detail.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
      expect(detail.focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(all(detail).some((n) => n.tagName === 'a' && n.href === '#achievements-catalog')).toBe(
        true
      );
      const link = all(detail).find(
        (n) => n.tagName === 'a' && n.href.startsWith('/admin/method-analysis?')
      )!;
      const url = new URL(link.href, 'https://example.invalid');
      expect(url.searchParams.get('personId')).toBe(person);
      expect(url.searchParams.has('name')).toBe(false);
      expect(
        f.fetch.mock.calls.every(
          ([, options]) =>
            options?.cache === 'no-store' &&
            options.credentials === 'same-origin' &&
            !options.method
        )
      ).toBe(true);
      expect(f.html).not.toContain('localStorage');
      expect(f.html).not.toContain('sessionStorage');
      expect(f.html).toContain('id="achievements-readonly"');
    }
  );
  it('uses explicit applied filters, category grouping and seasonal year without a write request', async () => {
    const f = fixture();
    await settle();
    f.get('achievements-q').value = 'literal_%';
    f.get('achievements-region').value = region;
    f.get('achievements-platform').value = 'telegram';
    f.get('achievements-year').value = '2026';
    f.get('achievements-category').value = 'streak';
    await submit(f);
    expect(f.buttons()).toHaveLength(1);
    expect(f.get('achievements-catalog').textContent).not.toContain('Second badge');
    const latest = f.fetch.mock.calls.at(-1)?.[0];
    if (!latest) throw Error('Missing filter request');
    const url = new URL(requestUrl(latest), 'https://example.invalid');
    expect(url.searchParams.get('q')).toBe('literal_%');
    expect(url.searchParams.get('region')).toBe(region);
    expect(url.searchParams.get('platform')).toBe('telegram');
    expect(url.searchParams.get('year')).toBe('2026');
    expect(url.searchParams.has('category')).toBe(false);
    expect(new URL(f.location.href).searchParams.get('category')).toBe('streak');
  });
  it('does not repaint a delayed old catalog after a later filter response', async () => {
    const old = deferred();
    let calls = 0;
    const f = fixture('en', async () => {
      calls++;
      if (calls === 1) return old.promise;
      const data = catalog();
      data.badges[0]!.name = 'NEW RESULT';
      return Response.json(data);
    });
    await settle();
    f.get('achievements-q').value = 'new';
    await submit(f);
    expect(f.get('achievements-catalog').textContent).toContain('NEW RESULT');
    const data = catalog();
    data.badges[0]!.name = 'STALE RESULT';
    old.resolve(Response.json(data));
    await settle();
    expect(f.get('achievements-catalog').textContent).not.toContain('STALE RESULT');
  });
  it('clears protected data on lost authorization and ignores an already in-flight recipient response', async () => {
    const late = deferred();
    const f = fixture('en', async (input) => {
      const url = requestUrl(input);
      if (url.includes('/streak_3/recipients')) return late.promise;
      if (url.includes('/total_10/recipients'))
        return Response.json({ error: 'achievement_denied' }, { status: 403 });
      return Response.json(catalog());
    });
    await settle();
    await click(f.buttons().find((b) => b.dataset.badgeCode === 'streak_3')!);
    await click(f.buttons().find((b) => b.dataset.badgeCode === 'total_10')!);
    expect(f.get('achievements-catalog').textContent).toBe('');
    expect(f.get('achievements-recipients').textContent).toBe('');
    expect(f.get('achievements-status').textContent).toBe(
      'You do not have permission to use this feature.'
    );
    late.resolve(Response.json(recipients()));
    await settle();
    expect(f.get('achievements-recipients').textContent).not.toContain('Learner');
    expect(f.get('achievements-catalog').textContent).toBe('');
  });
  it('supports an explicit retry after transport failure without echoing server diagnostics', async () => {
    let failed = true;
    const f = fixture('en', async () => {
      if (failed) throw Error('PRIVATE SQL DIAGNOSTICS');
      return Response.json(catalog());
    });
    await settle();
    expect(f.get('achievements-retry').hidden).toBe(false);
    expect(f.get('achievements-status').textContent).not.toContain('PRIVATE');
    failed = false;
    await click(f.get('achievements-retry'));
    expect(f.get('achievements-catalog').textContent).toContain('Literal badge');
    expect(f.get('achievements-retry').hidden).toBe(true);
  });
});
