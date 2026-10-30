import { localeSchema } from './ui-localization.js';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { adminContentSecurityPolicy } from './admin-branding.js';
import { resolveAdminLocale } from './admin-locale.js';
import { renderReviewNotificationPage } from './admin-review-notification-page.js';
export const registerReviewNotificationRoutes = (
  app: FastifyInstance,
  pool: Pool,
  principalFor: (request: FastifyRequest) => Promise<string | null>,
  validCsrf: (request: FastifyRequest) => boolean,
  learnerReviewEnabled = false
) => {
  const query = async (principal: string, requestId: string, sql: string, values: unknown[] = []) =>
    z.record(z.string(), z.unknown()).parse(
      (
        await withRequestContext(
          pool,
          'qigong_api_runtime',
          { principalId: principal, requestId },
          async (c) => {
            await c.query("SELECT set_config('qigong.telegram_learner_review_enabled',$1,true)", [
              String(learnerReviewEnabled)
            ]);
            return c.query<{ data: unknown }>(sql, values);
          }
        )
      ).rows[0]?.data
    );
  const failure = (error: unknown) => {
    const text = error instanceof Error ? error.message : '';
    return text === 'review notification conflict'
      ? { status: 409, error: 'notification_conflict' }
      : text === 'review notification access denied'
        ? { status: 403, error: 'notification_access_denied' }
        : text.includes('rate limited')
          ? { status: 429, error: 'notification_rate_limited' }
          : text === 'review notification channel already bound'
            ? { status: 409, error: 'notification_channel_unavailable' }
            : text === 'review notification channel unavailable'
              ? { status: 400, error: 'notification_channel_unavailable' }
              : { status: 503, error: 'notification_service_unavailable' };
  };
  app.get('/admin/notifications', async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    const principal = await principalFor(request);
    if (!principal) return reply.redirect('/admin/auth/login');
    try {
      await query(principal, request.id, 'SELECT admin.review_notification_state() data');
      const can =
        (
          await withRequestContext(
            pool,
            'qigong_api_runtime',
            { principalId: principal, requestId: request.id },
            (c) => c.query<{ allowed: boolean }>('SELECT admin.can_manage_admin_access() allowed')
          )
        ).rows[0]?.allowed === true;
      return reply
        .header('content-security-policy', adminContentSecurityPolicy)
        .type('text/html; charset=utf-8')
        .send(
          renderReviewNotificationPage(
            resolveAdminLocale(request.query, request.headers.cookie),
            can
          )
        );
    } catch (error) {
      const f = failure(error);
      return reply.code(f.status).send({ error: f.error });
    }
  });
  app.get('/admin/api/notifications/state', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    try {
      return {
        ...(await query(principal, request.id, 'SELECT admin.review_notification_state() data')),
        learnerReviewFeatureEnabled: learnerReviewEnabled
      };
    } catch (error) {
      const f = failure(error);
      return reply.code(f.status).send({ error: f.error });
    }
  });
  const version = z.number().int().min(1).max(2147483647);
  for (const action of ['link', 'confirm', 'preferences', 'test'] as const)
    app.post('/admin/api/notifications/' + action, { bodyLimit: 4096 }, async (request, reply) => {
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
      const principal = await principalFor(request);
      if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
      if (
        request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
        !request.headers['content-type']?.startsWith('application/json') ||
        !validCsrf(request)
      )
        return reply.code(403).send({ error: 'invalid_csrf' });
      try {
        if (action === 'link' || action === 'test') {
          const linkInput = (
            action === 'link'
              ? z.object({ locale: localeSchema.optional() }).strict()
              : z.object({}).strict()
          ).safeParse(request.body);
          if (!linkInput.success)
            return reply.code(400).send({ error: 'invalid_notification_request' });
          const language =
            'locale' in linkInput.data && linkInput.data.locale
              ? linkInput.data.locale
              : resolveAdminLocale(request.query, request.headers.cookie);
          if (action === 'test')
            return await query(
              principal,
              request.id,
              'SELECT admin.test_review_notification() data'
            );
          const token = randomBytes(32).toString('base64url'),
            data = await query(
              principal,
              request.id,
              'SELECT admin.begin_review_notification_link($1,$2) data',
              [token, language]
            );
          return { ...data, token };
        }
        if (action === 'confirm') {
          const body = z
            .object({ id: z.uuid(), code: z.string().regex(/^[0-9]{6}$/), version })
            .strict()
            .safeParse(request.body);
          if (!body.success) return reply.code(400).send({ error: 'invalid_notification_request' });
          const data = await query(
            principal,
            request.id,
            'SELECT admin.confirm_review_notification_link($1,$2,$3) data',
            [body.data.id, body.data.code, body.data.version]
          );
          if (data.confirmed !== true)
            return reply.code(400).send({ error: 'invalid_notification_confirmation' });
          return data;
        }
        const body = z
          .object({
            version,
            adminEnabled: z.boolean(),
            learnerEnabled: z.boolean(),
            learnerReviewEnabled: z.boolean().default(false),
            learnerReviewDisclosure: z.literal('telegram-learner-review-v1').optional(),
            locale: localeSchema,
            disconnect: z.boolean().default(false)
          })
          .strict()
          .safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid_notification_request' });
        const v = body.data;
        if (v.learnerReviewEnabled) {
          if (!learnerReviewEnabled)
            return reply.code(403).send({ error: 'learner_review_disabled' });
          const currentSuper = await withRequestContext(
            pool,
            'qigong_api_runtime',
            { principalId: principal, requestId: request.id },
            (c) => c.query<{ allowed: boolean }>('SELECT admin.is_super_admin() allowed')
          );
          if (currentSuper.rows[0]?.allowed !== true)
            return reply.code(403).send({ error: 'notification_access_denied' });
          if (
            !v.learnerEnabled ||
            v.disconnect ||
            v.learnerReviewDisclosure !== 'telegram-learner-review-v1'
          )
            return reply.code(400).send({ error: 'invalid_notification_request' });
          return await query(
            principal,
            request.id,
            'SELECT admin.save_telegram_learner_review_preferences($1,$2,$3,$4,$5,$6,$7) data',
            [
              v.version,
              v.adminEnabled,
              v.learnerEnabled,
              v.locale,
              v.disconnect,
              true,
              v.learnerReviewDisclosure
            ]
          );
        }
        // The original signature stays a safe count-only opt-out, including schema58.
        return await query(
          principal,
          request.id,
          'SELECT admin.save_review_notification_preferences($1,$2,$3,$4,$5) data',
          [v.version, v.adminEnabled, v.learnerEnabled, v.locale, v.disconnect]
        );
      } catch (error) {
        const f = failure(error);
        return reply.code(f.status).send({ error: f.error });
      }
    });
};
