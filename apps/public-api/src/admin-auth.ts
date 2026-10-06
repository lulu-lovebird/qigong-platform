import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { reviewPage } from './admin-pages.js';

export interface AdminAuthProvider {
  begin(verifier: string, state: string, nonce: string): Promise<URL>;
  complete(
    url: URL,
    verifier: string,
    state: string,
    nonce: string
  ): Promise<{ iss: string; sub: string }>;
  callbackUrl: string;
}

const sessionCookie = '__Host-qigong-admin';
const csrfCookie = '__Host-qigong-admin-csrf';
const stateCookie = '__Host-qigong-admin-state';
const token = () => randomBytes(32).toString('base64url');
const sha256 = (value: string) => createHash('sha256').update(value).digest();
const cookie = (name: string, value: string, age: number, httpOnly = true) =>
  `${name}=${value}; Path=/; Max-Age=${age}; Secure; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}`;
const clearCookie = (name: string) => cookie(name, '', 0);
const cookies = (request: FastifyRequest) =>
  Object.fromEntries(
    (request.headers.cookie ?? '').split(';').flatMap((item) => {
      const index = item.indexOf('=');
      return index < 0 ? [] : [[item.slice(0, index).trim(), item.slice(index + 1).trim()]];
    })
  );
const callbackUrl = (provider: AdminAuthProvider, request: FastifyRequest) => {
  const url = new URL(provider.callbackUrl);
  const query = request.query;
  if (typeof query !== 'object' || query === null) return url;
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') url.searchParams.set(key, value);
  }
  return url;
};

