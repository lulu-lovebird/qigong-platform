/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import type { Pool } from '@qigong/database';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAdminRoutes, type AdminAuthProvider } from '../src/admin-auth.js';
import { apiLogRedaction } from '../src/app.js';
import {
  buildFieldUrls,
  generateFieldQrCodeUrl,
  registerAdminFieldRoutes,
  type PracticeFieldRow
} from '../src/admin-field-routes.js';
import { renderVenueFieldsPage, venueEntryUrl } from '../src/admin-venue-fields-page.js';
import { renderAdminShell } from '../src/admin-dashboard.js';
import { venuePreviewRequest } from '../src/line-venue-checkin-page.js';

const unsafe = '<img src=x onerror="alert(1)"></script><script>alert(2)</script>';
const row: PracticeFieldRow = {
  id: '10000000-0000-4000-8000-000000000001',
  region_id: '20000000-0000-4000-8000-000000000001',
  region_name: unsafe,
  code: 'tw-tpe-daan',
  name_zh_tw: unsafe,
  name_en: 'Park',
  latitude: 25.03,
  longitude: 121.54,
  radius_meters: 50,
  active_time_rules: { day_of_week: [0, 6], start_time: '06:30', end_time: '09:00' },
  is_active: true,
  created_at: '',
  updated_at: ''
};

type Listener = (event: { preventDefault(): void }) => unknown;
class Element {
  children: Element[] = [];
  listeners = new Map<string, Listener[]>();
  dataset: Record<string, string> = {};
  value = '';
  disabled = false;
  checked = false;
  readOnly = false;
  hidden = false;
  type = '';
  className = '';
  valid = true;
  focused = false;
  selected = false;
  private text = '';
  constructor(readonly tag = 'div') {}
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }
  set innerHTML(_value: string) {
    throw new Error('Untrusted innerHTML is forbidden');
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
    await Promise.all(
      (this.listeners.get(type) ?? []).map((listener) => listener({ preventDefault() {} }))
    );
    await flush();
  }
  reportValidity() {
    return this.valid;
  }
  focus() {
    this.focused = true;
  }
  select() {
    this.selected = true;
  }
}
const all = (element: Element): Element[] => [element, ...element.children.flatMap(all)];
const response = (status: number, data: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data
});
type MockResponse = ReturnType<typeof response>;
type Handler = (path: string, init?: RequestInit) => MockResponse | Promise<MockResponse>;
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

function browser(handler?: Handler, liff = '1234-test', shell = false) {
  const html = shell ? renderAdminShell('overview', '', '') : renderVenueFieldsPage('zh_TW', liff);
  const elements = new Map<string, Element>();
  for (const match of html.matchAll(/<(\w+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const element = new Element(match[1]);
    const attributes = match[2]!;
    element.value = /\bvalue="([^"]*)"/.exec(attributes)?.[1] ?? '';
    element.checked = /\bchecked\b/.test(attributes);
    element.disabled = /\bdisabled\b/.test(attributes);
    elements.set(match[3]!, element);
  }
  let cookie = '__Host-qigong-admin-csrf=test-csrf';
  const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (handler) return handler(path, init);
    if (path.endsWith('/capabilities')) return response(200, { canManage: true });
    return response(200, { fields: [row] });
  });
  const clipboard = vi.fn(async (value: string) => {
    expect(typeof value).toBe('string');
  });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]!)
    .join('\n');
  const pageScript = shell ? scripts : scripts.slice(scripts.indexOf('const venueEntryUrl='));
  runInNewContext(pageScript, {
    document: {
      getElementById: (id: string) => elements.get(id),
      createElement: (tag: string) => new Element(tag),
      querySelectorAll: () => [],
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        cookie = value;
      }
    },
    fetch: fetchMock,
    navigator: { clipboard: { writeText: clipboard } },
    URLSearchParams,
    URL,
    Error,
    location: { href: 'https://example.test/admin/fields', assign: vi.fn() }
  });
  const get = (id: string) => {
    const element = elements.get(id);
    if (!element) throw new Error('missing test element: ' + id);
    return element;
  };
  const edit = async () => {
    const button = all(get('venue-list')).find((element) => element.tag === 'button');
    if (!button) throw new Error('missing edit button');
    await button.event('click');
  };
  return {
    html,
    get,
    fetchMock,
    clipboard,
    edit,
    setCookie: (value: string) => {
      cookie = value;
    }
  };
}

