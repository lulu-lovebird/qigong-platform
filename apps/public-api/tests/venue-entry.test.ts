import { setImmediate } from 'node:timers/promises';
import { Script } from 'node:vm';
import type { Pool } from '@qigong/database';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { renderChannelWorkspacePage } from '../src/channel-workspace-pages.js';
import type { LineConfig } from '../src/line-onboarding.js';
import {
  registerVenueEntry,
  isLegacyVenueGuidanceResult,
  type LegacyManagedLookup,
  type VenueGuidanceLookup
} from '../src/venue-entry.js';
import { formatVenueEntrySession } from '../src/line-venue-checkin-page.js';
import type {
  VenueEntryAvailabilityDto,
  VenueEntryAvailabilityResult
} from '../src/venue-entry-guidance.js';

const query = vi.fn(async () => {
  throw new Error('DB forbidden');
});
const connect = vi.fn(async () => {
  throw new Error('DB forbidden');
});
const verifyIdentity = vi.fn(async () => {
  throw new Error('Verifier forbidden');
});
const reply = vi.fn(async () => {
  throw new Error('Push forbidden');
});
const network = vi.fn(async () => {
  throw new Error('Network forbidden');
});
const line: LineConfig = {
  channelSecret: 'mock-secret',
  channelAccessToken: 'mock-access-token',
  loginChannelId: 'mock-login-channel',
  liffId: 'mock-liff',
  verifyIdentity,
  reply
};
const pool = { query, connect } as unknown as Pool;
const base = '/venue-checkin?venue=tw-location-test';
let app: FastifyInstance;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', undefined);
  vi.stubGlobal('fetch', network);
  app = buildApp({ pool, logger: false, line });
});
afterEach(async () => {
  await app.close();
  for (const forbidden of [query, connect, verifyIdentity, reply, network])
    expect(forbidden).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const lineLink = (html: string): string => {
  const href = html.match(/<a href="([^"]+)">/)?.[1];
  if (!href) throw new Error('Missing LINE link');
  return href.replaceAll('&amp;', '&');
};

// Inline code comes from real buildApp responses; no external SDK is loaded.
const sdkBrowser = (html: string, path: string, loggedIn: boolean) => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('Missing preview script');
  const liff = {
    init: vi.fn(async () => {}),
    isLoggedIn: vi.fn(() => loggedIn),
    isInClient: vi.fn(() => false),
    getIDToken: vi.fn(() => 'mock-token-never-sent'),
    login: vi.fn()
  };
  const replaceState = vi.fn();
  new Script(script).runInNewContext({
    URL,
    URLSearchParams,
    liff,
    location: new URL(path, 'https://app.test'),
    history: { replaceState },
    document: { cookie: '', getElementById: () => ({ disabled: true, textContent: '' }) },
    navigator: {},
    fetch: network
  });
  return { liff, replaceState };
};

