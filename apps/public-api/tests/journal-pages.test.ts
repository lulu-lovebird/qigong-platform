import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { renderAdminJournalPage } from '../src/admin-journal-pages.js';
import { renderLearnerJournalPage } from '../src/learner-journal-pages.js';
import { journalTexts } from '../src/journal-locale.js';

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
  onsubmit?: Handler;
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
const requestPath = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
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

const fixture = (kind: 'journal' | 'tags' | 'learner', locale: 'en' | 'zh_TW' = 'en') => {
  const nodes = new Map<string, Element>();
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id)!;
  };
  const confirm = vi.fn(() => true),
    listeners = new Map<string, Handler>();
  const app = {
    ready: vi.fn(),
    expand: vi.fn(),
    enableClosingConfirmation: vi.fn(),
    disableClosingConfirmation: vi.fn()
  };
  const window: {
    Telegram: { WebApp: typeof app };
    addEventListener: (n: string, h: Handler) => void;
    qigongJournalMayLeave?: () => boolean;
  } = {
    Telegram: { WebApp: app },
    addEventListener: (n, h) => {
      listeners.set(n, h);
    }
  };
  const location = {
    hash: '#' + 'a'.repeat(43),
    pathname: kind === 'learner' ? '/telegram/journal' : '/admin/' + kind,
    search: '?lang=' + locale,
    href: 'https://checkin.baiyinqigong.org/' + kind + '?lang=' + locale
  };
  const history = { replaceState: vi.fn() },
    tagId = randomUUID(),
    checkinId = randomUUID();
  const catalog = {
    version: 1,
    tags: [{ id: tagId, name_zh_tw: '放鬆', name_en: 'Relaxed', active: true }]
  };
  const own = {
    page: 1,
    total: 2,
    entries: [checkinId, randomUUID()].map((id) => ({
      checkinId: id,
      sourceHash: '1'.repeat(64),
      date: '2026-10-09',
      version: 0,
      active: false,
      alias: '',
      shareNote: false,
      shareFeelings: false,
      externalEnabled: false,
      practiceNote: '<script>Private note</script>',
      feelingTags: [{ id: tagId, name: 'Literal feeling' }],
      methods: ['Dayan']
    }))
  };
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const path = requestPath(input);
    let data: unknown = {};
    if (path.includes('practice-feeling-tags')) {
      if (init?.method === 'PUT') {
        const value = jsonBody(init.body);
        data = { version: 2, tags: value.tags };
      } else data = structuredClone(catalog);
    } else if (path.endsWith('/own')) data = structuredClone(own);
    else if (path.endsWith('/feed'))
      data = {
        page: 1,
        total: 1,
        entries: [
          {
            id: randomUUID(),
            date: '2026-10-09',
            alias: 'Shared <b>alias</b>',
            practiceNote: '<script>Shared note</script>',
            methods: ['Dayan'],
            feelingTags: ['Feeling']
          }
        ]
      };
    else if (path.endsWith('/publish')) data = { version: 1, active: jsonBody(init?.body).active };
    else if (path.startsWith('/admin/api/journal?'))
      data = {
        page: 1,
        total: 1,
        entries: [
          {
            name: '<b>Private learner</b>',
            practiceDate: '2026-10-09',
            updatedAt: '2026-10-09T01:00:00Z',
            practiceNote: '<script>Private note</script>',
            methodsVisible: true,
            methods: ['Dayan'],
            feelingTags: [{ id: tagId, name: 'Literal feeling' }]
          }
        ]
      };
    return new Response(JSON.stringify(data));
  });
  const html =
    kind === 'learner'
      ? renderLearnerJournalPage(locale)
      : renderAdminJournalPage(kind, locale, false);
  let source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  if (kind !== 'learner') source = source.slice(source.indexOf('const journalKind='));
  new Script(source).runInNewContext({
    document: {
      getElementById: get,
      createElement: element,
      cookie: '__Host-qigong-admin-csrf=test-csrf'
    },
    window,
    confirm,
    location,
    history,
    fetch: fetchMock,
    URL,
    URLSearchParams,
    AbortSignal
  });
  const texts = (e: Element): string => e.textContent + e.children.map(texts).join(' ');
  const descendants = (e: Element, tag: string): Element[] =>
    e.children.flatMap((c) => [...(c.tagName === tag ? [c] : []), ...descendants(c, tag)]);
  return {
    get,
    confirm,
    listeners,
    fetchMock,
    window,
    app,
    history,
    location,
    catalog,
    own,
    texts,
    descendants,
    html,
    t: journalTexts(locale)
  };
};
const settle = async () => {
  for (let i = 0; i < 5; i++) await setImmediate();
};
describe('Journal generated pages and unsaved-edit behavior', () => {
  it.each(['en', 'zh_TW'] as const)(
    'parses all %s scripts and keeps SDK capabilities outside cached parameters',
    (locale) => {
      for (const html of [
        renderAdminJournalPage('journal', locale, false),
        renderAdminJournalPage('tags', locale, false),
        renderLearnerJournalPage(locale)
      ])
        for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
          expect(() => new Script(m[1]!)).not.toThrow();
      const html = renderLearnerJournalPage(locale);
      expect(html.indexOf('workspaceCredential=')).toBeLessThan(
        html.indexOf('src="https://telegram.org')
      );
      expect(html).toContain('Bean, Bird &amp; Badminton Tech Consulting');
    }
  );
  it.each(['en', 'zh_TW'] as const)(
    'renders literal private journal content and controlled person pagination in %s',
    async (locale) => {
      const f = fixture('journal', locale);
      await settle();
      expect(f.texts(f.get('journal-entries'))).toContain('<script>Private note</script>');
      expect(f.get('journal-prev').disabled).toBe(true);
      expect(f.get('journal-next').disabled).toBe(true);
      f.get('journal-person').value = randomUUID();
      await f.get('journal-filter').onsubmit?.({ preventDefault: vi.fn() });
      await settle();
      expect(requestPath(f.fetchMock.mock.calls.at(-1)![0])).toContain('personId=');
    }
  );
  it.each(['en', 'zh_TW'] as const)(
    'protects changed tags, restores baselines and never submits cancelled edits in %s',
    async (locale) => {
      const f = fixture('tags', locale);
      await settle();
      expect(f.window.qigongJournalMayLeave?.()).toBe(true);
      expect(f.confirm).not.toHaveBeenCalled();
      const input = f.descendants(f.get('tag-rows'), 'input')[0]!;
      input.value = '修改';
      input.oninput?.();
      f.confirm.mockReturnValue(false);
      expect(f.window.qigongJournalMayLeave?.()).toBe(false);
      await f.get('journal-reload').onclick?.();
      expect(input.value).toBe('修改');
      input.value = '放鬆';
      input.oninput?.();
      f.confirm.mockClear();
      expect(f.window.qigongJournalMayLeave?.()).toBe(true);
      expect(f.confirm).not.toHaveBeenCalled();
    }
  );
  it.each(['en', 'zh_TW'] as const)(
    'keeps failed tag input, sends strict CSRF/version payloads, and resets after success in %s',
    async (locale) => {
      const f = fixture('tags', locale);
      await settle();
      const input = f.descendants(f.get('tag-rows'), 'input')[0]!;
      input.value = '修改';
      input.oninput?.();
      f.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 409 }));
      await f.get('tag-save').onclick?.();
      expect(input.value).toBe('修改');
      expect(f.get('journal-status').textContent).toBe(f.t.conflict);
      await f.get('tag-save').onclick?.();
      const request = f.fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT')![1]!;
      expect(request.headers).toMatchObject({ 'x-csrf-token': 'test-csrf' });
      expect(jsonBody(request.body)).toMatchObject({ version: 1 });
      f.confirm.mockClear();
      expect(f.window.qigongJournalMayLeave?.()).toBe(true);
      expect(f.confirm).not.toHaveBeenCalled();
    }
  );
  it.each(['en', 'zh_TW'] as const)(
    'requires explicit sharing selections and preserves other card drafts in %s',
    async (locale) => {
      const f = fixture('learner', locale);
      await settle();
      expect(f.texts(f.get('journal-entries'))).toContain('<script>Shared note</script>');
      await f.get('show-mine').onclick?.();
      await settle();
      const cards = f.get('journal-entries').children;
      const controls = f.descendants(cards[0]!, 'input');
      expect(controls.slice(1).every((e) => !e.checked)).toBe(true);
      const buttons = f.descendants(cards[0]!, 'button');
      await buttons[0]!.onclick?.();
      expect(f.get('journal-status').textContent).toBe(f.t.invalid);
      controls[0]!.value = 'My alias';
      controls[0]!.oninput?.();
      controls[1]!.checked = true;
      await controls[1]!.onchange?.();
      const other = f.descendants(cards[1]!, 'input')[0]!;
      other.value = 'Other draft';
      other.oninput?.();
      await buttons[0]!.onclick?.();
      const request = f.fetchMock.mock.calls.find((c) => requestPath(c[0]).endsWith('/publish'))!;
      expect(jsonBody(request[1]?.body)).toMatchObject({
        alias: 'My alias',
        shareNote: true,
        shareFeelings: false,
        externalEnabled: false,
        active: true,
        version: 0
      });
      expect(other.value).toBe('Other draft');
      expect(f.app.enableClosingConfirmation).toHaveBeenCalled();
    }
  );
  it.each(['en', 'zh_TW'] as const)(
    'preserves sharing values on failed writes and cancelled cross-view navigation in %s',
    async (locale) => {
      const f = fixture('learner', locale);
      await settle();
      await f.get('show-mine').onclick?.();
      await settle();
      const card = f.get('journal-entries').children[0]!,
        inputs = f.descendants(card, 'input');
      inputs[0]!.value = 'Keep alias';
      inputs[0]!.oninput?.();
      inputs[1]!.checked = true;
      await inputs[1]!.onchange?.();
      f.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 409 }));
      await f.descendants(card, 'button')[0]!.onclick?.();
      expect(inputs[0]!.value).toBe('Keep alias');
      f.confirm.mockReturnValue(false);
      await f.get('show-feed').onclick?.();
      expect(f.get('journal-entries').children[0]).toBe(card);
      expect(f.get('journal-status').textContent).toBe(f.t.conflict);
    }
  );
});
