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
function browser(status = 200, manage = true) {
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
    return {
      ok: status === 200,
      status,
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
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1]!;
  runInNewContext(script, {
    document: {
      getElementById: (id: string) => elements.get(id),
      createElement: (tag: string) => new Element(tag),
      cookie: '__Host-qigong-admin-csrf=' + 'c'.repeat(43)
    },
    navigator: { clipboard: { writeText: copy } },
    window: { print },
    fetch,
    Error
  });
  const get = (id: string) => {
    const e = elements.get(id);
    if (!e) throw new Error('missing ' + id);
    return e;
  };
  get('vm-region').value = id;
  return { html, get, calls, copy, print };
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
  it('view does not permit mutation, can inspect links', async () => {
    const b = browser(200, false);
    await b.get('vm-load').event('click');
    await all(b.get('vm-list'))
      .find((e) => e.tag === 'button')!
      .event('click');
    expect(b.get('vm-editor').disabled).toBe(true);
    await b.get('vm-form').event('submit');
    expect(b.calls.map((c) => c.action)).toEqual(['capabilities', 'list']);
    expect(b.get('vm-sign').textContent).toContain(row.urls.link);
  });
});
