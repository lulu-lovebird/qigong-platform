import { setImmediate } from 'node:timers/promises';
import { Script } from 'node:vm';
import type { Pool } from '@qigong/database';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { LineConfig } from '../src/line-onboarding.js';
import { renderChannelWorkspacePage } from '../src/channel-workspace-pages.js';
import {
  renderVenuePreview,
  formatVenueEntrySession,
  venueGuidancePresentation,
  validateVenueGuidanceResult,
  type VenuePreviewGuidance,
  venuePreviewRequest,
  venuePreviewUrl
} from '../src/line-venue-checkin-page.js';

import type {
  VenueEntryAvailabilityDto,
  VenueEntryAvailabilityResult,
  VenueEntrySelfStatusDto
} from '../src/venue-entry-guidance.js';

const guidedCode = 'us-practice-hall';
const guidedSession = {
  startsAt: '2026-10-31T03:45:00Z',
  endsAt: '2026-10-31T05:00:00Z',
  opensAt: '2026-10-31T03:15:00Z'
};
const guidedAvailability = (
  state: VenueEntryAvailabilityDto['availability'] = 'open'
): VenueEntryAvailabilityDto => ({
  version: 1,
  availability: state,
  venue:
    state === 'not_found'
      ? null
      : { code: guidedCode, name: 'Original 場地 <b> & name', timezone: 'America/New_York' },
  observedAt: '2026-10-31T04:00:00Z',
  relevantSession: ['open', 'before_open', 'ended'].includes(state) ? guidedSession : null,
  nextSession: null
});
const guidedResult = (
  state: VenueEntryAvailabilityDto['availability'] = 'open'
): VenueEntryAvailabilityResult =>
  state === 'unavailable'
    ? { status: 503, body: { error: 'venue_entry_unavailable' } }
    : {
        status: state === 'disabled' ? 410 : state === 'not_found' ? 404 : 200,
        body: guidedAvailability(state)
      };
const guidedHtml = (
  options: {
    guidance?: VenuePreviewGuidance;
    lang?: 'en' | 'zh_TW' | 'zh_CN';
    code?: string;
    liffId?: string;
  } = {}
) =>
  renderVenuePreview(
    options.liffId ?? 'mock-liff',
    { venue: options.code ?? guidedCode, source: 'nfc', lang: options.lang ?? 'en' },
    'checkin',
    true,
    undefined,
    options.guidance ?? { result: guidedResult() }
  );
const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
/** Standalone opt-in VM: never assume legacy lineLoginScript or hit real SDK/network. */
const guidedBrowser = (
  html = guidedHtml(),
  options: {
    loggedIn?: boolean;
    self?: VenueEntrySelfStatusDto;
    fetch?: (url: string, init?: RequestInit) => Promise<Response>;
    init?: () => Promise<void>;
    geolocation?: boolean;
  } = {}
) => {
  const nodes = new Map<
    string,
    {
      textContent: string;
      disabled: boolean;
      hidden: boolean;
      value: string;
      attributes: Record<string, string>;
      setAttribute: (name: string, value: string) => void;
      onclick?: () => Promise<void>;
      onchange?: () => void;
    }
  >();
  const get = (id: string) => {
    let node = nodes.get(id);
    if (!node) {
      const tag = new RegExp('<[^>]+id="' + id + '"[^>]*>').exec(html)?.[0];
      if (!tag) throw Error('Missing synthetic element: ' + id);
      node = {
        textContent: '',
        disabled: tag.includes(' disabled'),
        hidden: tag.includes(' hidden'),
        value: 'en',
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        }
      };
      nodes.set(id, node);
    }
    return node;
  };
  const liff = {
    init: vi.fn(options.init ?? (async () => {})),
    isLoggedIn: vi.fn(() => options.loggedIn ?? true),
    getIDToken: vi.fn(() => 'synthetic-guided-memory-token'),
    login: vi.fn(),
    getProfile: vi.fn(),
    sendMessages: vi.fn()
  };
  const fetch = vi.fn(
    options.fetch ??
      (async (url: string) => {
        if (url === '/api/line/venue-entry-status')
          return jsonResponse(options.self ?? { version: 1, status: 'approved', privacy: 'clear' });
        if (url === '/api/venue-entry/availability?venue=' + guidedCode)
          return jsonResponse(guidedAvailability());
        throw new Error('Unmatched synthetic fetch: ' + url);
      })
  );
  const geo =
    vi.fn<
      (
        success: (position: { coords: { latitude: number; longitude: number } }) => void,
        error: (error: { code: number }) => void,
        settings: unknown
      ) => void
    >();
  const storage = {
    getItem: vi.fn(() => {
      throw new Error('Storage forbidden');
    }),
    setItem: vi.fn(() => {
      throw new Error('Storage forbidden');
    })
  };
  const log = vi.fn(() => {
    throw new Error('Logging forbidden');
  });
  const handlers = new Map<string, () => void>();
  const location = {
    href:
      'https://app.test/line/venue-checkin?venue=' +
      guidedCode +
      '&source=nfc&lang=en&code=private-callback#private-fragment',
    origin: 'https://app.test',
    replace: vi.fn()
  };
  const history = { replaceState: vi.fn() };
  const document = { getElementById: get, cookie: '' };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (script)
    new Script(script).runInNewContext({
      URL,
      URLSearchParams,
      Response,
      document,
      location,
      history,
      liff,
      fetch,
      navigator: options.geolocation === false ? {} : { geolocation: { getCurrentPosition: geo } },
      localStorage: storage,
      sessionStorage: storage,
      console: { log, warn: log, error: log },
      addEventListener: (name: string, callback: () => void) => handlers.set(name, callback)
    });
  return { get, liff, fetch, geo, storage, log, handlers, location, history, document };
};
const guidedTick = () => setImmediate();
const guidedClick = (ui: ReturnType<typeof guidedBrowser>) => ui.get('guided-checkin').onclick?.();

// All guidance tests below are unit/VM probes, NOT phone/NFC/provider acceptance.
describe('server-owned opt-in venue guidance', () => {
  it.each([
    'before_open',
    'ended',
    'not_activity_day',
    'disabled',
    'not_found',
    'unavailable'
  ] as const)('closed %s is entirely static, including when history/debug are enabled', (state) => {
    const html = guidedHtml({ guidance: { result: guidedResult(state) } });
    expect(html).not.toMatch(
      /<(?:a|button|input|select|script)\b|sdk\.js|navigator|fetch\(|getIDToken|lineLoginScript/
    );
    expect(html).toContain('Bean, Bird &amp; Badminton Tech Consulting');
    if (state !== 'not_found' && state !== 'unavailable')
      expect(html).toContain('Original 場地 &lt;b&gt; &amp; name');
  });
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'formats full local %s dates rather than phone dates, without translating proper names',
    (lang) => {
      const time = formatVenueEntrySession(guidedSession, 'America/New_York', lang);
      expect(time).not.toBeNull();
      const formatter = new Intl.DateTimeFormat(
        lang === 'zh_TW' ? 'zh-Hant' : lang === 'zh_CN' ? 'zh-Hans' : 'en',
        {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23'
        }
      );
      expect(time?.opensAt).toBe(formatter.format(new Date(guidedSession.opensAt)));
      expect(time?.startsAt).toBe(formatter.format(new Date(guidedSession.startsAt)));
      expect(time?.endsAt).toBe(formatter.format(new Date(guidedSession.endsAt)));
      const html = guidedHtml({ lang, guidance: { result: guidedResult('before_open') } });
      expect(html).toContain(time!.opensAt);
      expect(html).toContain(time!.endsAt);
      expect(html).toContain('America/New_York');
      expect(html).toContain('Original 場地 &lt;b&gt; &amp; name');
      expect(html).not.toContain('midnight');
    }
  );
  it('shows next session only when supplied, with unknown rather than fabricated times', () => {
    const next = {
      startsAt: '2026-11-02T04:15:00Z',
      opensAt: '2026-11-02T03:45:00Z',
      endsAt: '2026-11-02T05:30:00Z'
    };
    const body = { ...guidedAvailability('not_activity_day'), nextSession: next };
    const html = guidedHtml({ guidance: { result: { status: 200, body } } });
    expect(html).toContain('Next practice');
    expect(html).toContain(formatVenueEntrySession(next, 'America/New_York', 'en')!.startsAt);
    expect(guidedHtml({ guidance: { result: guidedResult('not_activity_day') } })).toContain(
      'Next session unknown'
    );
    expect(formatVenueEntrySession(guidedSession, 'invalid/timezone', 'en')).toBeNull();
    expect(formatVenueEntrySession({ ...guidedSession, endsAt: 'bad' }, 'UTC', 'en')).toBeNull();
  });
  it.each([
    null,
    {},
    { status: 200, body: null },
    { status: 410, body: guidedAvailability() },
    { status: 200, body: { ...guidedAvailability(), extra: 'private' } },
    {
      status: 200,
      body: {
        ...guidedAvailability(),
        venue: { code: 'other-hall', name: 'Other', timezone: 'UTC' }
      }
    },
    {
      status: 200,
      body: {
        ...guidedAvailability(),
        venue: { code: guidedCode, name: 'Name', timezone: 'bad/zone' }
      }
    },
    { status: 200, body: { ...guidedAvailability(), relevantSession: null } },
    { status: 400, body: { error: 'invalid_venue_entry_request' } },
    { status: 503, body: { error: 'leaked-provider-error' } }
  ])('malformed or inconsistent server guidance fails closed: %#', (result) => {
    const html = guidedHtml({ guidance: { result: result as VenueEntryAvailabilityResult } });
    expect(html).not.toMatch(/<script|<a\b|<button|<select|leaked-provider/);
    expect(html).toContain('Venue lookup unavailable');
  });
  it('invalid entries have no SDK, and public test venue has no guided bypass', () => {
    expect(
      renderVenuePreview('mock-liff', null, 'checkin', true, undefined, {
        result: guidedResult(),
        isPrimaryBootstrap: true
      })
    ).not.toContain('<script');
    expect(guidedHtml({ code: '<script>bad</script>' })).not.toContain('<script');
    const result: VenueEntryAvailabilityResult = {
      status: 200,
      body: {
        ...guidedAvailability(),
        venue: { code: 'tw-location-test', name: 'Test', timezone: 'UTC' }
      }
    };
    const html = renderVenuePreview(
      'mock-liff',
      { venue: 'tw-location-test', lang: 'en' },
      'checkin',
      true,
      'tw-location-test',
      { result }
    );
    expect(html).not.toMatch(/<script|<button|<input|<a\b/);
    expect(html).toContain('Venue lookup unavailable');
    expect(validateVenueGuidanceResult(result, 'tw-location-test')).toEqual({
      status: 503,
      body: { error: 'venue_entry_unavailable' }
    });
    const primary = guidedHtml({
      code: 'tw-location-test',
      guidance: { result, isPrimaryBootstrap: true }
    });
    expect(primary).toContain('Venue lookup unavailable');
    expect(primary).not.toMatch(/<script|<button|<input|<a\b|Check-in is open/);
  });
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'preserves the canonical disabled sentinel name and reason in %s without actions',
    (lang) => {
      const result: VenueEntryAvailabilityResult = {
        status: 410,
        body: {
          ...guidedAvailability('disabled'),
          venue: { code: 'tw-location-test', name: 'Canonical test & name', timezone: 'UTC' }
        }
      };
      const view = venueGuidancePresentation(result, 'tw-location-test', lang);
      expect(view.result).toEqual(result);
      expect(view.open).toBe(false);
      const html = guidedHtml({ code: 'tw-location-test', lang, guidance: { result } });
      expect(html).toContain('Canonical test &amp; name');
      expect(html).toContain(
        lang === 'en' ? 'Venue disabled' : lang === 'zh_TW' ? '場地已停用' : '场地已停用'
      );
      expect(html).not.toMatch(/<(?:script|button|input|select|a)\b|Check-in is open/);
    }
  );
  it.each([
    'before_open',
    'ended',
    'not_activity_day',
    'disabled',
    'not_found',
    'unavailable'
  ] as const)(
    'closed primary %s initializes only when canonical guidance is available',
    async (state) => {
      const ui = guidedBrowser(
        guidedHtml({ guidance: { result: guidedResult(state), isPrimaryBootstrap: true } })
      );
      await guidedTick();
      expect(ui.liff.init).toHaveBeenCalledTimes(state === 'unavailable' ? 0 : 1);
      if (state !== 'unavailable')
        expect(ui.liff.init).toHaveBeenCalledWith({
          liffId: 'mock-liff',
          withLoginOnExternalBrowser: false
        });
      for (const forbidden of [
        ui.fetch,
        ui.geo,
        ui.liff.getIDToken,
        ui.liff.login,
        ui.location.replace
      ])
        expect(forbidden).not.toHaveBeenCalled();
    }
  );
  it('primary performs init only, leaving all navigation to official SDK', async () => {
    const ui = guidedBrowser(
      guidedHtml({ guidance: { result: guidedResult(), isPrimaryBootstrap: true } })
    );
    await guidedTick();
    expect(ui.liff.init).toHaveBeenCalledExactlyOnceWith({
      liffId: 'mock-liff',
      withLoginOnExternalBrowser: false
    });
    for (const forbidden of [
      ui.liff.isLoggedIn,
      ui.liff.login,
      ui.liff.getIDToken,
      ui.liff.getProfile,
      ui.liff.sendMessages,
      ui.fetch,
      ui.geo,
      ui.history.replaceState,
      ui.location.replace
    ])
      expect(forbidden).not.toHaveBeenCalled();
  });
  it('escapes proper names in HTML; inline configuration uses scriptJson, never raw DTOs', () => {
    const body = {
      ...guidedAvailability(),
      venue: {
        code: guidedCode,
        name: '</script><script>attack()</script> & \u2028\u2029',
        timezone: 'UTC'
      }
    };
    const html = guidedHtml({ guidance: { result: { status: 200, body } } });
    expect(html).toContain('&lt;/script&gt;');
    expect(html).not.toContain('</script><script>attack');
    expect(html).not.toContain('2026-10-31T04:00:00Z');
    expect(guidedHtml({ liffId: '</script><script>attack()</script>' })).not.toContain('<script');
    expect(venueGuidancePresentation({ status: 200, body }, guidedCode, 'en').open).toBe(true);
  });
});

