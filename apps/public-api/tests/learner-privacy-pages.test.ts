import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { renderLearnerPrivacyPage } from '../src/learner-privacy-pages.js';
import { learnerPrivacyHash, learnerPrivacyVersion } from '../src/learner-privacy-policy.js';
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

const fixture = (active = true, locale: 'en' | 'zh_TW' = 'en', hash = '#' + 'a'.repeat(43)) => {
  const fields = new Map<string, Element>();
  const get = (id: string) => {
    if (!fields.has(id)) fields.set(id, element());
    return fields.get(id)!;
  };
  const location = {
    hash,
    pathname: '/privacy',
    search: '?lang=' + locale,
    href: ''
  };
  const history = { replaceState: vi.fn() },
    confirm = vi.fn(() => true),
    listeners = new Map<string, Handler>();
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({ accepted: true, version: learnerPrivacyVersion, reflectionConsent: false })
      )
  );
  const html = renderLearnerPrivacyPage(locale, 'telegram', active);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw Error('Missing script');
  new Script(script).runInNewContext({
    document: { getElementById: get },
    window: {
      addEventListener: (n: string, h: Handler) => {
        listeners.set(n, h);
      }
    },
    location,
    history,
    confirm,
    fetch: fetchMock,
    AbortSignal
  });
  return {
    get,
    history,
    confirm,
    fetchMock,
    location,
    listeners,
    html,
    t: learnerPrivacyTexts(locale)
  };
};
describe('Consent pages', () => {
  it.each(['en', 'zh_TW'] as const)(
    'shows the complete %s supplement, source policy and contact, without prechecked consent',
    (locale) => {
      const f = fixture(true, locale);
      expect(f.html).toContain('eqibaiyin@gmail.com');
      expect(f.html).toContain('https://app.getterms.io/view/4ZncR/privacy/en-us');
      expect(f.html).not.toContain('Bean, Bird');
      expect(f.html).not.toContain(' checked');
      expect(f.get('privacy-submit').disabled).toBe(true);
      expect(f.history.replaceState).toHaveBeenCalled();
      expect(learnerPrivacyHash).toMatch(/^[0-9a-f]{64}$/);
    }
  );
  it('rejects malformed fragments without a script exception', () => {
    const f = fixture(true, 'en', '#%invalid');
    expect(f.get('privacy-fields').disabled).toBe(true);
    expect(f.get('privacy-status').textContent).toBe(f.t.unavailable);
  });
  it('does not submit while draft or unaccepted', async () => {
    for (const active of [true, false]) {
      const f = fixture(active);
      await f.get('privacy-form').onsubmit?.({ preventDefault: vi.fn() });
      expect(f.fetchMock).not.toHaveBeenCalled();
    }
  });
  it('binds exact policy and provider, retains failures and warns only on actual changes', async () => {
    const f = fixture();
    f.get('privacy-accepted').checked = true;
    await f.get('privacy-accepted').onchange?.();
    f.fetchMock.mockResolvedValueOnce(new Response('{}', { status: 409 }));
    await f.get('privacy-form').onsubmit?.({ preventDefault: vi.fn() });
    expect(f.get('privacy-accepted').checked).toBe(true);
    expect(f.get('privacy-status').textContent).toBe(f.t.conflict);
    expect(jsonBody(f.fetchMock.mock.calls[0]?.[1]?.body)).toMatchObject({
      platform: 'telegram',
      version: learnerPrivacyVersion,
      hash: learnerPrivacyHash,
      accepted: true,
      reflectionConsent: false
    });
    f.confirm.mockReturnValue(false);
    f.get('privacy-language').value = 'zh_TW';
    await f.get('privacy-language').onchange?.();
    expect(f.location.href).toBe('');
    await f.get('privacy-form').onsubmit?.({ preventDefault: vi.fn() });
    expect(f.get('privacy-status').textContent).toBe(f.t.accepted);
  });
});
