import { Script } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { renderVenuePreview, venuePreviewRequest } from '../src/line-venue-checkin-page.js';

interface NodeStub {
  textContent: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  hidden: boolean;
  onclick?: () => void;
  onchange?: () => void;
  attributes: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
}
const token = 'synthetic-manual-memory-only-debug-token';
const makeBrowser = (
  isTest = true,
  venue = 'tw-taipei-cks',
  selected: 'tw-location-test' | 'tw-taipei-cks' | null = 'tw-taipei-cks',
  lang: 'zh_TW' | 'zh_CN' | 'en' = 'zh_TW'
) => {
  const html = renderVenuePreview(
    '123-test',
    { venue, lang },
    'checkin',
    true,
    selected ?? undefined
  );
  const nodes = new Map<string, NodeStub>();
  const get = (id: string) => {
    if (!nodes.has(id))
      nodes.set(id, {
        textContent: new RegExp('id="' + id + '"[^>]*>([^<]*)<').exec(html)?.[1] ?? '',
        value: id === 'preview-language' ? lang : '',
        checked: id === 'preview-debug-enabled' && venue === 'tw-location-test',
        disabled: false,
        hidden: true,
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        }
      });
    return nodes.get(id)!;
  };
  const forbidden = vi.fn(() => {
    throw new Error('forbidden persistence / logs');
  });
  const geo = vi.fn();
  const fetch = vi.fn(
    async (url: string, options: Omit<RequestInit, 'body'> & { body: string }) => {
      void url;
      void options;
      return new Response(
        JSON.stringify({
          ok: true,
          venue: { code: venue, name: '合成場地', timezone: 'Asia/Taipei' },
          checkedInAt: '2026-10-27T00:00:00Z',
          ...(isTest ? { isTest: true, verificationMode: 'distance_debug' } : {})
        })
      );
    }
  );
  const pagehide = vi.fn();
  new Script(html.match(/<script>([\s\S]*?)<\/script>/)![1]!).runInNewContext({
    URL,
    URLSearchParams,
    Intl,
    Date,
    location: new URL('https://app.test/line/venue-checkin?venue=tw-taipei-cks'),
    history: { replaceState: vi.fn() },
    document: { cookie: '', getElementById: get },
    fetch,
    addEventListener: pagehide,
    navigator: { geolocation: { getCurrentPosition: geo } },
    liff: {
      init: async () => {},
      isLoggedIn: () => true,
      isInClient: () => true,
      getIDToken: () => 'synthetic-id-token'
    },
    localStorage: { getItem: forbidden, setItem: forbidden },
    sessionStorage: { getItem: forbidden, setItem: forbidden },
    console: { log: forbidden, error: forbidden, warn: forbidden }
  });
  return { html, get, geo, fetch, forbidden, pagehide };
};
describe('server-selected presentation mode and mobile feedback', () => {
  const labels = {
    zh_TW: {
      formal: '正式出席簽到：送出後由後端驗證並記錄',
      test: '僅供測試，不計正式出席',
      preview: '測試預覽，尚未記錄出席',
      completed: '測試已完成',
      unavailable: '測試未開放',
      code: '短效測試碼',
      gps: '真實 GPS、身份、同意與開放時段'
    },
    zh_CN: {
      formal: '正式出席签到：提交后由后端验证并记录',
      test: '仅供测试，不计正式出席',
      preview: '测试预览，尚未记录出席',
      completed: '测试已完成',
      unavailable: '测试未开放',
      code: '短效测试码',
      gps: '真实 GPS、身份、同意与开放时段'
    },
    en: {
      formal: 'Live check-in: the server verifies and records attendance',
      test: 'Testing only; excluded from formal attendance',
      preview: 'Test preview — attendance has NOT been recorded',
      completed: 'Test complete',
      unavailable: 'Testing unavailable',
      code: 'Short-lived test code',
      gps: 'Real GPS, identity, consent and opening hours'
    }
  };
  const notice = (html: string) => /<p id="preview-notice"[^>]*>([^<]*)<\/p>/.exec(html)?.[1];
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'renders actual %s notice nodes from server mode, not unused dictionaries',
    async (lang) => {
      const t = labels[lang];
      for (const scope of ['tw-location-test', 'tw-taipei-cks', null] as const) {
        const ui = makeBrowser(true, 'tw-location-test', scope, lang);
        expect(notice(ui.html)).toBe(t.test);
        const markup = ui.html.split('<script')[0]!;
        expect(markup.split(t.test)).toHaveLength(2);
        expect(markup).not.toContain(t.formal);
        await setImmediate();
        expect(ui.get('preview-notice').textContent).toBe(t.test);
        if (scope !== 'tw-location-test') {
          const unavailable = /<p id="preview-status"[^>]*>([^<]*)<\/p>/.exec(markup)?.[1];
          expect(unavailable).toBeTruthy();
          expect(markup.split(unavailable!)).toHaveLength(2);
          expect(ui.get('preview-status').textContent).toBe(unavailable);
          expect(ui.get('preview-test').textContent).toBe(t.unavailable);
          expect(ui.get('preview-test').attributes['aria-busy']).toBe('false');
          expect(ui.get('preview-test').disabled).toBe(true);
        } else {
          expect(markup).toContain('<summary>' + t.code + '</summary>');
          expect(markup).toContain(t.gps);
        }
      }
      const formal = makeBrowser(false, 'tw-taipei-cks', null, lang);
      expect(notice(formal.html)).toBe(t.formal);
      await setImmediate();
      expect(formal.get('preview-notice').textContent).toBe(t.formal);
      const preview = renderVenuePreview(
        '123-test',
        { venue: 'tw-location-test', lang },
        'preview'
      );
      expect(notice(preview)).toBe(t.preview);
      expect(preview.split('<script')[0]).not.toContain(t.formal);
      expect(notice(renderVenuePreview('123-test', null, 'checkin'))).not.toBe(t.formal);
    }
  );
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'keeps %s opt-in notice and final test label consistent, including retries',
    async (lang) => {
      const ui = makeBrowser(true, 'tw-taipei-cks', 'tw-taipei-cks', lang);
      const t = labels[lang];
      await setImmediate();
      expect(ui.get('preview-notice').textContent).toBe(t.formal);
      const toggle = ui.get('preview-debug-enabled');
      toggle.checked = true;
      toggle.onchange?.();
      expect(ui.get('preview-notice').textContent).toBe(t.test);
      toggle.checked = false;
      toggle.onchange?.();
      expect(ui.get('preview-notice').textContent).toBe(t.formal);
      toggle.checked = true;
      toggle.onchange?.();
      ui.get('preview-test').onclick?.();
      expect(ui.geo).not.toHaveBeenCalled();
      expect(ui.get('preview-notice').textContent).toBe(t.test);
      ui.get('preview-debug-token').value = token;
      ui.get('preview-test').onclick?.();
      expect(ui.get('preview-test').attributes['aria-busy']).toBe('true');
      ui.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error: 'venue_debug_denied' }), { status: 403 })
      );
      await (ui.geo.mock.calls[0]![0] as (position: unknown) => Promise<void>)({
        coords: { latitude: 25, longitude: 121 }
      });
      expect(ui.get('preview-notice').textContent).toBe(t.test);
      expect(ui.get('preview-test').disabled).toBe(false);
      expect(ui.get('preview-test').attributes['aria-busy']).toBe('false');
      expect(ui.get('preview-history').hidden).toBe(true);
      ui.get('preview-debug-token').value = token;
      ui.get('preview-test').onclick?.();
      ui.get('preview-test').disabled = false;
      ui.get('preview-test').onclick?.();
      expect(ui.geo).toHaveBeenCalledTimes(2);
      await (ui.geo.mock.calls[1]![0] as (position: unknown) => Promise<void>)({
        coords: { latitude: 25, longitude: 121 }
      });
      expect(ui.get('preview-test').textContent).toBe(t.completed);
      expect(ui.get('preview-test').disabled).toBe(true);
      expect(ui.get('preview-test').attributes['aria-busy']).toBe('false');
      expect(ui.get('preview-notice').textContent).toBe(t.test);
      const result = ui.get('preview-status').textContent;
      // Even an artificial post-success toggle event must not reinterpret the result.
      toggle.checked = false;
      toggle.onchange?.();
      expect(ui.get('preview-notice').textContent).toBe(t.test);
      expect(ui.get('preview-status').textContent).toBe(result);
      expect(ui.get('preview-history').hidden).toBe(false);
      expect(ui.forbidden).not.toHaveBeenCalled();
    }
  );
  it('does not authorize a test result without the opt-in/header merely because HTTP was 200', async () => {
    const ui = makeBrowser(true);
    await setImmediate();
    ui.get('preview-test').onclick?.();
    await (ui.geo.mock.calls[0]![0] as (position: unknown) => Promise<void>)({
      coords: { latitude: 25, longitude: 121 }
    });
    expect(ui.fetch.mock.calls[0]![1].headers).not.toHaveProperty('X-Venue-Debug-Token');
    expect(ui.get('preview-test').textContent).toBe('確認位置並簽到');
    expect(ui.get('preview-test').disabled).toBe(false);
    expect(ui.get('preview-history').hidden).toBe(true);
    expect(ui.get('preview-status').textContent).toContain('無法確認結果');
    expect(ui.get('preview-notice').textContent).toBe(labels.zh_TW.formal);
  });
});

