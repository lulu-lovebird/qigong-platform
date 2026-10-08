import { setImmediate } from 'node:timers/promises';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { lineApplicationPage } from '../src/line-application-page.js';
import { lineCheckinPage } from '../src/line-checkin-page.js';
import { telegramApplicationPage } from '../src/telegram-application-page.js';
import { telegramCheckinPage } from '../src/telegram-checkin-page.js';
import { renderApplicationPage } from '../src/application-page.js';
import { renderCheckinPage } from '../src/checkin-page.js';

type Handler = (event: { preventDefault: () => void }) => void | Promise<void>;
interface ElementStub {
  tagName: string;
  children: ElementStub[];
  listeners: Map<string, Handler>;
  hidden: boolean;
  disabled: boolean;
  checked: boolean;
  indeterminate: boolean;
  className: string;
  name: string;
  value: string;
  textContent: string;
  type: string;
  classList: { toggle: ReturnType<typeof vi.fn> };
  append: (...children: ElementStub[]) => void;
  replaceChildren: () => void;
  addEventListener: (event: string, handler: Handler) => void;
  querySelectorAll: (selector: string) => ElementStub[];
  querySelector: (selector: string) => ElementStub | undefined;
  setAttribute: ReturnType<typeof vi.fn>;
  scrollIntoView: ReturnType<typeof vi.fn>;
}
const element = (tagName = 'div'): ElementStub => {
  const node: ElementStub = {
    tagName,
    children: [],
    listeners: new Map(),
    hidden: false,
    disabled: false,
    checked: false,
    indeterminate: false,
    className: '',
    name: '',
    value: '',
    textContent: '',
    type: '',
    classList: { toggle: vi.fn() },
    append: (...children) => {
      node.children.push(...children);
    },
    replaceChildren: () => {
      node.children = [];
    },
    addEventListener: (event, handler) => {
      node.listeners.set(event, handler);
    },
    querySelectorAll: (selector) => {
      const matches = (child: ElementStub) =>
        selector.startsWith('.')
          ? child.className === selector.slice(1)
          : selector.startsWith('input')
            ? child.tagName === 'input' &&
              (!selector.includes('name=') ||
                child.name === (selector.includes('"group"') ? 'group' : 'methods')) &&
              (!selector.endsWith(':checked') || child.checked)
            : child.tagName === selector;
      return node.children.flatMap((child) => [
        ...(matches(child) ? [child] : []),
        ...child.querySelectorAll(selector)
      ]);
    },
    querySelector: (selector) => node.querySelectorAll(selector)[0],
    setAttribute: vi.fn(),
    scrollIntoView: vi.fn()
  };
  return node;
};
const script = (html: string) => {
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!source) throw new Error('Missing inline page script');
  return new Script(source);
};
const token = 'a'.repeat(43);
const requestPayload = (body: unknown): unknown => {
  if (typeof body !== 'string') throw new Error('Expected a JSON request body');
  return JSON.parse(body);
};
const fixture = (
  html: string,
  options: {
    loggedIn?: boolean;
    idToken?: string;
    init?: () => Promise<void>;
    hash?: string;
    responseStatus?: number;
    notificationConsent?: boolean;
    feelingTags?: ReadonlyArray<{ id: string; name: string }>;
  } = {}
) => {
  const nodes = new Map<string, ElementStub>();
  const get = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id)!;
  };
  const application = get('application');
  const applicationButton = element('button');
  application.append(applicationButton);
  get('checkin').hidden = true;
  get('checkin').append(get('methods'), get('submitButton'));
  const location = {
    href: 'https://checkin.baiyinqigong.org/line/apply#' + token,
    hash: options.hash ?? '#' + token,
    pathname: '/line/apply',
    replace: vi.fn()
  };
  const history = { replaceState: vi.fn() };
  const liff = {
    init: vi.fn(options.init ?? (async () => {})),
    isLoggedIn: vi.fn(() => options.loggedIn ?? true),
    getIDToken: vi.fn(() => options.idToken ?? 'verified-id-token'),
    login: vi.fn()
  };
  const telegram = { ready: vi.fn(), expand: vi.fn() };
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = path.endsWith('/methods')
      ? {
          methods: [
            {
              code: 'dayan_chu',
              name_zh_tw: '大雁初級',
              name_en: 'Dayan Beginner',
              parent_code: null
            }
          ]
        }
      : path.endsWith('/history')
        ? {
            today: '2026-10-07',
            timezone: 'Asia/Taipei',
            makeupOpen: true,
            currentStreak: 0,
            totalDays: 0,
            feelingTags: options.feelingTags ?? [],
            entries: []
          }
        : { status: 'pending' };
    return new Response(JSON.stringify(body), { status: options.responseStatus ?? 200 });
  });
  script(html).runInNewContext({
    location,
    history,
    liff,
    fetch: fetchMock,
    window: { Telegram: { WebApp: telegram } },
    document: {
      getElementById: get,
      createElement: element,
      createTextNode: (text: string) => ({ ...element(), textContent: text })
    },
    FormData: function () {
      const fields = new Map([
        ['name', 'Learner'],
        ['email', 'learner@example.com'],
        ['phone', '+886912345600'],
        ['region', 'tw-general']
      ]);
      if (options.notificationConsent) fields.set('notificationConsent', 'on');
      return fields;
    }
  });
  return { get, location, history, liff, fetchMock, applicationButton, telegram };
};
const submit = async (form: ElementStub) => {
  const handler = form.listeners.get('submit');
  if (!handler) throw new Error('Missing submit handler');
  await handler({ preventDefault: vi.fn() });
};

