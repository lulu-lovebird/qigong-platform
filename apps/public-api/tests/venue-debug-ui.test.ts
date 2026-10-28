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
}
const token = 'synthetic-manual-memory-only-debug-token';
const makeBrowser = (
  isTest = true,
  venue = 'tw-taipei-cks',
  selected: 'tw-location-test' | 'tw-taipei-cks' | null = 'tw-taipei-cks'
) => {
  const html = renderVenuePreview(
    '123-test',
    { venue, lang: 'zh_TW' },
    'checkin',
    true,
    selected ?? undefined
  );
  const nodes = new Map<string, NodeStub>();
  const get = (id: string) => {
    if (!nodes.has(id))
      nodes.set(id, { textContent: '', value: '', checked: false, disabled: false, hidden: true });
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
      return {
        ok: true,
        json: async () => ({
          ok: true,
          venue: { code: 'tw-taipei-cks', name: '合成場地', timezone: 'Asia/Taipei' },
          checkedInAt: '2026-10-27T00:00:00Z',
          ...(isTest ? { isTest: true, verificationMode: 'distance_debug' } : {})
        })
      };
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