describe('venue fields rendered UI (mock transport only, not backend readiness)', () => {
  it('renders the form, accessible defaults, zoomable 48px controls and company footer', () => {
    const html = renderVenueFieldsPage();
    for (const id of [
      'code',
      'name_zh_tw',
      'name_en',
      'region_id',
      'latitude',
      'longitude',
      'radius_meters',
      'is_active'
    ])
      expect(html).toContain('id="venue-' + id + '"');
    expect(html).toContain('<fieldset id="venue-editor" disabled>');
    expect(html).toContain('min-height:48px');
    expect(html).toContain('font-size:1.25rem');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('type="time" required');
    expect(html).toContain('min="5" max="5000"');
    expect(html).toContain('未生成 QR 圖片');
    expect(html).toContain('Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting');
    expect(html).not.toMatch(/user-scalable=no|maximum-scale|qrserver|<img[^>]*qr/i);
    expect(html).not.toContain('href="/admin/administrators');
  });

  it.each([false, undefined, 'true'])(
    'keeps false/missing/malformed capability %s locked without loading rows',
    async (capability) => {
      const page = browser(() => response(200, { canManage: capability }));
      await flush();
      expect(page.get('venue-editor').disabled).toBe(true);
      expect(page.get('venue-add').disabled).toBe(true);
      expect(page.get('venue-status').textContent).toContain('尚未開放');
      await page.get('venue-form').event('submit');
      expect(page.fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each([401, 403, 404, 500, 503])(
    'shows capability HTTP %s failure without a fake empty list or success',
    async (status) => {
      const page = browser(() => response(status, { error: unsafe }));
      await flush();
      expect(page.get('venue-editor').disabled).toBe(true);
      expect(page.get('venue-status').dataset.error).toBe('true');
      expect(page.get('venue-status').textContent).not.toContain(unsafe);
      expect(page.get('venue-list').children).toHaveLength(0);
    }
  );

  it('loads real response rows as text, filters, and fills the edit form without interpreting HTML', async () => {
    const page = browser();
    await flush();
    expect(page.get('venue-editor').disabled).toBe(false);
    expect(page.get('venue-list').textContent).toContain(unsafe);
    expect(
      all(page.get('venue-list')).some(
        (element) => element.tag === 'img' || element.tag === 'script'
      )
    ).toBe(false);
    await page.edit();
    expect(page.get('venue-name_zh_tw').value).toBe(unsafe);
    expect(page.get('venue-region_id').value).toBe(row.region_id);
    expect(page.get('venue-is_active').checked).toBe(true);
    expect(page.get('venue-day-0').checked).toBe(true);
    expect(page.get('venue-day-1').checked).toBe(false);
    page.get('venue-active-filter').value = 'false';
    await page.get('venue-active-filter').event('input');
    expect(page.get('venue-list').textContent).toContain('沒有符合');
    page.get('venue-active-filter').value = '';
    page.get('venue-search').value = 'missing';
    await page.get('venue-search').event('input');
    expect(page.get('venue-list').textContent).toContain('沒有符合');
    page.get('venue-search').value = '';
    page.get('venue-region-filter').value = 'other';
    await page.get('venue-region-filter').event('input');
    expect(page.get('venue-list').textContent).toContain('沒有符合');
  });

  it('uses exact venue/source LIFF preview URLs and clipboard, never a QR image service', async () => {
    const page = browser();
    await flush();
    await page.edit();
    const links = all(page.get('venue-links'));
    const values = links.filter((element) => element.tag === 'input');
    expect(values).toHaveLength(3);
    for (const [index, source] of ['nfc', 'qr', 'link'].entries()) {
      const url = new URL(values[index]!.value);
      expect(url.origin).toBe('https://liff.line.me');
      expect(url.pathname).toBe('/1234-test/venue-checkin');
      expect([...url.searchParams.keys()]).toEqual(['venue', 'source']);
      expect(
        venuePreviewRequest('/line/venue-checkin?' + url.searchParams.toString())
      ).toMatchObject({
        kind: 'preview',
        entry: { venue: row.code, source }
      });
    }
    await links.find((element) => element.tag === 'button')!.event('click');
    expect(page.clipboard).toHaveBeenCalledWith(values[0]!.value);
    page.clipboard.mockRejectedValueOnce(new Error('blocked'));
    await links.find((element) => element.tag === 'button')!.event('click');
    expect(values[0]!.selected).toBe(true);
    expect(page.get('venue-status').textContent).toContain('手動複製');
    expect(page.fetchMock.mock.calls.every(([path]) => path.startsWith('/admin/api/fields'))).toBe(
      true
    );
  });

  it('escapes injected LIFF configuration in script JSON and rejects unsafe/legacy link values', async () => {
    const html = renderVenueFieldsPage('zh_TW', unsafe);
    expect([...html.matchAll(/<script>/g)]).toHaveLength(1);
    expect(html).not.toContain(unsafe);
    const page = browser(undefined, unsafe);
    await flush();
    await page.edit();
    expect(page.get('venue-links').textContent).toContain('未產生網址');
    expect(venueEntryUrl('TW-TPE', 'nfc', '1234-test')).toBe('');
    expect(venueEntryUrl('tw-tpe', 'nfc', '../bad')).toBe('');
    expect(
      generateFieldQrCodeUrl('tw-tpe', { liffId: '1234-test', baseUrl: 'https://evil.test' })
    ).toBe('https://liff.line.me/1234-test/venue-checkin?venue=tw-tpe&source=qr');
    expect(buildFieldUrls('tw-tpe', { liffId: '1234-test' }).target_url).toContain('source=link');
  });

  it('distinguishes a valid empty result from malformed list data', async () => {
    const empty = browser((path) =>
      path.endsWith('capabilities')
        ? response(200, { canManage: true })
        : response(200, { fields: [] })
    );
    await flush();
    expect(empty.get('venue-list').textContent).toBe('目前沒有場地。');
    expect(empty.get('venue-editor').disabled).toBe(false);
    const invalid = browser((path) =>
      path.endsWith('capabilities')
        ? response(200, { canManage: true })
        : response(200, { fields: [{ ...row, active_time_rules: null }] })
    );
    await flush();
    expect(invalid.get('venue-editor').disabled).toBe(true);
    expect(invalid.get('venue-status').textContent).toContain('格式不正確');
  });

  it('sanitizes network and malformed JSON failures, keeping controls locked', async () => {
    const network = browser(() => {
      throw new Error(unsafe);
    });
    await flush();
    expect(network.get('venue-status').textContent).toContain('網路連線失敗');
    expect(network.get('venue-status').textContent).not.toContain(unsafe);
    const json = browser(() => ({
      ...response(200, {}),
      json: async () => {
        throw new Error(unsafe);
      }
    }));
    await flush();
    expect(json.get('venue-status').textContent).toContain('回應格式錯誤');
    expect(json.get('venue-editor').disabled).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 500, 503])(
    'PATCH HTTP %s never reports success and keeps the attempted input',
    async (status) => {
      const page = browser((path, init) =>
        init?.method
          ? response(status, { ok: true, field: row, diagnostic: unsafe })
          : path.endsWith('capabilities')
            ? response(200, { canManage: true })
            : response(200, { fields: [row] })
      );
      await flush();
      await page.edit();
      page.get('venue-name_zh_tw').value = 'Attempted edit';
      page.get('venue-is_active').checked = false;
      await page.get('venue-form').event('submit');
      const [path, init] = page.fetchMock.mock.calls.at(-1)!;
      expect(path).toBe('/admin/api/fields/' + row.id);
      expect(init?.method).toBe('PATCH');
      expect(init?.headers).toEqual({
        'content-type': 'application/json',
        'x-csrf-token': 'test-csrf'
      });
      expect(init?.credentials).toBe('same-origin');
      expect(init?.cache).toBe('no-store');
      expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toMatchObject({
        name_zh_tw: 'Attempted edit',
        is_active: false,
        region_id: row.region_id,
        latitude: 25.03,
        radius_meters: 50,
        active_time_rules: row.active_time_rules
      });
      expect(page.get('venue-status').dataset.error).toBe('true');
      expect(page.get('venue-status').textContent).not.toMatch(/已確認儲存|已重新載入|<img/);
      expect(page.get('venue-name_zh_tw').value).toBe('Attempted edit');
      expect(page.get('venue-editor').disabled).toBe([401, 403, 404, 503].includes(status));
      if (status === 409) expect(page.get('venue-status').textContent).toContain('代碼重複');
    }
  );

  it('validates CSRF, native form constraints, weekdays and time ordering before submitting', async () => {
    const page = browser();
    await flush();
    await page.edit();
    const initial = page.fetchMock.mock.calls.length;
    page.get('venue-form').valid = false;
    await page.get('venue-form').event('submit');
    page.get('venue-form').valid = true;
    for (let day = 0; day < 7; day++) page.get('venue-day-' + day).checked = false;
    await page.get('venue-form').event('submit');
    expect(page.get('venue-status').textContent).toContain('至少一天');
    page.get('venue-day-0').checked = true;
    page.get('venue-end').value = '06:00';
    await page.get('venue-form').event('submit');
    page.get('venue-end').value = '09:00';
    page.setCookie('');
    await page.get('venue-form').event('submit');
    expect(page.get('venue-status').textContent).toContain('缺少安全驗證');
    expect(page.fetchMock).toHaveBeenCalledTimes(initial);
  });

  it('submits POST once while busy, and reloads only after a confirmed successful response', async () => {
    let finish: ((result: MockResponse) => void) | undefined;
    const page = browser((path, init) =>
      init?.method
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : path.endsWith('capabilities')
          ? response(200, { canManage: true })
          : response(200, { fields: [row] })
    );
    await flush();
    await page.edit();
    await page.get('venue-add').event('click');
    expect(page.get('venue-code').value).toBe('');
    page.get('venue-code').value = row.code;
    page.get('venue-name_zh_tw').value = 'New';
    page.get('venue-region_id').value = row.region_id;
    page.get('venue-latitude').value = '25';
    page.get('venue-longitude').value = '121';
    const save = page.get('venue-form').event('submit');
    await flush();
    expect(page.get('venue-editor').disabled).toBe(true);
    expect(page.get('venue-refresh').disabled).toBe(true);
    await page.get('venue-form').event('submit');
    expect(page.fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    finish!(response(201, { ok: true, field: row }));
    await save;
    await flush();
    expect(page.get('venue-status').textContent).toContain('伺服器已確認儲存');
    expect(page.fetchMock).toHaveBeenCalledTimes(5);
  });

  it('does not accept HTTP 200 without the confirmed save DTO', async () => {
    const page = browser((path, init) =>
      init?.method
        ? response(200, {})
        : path.endsWith('capabilities')
          ? response(200, { canManage: true })
          : response(200, { fields: [row] })
    );
    await flush();
    await page.edit();
    await page.get('venue-form').event('submit');
    expect(page.get('venue-status').textContent).toContain('伺服器未確認儲存');
    expect(page.fetchMock).toHaveBeenCalledTimes(3);
  });

  it('revoked capability clears stale lists and links, and blocks further writes', async () => {
    let allowed = true;
    const page = browser((path) =>
      path.endsWith('capabilities')
        ? response(200, { canManage: allowed })
        : response(200, { fields: [row] })
    );
    await flush();
    await page.edit();
    allowed = false;
    await page.get('venue-refresh').event('click');
    await flush();
    expect(page.get('venue-list').children).toHaveLength(0);
    expect(page.get('venue-links').children).toHaveLength(0);
    expect(page.get('venue-editor').disabled).toBe(true);
    await page.get('venue-form').event('submit');
    expect(page.fetchMock.mock.calls.some(([, init]) => !!init?.method)).toBe(false);
  });

  it('ordinary navigation never adds permission or default-off NFC pages', async () => {
    const page = browser(undefined, '', true);
    await flush();
    expect(page.html).not.toContain('href="/admin/administrators');
    expect(page.html).not.toContain('href="/admin/fields');
    expect(page.html).not.toContain('href="/admin/attendance');
    expect(page.html).toContain('href="/admin/?lang=zh_TW"');
    const capable = renderAdminShell('overview', '', '', 'zh_TW', false, true);
    expect(capable).toContain('團練場出席管理 · 場地設定');
    expect(capable).toContain('data-fields-nav hidden');
    expect(capable).not.toContain('href="/admin/administrators');
  });
});

// Real HTTP registrations + private admin-auth factory + real DB runner. Only
// the pool is mocked. NFC stays off: this is NOT a production-readiness bypass.
describe('field routes → private cookie service → controlled runner', () => {
  const session = 'S'.repeat(43);
  const csrf = 'C'.repeat(43);
  const region = row.region_id;
  const otherRegion = '20000000-0000-4000-8000-000000000002';
  const requestId = '30000000-0000-4000-8000-000000000001';
  const principalId = '40000000-0000-4000-8000-000000000001';
  const metadata = { name_zh_tw: ' 公園 ', is_active: false };
  const readUrl = `/admin/api/fields?regionId=${region}`;
  const writeUrl = `/admin/api/fields/${row.id}?regionId=${region}`;
  const headers = {
    cookie: `__Host-qigong-admin=${session}; __Host-qigong-admin-csrf=${csrf}`,
    'x-csrf-token': csrf
  };
  const createFixture = () => {
    vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', 'false');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('external API forbidden');
      })
    );
    const state: {
      principal: string | null;
      failure: 'quarantine' | 'diagnostic' | 'success';
      denyWrite: boolean;
    } = {
      principal: principalId,
      failure: 'quarantine',
      denyWrite: false
    };
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      if (sql === 'SELECT admin.session_principal($1) AS principal_id')
        return { rows: [{ principal_id: values?.[0] === session ? state.principal : null }] };
      if (sql.startsWith('SELECT admin.venue_attendance_')) {
        if (values?.[1] === otherRegion || (state.denyWrite && sql.includes('write_field')))
          throw Object.assign(new Error('venue_attendance_forbidden'), { code: '42501' });
        if (state.failure === 'diagnostic') throw new Error(`SECRET_DB ${session} private learner`);
        if (state.failure === 'success')
          return { rows: [{ data: { session, phone: 'SECRET_PHONE' } }] };
        throw Object.assign(new Error('venue_attendance_quarantined'), { code: '55000' });
      }
      if (
        !['BEGIN', 'ROLLBACK', 'COMMIT', 'SET LOCAL ROLE qigong_api_runtime'].includes(sql) &&
        !sql.startsWith("SELECT set_config('qigong.")
      )
        throw new Error('unexpected SQL');
      return { rows: [] };
    });
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query, release }));
    const rawQuery = vi.fn(() => {
      throw new Error('raw pool query forbidden');
    });
    const pool = { connect, query: rawQuery } as unknown as Pool;
    const logs: string[] = [];
    const app = Fastify({
      genReqId: () => requestId,
      logger: {
        level: 'info',
        redact: apiLogRedaction,
        stream: { write: (line: string) => logs.push(line) }
      }
    });
    const forbiddenIdentity = vi.fn(async (): Promise<string | null> => {
      throw new Error('API must use session-bound runner');
    });
    const provider: AdminAuthProvider = {
      callbackUrl: 'https://admin.example.test/admin/auth/callback',
      begin: async () => {
        throw new Error('external auth forbidden');
      },
      complete: async () => {
        throw new Error('external auth forbidden');
      }
    };
    const { venueAdminServiceFor } = registerAdminRoutes(app, pool, provider);
    registerAdminFieldRoutes(
      app,
      pool,
      forbiddenIdentity,
      () => {
        throw new Error('use private CSRF boundary');
      },
      undefined,
      venueAdminServiceFor
    );
    const h = { app, state, query, connect, release, rawQuery, forbiddenIdentity, logs };
    return h;
  };
  const fixtures: ReturnType<typeof createFixture>[] = [];
  const fixture = () => {
    const h = createFixture();
    fixtures.push(h);
    return h;
  };
  afterEach(async () => {
    for (const h of fixtures.splice(0)) {
      await h.app.close();
      expect(h.rawQuery).not.toHaveBeenCalled();
      expect(h.forbiddenIdentity).not.toHaveBeenCalled();
      expect(h.release).toHaveBeenCalledTimes(h.connect.mock.calls.length);
      expect(h.logs.join('')).not.toMatch(
        new RegExp(`${session}|${csrf}|SECRET_DB|SECRET_PHONE|private learner`)
      );
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it.each(['GET', 'PUT', 'PATCH'] as const)(
    'runs %s through the actual session transaction and metadata-only operation',
    async (method) => {
      const h = fixture();
      const response = await h.app.inject({
        method,
        url: method === 'GET' ? readUrl : writeUrl,
        headers,
        ...(method === 'GET' ? {} : { payload: metadata })
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'quarantined' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(h.query.mock.calls).toEqual([
        ['BEGIN'],
        ['SET LOCAL ROLE qigong_api_runtime'],
        ["SELECT set_config('qigong.request_id', $1, TRUE)", [requestId]],
        ["SELECT set_config('qigong.person_id', $1, TRUE)", ['']],
        ["SELECT set_config('qigong.principal_id', $1, TRUE)", ['']],
        ['SELECT admin.session_principal($1) AS principal_id', [session]],
        ["SELECT set_config('qigong.principal_id', $1, TRUE)", [principalId]],
        method === 'GET'
          ? ['SELECT admin.venue_attendance_read_fields($1, $2) AS data', [session, region]]
          : [
              'SELECT admin.venue_attendance_write_field($1, $2, $3, $4) AS data',
              [session, region, row.id, JSON.stringify({ nameZhTw: '公園', isActive: false })]
            ],
        ['ROLLBACK']
      ]);
    }
  );
  it.each([
    '',
    `__Host-qigong-admin=${principalId}`,
    `__Host-qigong-admin-access=${session}`,
    `__Host-qigong-admin=${session}; __Host-qigong-admin=${session}`
  ])(
    'rejects missing/ambiguous/non-session cookies %s without identity fallback',
    async (cookie) => {
      const h = fixture();
      const response = await h.app.inject({
        url: readUrl,
        headers: {
          cookie,
          authorization: `Bearer ${session}`,
          'x-principal-id': principalId,
          'x-session-token': session
        }
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthenticated' });
      expect(h.connect).not.toHaveBeenCalled();
    }
  );
  it.each([
    { cookie: headers.cookie },
    { ...headers, 'x-csrf-token': 'X'.repeat(43) },
    { ...headers, cookie: `${headers.cookie}; __Host-qigong-admin-csrf=${csrf}` }
  ])('rejects CSRF before acquiring a runtime connection %j', async (badHeaders) => {
    const h = fixture();
    const response = await h.app.inject({
      method: 'PATCH',
      url: writeUrl,
      headers: badHeaders,
      payload: metadata
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'invalid_csrf' });
    expect(h.connect).not.toHaveBeenCalled();
  });
  it.each([
    { ...metadata, principalId },
    { ...metadata, sessionToken: session },
    { ...metadata, region_id: otherRegion },
    { ...metadata, latitude: 25 },
    { ...metadata, active_time_rules: row.active_time_rules },
    { ...row },
    { name_zh_tw: '公園' },
    { ...metadata, name_zh_tw: 'x'.repeat(121) }
  ])('does not strip unknown fields or the full legacy UI payload %j', async (payload) => {
    const h = fixture();
    const response = await h.app.inject({ method: 'PATCH', url: writeUrl, headers, payload });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_request' });
    expect(h.connect).not.toHaveBeenCalled();
  });
  it.each([
    '/admin/api/fields',
    `${readUrl}&principalId=${principalId}`,
    `${readUrl}&regionId=${otherRegion}`,
    '/admin/api/fields?regionId=invalid'
  ])('requires one explicit region and rejects unknown query identity: %s', async (url) => {
    const h = fixture();
    expect((await h.app.inject({ url, headers })).statusCode).toBe(400);
    expect(h.connect).not.toHaveBeenCalled();
  });
  it.each([
    ['GET', writeUrl],
    ['POST', readUrl]
  ] as const)('explicitly rejects unsupported %s %s', async (method, url) => {
    const h = fixture();
    const response = await h.app.inject({
      method,
      url,
      headers,
      ...(method === 'POST' ? { payload: row } : {})
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'unsupported_operation' });
    expect(h.connect).not.toHaveBeenCalled();
  });
  it('rechecks action and region after capabilities; revocation never becomes an empty list', async () => {
    const h = fixture();
    const capability = await h.app.inject({
      url: `/admin/api/fields/capabilities?regionId=${region}`,
      headers
    });
    expect(capability.statusCode).toBe(503);
    h.state.denyWrite = true;
    const write = await h.app.inject({
      method: 'PATCH',
      url: writeUrl,
      headers,
      payload: metadata
    });
    expect(write.statusCode).toBe(403);
    expect(write.json()).toEqual({ error: 'forbidden' });
    const cross = await h.app.inject({ url: `/admin/api/fields?regionId=${otherRegion}`, headers });
    expect(cross.statusCode).toBe(403);
    expect(cross.json()).toEqual({ error: 'forbidden' });
    h.state.principal = null;
    const revoked = await h.app.inject({ url: readUrl, headers });
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json()).toEqual({ error: 'unauthenticated' });
    expect(
      h.query.mock.calls.filter(([sql]) => sql.includes('admin.session_principal'))
    ).toHaveLength(4);
    expect(
      h.query.mock.calls.filter(([sql]) => sql.startsWith('SELECT admin.venue_attendance_'))
    ).toHaveLength(3);
    expect(h.query.mock.calls.at(-1)).toEqual(['COMMIT']);
  });
  it.each(['diagnostic', 'success'] as const)(
    'does not disclose DB diagnostics or unexpected SQL %s',
    async (failure) => {
      const h = fixture();
      h.state.failure = failure;
      const response = await h.app.inject({ url: readUrl, headers });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'unavailable' });
      expect(response.headers['content-disposition']).toBeUndefined();
      expect(h.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
    }
  );
  it('keeps the formal factory injection inside the unchanged production gate', () => {
    fixture();
    const source = readFileSync(new URL('../src/admin-auth.ts', import.meta.url), 'utf8');
    expect(source).toMatch(
      /registerNfcFeature\(app, pool, \(scope\) => \{[\s\S]*registerAdminFieldRoutes\([\s\S]*lineLiffId,\s*venueAdminServiceFor/
    );
    expect(source).toContain(
      'registerAdminAttendanceRoutes(scope, pool, principalFor, lineLiffId, venueAdminServiceFor)'
    );
  });
});

describe('direct field route boundary remains fail-closed (no DB authorization invented)', () => {
  const cases = [
    ['GET', '/admin/api/fields'],
    ['GET', '/admin/api/fields/' + row.id],
    ['POST', '/admin/api/fields'],
    ['PUT', '/admin/api/fields/' + row.id],
    ['PATCH', '/admin/api/fields/' + row.id]
  ] as const;
  it.each(cases)(
    '%s %s denies reads and writes even with a session and CSRF',
    async (method, url) => {
      const connect = vi.fn(() => {
        throw new Error('DB access forbidden');
      });
      const query = vi.fn(() => {
        throw new Error('DB access forbidden');
      });
      const app = Fastify();
      registerAdminFieldRoutes(
        app,
        { connect, query } as unknown as Pool,
        async () => 'trusted-admin',
        () => true
      );
      try {
        const result = await app.inject({
          method,
          url,
          ...(method === 'GET' ? {} : { payload: { ...row, principalId: 'forged' } })
        });
        expect(result.statusCode).toBe(503);
        expect(result.json()).toEqual({ error: 'field_authorization_unavailable' });
        expect(result.headers['cache-control']).toBe('no-store');
        expect(result.headers['referrer-policy']).toBe('no-referrer');
        expect(connect).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    }
  );

  it('enforces session and CSRF before refusing access and serves a locked escaped renderer', async () => {
    let principal: string | null = null;
    let csrf = false;
    const app = Fastify();
    registerAdminFieldRoutes(
      app,
      {} as Pool,
      async () => principal,
      () => csrf,
      unsafe
    );
    try {
      expect((await app.inject('/admin/api/fields/capabilities')).statusCode).toBe(401);
      expect(
        (await app.inject({ method: 'POST', url: '/admin/api/fields', payload: {} })).statusCode
      ).toBe(401);
      const redirect = await app.inject('/admin/fields');
      expect(redirect.statusCode).toBe(302);
      expect(redirect.headers.location).toBe('/admin/auth/login');
      principal = 'trusted-admin';
      const capability = await app.inject('/admin/api/fields/capabilities');
      expect(capability.json()).toEqual({
        canManage: false,
        reason: 'field_authorization_unavailable'
      });
      expect(
        (await app.inject({ method: 'POST', url: '/admin/api/fields', payload: {} })).statusCode
      ).toBe(403);
      csrf = true;
      expect(
        (await app.inject({ method: 'POST', url: '/admin/api/fields', payload: {} })).statusCode
      ).toBe(503);
      const page = await app.inject('/admin/fields');
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-security-policy']).toContain("default-src 'none'");
      expect(page.headers['cache-control']).toBe('no-store');
      expect(page.body).toContain('<fieldset id="venue-editor" disabled>');
      expect(page.body).not.toContain(unsafe);
      expect(page.body).not.toContain('href="/admin/administrators');
    } finally {
      await app.close();
    }
  });

  it('fails closed when session lookup throws and contains no permission-probe fail-open', async () => {
    const app = Fastify();
    registerAdminFieldRoutes(
      app,
      {} as Pool,
      async () => {
        throw new Error('unavailable');
      },
      () => true
    );
    try {
      expect((await app.inject('/admin/api/fields/capabilities')).statusCode).toBe(401);
      const source = readFileSync(new URL('../src/admin-field-routes.ts', import.meta.url), 'utf8');
      expect(source).not.toMatch(
        /\.catch\(\(\) => true\)|SELECT |INSERT INTO|UPDATE core|withRequestContext/
      );
    } finally {
      await app.close();
    }
  });
});