export const registerAdminRoutes = (
  app: FastifyInstance,
  pool: Pool,
  provider: AdminAuthProvider
) => {
  app.get('/admin/auth/login', async (request, reply) => {
    const state = token();
    const verifier = token();
    const nonce = token();
    await withRequestContext(pool, 'qigong_api_runtime', { requestId: request.id }, (client) =>
      client.query('SELECT admin.start_login($1, $2, $3)', [state, verifier, nonce])
    );
    const redirect = await provider.begin(verifier, state, nonce);
    return reply.header('set-cookie', cookie(stateCookie, state, 300)).redirect(redirect.href);
  });

  app.get('/admin/auth/callback', async (request, reply) => {
    const params = callbackUrl(provider, request);
    const state = params.searchParams.get('state');
    if (!state || !params.searchParams.get('code') || cookies(request)[stateCookie] !== state) {
      return reply.code(400).send({ error: 'invalid_login_callback' });
    }
    const attempt = await withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId: request.id },
      (client) =>
        client.query<{ verifier: string; nonce: string }>('SELECT * FROM admin.consume_login($1)', [
          state
        ])
    );
    if (attempt.rows.length !== 1) return reply.code(400).send({ error: 'expired_login_callback' });
    try {
      const claims = await provider.complete(
        params,
        attempt.rows[0]!.verifier,
        state,
        attempt.rows[0]!.nonce
      );
      const session = token();
      const allowed = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id },
        (client) =>
          client.query<{ allowed: boolean }>('SELECT admin.create_session($1, $2, $3) AS allowed', [
            session,
            claims.iss,
            claims.sub
          ])
      );
      if (!allowed.rows[0]?.allowed)
        return reply.code(403).send({ error: 'administrator_not_provisioned' });
      const csrf = token();
      return reply
        .header('set-cookie', [
          clearCookie(stateCookie),
          cookie(sessionCookie, session, 28800),
          cookie(csrfCookie, csrf, 28800, false)
        ])
        .redirect('/admin/');
    } catch (error) {
      app.log.warn({ err: error }, 'admin OIDC callback rejected');
      return reply.code(400).send({ error: 'invalid_login_callback' });
    }
  });

  const principalFor = async (request: FastifyRequest) => {
    const session = cookies(request)[sessionCookie];
    if (!session || session.length > 128) return null;
    const result = await withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId: request.id },
      (client) =>
        client.query<{ principal_id: string | null }>(
          'SELECT admin.session_principal($1) AS principal_id',
          [session]
        )
    );
    return result.rows[0]?.principal_id ?? null;
  };

  app.get('/admin/auth/me', async (request, reply) => {
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    return { principalId };
  });

  app.get('/admin/', async (request, reply) => {
    if (!(await principalFor(request))) return reply.redirect('/admin/auth/login');
    return reply
      .header('cache-control', 'no-store')
      .header(
        'content-security-policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      )
      .type('text/html; charset=utf-8')
      .send(reviewPage);
  });

  app.get('/admin/api/applications', async (request, reply) => {
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    void reply.header('cache-control', 'no-store');
    const result = await withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId: request.id, principalId },
      (client) =>
        client.query(
          `SELECT application.id, application.platform, application.display_name, application.learner_name,
                  application.website_email, application.phone_e164, application.requested_region_id,
                  region.name_zh_tw AS region_name, application.status, application.created_at
           FROM identity.onboarding_applications application
           LEFT JOIN core.regions region ON region.id = application.requested_region_id
           WHERE application.status = 'pending' AND application.learner_name IS NOT NULL
             AND application.website_email IS NOT NULL AND application.phone_e164 IS NOT NULL
           ORDER BY application.created_at, application.id LIMIT 100`
        )
    );
    return { applications: result.rows };
  });

  const decisionSchema = z.object({
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().trim().min(1).max(1000).optional()
  });
  const validReviewConflict = (error: unknown) =>
    error instanceof Error &&
    /^(application is not pending|onboarding review permission denied|rejection reason required|region and display name required for approval|invalid review decision|application identity details required before approval)$/.test(
      error.message
    );

  const batchSchema = z
    .object({ ids: z.array(z.uuid()).min(1).max(100) })
    .refine(({ ids }) => new Set(ids).size === ids.length, 'duplicate application IDs');
  app.post('/admin/api/applications/batch-approve', async (request, reply) => {
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    const values = cookies(request);
    const csrf = request.headers['x-csrf-token'];
    if (
      typeof csrf !== 'string' ||
      !values[csrfCookie] ||
      !timingSafeEqual(sha256(csrf), sha256(values[csrfCookie]))
    ) {
      return reply.code(403).send({ error: 'invalid_csrf' });
    }
    const parsed = batchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_batch' });

    const results: Array<{ id: string; status: 'approved' | 'conflict' | 'unavailable' }> = [];
    for (const id of parsed.data.ids) {
      try {
        await withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: request.id, principalId },
          (client) =>
            client.query('SELECT identity.decide_application($1, $2, $3)', [id, 'approved', null])
        );
        results.push({ id, status: 'approved' });
      } catch (error) {
        app.log.warn({ err: error, applicationId: id }, 'batch application review rejected');
        results.push({ id, status: validReviewConflict(error) ? 'conflict' : 'unavailable' });
      }
    }
    return { results };
  });

  app.post('/admin/api/applications/:id/decision', async (request, reply) => {
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    const values = cookies(request);
    const csrf = request.headers['x-csrf-token'];
    if (
      typeof csrf !== 'string' ||
      !values[csrfCookie] ||
      !timingSafeEqual(sha256(csrf), sha256(values[csrfCookie]))
    ) {
      return reply.code(403).send({ error: 'invalid_csrf' });
    }
    const parsed = decisionSchema.safeParse(request.body);
    const params = z.object({ id: z.uuid() }).safeParse(request.params);
    if (
      !parsed.success ||
      !params.success ||
      (parsed.data.decision === 'rejected' && !parsed.data.reason)
    ) {
      return reply.code(400).send({ error: 'invalid_decision' });
    }
    try {
      const result = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id, principalId },
        (client) =>
          client.query<{ person_id: string | null }>(
            'SELECT identity.decide_application($1, $2, $3) AS person_id',
            [params.data.id, parsed.data.decision, parsed.data.reason ?? null]
          )
      );
      return { status: parsed.data.decision, personId: result.rows[0]?.person_id ?? null };
    } catch (error) {
      app.log.warn({ err: error }, 'application review rejected');
      if (validReviewConflict(error)) {
        return reply.code(409).send({ error: 'application_review_rejected' });
      }
      return reply.code(503).send({ error: 'application_review_unavailable' });
    }
  });

  app.post('/admin/auth/logout', async (request, reply) => {
    const values = cookies(request);
    const csrf = request.headers['x-csrf-token'];
    if (
      !csrf ||
      typeof csrf !== 'string' ||
      !values[csrfCookie] ||
      !timingSafeEqual(sha256(csrf), sha256(values[csrfCookie]))
    ) {
      return reply.code(403).send({ error: 'invalid_csrf' });
    }
    if (values[sessionCookie]) {
      await withRequestContext(pool, 'qigong_api_runtime', { requestId: request.id }, (client) =>
        client.query('SELECT admin.revoke_session($1)', [values[sessionCookie]])
      );
    }
    return reply
      .header('set-cookie', [clearCookie(sessionCookie), clearCookie(csrfCookie)])
      .send({ ok: true });
  });
};
