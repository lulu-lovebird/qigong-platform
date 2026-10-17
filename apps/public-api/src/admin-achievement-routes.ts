import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { adminContentSecurityPolicy } from './admin-branding.js';
import { adminTexts, resolveAdminLocale } from './admin-locale.js';
import { renderAdminShell } from './admin-dashboard.js';
import { renderAdminAchievementsPage } from './admin-achievement-page.js';
import {
  achievementCodeSchema,
  achievementFailure,
  achievementQuerySchema,
  getAchievementCatalog,
  getAchievementRecipients
} from './admin-achievements.js';

export const registerAdminAchievementRoutes = (
  app: FastifyInstance,
  pool: Pool,
  principalFor: (request: FastifyRequest) => Promise<string | null>
) => {
  const capabilities = async (principalId: string, requestId: string) =>
    (
      await withRequestContext(pool, 'qigong_api_runtime', { principalId, requestId }, (client) =>
        client.query<{
          canReadAchievements: boolean;
          canManageAdmins: boolean;
        }>(
          "SELECT admin.has_permission('stats.read') AND admin.has_permission('learner.read') AND admin.has_permission('checkin.read') AS \"canReadAchievements\",admin.can_manage_admin_access() AS \"canManageAdmins\""
        )
      )
    ).rows[0];
  app.get('/admin/api/achievements/capabilities', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    const allowed = await capabilities(principal, request.id);
    return { canReadAchievements: allowed?.canReadAchievements === true };
  });
  app.get('/admin/achievements', async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    const principal = await principalFor(request);
    if (!principal) return reply.redirect('/admin/auth/login');
    const locale = resolveAdminLocale(request.query, request.headers.cookie),
      allowed = await capabilities(principal, request.id);
    const html = allowed?.canReadAchievements
      ? renderAdminAchievementsPage(locale, allowed.canManageAdmins)
      : renderAdminShell(
          'achievements',
          '<p id="status" role="status">' + adminTexts(locale).reportDenied + '</p>',
          '',
          locale,
          allowed?.canManageAdmins === true
        );
    return reply
      .code(allowed?.canReadAchievements ? 200 : 403)
      .header('content-security-policy', adminContentSecurityPolicy)
      .header('x-content-type-options', 'nosniff')
      .type('text/html; charset=utf-8')
      .send(html);
  });
  app.get('/admin/api/achievements', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    const query = achievementQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_achievement_query' });
    try {
      return await withRequestContext(
        pool,
        'qigong_api_runtime',
        { principalId: principal, requestId: request.id },
        (client) =>
          getAchievementCatalog(
            client,
            query.data,
            resolveAdminLocale(request.query, request.headers.cookie)
          )
      );
    } catch (error) {
      const failure = achievementFailure(error);
      return reply.code(failure.status).send({ error: failure.code });
    }
  });
  app.get('/admin/api/achievements/:code/recipients', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    const params = z.object({ code: achievementCodeSchema }).safeParse(request.params),
      query = achievementQuerySchema.safeParse(request.query);
    if (!params.success || !query.success)
      return reply.code(400).send({ error: 'invalid_achievement_query' });
    try {
      return await withRequestContext(
        pool,
        'qigong_api_runtime',
        { principalId: principal, requestId: request.id },
        (client) =>
          getAchievementRecipients(
            client,
            params.data.code,
            query.data,
            resolveAdminLocale(request.query, request.headers.cookie)
          )
      );
    } catch (error) {
      const failure = achievementFailure(error);
      return reply.code(failure.status).send({ error: failure.code });
    }
  });
};
