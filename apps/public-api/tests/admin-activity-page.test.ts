import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { renderAdminActivityPage } from '../src/admin-activity-page.js';
import type { AdminLocale } from '../src/admin-locale.js';
type Handler = (event: { preventDefault: () => void; returnValue?: string }) => unknown;
interface Element {
  tagName: string;
  value: string;
  hidden: boolean;
  disabled: boolean;
  checked: boolean;
  required: boolean;
  readOnly: boolean;
  open: boolean;
  className: string;
  textContent: string;
  dataset: Record<string, string>;
  children: Element[];
  attrs: Map<string, string>;
  listeners: Map<string, Handler>;
  onclick?: Handler;
  onchange?: Handler;
  append: (...values: Element[]) => void;
  replaceChildren: (...values: Element[]) => void;
  setAttribute: (key: string, value: string) => void;
  querySelectorAll: (selector: string) => Element[];
  addEventListener: (key: string, value: Handler) => void;
  reportValidity: () => boolean;
  focus: () => void;
  scrollIntoView: () => void;
}
const element = (tagName = 'div'): Element => {
  let text = '';
  const n: Element = {
    tagName,
    value: '',
    hidden: false,
    disabled: false,
    checked: false,
    required: false,
    readOnly: false,
    open: false,
    className: '',
    dataset: {},
    children: [],
    attrs: new Map(),
    listeners: new Map(),
    get textContent() {
      return text + n.children.map((c) => c.textContent).join('');
    },
    set textContent(v) {
      text = v;
      n.children = [];
    },
    append: (...v) => n.children.push(...v),
    replaceChildren: (...v) => {
      text = '';
      n.children = v;
    },
    setAttribute: (k, v) => {
      n.attrs.set(k, v);
    },
    querySelectorAll: (selector) =>
      n.children.flatMap((c) => [
        ...(selector === 'input' && c.tagName === 'input' ? [c] : []),
        ...c.querySelectorAll(selector)
      ]),
    addEventListener: (k, v) => {
      n.listeners.set(k, v);
    },
    reportValidity: vi.fn(() => true),
    focus: vi.fn(),
    scrollIntoView: vi.fn()
  };
  Object.defineProperty(n, 'innerHTML', {
    set() {
      throw Error('No HTML insertion');
    }
  });
  return n;
};
const id = '11111111-1111-4111-8111-111111111111',
  second = '22222222-2222-4222-8222-222222222222';