describe('guided open controller: synthetic SDK/fetch/GPS only', () => {
  it.each([
    { version: 1, status: 'needs_application', privacy: null },
    { version: 1, status: 'pending', privacy: null },
    { version: 1, status: 'blocked', privacy: null },
    { version: 1, status: 'approved', privacy: 'required' }
  ] as const)('never locates for $status / $privacy', async (self) => {
    const ui = guidedBrowser(undefined, { self });
    await guidedTick();
    await guidedClick(ui);
    expect(ui.geo).not.toHaveBeenCalled();
    expect(ui.get('guided-checkin').disabled).toBe(true);
    expect(ui.get('guided-chat').hidden).toBe(
      self.status === 'pending' || self.status === 'blocked'
    );
    if (self.status === 'needs_application')
      expect(ui.get('guided-status').textContent).toContain('manual approval');
    if (self.status === 'pending' || self.status === 'blocked')
      expect(ui.get('guided-status').textContent).toContain('Do not reapply');
    if (self.privacy === 'required') expect(ui.get('guided-status').textContent).toContain('隱私');
    expect(ui.liff.sendMessages).not.toHaveBeenCalled();
    expect(ui.liff.getProfile).not.toHaveBeenCalled();
  });
  it.each([401, 503, 201])(
    'HTTP %s is a verification error, never a new-user classification',
    async (status) => {
      const ui = guidedBrowser(undefined, {
        fetch: async () =>
          jsonResponse({ version: 1, status: 'needs_application', privacy: null }, status)
      });
      await guidedTick();
      expect(ui.get('guided-status').textContent).toContain('could not be verified');
      expect(ui.get('guided-chat').hidden).toBe(true);
      await guidedClick(ui);
      expect(ui.geo).not.toHaveBeenCalled();
    }
  );
  it.each([
    null,
    { version: 1, status: 'approved' },
    { version: 1, status: 'approved', privacy: null },
    { version: 1, status: 'pending', privacy: 'clear' },
    { version: 2, status: 'approved', privacy: 'clear' },
    { version: 1, status: 'approved', privacy: 'clear', personId: 'private' }
  ])('rejects malformed private status: %#', async (data) => {
    const ui = guidedBrowser(undefined, { fetch: async () => jsonResponse(data) });
    await guidedTick();
    expect(ui.get('guided-checkin').disabled).toBe(true);
    expect(ui.get('guided-chat').hidden).toBe(true);
    expect(ui.geo).not.toHaveBeenCalled();
  });
  it('logged-out open secondary offers only deliberate login, rechecking DB availability on click', async () => {
    const ui = guidedBrowser(undefined, { loggedIn: false });
    await guidedTick();
    expect(ui.liff.init).toHaveBeenCalledWith({
      liffId: 'mock-liff',
      withLoginOnExternalBrowser: false
    });
    expect(ui.liff.login).not.toHaveBeenCalled();
    expect(ui.liff.getIDToken).not.toHaveBeenCalled();
    expect(ui.fetch).not.toHaveBeenCalled();
    await ui.get('guided-login').onclick?.();
    expect(ui.liff.login).toHaveBeenCalledExactlyOnceWith({
      redirectUri: 'https://app.test/line/venue-checkin?venue=' + guidedCode + '&source=nfc&lang=en'
    });
    expect(ui.fetch).toHaveBeenCalledOnce();
    expect(ui.geo).not.toHaveBeenCalled();
    expect(ui.history.replaceState).not.toHaveBeenCalled();
  });
  it('approved clear is passive until a click, using only the bounded self-status endpoint', async () => {
    const ui = guidedBrowser();
    await guidedTick();
    expect(ui.get('guided-checkin').disabled).toBe(false);
    expect(ui.geo).not.toHaveBeenCalled();
    expect(ui.fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/line/venue-entry-status',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-venue-entry': '1' },
        body: JSON.stringify({ idToken: 'synthetic-guided-memory-token' })
      })
    );
    expect(ui.document.cookie).toBe('');
    expect(ui.location.replace).not.toHaveBeenCalled();
    expect(ui.history.replaceState).not.toHaveBeenCalled();
    expect(ui.get('guided-receipt').hidden).toBe(true);
  });
  it.each(['before_open', 'ended', 'not_activity_day', 'disabled', 'not_found'] as const)(
    'cached approved status cannot bypass server calendar %s or a forged local clock',
    async (state) => {
      const ui = guidedBrowser(undefined, {
        fetch: async (url) => {
          if (url === '/api/line/venue-entry-status')
            return jsonResponse({ version: 1, status: 'approved', privacy: 'clear' });
          if (url.startsWith('/api/venue-entry/availability?'))
            return jsonResponse(
              guidedAvailability(state),
              state === 'disabled' ? 410 : state === 'not_found' ? 404 : 200
            );
          throw Error('Unexpected fetch');
        }
      });
      await guidedTick();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
      try {
        await guidedClick(ui);
        expect(ui.geo).not.toHaveBeenCalled();
        expect(ui.fetch).toHaveBeenCalledTimes(2);
        expect(ui.get('guided-checkin').hidden).toBe(true);
        expect(ui.get('guided-language').hidden).toBe(true);
        expect(ui.get('guided-chat').hidden).toBe(true);
        for (const id of [
          'guided-calendar',
          'guided-language-label',
          'guided-login',
          'guided-retry',
          'guided-receipt'
        ])
          expect(ui.get(id).hidden).toBe(true);
        expect(ui.location.replace).toHaveBeenCalledExactlyOnceWith(
          '/line/venue-checkin?venue=' + guidedCode + '&source=nfc&lang=en'
        );
        expect(ui.get('guided-language').disabled).toBe(true);
        expect(ui.get('guided-retry').disabled).toBe(true);
      } finally {
        clock.mockRestore();
      }
    }
  );
  it.each(['before_open', 'ended', 'not_activity_day', 'disabled', 'not_found'] as const)(
    'hides the stale open calendar before failed navigation for %s and stays read-only',
    async (state) => {
      const html = guidedHtml();
      expect(html).toMatch(
        /<section id="guided-calendar">[\s\S]*Check-in is open[\s\S]*<\/section>/
      );
      const ui = guidedBrowser(html);
      await guidedTick();
      const hidden = [
        'guided-calendar',
        'guided-language-label',
        'guided-language',
        'guided-checkin',
        'guided-chat',
        'guided-login',
        'guided-retry',
        'guided-receipt'
      ];
      ui.location.replace.mockImplementation((target: string) => {
        expect(target).toBe('/line/venue-checkin?venue=' + guidedCode + '&source=nfc&lang=en');
        for (const id of hidden) expect(ui.get(id).hidden).toBe(true);
        throw Error('Synthetic navigation failure');
      });
      ui.fetch.mockImplementation(async () =>
        jsonResponse(
          guidedAvailability(state),
          state === 'disabled' ? 410 : state === 'not_found' ? 404 : 200
        )
      );
      await guidedClick(ui);
      expect(ui.location.replace).toHaveBeenCalledOnce();
      for (const id of hidden) expect(ui.get(id).hidden).toBe(true);
      expect(ui.get('guided-status').textContent).toBe(
        {
          before_open: 'Check-in has not opened',
          ended: 'This practice has ended',
          not_activity_day: 'Not a practice day at this venue',
          disabled: 'Venue disabled',
          not_found: 'Venue not found'
        }[state]
      );
      await guidedClick(ui);
      await ui.get('guided-retry').onclick?.();
      await ui.get('guided-login').onclick?.();
      ui.get('guided-language').value = 'zh_CN';
      ui.get('guided-language').onchange?.();
      expect(ui.fetch).toHaveBeenCalledTimes(2);
      expect(ui.location.replace).toHaveBeenCalledOnce();
      expect(ui.geo).not.toHaveBeenCalled();
      expect(ui.liff.login).not.toHaveBeenCalled();
      expect(ui.document.cookie).toBe('');
    }
  );
  it.each(['pending', 'blocked', 'privacy', 'rotation'] as const)(
    'every attempt rejects changed learner state / credential: %s',
    async (change) => {
      let calls = 0;
      const ui = guidedBrowser(undefined, {
        fetch: async (url) => {
          if (url.startsWith('/api/venue-entry/availability?'))
            return jsonResponse(guidedAvailability());
          if (url === '/api/line/venue-entry-status') {
            calls++;
            if (calls > 1 && change === 'rotation') rotate?.();
            return jsonResponse(
              calls === 1 || change === 'rotation'
                ? { version: 1, status: 'approved', privacy: 'clear' }
                : change === 'privacy'
                  ? { version: 1, status: 'approved', privacy: 'required' }
                  : { version: 1, status: change, privacy: null }
            );
          }
          throw Error('Unexpected fetch');
        }
      });
      const rotate = () => ui.liff.getIDToken.mockReturnValue('rotated-credential');
      await guidedTick();
      await guidedClick(ui);
      expect(ui.geo).not.toHaveBeenCalled();
      expect(ui.get('guided-checkin').disabled).toBe(true);
      expect(ui.fetch.mock.calls.some(([url]) => url === '/api/line/venue-checkin')).toBe(false);
      expect(ui.get('guided-status').textContent).not.toContain('may already be recorded');
      if (change === 'rotation')
        expect(ui.get('guided-status').textContent).toContain('could not be verified');
    }
  );
  it.each([
    'binding',
    'timezone',
    'extra',
    'bad-session',
    'normalized-date',
    'normalized-observed',
    'hour-24',
    '503'
  ] as const)('revalidation rejects malformed availability: %s', async (failure) => {
    const body = guidedAvailability();
    const malformed =
      failure === 'binding'
        ? { ...body, venue: { ...body.venue, code: 'other-hall' } }
        : failure === 'timezone'
          ? { ...body, venue: { ...body.venue, timezone: 'bad/zone' } }
          : failure === 'extra'
            ? { ...body, person: 'private' }
            : failure === 'normalized-date'
              ? {
                  ...body,
                  relevantSession: {
                    opensAt: '2026-02-30T02:00:00Z',
                    startsAt: '2026-02-30T03:00:00Z',
                    endsAt: '2026-02-30T04:00:00Z'
                  }
                }
              : failure === 'normalized-observed'
                ? { ...body, observedAt: '2026-02-30T00:00:00Z' }
                : failure === 'hour-24'
                  ? { ...body, observedAt: '2026-10-30T24:00:00Z' }
                  : { ...body, relevantSession: { ...guidedSession, endsAt: 'bad' } };
    const ui = guidedBrowser(undefined, {
      fetch: async (url) => {
        if (url === '/api/line/venue-entry-status')
          return jsonResponse({ version: 1, status: 'approved', privacy: 'clear' });
        if (url.startsWith('/api/venue-entry/availability?'))
          return jsonResponse(malformed, failure === '503' ? 503 : 200);
        throw Error('Unexpected fetch');
      }
    });
    await guidedTick();
    await guidedClick(ui);
    expect(ui.geo).not.toHaveBeenCalled();
    expect(ui.get('guided-checkin').disabled).toBe(true);
  });
  it('locks every attempt, rechecks calendar then fresh self-status, and confirms only the formal receipt', async () => {
    const ui = guidedBrowser();
    await guidedTick();
    ui.fetch.mockImplementation(async (url) => {
      if (url.startsWith('/api/venue-entry/availability?'))
        return jsonResponse(guidedAvailability());
      if (url === '/api/line/venue-entry-status')
        return jsonResponse({ version: 1, status: 'approved', privacy: 'clear' });
      if (url === '/api/line/venue-checkin')
        return jsonResponse({
          ok: true,
          venue: { code: guidedCode, name: 'Receipt venue', timezone: 'America/New_York' },
          checkedInAt: '2026-10-31T04:01:00Z'
        });
      throw Error('Unexpected fetch');
    });
    const attempt = guidedClick(ui);
    await guidedClick(ui);
    await guidedTick();
    expect(ui.geo).toHaveBeenCalledOnce();
    expect(ui.get('guided-checkin').attributes['aria-busy']).toBe('true');
    ui.get('guided-language').value = 'zh_TW';
    ui.get('guided-language').onchange?.();
    expect(ui.location.replace).not.toHaveBeenCalled();
    expect(ui.document.cookie).toBe('');
    await guidedClick(ui);
    expect(ui.geo).toHaveBeenCalledOnce();
    expect(ui.fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/line/venue-entry-status',
      '/api/venue-entry/availability?venue=' + guidedCode,
      '/api/line/venue-entry-status'
    ]);
    ui.geo.mock.calls[0]![0]({ coords: { latitude: 12.345, longitude: -67.89 } });
    await attempt;
    expect(ui.fetch).toHaveBeenLastCalledWith(
      '/api/line/venue-checkin',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-venue-checkin': '1' },
        body: JSON.stringify({
          idToken: 'synthetic-guided-memory-token',
          venue: guidedCode,
          latitude: 12.345,
          longitude: -67.89
        })
      })
    );
    expect(ui.get('guided-status').textContent).toContain('Attendance recorded');
    expect(ui.get('guided-receipt').hidden).toBe(false);
    expect(ui.get('guided-checkin').disabled).toBe(true);
    for (const forbidden of [
      ui.storage.getItem,
      ui.storage.setItem,
      ui.log,
      ui.liff.getProfile,
      ui.liff.sendMessages
    ])
      expect(forbidden).not.toHaveBeenCalled();
    expect(ui.document.cookie).toBe('');
    expect(ui.location.href).not.toMatch(/12\.345|67\.89|memory-token/);
  });
  it.each(['rotate', 'pagehide'] as const)(
    'credential %s during GPS aborts before POST',
    async (change) => {
      const ui = guidedBrowser();
      await guidedTick();
      const attempt = guidedClick(ui);
      await guidedTick();
      if (change === 'rotate') ui.liff.getIDToken.mockReturnValue('rotated-after-gps');
      else ui.handlers.get('pagehide')?.();
      ui.geo.mock.calls[0]![0]({ coords: { latitude: 1, longitude: 2 } });
      await attempt;
      expect(ui.fetch.mock.calls.some(([url]) => url === '/api/line/venue-checkin')).toBe(false);
      expect(ui.get('guided-receipt').hidden).toBe(true);
      if (change === 'rotate') {
        expect(ui.get('guided-status').textContent).toContain('could not be verified');
        expect(ui.get('guided-status').textContent).not.toContain('may already be recorded');
        expect(ui.fetch).toHaveBeenCalledTimes(3);
      }
      if (change === 'pagehide') {
        expect(ui.get('guided-language').disabled).toBe(true);
        await guidedClick(ui);
        expect(ui.geo).toHaveBeenCalledOnce();
      }
    }
  );
  it.each(
    (['zh_TW', 'zh_CN', 'en'] as const).flatMap((lang) =>
      (
        ['denied', 'timeout', 'unavailable', 'unsupported', 'sync-throw', 'unknown-code'] as const
      ).map((failure) => ({ lang, failure }))
    )
  )(
    'pre-write GPS $failure in $lang is never an uncertain attendance result',
    async ({ lang, failure }) => {
      const copy = {
        zh_TW: {
          denied: '您未允許定位',
          timeout: '定位逾時',
          unavailable: '目前無法取得定位',
          unsupported: '此瀏覽器不支援定位',
          uncertain: '可能已記錄'
        },
        zh_CN: {
          denied: '您未允许定位',
          timeout: '定位超时',
          unavailable: '目前无法取得定位',
          unsupported: '此浏览器不支持定位',
          uncertain: '可能已记录'
        },
        en: {
          denied: 'Location permission denied',
          timeout: 'Location timed out',
          unavailable: 'Location unavailable',
          unsupported: 'This browser does not support location',
          uncertain: 'may already be recorded'
        }
      }[lang];
      const ui = guidedBrowser(guidedHtml({ lang }), { geolocation: failure !== 'unsupported' });
      await guidedTick();
      if (failure === 'sync-throw')
        ui.geo.mockImplementation(() => {
          throw Error('private-error-marker');
        });
      else
        ui.geo.mockImplementation((_success, reject) =>
          reject({
            code:
              failure === 'denied'
                ? 1
                : failure === 'timeout'
                  ? 3
                  : failure === 'unavailable'
                    ? 2
                    : 99
          })
        );
      await guidedClick(ui);
      expect(ui.get('guided-status').textContent).toContain(
        copy[failure === 'sync-throw' || failure === 'unknown-code' ? 'unavailable' : failure]
      );
      expect(ui.get('guided-status').textContent).not.toContain(copy.uncertain);
      expect(ui.get('guided-status').textContent).not.toContain('private-error-marker');
      expect(ui.get('guided-receipt').hidden).toBe(true);
      expect(ui.fetch.mock.calls.map(([url]) => url)).toEqual([
        '/api/line/venue-entry-status',
        '/api/venue-entry/availability?venue=' + guidedCode,
        '/api/line/venue-entry-status'
      ]);
      expect(ui.geo).toHaveBeenCalledTimes(failure === 'unsupported' ? 0 : 1);
      expect(ui.storage.setItem).not.toHaveBeenCalled();
      expect(ui.log).not.toHaveBeenCalled();
    }
  );
  it.each([
    'availability',
    'self-status',
    'credential-before-geo',
    'credential-after-geo'
  ] as const)('pre-write %s failure never claims attendance might be recorded', async (failure) => {
    const ui = guidedBrowser();
    await guidedTick();
    ui.fetch.mockImplementation(async (url) => {
      if (url.startsWith('/api/venue-entry/availability?')) {
        if (failure === 'availability') throw Error('private-error-marker');
        return jsonResponse(guidedAvailability());
      }
      if (url === '/api/line/venue-entry-status') {
        if (failure === 'self-status') throw Error('private-error-marker');
        if (failure === 'credential-before-geo')
          ui.liff.getIDToken.mockReturnValue('rotated-before-geo');
        return jsonResponse({ version: 1, status: 'approved', privacy: 'clear' });
      }
      throw Error('Write forbidden');
    });
    const attempt = guidedClick(ui);
    if (failure === 'credential-after-geo') {
      await guidedTick();
      ui.liff.getIDToken.mockReturnValue('rotated-after-geo');
      ui.geo.mock.calls[0]![0]({ coords: { latitude: 1, longitude: 2 } });
    }
    await attempt;
    expect(ui.get('guided-status').textContent).toContain('could not be verified');
    expect(ui.get('guided-status').textContent).not.toMatch(
      /may already be recorded|private-error-marker/
    );
    expect(ui.get('guided-receipt').hidden).toBe(true);
    expect(ui.geo).toHaveBeenCalledTimes(failure === 'credential-after-geo' ? 1 : 0);
    expect(ui.fetch).toHaveBeenCalledTimes(failure === 'availability' ? 2 : 3);
    expect(ui.fetch.mock.calls.some(([url]) => url === '/api/line/venue-checkin')).toBe(false);
  });
  it.each(
    (['zh_TW', 'zh_CN', 'en'] as const).flatMap((lang) =>
      (['transport', 'json'] as const).map((failure) => ({ lang, failure }))
    )
  )(
    'after transport invocation $failure in $lang stays uncertain with idempotency copy',
    async ({ lang, failure }) => {
      const ui = guidedBrowser(guidedHtml({ lang }));
      await guidedTick();
      ui.fetch.mockImplementation(async (url) => {
        if (url.startsWith('/api/venue-entry/availability?'))
          return jsonResponse(guidedAvailability());
        if (url === '/api/line/venue-entry-status')
          return jsonResponse({ version: 1, status: 'approved', privacy: 'clear' });
        if (url === '/api/line/venue-checkin') {
          if (failure === 'transport') throw Error('private-error-marker');
          return new Response('invalid-json', { status: 200 });
        }
        throw Error('Unexpected fetch');
      });
      const attempt = guidedClick(ui);
      await guidedTick();
      ui.geo.mock.calls[0]![0]({ coords: { latitude: 1, longitude: 2 } });
      await attempt;
      const copy = {
        zh_TW: ['可能已記錄', '不會重複計次'],
        zh_CN: ['可能已记录', '不会重复计次'],
        en: ['may already be recorded', 'will not count twice']
      }[lang];
      for (const text of copy) expect(ui.get('guided-status').textContent).toContain(text);
      expect(ui.get('guided-status').textContent).not.toContain('private-error-marker');
      expect(ui.get('guided-receipt').hidden).toBe(true);
      expect(ui.fetch).toHaveBeenCalledTimes(4);
      expect(ui.fetch.mock.calls.filter(([url]) => url === '/api/line/venue-checkin')).toHaveLength(
        1
      );
      expect(ui.geo).toHaveBeenCalledOnce();
    }
  );
  it.each([
    null,
    { ok: true },
    { ok: true, venue: { name: 'Receipt', timezone: 'UTC' }, checkedInAt: 'bad' },
    {
      ok: true,
      venue: { name: 'Receipt', timezone: 'UTC' },
      checkedInAt: '2026-02-30T00:00:00Z'
    },
    {
      ok: true,
      venue: { name: 'Receipt', timezone: 'UTC' },
      checkedInAt: '2026-10-30T24:00:00Z'
    },
    {
      ok: true,
      isTest: true,
      verificationMode: 'distance_debug',
      venue: { name: 'Receipt', timezone: 'UTC' },
      checkedInAt: '2026-10-31T04:00:00Z'
    },
    {
      ok: true,
      isTest: false,
      venue: { name: 'Receipt', timezone: 'UTC' },
      checkedInAt: '2026-10-31T04:00:00Z'
    },
    {
      ok: true,
      venue: { name: 'Receipt', timezone: 'bad/zone' },
      checkedInAt: '2026-10-31T04:00:00Z'
    },
    {
      ok: true,
      venue: { code: 'other-hall', name: 'Receipt', timezone: 'UTC' },
      checkedInAt: '2026-10-31T04:00:00Z'
    }
  ])('malformed/debug receipt never reveals success: %#', async (data) => {
    const ui = guidedBrowser();
    await guidedTick();
    ui.fetch.mockImplementation(async (url) =>
      url === '/api/line/venue-checkin'
        ? jsonResponse(data)
        : url === '/api/line/venue-entry-status'
          ? jsonResponse({ version: 1, status: 'approved', privacy: 'clear' })
          : url === '/api/venue-entry/availability?venue=' + guidedCode
            ? jsonResponse(guidedAvailability())
            : Promise.reject(Error('Unmatched fetch'))
    );
    const attempt = guidedClick(ui);
    await guidedTick();
    ui.geo.mock.calls[0]![0]({ coords: { latitude: 1, longitude: 2 } });
    await attempt;
    expect(ui.get('guided-status').textContent).toContain('may already be recorded');
    expect(ui.get('guided-receipt').hidden).toBe(true);
    expect(ui.get('guided-checkin').disabled).toBe(true);
  });
  it('unknown write 502 is uncertain, with safe revalidation before every retry', async () => {
    const ui = guidedBrowser();
    await guidedTick();
    ui.fetch.mockImplementation(async (url) =>
      url === '/api/line/venue-checkin'
        ? jsonResponse({}, 502)
        : url === '/api/line/venue-entry-status'
          ? jsonResponse({ version: 1, status: 'approved', privacy: 'clear' })
          : url === '/api/venue-entry/availability?venue=' + guidedCode
            ? jsonResponse(guidedAvailability())
            : Promise.reject(Error('Unmatched fetch'))
    );
    const attempt = guidedClick(ui);
    await guidedTick();
    ui.geo.mock.calls[0]![0]({ coords: { latitude: 1, longitude: 2 } });
    await attempt;
    expect(ui.get('guided-status').textContent).toContain('will not count twice');
    expect(ui.get('guided-receipt').hidden).toBe(true);
    await ui.get('guided-retry').onclick?.();
    const second = guidedClick(ui);
    await guidedTick();
    expect(ui.geo).toHaveBeenCalledTimes(2);
    ui.geo.mock.calls[1]![1]({ code: 1 });
    await second;
    expect(
      ui.fetch.mock.calls.filter(([url]) => url.startsWith('/api/venue-entry/availability?'))
    ).toHaveLength(3);
  });
  it('outside_window refreshes read-only state without another GPS request', async () => {
    let availabilityReads = 0;
    const ui = guidedBrowser(undefined, {
      fetch: async (url) => {
        if (url === '/api/line/venue-entry-status')
          return jsonResponse({ version: 1, status: 'approved', privacy: 'clear' });
        if (url.startsWith('/api/venue-entry/availability?'))
          return jsonResponse(guidedAvailability(++availabilityReads === 1 ? 'open' : 'ended'));
        if (url === '/api/line/venue-checkin')
          return jsonResponse({ error: 'outside_window' }, 422);
        throw Error('Unmatched fetch');
      }
    });
    await guidedTick();
    const attempt = guidedClick(ui);
    await guidedTick();
    ui.geo.mock.calls[0]![0]({ coords: { latitude: 1, longitude: 2 } });
    await attempt;
    expect(ui.get('guided-checkin').hidden).toBe(true);
    expect(ui.get('guided-language').hidden).toBe(true);
    expect(ui.get('guided-status').textContent).toContain('ended');
    expect(ui.get('guided-calendar').hidden).toBe(true);
    expect(ui.get('guided-language-label').hidden).toBe(true);
    expect(ui.get('guided-receipt').hidden).toBe(true);
    expect(ui.get('guided-retry').hidden).toBe(true);
    expect(ui.location.replace).toHaveBeenCalledExactlyOnceWith(
      '/line/venue-checkin?venue=' + guidedCode + '&source=nfc&lang=en'
    );
    expect(ui.geo).toHaveBeenCalledOnce();
    expect(availabilityReads).toBe(2);
  });
  it('language choice is presentation-only navigation with no preference POST', async () => {
    const ui = guidedBrowser();
    await guidedTick();
    ui.get('guided-language').value = 'zh_CN';
    ui.get('guided-language').onchange?.();
    expect(ui.location.replace).toHaveBeenCalledExactlyOnceWith(
      '/line/venue-checkin?venue=' + guidedCode + '&source=nfc&lang=zh_CN'
    );
    expect(ui.document.cookie).toContain('__Host-qigong-learner-locale=zh_CN');
    expect(ui.fetch).toHaveBeenCalledOnce();
    expect(ui.geo).not.toHaveBeenCalled();
  });
});

