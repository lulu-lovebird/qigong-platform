/** Executes the exact browser controller; this is not a physical-browser acceptance test. */
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  renderVenuePeoplePage,
  venuePeopleContentSecurityPolicy,
  venuePeoplePageScript
} from '../src/venue-people-page.js';

type Event = { preventDefault(): void };
class Element {
  value = '';
  textContent = '';
  disabled = false;
  scope = '';
  type = '';
  href = '';
  download = '';
  children: Element[] = [];
  listeners = new Map<string, Array<(event: Event) => void>>();
  constructor(readonly tagName = 'div') {}
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren() {
    this.children = [];
    this.textContent = '';
  }
  addEventListener(name: string, fn: (event: Event) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  emit(name: string) {
    for (const fn of this.listeners.get(name) ?? []) fn({ preventDefault() {} });
  }
  click() {
    this.emit('click');
  }
  set innerHTML(_value: string) {
    throw new Error('unsafe HTML');
  }
}
const nodes = (element: Element): Element[] => [element, ...element.children.flatMap(nodes)];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const personId = '20000000-0000-4000-8000-000000000001';
const result = (patch = {}) => ({
  mode: 'people',
  total: 21,
  totals: { attendanceCount: 30, attendanceDays: 10, learnerCount: 21 },
  rows: [
    {
      personId,
      name: '<img src=x onerror=alert(1)>',
      attendanceCount: 3,
      attendanceDays: 2,
      latestDate: '2026-10-02'
    }
  ],
  ...patch
});
const harness = () => {
  const elements = new Map<string, Element>();
  for (const match of renderVenuePeoplePage().matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const element = new Element(match[1]);
    element.disabled = /\bdisabled\b/.test(match[2]!);
    elements.set(match[3]!, element);
  }
  const get = (id: string) => elements.get(id)!;
  get('region').value = '01000000-0000-4000-8000-000000000003';
  get('month').value = '2026-10';
  get('sort').value = 'recent';
  get('direction').value = 'desc';
  get('limit').value = '20';
  const document = {
    cookie: '__Host-qigong-admin-csrf=' + 'c'.repeat(43),
    getElementById: get,
    querySelectorAll: () => [...elements.values()].flatMap(nodes),
    createElement: (tag: string) => new Element(tag)
  };
  const fetch = vi.fn(async (path: string, options: { body: string }) => {
    expect(path).toMatch(/^\/admin\/venue-people\/api\/(read|export)$/);
    expect(options.body).toBeTypeOf('string');
    return {
      ok: true,
      status: 200,
      json: async () => result(),
      blob: async () => new Blob(['csv'])
    };
  });
  const revokeObjectURL = vi.fn(),
    createObjectURL = vi.fn(() => 'blob:synthetic');
  const capabilities = vi.fn(async (path: string, options: { body: string }) => {
    expect(path).toBe('/admin/api/venue-suite/capabilities');
    expect(JSON.parse(options.body)).toEqual({ regionId: get('region').value.trim() });
    return {
      ok: true,
      status: 200,
      json: async () => ({ canReadPeople: true, canExportPeople: true })
    };
  });
  const authorize = async () => {
    get('verify').click();
    await flush();
  };
  runInNewContext(venuePeoplePageScript, {
    document,
    fetch: (path: string, options: { body: string }) =>
      path === '/admin/api/venue-suite/capabilities'
        ? capabilities(path, options)
        : fetch(path, options),
    URL: { createObjectURL, revokeObjectURL },
    setTimeout: (fn: () => void) => fn()
  });
  return {
    get,
    document,
    fetch,
    capabilities,
    authorize,
    createObjectURL,
    revokeObjectURL,
    submit: async () => {
      if (get('read').disabled) await authorize();
      get('filters').emit('submit');
      await flush();
    }
  };
};

describe('venue people real browser controller in minimal DOM', () => {
  it('has exact CSP script/style hashes, footer, accessible controls and no hidden PII', () => {
    const html = renderVenuePeoplePage();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    expect(script).toBe(venuePeoplePageScript);
    for (const bytes of [script, style])
      expect(venuePeopleContentSecurityPolicy).toContain(
        "'sha256-" + createHash('sha256').update(bytes!).digest('base64') + "'"
      );
    expect(venuePeopleContentSecurityPolicy).not.toContain('unsafe-inline');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('尚未查詢');
    expect(html).toContain('Bean, Bird &amp; Badminton Tech Consulting');
    expect(html).not.toContain('type="tel"');
    expect(html).not.toContain('localStorage');
  });
  it('does not fake a success or auto-query; submits same-origin POST with live CSRF and renders text, full totals', async () => {
    const h = harness();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.get('previous').disabled).toBe(true);
    await h.submit();
    expect(h.fetch).toHaveBeenCalledWith(
      '/admin/venue-people/api/read',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: expect.objectContaining({ 'x-csrf-token': 'c'.repeat(43) })
      })
    );
    expect(h.get('summary').textContent).toContain('出席 30 次');
    expect(h.get('summary').textContent).toContain('21 人');
    expect(
      nodes(h.get('records')).some((n) => n.textContent === '<img src=x onerror=alert(1)>')
    ).toBe(true);
    expect(nodes(h.get('records')).some((n) => n.tagName === 'img')).toBe(false);
    expect(h.get('next').disabled).toBe(false);
    expect(JSON.parse(h.fetch.mock.calls[0]![1].body)).toMatchObject({
      period: { month: '2026-10' },
      mode: 'people',
      page: 1
    });
  });
  it('follows next/previous pages, same-scope selected-person detail and back to list', async () => {
    const h = harness();
    await h.submit();
    h.get('next').click();
    await flush();
    expect(JSON.parse(h.fetch.mock.calls[1]![1].body).page).toBe(2);
    h.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        result({
          mode: 'detail',
          total: 1,
          rows: [
            {
              personId,
              date: '2026-10-01',
              name: 'Synthetic',
              fieldName: 'Venue',
              fieldCode: 'vp-test',
              timezone: 'Asia/Taipei',
              checkedInAt: '2026-09-30T16:00:00Z',
              method: 'qr_gps'
            }
          ]
        }),
      blob: async () => new Blob()
    });
    nodes(h.get('records'))
      .find((n) => n.tagName === 'button')!
      .click();
    await flush();
    const detail = JSON.parse(h.fetch.mock.calls[2]![1].body) as Record<string, unknown>;
    expect(detail).toMatchObject({
      personId,
      mode: 'detail',
      page: 1,
      regionId: h.get('region').value,
      period: { month: '2026-10' }
    });
    expect(h.get('back').disabled).toBe(false);
    expect(h.get('status').textContent).toBe('查詢完成。');
    h.get('back').click();
    await flush();
    expect(JSON.parse(h.fetch.mock.calls[3]![1].body)).toMatchObject({
      mode: 'people',
      personId: null,
      page: 2
    });
    h.get('previous').click();
    await flush();
    expect(JSON.parse(h.fetch.mock.calls[4]![1].body).page).toBe(1);
  });
  it('exports independently without first acquiring view, applies date overrides, and releases blob URL', async () => {
    const h = harness();
    h.get('from').value = '2026-10-01';
    h.get('until').value = '2026-10-02';
    h.get('search').value = ' Synthetic ';
    await h.authorize();
    h.get('export').click();
    await flush();
    expect(h.fetch.mock.calls[0]![0]).toBe('/admin/venue-people/api/export');
    expect(JSON.parse(h.fetch.mock.calls[0]![1].body)).toMatchObject({
      period: { from: '2026-10-01', until: '2026-10-02' },
      search: 'Synthetic'
    });
    expect(h.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
    expect(h.get('status').textContent).toContain('CSV 已產生');
  });
  it.each([401, 403, 413, 503])(
    'clears stale sensitive rows on failure %s, never fake-empty success',
    async (status) => {
      const h = harness();
      await h.submit();
      h.fetch.mockResolvedValueOnce({
        ok: false,
        status,
        json: async () => result(),
        blob: async () => new Blob()
      });
      await h.submit();
      expect(h.get('records').children).toEqual([]);
      expect(h.get('summary').textContent).toBe('');
      expect(h.get('status').textContent).not.toContain('查無符合篩選');
      expect(h.get('status').textContent).not.toBe('查詢完成。');
      expect(h.get('next').disabled).toBe(true);
      if (status === 413) expect(h.get('status').textContent).toContain('1000');
    }
  );
  it('rejects ambiguous/missing CSRF, half-filled range, invalid response and transport failure', async () => {
    const h = harness();
    h.document.cookie = '';
    await h.submit();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.get('status').textContent).toContain('失敗');
    h.document.cookie =
      '__Host-qigong-admin-csrf=' + 'c'.repeat(43) + '; __Host-qigong-admin-csrf=' + 'c'.repeat(43);
    await h.submit();
    expect(h.fetch).not.toHaveBeenCalled();
    h.document.cookie = '__Host-qigong-admin-csrf=' + 'c'.repeat(43);
    h.get('from').value = '2026-10-01';
    await h.submit();
    expect(h.fetch).not.toHaveBeenCalled();
    h.get('from').value = '';
    h.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => result({ totals: null }),
      blob: async () => new Blob()
    });
    await h.submit();
    expect(h.get('records').children).toEqual([]);
    expect(h.get('status').textContent).toContain('回應無效');
    h.fetch.mockRejectedValueOnce(new Error('network'));
    await h.submit();
    expect(h.get('status').textContent).toContain('並非查無資料');
  });
  it('requires scoped capabilities and never turns manual writing on', async () => {
    const h = harness();
    expect(h.get('read').disabled).toBe(true);
    expect(h.get('export').disabled).toBe(true);
    h.get('filters').emit('submit');
    h.get('export').click();
    expect(h.fetch).not.toHaveBeenCalled();
    h.capabilities.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ canReadPeople: false, canExportPeople: true })
    });
    await h.authorize();
    expect(h.capabilities).toHaveBeenCalledWith(
      '/admin/api/venue-suite/capabilities',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'x-csrf-token': 'c'.repeat(43) }),
        body: JSON.stringify({ regionId: h.get('region').value })
      })
    );
    expect(h.get('read').disabled).toBe(true);
    expect(h.get('export').disabled).toBe(false);
    expect(h.get('permissions').textContent).toContain('無讀取權限');
    h.get('export').click();
    await flush();
    expect(h.fetch.mock.calls[0]?.[0]).toBe('/admin/venue-people/api/export');
    expect(h.get('manual-add').disabled).toBe(true);
    expect(h.get('manual-void').disabled).toBe(true);
    h.capabilities.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ canReadPeople: false, canExportPeople: false })
    });
    await h.authorize();
    expect(h.get('read').disabled).toBe(true);
    expect(h.get('export').disabled).toBe(true);
    expect(h.get('status').textContent).toContain('未授權');
    h.capabilities.mockRejectedValueOnce(new Error('private diagnostics'));
    await h.authorize();
    expect(h.get('status').textContent).toContain('驗證失敗');
    expect(h.get('status').textContent).not.toContain('private');
  });
  it('clears stale records on filter edits and requires fresh capabilities when region changes', async () => {
    const h = harness();
    await h.submit();
    expect(h.get('records').children.length).toBeGreaterThan(0);
    h.get('search').value = 'Another';
    h.get('filters').emit('input');
    expect(h.get('records').children).toEqual([]);
    expect(h.get('next').disabled).toBe(true);
    expect(h.get('read').disabled).toBe(false);
    h.get('region').value = '01000000-0000-4000-8000-000000000004';
    h.get('filters').emit('input');
    expect(h.get('read').disabled).toBe(true);
    expect(h.get('export').disabled).toBe(true);
    expect(h.get('permissions').textContent).toContain('區域已變更');
    h.get('filters').emit('submit');
    h.get('export').click();
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it('retains the displayed page on CSV success, and retries failed reads without false empty state', async () => {
    const h = harness();
    await h.submit();
    h.get('next').click();
    await flush();
    const pagination = h.get('pagination').textContent;
    h.get('export').click();
    await flush();
    expect(h.get('pagination').textContent).toBe(pagination);
    expect(h.get('records').children.length).toBeGreaterThan(0);
    h.fetch.mockRejectedValueOnce(new Error('network'));
    h.get('retry').click();
    await flush();
    expect(h.get('records').children).toEqual([]);
    expect(h.get('retry').disabled).toBe(false);
    expect(h.get('status').textContent).toContain('並非查無資料');
    h.get('retry').click();
    await flush();
    expect(JSON.parse(h.fetch.mock.calls.at(-1)![1].body)).toMatchObject({
      page: 2,
      mode: 'people'
    });
    expect(h.get('status').textContent).toBe('查詢完成。');
  });
  it('prevents duplicate requests while pending, then resumes controls', async () => {
    const h = harness();
    await h.authorize();
    let resolve: ((value: Awaited<ReturnType<typeof h.fetch>>) => void) | undefined;
    h.fetch.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    h.get('filters').emit('submit');
    h.get('filters').emit('submit');
    h.get('export').click();
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.get('read').disabled).toBe(true);
    resolve!({ ok: true, status: 200, json: async () => result(), blob: async () => new Blob() });
    await flush();
    expect(h.get('read').disabled).toBe(false);
  });
});
