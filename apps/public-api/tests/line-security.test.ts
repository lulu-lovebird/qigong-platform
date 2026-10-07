import { createHmac } from 'node:crypto';
import pg from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

const secret = 'test-line-channel-secret-32-characters';
const subject = 'U' + 'a'.repeat(32);
const origin = 'https://checkin.baiyinqigong.org';
const pool = new pg.Pool();
const createApp = () =>
  buildApp({
    pool,
    logger: false,
    line: {
      channelSecret: secret,
      channelAccessToken: 'mock-access-token',
      loginChannelId: '123456',
      liffId: '123456-test'
    }
  });

const sign = (raw: string) => createHmac('sha256', secret).update(raw).digest('base64');
afterEach(() => vi.unstubAllGlobals());

describe('LINE security without database or external services', () => {
  it('serves LIFF entry and child pages with privacy headers and no server-side state redirects', async () => {
    const app = createApp();
    try {
      for (const url of [
        '/line/',
        '/line/?liff.state=%2Fapply%23token',
        '/line/?liff.state=https%3A%2F%2Fattacker.example',
        '/line/apply',
        '/line/checkin'
      ]) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/html');
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['referrer-policy']).toBe('no-referrer');
        expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
        expect(response.headers.location).toBeUndefined();
        expect(response.body).toContain('liff.init({ liffId })');
        expect(response.body).toContain('https://static.line-scdn.net/liff/edge/2/sdk.js');
        expect(response.body).not.toContain('attacker.example');
      }
    } finally {
      await app.close();
    }
    const disabled = buildApp({ pool, logger: false });
    try {
      expect((await disabled.inject({ method: 'GET', url: '/line/' })).statusCode).toBe(404);
    } finally {
      await disabled.close();
    }
  });
  it('accepts signed empty verification events and rejects changed raw bodies', async () => {
    const app = createApp();
    try {
      const raw = JSON.stringify({ events: [] });
      const headers = { 'content-type': 'application/json', 'x-line-signature': sign(raw) };
      expect(
        (await app.inject({ method: 'POST', url: '/line/webhook', headers, payload: raw }))
          .statusCode
      ).toBe(200);
      expect(
        (await app.inject({ method: 'POST', url: '/line/webhook', headers, payload: raw + ' ' }))
          .statusCode
      ).toBe(401);
      for (const signature of ['', 'bad', Buffer.alloc(32).toString('base64')]) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/line/webhook',
              headers: { ...headers, 'x-line-signature': signature },
              payload: raw
            })
          ).statusCode
        ).toBe(401);
      }
      for (const payload of ['{', JSON.stringify({ events: [{}] })]) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/line/webhook',
              headers: { ...headers, 'x-line-signature': sign(payload) },
              payload
            })
          ).statusCode
        ).toBe(400);
      }
    } finally {
      await app.close();
    }
  });

  it('rejects absent or foreign origins before contacting LINE', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp();
    try {
      for (const route of [
        'onboarding/apply',
        'checkin/methods',
        'checkin/history',
        'checkin/submit',
        'checkin/correct'
      ]) {
        for (const headers of [{}, { origin: 'https://attacker.example' }, { origin: 'null' }]) {
          expect(
            (
              await app.inject({
                method: 'POST',
                url: '/line/' + route,
                headers,
                payload: { idToken: 'token' }
              })
            ).statusCode
          ).toBe(403);
        }
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    ['expired', { sub: subject, aud: '123456', exp: 1 }],
    ['wrong audience', { sub: subject, aud: '654321', exp: 4102444800 }],
    ['invalid subject', { sub: 'attacker', aud: '123456', exp: 4102444800 }],
    ['missing claims', { sub: subject }]
  ])('rejects ID tokens with %s', async (_label, claims) => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(claims), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/line/checkin/history',
        headers: { origin },
        payload: { idToken: 'invalid-token' }
      });
      expect(response.statusCode).toBe(401);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.line.me/oauth2/v2.1/verify',
        expect.objectContaining({ method: 'POST' })
      );
      const body = fetchMock.mock.calls[0]?.[1]?.body;
      expect(body).toBeInstanceOf(URLSearchParams);
      if (!(body instanceof URLSearchParams)) throw new Error('Expected form-encoded verification');
      expect(body.toString()).toBe('id_token=invalid-token&client_id=123456');
    } finally {
      await app.close();
    }
  });

  it.each(['rejected', 'network failure', 'invalid JSON'])(
    'fails closed on LINE verification %s',
    async (failure) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          if (failure === 'network failure') throw new Error('network unavailable');
          return new Response(failure === 'invalid JSON' ? '{' : '{}', {
            status: failure === 'rejected' ? 401 : 200
          });
        })
      );
      const app = createApp();
      try {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/line/checkin/history',
              headers: { origin },
              payload: { idToken: 'invalid-token' }
            })
          ).statusCode
        ).toBe(401);
      } finally {
        await app.close();
      }
    }
  );

  it('rejects missing and oversized tokens without verification', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp();
    try {
      for (const payload of [{}, { idToken: '' }, { idToken: 'x'.repeat(4097) }]) {
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/line/checkin/history',
              headers: { origin },
              payload
            })
          ).statusCode
        ).toBe(401);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