describe('live schedule language without public venue metadata', () => {
  it.each([
    [
      'zh_TW',
      '團練開始前30分鐘開放打卡，結束即停止',
      '場地時區',
      '前一天',
      '實際打卡當下',
      '目前不在可打卡時段'
    ],
    [
      'zh_CN',
      '团练开始前30分钟开放打卡，结束即停止',
      '场地时区',
      '前一天',
      '实际打卡当下',
      '目前不在可打卡时段'
    ],
    [
      'en',
      'Check-in opens 30 minutes before group practice starts and stops when it ends',
      'venue’s timezone',
      'previous day',
      'actual local check-in date',
      'Outside the check-in window'
    ]
  ] as const)(
    'renders %s rules separately from any unprovided concrete schedule',
    (lang, rule, zone, previous, actual, error) => {
      const html = renderVenuePreview(
        'mock-liff',
        { venue: 'tw-taipei-cks', source: 'qr', lang },
        'checkin'
      );
      const markup = html.split('<script')[0]!;
      for (const text of [rule, zone, previous, actual]) expect(markup).toContain(text);
      expect(html).toContain(error);
      expect(markup).not.toMatch(/09:00|08:30|Asia\/Taipei/);
      expect(html).not.toMatch(/checkin_start|passedTime|session_start/);
    }
  );
});
const base = '/line/venue-checkin';
const valid = base + '?venue=tw-tpe-daan&source=qr';
const primary = (suffix = '/venue-checkin?venue=tw-tpe-daan&source=qr') =>
  '/line/?liff.state=' + encodeURIComponent(suffix);