const definition = {
  code: 'streak_3',
  kind: 'streak',
  name_zh_tw: '來源規則',
  name_en: 'Source rule',
  threshold: 3,
  method_codes: [],
  rule_version: 1,
  sort_order: 1,
  displayName: 'Literal <img src=x>😀'
};
const config = {
  nameZhTw: 'Synthetic <script> literal',
  nameZhCn: '',
  nameEn: 'Synthetic draft',
  description: '',
  effectiveDate: '2199-01-01',
  threshold: 5,
  methodCodes: []
};
const draft = (target = id) => ({
  id: target,
  subject: 'rule',
  code: 'streak_3',
  year: null,
  config: { ...config },
  baseConfig: { definition, season: null },
  baseHash: 'b'.repeat(64),
  revision: 1,
  state: 'draft',
  locked: false,
  sourceChanged: false,
  updatedAt: '2026-10-19T00:00:00Z',
  latestPreview: null
});
const preview = () => ({
  draftId: id,
  previewId: second,
  revision: 1,
  code: 'streak_3',
  subject: 'rule',
  year: null,
  configHash: 'a'.repeat(64),
  baseHash: 'b'.repeat(64),
  observedAt: '2026-10-19T00:00:00Z',
  expiresAt: '2026-10-19T00:10:00Z',
  effectiveDate: '2199-01-01',
  counts: {
    population: 2,
    currentlyAwarded: 1,
    qualifyingAsOf: 0,
    additionalQualifying: 0,
    existingAwardsPreserved: 1,
    wouldRevoke: 0
  },
  deadline: null,
  awardableNow: 0,
  publicationEnabled: false
});
const url = (input: Parameters<typeof fetch>[0]) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
const fixture = (locale: AdminLocale = 'en', custom?: typeof fetch) => {
  const html = renderAdminActivityPage(locale, true),
    nodes = new Map<string, Element>(),
    events = new Map<string, Handler>();
  const get = (key: string) => {
    if (!nodes.has(key)) nodes.set(key, element());
    return nodes.get(key)!;
  };
  for (const m of html.matchAll(/<([a-z]+)([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const n = get(m[3]!);
    n.tagName = m[1]!;
    n.hidden = /\bhidden\b/.test(m[2]!);
    n.disabled = /\bdisabled\b/.test(m[2]!);
  }
  get('management-activity-code').value = 'seasonal_summer';
  const fetch = vi.fn<typeof globalThis.fetch>(
    custom ??
      (async (input, init) => {
        const path = url(input);
        if (path.endsWith('/capabilities'))
          return Response.json({ canManage: true, canPreview: true, canPublish: false });
        if (path.includes('/catalog?'))
          return Response.json({
            definitions: [definition, { ...definition, code: 'seasonal_winter', kind: 'winter' }],
            seasons: [],
            methods: [
              {
                code: 'huichun_chu',
                nameZhTw: '回春初',
                nameEn: 'Huichun basic',
                displayName: '回春初 <img>😀',
                parentCode: 'huichun',
                groupZhTw: '回春功',
                groupEn: 'Huichun',
                groupDisplayName: '回春功'
              },
              {
                code: 'huichun_zhong',
                nameZhTw: '回春中',
                nameEn: 'Huichun middle',
                displayName: '回春中',
                parentCode: 'huichun',
                groupZhTw: '回春功',
                groupEn: 'Huichun',
                groupDisplayName: '回春功'
              },
              {
                code: 'huanghai',
                nameZhTw: '晃海功',
                nameEn: 'Swaying Sea',
                displayName: '晃海功',
                parentCode: null,
                groupZhTw: '晃海功',
                groupEn: 'Swaying Sea',
                groupDisplayName: '晃海功'
              }
            ],
            timezones: ['UTC', 'Asia/Taipei']
          });
        if (path.includes('/drafts?page='))
          return Response.json({
            page: 1,
            total: 1,
            limit: 20,
            rows: [
              {
                id,
                subject: 'rule',
                code: 'streak_3',
                year: null,
                name: 'Synthetic draft',
                revision: 1,
                state: 'draft'
              }
            ]
          });
        if (path.endsWith('/preview')) return Response.json(preview());
        if (init?.method === 'POST' || init?.method === 'PATCH') {
          if (typeof init.body !== 'string') throw Error('Missing synthetic JSON');
          const body = z.record(z.string(), z.unknown()).parse(JSON.parse(init.body));
          return Response.json({
            ...draft(),
            subject: body.subject,
            code: ['challenge', 'event'].includes(String(body.subject))
              ? body.code || String(body.subject) + '_' + 'a'.repeat(32)
              : body.code,
            year: body.year,
            config: body.config,
            baseConfig: ['challenge', 'event'].includes(String(body.subject))
              ? { definition: null, season: null }
              : draft().baseConfig,
            revision: typeof body.expectedRevision === 'number' ? body.expectedRevision + 1 : 1
          });
        }
        return Response.json(draft(path.endsWith(second) ? second : id));
      })
  );
  const confirm = vi.fn(() => true),
    window = {
      confirm,
      qigongJournalMayLeave: undefined as undefined | (() => boolean),
      qigongJournalLeaveCancelled: undefined as undefined | (() => void),
      addEventListener: (key: string, handler: Handler) => {
        events.set(key, handler);
      }
    };
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  for (const script of scripts)
    new vm.Script(script[1]!).runInNewContext({
      document: {
        cookie: '__Host-qigong-admin-csrf=synthetic-csrf',
        getElementById: get,
        querySelectorAll: () => [],
        createElement: element
      },
      window,
      fetch,
      URL,
      Date,
      AbortController,
      location: { href: 'https://example.invalid/admin/achievement-management', assign: vi.fn() },
      confirm,
      Intl
    });
  return { html, get, fetch, confirm, window, events };
};
const settle = async () => {
  for (let n = 0; n < 10; n++) await setImmediate();
};
const click = async (n: Element) => {
  await n.onclick?.({ preventDefault: vi.fn() });
  await settle();
};
const submit = async (f: ReturnType<typeof fixture>) => {
  await f.get('management-form').listeners.get('submit')?.({ preventDefault: vi.fn() });
  await settle();
};
const open = async (f: ReturnType<typeof fixture>) => {
  await settle();
  const button = f.get('management-list').children[0]?.children.find((n) => n.tagName === 'button');
  if (!button) throw Error('Missing synthetic draft');
  await click(button);
};
describe('Draft management genuine inline controller', () => {
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'shows an unchecked event streak option in %s without saving toggles or sending it on seasonal forms',
    async (locale) => {
      const f = fixture(locale);
      await settle();
      await click(f.get('management-new-activity'));
      expect(f.get('management-continuous-row').hidden).toBe(false);
      expect(f.get('management-continuous').checked).toBe(false);
      expect(f.get('management-start-mode-row').hidden).toBe(true);
      expect(f.get('management-method-match-row').hidden).toBe(true);
      const calls = f.fetch.mock.calls.length;
      f.get('management-continuous').checked = true;
      await f.get('management-continuous').onchange?.({ preventDefault: vi.fn() });
      expect(f.fetch).toHaveBeenCalledTimes(calls);
      expect(f.get('management-challenge-summary').textContent).toMatch(/連續|连续|Consecutive/);
      f.get('management-activity-code').value = 'seasonal_winter';
      await click(f.get('management-new-seasonal'));
      expect(f.get('management-continuous-row').hidden).toBe(true);
      for (const [key, value] of Object.entries({
        startDate: '2199-01-01',
        endDate: '2199-01-31',
        timezone: 'UTC',
        requiredDays: '7',
        reason: 'Synthetic seasonal draft'
      }))
        f.get('management-' + key).value = value;
      await submit(f);
      const call = f.fetch.mock.calls.find(([, init]) => init?.method === 'POST');
      if (typeof call?.[1]?.body !== 'string') throw Error('Missing seasonal save');
      const body = z
        .object({ subject: z.literal('activity'), config: z.record(z.string(), z.unknown()) })
        .parse(JSON.parse(call[1].body));
      expect(Object.hasOwn(body.config, 'continuous')).toBe(false);
    }
  );
  it('reads a legacy event without changing its config, defaults unchecked and clears the old preview immediately on a mode change', async () => {
    const f = fixture();
    await settle();
    const event = {
      ...draft(),
      subject: 'event',
      code: 'event_' + 'a'.repeat(32),
      baseConfig: { definition: null, season: null },
      config: {
        nameZhTw: 'Legacy activity',
        nameZhCn: '',
        nameEn: '',
        description: '',
        effectiveDate: '2199-01-01',
        startDate: '2199-01-01',
        endDate: '2199-01-31',
        timezone: 'UTC',
        requiredDays: 3
      },
      latestPreview: { ...preview(), subject: 'event' }
    };
    const bytes = JSON.stringify(event);
    f.fetch.mockResolvedValueOnce(Response.json(event));
    await open(f);
    expect(f.get('management-continuous').checked).toBe(false);
    expect(f.window.qigongJournalMayLeave?.()).toBe(true);
    expect(f.get('management-preview-result').textContent).toContain('Cumulative');
    const calls = f.fetch.mock.calls.length;
    f.get('management-continuous').checked = true;
    await f.get('management-continuous').onchange?.({ preventDefault: vi.fn() });
    expect(f.fetch).toHaveBeenCalledTimes(calls);
    expect(f.get('management-preview').disabled).toBe(true);
    expect(f.get('management-preview-result').textContent).not.toContain(
      'Existing awards preserved: 1'
    );
    f.confirm.mockReturnValue(false);
    expect(f.window.qigongJournalMayLeave?.()).toBe(false);
    expect(JSON.stringify(event)).toBe(bytes);
  });
  it('restores a saved consecutive event, saves an explicit false toggle with the expected revision and never changes its name automatically', async () => {
    const f = fixture();
    await settle();
    f.fetch.mockResolvedValueOnce(
      Response.json({
        ...draft(),
        subject: 'event',
        code: 'event_' + 'a'.repeat(32),
        baseConfig: { definition: null, season: null },
        config: {
          nameZhTw: 'Manual event name',
          nameZhCn: '',
          nameEn: '',
          description: '',
          effectiveDate: '2199-01-01',
          startDate: '2199-01-01',
          endDate: '2199-01-31',
          timezone: 'UTC',
          requiredDays: 3,
          continuous: true
        },
        latestPreview: { ...preview(), subject: 'event', continuous: true }
      })
    );
    await open(f);
    expect(f.get('management-continuous').checked).toBe(true);
    expect(f.get('management-preview-result').textContent).toContain('Consecutive');
    f.get('management-continuous').checked = false;
    await f.get('management-continuous').onchange?.({ preventDefault: vi.fn() });
    f.get('management-reason').value = 'Synthetic switch to cumulative';
    await submit(f);
    const call = f.fetch.mock.calls.find(([, init]) => init?.method === 'PATCH');
    if (typeof call?.[1]?.body !== 'string') throw Error('Missing event update');
    expect(JSON.parse(call[1].body)).toMatchObject({
      subject: 'event',
      code: 'event_' + 'a'.repeat(32),
      expectedRevision: 1,
      config: { nameZhTw: 'Manual event name', continuous: false }
    });
    expect(f.get('management-publish').disabled).toBe(true);
  });
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'renders literal metadata and disabled publication in %s',
    async (locale) => {
      const f = fixture(locale);
      await settle();
      expect(f.get('management-catalog').textContent).toContain('Literal <img src=x>😀');
      expect(f.get('management-publish').disabled).toBe(true);
      expect(f.get('management-publish').onclick).toBeUndefined();
      expect(f.html).not.toContain('localStorage');
      expect(f.html).not.toContain('sessionStorage');
      await open(f);
      expect(f.get('management-nameZhTw').value).toContain('<script>');
      expect(f.get('management-editor').hidden).toBe(false);
      expect(f.get('management-preview').disabled).toBe(false);
    }
  );
  it('adds an independent method-badge form with cumulative defaults and an explicit rule-effective start rather than all history', async () => {
    const f = fixture();
    await settle();
    await click(f.get('management-new-challenge'));
    expect(Number(f.get('management-threshold').value)).toBe(30);
    expect(f.get('management-continuous').checked).toBe(false);
    expect(f.get('management-start-mode').value).toBe('effective');
    expect(f.get('management-startDate').disabled).toBe(true);
    expect(f.get('management-start-row').hidden).toBe(true);
    expect(f.get('management-effectiveDate').required).toBe(true);
    expect(f.get('management-method-row').open).toBe(true);
    expect(f.get('management-publish').disabled).toBe(true);
    const group = f.get('management-methods').children.find((n) => n.tagName === 'details');
    if (!group) throw Error('Missing method group');
    expect(group.open).toBe(false);
  });
  it('checks canonical leaves, excludes the parent checkbox from payload and suggests the cumulative/consecutive badge name without overriding a manual name', async () => {
    const f = fixture();
    await settle();
    await click(f.get('management-new-challenge'));
    const group = f.get('management-methods').children.find((n) => n.tagName === 'details');
    if (!group) throw Error('Missing group');
    const parent = group.children[0]!.children[0]!;
    parent.checked = true;
    await parent.onchange?.({ preventDefault: vi.fn() });
    expect(f.get('management-nameZhTw').value).toBe('回春功30天');
    f.get('management-continuous').checked = true;
    await f.get('management-continuous').onchange?.({ preventDefault: vi.fn() });
    expect(f.get('management-nameZhTw').value).toBe('回春功連續30天');
    f.get('management-nameZhTw').value = 'Manual synthetic badge';
    f.get('management-continuous').checked = false;
    await f.get('management-continuous').onchange?.({ preventDefault: vi.fn() });
    expect(f.get('management-nameZhTw').value).toBe('Manual synthetic badge');
    f.get('management-effectiveDate').value = '2199-01-01';
    f.get('management-reason').value = 'Synthetic new badge';
    await submit(f);
    const call = f.fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    if (typeof call?.[1]?.body !== 'string') throw Error('Missing badge create');
    const body = z.record(z.string(), z.unknown()).parse(JSON.parse(call[1].body));
    expect(body).toMatchObject({
      subject: 'challenge',
      code: null,
      year: null,
      expectedRevision: 0,
      config: {
        threshold: 30,
        continuous: false,
        startMode: 'effective',
        startDate: null,
        methodCodes: ['huichun_chu', 'huichun_zhong'],
        methodMatch: 'any'
      }
    });
    expect(f.get('management-identity').textContent).toContain('challenge_');
  });
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'opens a completely blank independent activity after a seasonal editor in %s without changing that source',
    async (locale) => {
      const f = fixture(locale);
      await settle();
      f.get('management-activity-code').value = 'seasonal_winter';
      f.get('management-year').value = '2199';
      await click(f.get('management-new-seasonal'));
      expect(f.get('management-nameZhTw').value).toBe(definition.name_zh_tw);
      f.get('management-startDate').value = '2199-12-01';
      f.get('management-reason').value = 'Unsaved seasonal reason';
      const calls = f.fetch.mock.calls.length;
      await click(f.get('management-new-activity'));
      for (const key of [
        'nameZhTw',
        'nameZhCn',
        'nameEn',
        'description',
        'startDate',
        'endDate',
        'timezone',
        'requiredDays',
        'reason'
      ])
        expect(f.get('management-' + key).value).toBe('');
      expect(f.get('management-start-row').hidden).toBe(false);
      expect(f.get('management-method-row').hidden).toBe(true);
      expect(f.get('management-identity').textContent).not.toMatch(/seasonal_|2199/);
      expect(f.fetch).toHaveBeenCalledTimes(calls);
      expect(f.get('management-publish').disabled).toBe(true);
      await click(f.get('management-new-seasonal'));
      expect(f.get('management-nameZhTw').value).toBe(definition.name_zh_tw);
    }
  );
  it('saves a new independent activity with no seasonal identity and retains its server identity for edits', async () => {
    const f = fixture();
    await settle();
    await click(f.get('management-new-activity'));
    for (const [key, value] of Object.entries({
      nameZhTw: 'Independent event',
      startDate: '2199-02-01',
      endDate: '2199-02-28',
      timezone: 'UTC',
      requiredDays: '7',
      reason: 'Synthetic new activity'
    }))
      f.get('management-' + key).value = value;
    await submit(f);
    const create = f.fetch.mock.calls.find(([, init]) => init?.method === 'POST');
    if (typeof create?.[1]?.body !== 'string') throw Error('Missing event create');
    expect(JSON.parse(create[1].body)).toMatchObject({
      subject: 'event',
      code: null,
      year: null,
      expectedRevision: 0,
      config: {
        nameZhTw: 'Independent event',
        effectiveDate: '2199-02-01',
        startDate: '2199-02-01',
        endDate: '2199-02-28',
        timezone: 'UTC',
        requiredDays: 7
      }
    });
    f.get('management-nameZhTw').value = 'Edited independent event';
    f.get('management-reason').value = 'Synthetic edit';
    await submit(f);
    const update = f.fetch.mock.calls.find(([, init]) => init?.method === 'PATCH');
    if (typeof update?.[1]?.body !== 'string') throw Error('Missing event update');
    expect(JSON.parse(update[1].body)).toMatchObject({
      subject: 'event',
      code: 'event_' + 'a'.repeat(32),
      year: null,
      expectedRevision: 1
    });
  });
  it('makes explicit starts independent from the rule effective day and clears the explicit date when switching back to rule-effective mode', async () => {
    const f = fixture();
    await settle();
    await click(f.get('management-new-challenge'));
    f.get('management-effectiveDate').value = '2199-01-01';
    f.get('management-start-mode').value = 'date';
    await f.get('management-start-mode').onchange?.({ preventDefault: vi.fn() });
    expect(f.get('management-start-row').hidden).toBe(false);
    expect(f.get('management-startDate').required).toBe(true);
    f.get('management-startDate').value = '2199-02-01';
    f.get('management-start-mode').value = 'effective';
    await f.get('management-start-mode').onchange?.({ preventDefault: vi.fn() });
    expect(f.get('management-startDate').value).toBe('');
    expect(f.get('management-effectiveDate').value).toBe('2199-01-01');
  });
  it('does not send a new badge without selected leaves and never auto-saves a consecutive toggle', async () => {
    const f = fixture();
    await settle();
    await click(f.get('management-new-challenge'));
    f.get('management-effectiveDate').value = '2199-01-01';
    f.get('management-reason').value = 'Synthetic empty selection';
    const calls = f.fetch.mock.calls.length;
    f.get('management-continuous').checked = true;
    await f.get('management-continuous').onchange?.({ preventDefault: vi.fn() });
    await submit(f);
    expect(f.fetch).toHaveBeenCalledTimes(calls);
    expect(f.get('status').textContent).toContain('No leaf');
  });
  it('keeps reason-only changes under the existing unsaved-draft leave veto', async () => {
    const f = fixture();
    await open(f);
    f.get('management-reason').value = 'Synthetic reason';
    f.confirm.mockReturnValue(false);
    expect(f.window.qigongJournalMayLeave?.()).toBe(false);
    expect(f.get('management-nameZhTw').value).toContain('<script>');
    const preventDefault = vi.fn();
    f.events.get('beforeunload')?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    f.confirm.mockReturnValue(true);
    expect(f.window.qigongJournalMayLeave?.()).toBe(true);
  });
  it('does not save or preview as a side effect of editing fields or showing a tab', async () => {
    const f = fixture();
    await open(f);
    const calls = f.fetch.mock.calls.length;
    f.get('management-threshold').value = '7';
    f.get('management-form').listeners.get('input')?.({ preventDefault: vi.fn() });
    await click(f.get('management-tab-rules'));
    expect(f.fetch).toHaveBeenCalledTimes(calls);
    expect(f.get('management-preview').disabled).toBe(true);
    expect(f.get('management-publish').disabled).toBe(true);
  });
  it('sends only draft configuration/revision/reason with CSRF and resets dirty state after a successful save', async () => {
    const f = fixture();
    await open(f);
    f.get('management-nameZhTw').value = 'Edited literal 😀';
    f.get('management-reason').value = 'Synthetic edit';
    await submit(f);
    const call = f.fetch.mock.calls.find(([, init]) => init?.method === 'PATCH');
    if (typeof call?.[1]?.body !== 'string') throw Error('Missing PATCH');
    const body = z.record(z.string(), z.unknown()).parse(JSON.parse(call[1].body));
    expect(body).toMatchObject({
      subject: 'rule',
      code: 'streak_3',
      year: null,
      expectedRevision: 1,
      reason: 'Synthetic edit'
    });
    expect(body.publish).toBeUndefined();
    expect(new Headers(call[1].headers).get('x-csrf-token')).toBe('synthetic-csrf');
    expect(f.window.qigongJournalMayLeave?.()).toBe(true);
    expect(f.get('management-reason').value).toBe('');
  });
  it('does not confuse a prior activity year with the null year of an opened rule draft', async () => {
    const f = fixture();
    await settle();
    f.get('management-year').value = '2199';
    await click(f.get('management-new-seasonal'));
    await open(f);
    f.get('management-reason').value = 'Synthetic rule edit';
    await submit(f);
    const call = f.fetch.mock.calls.find(([, init]) => init?.method === 'PATCH');
    if (typeof call?.[1]?.body !== 'string') throw Error('Missing rule patch');
    expect(z.record(z.string(), z.unknown()).parse(JSON.parse(call[1].body)).year).toBeNull();
  });
  it('shows an aggregate-only preview and never enables publication or downloads a file', async () => {
    const f = fixture();
    await open(f);
    await click(f.get('management-preview'));
    expect(f.get('management-preview-result').textContent).toContain(
      'Existing awards preserved: 1'
    );
    expect(f.get('management-preview-result').textContent).toContain('Awards to revoke: 0');
    expect(f.get('management-publish').disabled).toBe(true);
    expect(
      f.fetch.mock.calls.some(([input]) => /publish|activate|recalculate|export/.test(url(input)))
    ).toBe(false);
  });
  it('clears all protected fields and cancels pending views after authorization denial', async () => {
    const f = fixture();
    await open(f);
    f.get('management-nameZhTw').value = 'Synthetic private config';
    f.get('management-reason').value = 'Synthetic edit';
    f.fetch.mockResolvedValueOnce(Response.json({ error: 'denied' }, { status: 403 }));
    await submit(f);
    expect(f.get('management-editor').hidden).toBe(true);
    expect(f.get('management-nameZhTw').value).toBe('');
    expect(f.get('management-list').textContent).toBe('');
    expect(f.get('management-preview-result').textContent).toBe('');
    expect(f.window.qigongJournalMayLeave?.()).toBe(true);
  });
  it('retains edits after a version conflict without an automatic retry or silent rebase', async () => {
    const f = fixture();
    await open(f);
    f.get('management-description').value = 'Keep synthetic edit';
    f.get('management-reason').value = 'Synthetic reason';
    const calls = f.fetch.mock.calls.length;
    f.fetch.mockResolvedValueOnce(Response.json({ error: 'conflict' }, { status: 409 }));
    await submit(f);
    expect(f.get('management-description').value).toBe('Keep synthetic edit');
    expect(f.get('management-reason').value).toBe('Synthetic reason');
    expect(f.fetch).toHaveBeenCalledTimes(calls + 1);
    expect(f.get('status').textContent).toContain('changed');
  });
  it('keeps started activities and archived drafts non-editable while the publication button stays disabled', async () => {
    const f = fixture();
    await settle();
    f.fetch.mockResolvedValueOnce(Response.json({ ...draft(), locked: true }));
    const button = f
      .get('management-list')
      .children[0]!.children.find((n) => n.tagName === 'button')!;
    await click(button);
    expect(f.get('management-fields').disabled).toBe(true);
    expect(f.get('management-save').disabled).toBe(true);
    expect(f.get('management-warning').textContent).toContain('started');
    expect(f.get('management-publish').disabled).toBe(true);
  });
});
