import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { accessCookie, registerAdminAccessRoutes } from './admin-access.js';
import { renderReviewPage } from './admin-pages.js';
import { registerAdminJournalRoutes } from './admin-journal-routes.js';
import { registerAdminLearnerRoutes } from './admin-learner-routes.js';
import {
  adminLocaleCookie,
  adminNameColumn,
  adminTexts,
  resolveAdminLocale
} from './admin-locale.js';
import { renderAdminDashboard, renderAdminShell } from './admin-dashboard.js';
import {
  getAdminReport,
  ReportError,
  reportQuerySchema,
  reportViewSchema
} from './admin-reporting.js';

export interface AdminAuthProvider {
  begin(verifier: string, state: string, nonce: string): Promise<URL>;
  complete(
    url: URL,
    verifier: string,
    state: string,
    nonce: string
  ): Promise<{ iss: string; sub: string; name?: string; verifiedEmail?: string }>;
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
      const csrf = token();
      if (!allowed.rows[0]?.allowed) {
        const pending = token();
        const registered = await withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: request.id },
          (client) =>
            client.query<{ allowed: boolean }>(
              'SELECT admin.begin_access_login($1,$2,$3,$4,$5) allowed',
              [pending, claims.iss, claims.sub, claims.name ?? null, claims.verifiedEmail ?? null]
            )
        );
        if (!registered.rows[0]?.allowed)
          return reply
            .code(403)
            .header('set-cookie', [
              clearCookie(stateCookie),
              clearCookie(sessionCookie),
              clearCookie(accessCookie),
              clearCookie(csrfCookie)
            ])
            .send({ error: 'administrator_unavailable' });
        return reply
          .header('set-cookie', [
            clearCookie(stateCookie),
            clearCookie(sessionCookie),
            cookie(accessCookie, pending, 28800),
            cookie(csrfCookie, csrf, 28800, false)
          ])
          .header('cache-control', 'no-store')
          .redirect('/admin/access');
      }
      return reply
        .header('set-cookie', [
          clearCookie(stateCookie),
          clearCookie(accessCookie),
          cookie(sessionCookie, session, 28800),
          cookie(csrfCookie, csrf, 28800, false)
        ])
        .redirect('/admin/');
    } catch {
      app.log.warn({ requestId: request.id }, 'admin OIDC callback rejected');
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
    const result = await withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId: request.id, principalId },
      (c) => c.query<{ allowed: boolean }>('SELECT admin.can_manage_admin_access() allowed')
    );
    return { principalId, canManageAdmins: result.rows[0]?.allowed === true };
  });

  app.get('/admin', async (request, reply) =>
    reply.redirect('/admin/' + new URL(request.url, 'http://localhost').search)
  );
  for (const [path, page] of [
    ['/admin/', 'overview'],
    ['/admin/leaderboard', 'leaderboard'],
    ['/admin/method-analysis', 'methods'],
    ['/admin/applications', 'review']
  ] as const) {
    app.get(path, async (request, reply) => {
      const locale = resolveAdminLocale(request.query, request.headers.cookie);
      void reply.header('set-cookie', cookie(adminLocaleCookie, locale, 31536000, false));
      const principalId = await principalFor(request);
      if (!principalId)
        return reply.header('cache-control', 'no-store').redirect('/admin/auth/login');
      const management = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id, principalId },
        (c) => c.query<{ allowed: boolean }>('SELECT admin.can_manage_admin_access() allowed')
      );
      let html: string;
      if (page === 'review') html = renderReviewPage(locale, management.rows[0]?.allowed === true);
      else {
        const permission = await withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: request.id, principalId },
          (client) =>
            client.query<{ allowed: boolean }>(
              "SELECT admin.has_permission('stats.read') AND admin.has_permission('learner.read') AND admin.has_permission('checkin.read') AS allowed"
            )
        );
        if (permission.rows[0]?.allowed)
          html = renderAdminDashboard(page, locale, management.rows[0]?.allowed === true);
        else {
          void reply.code(403);
          html = renderAdminShell(
            page,
            '<p id="status" role="status">' + adminTexts(locale).reportDenied + '</p>',
            '',
            locale
          );
        }
      }
      return reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff')
        .header(
          'content-security-policy',
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        )
        .type('text/html; charset=utf-8')
        .send(html);
    });
  }

  app.get('/admin/api/reports/:view', async (request, reply) => {
    void reply.header('cache-control', 'no-store');
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    const params = z.object({ view: reportViewSchema }).safeParse(request.params);
    const query = reportQuerySchema.safeParse(request.query);
    if (!params.success || !query.success)
      return reply.code(400).send({ error: 'invalid_report_query' });
    try {
      return await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id, principalId },
        (client) =>
          getAdminReport(client, params.data.view, {
            ...query.data,
            lang: query.data.lang ?? resolveAdminLocale({}, request.headers.cookie)
          })
      );
    } catch (error) {
      if (error instanceof ReportError)
        return reply.code(error.status).send({ error: error.message });
      app.log.error({ requestId: request.id }, 'admin report unavailable');
      return reply.code(503).send({ error: 'report_unavailable' });
    }
  });

  app.get('/admin/api/applications', async (request, reply) => {
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    void reply.header('cache-control', 'no-store');
    const language = z
      .object({ lang: z.enum(['zh_TW', 'en']).optional() })
      .strict()
      .safeParse(request.query);
    if (!language.success) return reply.code(400).send({ error: 'invalid_language' });
    const locale = language.data.lang ?? resolveAdminLocale({}, request.headers.cookie);
    const result = await withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId: request.id, principalId },
      (client) =>
        client.query(
          `SELECT application.id, application.platform, application.display_name, application.learner_name,
                  application.website_email, application.phone_e164, application.requested_region_id,
                  region.${adminNameColumn(locale)} AS region_name, application.status, application.created_at
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

  registerAdminAccessRoutes(app, pool, principalFor, (request) => {
    const csrf = request.headers['x-csrf-token'];
    const saved = cookies(request)[csrfCookie];
    return (
      typeof csrf === 'string' &&
      typeof saved === 'string' &&
      saved.length > 0 &&
      timingSafeEqual(sha256(csrf), sha256(saved))
    );
  });

  registerAdminJournalRoutes(app, pool, principalFor, (request) => {
    const value = request.headers['x-csrf-token'],
      saved = cookies(request)[csrfCookie];
    return (
      typeof value === 'string' &&
      typeof saved === 'string' &&
      saved.length > 0 &&
      timingSafeEqual(sha256(value), sha256(saved))
    );
  });

  registerAdminLearnerRoutes(app, pool, principalFor, (request) => {
    const value = request.headers['x-csrf-token'],
      saved = cookies(request)[csrfCookie];
    return (
      typeof value === 'string' &&
      typeof saved === 'string' &&
      saved.length > 0 &&
      timingSafeEqual(sha256(value), sha256(saved))
    );
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
    if (values[accessCookie])
      await withRequestContext(pool, 'qigong_api_runtime', { requestId: request.id }, (client) =>
        client.query('SELECT admin.revoke_access_session($1)', [values[accessCookie]])
      );
    return reply
      .header('set-cookie', [
        clearCookie(sessionCookie),
        clearCookie(accessCookie),
        clearCookie(csrfCookie)
      ])
      .send({ ok: true });
  });
};