const query = vi.fn(async () => {
  throw new Error('DB forbidden');
});
const connect = vi.fn(async () => {
  throw new Error('DB forbidden');
});
const verifyIdentity = vi.fn(async () => {
  throw new Error('Verifier forbidden');
});
const verifyIdToken = vi.fn(async () => {
  throw new Error('Verifier forbidden');
});
const verifyFriendship = vi.fn(async () => {
  throw new Error('Verifier forbidden');
});
const reply = vi.fn(async () => {
  throw new Error('Push forbidden');
});
const fetchMock = vi.fn(async () => {
  throw new Error('Network forbidden');
});
const config: LineConfig = {
  channelSecret: 'mock-channel-secret',
  channelAccessToken: 'mock-access-token',
  loginChannelId: 'mock-login-channel',
  liffId: 'mock-liff',
  verifyIdentity,
  verifyIdToken,
  verifyFriendship,
  reply
};
let app: FastifyInstance;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', undefined);
  vi.stubGlobal('fetch', fetchMock);
  app = buildApp({ pool: { query, connect } as unknown as Pool, logger: false, line: config });
});
afterEach(async () => {
  await app.close();
  for (const forbidden of [
    query,
    connect,
    verifyIdentity,
    verifyIdToken,
    verifyFriendship,
    reply,
    fetchMock
  ])
    expect(forbidden).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

interface NodeStub {
  textContent: string;
  disabled: boolean;
  value: string;
  onclick?: () => void;
  onchange?: () => void | Promise<void>;
  checked: boolean;
  hidden: boolean;
  attributes: Record<string, string>;
  setAttribute: (name: string, value: string) => void;
  getBoundingClientRect?: () => { top: number; bottom: number };
  scrollIntoView?: (options: ScrollIntoViewOptions) => void;
  focus: () => void;
}
type BrowserRequest = Omit<RequestInit, 'body'> & { body: string };
type GeoRequest = (
  success: (position: unknown) => void | Promise<void>,
  error: (error: { code: number }) => void,
  options: { enableHighAccuracy: boolean; timeout: number; maximumAge: number }
) => void;
const browser = (
  html: string,
  url = 'https://app.test' + valid,
  options: {
    loggedIn?: boolean;
    inClient?: boolean;
    idToken?: string;
    init?: () => Promise<void>;
    geolocation?: boolean;
    cookie?: string;
    resultVisible?: boolean;
    reducedMotion?: boolean;
    scrollApis?: boolean;
    matchMedia?: boolean;
    scrollThrows?: boolean;
    preferences?: (url: string, options: BrowserRequest) => Promise<Response>;
    fetch?: (url: string, options: BrowserRequest) => Promise<Response>;
  } = {}
) => {
  const nodes = new Map<string, NodeStub>();
  const focus = vi.fn();
  const scroll = vi.fn(() => {
    if (options.scrollThrows) throw new Error('Synthetic presentation failure');
  });
  const matchMedia = vi.fn(() => ({ matches: options.reducedMotion ?? false }));
  const get = (id: string) => {
    let node = nodes.get(id);
    if (!node) {
      node = {
        textContent: new RegExp('id="' + id + '"[^>]*>([^<]*)<').exec(html)?.[1] ?? '',
        disabled: id === 'preview-test' || id === 'preview-language',
        value:
          id === 'preview-language' ? (/value="([^"]*)"[^>]* selected/.exec(html)?.[1] ?? '') : '',
        checked: false,
        hidden: true,
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        ...(options.scrollApis === false
          ? {}
          : {
              getBoundingClientRect: () =>
                options.resultVisible ? { top: 100, bottom: 200 } : { top: 800, bottom: 950 },
              scrollIntoView: scroll
            }),
        focus
      };
      nodes.set(id, node);
    }
    return node;
  };
  const entry = new URL(url);
  const location = {
    href: entry.href,
    pathname: entry.pathname,
    search: entry.search,
    hash: entry.hash,
    replace: vi.fn()
  };
  const history = { replaceState: vi.fn() };
  const liff = {
    init: vi.fn(options.init ?? (async () => {})),
    isLoggedIn: vi.fn(() => options.loggedIn ?? true),
    isInClient: vi.fn(() => options.inClient ?? false),
    getIDToken: vi.fn(() => options.idToken ?? 'mock-credential-never-sent'),
    login: vi.fn()
  };
  const geo = vi.fn<GeoRequest>();
  const storage = {
    getItem: vi.fn(() => {
      throw new Error('Storage forbidden');
    }),
    setItem: vi.fn(() => {
      throw new Error('Storage forbidden');
    })
  };
  const log = vi.fn(() => {
    throw new Error('Logging forbidden');
  });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Missing script');
  const document = { getElementById: get, cookie: options.cookie ?? '' };
  const preferences = vi.fn(
    options.preferences ?? (async () => new Response(JSON.stringify({ locale: 'zh_TW' })))
  );
  const fetch = vi.fn(
    options.fetch ??
      (async () => {
        throw new Error('Check-in forbidden');
      })
  );
  new Script(script).runInNewContext({
    URL,
    URLSearchParams,
    document,
    location,
    history,
    liff,
    navigator: options.geolocation === false ? {} : { geolocation: { getCurrentPosition: geo } },
    fetch: (url: string, options: BrowserRequest) =>
      url === '/line/preferences/language' ? preferences(url, options) : fetch(url, options),
    localStorage: storage,
    sessionStorage: storage,
    console: { log, error: log, warn: log },
    window: {},
    innerHeight: 700,
    ...(options.matchMedia === false ? {} : { matchMedia })
  });
  return {
    get,
    location,
    history,
    liff,
    geo,
    storage,
    log,
    document,
    preferences,
    fetch,
    scroll,
    focus,
    matchMedia
  };
};
const routeBrowser = async (route = valid, options: Parameters<typeof browser>[2] = {}) =>
  browser(
    (await app.inject({ url: route, headers: { cookie: options.cookie ?? '' } })).body,
    'https://app.test' + route,
    options
  );
const finishInit = () => setImmediate();

const liveBrowser = (route = valid, options: Parameters<typeof browser>[2] = {}) => {
  const parsed = venuePreviewRequest(route, options.cookie);
  if (parsed.kind !== 'preview') throw new Error('Invalid fixture');
  return browser(
    renderVenuePreview('mock-liff', parsed.entry, 'checkin', true, 'tw-taipei-cks'),
    'https://app.test' + route,
    options
  );
};
const attendanceResponse = () =>
  new Response(
    JSON.stringify({
      ok: true,
      venue: { name: 'Synthetic venue', timezone: 'Asia/Taipei' },
      checkedInAt: '2026-10-27T00:00:00Z'
    })
  );

describe('check-in language preference integration (real renderer, synthetic SDK/network)', () => {
  it.each(['zh_TW', 'zh_CN', 'en'])(
    'reads stored %s only after authentication, never writes on load',
    async (locale) => {
      let complete: (() => void) | undefined;
      const init = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const ui = liveBrowser(valid, {
        init: () => init,
        preferences: async () => new Response(JSON.stringify({ locale }))
      });
      expect(ui.preferences).not.toHaveBeenCalled();
      ui.get('preview-test').onclick?.();
      expect(ui.geo).not.toHaveBeenCalled();
      complete?.();
      await finishInit();
      expect(ui.preferences).toHaveBeenCalledExactlyOnceWith(
        '/line/preferences/language',
        expect.objectContaining({
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          body: JSON.stringify({ idToken: 'mock-credential-never-sent' })
        })
      );
      expect(ui.document.cookie).toBe('');
      expect(ui.fetch).not.toHaveBeenCalled();
      expect(ui.history.replaceState).toHaveBeenCalledWith(null, '', valid);
      if (locale === 'zh_TW') {
        expect(ui.location.replace).not.toHaveBeenCalled();
        expect(ui.get('preview-test').disabled).toBe(false);
      } else {
        expect(ui.location.replace).toHaveBeenCalledExactlyOnceWith(valid + '&lang=' + locale);
        expect(ui.get('preview-status').textContent).toContain('正在切換介面語言');
        expect(ui.get('preview-status').textContent).not.toContain('登入未完成');
        expect(ui.get('preview-test').disabled).toBe(true);
        expect(ui.get('preview-language').disabled).toBe(true);
        ui.get('preview-test').onclick?.();
        ui.get('preview-language').value = 'en';
        await ui.get('preview-language').onchange?.();
        expect(ui.geo).not.toHaveBeenCalled();
        expect(ui.preferences).toHaveBeenCalledOnce();
        const next = liveBrowser(valid + '&lang=' + locale);
        await finishInit();
        expect(next.preferences).not.toHaveBeenCalled();
        expect(next.location.replace).not.toHaveBeenCalled();
      }
      expect(ui.storage.getItem).not.toHaveBeenCalled();
      expect(ui.storage.setItem).not.toHaveBeenCalled();
      expect(ui.log).not.toHaveBeenCalled();
    }
  );
  it.each([
    ['&lang=en', 'zh_CN', 'en'],
    ['&lang=zh_CN', 'en', 'zh_CN'],
    ['&lang=zh_TW', 'en', 'zh_TW'],
    ['', 'zh_TW', 'zh_TW'],
    ['', 'zh_CN', 'zh_CN'],
    ['', 'en', 'en']
  ])(
    'preserves explicit > cookie > stored precedence: %s / %s',
    async (query, cookie, expected) => {
      const ui = liveBrowser(valid + query, { cookie: '__Host-qigong-learner-locale=' + cookie });
      await finishInit();
      expect(ui.get('preview-language').value).toBe(expected);
      expect(ui.preferences).not.toHaveBeenCalled();
      expect(ui.location.replace).not.toHaveBeenCalled();
      expect(ui.document.cookie).toBe('__Host-qigong-learner-locale=' + cookie);
      const parsed = venuePreviewRequest(valid + query, '__Host-qigong-learner-locale=' + cookie);
      expect(parsed).toMatchObject({ kind: 'preview', entry: { explicitLang: query.length > 0 } });
      if (parsed.kind === 'preview') expect(venuePreviewUrl(parsed.entry)).toBe(valid + query);
    }
  );
  it('invalid cookie is not an explicit choice and old localized callers retain their URL contract', async () => {
    const ui = liveBrowser(valid, {
      cookie: '__Host-qigong-learner-locale=fr',
      preferences: async () => new Response(JSON.stringify({ locale: 'en' }))
    });
    await finishInit();
    expect(ui.preferences).toHaveBeenCalledOnce();
    expect(ui.location.replace).toHaveBeenCalledWith(valid + '&lang=en');
    expect(venuePreviewUrl({ venue: 'tw-tpe-daan', source: 'qr', lang: 'en' })).toBe(
      valid + '&lang=en'
    );
  });
  it.each(['network', 'http', 'invalid', 'malicious'])(
    'preference read %s failure falls back without an implicit write',
    async (failure) => {
      const ui = liveBrowser(valid, {
        preferences: async () => {
          if (failure === 'network') throw new Error('private-credential');
          return new Response(
            JSON.stringify({
              locale: failure === 'malicious' ? '<script>private-credential</script>' : 'fr'
            }),
            { status: failure === 'http' ? 503 : 200 }
          );
        }
      });
      await finishInit();
      expect(ui.get('preview-test').disabled).toBe(false);
      expect(ui.location.replace).not.toHaveBeenCalled();
      expect(ui.document.cookie).toBe('');
      expect(ui.get('preview-language').value).toBe('zh_TW');
      expect(ui.get('preview-status').textContent).not.toContain('private-credential');
      expect(JSON.parse(String(ui.preferences.mock.calls[0]?.[1].body))).toEqual({
        idToken: 'mock-credential-never-sent'
      });
      expect(ui.fetch).not.toHaveBeenCalled();
    }
  );
  it('preserves only venue/source on no-lang login, callback cleanup and preference navigation', async () => {
    const route = base + '?venue=tw-taipei-cks&source=nfc';
    const first = liveBrowser(route, { loggedIn: false });
    await finishInit();
    expect(first.liff.login).toHaveBeenCalledWith({
      redirectUri: 'https://app.test' + route + '&_line_login_attempt=1'
    });
    expect(first.preferences).not.toHaveBeenCalled();
    const ui = liveBrowser(
      route +
        '&_line_login_attempt=1&code=private-code&state=private-state&liffRedirectUri=https%3A%2F%2Fevil.test#private-fragment',
      {
        preferences: async () => new Response(JSON.stringify({ locale: 'en' }))
      }
    );
    await finishInit();
    expect(ui.history.replaceState).toHaveBeenCalledExactlyOnceWith(null, '', route);
    expect(ui.location.replace).toHaveBeenCalledExactlyOnceWith(route + '&lang=en');
    expect(ui.preferences.mock.calls[0]?.[1].body).toBe(
      JSON.stringify({ idToken: 'mock-credential-never-sent' })
    );
    expect(ui.geo).not.toHaveBeenCalled();
    expect(ui.fetch).not.toHaveBeenCalled();
    expect(ui.get('preview-debug-enabled').disabled).toBe(true);
    expect(ui.get('preview-status').textContent).not.toContain('private-');
  });
  it('primary state is SDK-only, including check-in and preference controls', async () => {
    const ui = liveBrowser(primary('/venue-checkin?venue=tw-taipei-cks&source=qr'));
    await finishInit();
    ui.get('preview-test').onclick?.();
    ui.get('preview-language').value = 'en';
    await ui.get('preview-language').onchange?.();
    expect(ui.liff.init).toHaveBeenCalledOnce();
    expect(ui.liff.isLoggedIn).not.toHaveBeenCalled();
    expect(ui.liff.getIDToken).not.toHaveBeenCalled();
    expect(ui.preferences).not.toHaveBeenCalled();
    expect(ui.fetch).not.toHaveBeenCalled();
    expect(ui.geo).not.toHaveBeenCalled();
    expect(ui.history.replaceState).not.toHaveBeenCalled();
    expect(ui.location.replace).not.toHaveBeenCalled();
  });
  it('manual selection POST uses the fresh SDK token, clears debug memory, cookies only after success and remains busy through unload', async () => {
    let resolve: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const route = base + '?venue=tw-taipei-cks&source=link&lang=zh_TW';
    const ui = liveBrowser(route, { preferences: async () => pending });
    await finishInit();
    ui.liff.getIDToken.mockReturnValue('fresh-language-credential');
    ui.get('preview-debug-enabled').checked = true;
    ui.get('preview-debug-token').value = 'synthetic-manual-memory-only-debug-token';
    ui.get('preview-language').value = 'en';
    const switching = ui.get('preview-language').onchange?.();
    expect(ui.preferences).toHaveBeenCalledExactlyOnceWith(
      '/line/preferences/language',
      expect.objectContaining({
        body: JSON.stringify({ idToken: 'fresh-language-credential', locale: 'en' }),
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store'
      })
    );
    expect(ui.document.cookie).toBe('');
    expect(ui.location.replace).not.toHaveBeenCalled();
    expect(ui.get('preview-debug-token').value).toBe('');
    expect(ui.get('preview-debug-enabled').checked).toBe(false);
    for (const id of [
      'preview-language',
      'preview-test',
      'preview-debug-token',
      'preview-debug-enabled'
    ])
      expect(ui.get(id).disabled).toBe(true);
    ui.get('preview-language').value = 'zh_CN';
    await ui.get('preview-language').onchange?.();
    ui.get('preview-test').onclick?.();
    expect(ui.preferences).toHaveBeenCalledOnce();
    expect(ui.geo).not.toHaveBeenCalled();
    resolve?.(new Response('{}'));
    await switching;
    expect(ui.document.cookie).toBe(
      '__Host-qigong-learner-locale=en; Path=/; Max-Age=31536000; Secure; SameSite=Lax'
    );
    expect(ui.location.replace).toHaveBeenCalledExactlyOnceWith(
      base + '?venue=tw-taipei-cks&source=link&lang=en'
    );
    for (const id of [
      'preview-language',
      'preview-test',
      'preview-debug-token',
      'preview-debug-enabled'
    ])
      expect(ui.get(id).disabled).toBe(true);
    ui.get('preview-test').onclick?.();
    ui.get('preview-language').value = 'zh_CN';
    await ui.get('preview-language').onchange?.();
    expect(ui.geo).not.toHaveBeenCalled();
    expect(ui.fetch).not.toHaveBeenCalled();
    expect(ui.preferences).toHaveBeenCalledOnce();
    expect(ui.storage.setItem).not.toHaveBeenCalled();
    expect(ui.log).not.toHaveBeenCalled();
  });
  it.each([
    ['zh_TW', '語言偏好未儲存'],
    ['zh_CN', '语言偏好未保存'],
    ['en', 'Language preference was not saved']
  ])(
    'manual language HTTP/network failures restore %s and permit deliberate retry',
    async (locale, message) => {
      const route = valid + '&lang=' + locale;
      const ui = liveBrowser(route, {
        preferences: async () => new Response('private-server-error', { status: 503 })
      });
      await finishInit();
      const selected = locale === 'en' ? 'zh_CN' : 'en';
      for (const network of [false, true]) {
        if (network) ui.preferences.mockRejectedValueOnce(new Error('private-credential'));
        ui.get('preview-language').value = selected;
        await ui.get('preview-language').onchange?.();
        expect(ui.get('preview-language').value).toBe(locale);
        expect(ui.get('preview-status').textContent).toContain(message);
        expect(ui.get('preview-status').textContent).not.toContain('private-');
        expect(ui.get('preview-test').disabled).toBe(false);
        expect(ui.get('preview-language').disabled).toBe(false);
        expect(ui.document.cookie).toBe('');
        expect(ui.location.replace).not.toHaveBeenCalled();
      }
      ui.preferences.mockResolvedValueOnce(new Response('{}'));
      ui.get('preview-language').value = selected;
      await ui.get('preview-language').onchange?.();
      expect(ui.preferences).toHaveBeenCalledTimes(3);
      expect(ui.location.replace).toHaveBeenCalledWith(valid + '&lang=' + selected);
    }
  );
  it.each(['fr', '<script>attack-marker</script>', 'zh_TW'])(
    'ignores invalid/unchanged selection %s without writes',
    async (selected) => {
      const ui = liveBrowser(valid + '&lang=zh_TW');
      await finishInit();
      ui.get('preview-language').value = selected;
      await ui.get('preview-language').onchange?.();
      expect(ui.get('preview-language').value).toBe('zh_TW');
      expect(ui.preferences).not.toHaveBeenCalled();
      expect(ui.location.replace).not.toHaveBeenCalled();
    }
  );
  it.each(['logged-out', 'missing-token', 'sdk-error', 'http-401'])(
    'language auth failure %s never enables unauthorized check-in',
    async (failure) => {
      const ui = liveBrowser(valid + '&lang=zh_TW', {
        preferences: async () => new Response('{}', { status: 401 })
      });
      await finishInit();
      if (failure === 'logged-out') ui.liff.isLoggedIn.mockReturnValue(false);
      if (failure === 'missing-token') ui.liff.getIDToken.mockReturnValue('');
      if (failure === 'sdk-error')
        ui.liff.getIDToken.mockImplementation(() => {
          throw new Error('private-sdk-credential');
        });
      ui.get('preview-language').value = 'en';
      await ui.get('preview-language').onchange?.();
      expect(ui.preferences).toHaveBeenCalledTimes(failure === 'http-401' ? 1 : 0);
      expect(ui.get('preview-status').textContent).toContain('登入未完成');
      expect(ui.get('preview-language').value).toBe('zh_TW');
      expect(ui.get('preview-test').disabled).toBe(true);
      ui.get('preview-test').disabled = false;
      ui.get('preview-test').onclick?.();
      expect(ui.geo).not.toHaveBeenCalled();
      expect(ui.fetch).not.toHaveBeenCalled();
      expect(ui.document.cookie).toBe('');
      expect(ui.location.replace).not.toHaveBeenCalled();
    }
  );
  it('geolocation and POST pending freeze language/debug state and resist programmatic duplicate check-in', async () => {
    let resolve: ((response: Response) => void) | undefined;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    const ui = liveBrowser(valid + '&lang=zh_TW', { fetch: async () => pending });
    await finishInit();
    ui.get('preview-test').onclick?.();
    expect(ui.geo).toHaveBeenCalledOnce();
    ui.get('preview-language').value = 'en';
    await ui.get('preview-language').onchange?.();
    expect(ui.get('preview-language').value).toBe('zh_TW');
    expect(ui.preferences).not.toHaveBeenCalled();
    ui.get('preview-test').disabled = false;
    ui.get('preview-test').onclick?.();
    expect(ui.geo).toHaveBeenCalledOnce();
    ui.liff.getIDToken.mockReturnValue('fresh-checkin-credential');
    const submit = ui.geo.mock.calls[0]![0]({ coords: { latitude: 25, longitude: 121 } });
    expect(ui.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(ui.fetch.mock.calls[0]?.[1].body))).toEqual({
      idToken: 'fresh-checkin-credential',
      venue: 'tw-tpe-daan',
      latitude: 25,
      longitude: 121
    });
    ui.get('preview-language').value = 'en';
    await ui.get('preview-language').onchange?.();
    ui.get('preview-test').onclick?.();
    expect(ui.preferences).not.toHaveBeenCalled();
    expect(ui.geo).toHaveBeenCalledOnce();
    resolve?.(attendanceResponse());
    await submit;
    await finishInit();
    expect(ui.get('preview-status').textContent).toContain('出席已記錄');
    expect(ui.get('preview-history').hidden).toBe(false);
    expect(ui.get('preview-test').disabled).toBe(true);
    expect(ui.get('preview-language').disabled).toBe(false);
    ui.get('preview-test').disabled = false;
    ui.get('preview-test').onclick?.();
    expect(ui.geo).toHaveBeenCalledOnce();
    expect(ui.storage.setItem).not.toHaveBeenCalled();
    expect(ui.log).not.toHaveBeenCalled();
  });
  it('pending debug GPS keeps its mode/header and a language retry cannot retain the manual secret', async () => {
    const route = base + '?venue=tw-taipei-cks&source=qr&lang=zh_TW';
    const token = 'synthetic-manual-memory-only-debug-token';
    const ui = liveBrowser(route, {
      fetch: async () => new Response('{}', { status: 503 }),
      preferences: async () => new Response('{}', { status: 503 })
    });
    await finishInit();
    ui.get('preview-debug-enabled').checked = true;
    ui.get('preview-debug-token').value = token;
    ui.get('preview-test').onclick?.();
    expect(ui.get('preview-debug-token').value).toBe('');
    expect(ui.get('preview-debug-enabled').checked).toBe(true);
    ui.get('preview-language').value = 'en';
    await ui.get('preview-language').onchange?.();
    expect(ui.get('preview-debug-enabled').checked).toBe(true);
    expect(ui.preferences).not.toHaveBeenCalled();
    await ui.geo.mock.calls[0]![0]({ coords: { latitude: -25, longitude: 121 } });
    await finishInit();
    expect(ui.fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/line/venue-checkin',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Venue-Debug-Token': token })
      })
    );
    expect(ui.get('preview-debug-token').value).toBe('');
    expect(ui.get('preview-debug-enabled').checked).toBe(true);
    ui.get('preview-test').onclick?.();
    expect(ui.geo).toHaveBeenCalledOnce();
    expect(ui.get('preview-status').textContent).toContain('測試碼無效');
    ui.get('preview-debug-token').value = token;
    ui.get('preview-language').value = 'en';
    await ui.get('preview-language').onchange?.();
    expect(ui.get('preview-debug-token').value).toBe('');
    expect(ui.get('preview-debug-enabled').checked).toBe(false);
    expect(ui.get('preview-notice').textContent).toBe('正式出席簽到：送出後由後端驗證並記錄');
    expect(ui.get('preview-language').value).toBe('zh_TW');
    expect(ui.document.cookie).toBe('');
    expect(ui.location.replace).not.toHaveBeenCalled();
    expect(String(ui.preferences.mock.calls[0]?.[1].body)).not.toContain(token);
    expect(ui.storage.setItem).not.toHaveBeenCalled();
    expect(ui.log).not.toHaveBeenCalled();
  });
  it.each(['before-click', 'before-post', 'http-401'])(
    'check-in authentication expiry %s fails closed without reopening submit',
    async (failure) => {
      const ui = liveBrowser(valid + '&lang=zh_TW', {
        fetch: async () => new Response('{}', { status: 401 })
      });
      await finishInit();
      if (failure === 'before-click') ui.liff.getIDToken.mockReturnValue('');
      ui.get('preview-test').onclick?.();
      if (failure !== 'before-click') {
        if (failure === 'before-post') ui.liff.getIDToken.mockReturnValue('');
        await ui.geo.mock.calls[0]![0]({ coords: { latitude: 25, longitude: 121 } });
        await finishInit();
      }
      expect(ui.fetch).toHaveBeenCalledTimes(failure === 'http-401' ? 1 : 0);
      expect(ui.get('preview-status').textContent).toContain('登入未完成');
      expect(ui.get('preview-test').disabled).toBe(true);
      ui.get('preview-test').disabled = false;
      ui.get('preview-test').onclick?.();
      expect(ui.geo).toHaveBeenCalledTimes(failure === 'before-click' ? 0 : 1);
      expect(ui.get('preview-history').hidden).toBe(true);
    }
  );
});