describe('buildApp shared venue entry', () => {
  const combinations = ['nfc', 'qr', 'link'].flatMap((source) =>
    ['zh_TW', 'zh_CN', 'en'].map((lang) => ({ source, lang }))
  );
  it.each(combinations)(
    'chooses LINE and retains $source / $lang through LIFF and login',
    async ({ source, lang }) => {
      const canonicalQuery = `venue=tw-location-test&source=${source}&lang=${lang}`;
      const response = await app.inject('/venue-checkin?' + canonicalQuery);
      expect(response.statusCode).toBe(200);
      expect(response.headers.location).toBeUndefined();
      expect(response.body.match(/<a /g)).toHaveLength(1);
      const chosen = await app.inject(lineLink(response.body));
      expect(chosen.statusCode).toBe(303);
      expect(chosen.headers.location).toBe(
        `https://liff.line.me/mock-liff/venue-checkin?${canonicalQuery}`
      );
      const suffix =
        new URL(String(chosen.headers.location)).pathname.slice('/mock-liff'.length) +
        '?' +
        canonicalQuery;
      const primary = '/line/?liff.state=' + encodeURIComponent(suffix);
      const primaryResponse = await app.inject(primary);
      expect(primaryResponse.statusCode).toBe(200);
      const first = sdkBrowser(primaryResponse.body, primary, false);
      await setImmediate();
      expect(first.liff.init).toHaveBeenCalledWith({ liffId: 'mock-liff' });
      expect(first.liff.login).not.toHaveBeenCalled();
      expect(first.replaceState).not.toHaveBeenCalled();
      const secondary = '/line/venue-checkin?' + canonicalQuery;
      const secondaryResponse = await app.inject(secondary);
      expect(secondaryResponse.statusCode).toBe(200);
      const external = sdkBrowser(secondaryResponse.body, secondary, false);
      await setImmediate();
      expect(external.liff.login).toHaveBeenCalledWith({
        redirectUri: 'https://app.test' + secondary + '&_line_login_attempt=1'
      });
      const callback = secondary + '&_line_login_attempt=1&code=mock-callback&state=mock-state';
      const completed = sdkBrowser((await app.inject(callback)).body, callback, true);
      await setImmediate();
      expect(completed.replaceState).toHaveBeenCalledWith(null, '', secondary);
      expect(completed.liff.login).not.toHaveBeenCalled();
    }
  );
  it('uses safe defaults and presentation cookie, without preference API or DB access', async () => {
    const defaultPage = await app.inject(base);
    expect(lineLink(defaultPage.body)).toBe(base + '&source=link&lang=zh_TW&channel=line');
    const cookiePage = await app.inject({
      url: base,
      headers: { cookie: '__Host-qigong-learner-locale=en' }
    });
    expect(cookiePage.body).toContain('<html lang="en">');
    expect(lineLink(cookiePage.body)).toContain('&source=link&lang=en&channel=line');
    const explicit = await app.inject({
      url: base + '&lang=zh_CN',
      headers: { cookie: '__Host-qigong-learner-locale=en' }
    });
    expect(explicit.body).toContain('<html lang="zh-Hans">');
  });
  it('labels syntactically valid unknown venues as unverified, not a trusted name or enabled venue', async () => {
    const response = await app.inject('/venue-checkin?venue=unknown-valid-code&lang=en');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<code>unknown-valid-code</code>');
    expect(response.body).toContain('Venue code (unverified)');
    expect(response.body).toContain('Name, existence and active status are unverified');
    expect(response.body).toContain('unknown or disabled venues cannot check in');
    expect(response.body).toContain('Attendance has NOT been recorded');
    expect(response.body).toContain('Telegram / WhatsApp venue check-in is not implemented');
  });
  it('applies restrictive public-page and redirect headers with no SDK, GPS, form or external resource', async () => {
    for (const url of [base, base + '&channel=line', '/venue-checkin']) {
      const response = await app.inject(url);
      expect(response.headers).toMatchObject({
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-robots-tag': 'noindex, nofollow',
        'x-content-type-options': 'nosniff',
        'permissions-policy': 'geolocation=(), camera=(), microphone=()'
      });
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.body).not.toMatch(
        /<script|<form|<img|<iframe|navigator\.|localStorage|sessionStorage|sendBeacon/
      );
    }
    expect((await app.inject(base)).body).toContain(
      'Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting'
    );
  });
  it.each([
    undefined,
    '',
    '</script><script>attack-marker()</script>',
    '//evil.example',
    'id/path',
    'id?x=y',
    'id#hash',
    'a'.repeat(101)
  ])('disables unconfigured or unsafe LINE IDs: %s', async (liffId) => {
    const disabled = buildApp({
      pool,
      logger: false,
      ...(liffId === undefined ? {} : { line: { ...line, liffId } })
    });
    try {
      for (const [suffix, status] of [
        ['', 200],
        ['&channel=line', 503]
      ] as const) {
        const response = await disabled.inject(base + suffix + '&lang=en');
        expect(response.statusCode).toBe(status);
        expect(response.body).toContain('LINE entry is not configured');
        expect(response.body).not.toContain('<a ');
        expect(response.body).not.toContain('attack-marker');
        expect(response.headers.location).toBeUndefined();
      }
    } finally {
      await disabled.close();
    }
  });
  const badQueries = [
    '',
    '?source=qr',
    '?venue=',
    '?venue=tw-location-test&venue=tw-other',
    '?venue=tw-location-test&%76enue=tw-other',
    '?venue[]=tw-location-test',
    '?venue=TW-TEST',
    '?venue=tw_test',
    '?venue=tw--test',
    '?venue=tw-test-',
    '?venue=tw',
    '?venue=' + 'a'.repeat(63) + '-b',
    '?venue=%00tw-test',
    '?venue=%3Cscript%3Eattack-marker%3C/script%3E',
    '?venue=tw-test%0d%0aLocation:evil',
    '?venue=//evil.example',
    '?venue=https://evil.example',
    '?venue=tw-test%26person=x',
    '?venue=tw-test&source=',
    '?venue=tw-test&source=unknown',
    '?venue=tw-test&source=qr&source=qr',
    '?venue=tw-test&lang=en&lang=en',
    '?venue=tw-test&lang=',
    '?venue=tw-test&lang=fr',
    '?venue=tw-test&channel=telegram',
    '?venue=tw-test&channel=whatsapp',
    '?venue=tw-test&channel=unknown',
    '?venue=tw-test&channel=',
    '?venue=tw-test&channel=line&channel=line',
    '?venue=tw-test&channel=https://evil.example',
    '?venue=tw-test&venue.name=attack-marker',
    '?venue=tw-test&__proto__=attack-marker',
    '?venue=tw-test&constructor=attack-marker',
    '?venue=tw-test&%6cang=%',
    '?venue=tw-test&lang=%FF',
    '?venue=tw-test&lang=%C0%AF',
    '?venue=tw-test&lang=en' + '&'.repeat(600),
    ...[
      'token',
      'idToken',
      'person',
      'personId',
      'GPS',
      'latitude',
      'longitude',
      'redirect',
      'redirect_uri',
      'next',
      'url',
      'liff.state',
      'liffRedirectUri',
      'code',
      'state',
      '_line_login_attempt',
      'test',
      'bypass',
      'mode'
    ].map((key) => '?venue=tw-test&' + key + '=attack-marker')
  ];
  it.each(badQueries)(
    'rejects ambiguous, unknown and hostile input without reflecting it: %s',
    async (suffix) => {
      const response = await app.inject('/venue-checkin' + suffix);
      expect(response.statusCode).toBe(400);
      expect(response.headers.location).toBeUndefined();
      expect(response.body).toContain('入口參數無效');
      expect(response.body).not.toMatch(/attack-marker|evil\.example|<a |<script/);
    }
  );
  it('ignores spoofed host and forwarding headers when building the fixed LINE destination', async () => {
    const response = await app.inject({
      url: base + '&channel=line&source=nfc&lang=en',
      headers: {
        host: 'evil.example',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'http'
      }
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(
      'https://liff.line.me/mock-liff/venue-checkin?venue=tw-location-test&source=nfc&lang=en'
    );
  });
  it('accepts the schema code length boundary of 64 characters', async () => {
    const venue = 'a-' + 'b'.repeat(62);
    expect((await app.inject('/venue-checkin?venue=' + venue)).statusCode).toBe(200);
  });
  it.each(['/line/', '/line/checkin', '/line/?liff.state=%2Fapply%23private'])(
    'keeps existing daily workspace unchanged: %s',
    async (url) => {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(
        renderChannelWorkspacePage({ platform: 'line', liffId: line.liffId }, 'checkin', 'zh_TW')
      );
    }
  );
});

// Explicit standalone composition only: buildApp remains default-off and unwired.
const publicCode = 'us-practice-hall';
const publicSession = {
  opensAt: '2026-10-30T15:45:00Z',
  startsAt: '2026-10-30T16:15:00Z',
  endsAt: '2026-10-31T16:00:00Z'
};
const publicAvailability = (
  availability: VenueEntryAvailabilityDto['availability'] = 'open'
): VenueEntryAvailabilityDto => ({
  version: 1,
  availability,
  venue:
    availability === 'not_found'
      ? null
      : { code: publicCode, name: 'Original 場地 & name', timezone: 'Asia/Taipei' },
  observedAt: '2026-10-30T16:00:00Z',
  relevantSession: ['open', 'before_open', 'ended'].includes(availability) ? publicSession : null,
  nextSession: null
});
const publicResult = (
  state: VenueEntryAvailabilityDto['availability'] = 'open'
): VenueEntryAvailabilityResult =>
  state === 'unavailable'
    ? { status: 503, body: { error: 'venue_entry_unavailable' } }
    : {
        status: state === 'not_found' ? 404 : state === 'disabled' ? 410 : 200,
        body: publicAvailability(state)
      };
const publicUrl = '/venue-checkin?venue=' + publicCode;
const expectReadOnly = (html: string) => {
  expect(html).not.toMatch(
    /<(?:a|button|input|select|script|form)\b|sdk\.js|navigator\.|fetch\(|getIDToken|\/line\/(?:checkin|venue-history)|__Host-qigong|idToken|latitude|longitude/
  );
  expect(html).toContain('Developed with ❤️ by Bean, Bird &amp; Badminton Tech Consulting');
};

describe('explicit authoritative public venue guidance (unit HTTP, not NFC/provider acceptance)', () => {
  const apps: FastifyInstance[] = [];
  const standalone = (
    guidance: VenueGuidanceLookup | undefined,
    legacy: LegacyManagedLookup = vi.fn(async () => {
      throw Error('Legacy fallback forbidden');
    }),
    liffId = 'mock-liff'
  ) => {
    const isolated = Fastify({ logger: false });
    apps.push(isolated);
    registerVenueEntry(isolated, liffId, legacy, guidance);
    return isolated;
  };
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((isolated) => isolated.close()));
  });
  it.each(
    ['nfc', 'qr', 'link'].flatMap((source) =>
      ['zh_TW', 'zh_CN', 'en'].map((lang) => ({ source, lang }))
    )
  )(
    'only DB open permits the fixed official LINE redirect: $source / $lang',
    async ({ source, lang }) => {
      const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue(publicResult());
      const legacy = vi.fn<LegacyManagedLookup>().mockResolvedValue(null);
      const isolated = standalone(lookup, legacy);
      const canonical = `${publicUrl}&source=${source}&lang=${lang}`;
      const page = await isolated.inject(canonical);
      expect(page.statusCode).toBe(200);
      expect(page.body.match(/<a /g)).toHaveLength(1);
      expect(page.body).toContain('Original 場地 &amp; name');
      const expectedChoice = canonical + '&channel=line';
      expect(lineLink(page.body)).toBe(expectedChoice);
      const chosen = await isolated.inject({
        url: expectedChoice,
        headers: {
          host: 'evil.example',
          'x-forwarded-host': 'evil.example',
          'x-forwarded-proto': 'http'
        }
      });
      expect(chosen.statusCode).toBe(303);
      expect(chosen.headers.location).toBe(
        `https://liff.line.me/mock-liff/venue-checkin?venue=${publicCode}&source=${source}&lang=${lang}`
      );
      expect(lookup).toHaveBeenCalledTimes(2);
      for (const call of lookup.mock.calls) expect(call).toEqual([expect.any(String), publicCode]);
      expect(legacy).not.toHaveBeenCalled();
      expect(page.headers).toMatchObject({
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'permissions-policy': 'geolocation=(), camera=(), microphone=()',
        'x-robots-tag': 'noindex, nofollow'
      });
      expect(chosen.headers['cache-control']).toBe('no-store');
      expect(page.body).not.toMatch(/<script|<form|navigator|fetch\(|idToken|evil\.example/);
      if (lang === 'en') {
        expect(page.body).toContain('NFC tag first');
        expect(page.body).toContain('scan QR');
        expect(page.body).toContain('not invitations or proof of presence');
      }
    }
  );
  it.each(
    (
      ['before_open', 'ended', 'not_activity_day', 'disabled', 'not_found', 'unavailable'] as const
    ).flatMap((state) => ['', '&channel=line'].map((channel) => ({ state, channel })))
  )(
    'closed $state is read-only even with explicit LINE selection $channel',
    async ({ state, channel }) => {
      const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue(publicResult(state));
      const legacy = vi
        .fn<LegacyManagedLookup>()
        .mockResolvedValue({ code: publicCode, name: 'Must not be used', active: true });
      const response = await standalone(lookup, legacy).inject(
        publicUrl + '&source=nfc&lang=en' + channel
      );
      expect(response.statusCode).toBe(
        state === 'disabled'
          ? 410
          : state === 'not_found'
            ? 404
            : state === 'unavailable'
              ? 503
              : 200
      );
      expect(response.headers.location).toBeUndefined();
      expectReadOnly(response.body);
      expect(response.body).not.toMatch(
        /Must not be used|Continue with LINE|Telegram|unknown or disabled/
      );
      expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.any(String), publicCode);
      expect(legacy).not.toHaveBeenCalled();
    }
  );
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'renders full venue-local opening/start/end dates and next session in %s',
    async (lang) => {
      const next = {
        opensAt: '2026-11-01T15:45:00Z',
        startsAt: '2026-11-01T16:15:00Z',
        endsAt: '2026-11-02T16:00:00Z'
      };
      const body = { ...publicAvailability('before_open'), nextSession: next };
      const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue({ status: 200, body });
      const response = await standalone(lookup).inject(publicUrl + '&lang=' + lang);
      expect(response.statusCode).toBe(200);
      const formatter = new Intl.DateTimeFormat(
        lang === 'zh_TW' ? 'zh-Hant' : lang === 'zh_CN' ? 'zh-Hans' : 'en',
        {
          timeZone: 'Asia/Taipei',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23'
        }
      );
      for (const session of [publicSession, next]) {
        const formatted = formatVenueEntrySession(session, 'Asia/Taipei', lang);
        for (const key of ['opensAt', 'startsAt', 'endsAt'] as const) {
          expect(formatted?.[key]).toBe(formatter.format(new Date(session[key])));
          expect(response.body).toContain(formatted![key]);
        }
      }
      expect(response.body).toContain('Original 場地 &amp; name');
      expect(response.body).toContain('Asia/Taipei');
      expect(response.body).not.toMatch(/30 minutes|30分鐘|30分钟|midnight/);
      expectReadOnly(response.body);
    }
  );
  it('shows unknown next session without inventing times, and locale cookies require no preference read', async () => {
    const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue(publicResult('not_activity_day'));
    const response = await standalone(lookup).inject({
      url: publicUrl,
      headers: { cookie: '__Host-qigong-learner-locale=en' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html lang="en">');
    expect(response.body).toContain('Next session unknown');
    expect(response.body).not.toContain('<dl>');
    expectReadOnly(response.body);
  });
  it.each([
    null,
    {},
    { mode: 'legacy', extra: 'private-marker' },
    { mode: 'legacy', status: 503 },
    { mode: 'guided' },
    { mode: 'unavailable' },
    'legacy',
    ['legacy'],
    { status: 503, body: { error: 'venue_entry_unavailable' } },
    { status: 200, body: null },
    { status: 410, body: publicAvailability() },
    { status: 200, body: { ...publicAvailability(), extra: 'private-marker' } },
    {
      status: 200,
      body: {
        ...publicAvailability(),
        venue: { code: 'other-hall', name: 'private-marker', timezone: 'UTC' }
      }
    },
    {
      status: 200,
      body: {
        ...publicAvailability(),
        venue: { code: publicCode, name: 'private-marker', timezone: 'bad/zone' }
      }
    },
    {
      status: 200,
      body: {
        ...publicAvailability(),
        relevantSession: { ...publicSession, startsAt: '2026-02-30T00:00:00Z' }
      }
    },
    { status: 200, body: { ...publicAvailability(), relevantSession: null } },
    { status: 200, body: { ...publicAvailability('unavailable') } },
    { status: 400, body: { error: 'invalid_venue_entry_request' } },
    { status: 503, body: { error: 'private-marker' } }
  ])('malformed or unbound guidance fails closed without legacy fallback: %#', async (result) => {
    const lookup = vi
      .fn<VenueGuidanceLookup>()
      .mockResolvedValue(result as VenueEntryAvailabilityResult);
    const legacy = vi
      .fn<LegacyManagedLookup>()
      .mockResolvedValue({ code: publicCode, name: 'private-marker', active: true });
    const response = await standalone(lookup, legacy).inject(publicUrl + '&lang=en&channel=line');
    expect(response.statusCode).toBe(503);
    expect(response.headers.location).toBeUndefined();
    expect(response.body).toContain('Venue lookup unavailable');
    expect(response.body).not.toContain('private-marker');
    expectReadOnly(response.body);
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'only the exact server legacy sentinel dispatches once, LINE=%s',
    async (channel) => {
      const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue({ mode: 'legacy' });
      const legacy = vi.fn<LegacyManagedLookup>().mockResolvedValue({
        code: publicCode,
        name: 'Legacy & name',
        active: true
      });
      const response = await standalone(lookup, legacy).inject(
        publicUrl + '&lang=en' + (channel ? '&channel=line' : '')
      );
      expect(response.statusCode).toBe(channel ? 303 : 200);
      expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.any(String), publicCode);
      expect(legacy).toHaveBeenCalledExactlyOnceWith(lookup.mock.calls[0]![0], publicCode);
      if (channel)
        expect(response.headers.location).toBe(
          `https://liff.line.me/mock-liff/venue-checkin?venue=${publicCode}&source=link&lang=en`
        );
      else expect(response.body).toContain('Legacy &amp; name');
    }
  );
  it('the sentinel without a managed reader retains unconfigured legacy text', async () => {
    const isolated = Fastify({ logger: false });
    apps.push(isolated);
    const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue({ mode: 'legacy' });
    registerVenueEntry(isolated, 'mock-liff', undefined, lookup);
    const response = await isolated.inject(publicUrl + '&lang=en');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('No trusted venue lookup is available');
    expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.any(String), publicCode);
  });
  it('the legacy guard rejects arrays, inherited/accessor modes and all extra own keys', () => {
    const getter = vi.fn(() => 'legacy');
    const inherited: unknown = Object.create({ mode: 'legacy' });
    const accessor: unknown = Object.defineProperty({}, 'mode', { get: getter });
    const hidden = Object.defineProperty({ mode: 'legacy' }, 'private', { value: true });
    for (const raw of [
      inherited,
      accessor,
      hidden,
      { mode: 'legacy', [Symbol('extra')]: true },
      [],
      null
    ])
      expect(isLegacyVenueGuidanceResult(raw)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(isLegacyVenueGuidanceResult({ mode: 'legacy' })).toBe(true);
  });
  it('a throwing authoritative lookup never reads the legacy adapter or reflects the exception', async () => {
    const lookup = vi.fn<VenueGuidanceLookup>().mockRejectedValue(Error('private-marker'));
    const legacy = vi
      .fn<LegacyManagedLookup>()
      .mockResolvedValue({ code: publicCode, name: 'private-marker', active: true });
    const response = await standalone(lookup, legacy).inject(publicUrl + '&channel=line&lang=en');
    expect(response.statusCode).toBe(503);
    expect(response.headers.location).toBeUndefined();
    expect(response.body).not.toContain('private-marker');
    expectReadOnly(response.body);
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each([
    '/venue-checkin',
    publicUrl + '&venue=' + publicCode,
    publicUrl + '&source=qr&source=nfc',
    publicUrl + '&lang=en&lang=zh_TW',
    publicUrl + '&channel=line&channel=line',
    publicUrl + '&channel=telegram',
    publicUrl + '&lang=%FF',
    publicUrl + '&idToken=private-marker',
    publicUrl + '&latitude=12.345',
    publicUrl + '&liff.state=%2Fapply',
    publicUrl + '&redirect=https%3A%2F%2Fevil.example',
    publicUrl + '&test=1',
    publicUrl + '&mode=distance_debug',
    publicUrl + '&mode=legacy',
    '/venue-checkin?venue=us-practice-hall%0A',
    '/venue-checkin?venue=%3Cscript%3Eprivate-marker%3C%2Fscript%3E'
  ])('invalid parameters read neither adapter: %s', async (url) => {
    const lookup = vi.fn<VenueGuidanceLookup>();
    const legacy = vi.fn<LegacyManagedLookup>();
    const response = await standalone(lookup, legacy).inject(url);
    expect(response.statusCode).toBe(400);
    expect(response.headers.location).toBeUndefined();
    expectReadOnly(response.body);
    expect(response.body).not.toMatch(/private-marker|evil\.example|12\.345/);
    expect(lookup).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });
  it.each(['', '//evil.example', '</script><script>private-marker()</script>', 'a'.repeat(101)])(
    'open venue still requires a safe configured LIFF ID: %s',
    async (liffId) => {
      const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue(publicResult());
      const isolated = standalone(lookup, undefined, liffId);
      for (const [suffix, status] of [
        ['', 200],
        ['&channel=line', 503]
      ] as const) {
        const response = await isolated.inject(publicUrl + '&lang=en' + suffix);
        expect(response.statusCode).toBe(status);
        expect(response.headers.location).toBeUndefined();
        expect(response.body).toContain('LINE entry is not configured');
        expect(response.body).not.toMatch(/<a\b|<script|private-marker|evil\.example/);
      }
    }
  );
  it('escapes all public proper-name markup without translating names or injecting script data', async () => {
    const body = {
      ...publicAvailability('before_open'),
      venue: {
        code: publicCode,
        name: '</script><script>private-marker()</script> & " \' \u2028\u2029',
        timezone: 'UTC'
      }
    };
    const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue({ status: 200, body });
    const response = await standalone(lookup).inject(publicUrl + '&lang=en');
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(
      '&lt;/script&gt;&lt;script&gt;private-marker()&lt;/script&gt; &amp; &quot; &#39;'
    );
    expectReadOnly(response.body);
    expect(response.body).not.toContain('</script><script>');
  });
  it.each(
    (['zh_TW', 'zh_CN', 'en'] as const).flatMap((lang) =>
      ['', '&channel=line'].map((channel) => ({ lang, channel }))
    )
  )(
    'preserves canonical disabled sentinel name and 410 in $lang with selection $channel',
    async ({ lang, channel }) => {
      const result: VenueEntryAvailabilityResult = {
        status: 410,
        body: {
          ...publicAvailability('disabled'),
          venue: { code: 'tw-location-test', name: 'Canonical test & name', timezone: 'UTC' }
        }
      };
      const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue(result);
      const legacy = vi.fn<LegacyManagedLookup>().mockResolvedValue({
        code: 'tw-location-test',
        name: 'Forbidden legacy name',
        active: true
      });
      const response = await standalone(lookup, legacy).inject(
        base + '&source=nfc&lang=' + lang + channel
      );
      expect(response.statusCode).toBe(410);
      expect(response.headers.location).toBeUndefined();
      expect(response.body).toContain('Canonical test &amp; name');
      expect(response.body).toContain('<code>tw-location-test</code>');
      expect(response.body).toContain(
        lang === 'en' ? 'Venue disabled' : lang === 'zh_TW' ? '場地已停用' : '场地已停用'
      );
      expect(response.body).not.toMatch(
        /Forbidden legacy name|Venue lookup unavailable|場地查詢暫不可用|场地查询暂不可用|Check-in is open|目前開放簽到|目前开放签到/
      );
      expectReadOnly(response.body);
      expect(lookup).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'tw-location-test');
      expect(legacy).not.toHaveBeenCalled();
    }
  );
  it('never turns the legacy test sentinel into guided formal attendance or a debug route', async () => {
    const body = {
      ...publicAvailability(),
      venue: { code: 'tw-location-test', name: 'Test', timezone: 'UTC' }
    };
    const lookup = vi.fn<VenueGuidanceLookup>().mockResolvedValue({ status: 200, body });
    const response = await standalone(lookup).inject(base + '&channel=line&lang=en');
    expect(response.statusCode).toBe(503);
    expect(response.headers.location).toBeUndefined();
    expectReadOnly(response.body);
  });
  it.each(['active', 'missing', 'disabled', 'throw', 'binding'] as const)(
    'the third argument retains the legacy managed lookup contract: %s',
    async (state) => {
      const legacy = vi.fn<LegacyManagedLookup>().mockImplementation(async () => {
        if (state === 'throw') throw Error('private-marker');
        if (state === 'missing') return null;
        return {
          code: state === 'binding' ? 'other-hall' : publicCode,
          name: 'Legacy & name',
          active: state !== 'disabled'
        };
      });
      const response = await standalone(undefined, legacy).inject(
        publicUrl + '&channel=line&lang=en'
      );
      expect(response.statusCode).toBe(
        state === 'active' ? 303 : state === 'missing' ? 404 : state === 'disabled' ? 410 : 503
      );
      expect(legacy).toHaveBeenCalledExactlyOnceWith(expect.any(String), publicCode);
      if (state === 'active')
        expect(response.headers.location).toContain(
          'https://liff.line.me/mock-liff/venue-checkin?'
        );
      else {
        expect(response.headers.location).toBeUndefined();
        expect(response.body).not.toContain('private-marker');
      }
    }
  );
});