describe('memory-only distance debug controller', () => {
  it('requests actual GPS on click, sends token only in header, clears input, labels test success', async () => {
    const ui = makeBrowser();
    await setImmediate();
    expect(ui.geo).not.toHaveBeenCalled();
    expect(ui.fetch).not.toHaveBeenCalled();
    ui.get('preview-debug-enabled').checked = true;
    ui.get('preview-debug-token').value = token;
    ui.get('preview-test').onclick!();
    expect(ui.get('preview-debug-token').value).toBe('');
    expect(ui.geo).toHaveBeenCalledOnce();
    await (ui.geo.mock.calls[0]![0] as (position: unknown) => Promise<void>)({
      coords: { latitude: -33.123456, longitude: 140.987654 }
    });
    const [url, options] = ui.fetch.mock.calls[0]!;
    expect(url).toBe('/api/line/venue-checkin');
    expect(options.headers).toMatchObject({ 'X-Venue-Debug-Token': token });
    expect(JSON.parse(options.body)).toEqual({
      idToken: 'synthetic-id-token',
      venue: 'tw-taipei-cks',
      latitude: -33.123456,
      longitude: 140.987654
    });
    expect(options.body).not.toContain(token);
    expect(ui.get('preview-status').textContent).toContain('異地測試，未計入正式出席');
    expect(ui.get('preview-status').textContent).not.toContain('出席已記錄');
    expect(ui.html).not.toContain(token);
    expect(ui.html).toContain('/line/checkin?lang=zh_TW');
    expect(ui.forbidden).not.toHaveBeenCalled();
  });
  it.each(['tw-location-test', 'tw-taipei-cks'] as const)(
    'clears manual code on pagehide (%s)',
    async (venue) => {
      const ui = makeBrowser(true, venue, venue);
      await setImmediate();
      ui.get('preview-debug-enabled').checked = true;
      ui.get('preview-debug-token').value = token;
      const hide = ui.pagehide.mock.calls.find(([event]) => event === 'pagehide')![1] as () => void;
      hide();
      expect(ui.get('preview-debug-token').value).toBe('');
      expect(ui.get('preview-debug-enabled').checked).toBe(venue === 'tw-location-test');
      expect(ui.fetch).not.toHaveBeenCalled();
      expect(ui.forbidden).not.toHaveBeenCalled();
    }
  );
  it('matching test site posts only test mode and displays no formal success', async () => {
    const ui = makeBrowser(true, 'tw-location-test', 'tw-location-test');
    await setImmediate();
    ui.get('preview-debug-token').value = token;
    ui.get('preview-test').onclick!();
    await (ui.geo.mock.calls[0]![0] as (position: unknown) => Promise<void>)({
      coords: { latitude: -25, longitude: 121 }
    });
    expect(JSON.parse(ui.fetch.mock.calls[0]![1].body)).toMatchObject({
      venue: 'tw-location-test',
      latitude: -25,
      longitude: 121
    });
    expect(ui.get('preview-status').textContent).toContain('異地測試，未計入正式出席');
    expect(ui.get('preview-status').textContent).not.toContain('出席已記錄');
    expect(ui.get('preview-test').disabled).toBe(true);
  });
  it('no token preserves normal GPS flow and never sends a debug header', async () => {
    const ui = makeBrowser(false);
    await setImmediate();
    ui.get('preview-test').onclick!();
    await (ui.geo.mock.calls[0]![0] as (position: unknown) => Promise<void>)({
      coords: { latitude: 25, longitude: 121 }
    });
    expect(ui.fetch.mock.calls[0]![1].headers).not.toHaveProperty('X-Venue-Debug-Token');
    expect(ui.get('preview-status').textContent).toContain('出席已記錄');
  });
  it('never silently downgrades an empty test token or mislabeled response into formal success', async () => {
    const ui = makeBrowser(false);
    await setImmediate();
    ui.get('preview-debug-enabled').checked = true;
    ui.get('preview-test').onclick!();
    expect(ui.geo).not.toHaveBeenCalled();
    expect(ui.get('preview-status').textContent).toContain('測試碼無效');
    ui.get('preview-debug-token').value = token;
    ui.get('preview-test').onclick!();
    await (ui.geo.mock.calls[0]![0] as (position: unknown) => Promise<void>)({
      coords: { latitude: -25, longitude: 121 }
    });
    expect(ui.get('preview-status').textContent).not.toContain('出席已記錄');
    expect(ui.get('preview-test').disabled).toBe(false);
  });
  it.each(['tw-taipei-cks', null] as const)(
    'blocks the test site when scope is unavailable (%s), even if disabled is bypassed',
    async (selected) => {
      const ui = makeBrowser(true, 'tw-location-test', selected);
      await setImmediate();
      expect(ui.html).toContain('僅供測試，不計正式出席');
      expect(ui.html).not.toContain('id="preview-debug-token"');
      expect(ui.get('preview-test').disabled).toBe(true);
      ui.get('preview-test').disabled = false;
      ui.get('preview-test').onclick!();
      expect(ui.geo).not.toHaveBeenCalled();
      expect(ui.fetch).not.toHaveBeenCalled();
      expect(ui.get('preview-status').textContent).toContain('尚未開放');
    }
  );
  it('test site always requires manual code and cannot toggle into standard success', async () => {
    const ui = makeBrowser(false, 'tw-location-test', 'tw-location-test');
    await setImmediate();
    expect(ui.html).toContain('僅供測試，不計正式出席');
    expect(ui.html).toContain('checked disabled hidden');
    ui.get('preview-debug-enabled').checked = false;
    ui.get('preview-test').onclick!();
    expect(ui.geo).not.toHaveBeenCalled();
    ui.get('preview-debug-token').value = token;
    ui.get('preview-test').onclick!();
    ui.get('preview-test').onclick!();
    expect(ui.geo).toHaveBeenCalledOnce();
    await (ui.geo.mock.calls[0]![0] as (position: unknown) => Promise<void>)({
      coords: { latitude: -25, longitude: 121 }
    });
    expect(ui.fetch.mock.calls[0]![1].headers).toMatchObject({ 'X-Venue-Debug-Token': token });
    expect(ui.get('preview-status').textContent).not.toContain('出席已記錄');
    expect(ui.forbidden).not.toHaveBeenCalled();
  });
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'localizes test-only notice and manual controls (%s)',
    (lang) => {
      const html = renderVenuePreview(
        '123-test',
        { venue: 'tw-location-test', lang },
        'checkin',
        true,
        'tw-location-test'
      );
      expect(html).toContain(
        {
          zh_TW: '僅供測試，不計正式出席',
          zh_CN: '仅供测试，不计正式出席',
          en: 'Testing only; excluded from formal attendance'
        }[lang]
      );
      expect(html).toContain('id="preview-debug-token"');
    }
  );
  it('renders controls only for enabled test venue and rejects URL token/boolean authority', () => {
    const entry = { venue: 'tw-taipei-cks', lang: 'zh_TW' as const };
    for (const html of [
      renderVenuePreview('123-test', entry, 'checkin'),
      renderVenuePreview(
        '123-test',
        { ...entry, venue: 'tw-other' },
        'checkin',
        true,
        'tw-taipei-cks'
      ),
      renderVenuePreview(
        '123-test',
        { ...entry, venue: 'tw-location-test' },
        'checkin',
        true,
        'tw-taipei-cks'
      ),
      renderVenuePreview('123-test', entry, 'preview', true, 'tw-taipei-cks')
    ])
      expect(html).not.toContain('id="preview-debug-token"');
    for (const query of ['token=secret', 'debug=true', 'isTest=true', 'X-Venue-Debug-Token=secret'])
      expect(venuePreviewRequest('/line/venue-checkin?venue=tw-taipei-cks&' + query)).toEqual({
        kind: 'invalid'
      });
  });
});