describe('mobile result feedback (real inline controller)', () => {
  it.each([
    ['zh_TW', '確認位置並簽到', '定位中…', '送出中…', '已簽到'],
    ['zh_CN', '确认位置并签到', '定位中…', '提交中…', '已签到'],
    ['en', 'Confirm location and check in', 'Locating…', 'Submitting…', 'Checked in']
  ])(
    'keeps %s progress truthful and announces success only after validation',
    async (lang, idle, locating, sending, completed) => {
      let resolve: ((response: Response) => void) | undefined;
      const pending = new Promise<Response>((done) => {
        resolve = done;
      });
      const ui = liveBrowser(valid + '&lang=' + lang, { fetch: async () => pending });
      await finishInit();
      const button = ui.get('preview-test');
      expect(button.textContent).toBe(idle);
      expect(button.attributes['aria-busy']).toBe('false');
      expect(ui.scroll).not.toHaveBeenCalled();
      expect(ui.focus).not.toHaveBeenCalled();
      button.onclick?.();
      expect(button.textContent).toBe(locating);
      expect(button.attributes['aria-busy']).toBe('true');
      expect(ui.get('preview-status').textContent).not.toContain('Attendance recorded');
      const submit = ui.geo.mock.calls[0]![0]({ coords: { latitude: 25, longitude: 121 } });
      expect(button.textContent).toBe(sending);
      expect(ui.get('preview-history').hidden).toBe(true);
      expect(ui.scroll).not.toHaveBeenCalled();
      button.disabled = false;
      button.onclick?.();
      expect(ui.geo).toHaveBeenCalledOnce();
      resolve?.(attendanceResponse());
      await submit;
      expect(button.textContent).toBe(completed);
      expect(button.disabled).toBe(true);
      expect(button.attributes['aria-busy']).toBe('false');
      expect(ui.get('preview-history').hidden).toBe(false);
      expect(ui.scroll).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', behavior: 'smooth' });
      expect(ui.focus).not.toHaveBeenCalled();
    }
  );
  it.each([
    { resultVisible: true, count: 0, behavior: 'smooth' },
    { reducedMotion: true, count: 1, behavior: 'auto' },
    { scrollApis: false, count: 0, behavior: 'smooth' },
    { matchMedia: false, count: 1, behavior: 'smooth' },
    { scrollThrows: true, count: 1, behavior: 'smooth' }
  ])(
    'only reveals an offscreen submitted result, with graceful browser fallback: %j',
    async ({ count, behavior, ...options }) => {
      const ui = liveBrowser(valid + '&lang=zh_TW', {
        ...options,
        fetch: async () => attendanceResponse()
      });
      await finishInit();
      expect(ui.scroll).not.toHaveBeenCalled();
      ui.get('preview-test').onclick?.();
      await ui.geo.mock.calls[0]![0]({ coords: { latitude: 25, longitude: 121 } });
      expect(ui.get('preview-status').textContent).toContain('出席已記錄');
      expect(ui.get('preview-test').textContent).toBe('已簽到');
      expect(ui.get('preview-test').disabled).toBe(true);
      expect(ui.scroll).toHaveBeenCalledTimes(count);
      if (count) expect(ui.scroll).toHaveBeenCalledWith({ block: 'nearest', behavior });
      expect(ui.focus).not.toHaveBeenCalled();
    }
  );
  it.each([1, 2, 3])(
    'GPS failure %s clears busy, reveals the error and allows deliberate retry',
    async (code) => {
      const ui = liveBrowser(valid + '&lang=zh_TW');
      await finishInit();
      ui.get('preview-test').onclick?.();
      ui.geo.mock.calls[0]![1]({ code });
      expect(ui.get('preview-status').textContent).toContain(
        code === 1 ? '未允許' : code === 3 ? '逾時' : '無法取得'
      );
      expect(ui.get('preview-test').textContent).toBe('確認位置並簽到');
      expect(ui.get('preview-test').attributes['aria-busy']).toBe('false');
      expect(ui.get('preview-test').disabled).toBe(false);
      expect(ui.get('preview-history').hidden).toBe(true);
      expect(ui.scroll).toHaveBeenCalledOnce();
      ui.get('preview-test').onclick?.();
      expect(ui.geo).toHaveBeenCalledTimes(2);
      expect(ui.fetch).not.toHaveBeenCalled();
    }
  );
  it.each([
    null,
    { ok: true },
    { ok: true, venue: { name: 'Synthetic', timezone: 'Asia/Taipei' }, checkedInAt: 'invalid' },
    {
      ok: true,
      venue: { name: 'Synthetic', timezone: 'unknown/zone' },
      checkedInAt: '2026-10-27T00:00:00Z'
    },
    { ok: true, isTest: true, verificationMode: 'distance_debug' }
  ])('HTTP 200 malformed or wrong-mode result is not success: %#', async (data) => {
    const ui = liveBrowser(valid + '&lang=zh_TW', {
      fetch: async () => new Response(JSON.stringify(data))
    });
    await finishInit();
    ui.get('preview-test').onclick?.();
    await ui.geo.mock.calls[0]![0]({ coords: { latitude: 25, longitude: 121 } });
    expect(ui.get('preview-test').textContent).toBe('確認位置並簽到');
    expect(ui.get('preview-test').disabled).toBe(false);
    expect(ui.get('preview-test').attributes['aria-busy']).toBe('false');
    expect(ui.get('preview-status').textContent).toContain('無法確認結果');
    expect(ui.get('preview-history').hidden).toBe(true);
    expect(ui.scroll).toHaveBeenCalledOnce();
  });
  it('a language-save failure does not reinterpret a previously completed test result as formal attendance', async () => {
    const ui = liveBrowser(base + '?venue=tw-taipei-cks&lang=zh_TW', {
      fetch: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            isTest: true,
            verificationMode: 'distance_debug',
            venue: { name: 'Synthetic venue', timezone: 'Asia/Taipei' },
            checkedInAt: '2026-10-27T00:00:00Z'
          })
        ),
      preferences: async () => new Response('{}', { status: 503 })
    });
    await finishInit();
    ui.get('preview-debug-enabled').checked = true;
    await ui.get('preview-debug-enabled').onchange?.();
    ui.get('preview-debug-token').value = 'synthetic-manual-memory-only-debug-token';
    ui.get('preview-test').onclick?.();
    await ui.geo.mock.calls[0]![0]({ coords: { latitude: 25, longitude: 121 } });
    expect(ui.get('preview-test').textContent).toBe('測試已完成');
    expect(ui.get('preview-notice').textContent).toBe('僅供測試，不計正式出席');
    ui.scroll.mockClear();
    ui.get('preview-language').value = 'en';
    await ui.get('preview-language').onchange?.();
    expect(ui.get('preview-debug-enabled').checked).toBe(false);
    expect(ui.get('preview-debug-token').value).toBe('');
    expect(ui.get('preview-notice').textContent).toBe('僅供測試，不計正式出席');
    expect(ui.get('preview-test').textContent).toBe('測試已完成');
    expect(ui.get('preview-test').disabled).toBe(true);
    expect(ui.get('preview-test').attributes['aria-busy']).toBe('false');
    expect(ui.scroll).not.toHaveBeenCalled();
    expect(ui.focus).not.toHaveBeenCalled();
  });
  it('a server failure leaves retryable feedback; retry alone can produce a success label', async () => {
    const ui = liveBrowser(valid + '&lang=zh_TW', {
      fetch: async () => new Response('{}', { status: 503 })
    });
    await finishInit();
    ui.get('preview-test').onclick?.();
    await ui.geo.mock.calls[0]![0]({ coords: { latitude: 25, longitude: 121 } });
    expect(ui.get('preview-test').disabled).toBe(false);
    expect(ui.get('preview-test').attributes['aria-busy']).toBe('false');
    expect(ui.get('preview-test').textContent).toBe('確認位置並簽到');
    expect(ui.get('preview-history').hidden).toBe(true);
    ui.fetch.mockResolvedValueOnce(attendanceResponse());
    ui.get('preview-test').onclick?.();
    await ui.geo.mock.calls[1]![0]({ coords: { latitude: 25, longitude: 121 } });
    expect(ui.get('preview-test').textContent).toBe('已簽到');
    expect(ui.fetch).toHaveBeenCalledTimes(2);
  });
  it('preview completion is a location test, not an attendance success', async () => {
    const ui = await routeBrowser(valid + '&lang=zh_TW');
    await finishInit();
    ui.get('preview-test').onclick?.();
    await ui.geo.mock.calls[0]![0]({ coords: { latitude: 25, longitude: 121 } });
    expect(ui.get('preview-test').textContent).toBe('定位測試完成');
    expect(ui.get('preview-status').textContent).toContain('尚未記錄出席');
    expect(ui.fetch).not.toHaveBeenCalled();
    expect(ui.scroll).toHaveBeenCalledOnce();
  });
  it.each([valid, primary(), valid + '&lang=en'])(
    'does not scroll or focus during SDK, primary or preference navigation: %s',
    async (route) => {
      const ui = liveBrowser(route, {
        preferences: async () => new Response(JSON.stringify({ locale: 'en' }))
      });
      await finishInit();
      expect(ui.scroll).not.toHaveBeenCalled();
      expect(ui.focus).not.toHaveBeenCalled();
    }
  );
  it('keeps a single live status immediately after the button and before history, after manual-code details', () => {
    const html = renderVenuePreview(
      'mock-liff',
      { venue: 'tw-location-test', lang: 'zh_TW' },
      'checkin',
      true,
      'tw-location-test'
    );
    const markup = html.split('<script')[0]!;
    expect(markup.match(/role="status"/g)).toHaveLength(1);
    expect(markup).toContain('h1,p,label,a,summary{overflow-wrap:anywhere}');
    expect(markup).not.toMatch(/overflow(?:-x)?:(?:hidden|clip)|user-scalable|maximum-scale/);
    expect(markup).toMatch(
      /<\/details>\s*<button id="preview-test"[^>]*aria-describedby="preview-status"[^>]*>[\s\S]*?<\/button>\s*<p id="preview-status" role="status" aria-live="polite" aria-atomic="true">/
    );
    expect(markup.indexOf('id="preview-status"')).toBeLessThan(
      markup.indexOf('id="preview-history"')
    );
  });
});

