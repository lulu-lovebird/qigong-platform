import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { renderWhatsAppVenuePage } from '../src/whatsapp-venue-pages.js';
const config = {
  enabled: true as const,
  publicOrigin: 'https://checkin.baiyinqigong.org' as const,
  publicPhoneNumber: '60110000000'
};
const availability = {
  status: 200,
  body: {
    version: 1,
    availability: 'open',
    venue: { code: 'my-demo-hall', name: 'Synthetic hall', timezone: 'Asia/Kuala_Lumpur' },
    observedAt: '2026-11-16T00:10:00Z',
    relevantSession: {
      opensAt: '2026-11-15T23:30:00Z',
      startsAt: '2026-11-16T00:00:00Z',
      endsAt: '2026-11-16T01:00:00Z'
    },
    nextSession: null
  }
};
const receipt = {
  ok: true,
  venue: availability.body.venue,
  checkedInAt: '2026-11-16T00:10:00Z',
  attendanceDate: '2026-11-16',
  replayed: false
};
interface Node {
  hidden: boolean;
  disabled: boolean;
  checked: boolean;
  value: string;
  textContent: string;
  className: string;
  children: Node[];
  onclick?: () => void | Promise<void>;
  onchange?: () => void;
  append: (...n: Node[]) => void;
  replaceChildren: (...n: Node[]) => void;
  classList: { add: (name: string) => void };
}
const tick = async () => {
  await setImmediate();
  await setImmediate();
};
const fixture = (
  options: {
    page?: 'checkin' | 'history';
    authenticated?: boolean;
    receipt?: unknown;
    failSave?: boolean;
    gpsError?: boolean;
    closed?: boolean;
    pendingGps?: boolean;
  } = {}
) => {
  const page = options.page ?? 'checkin';
  const guidance = options.closed
    ? { ...availability, body: { ...availability.body, availability: 'before_open' } }
    : availability;
  const html = renderWhatsAppVenuePage(config, page, 'zh_TW', 'my-demo-hall', 'nfc', guidance);
  const nodes = new Map<string, Node>();
  const node = (): Node => {
    const n: Node = {
      hidden: false,
      disabled: false,
      checked: false,
      value: '',
      textContent: '',
      className: '',
      children: [],
      append: (...a) => {
        n.children.push(...a);
      },
      replaceChildren: (...a) => {
        n.children = a;
      },
      classList: { add: () => {} }
    };
    return n;
  };
  for (const match of html.matchAll(/<\w+[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const n = node();
    n.hidden = /\shidden(?:\s|>)/.test(match[0]);
    n.disabled = /\sdisabled(?:\s|>)/.test(match[0]);
    nodes.set(match[1]!, n);
  }
  const get = (id: string) => {
    const n = nodes.get(id);
    if (!n) throw Error('Missing test node ' + id);
    return n;
  };
  const document = {
    cookie: '__Host-qigong-whatsapp-csrf=' + 'c'.repeat(43),
    getElementById: (id: string) => nodes.get(id) ?? null,
    querySelectorAll: () => [],
    createElement: node
  };
  let authenticated = options.authenticated ?? true;
  let resolveGps:
    ((position: { coords: { latitude: number; longitude: number } }) => void) | undefined;
  const gps = vi.fn(
    (
      resolve: (p: { coords: { latitude: number; longitude: number } }) => void,
      reject: () => void
    ) => {
      if (options.pendingGps) {
        resolveGps = resolve;
        return;
      }
      if (options.gpsError) reject();
      else resolve({ coords: { latitude: 3, longitude: 101 } });
    }
  );
  const fetch = vi.fn<typeof globalThis.fetch>(async (path, init) => {
    const url = typeof path === 'string' ? path : path instanceof URL ? path.href : path.url;
    if (url === '/whatsapp/auth/session') {
      if (init?.method === 'POST') authenticated = true;
      return Response.json(
        { authenticated, remembered: true, expiresAt: '2026-12-01T00:00:00Z' },
        { status: authenticated ? 200 : 401 }
      );
    }
    if (url.startsWith('/api/whatsapp/venue-availability')) return Response.json(guidance.body);
    if (url === '/api/whatsapp/venue-entry-status')
      return Response.json({ version: 1, status: 'approved', privacy: 'clear' });
    if (url === '/api/whatsapp/venue-checkin')
      return options.failSave
        ? Response.json({ error: 'venue_result_unconfirmed' }, { status: 503 })
        : Response.json(options.receipt ?? receipt);
    if (url === '/api/whatsapp/venue-history')
      return Response.json({
        ok: true,
        dateBasis: 'venue_local_date',
        totals: { attendanceCount: 1, attendanceDays: 1, monthCount: 1 },
        page: 1,
        pageSize: 20,
        hasMore: false,
        entries: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            venueCode: 'my-demo-hall',
            venueName: '<img src=x onerror=attack>',
            checkedInAt: receipt.checkedInAt,
            venueLocalDate: receipt.attendanceDate,
            venueTimezone: receipt.venue.timezone
          }
        ]
      });
    throw Error('Unexpected mock URL ' + url);
  });
  const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  const replace = vi.fn(),
    reload = vi.fn(),
    replaceState = vi.fn();
  const context = vm.createContext({
    document,
    fetch,
    navigator: { geolocation: { getCurrentPosition: gps } },
    AbortSignal,
    URL,
    URLSearchParams,
    Intl,
    location: {
      hash: '#' + 't'.repeat(43),
      pathname: '/whatsapp/venue-' + page,
      search: '?venue=my-demo-hall&source=nfc&lang=zh_TW',
      origin: config.publicOrigin,
      replace,
      reload
    },
    history: { replaceState },
    window: {
      addEventListener: (name: string, fn: (event: Record<string, unknown>) => void) => {
        listeners.set(name, [...(listeners.get(name) ?? []), fn]);
      }
    }
  });
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
    new vm.Script(match[1]!).runInContext(context);
  return {
    html,
    get,
    fetch,
    gps,
    document,
    replace,
    replaceState,
    listeners,
    finishGps: () => {
      if (!resolveGps) throw Error('GPS not requested');
      resolveGps({ coords: { latitude: 3, longitude: 101 } });
    }
  };
};
describe('live WhatsApp venue scripts with synthetic auth/network/GPS only', () => {
  it('does not locate or exchange a token on authenticated page load', async () => {
    const f = fixture();
    await tick();
    expect(f.gps).not.toHaveBeenCalled();
    expect(f.get('wa-venue-submit').disabled).toBe(false);
    expect(
      f.fetch.mock.calls.filter(([p, i]) => p === '/whatsapp/auth/session' && i?.method === 'POST')
    ).toHaveLength(0);
    expect(f.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/whatsapp/venue-checkin?venue=my-demo-hall&source=nfc&lang=zh_TW'
    );
  });
  it('shows anonymous login and a bounded business-chat link without locating', async () => {
    const f = fixture({ authenticated: false });
    await tick();
    expect(f.get('wa-login-panel').hidden).toBe(false);
    expect(f.get('wa-venue-action').hidden).toBe(true);
    expect(f.gps).not.toHaveBeenCalled();
    expect(f.html).toContain('https://wa.me/60110000000?');
  });
  it('sends location only after a deliberate click and shows a stamp after a valid save', async () => {
    const f = fixture();
    await tick();
    await f.get('wa-venue-submit').onclick?.();
    expect(f.gps).toHaveBeenCalledTimes(1);
    const writes = f.fetch.mock.calls.filter(([p]) => p === '/api/whatsapp/venue-checkin');
    expect(writes).toHaveLength(1);
    const body = writes[0]![1]!.body;
    if (typeof body !== 'string') throw Error('Expected JSON request body');
    expect(JSON.parse(body)).toEqual({
      venue: 'my-demo-hall',
      latitude: 3,
      longitude: 101
    });
    expect(f.get('wa-venue-stamp').hidden).toBe(false);
    expect(f.get('wa-venue-submit').disabled).toBe(true);
    expect(f.get('wa-venue-status').textContent).toContain('打卡成功');
  });
  it.each([
    { receipt: { ok: true } },
    { receipt: { ...receipt, isTest: true, verificationMode: 'distance_debug' } },
    { receipt: { ...receipt, venue: { ...receipt.venue, code: 'sg-another-hall' } } },
    { failSave: true }
  ])('keeps malformed or unconfirmed saves uncertain: %j', async (options) => {
    const f = fixture(options);
    await tick();
    await f.get('wa-venue-submit').onclick?.();
    expect(f.get('wa-venue-stamp').hidden).toBe(true);
    expect(f.get('wa-venue-status').textContent).toContain('尚未確認');
  });
  it('does not call the writer on GPS rejection', async () => {
    const f = fixture({ gpsError: true });
    await tick();
    await f.get('wa-venue-submit').onclick?.();
    expect(f.fetch.mock.calls.filter(([p]) => p === '/api/whatsapp/venue-checkin')).toHaveLength(0);
    expect(f.get('wa-venue-status').textContent).toContain('尚未送出');
  });
  it('blocks duplicate clicks and aborts on a cross-tab credential change during GPS', async () => {
    const f = fixture({ pendingGps: true });
    await tick();
    const saving = f.get('wa-venue-submit').onclick?.();
    await tick();
    await f.get('wa-venue-submit').onclick?.();
    expect(f.gps).toHaveBeenCalledTimes(1);
    f.document.cookie = '__Host-qigong-whatsapp-csrf=' + 'x'.repeat(43);
    f.finishGps();
    await saving;
    expect(f.fetch.mock.calls.filter(([p]) => p === '/api/whatsapp/venue-checkin')).toHaveLength(0);
    expect(f.get('wa-venue-stamp').hidden).toBe(true);
  });
  it('closed pages only clear the private fragment without login or GPS', async () => {
    const f = fixture({ closed: true });
    await tick();
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.gps).not.toHaveBeenCalled();
    expect(f.html).toContain('schedule-warning');
    expect(f.html).not.toContain('id="wa-login-panel"');
  });
  it('renders history as text, without locating or HTML injection', async () => {
    const f = fixture({ page: 'history' });
    await tick();
    expect(f.gps).not.toHaveBeenCalled();
    expect(f.get('wa-history-entries').children[0]!.children[0]!.textContent).toBe(
      '<img src=x onerror=attack>'
    );
    expect(f.get('wa-history-page').textContent).toBe('1');
    expect(f.html).not.toContain('innerHTML');
  });
  it('clears history instead of silently switching identity after a cross-tab login', async () => {
    const f = fixture({ page: 'history' });
    await tick();
    expect(f.get('wa-history-entries').children).toHaveLength(1);
    f.document.cookie = '__Host-qigong-whatsapp-csrf=' + 'x'.repeat(43);
    await f.get('wa-history-apply').onclick?.();
    await tick();
    expect(f.get('wa-history-entries').children).toHaveLength(0);
    expect(f.get('wa-venue-action').hidden).toBe(true);
    expect(f.fetch.mock.calls.filter(([p]) => p === '/api/whatsapp/venue-history')).toHaveLength(1);
  });
  it.each(['zh_TW', 'zh_CN', 'en'] as const)('renders syntax-valid scripts for %s', (locale) => {
    const html = renderWhatsAppVenuePage(
      config,
      'checkin',
      locale,
      'my-demo-hall',
      'nfc',
      availability
    );
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
      expect(() => new vm.Script(match[1]!)).not.toThrow();
    expect(html).not.toMatch(/localStorage|sessionStorage|sendMessages|liff\./);
  });
});
