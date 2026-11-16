import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readWhatsAppVenueSession,
  type WhatsAppVenueSession
} from '../src/whatsapp-venue-session.js';
import { whatsappCsrfCookie, whatsappSessionCookie } from '../src/whatsapp-browser-session.js';

const origin = 'https://checkin.baiyinqigong.org';
const session = 's'.repeat(43);
const csrf = 'c'.repeat(43);
const cookies = `${whatsappSessionCookie}=${session}; ${whatsappCsrfCookie}=${csrf}`;
const validHeaders = {
  origin,
  'content-type': 'application/json',
  cookie: cookies,
  'x-whatsapp-csrf-token': csrf
};

describe('WhatsApp venue Session-only transport boundary (not DB authority)', () => {
  let app: FastifyInstance;
  let seen: WhatsAppVenueSession | undefined;
  beforeEach(async () => {
    seen = undefined;
    app = Fastify();
    app.addContentTypeParser('application/jsonp', (_request, _payload, done) => done(null, {}));
    app.route({
      method: ['GET', 'POST'],
      url: '/probe',
      handler: (request, reply) => {
        const result = readWhatsAppVenueSession(request, origin);
        if (!result.ok) return reply.code(result.status).send({ error: result.error });
        seen = result.credential;
        // Never serialize credentials, even in this isolated test-only route.
        return { transportValid: true };
      }
    });
  });
  afterEach(async () => {
    await app.close();
  });

  it('keeps valid Cookie/CSRF credentials server-side without claiming authorization', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: validHeaders,
      payload: {}
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ transportValid: true });
    expect(seen).toEqual({ session, csrf });
    expect(response.body).not.toContain(session);
    expect(response.body).not.toContain(csrf);
  });
  it('supports a JSON charset and ignores unrelated cookies', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: {
        ...validHeaders,
        'content-type': 'application/json; charset=utf-8',
        cookie: 'unrelated=value; ' + cookies
      },
      payload: {}
    });
    expect(response.statusCode).toBe(200);
  });
  it.each([
    ['missing', undefined],
    ['null', 'null'],
    ['other site', 'https://evil.example'],
    ['suffix attack', origin + '.evil.example'],
    ['trailing slash', origin + '/'],
    ['http', origin.replace('https:', 'http:')]
  ])('rejects %s Origin', async (_name, value) => {
    const headers: Record<string, string> = { ...validHeaders };
    if (value === undefined) delete headers.origin;
    else headers.origin = value;
    const response = await app.inject({ method: 'POST', url: '/probe', headers, payload: {} });
    expect(response.statusCode).toBe(403);
    expect(seen).toBeUndefined();
  });
  it('does not trust Host or forwarded headers as Origin', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: {
        ...validHeaders,
        origin: 'https://evil.example',
        host: 'checkin.baiyinqigong.org',
        'x-forwarded-host': 'checkin.baiyinqigong.org'
      },
      payload: {}
    });
    expect(response.statusCode).toBe(403);
  });
  it('rejects a contradictory cross-site fetch', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: { ...validHeaders, 'sec-fetch-site': 'cross-site' },
      payload: {}
    });
    expect(response.statusCode).toBe(403);
  });
  it('does not authorize GET even with transport credentials', async () => {
    const response = await app.inject({ method: 'GET', url: '/probe', headers: validHeaders });
    expect(response.statusCode).toBe(405);
  });
  it('does not mistake JSONP for JSON', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: { ...validHeaders, 'content-type': 'application/jsonp' },
      payload: '{}'
    });
    expect(response.statusCode).toBe(415);
  });
  it.each([
    '',
    `${whatsappCsrfCookie}=${csrf}`,
    `${whatsappSessionCookie}=short; ${whatsappCsrfCookie}=${csrf}`,
    `${cookies}; ${whatsappSessionCookie}=${session}`,
    `${cookies}; ${whatsappSessionCookie}=${'x'.repeat(43)}`,
    `${whatsappSessionCookie}=${session}%0A; ${whatsappCsrfCookie}=${csrf}`
  ])('rejects missing, malformed or duplicate Session cookies: %j', async (cookie) => {
    const response = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: { ...validHeaders, cookie },
      payload: {}
    });
    expect(response.statusCode).toBe(401);
    expect(seen).toBeUndefined();
  });
  it.each([
    { cookie: `${whatsappSessionCookie}=${session}` },
    { cookie: `${cookies}; ${whatsappCsrfCookie}=${csrf}` },
    { 'x-whatsapp-csrf-token': 'x'.repeat(43) },
    { 'x-whatsapp-csrf-token': 'short' },
    { 'x-whatsapp-csrf-token': '' },
    { 'x-whatsapp-csrf-token': csrf + ',' + csrf }
  ])('rejects missing, malformed, duplicate or mismatched CSRF: %j', async (headers) => {
    const response = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: { ...validHeaders, ...headers },
      payload: {}
    });
    expect(response.statusCode).toBe(403);
    expect(seen).toBeUndefined();
  });
  it.each([
    'token',
    'session',
    'csrf',
    'idToken',
    'subject',
    'personId',
    'identityId',
    'platform',
    'channel'
  ])('rejects body %s even with otherwise valid transport', async (key) => {
    const response = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: validHeaders,
      payload: { [key]: 'untrusted' }
    });
    expect(response.statusCode).toBe(400);
    expect(seen).toBeUndefined();
  });
  it('never falls back to a private link token when no Session Cookie exists', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: { origin, 'content-type': 'application/json' },
      payload: { token: session }
    });
    expect(response.statusCode).toBe(400);
    expect(seen).toBeUndefined();
  });
  it.each([[], ['not-an-object'], null])('rejects a non-object body: %j', async (payload) => {
    const response = await app.inject({
      method: 'POST',
      url: '/probe',
      headers: validHeaders,
      payload: JSON.stringify(payload)
    });
    expect(response.statusCode).toBe(400);
  });
});