describe('real buildApp venue preview routing', () => {
  it.each(['/line/', '/line/checkin', '/line/?liff.state=%2Fapply%23private'])(
    'keeps ordinary page unchanged: %s',
    async (url) => {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(
        renderChannelWorkspacePage({ platform: 'line', liffId: config.liffId }, 'checkin', 'zh_TW')
      );
    }
  );
  it.each([
    valid,
    base + '?venue=tw-tpe-daan',
    primary(),
    primary() + '&code=mock-sdk-code&state=mock-sdk-state'
  ])('serves a no-store, non-indexed isolated preview: %s', async (url) => {
    const response = await app.inject(url);
    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff'
    });
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['content-security-policy']).not.toContain("connect-src 'self'");
    expect(response.body).toContain('測試預覽，尚未記錄出席');
    expect(response.body).toContain('tw-tpe-daan');
    expect(response.body).toContain('尚無可信場地資料');
    expect(response.body).toContain('min-height:48px');
    expect(response.body).toContain('aria-live="polite"');
    expect(response.body).not.toContain('user-scalable=no');
    expect(response.body).toContain(
      'Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting'
    );
    expect(response.body).toContain('href="/line/checkin?lang=zh_TW"');
    expect(response.body).not.toMatch(
      /簽到成功|\/api\/v1\/|localStorage|sessionStorage|sendBeacon|qrserver/
    );
  });
  const invalidQueries = [
    '',
    '?source=qr',
    '?venue=',
    '?venue=tw-tpe-daan&venue=tw-other',
    '?venue=tw-tpe-daan&source=qr&source=nfc',
    '?venue=tw-tpe-daan&lang=en&lang=zh_TW',
    '?venue=tw-tpe-daan&source=evil',
    '?venue=tw-tpe-daan&lang=fr',
    '?venue=TW-DAAN',
    '?venue=tw_tpe_daan',
    '?venue=tw--daan',
    '?venue=' + 'a'.repeat(65) + '-tw',
    '?venue=%00tw-daan',
    '?venue=%3C%2Fscript%3E%3Cscript%3Eattack-marker%3C%2Fscript%3E',
    '?venue=tw-tpe-daan&attack-marker=%3Cscript%3E',
    ...[
      'token',
      'idToken',
      'id_token',
      'person',
      'personId',
      'volunteerId',
      'latitude',
      'longitude',
      'gps',
      'date',
      'test',
      'bypass',
      'redirect'
    ].map((key) => '?venue=tw-tpe-daan&' + key + '=attack-marker')
  ];
  it.each(invalidQueries)(
    'rejects malformed/unknown/identity/location query without reflection: %s',
    async (suffix) => {
      for (const route of [base + suffix, primary('/venue-checkin' + suffix)]) {
        const response = await app.inject(route);
        expect(response.statusCode).toBe(400);
        expect(response.body).toContain('入口參數無效');
        expect(response.body).not.toContain('<script');
        expect(response.body).not.toContain('attack-marker');
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
      }
    }
  );
  it.each([
    primary() + '&liff.state=%2Fvenue-checkin%3Fvenue%3Dtw-other',
    primary() + '&personId=attack-marker',
    primary('/venue-checkin?venue=tw-tpe-daan#attack-marker'),
    primary('/venue-checkin/../other?venue=tw-tpe-daan'),
    primary('/venue-checkin?venue=tw-tpe-daan&lang=en&lang=zh_TW'),
    primary('/venue-checkin?venue=tw-tpe-daan&x=' + 'a'.repeat(600))
  ])('rejects malformed primary states: %s', async (route) => {
    const response = await app.inject(route);
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('attack-marker');
    expect(response.body).not.toContain('<script');
  });
  it.each(['zh_TW', 'zh_CN', 'en'])(
    'preserves supported language from appended state: %s',
    async (lang) => {
      const response = await app.inject(
        primary('/venue-checkin?venue=tw-tpe-daan&source=nfc&lang=' + lang)
      );
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('source=nfc&lang=' + lang);
      expect(response.body).toContain('href="/line/checkin?lang=' + lang + '"');
      const result = venuePreviewRequest(valid + '&lang=' + lang);
      expect(result.kind).toBe('preview');
      if (result.kind === 'preview')
        expect(venuePreviewUrl(result.entry)).toBe(valid + '&lang=' + lang);
    }
  );
  it('uses presentation cookie when lang is absent, without calling preference API', async () => {
    const response = await app.inject({
      url: valid,
      headers: { cookie: '__Host-qigong-learner-locale=en' }
    });
    expect(response.body).toContain('<html lang="en">');
    const vm = browser(response.body, 'https://app.test' + valid, {
      cookie: '__Host-qigong-learner-locale=en'
    });
    await finishInit();
    expect(vm.history.replaceState).toHaveBeenCalledWith(null, '', valid);
    expect(vm.preferences).not.toHaveBeenCalled();
  });
  it('does not exist without LINE configuration and does not expose old NFC routes', async () => {
    const disabled = buildApp({ pool: { query, connect } as unknown as Pool, logger: false });
    try {
      expect((await disabled.inject(valid)).statusCode).toBe(404);
    } finally {
      await disabled.close();
    }
    expect((await app.inject('/api/v1/fields/active')).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/field-checkin', payload: {} })).statusCode
    ).toBe(404);
    expect((await app.inject({ method: 'POST', url: base, payload: {} })).statusCode).toBe(404);
  });
  it('escapes configured LIFF ID as inline script data', async () => {
    const html = renderVenuePreview('</script><script>attack-marker()</script>', {
      venue: 'tw-tpe-daan',
      lang: 'zh_TW'
    });
    expect(html).not.toContain('</script><script>attack-marker');
    const vm = browser(html);
    await finishInit();
    expect(vm.liff.init).toHaveBeenCalledWith({
      liffId: '</script><script>attack-marker()</script>'
    });
  });
});

