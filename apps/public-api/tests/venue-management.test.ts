/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { runInNewContext } from 'node:vm';
import Fastify from 'fastify';
import type { Pool } from '@qigong/database';
import { describe, expect, it, vi } from 'vitest';
import { renderVenueManagementPage } from '../src/venue-management-page.js';
import { registerAdminRoutes } from '../src/admin-auth.js';
import {
  registerVenueManagementRoutes,
  venueManagementError
} from '../src/venue-management-routes.js';
import {
  trustedVenueOrigin,
  venueManagementFieldSchema,
  venueManagementOperationSchema,
  venueManagementUrls
} from '../src/venue-management.js';
const id = '10000000-0000-4000-8000-000000000001';
const origin = 'https://venue.example.invalid';
const field = {
  region_id: id,
  code: 'tw-test-one',
  name_zh_tw: '</script><img src=x onerror=alert(1)>',
  name_en: null,
  address: 'Synthetic address',
  latitude: 25,
  longitude: 121,
  radius_meters: 100,
  timezone: 'Asia/Taipei',
  active_time_rules: { day_of_week: [0, 6], start_time: '06:30', end_time: '09:00' },
  is_active: true
};
const row = {
  ...field,
  id,
  version: 3,
  created_at: '',
  updated_at: '',
  urls: venueManagementUrls(field.code, origin)
};

describe('venue management boundaries', () => {
  it('fixed canonical URLs, strict origin and stable code, no remote QR', () => {
    expect(venueManagementUrls('tw-test-one', origin)).toEqual({
      nfc: origin + '/venue-checkin?venue=tw-test-one&source=nfc',
      qr: origin + '/venue-checkin?venue=tw-test-one&source=qr',
      link: origin + '/venue-checkin?venue=tw-test-one&source=link'
    });
    for (const bad of [
      'http://host.invalid',
      'https://host.invalid/',
      'https://user:pass@host.invalid',
      'https://host.invalid/path',
      'https://host.invalid?next=evil',
      '//evil.invalid'
    ])
      expect(() => trustedVenueOrigin(bad)).toThrow();
    expect(() => venueManagementUrls('tw-one&redirect=https://evil.invalid', origin)).toThrow();
  });
  it('strict payloads reject self-filled identity, missing audit/version, invalid schedules', () => {
    expect(venueManagementFieldSchema.parse(field)).toEqual(field);
    for (const change of [
      { principal: id },
      { version: 0 },
      { code: 'reusable' },
      { latitude: 91 },
      { radius_meters: 0 },
      { address: 'a\nb' },
      { active_time_rules: { day_of_week: [0, 0], start_time: '06:00', end_time: '07:00' } },
      { active_time_rules: { day_of_week: [0], start_time: '09:00', end_time: '06:00' } }
    ])
      expect(venueManagementFieldSchema.safeParse({ ...field, ...change }).success).toBe(false);
    expect(
      venueManagementOperationSchema.safeParse({
        action: 'update',
        regionId: id,
        id,
        field,
        reason: 'why'
      }).success
    ).toBe(false);
    expect(
      venueManagementOperationSchema.safeParse({
        action: 'create',
        regionId: id,
        field,
        reason: ''
      }).success
    ).toBe(false);
  });
  it('maps SQL conflicts and hides unexpected details', () => {
    expect(venueManagementError({ code: '23505' })).toEqual({
      status: 409,
      error: 'venue_code_reserved'
    });
    expect(venueManagementError({ code: '40001' })).toEqual({
      status: 409,
      error: 'venue_conflict_reload'
    });
    expect(venueManagementError(new Error('private database internals'))).toEqual({
      status: 503,
      error: 'venue_management_unavailable'
    });
  });
  it('default off has no routes; CSRF/origin checked before database; backend failure is truthful', async () => {
    const connect = vi.fn(async () => {
      throw new Error('database private detail');
    });
    const pool = { connect } as unknown as Pool;
    const options = {
      publicOrigin: origin,
      sessionFor: () => 'm'.repeat(43),
      validCsrf: () => true,
      principalFor: async () => id
    };
    const disabled = Fastify();
    registerVenueManagementRoutes(disabled, pool, options);
    expect(
      (
        await disabled.inject({
          method: 'POST',
          url: '/admin/api/venue-management/list',
          payload: { regionId: id }
        })
      ).statusCode
    ).toBe(404);
    await disabled.close();
    const app = Fastify({ genReqId: () => id });
    registerVenueManagementRoutes(app, pool, { ...options, enabled: true });
    for (const headers of [{}, { origin: 'https://evil.invalid' }])
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/admin/api/venue-management/list',
            headers,
            payload: { regionId: id }
          })
        ).statusCode
      ).toBe(403);
    expect(connect).not.toHaveBeenCalled();
    const unavailable = await app.inject({
      method: 'POST',
      url: '/admin/api/venue-management/list',
      headers: { origin },
      payload: { regionId: id }
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({ error: 'venue_management_unavailable' });
    expect(unavailable.headers['cache-control']).toBe('no-store');
    const invalid = await app.inject({
      method: 'POST',
      url: '/admin/api/venue-management/list',
      headers: { origin },
      payload: { regionId: id, principal: id }
    });
    expect(invalid.statusCode).toBe(400);
    const page = await app.inject('/admin/venue-management');
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-security-policy']).toContain("connect-src 'self'");
    await app.close();
  });
});

