/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { runInNewContext } from 'node:vm';
import Fastify from 'fastify';
import type { Pool } from '@qigong/database';
import { describe, expect, it, vi } from 'vitest';
import { renderVenueManagementPage } from '../src/venue-management-page.js';
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
    for (const fn of this.listeners.get(type) ?? []) await fn({ preventDefault() {} });
    for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
  }
  focus() {}
  select() {}
}
const all = (e: Element): Element[] => [e, ...e.children.flatMap(all)];
function browser(
  status = 200,
  manage = true,
  failedSaveStatus?: number,
  clipboardAvailable = true,
  confirmDisable = true
) {
  const html = renderVenueManagementPage();
  const elements = new Map<string, Element>();
  for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const e = new Element(match[1]);
    e.disabled = /\bdisabled\b/.test(match[2]!);
    elements.set(match[3]!, e);
  }
  const calls: { action: string; body: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (path: string, init: RequestInit) => {
    const action = path.split('/').at(-1)!;
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<
      string,
      unknown
    >;
    calls.push({ action, body });
    const responseStatus = ['create', 'update'].includes(action)
      ? (failedSaveStatus ?? status)
      : status;
    return {
      ok: responseStatus === 200,
      status: responseStatus,
      json: async () =>
        action === 'capabilities'
          ? { canRead: true, canManage: manage }
          : action === 'list'
            ? { fields: [row] }
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
      createElement: (tag: string) => new Element(tag),
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
  get('vm-region').value = id;
  return { html, get, calls, copy, print, confirm, transport: fetch };
}
describe('venue management browser controller (in-memory transport, not DB evidence)', () => {
  it('safe DOM displays hostile names literally; copy/print truthful URLs, immutable code and version save', async () => {
    const b = browser();
    await b.get('vm-load').event('click');
    expect(b.get('vm-list').textContent).toContain(field.name_zh_tw);
    await all(b.get('vm-list'))
      .find((e) => e.tag === 'button')!
      .event('click');
    expect(b.get('vm-code').readOnly).toBe(true);
    expect(b.get('vm-sign').textContent).toContain(field.name_zh_tw);
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
    expect(b.html).not.toMatch(/qrserver|<img[^>]*qr|download=/i);
    expect(b.html).toContain('沒有 QR 圖片');
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
  it('new venues use the successfully authorized region, not an unsubmitted filter edit', async () => {
    const b = browser();
    await b.get('vm-load').event('click');
    b.get('vm-region').value = '20000000-0000-4000-8000-000000000001';
    await b.get('vm-add').event('click');
    expect(b.get('vm-region_id').value).toBe(id);
    expect(b.get('vm-code').readOnly).toBe(false);
    await b.get('vm-form').event('submit');
    expect(b.calls.at(-1)).toMatchObject({ action: 'create', body: { regionId: id } });
    expect(b.get('vm-status').textContent).toContain('已儲存');
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
    expect(b.calls.map((c) => c.action)).toEqual(['capabilities', 'list']);
    expect(b.get('vm-sign').textContent).toContain(row.urls.link);
  });
});