describe('shared learner pages without database or real LIFF SDK', () => {
  it.each([
    ['line', 'zh_TW'],
    ['telegram', 'zh_TW'],
    ['telegram', 'en'],
    ['whatsapp', 'zh_TW'],
    ['whatsapp', 'en']
  ] as const)(
    'keeps %s/%s feeling selection separate from authored text',
    async (platform, locale) => {
      const id = '12345678-1234-4234-8234-123456789abc';
      const page = renderCheckinPage({
        platform,
        locale,
        ...(platform === 'line' ? { liffId: 'test-liff' } : {})
      });
      const f = fixture(page, { feelingTags: [{ id, name: '<script>放鬆</script>' }] });
      await setImmediate();
      const textarea = f.get('practiceNote');
      textarea.value = '放鬆是我寫的字\n<script>原文</script>';
      const click = () =>
        f.get('feelingTags').children[0]!.listeners.get('click')!({ preventDefault: vi.fn() });
      await click();
      await click();
      await click();
      expect(textarea.value).toBe('放鬆是我寫的字\n<script>原文</script>');
      expect(f.get('feelingTags').children[0]!.textContent).toBe('<script>放鬆</script>');
      f.get('methods').querySelectorAll('input')[0]!.checked = true;
      await submit(f.get('checkin'));
      const write = f.fetchMock.mock.calls.find(([url]) => {
        const path = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        return path.endsWith('/submit');
      });
      expect(requestPayload(write?.[1]?.body)).toEqual(
        expect.objectContaining({
          practiceNote: '放鬆是我寫的字\n<script>原文</script>',
          feelingTagIds: [id]
        })
      );
    }
  );
  it('renders syntactically valid scripts and escapes embedded LIFF IDs', () => {
    for (const html of [
      telegramApplicationPage,
      telegramCheckinPage,
      lineApplicationPage('123456-test'),
      lineCheckinPage('123456-test')
    ]) {
      expect(() => script(html)).not.toThrow();
      expect(html).toContain('Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting');
    }
    const html = lineApplicationPage('</script><script>alert(1)</script>');
    expect(html).not.toContain('const liffId = "</script>');
    expect(() => script(html)).not.toThrow();
  });

  it('waits for LIFF initialization before enabling applications or sending requests', async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const page = fixture(lineApplicationPage('123456-test'), { init: () => pending });
    expect(page.applicationButton.disabled).toBe(true);
    const submission = submit(page.get('application'));
    await setImmediate();
    expect(page.fetchMock).not.toHaveBeenCalled();
    complete();
    await submission;
    expect(page.fetchMock).toHaveBeenCalledTimes(1);
    expect(page.fetchMock.mock.calls[0]?.[0]).toBe('/line/onboarding/apply');
    expect(requestPayload(page.fetchMock.mock.calls[0]?.[1]?.body)).toMatchObject({
      token,
      idToken: 'verified-id-token'
    });
    expect(page.history.replaceState).toHaveBeenCalledWith(null, '', '/line/apply');
    expect(page.get('application').hidden).toBe(true);
  });

  it('preserves the pre-initialization application fragment for external login', async () => {
    const page = fixture(lineApplicationPage('123456-test'), {
      loggedIn: false,
      init: async () => {
        await setImmediate();
        page.location.href = 'https://checkin.baiyinqigong.org/line/apply';
      }
    });
    await setImmediate();
    await setImmediate();
    expect(page.liff.login).toHaveBeenCalledWith({
      redirectUri: 'https://checkin.baiyinqigong.org/line/apply#' + token
    });
    expect(page.history.replaceState).not.toHaveBeenCalled();
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(page.get('application').hidden).toBe(true);
    expect(page.get('status').textContent).toContain('LINE 登入');
  });

  it.each(['application', 'checkin'])(
    'shows %s initialization failures without sending requests',
    async (kind) => {
      const html =
        kind === 'application'
          ? lineApplicationPage('123456-test')
          : lineCheckinPage('123456-test');
      const page = fixture(html, {
        init: async () => {
          throw new Error('LIFF initialization failed');
        }
      });
      await setImmediate();
      expect(page.get('status').textContent).toBe('LIFF initialization failed');
      expect(page.fetchMock).not.toHaveBeenCalled();
      expect(page.get(kind).hidden).toBe(true);
    }
  );

  it('rejects missing LINE ID tokens without sending requests', async () => {
    const page = fixture(lineCheckinPage('123456-test'), { idToken: '' });
    await setImmediate();
    expect(page.get('status').textContent).toContain('LINE 登入尚未完成');
    expect(page.fetchMock).not.toHaveBeenCalled();
  });

  it('loads LINE checkin data after login without Telegram code or token payloads', async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const html = lineCheckinPage('123456-test');
    expect(html).not.toContain('Telegram');
    const page = fixture(html, { init: () => pending });
    expect(page.fetchMock).not.toHaveBeenCalled();
    complete();
    await setImmediate();
    expect(page.fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/line/checkin/methods',
      '/line/checkin/history'
    ]);
    for (const call of page.fetchMock.mock.calls)
      expect(requestPayload(call[1]?.body)).toEqual({ idToken: 'verified-id-token' });
    expect(page.get('checkin').hidden).toBe(false);
    expect(page.get('methods').querySelectorAll('input[name="methods"]')).toHaveLength(1);
  });

  it('shows LINE conflicts without suggesting a Telegram command', async () => {
    const page = fixture(lineCheckinPage('123456-test'), { responseStatus: 409 });
    await setImmediate();
    expect(page.get('status').textContent).toContain('LINE 是主要打卡管道');
    expect(page.get('status').textContent).not.toContain('Telegram');
    expect(page.get('checkin').hidden).toBe(true);
  });

  it('keeps invalid application links hidden and never submits automatically', async () => {
    const page = fixture(lineApplicationPage('123456-test'), { hash: '#invalid' });
    await setImmediate();
    expect(page.get('application').hidden).toBe(true);
    expect(page.get('status').textContent).toContain('連結無效');
    expect(page.fetchMock).not.toHaveBeenCalled();
  });

  it('renders English application and checkin scripts, including method names and status labels', async () => {
    const application = renderApplicationPage({ platform: 'telegram', locale: 'en' });
    expect(application).toContain('<html lang="en">');
    expect(application).toContain('Website registration email');
    const page = fixture(renderCheckinPage({ platform: 'telegram', locale: 'en' }));
    await setImmediate();
    expect(page.get('dateStatus').textContent).toContain('not recorded');
    expect(page.get('stats').textContent).toContain('Practice time zone');
    const row = page.get('methods').children[0];
    expect(row?.children[1]?.children[1]?.textContent).toBe('Dayan Beginner');
    for (const call of page.fetchMock.mock.calls)
      expect(requestPayload(call[1]?.body)).toEqual({ token, locale: 'en' });
  });

  it('saves the identity language before navigating and retains only a fragment bearer token', async () => {
    const page = fixture(telegramApplicationPage);
    const handler = page.get('languageSwitch').listeners.get('click');
    if (!handler) throw new Error('Missing language switch');
    await handler({ preventDefault: vi.fn() });
    expect(page.fetchMock.mock.calls[0]?.[0]).toBe('/telegram/preferences/language');
    expect(requestPayload(page.fetchMock.mock.calls[0]?.[1]?.body)).toEqual({
      token,
      locale: 'en'
    });
    expect(page.location.replace).toHaveBeenCalledWith('/line/apply?lang=en#' + token);
  });

  it('does not navigate when the language link is rejected', async () => {
    const page = fixture(telegramApplicationPage, { responseStatus: 403 });
    const handler = page.get('languageSwitch').listeners.get('click');
    if (!handler) throw new Error('Missing language switch');
    await handler({ preventDefault: vi.fn() });
    expect(page.location.replace).not.toHaveBeenCalled();
    expect(page.get('status').textContent).toContain('語言設定失敗');
  });

  it('renders WhatsApp English applications with explicit consent and identity-bound payloads', async () => {
    const html = renderApplicationPage({ platform: 'whatsapp', locale: 'en' });
    expect(html).toContain('name="notificationConsent" type="checkbox" required');
    expect(html).not.toContain('Telegram');
    const page = fixture(html, { notificationConsent: true });
    await submit(page.get('application'));
    expect(page.fetchMock.mock.calls[0]?.[0]).toBe('/whatsapp/onboarding/apply');
    expect(requestPayload(page.fetchMock.mock.calls[0]?.[1]?.body)).toMatchObject({
      token,
      locale: 'en',
      notificationConsent: true
    });
    expect(page.telegram.ready).not.toHaveBeenCalled();
    expect(page.liff.init).not.toHaveBeenCalled();
  });

  it('renders WhatsApp English practice using the shared catalog without Telegram initialization', async () => {
    const page = fixture(renderCheckinPage({ platform: 'whatsapp', locale: 'en' }));
    await setImmediate();
    expect(page.fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/whatsapp/checkin/methods',
      '/whatsapp/checkin/history'
    ]);
    expect(page.get('checkin').hidden).toBe(false);
    expect(page.telegram.ready).not.toHaveBeenCalled();
  });

  it('preserves Telegram application endpoints and bearer-link payloads', async () => {
    const page = fixture(telegramApplicationPage);
    await submit(page.get('application'));
    expect(page.fetchMock.mock.calls[0]?.[0]).toBe('/telegram/onboarding/apply');
    const payload = requestPayload(page.fetchMock.mock.calls[0]?.[1]?.body);
    expect(payload).toMatchObject({ token });
    expect(payload).not.toHaveProperty('idToken');
    expect(page.liff.init).not.toHaveBeenCalled();
  });

  it('preserves Telegram WebApp initialization and checkin requests', async () => {
    const page = fixture(telegramCheckinPage);
    await setImmediate();
    expect(page.telegram.ready).toHaveBeenCalledOnce();
    expect(page.telegram.expand).toHaveBeenCalledOnce();
    expect(page.fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/telegram/checkin/methods',
      '/telegram/checkin/history'
    ]);
    for (const call of page.fetchMock.mock.calls)
      expect(requestPayload(call[1]?.body)).toEqual({ token });
    expect(page.get('checkin').hidden).toBe(false);
    expect(page.liff.init).not.toHaveBeenCalled();
  });
});
