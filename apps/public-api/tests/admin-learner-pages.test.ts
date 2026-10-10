import { setImmediate } from 'node:timers/promises';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { renderAdminLearnerPage, type AdminLearnerPage } from '../src/admin-learner-pages.js';
import { learnerPrivacyTexts } from '../src/learner-privacy-locale.js';

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
  remove: () => void;
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
    remove: () => {},
    focus: vi.fn()
  };
  Object.defineProperty(item, 'innerHTML', {
    set() {
      throw new Error('Unsafe HTML write');
    }
  });
  return item;
};

const fixture = (kind: AdminLearnerPage, locale: 'en' | 'zh_TW' = 'en') => {
  const nodes = new Map<string, Element>(),
    parents = new Map<Element, Element>();
  const create = (tag = 'div') => {
    const e = element(tag),
      append = e.append;
    e.append = (...children) => {
      for (const child of children) parents.set(child, e);
      append(...children);
    };
    e.remove = () => {
      const p = parents.get(e);
      if (p) p.children = p.children.filter((c) => c !== e);
    };
    return e;
  };
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, create());
    return nodes.get(id)!;
  };
  const listeners = new Map<string, Handler>(),
    confirm = vi.fn(() => true);
  const window: {
    addEventListener: (n: string, h: Handler) => void;
    qigongJournalMayLeave?: () => boolean;
  } = {
    addEventListener: (n, h) => {
      listeners.set(n, h);
    }
  };
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    let data: unknown = {};
    const path = requestPath(input);
    if (path.includes('privacy-policy'))
      data = init?.method === 'POST' ? { published: true } : { active: false };
    else if (init?.method === 'POST') data = { status: 'suspended', version: 2 };
    else if (kind === 'learners')
      data = {
        page: 1,
        total: 1,
        entries: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            name: 'Literal <script>learner</script>',
            status: 'active',
            version: 1
          }
        ]
      };
    else
      data = {
        page: 1,
        total: 1,
        entries: [
          {
            alias: 'Literal <b>alias</b>',
            date: '2026-10-10',
            methods: ['Dayan'],
            practiceNote: 'Literal <script>reflection</script>',
            feelingTags: ['Relaxed']
          }
        ]
      };
    return new Response(JSON.stringify(data));
  });
  const html = renderAdminLearnerPage(kind, locale, true);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw Error('Missing script');
  new Script(script.slice(script.indexOf('const learnerAdminConfig='))).runInNewContext({
    document: {
      getElementById: get,
      createElement: create,
      cookie: '__Host-qigong-admin-csrf=test-csrf'
    },
    window,
    confirm,
    fetch: fetchMock,
    AbortSignal,
    URLSearchParams
  });
  const descend = (e: Element): Element[] => e.children.flatMap((c) => [c, ...descend(c)]);
  return {
    get,
    fetchMock,
    confirm,
    window,
    listeners,
    descend,
    html,
    t: learnerPrivacyTexts(locale)
  };
};
const settle = async () => {
  for (let i = 0; i < 5; i++) await setImmediate();
};
describe('Scoped suspension and publication generated pages', () => {
  it.each(['en', 'zh_TW'] as const)(
    'parses %s pages and renders shared content as literal text',
    async (locale) => {
      for (const kind of ['learners', 'shared', 'privacy'] as const) {
        const f = fixture(kind, locale);
        await settle();
        expect(f.get('status').textContent).not.toBe(f.t.failed);
        if (kind === 'shared')
          expect(
            f
              .descend(f.get('learner-entries'))
              .some((n) => n.textContent.includes('<script>reflection</script>'))
          ).toBe(true);
      }
    }
  );
  it.each(['en', 'zh_TW'] as const)(
    'keeps failed %s reasons, guards changed edits, and sends CSRF/versioned suspension',
    async (locale) => {
      const f = fixture('learners', locale);
      await settle();
      const card = f.get('learner-entries').children[0]!;
      await f
        .descend(card)
        .find((n) => n.tagName === 'button')!
        .onclick?.();
      const input = f.descend(card).find((n) => n.tagName === 'textarea')!;
      input.value = 'Course paused';
      f.confirm.mockReturnValue(false);
      expect(f.window.qigongJournalMayLeave?.()).toBe(false);
      f.confirm.mockReturnValue(true);
      f.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 409 }));
      const submit = f.descend(card).filter((n) => n.tagName === 'button')[1]!;
      await submit.onclick?.();
      expect(input.value).toBe('Course paused');
      expect(f.get('status').textContent).toBe(f.t.conflict);
      await submit.onclick?.();
      const request = f.fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')![1]!;
      expect(request.headers).toMatchObject({ 'x-csrf-token': 'test-csrf' });
      expect(jsonBody(request.body)).toEqual({ version: 1, reason: 'Course paused' });
      expect(f.descend(card).some((n) => n.textContent === f.t.inactive)).toBe(true);
      expect(f.window.qigongJournalMayLeave?.()).toBe(true);
    }
  );
  it('rejects NUL in publication reasons before submitting', async () => {
    const f = fixture('privacy');
    await settle();
    f.get('policy-reason').value = 'Bad' + String.fromCharCode(0) + 'reason';
    await f.get('policy-publish').onclick?.();
    expect(f.get('status').textContent).toBe(f.t.invalid);
    expect(f.fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });
  it('requires a reviewed publication reason and retains it on failure', async () => {
    const f = fixture('privacy');
    await settle();
    await f.get('policy-publish').onclick?.();
    expect(f.fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
    f.get('policy-reason').value = 'Operator reviewed';
    f.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    await f.get('policy-publish').onclick?.();
    expect(f.get('policy-reason').value).toBe('Operator reviewed');
    await f.get('policy-publish').onclick?.();
    expect(f.get('policy-reason').value).toBe('');
    expect(f.get('policy-publish').disabled).toBe(true);
  });
});