describe('mock SDK/VM probes against real route HTML (no external SDK loaded)', () => {
  it('waits for init; keeps primary URL untouched and leaves secondary navigation to SDK', async () => {
    let complete: (() => void) | undefined;
    const init = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const vm = await routeBrowser(primary(), { init: () => init, loggedIn: false });
    expect(vm.liff.init).toHaveBeenCalledOnce();
    expect(vm.history.replaceState).not.toHaveBeenCalled();
    expect(vm.get('preview-test').disabled).toBe(true);
    vm.get('preview-test').onclick?.();
    expect(vm.geo).not.toHaveBeenCalled();
    complete?.();
    await finishInit();
    expect(vm.liff.isLoggedIn).not.toHaveBeenCalled();
    expect(vm.liff.login).not.toHaveBeenCalled();
    expect(vm.history.replaceState).not.toHaveBeenCalled();
    expect(vm.location.replace).not.toHaveBeenCalled();
    expect(vm.geo).not.toHaveBeenCalled();
    expect(vm.get('preview-language').disabled).toBe(true);
    expect(vm.get('preview-status').textContent).toContain('正在開啟 LINE 頁面');
  });
  it.each(['nfc', 'qr', 'link'])(
    'retains venue/source/lang through external login and secondary cleanup: %s',
    async (source) => {
      const route = base + '?venue=tw-tpe-daan&source=' + source + '&lang=en';
      const first = await routeBrowser(route, { loggedIn: false });
      await finishInit();
      expect(first.liff.login).toHaveBeenCalledOnce();
      const redirectUri = 'https://app.test' + route + '&_line_login_attempt=1';
      expect(first.liff.login).toHaveBeenCalledWith({ redirectUri });
      expect(first.history.replaceState).not.toHaveBeenCalled();
      expect(first.get('preview-test').disabled).toBe(true);
      const second = await routeBrowser(
        route + '&_line_login_attempt=1&code=mock-secret&state=mock-oauth'
      );
      await finishInit();
      expect(second.history.replaceState).toHaveBeenCalledWith(null, '', route);
      expect(second.liff.login).not.toHaveBeenCalled();
      expect(second.get('preview-test').disabled).toBe(false);
      expect(second.geo).not.toHaveBeenCalled();
      second.get('preview-language').value = 'zh_CN';
      await second.get('preview-language').onchange?.();
      expect(second.location.replace).toHaveBeenCalledWith(
        base + '?venue=tw-tpe-daan&source=' + source + '&lang=zh_CN'
      );
    }
  );
  it.each([
    { route: valid + '&_line_login_attempt=1', options: { loggedIn: false } },
    { route: valid + '&code=mock-code', options: { loggedIn: false } },
    { route: valid + '&error=access_denied', options: { loggedIn: false } },
    { route: valid, options: { loggedIn: false, inClient: true } },
    { route: valid, options: { idToken: '' } },
    {
      route: valid,
      options: {
        init: async () => {
          throw new Error('private-sdk-error');
        }
      }
    }
  ])('fails closed without login loops or GPS: %#', async ({ route, options }) => {
    const vm = await routeBrowser(route, options);
    await finishInit();
    expect(vm.liff.login).not.toHaveBeenCalled();
    expect(vm.geo).not.toHaveBeenCalled();
    expect(vm.get('preview-test').disabled).toBe(true);
    expect(vm.get('preview-status').textContent).toContain('尚未記錄出席');
    expect(vm.get('preview-status').textContent).not.toContain('private-sdk-error');
  });
  it('does not persist or reuse a private fragment in the external login redirect', async () => {
    const html = (await app.inject(valid)).body;
    const vm = browser(html, 'https://app.test' + valid + '#' + 'a'.repeat(43), {
      loggedIn: false
    });
    await finishInit();
    expect(vm.liff.login).toHaveBeenCalledWith({
      redirectUri: 'https://app.test' + valid + '&_line_login_attempt=1'
    });
    expect(vm.storage.getItem).not.toHaveBeenCalled();
    expect(vm.storage.setItem).not.toHaveBeenCalled();
  });
  it.each([
    [1, '未允許定位'],
    [2, '無法取得定位'],
    [3, '定位逾時']
  ])('shows readable GPS failure %s only after a user click', async (code, message) => {
    const vm = await routeBrowser();
    await finishInit();
    expect(vm.geo).not.toHaveBeenCalled();
    vm.geo.mockImplementation((_success, failure, settings) => {
      expect(settings).toEqual({ enableHighAccuracy: false, timeout: 10000, maximumAge: 0 });
      failure({ code: Number(code) });
    });
    vm.get('preview-test').onclick?.();
    expect(vm.geo).toHaveBeenCalledOnce();
    expect(vm.get('preview-status').textContent).toContain(message);
    expect(vm.get('preview-status').textContent).toContain('尚未記錄出席');
    expect(vm.get('preview-test').disabled).toBe(false);
  });
  it('handles unsupported and throwing geolocation', async () => {
    const unsupported = await routeBrowser(valid, { geolocation: false });
    await finishInit();
    unsupported.get('preview-test').onclick?.();
    expect(unsupported.get('preview-status').textContent).toContain('不支援定位');
    const throwing = await routeBrowser();
    await finishInit();
    throwing.geo.mockImplementation(() => {
      throw new Error('private-gps-error');
    });
    throwing.get('preview-test').onclick?.();
    expect(throwing.get('preview-status').textContent).toContain('無法取得定位');
    expect(throwing.get('preview-status').textContent).not.toContain('private-gps-error');
    expect(throwing.get('preview-test').disabled).toBe(false);
  });
  it('discards raw coordinates; no false attendance success, storage, logs, API or duplicate requests', async () => {
    const vm = await routeBrowser();
    await finishInit();
    let success: ((position: unknown) => void | Promise<void>) | undefined;
    vm.geo.mockImplementation((callback) => {
      success = callback;
    });
    vm.get('preview-test').onclick?.();
    vm.get('preview-test').onclick?.();
    expect(vm.geo).toHaveBeenCalledOnce();
    expect(vm.get('preview-language').disabled).toBe(true);
    const coordinates = vi.fn(() => {
      throw new Error('Coordinates must not be read or serialized');
    });
    await success?.(Object.defineProperty({}, 'coords', { get: coordinates }));
    expect(coordinates).not.toHaveBeenCalled();
    expect(vm.get('preview-status').textContent).toContain('定位已取得，但未經後端場地驗證');
    expect(vm.get('preview-status').textContent).toContain('尚未記錄出席');
    expect(vm.get('preview-status').textContent).not.toContain('簽到成功');
    expect(vm.get('preview-test').disabled).toBe(false);
    expect(vm.get('preview-language').disabled).toBe(false);
    expect(vm.storage.getItem).not.toHaveBeenCalled();
    expect(vm.storage.setItem).not.toHaveBeenCalled();
    expect(vm.log).not.toHaveBeenCalled();
    expect(vm.history.replaceState).toHaveBeenCalledWith(null, '', valid);
  });
});
