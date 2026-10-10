import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { resolveAdminLocale } from './admin-locale.js';
import { renderAdminLearnerPage } from './admin-learner-pages.js';
import { learnerPrivacyHash, learnerPrivacyVersion } from './learner-privacy-policy.js';
import { privacyNoticeSchema } from './learner-privacy-routes.js';
const object = z.record(z.string(), z.unknown());
export const registerAdminLearnerRoutes = (
  app: FastifyInstance,
  pool: Pool,
  principalFor: (r: FastifyRequest) => Promise<string | null>,
  validCsrf: (r: FastifyRequest) => boolean
) => {
  const execute = async (
    principalId: string,
    requestId: string,
    sql: string,
    values: unknown[] = []
  ) =>
    object.parse(
      (
        await withRequestContext(pool, 'qigong_api_runtime', { principalId, requestId }, (c) =>
          c.query<{ data: unknown }>(sql, values)
        )
      ).rows[0]?.data
    );
  const capability = async (principalId: string, requestId: string) =>
    z
      .object({
        canManageLearners: z.boolean(),
        canReadShared: z.boolean(),
        canPublishPrivacy: z.boolean(),
        canManageAdmins: z.boolean()
      })
      .parse(
        await execute(
          principalId,
          requestId,
          "SELECT jsonb_build_object('canManageLearners',admin.has_permission('learner.manage_profile'),'canReadShared',admin.has_permission('journal.read_shared'),'canPublishPrivacy',admin.is_super_admin(),'canManageAdmins',admin.can_manage_admin_access()) data"
        )
      );
  const fail = (e: unknown) => {
    const message = e instanceof Error ? e.message : '';
    if (message === 'learner access conflict' || message === 'privacy policy conflict')
      return { status: 409, code: 'learner_data_conflict' };
    if (
      [
        'learner unavailable',
        'learner access management denied',
        'privacy publication denied',
        'shared journal denied'
      ].includes(message)
    )
      return { status: 403, code: 'learner_access_denied' };
    if (message.startsWith('invalid ')) return { status: 400, code: 'invalid_learner_request' };
    return { status: 503, code: 'learner_service_unavailable' };
  };
  for (const [path, kind] of [
    ['/admin/learners', 'learners'],
    ['/admin/shared-journal', 'shared'],
    ['/admin/privacy-policy', 'privacy']
  ] as const)
    app.get(path, async (request, reply) => {
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
      const principal = await principalFor(request);
      if (!principal) return reply.redirect('/admin/auth/login');
      const cap = await capability(principal, request.id);
      if (
        !(kind === 'learners'
          ? cap.canManageLearners
          : kind === 'shared'
            ? cap.canReadShared
            : cap.canPublishPrivacy)
      )
        return reply.code(403).send({ error: 'learner_access_denied' });
      return reply
        .header('x-content-type-options', 'nosniff')
        .header(
          'content-security-policy',
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        )
        .type('text/html; charset=utf-8')
        .send(
          renderAdminLearnerPage(
            kind,
            resolveAdminLocale(request.query, request.headers.cookie),
            cap.canManageAdmins
          )
        );
    });
  for (const [path, kind] of [
    ['/admin/api/learners', 'learners'],
    ['/admin/api/shared-journal', 'shared'],
    ['/admin/api/privacy-policy', 'privacy']
  ] as const)
    app.get(path, async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const principal = await principalFor(request);
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
      const parsed = z
        .object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          q: z.string().max(100).default(''),
          lang: z.enum(['zh_TW', 'en']).optional()
        })
        .strict()
        .safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_learner_query' });
      try {
        if (kind === 'privacy') {
          if (!(await capability(principal, request.id)).canPublishPrivacy)
            return reply.code(403).send({ error: 'learner_access_denied' });
          return privacyNoticeSchema.parse(
            await execute(principal, request.id, 'SELECT platform.privacy_notice() data')
          );
        }
        return await execute(
          principal,
          request.id,
          kind === 'learners'
            ? 'SELECT admin.learner_access_list($1,$2) data'
            : 'SELECT admin.shared_journal($2,$1) data',
          [
            parsed.data.page,
            kind === 'learners'
              ? parsed.data.q
              : resolveAdminLocale(request.query, request.headers.cookie)
          ]
        );
      } catch (e) {
        const f = fail(e);
        return reply.code(f.status).send({ error: f.code });
      }
    });
  app.post('/admin/api/learners/:id/suspend', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    if (!validCsrf(request)) return reply.code(403).send({ error: 'invalid_csrf' });
    const params = z.object({ id: z.uuid() }).strict().safeParse(request.params),
      body = z
        .object({
          version: z.number().int().min(1).max(2147483647),
          reason: z
            .string()
            .trim()
            .refine((v) => [...v].length >= 1 && [...v].length <= 500 && !v.includes('\0'))
        })
        .strict()
        .safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_learner_suspension' });
    try {
      return await execute(principal, request.id, 'SELECT admin.suspend_learner($1,$2,$3) data', [
        params.data.id,
        body.data.version,
        body.data.reason
      ]);
    } catch (e) {
      const f = fail(e);
      return reply.code(f.status).send({ error: f.code });
    }
  });
  app.post('/admin/api/privacy-policy/publish', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    if (!validCsrf(request)) return reply.code(403).send({ error: 'invalid_csrf' });
    const body = z
      .object({
        version: z.literal(learnerPrivacyVersion),
        hash: z.literal(learnerPrivacyHash),
        reason: z
          .string()
          .trim()
          .refine((v) => [...v].length >= 1 && [...v].length <= 500 && !v.includes('\0'))
      })
      .strict()
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_privacy_publication' });
    try {
      await withRequestContext(
        pool,
        'qigong_api_runtime',
        { principalId: principal, requestId: request.id },
        (c) =>
          c.query('SELECT admin.publish_privacy_policy($1,$2,$3)', [
            body.data.version,
            body.data.hash,
            body.data.reason
          ])
      );
      return { published: true, version: learnerPrivacyVersion };
    } catch (e) {
      const f = fail(e);
      return reply.code(f.status).send({ error: f.code });
    }
  });
};
