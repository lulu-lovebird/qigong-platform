import { setImmediate } from 'node:timers/promises';
import { Script } from 'node:vm';
import type { Pool } from '@qigong/database';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { renderChannelWorkspacePage } from '../src/channel-workspace-pages.js';
import type { LineConfig } from '../src/line-onboarding.js';

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
