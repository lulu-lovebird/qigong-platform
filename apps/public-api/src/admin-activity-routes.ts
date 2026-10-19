import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { withRequestContext, type Pool, type PoolClient } from '@qigong/database';
import { z } from 'zod';
import { adminContentSecurityPolicy } from './admin-branding.js';
import { adminTexts, resolveAdminLocale } from './admin-locale.js';
import { renderAdminShell } from './admin-dashboard.js';
import { renderAdminActivityPage } from './admin-activity-page.js';
import {
  achievementDraftInputSchema,
  archiveDraftInputSchema,
  draftRevisionSchema,
  managementQuerySchema,
  getManagementCatalog,
  getManagementDrafts,
  getManagementDraft,
  saveManagementDraft,
  archiveManagementDraft,
  prepareManagementPreview,
  achievementManagementFailure
} from './admin-achievement-management.js';
export const registerAdminActivityRoutes = (
  app: FastifyInstance,
  pool: Pool,
  principalFor: (request: FastifyRequest) => Promise<string | null>,
  validCsrf: (request: FastifyRequest) => boolean,
  sessionFor: (request: FastifyRequest) => string | undefined
) => {
  const headers = (reply: FastifyReply) =>
    reply
      .header('cache-control', 'no-store')
      .header('pragma', 'no-cache')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff');
  const fail = (reply: FastifyReply, error: unknown) => {
    const result = achievementManagementFailure(error);
    if (result.status === 429) reply.header('retry-after', '5');
    return reply.code(result.status).send({ error: result.code });
  };
  const execute = async <T>(
    principal: string,
    request: FastifyRequest,
    callback: (client: PoolClient) => Promise<T>,
    preview = false
  ) =>
    withRequestContext(
      pool,
      'qigong_api_runtime',
      { principalId: principal, requestId: request.id },
      async (client) => {
        await client.query("SET LOCAL statement_timeout='5s'");
        const result = await callback(client);
        const needsPreview =
          preview ||
          (typeof result === 'object' &&
            result !== null &&
            'latestPreview' in result &&
            result.latestPreview !== null);
        const allowed = await client.query<{ allowed: boolean }>(
          'SELECT admin.achievement_management_session_current($1) AND(NOT $2::boolean OR admin.can_preview_achievement_drafts_now()) allowed',
          [sessionFor(request) ?? '', needsPreview]
        );
        if (allowed.rows[0]?.allowed !== true) throw Error('achievement management denied');
        return result;
      }
    );
  const caps = async (principal: string, request: FastifyRequest) =>
    withRequestContext(
      pool,
      'qigong_api_runtime',
      { principalId: principal, requestId: request.id },
      async (client) => {
        const row = (
          await client.query<{ canManage: boolean; canPreview: boolean; canManageAdmins: boolean }>(
            'SELECT admin.can_manage_achievement_drafts_now() "canManage",admin.can_preview_achievement_drafts_now() "canPreview",admin.can_manage_admin_access() "canManageAdmins"'
          )
        ).rows[0];
        if (row?.canManage) {
          const session = (
            await client.query<{ allowed: boolean }>(
              'SELECT admin.achievement_management_session_current($1) allowed',
              [sessionFor(request) ?? '']
            )
          ).rows[0];
          if (session?.allowed !== true) throw Error('achievement management denied');
        }
        return {
          canManage: row?.canManage === true,
          canPreview: row?.canPreview === true,
          canManageAdmins: row?.canManageAdmins === true,
          canPublish: false as const,
          phase: 'draft_preview_only' as const
        };
      }
    );
  const boundary = async (request: FastifyRequest, reply: FastifyReply, write = false) => {
    headers(reply);
    const principal = await principalFor(request);
    if (!principal) {
      void reply.code(401).send({ error: 'unauthenticated' });
      return null;
    }
    if (
      write &&
      (request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
        !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '') ||
        !validCsrf(request))
    ) {
      void reply.code(403).send({ error: 'invalid_csrf' });
      return null;
    }
    return principal;
  };
  const params = z.object({ id: z.uuid() }).strict();
  app.get('/admin/api/achievement-management/capabilities', async (request, reply) => {
    const principal = await boundary(request, reply);
    if (!principal) return reply;
    try {
      const result = await caps(principal, request);
      return {
        canManage: result.canManage,
        canPreview: result.canPreview,
        canPublish: false,
        phase: result.phase
      };
    } catch (error) {
      return fail(reply, error);
    }
  });
  app.get('/admin/achievement-management', async (request, reply) => {
    headers(reply);
    const principal = await principalFor(request);
    if (!principal) return reply.redirect('/admin/auth/login');
    try {
      const locale = resolveAdminLocale(request.query, request.headers.cookie),
        allowed = await caps(principal, request);
      return reply
        .code(allowed.canManage ? 200 : 403)
        .header('content-security-policy', adminContentSecurityPolicy)
        .type('text/html; charset=utf-8')
        .send(
          allowed.canManage
            ? renderAdminActivityPage(locale, allowed.canManageAdmins)
            : renderAdminShell(
                'achievementManagement',
                '<p id="status" role="status">' + adminTexts(locale).reportDenied + '</p>',
                '',
                locale,
                allowed.canManageAdmins
              )
        );
    } catch (error) {
      return fail(reply, error);
    }
  });
  app.get('/admin/api/achievement-management/catalog', async (request, reply) => {
    const principal = await boundary(request, reply);
    if (!principal) return reply;
    const query = managementQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_achievement_configuration' });
    try {
      return await execute(principal, request, (client) =>
        getManagementCatalog(client, resolveAdminLocale(request.query, request.headers.cookie))
      );
    } catch (error) {
      return fail(reply, error);
    }
  });
  app.get('/admin/api/achievement-management/drafts', async (request, reply) => {
    const principal = await boundary(request, reply);
    if (!principal) return reply;
    const query = managementQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_achievement_configuration' });
    try {
      return await execute(principal, request, (client) =>
        getManagementDrafts(client, query.data.page)
      );
    } catch (error) {
      return fail(reply, error);
    }
  });
  app.get('/admin/api/achievement-management/drafts/:id', async (request, reply) => {
    const principal = await boundary(request, reply);
    if (!principal) return reply;
    const p = params.safeParse(request.params),
      q = managementQuerySchema.safeParse(request.query);
    if (!p.success || !q.success)
      return reply.code(400).send({ error: 'invalid_achievement_configuration' });
    try {
      return await execute(principal, request, (client) => getManagementDraft(client, p.data.id));
    } catch (error) {
      return fail(reply, error);
    }
  });
  app.post(
    '/admin/api/achievement-management/drafts',
    { bodyLimit: 32768 },
    async (request, reply) => {
      const principal = await boundary(request, reply, true);
      if (!principal) return reply;
      const body = achievementDraftInputSchema.safeParse(request.body);
      if (!body.success || body.data.expectedRevision !== 0)
        return reply.code(400).send({ error: 'invalid_achievement_configuration' });
      try {
        return await execute(principal, request, (client) =>
          saveManagementDraft(client, null, body.data)
        );
      } catch (error) {
        return fail(reply, error);
      }
    }
  );
  app.patch(
    '/admin/api/achievement-management/drafts/:id',
    { bodyLimit: 32768 },
    async (request, reply) => {
      const principal = await boundary(request, reply, true);
      if (!principal) return reply;
      const p = params.safeParse(request.params),
        body = achievementDraftInputSchema.safeParse(request.body);
      if (!p.success || !body.success || body.data.expectedRevision < 1)
        return reply.code(400).send({ error: 'invalid_achievement_configuration' });
      try {
        return await execute(principal, request, (client) =>
          saveManagementDraft(client, p.data.id, body.data)
        );
      } catch (error) {
        return fail(reply, error);
      }
    }
  );
  app.post(
    '/admin/api/achievement-management/drafts/:id/archive',
    { bodyLimit: 8192 },
    async (request, reply) => {
      const principal = await boundary(request, reply, true);
      if (!principal) return reply;
      const p = params.safeParse(request.params),
        body = archiveDraftInputSchema.safeParse(request.body);
      if (!p.success || !body.success)
        return reply.code(400).send({ error: 'invalid_achievement_configuration' });
      try {
        return await execute(principal, request, (client) =>
          archiveManagementDraft(client, p.data.id, body.data)
        );
      } catch (error) {
        return fail(reply, error);
      }
    }
  );
  app.post(
    '/admin/api/achievement-management/drafts/:id/preview',
    { bodyLimit: 4096 },
    async (request, reply) => {
      const principal = await boundary(request, reply, true);
      if (!principal) return reply;
      const p = params.safeParse(request.params),
        body = draftRevisionSchema.safeParse(request.body);
      if (!p.success || !body.success)
        return reply.code(400).send({ error: 'invalid_achievement_configuration' });
      try {
        return await execute(
          principal,
          request,
          (client) => prepareManagementPreview(client, p.data.id, body.data.expectedRevision),
          true
        );
      } catch (error) {
        return fail(reply, error);
      }
    }
  );
};