type Listener = (event: { preventDefault(): void }) => unknown;
class Element {
  children: Element[] = [];
  value = '';
  checked = false;
  disabled = false;
  readOnly = false;
  type = '';
  hidden = false;
  complete = false;
  naturalWidth = 0;
  width = 0;
  height = 0;
  href = '';
  download = '';
  imageMode: 'auto' | 'manual' | 'error' = 'auto';
  decode = vi.fn(async () => {});
  click = vi.fn();
  remove = vi.fn();
  private source = '';
  set src(value: string) {
    this.source = value;
    if (this.imageMode === 'manual') return;
    setImmediate(() => {
      this.complete = this.imageMode === 'auto';
      this.naturalWidth = this.complete ? 768 : 0;
      void this.event(this.complete ? 'load' : 'error');
    });
  }
  get src() {
    return this.source;
  }
  listeners = new Map<string, Listener[]>();
  private text = '';
  constructor(readonly tag = 'div') {}
  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  get childNodes() {
    return this.children;
  }
  set innerHTML(_value: string) {
    throw new Error('unsafe HTML');
  }
  append(...children: Element[]) {
    this.children.push(...children);
  }
  replaceChildren(...children: Element[]) {
    this.text = '';
    this.children = children;
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  async event(type: string) {
    await new Promise<void>((r) => setImmediate(r));
    for (const fn of this.listeners.get(type) ?? []) await fn({ preventDefault() {} });
    for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
  }
  focus() {}
  select() {}
}
const all = (e: Element): Element[] => [e, ...e.children.flatMap(all)];
const region = {
  id,
  displayName: '<Synthetic region>',
  countryName: 'Synthetic country',
  code: 'synthetic-one',
  canRead: true,
  canManage: true
};
const secondRegion = {
  ...region,
  id: '20000000-0000-4000-8000-000000000001',
  code: 'synthetic-two'
};
interface BrowserOptions {
  html?: string;
  regions?: (typeof region)[];
  listStatus?: number;
  imageMode?: 'auto' | 'manual' | 'error';
  imageDecode?: () => Promise<void>;
  http?: (
    path: string,
    init: RequestInit
  ) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
}
const fakePng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=';
const qrResponse = (venue = row) => ({
  field: venue,
  target: venue.urls.qr,
  pngDataUrl: fakePng,
  filename: 'venue-' + venue.code + '-qr.png'
});
function browser(
  status = 200,
  manage = true,
  failedSaveStatus?: number,
  clipboardAvailable = true,
  confirmDisable = true,
  options: BrowserOptions = {}
) {
  const html = options.html ?? renderVenueManagementPage();
  const elements = new Map<string, Element>();
  for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const e = new Element(match[1]);
    e.disabled = /\bdisabled\b/.test(match[2]!);
    elements.set(match[3]!, e);
  }
  const created: Element[] = [];
  const calls: { action: string; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (path: string, init: RequestInit) => {
    const action = path.split('/').at(-1)!;
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<
      string,
      unknown
    >;
    calls.push({ action, body });
    if (options.http) return options.http(path, init);
    const responseStatus = ['create', 'update'].includes(action)
      ? (failedSaveStatus ?? status)
      : action === 'list'
        ? (options.listStatus ?? status)
        : status;
    return {
      ok: responseStatus === 200,
      status: responseStatus,
      json: async () =>
        action === 'regions'
          ? { regions: options.regions ?? [{ ...region, canManage: manage }] }
          : action === 'list'
            ? { fields: [row] }
            : action === 'qr'
              ? qrResponse()
              : { field: { ...row, version: 4 } }
    };
  });
  const copy = vi.fn(async (value: string) => {
    expect(typeof value).toBe('string');
  });
  const print = vi.fn();
  const confirm = vi.fn(() => confirmDisable);
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1]!;
  runInNewContext(script, {
    document: {
      getElementById: (id: string) => elements.get(id),
      createElement: (tag: string) => {
        const element = new Element(tag);
        element.imageMode = options.imageMode ?? 'auto';
        if (options.imageDecode) element.decode = vi.fn(options.imageDecode);
        created.push(element);
        return element;
      },
      cookie: '__Host-qigong-admin-csrf=' + 'c'.repeat(43)
    },
    navigator: clipboardAvailable ? { clipboard: { writeText: copy } } : {},
    window: { print, confirm },
    fetch,
    Error
  });
  const get = (id: string) => {
    const e = elements.get(id);
    if (!e) throw new Error('missing ' + id);
    return e;
  };
  const ready = (async () => {
    for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
  })();
  return { html, get, calls, copy, print, confirm, ready, transport: fetch, created };
}
async function openSaved(b: ReturnType<typeof browser>) {
  await b.ready;
  await b.get('vm-load').event('click');
  await all(b.get('vm-list'))
    .find((e) => e.tag === 'button')!
    .event('click');
}
describe('venue management browser controller (in-memory transport, not DB evidence)', () => {
  it('requires an actual loaded and decoded image, even for readonly preview/download/print', async () => {
    let decoded: (() => void) | undefined;
    const b = browser(200, false, undefined, true, true, {
      imageMode: 'manual',
      imageDecode: () =>
        new Promise<void>((resolve) => {
          decoded = resolve;
        })
    });
    await openSaved(b);
    expect(b.calls.map((c) => c.action)).toEqual(['regions', 'list']);
    expect(b.get('vm-qr').disabled).toBe(false);
    await b.get('vm-qr').event('click');
    expect(b.calls.at(-1)).toEqual({ action: 'qr', body: { regionId: id, id } });
    const image = b.created.find((e) => e.tag === 'img')!;
    expect(image.src).toBe(fakePng);
    for (const control of ['vm-print', 'vm-download']) expect(b.get(control).disabled).toBe(true);
    await b.get('vm-print').event('click');
    await b.get('vm-download').event('click');
    expect(b.print).not.toHaveBeenCalled();
    expect(b.created.some((e) => e.tag === 'a')).toBe(false);
    image.complete = true;
    image.naturalWidth = 768;
    await image.event('load');
    expect(image.decode).toHaveBeenCalledOnce();
    expect(b.get('vm-print').disabled).toBe(true);
    decoded!();
    await b.get('vm-print').event('click');
    expect(b.print).toHaveBeenCalledOnce();
    expect(b.get('vm-save').disabled).toBe(true);
    await b.get('vm-download').event('click');
    const download = b.created.find((e) => e.tag === 'a')!;
    expect(download.href).toBe(fakePng);
    expect(download.download).toBe('venue-tw-test-one-qr.png');
    expect(download.click).toHaveBeenCalledOnce();
    expect(download.remove).toHaveBeenCalledOnce();
    expect(b.html).toContain('@page{size:A4 portrait;margin:12mm}');
    expect(b.html).not.toContain('visibility:hidden');
    expect(b.get('vm-sign').textContent).toContain(
      'Developed with ❤️ by Bean, Bird & Badminton Tech Consulting'
    );
  });
  it.each(['load', 'decode'])(
    'image %s failure never enables print/download or claims readiness',
    async (failure) => {
      const b = browser(
        200,
        true,
        undefined,
        true,
        true,
        failure === 'load'
          ? { imageMode: 'error' }
          : {
              imageDecode: async () => {
                throw new Error('decode rejected');
              }
            }
      );
      await openSaved(b);
      await b.get('vm-qr').event('click');
      expect(b.get('vm-print').disabled).toBe(true);
      expect(b.get('vm-download').disabled).toBe(true);
      expect(b.get('vm-sign').hidden).toBe(true);
      expect(b.get('vm-qr-status').textContent).toContain('QR 未就緒');
      expect(b.get('vm-qr-status').textContent).not.toContain('可下載 PNG');
    }
  );
  it.each([
    { target: 'https://evil.invalid' },
    { filename: '../evil.png' },
    { pngDataUrl: 'data:image/svg+xml;base64,AAAA' },
    { pngDataUrl: 'data:image/png;base64,<script>' },
    { pngDataUrl: 'data:image/png;base64,' + 'A'.repeat(200000) },
    { field: { ...row, version: 4 } },
    { field: { ...row, region_id: secondRegion.id } },
    { field: { ...row, code: 'tw-different-code' } },
    { field: { ...row, urls: { ...row.urls, qr: 'https://evil.invalid' } } },
    { field: null }
  ])('rejects mismatched/unsafe response before DOM image use: %j', async (change) => {
    const b = browser();
    await openSaved(b);
    b.transport.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...qrResponse(), ...change })
    });
    await b.get('vm-qr').event('click');
    expect(b.created.some((e) => e.tag === 'img')).toBe(false);
    expect(b.get('vm-print').disabled).toBe(true);
    expect(b.get('vm-download').disabled).toBe(true);
    expect(b.get('vm-qr-status').textContent).toContain('QR 未就緒');
  });
  it('discards stale server and image/decode results across selections without wrong names or URLs', async () => {
    const second = {
      ...row,
      id: secondRegion.id,
      code: 'tw-second-park',
      name_zh_tw: 'Second synthetic park',
      urls: venueManagementUrls('tw-second-park', origin)
    };
    const b = browser(200, true, undefined, true, true, { imageMode: 'manual' });
    await b.ready;
    b.transport.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ fields: [row, second] })
    });
    await b.get('vm-load').event('click');
    const buttons = all(b.get('vm-list')).filter((e) => e.tag === 'button');
    await buttons[0]!.event('click');
    let respond: ((value: Awaited<ReturnType<typeof b.transport>>) => void) | undefined;
    b.transport.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        })
    );
    await b.get('vm-qr').event('click');
    await buttons[1]!.event('click');
    respond!({ ok: true, status: 200, json: async () => qrResponse() });
    await b.get('vm-print').event('click');
    expect(b.created.some((e) => e.tag === 'img')).toBe(false);
    expect(b.get('vm-sign').textContent).toBe('');
    b.transport.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => qrResponse(second)
    });
    await b.get('vm-qr').event('click');
    const image = b.created.find((e) => e.tag === 'img')!;
    await buttons[0]!.event('click');
    image.complete = true;
    image.naturalWidth = 768;
    await image.event('load');
    expect(b.get('vm-sign').textContent).toBe('');
    expect(b.get('vm-print').disabled).toBe(true);
    expect(b.print).not.toHaveBeenCalled();
  });
  it.each([
    ['vm-search', 'input'],
    ['vm-filter', 'change'],
    ['vm-load', 'click'],
    ['vm-add', 'click'],
    ['vm-form', 'submit'],
    ['vm-regions-retry', 'click'],
    ['vm-region', 'change']
  ])('clears loaded QR on %s %s', async (control, event) => {
    const b = browser();
    await openSaved(b);
    await b.get('vm-qr').event('click');
    expect(b.get('vm-print').disabled).toBe(false);
    await b.get(control).event(event);
    expect(b.get('vm-print').disabled).toBe(true);
    expect(b.get('vm-download').disabled).toBe(true);
    expect(b.get('vm-sign').textContent).toBe('');
    expect(b.get('vm-sign').hidden).toBe(true);
  });
  it.each([
    [401, '登入失效'],
    [403, '區域、管理權限或 CSRF 驗證失敗'],
    [404, '場地／後端尚未提供'],
    [503, '場地後端尚未設定或暫時無法使用']
  ] as const)(
    'QR HTTP %s failure clears prior image and never permits stale print',
    async (status, message) => {
      const b = browser();
      await openSaved(b);
      await b.get('vm-qr').event('click');
      expect(b.get('vm-print').disabled).toBe(false);
      b.transport.mockResolvedValueOnce({
        ok: false,
        status,
        json: async () => ({ error: 'unavailable' })
      });
      await b.get('vm-qr').event('click');
      expect(b.get('vm-sign').textContent).toBe('');
      expect(b.get('vm-print').disabled).toBe(true);
      await b.get('vm-print').event('click');
      expect(b.print).not.toHaveBeenCalled();
      expect(b.get('vm-qr-status').textContent).toContain('QR 未就緒');
      expect(b.get('vm-qr-status').textContent).toContain(message);
      if (status === 401) expect(b.get('vm-qr').disabled).toBe(true);
    }
  );
  it('ignores a stale scoped HTTP failure without resetting a newer loaded QR', async () => {
    const second = {
      ...row,
      id: secondRegion.id,
      code: 'tw-second-park',
      name_zh_tw: 'Second synthetic park',
      urls: venueManagementUrls('tw-second-park', origin)
    };
    const b = browser();
    await b.ready;
    b.transport.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ fields: [row, second] })
    });
    await b.get('vm-load').event('click');
    const buttons = all(b.get('vm-list')).filter((e) => e.tag === 'button');
    await buttons[0]!.event('click');
    let respond: ((value: Awaited<ReturnType<typeof b.transport>>) => void) | undefined;
    b.transport.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        })
    );
    await b.get('vm-qr').event('click');
    await buttons[1]!.event('click');
    b.transport.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => qrResponse(second)
    });
    await b.get('vm-qr').event('click');
    expect(b.get('vm-print').disabled).toBe(false);
    respond!({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) });
    await b.get('vm-print').event('click');
    expect(b.get('vm-sign').textContent).toContain(second.name_zh_tw);
    expect(b.get('vm-sign').textContent).toContain(second.urls.qr);
    expect(b.get('vm-print').disabled).toBe(false);
    expect(b.get('vm-download').disabled).toBe(false);
    expect(b.print).toHaveBeenCalledOnce();
  });
  it('prints only saved metadata despite edited drafts, with early30, disabled notice, previous-day wrap and 24:00', async () => {
    const saved = {
      ...row,
      is_active: false,
      timezone: 'America/New_York',
      radius_meters: 200,
      active_time_rules: { day_of_week: [0, 6], start_time: '00:15', end_time: '24:00' }
    };
    const b = browser();
    await b.ready;
    b.transport.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ fields: [saved] })
    });
    await b.get('vm-load').event('click');
    await all(b.get('vm-list'))
      .find((e) => e.tag === 'button')!
      .event('click');
    b.get('vm-name_zh_tw').value = 'Unsaved draft';
    b.get('vm-start').value = '08:00';
    b.get('vm-radius_meters').value = '500';
    b.transport.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => qrResponse(saved)
    });
    await b.get('vm-qr').event('click');
    const text = b.get('vm-sign').textContent;
    expect(text).toContain(field.name_zh_tw);
    expect(text).not.toContain('Unsaved draft');
    for (const expected of [
      '不能簽到',
      'America/New_York',
      '提前 30 分鐘',
      '前一天週六 23:45–週日 24:00',
      '前一天週五 23:45–週六 24:00',
      '200 m',
      row.code,
      row.urls.qr
    ])
      expect(text).toContain(expected);
    expect(b.get('vm-print').disabled).toBe(false);
    expect(b.html).toContain('掃描後仍須點 LINE 繼續登入與現場定位');
  });
  it.each([true, false])(
    'derives a read-only preview without changing manage permission (%s)',
    async (manage) => {
      const b = browser(200, manage);
      await b.ready;
      await b.get('vm-load').event('click');
      await all(b.get('vm-list'))
        .find((e) => e.tag === 'button')!
        .event('click');
      expect(b.html).toContain('團練開始 HH:mm');
      expect(b.html).toContain('打卡時段（唯讀預覽）');
      expect(b.get('vm-save').disabled).toBe(!manage);
      for (let day = 0; day < 7; day++) b.get('vm-day-' + day).checked = day === 6;
      b.get('vm-start').value = '09:00';
      b.get('vm-end').value = '11:00';
      await b.get('vm-start').event('input');
      expect(b.get('vm-checkin-preview').textContent).toBe(
        '可打卡：週六 08:30–11:00（Asia/Taipei）'
      );
      expect(b.get('vm-save').disabled).toBe(!manage);
      expect(b.get('vm-start').readOnly).toBe(!manage);
      if (manage) {
        b.get('vm-reason').value = 'schedule clarification';
        await b.get('vm-form').event('submit');
        expect(b.calls.find((c) => c.action === 'update')?.body).toMatchObject({
          version: 3,
          field: { active_time_rules: { day_of_week: [6], start_time: '09:00', end_time: '11:00' } }
        });
        expect(b.calls.find((c) => c.action === 'update')?.body.field).not.toHaveProperty(
          'checkin_start'
        );
      } else expect(b.calls.some((c) => c.action === 'update')).toBe(false);
    }
  );
  it('updates previous-day weekdays including Sunday wrap and fails closed on invalid input', async () => {
    const b = browser();
    await b.ready;
    await b.get('vm-add').event('click');
    for (let day = 0; day < 7; day++) b.get('vm-day-' + day).checked = day === 0 || day === 6;
    b.get('vm-start').value = '00:15';
    b.get('vm-end').value = '01:00';
    await b.get('vm-start').event('input');
    expect(b.get('vm-checkin-preview').textContent).toBe(
      '可打卡：前一天週六 23:45–週日 01:00、前一天週五 23:45–週六 01:00（Asia/Taipei）'
    );
    b.get('vm-start').value = '23:00';
    b.get('vm-end').value = '24:00';
    await b.get('vm-end').event('input');
    expect(b.get('vm-checkin-preview').textContent).toContain('22:30–24:00');
    for (const [id, value] of [
      ['vm-start', 'bad'],
      ['vm-end', '24:01'],
      ['vm-timezone', 'Invalid/Zone']
    ] as const) {
      b.get(id).value = value;
      await b.get(id).event('input');
      expect(b.get('vm-checkin-preview').textContent).toContain('無法計算');
      expect(b.get('vm-checkin-preview').textContent).not.toContain('NaN');
      b.get('vm-start').value = '09:00';
      b.get('vm-end').value = '11:00';
      b.get('vm-timezone').value = 'Asia/Taipei';
    }
    for (let day = 0; day < 7; day++) b.get('vm-day-' + day).checked = false;
    await b.get('vm-day-0').event('change');
    expect(b.get('vm-checkin-preview').textContent).toContain('無法計算');
  });
  it('safe DOM displays hostile names literally; copy/print truthful URLs, immutable code and version save', async () => {
    const b = browser();
    await b.get('vm-load').event('click');
    expect(b.get('vm-list').textContent).toContain(field.name_zh_tw);
    await all(b.get('vm-list'))
      .find((e) => e.tag === 'button')!
      .event('click');
    expect(b.get('vm-code').readOnly).toBe(true);
    expect(b.get('vm-sign').textContent).toBe('');
    expect(b.get('vm-print').disabled).toBe(true);
    await b.get('vm-qr').event('click');
    expect(b.get('vm-sign').textContent).toContain(field.name_zh_tw);
    expect(all(b.get('vm-sign')).filter((e) => e.tag === 'img')).toHaveLength(1);
    expect(b.get('vm-print').disabled).toBe(false);
    await all(b.get('vm-links'))
      .find((e) => e.tag === 'button')!
      .event('click');
    expect(b.copy).toHaveBeenCalledWith(row.urls.nfc);
    await b.get('vm-print').event('click');
    expect(b.print).toHaveBeenCalledOnce();
    b.get('vm-name_zh_tw').value = 'Renamed';
    b.get('vm-reason').value = 'location audit';
    await b.get('vm-form').event('submit');
    expect(b.calls.at(-1)).toMatchObject({
      action: 'update',
      body: { id, version: 3, reason: 'location audit' }
    });
    expect(b.get('vm-status').textContent).toContain('已儲存，版本 4');
    expect(b.html).not.toMatch(/qrserver/i);
    expect(b.html).not.toContain('沒有 QR 圖片');
    expect(b.html).toContain('圖片載入後才可下載 PNG');
    expect(b.get('vm-print').disabled).toBe(true);
    expect(b.get('vm-sign').textContent).toBe('');
  });
  it.each([401, 403, 404, 409, 503])('failed HTTP %i never claims success', async (status) => {
    const b = browser(status);
    await b.get('vm-load').event('click');
    expect(b.get('vm-editor').disabled).toBe(true);
    expect(b.get('vm-status').textContent).not.toContain('已儲存');
    expect(b.get('vm-list').textContent).not.toContain(field.name_zh_tw);
  });
  it('clipboard unavailable offers manual copy instead of claiming success', async () => {
    const b = browser(200, true, undefined, false);
    await b.get('vm-load').event('click');
    await all(b.get('vm-list'))
      .find((e) => e.tag === 'button')!
      .event('click');
    await all(b.get('vm-links'))
      .find((e) => e.tag === 'button')!
      .event('click');
    expect(b.get('vm-status').textContent).toContain('請手動複製');
  });
  it.each([400, 401, 403, 404, 409, 503])(
    'save HTTP %i preserves version and never claims success',
    async (status) => {
      const b = browser(200, true, status);
      await b.get('vm-load').event('click');
      await all(b.get('vm-list'))
        .find((e) => e.tag === 'button')!
        .event('click');
      b.get('vm-reason').value = 'attempted change';
      await b.get('vm-form').event('submit');
      expect(b.get('vm-status').textContent).not.toContain('已儲存');
      expect(b.get('vm-version').textContent).toContain('版本 3');
    }
  );
  it('conflict requires explicit reload before another write, preserving the draft and version', async () => {
    const b = browser(200, true, 409);
    await b.get('vm-load').event('click');
    await all(b.get('vm-list'))
      .find((e) => e.tag === 'button')!
      .event('click');
    b.get('vm-name_zh_tw').value = 'Unsaved draft';
    await b.get('vm-form').event('submit');
    expect(b.get('vm-save').disabled).toBe(true);
    expect(b.get('vm-name_zh_tw').value).toBe('Unsaved draft');
    await b.get('vm-form').event('submit');
    expect(b.calls.filter((c) => c.action === 'update')).toHaveLength(1);
    await b.get('vm-load').event('click');
    await all(b.get('vm-list'))
      .find((e) => e.tag === 'button')!
      .event('click');
    expect(b.get('vm-save').disabled).toBe(false);
    expect(b.get('vm-version').textContent).toContain('版本 3');
  });
  it('unknown network write result requires reload, without losing the draft or blindly retrying', async () => {
    const b = browser();
    await b.get('vm-load').event('click');
    await all(b.get('vm-list'))
      .find((e) => e.tag === 'button')!
      .event('click');
    b.get('vm-name_zh_tw').value = 'Unconfirmed draft';
    b.transport.mockRejectedValueOnce(new Error('connection lost'));
    await b.get('vm-form').event('submit');
    expect(b.get('vm-status').textContent).toContain('結果未確認');
    expect(b.get('vm-name_zh_tw').value).toBe('Unconfirmed draft');
    expect(b.get('vm-save').disabled).toBe(true);
    expect(all(b.get('vm-list')).find((e) => e.tag === 'button')!.disabled).toBe(true);
    await b.get('vm-form').event('submit');
    expect(b.transport).toHaveBeenCalledTimes(3);
  });
  it('does not duplicate a pending write', async () => {
    const b = browser();
    await b.get('vm-load').event('click');
    await all(b.get('vm-list'))
      .find((e) => e.tag === 'button')!
      .event('click');
    let resolve: ((value: Awaited<ReturnType<typeof b.transport>>) => void) | undefined;
    b.transport.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    await b.get('vm-form').event('submit');
    await b.get('vm-form').event('submit');
    expect(b.transport).toHaveBeenCalledTimes(3);
    expect(b.get('vm-editor').disabled).toBe(true);
    resolve!({ ok: true, status: 200, json: async () => ({ field: { ...row, version: 4 } }) });
    await new Promise<void>((r) => setImmediate(r));
    expect(b.get('vm-status').textContent).toContain('已儲存，版本 4');
  });
  it.each([true, false])(
    'requires confirmation to disable an existing active venue: %s',
    async (confirmed) => {
      const b = browser(200, true, undefined, true, confirmed);
      await b.get('vm-load').event('click');
      await all(b.get('vm-list'))
        .find((e) => e.tag === 'button')!
        .event('click');
      b.get('vm-active').checked = false;
      b.get('vm-reason').value = 'Synthetic closure';
      await b.get('vm-form').event('submit');
      expect(b.confirm).toHaveBeenCalledWith(expect.stringContaining('既有出席紀錄保留'));
      expect(b.calls.filter((c) => c.action === 'update')).toHaveLength(confirmed ? 1 : 0);
      if (!confirmed) expect(b.get('vm-status').textContent).toContain('已取消停用');
    }
  );
  it('initial singleton can create before any list request; UUID exists only in option values and payload', async () => {
    const b = browser();
    await b.ready;
    expect(b.calls.map((c) => c.action)).toEqual(['regions']);
    expect(b.get('vm-region').value).toBe(id);
    expect(b.get('vm-add').disabled).toBe(false);
    await b.get('vm-add').event('click');
    expect(b.get('vm-editor').disabled).toBe(false);
    expect(b.get('vm-region_id').value).toBe(id);
    expect(b.get('vm-code').readOnly).toBe(false);
    expect(b.get('vm-region_id').textContent).not.toContain(id);
    expect(b.get('vm-region_id').textContent).toContain(region.displayName);
    await b.get('vm-form').event('submit');
    expect(b.calls.at(-1)).toMatchObject({
      action: 'create',
      body: { regionId: id, field: { region_id: id } }
    });
    expect(b.get('vm-status').textContent).toContain('已儲存');
    expect(b.calls.some((c) => c.action === 'list')).toBe(false);
  });
  it('view does not permit mutation, can inspect links', async () => {
    const b = browser(200, false);
    await b.get('vm-load').event('click');
    await all(b.get('vm-list'))
      .find((e) => e.tag === 'button')!
      .event('click');
    expect(b.get('vm-editor').disabled).toBe(false);
    expect(b.get('vm-name_zh_tw').readOnly).toBe(true);
    expect(b.get('vm-active').disabled).toBe(true);
    expect(b.get('vm-save').disabled).toBe(true);
    await b.get('vm-form').event('submit');
    expect(b.calls.map((c) => c.action)).toEqual(['regions', 'list']);
    expect(all(b.get('vm-links')).some((e) => e.value === row.urls.link)).toBe(true);
    await b.get('vm-qr').event('click');
    expect(b.get('vm-save').disabled).toBe(true);
    expect(b.get('vm-sign').textContent).toContain(row.urls.qr);
    expect(b.get('vm-print').disabled).toBe(false);
  });

  it('multiple same-name regions remain unambiguous; target determines create scope without a successful list', async () => {
    const b = browser(200, true, undefined, true, true, {
      regions: [region, secondRegion],
      listStatus: 503
    });
    await b.ready;
    expect(b.get('vm-region').value).toBe('');
    expect(b.get('vm-add').disabled).toBe(false);
    await b.get('vm-add').event('click');
    expect(b.get('vm-region_id').value).toBe('');
    expect(b.get('vm-save').disabled).toBe(true);
    expect(b.get('vm-region_id').textContent).toContain('synthetic-one');
    expect(b.get('vm-region_id').textContent).toContain('synthetic-two');
    b.get('vm-region_id').value = secondRegion.id;
    await b.get('vm-region_id').event('change');
    expect(b.get('vm-region').value).toBe(secondRegion.id);
    expect(b.get('vm-status').textContent).toContain('場地清單載入失敗');
    expect(b.get('vm-save').disabled).toBe(false);
    await b.get('vm-form').event('submit');
    expect(b.calls.at(-1)).toMatchObject({
      action: 'create',
      body: { regionId: secondRegion.id, field: { region_id: secondRegion.id } }
    });
  });
  it.each([403, 404, 503])(
    'list HTTP %i does not revoke independent create capability',
    async (listStatus) => {
      const b = browser(200, true, undefined, true, true, { listStatus });
      await b.get('vm-load').event('click');
      expect(b.get('vm-add').disabled).toBe(false);
      await b.get('vm-add').event('click');
      await b.get('vm-form').event('submit');
      expect(b.calls.at(-1)?.action).toBe('create');
    }
  );
  it('read-only filter can be queried while create selects the independent manageable region', async () => {
    const b = browser(200, true, undefined, true, true, {
      regions: [{ ...region, canManage: false }, secondRegion]
    });
    await b.ready;
    b.get('vm-region').value = id;
    await b.get('vm-region').event('change');
    await all(b.get('vm-list'))
      .find((e) => e.tag === 'button')!
      .event('click');
    expect(b.get('vm-save').disabled).toBe(true);
    expect(b.get('vm-region_id').disabled).toBe(true);
    expect(b.get('vm-add').disabled).toBe(false);
    await b.get('vm-add').event('click');
    expect(b.get('vm-region_id').value).toBe(secondRegion.id);
    expect(b.get('vm-name_zh_tw').readOnly).toBe(false);
    await b.get('vm-form').event('submit');
    expect(b.calls.at(-1)).toMatchObject({ action: 'create', body: { regionId: secondRegion.id } });
  });
  it('filter selection updates a new target without erasing text; update retains its real source scope', async () => {
    const b = browser(200, true, undefined, true, true, { regions: [region, secondRegion] });
    await b.ready;
    await b.get('vm-add').event('click');
    b.get('vm-name_zh_tw').value = 'Preserved new draft';
    b.get('vm-region').value = id;
    await b.get('vm-region').event('change');
    expect(b.get('vm-name_zh_tw').value).toBe('Preserved new draft');
    expect(b.get('vm-region_id').value).toBe(id);
    await all(b.get('vm-list'))
      .find((e) => e.tag === 'button')!
      .event('click');
    b.get('vm-region_id').value = secondRegion.id;
    await b.get('vm-region_id').event('change');
    await b.get('vm-form').event('submit');
    expect(b.calls.at(-1)).toMatchObject({
      action: 'update',
      body: { regionId: id, id, version: 3, field: { region_id: secondRegion.id } }
    });
  });
  it('empty directory, unavailable directory and retry are distinct and never fake success', async () => {
    const empty = browser(200, true, undefined, true, true, { regions: [] });
    await empty.ready;
    expect(empty.get('vm-status').textContent).toContain('沒有可用的授權地區');
    expect(empty.get('vm-add').disabled).toBe(true);
    await empty.get('vm-add').event('click');
    expect(empty.get('vm-editor').disabled).toBe(true);
    const failed = browser(503);
    await failed.ready;
    expect(failed.get('vm-status').textContent).toContain('地區目錄載入失敗');
    expect(failed.get('vm-add').disabled).toBe(true);
    failed.transport.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ regions: [region] })
    });
    await failed.get('vm-regions-retry').event('click');
    expect(failed.get('vm-add').disabled).toBe(false);
  });
  it('keeps add disabled until directory session/capabilities resolve, not merely HTML session', async () => {
    let finish:
      ((response: { ok: boolean; status: number; json(): Promise<unknown> }) => void) | undefined;
    const b = browser(200, true, undefined, true, true, {
      http: async () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    });
    await b.ready;
    expect(b.get('vm-add').disabled).toBe(true);
    await b.get('vm-add').event('click');
    expect(b.get('vm-editor').disabled).toBe(true);
    finish!({ ok: true, status: 200, json: async () => ({ regions: [region] }) });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(b.get('vm-add').disabled).toBe(false);
    await b.get('vm-add').event('click');
    expect(b.get('vm-editor').disabled).toBe(false);
  });
  it('refresh reflects revoked manage permission without discarding the draft; network list failure alone does not lock add', async () => {
    const b = browser();
    await b.ready;
    b.transport.mockRejectedValueOnce(new Error('synthetic list network failure'));
    await b.get('vm-load').event('click');
    expect(b.get('vm-add').disabled).toBe(false);
    await b.get('vm-add').event('click');
    b.get('vm-name_zh_tw').value = 'Draft before permission revocation';
    b.transport.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ regions: [{ ...region, canManage: false }] })
    });
    await b.get('vm-regions-retry').event('click');
    expect(b.get('vm-add').disabled).toBe(true);
    expect(b.get('vm-save').disabled).toBe(true);
    expect(b.get('vm-name_zh_tw').value).toBe('Draft before permission revocation');
    expect(b.get('vm-name_zh_tw').readOnly).toBe(true);
    await b.get('vm-form').event('submit');
    expect(b.calls.some((c) => c.action === 'create')).toBe(false);
  });
  it('expired create preserves the draft, locks mutations and exposes login/retry', async () => {
    const b = browser(200, true, 401);
    await b.get('vm-add').event('click');
    b.get('vm-name_zh_tw').value = 'Expired context draft';
    await b.get('vm-form').event('submit');
    expect(b.get('vm-name_zh_tw').value).toBe('Expired context draft');
    expect(b.get('vm-add').disabled).toBe(true);
    expect(b.get('vm-save').disabled).toBe(true);
    expect(b.get('vm-status').textContent).toContain('重新登入');
    expect(b.html).toContain('href="/admin/auth/login"');
    await b.get('vm-form').event('submit');
    expect(b.calls.filter((c) => c.action === 'create')).toHaveLength(1);
  });
  it('rejects malformed/duplicate directories and preserves input on a failed refresh', async () => {
    const b = browser();
    await b.get('vm-add').event('click');
    b.get('vm-name_zh_tw').value = 'Draft survives refresh';
    for (const regions of [[region, region], [{ ...region, canManage: 'true' }]]) {
      b.transport.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ regions }) });
      await b.get('vm-regions-retry').event('click');
      expect(b.get('vm-status').textContent).toContain('目錄回應無效');
      expect(b.get('vm-add').disabled).toBe(true);
      expect(b.get('vm-name_zh_tw').value).toBe('Draft survives refresh');
    }
  });
  it('does not duplicate create while pending, and ignores stale list output after create', async () => {
    const b = browser();
    await b.ready;
    let completeList: ((r: Awaited<ReturnType<typeof b.transport>>) => void) | undefined;
    b.transport.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeList = resolve;
        })
    );
    await b.get('vm-load').event('click');
    expect(b.get('vm-add').disabled).toBe(false);
    await b.get('vm-add').event('click');
    let completeCreate: typeof completeList;
    b.transport.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeCreate = resolve;
        })
    );
    await b.get('vm-form').event('submit');
    await b.get('vm-form').event('submit');
    expect(b.transport).toHaveBeenCalledTimes(3);
    expect(b.get('vm-add').disabled).toBe(true);
    completeCreate!({
      ok: true,
      status: 200,
      json: async () => ({ field: { ...row, version: 4 } })
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    completeList!({ ok: true, status: 200, json: async () => ({ fields: [] }) });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(b.get('vm-status').textContent).toContain('已儲存');
    expect(b.get('vm-list').textContent).toContain(row.name_zh_tw);
  });
  it('served controller traverses actual admin-auth routes: auto directory, failed list, direct create, revoked session', async () => {
    let active = true;
    const operations: unknown[][] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('session_principal'))
        return { rows: [{ principal_id: active ? id : null, principal: active ? id : null }] };
      if (sql.includes('WITH eligible')) return { rows: [region] };
      if (sql.includes('admin.venue_management(')) {
        if (values?.[1] === 'list') throw new Error('synthetic list unavailable');
        operations.push(values ?? []);
        return {
          rows: [{ data: { field: { ...field, id, version: 1, created_at: '', updated_at: '' } } }]
        };
      }
      return { rows: [] };
    });
    const pool = { connect: async () => ({ query, release() {} }) } as unknown as Pool;
    const app = Fastify({ genReqId: () => id });
    registerAdminRoutes(
      app,
      pool,
      {
        callbackUrl: origin + '/admin/auth/callback',
        begin: async () => new URL(origin),
        complete: async () => ({ iss: origin, sub: 'synthetic' })
      },
      undefined,
      {},
      undefined,
      { management: { enabled: true, publicOrigin: origin } }
    );
    const cookie = `__Host-qigong-admin=${'s'.repeat(43)}; __Host-qigong-admin-csrf=${'c'.repeat(43)}`;
    try {
      const page = await app.inject({ url: '/admin/venue-management', headers: { cookie } });
      expect(page.statusCode).toBe(200);
      const b = browser(200, true, undefined, true, true, {
        html: page.body,
        http: async (path, init) => {
          if (typeof init.body !== 'string') throw new Error('expected JSON body');
          const response = await app.inject({
            method: 'POST',
            url: path,
            headers: { origin, cookie, 'x-csrf-token': 'c'.repeat(43) },
            payload: JSON.parse(init.body) as object
          });
          return {
            ok: response.statusCode < 300,
            status: response.statusCode,
            json: async () => response.json<unknown>()
          };
        }
      });
      await b.ready;
      expect(b.calls.map((c) => c.action)).toEqual(['regions']);
      await b.get('vm-load').event('click');
      expect(b.get('vm-add').disabled).toBe(false);
      await b.get('vm-add').event('click');
      for (const key of [
        'code',
        'name_zh_tw',
        'address',
        'latitude',
        'longitude',
        'radius_meters',
        'timezone'
      ] as const)
        b.get('vm-' + key).value = String(field[key]);
      b.get('vm-reason').value = 'Synthetic create';
      await b.get('vm-form').event('submit');
      expect(b.get('vm-status').textContent).toContain('已儲存，版本 1');
      expect(operations).toHaveLength(1);
      expect(operations[0]?.slice(0, 3)).toEqual(['s'.repeat(43), 'create', id]);
      active = false;
      await b.get('vm-add').event('click');
      b.get('vm-name_zh_tw').value = 'Unsaved after session revocation';
      b.get('vm-latitude').value = '25';
      b.get('vm-longitude').value = '121';
      b.get('vm-code').value = 'tw-synthetic-new';
      b.get('vm-reason').value = 'Synthetic attempt';
      await b.get('vm-form').event('submit');
      expect(b.get('vm-status').textContent).toContain('登入失效');
      expect(b.get('vm-name_zh_tw').value).toBe('Unsaved after session revocation');
      expect(operations).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('aligns venue form textboxes with tabular grid, paired coordinates/time, and clear a11y associations', () => {
    const html = renderVenueManagementPage();

    // Form table / grid structure
    expect(html).toContain('class="vm-form-table"');
    expect(html).toContain('class="vm-form-row"');
    expect(html).toContain('class="vm-label-col"');
    expect(html).toContain('class="vm-control-col"');

    // Paired coordinates: latitude and longitude in a 2-column pair grid
    const latLngBlock = html.match(
      /<div class="vm-pair-grid">[\s\S]*?id="vm-latitude"[\s\S]*?id="vm-longitude"[\s\S]*?<\/div>/
    );
    expect(latLngBlock).not.toBeNull();

    // Paired radius and timezone in a 2-column pair grid
    const radiusTimezoneBlock = html.match(
      /<div class="vm-pair-grid">[\s\S]*?id="vm-radius_meters"[\s\S]*?id="vm-timezone"[\s\S]*?<\/div>/
    );
    expect(radiusTimezoneBlock).not.toBeNull();

    // Paired schedule time window: start and end in a 2-column pair grid
    const scheduleBlock = html.match(
      /<div class="vm-pair-grid">[\s\S]*?id="vm-start"[\s\S]*?id="vm-end"[\s\S]*?<\/div>/
    );
    expect(scheduleBlock).not.toBeNull();

    // Accessible weekday pills in a role="group"
    expect(html).toContain('class="vm-days-group" role="group"');
    for (let day = 0; day < 7; day++) {
      expect(html).toContain(`id="vm-day-${day}"`);
    }

    // Accessibility: label-for association on every input
    for (const id of [
      'vm-region',
      'vm-search',
      'vm-filter',
      'vm-code',
      'vm-name_zh_tw',
      'vm-name_en',
      'vm-address',
      'vm-region_id',
      'vm-latitude',
      'vm-longitude',
      'vm-radius_meters',
      'vm-timezone',
      'vm-start',
      'vm-end',
      'vm-reason'
    ]) {
      expect(html).toMatch(new RegExp(`<label[^>]*for="${id}"`));
    }

    expect(html).toMatch(/<select id="vm-region"/);
    expect(html).toMatch(/<select id="vm-region_id"/);
    expect(html).not.toMatch(/<input[^>]*id="vm-region(?:_id)?"/);
    expect(html).not.toContain('36 字元');
    // Native selects retain keyboard semantics; visible text is appended via textContent.
    expect(html).toContain('aria-describedby="vm-status"');
    // Required vs optional indicators
    expect(html).toMatch(/id="vm-code"[^>]*required/);
    expect(html).toMatch(/id="vm-name_zh_tw"[^>]*required/);
    expect(html).toMatch(/id="vm-region_id"[^>]*required/);
    expect(html).toMatch(/id="vm-latitude"[^>]*required/);
    expect(html).toMatch(/id="vm-longitude"[^>]*required/);
    expect(html).toMatch(/id="vm-radius_meters"[^>]*required/);
    expect(html).toMatch(/id="vm-timezone"[^>]*required/);
    expect(html).toMatch(/id="vm-start"[^>]*required/);
    expect(html).toMatch(/id="vm-end"[^>]*required/);
    expect(html).toMatch(/id="vm-reason"[^>]*required/);

    // Optional fields must not have required
    expect(html).not.toMatch(/id="vm-name_en"[^>]*required/);
    expect(html).not.toMatch(/id="vm-address"[^>]*required/);

    // Status message accessibility
    expect(html).toContain('id="vm-status" role="status" aria-live="polite"');

    // Visual separation: list panel, editor panel, and links panel
    expect(html).toContain('class="vm-card vm-list-panel"');
    expect(html).toContain('class="vm-editor-panel"');
    expect(html).toContain('class="vm-card vm-links-panel"');

    // Responsive mobile single-column, query bar auto rows, and 48px touch rules
    expect(html).toContain('@media(max-width:768px)');
    expect(html).toContain('grid-auto-rows:min-content');
    expect(html).toContain('min-height:48px');
    expect(html).toContain('font-size:1rem');

    // Required asterisks bound inline with white-space nowrap and no unclosed tags
    expect(html).toContain(
      '.vm-req{color:#c02020;font-weight:700;margin-left:.15rem;white-space:nowrap;display:inline-block}'
    );
    expect((html.match(/id="vm-start"/g) || []).length).toBe(1);
    expect((html.match(/id="vm-end"/g) || []).length).toBe(1);

    // Print stylesheet attribution
    expect(html).toContain('Developed with ❤️ by Bean, Bird & Badminton Tech Consulting');
  });
});
