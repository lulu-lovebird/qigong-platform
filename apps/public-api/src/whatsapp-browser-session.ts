import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { isLearnerPrivacyError } from './learner-privacy-routes.js';
export const whatsappSessionCookie = '__Host-qigong-whatsapp';
export const whatsappCsrfCookie = '__Host-qigong-whatsapp-csrf';
export const whatsappWorkspaceCredentialSchema = z
  .object({
    token: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
    locale: z.enum(['zh_TW', 'en']).default('zh_TW')
  })
  .strict();
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const origin = 'https://checkin.baiyinqigong.org';
const credentialFailure = (error: unknown) =>
  error instanceof Error &&
  /^(invalid WhatsApp (browser session|link)|WhatsApp checkin identity unavailable|practice identity unavailable|learner eligibility unavailable)$/.test(
    error.message
  );
const cookie = (name: string, value: string, maxAge: number, httpOnly: boolean) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}`;
const clearCookies = () => [
  cookie(whatsappSessionCookie, '', 0, true),
  cookie(whatsappCsrfCookie, '', 0, false)
];
const readCookie = (request: FastifyRequest, name: string) => {
  const values = (request.headers.cookie ?? '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v.startsWith(name + '='));
  if (values.length !== 1) return null;
  const parsed = opaque.safeParse(values[0]!.slice(name.length + 1));
  return parsed.success ? parsed.data : null;
};
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const checkedCsrf = (request: FastifyRequest) => {
  const value = readCookie(request, whatsappCsrfCookie),
    header = request.headers['x-whatsapp-csrf-token'];
  return value && typeof header === 'string' && equal(value, header) ? value : null;
};
const execute = (pool: Pool, requestId: string, sql: string, values: unknown[]) =>
  withRequestContext(pool, 'qigong_api_runtime', { requestId }, (c) =>
    c.query<{ data: unknown }>(sql, values)
  );
const infoSchema = z.object({
  authenticated: z.literal(true),
  remembered: z.boolean(),
  expiresAt: z.string()
});
export const resolveWhatsAppWorkspaceCredential = async (
  pool: Pool,
  request: FastifyRequest
): Promise<string | null> => {
  const body = z.object({ token: opaque.optional() }).safeParse(request.body);
  if (!body.success) return null;
  const hasCookie = (request.headers.cookie ?? '')
    .split(';')
    .some((v) => v.trim().startsWith(whatsappSessionCookie + '='));
  try {
    if (hasCookie) {
      const session = readCookie(request, whatsappSessionCookie),
        csrf = checkedCsrf(request);
      if (!session || !csrf || body.data.token !== undefined) return null;
      await execute(pool, request.id, 'SELECT platform.whatsapp_browser_session_info($1,$2) data', [
        session,
        csrf
      ]);
      return session;
    }
    if (!body.data.token) return null;
    const result = await execute(
      pool,
      request.id,
      'SELECT platform.whatsapp_legacy_checkin_allowed($1) data',
      [body.data.token]
    );
    return result.rows[0]?.data === true ? body.data.token : null;
  } catch (error) {
    if (isLearnerPrivacyError(error)) throw error;
    if (credentialFailure(error)) return null;
    throw new Error('WhatsApp browser authentication unavailable');
  }
};
export const registerWhatsAppBrowserSessions = (app: FastifyInstance, pool: Pool) => {
  app.get('/whatsapp/auth/session', async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    if (request.headers.origin !== undefined && request.headers.origin !== origin)
      return reply.code(403).send({ error: 'invalid_origin' });
    const session = readCookie(request, whatsappSessionCookie),
      csrf = readCookie(request, whatsappCsrfCookie);
    if (!session || !csrf)
      return reply.code(401).header('set-cookie', clearCookies()).send({ authenticated: false });
    try {
      const result = await execute(
        pool,
        request.id,
        'SELECT platform.whatsapp_browser_session_info($1,$2) data',
        [session, csrf]
      );
      return infoSchema.parse(result.rows[0]?.data);
    } catch (error) {
      if (!isLearnerPrivacyError(error) && !credentialFailure(error))
        return reply.code(503).send({ error: 'browser_session_service_unavailable' });
      return reply
        .code(isLearnerPrivacyError(error) ? 403 : 401)
        .header('set-cookie', clearCookies())
        .send({
          authenticated: false,
          error: isLearnerPrivacyError(error)
            ? 'privacy_acceptance_required'
            : 'browser_session_unavailable'
        });
    }
  });
  app.post('/whatsapp/auth/session', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    if (
      request.headers.origin !== origin ||
      !request.headers['content-type']?.startsWith('application/json')
    )
      return reply.code(403).send({ error: 'invalid_origin' });
    const parsed = z
      .object({ token: opaque, remember: z.boolean() })
      .strict()
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_browser_login' });
    // A new private link never silently switches an existing browser identity.
    if (
      (request.headers.cookie ?? '')
        .split(';')
        .some((v) => v.trim().startsWith(whatsappSessionCookie + '='))
    )
      return reply.code(409).send({ error: 'logout_before_switching_account' });
    const session = randomBytes(32).toString('base64url'),
      csrf = randomBytes(32).toString('base64url');
    try {
      const result = await execute(
        pool,
        request.id,
        'SELECT platform.create_whatsapp_browser_session($1,$2,$3,$4) data',
        [parsed.data.token, session, csrf, parsed.data.remember]
      );
      const info = infoSchema.parse(result.rows[0]?.data);
      const age = parsed.data.remember ? 30 * 86400 : 15 * 60;
      return reply
        .header('set-cookie', [
          cookie(whatsappSessionCookie, session, age, true),
          cookie(whatsappCsrfCookie, csrf, age, false)
        ])
        .send(info);
    } catch (error) {
      if (!isLearnerPrivacyError(error) && !credentialFailure(error))
        return reply.code(503).send({ error: 'browser_login_service_unavailable' });
      return reply.code(isLearnerPrivacyError(error) ? 403 : 401).send({
        error: isLearnerPrivacyError(error)
          ? 'privacy_acceptance_required'
          : 'browser_login_unavailable'
      });
    }
  });
  app.post('/whatsapp/auth/logout', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    if (
      request.headers.origin !== origin ||
      !request.headers['content-type']?.startsWith('application/json')
    )
      return reply.code(403).send({ error: 'invalid_origin' });
    if (!z.object({}).strict().safeParse(request.body).success)
      return reply.code(400).send({ error: 'invalid_logout' });
    const session = readCookie(request, whatsappSessionCookie),
      csrf = checkedCsrf(request);
    if (!session || !csrf) return reply.code(403).send({ error: 'invalid_csrf' });
    try {
      await execute(
        pool,
        request.id,
        'SELECT platform.revoke_whatsapp_browser_session($1,$2) data',
        [session, csrf]
      );
      return reply.header('set-cookie', clearCookies()).send({ ok: true });
    } catch (error) {
      if (!isLearnerPrivacyError(error) && !credentialFailure(error))
        return reply.code(503).send({ error: 'browser_logout_service_unavailable' });
      return reply
        .code(isLearnerPrivacyError(error) ? 403 : 401)
        .header('set-cookie', clearCookies())
        .send({ error: 'browser_session_unavailable' });
    }
  });
};
