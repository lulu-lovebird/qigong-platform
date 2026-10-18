import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import {
  achievementExportFailure,
  achievementExportInput,
  exportFiltersSchema,
  getAchievementExportPreview,
  prepareAchievementCsv
} from './admin-achievement-export.js';
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
  principalFor: (request: FastifyRequest) => Promise<string | null>,
  validCsrf: (request: FastifyRequest) => boolean = () => false,
  sessionFor: (request: FastifyRequest) => string | undefined = () => undefined
) => {
  const capabilities = async (principalId: string, requestId: string) =>
    (
      await withRequestContext(pool, 'qigong_api_runtime', { principalId, requestId }, (client) =>
        client.query<{
          canReadAchievements: boolean;
          canExportAchievements: boolean;
          canManageAdmins: boolean;
        }>(
          'SELECT admin.has_permission(\'stats.read\') AND admin.has_permission(\'learner.read\') AND admin.has_permission(\'checkin.read\') AS "canReadAchievements",admin.can_export_achievement_personal_now() AS "canExportAchievements",admin.can_manage_admin_access() AS "canManageAdmins"'
        )
      )
    ).rows[0];
  app.get('/admin/api/achievements/capabilities', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    const allowed = await capabilities(principal, request.id);
    return {
      canReadAchievements: allowed?.canReadAchievements === true,
      canExportAchievements: allowed?.canExportAchievements === true
    };
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
  const exportBoundary = async (request: FastifyRequest, reply: FastifyReply) => {
    reply
      .header('cache-control', 'no-store')
      .header('pragma', 'no-cache')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff');
    const principal = await principalFor(request);
    if (!principal) {
      void reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    if (
      request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
      !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '') ||
      !validCsrf(request)
    ) {
      void reply.code(403).send({ error: 'invalid_csrf' });
      return null;
    }
    const params = z.object({ code: achievementCodeSchema }).safeParse(request.params),
      token = sessionFor(request);
    if (!params.success) {
      void reply.code(400).send({ error: 'invalid_achievement_export' });
      return null;
    }
    if (!token) {
      void reply.code(403).send({ error: 'achievement_export_denied' });
      return null;
    }
    return { principal, token, code: params.data.code };
  };
  app.post(
    '/admin/api/achievements/:code/export/preview',
    { bodyLimit: 8192 },
    async (request, reply) => {
      const boundary = await exportBoundary(request, reply);
      if (!boundary) return reply;
      const parsed = exportFiltersSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_achievement_export' });
      try {
        return await withRequestContext(
          pool,
          'qigong_api_runtime',
          { principalId: boundary.principal, requestId: request.id },
          async (client) => {
            const result = await getAchievementExportPreview(
              client,
              boundary.code,
              parsed.data,
              resolveAdminLocale(request.body, request.headers.cookie)
            );
            const allowed = await client.query<{ allowed: boolean }>(
              'SELECT admin.achievement_export_session_current($1) allowed',
              [boundary.token]
            );
            if (allowed.rows[0]?.allowed !== true) throw Error('achievement export denied');
            return result;
          }
        );
      } catch (error) {
        const failure = achievementExportFailure(error);
        return reply.code(failure.status).send({ error: failure.code });
      }
    }
  );
  app.post('/admin/api/achievements/:code/export', { bodyLimit: 8192 }, async (request, reply) => {
    const boundary = await exportBoundary(request, reply);
    if (!boundary) return reply;
    const parsed = achievementExportInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_achievement_export' });
    try {
      const file = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { principalId: boundary.principal, requestId: request.id },
        (client) =>
          prepareAchievementCsv(
            client,
            boundary.code,
            parsed.data,
            resolveAdminLocale(request.body, request.headers.cookie),
            parsed.data.purpose,
            boundary.token
          )
      );
      return reply
        .header('content-disposition', file.disposition)
        .type('text/csv; charset=utf-8')
        .send(file.body);
    } catch (error) {
      const failure = achievementExportFailure(error);
      if (failure.status === 429) reply.header('retry-after', '30');
      return reply.code(failure.status).send({ error: failure.code });
    }
  });
};
