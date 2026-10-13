import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { resolveAdminLocale } from './admin-locale.js';
import { adminContentSecurityPolicy } from './admin-branding.js';
import { renderAdminLineInvites } from './admin-line-invite-pages.js';
const reason = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((v) => [...v].every((c) => (c.codePointAt(0) ?? 0) >= 32));
export const registerAdminLineInvites = (
  app: FastifyInstance,
  pool: Pool,
  liffId: string,
  principalFor: (request: FastifyRequest) => Promise<string | null>,
  validCsrf: (request: FastifyRequest) => boolean
) => {
  const query = <Row extends Record<string, unknown>>(
    principal: string,
    requestId: string,
    sql: string,
    values: unknown[] = []
  ) =>
    withRequestContext(pool, 'qigong_api_runtime', { principalId: principal, requestId }, (c) =>
      c.query<Row>(sql, values)
    );
  const canManage = async (principal: string, requestId: string) =>
    (
      await query<{ allowed: boolean }>(
        principal,
        requestId,
        'SELECT admin.is_super_admin() allowed'
      )
    ).rows[0]?.allowed === true;
  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    return message === 'line invite management denied'
      ? { status: 403, code: 'line_invite_management_denied' }
      : message === 'line invite conflict'
        ? { status: 409, code: 'line_invite_conflict' }
        : message.startsWith('invalid line invite')
          ? { status: 400, code: 'invalid_line_invite' }
          : { status: 503, code: 'line_invite_service_unavailable' };
  };
  app.get('/admin/api/line-invites/capabilities', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    return { canManage: await canManage(principal, request.id) };
  });
  app.get('/admin/line-invites', async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    const principal = await principalFor(request);
    if (!principal) return reply.redirect('/admin/auth/login');
    if (!(await canManage(principal, request.id)))
      return reply.code(403).send({ error: 'line_invite_management_denied' });
    return reply
      .header('content-security-policy', adminContentSecurityPolicy)
      .header('x-content-type-options', 'nosniff')
      .type('text/html; charset=utf-8')
      .send(renderAdminLineInvites(resolveAdminLocale(request.query, request.headers.cookie)));
  });
  app.get('/admin/api/line-invites', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    const parsed = z
      .object({ page: z.coerce.number().int().min(1).max(100000).default(1) })
      .strict()
      .safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_line_invite_query' });
    try {
      return z
        .record(z.string(), z.unknown())
        .parse(
          (
            await query<{ data: unknown }>(
              principal,
              request.id,
              'SELECT admin.line_invite_list($1) data',
              [parsed.data.page]
            )
          ).rows[0]?.data
        );
    } catch (error) {
      const f = fail(error);
      return reply.code(f.status).send({ error: f.code });
    }
  });
  app.post('/admin/api/line-invites', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    if (
      request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
      !request.headers['content-type']?.startsWith('application/json') ||
      !validCsrf(request)
    )
      return reply.code(403).send({ error: 'invalid_csrf' });
    const body = z
      .object({
        label: z.string().trim().min(1).max(100),
        region: z
          .enum(['tw-general', 'my-general', 'sg-general', 'hk-general', 'other-general'])
          .default('tw-general'),
        days: z.number().int().min(1).max(30).default(7),
        maxUses: z.number().int().min(1).max(10000).default(100),
        reason
      })
      .strict()
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_line_invite' });
    const token = randomBytes(32).toString('base64url');
    try {
      const v = body.data,
        data = z
          .object({
            id: z.uuid(),
            revision: z.number().int(),
            expiresAt: z.string(),
            maxUses: z.number().int()
          })
          .parse(
            (
              await query<{ data: unknown }>(
                principal,
                request.id,
                'SELECT admin.create_line_invite($1,$2,$3,$4,$5,$6) data',
                [
                  token,
                  v.label,
                  v.region,
                  new Date(Date.now() + v.days * 86400000).toISOString(),
                  v.maxUses,
                  v.reason
                ]
              )
            ).rows[0]?.data
          );
      return reply.code(201).send({
        ...data,
        url: 'https://liff.line.me/' + encodeURIComponent(liffId) + '/invite#' + token
      });
    } catch (error) {
      const f = fail(error);
      return reply.code(f.status).send({ error: f.code });
    }
  });
  app.post('/admin/api/line-invites/:id/revoke', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    if (
      request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
      !request.headers['content-type']?.startsWith('application/json') ||
      !validCsrf(request)
    )
      return reply.code(403).send({ error: 'invalid_csrf' });
    const params = z.object({ id: z.uuid() }).strict().safeParse(request.params),
      body = z
        .object({ version: z.number().int().min(1).max(2147483647), reason })
        .strict()
        .safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_line_invite' });
    try {
      return z
        .record(z.string(), z.unknown())
        .parse(
          (
            await query<{ data: unknown }>(
              principal,
              request.id,
              'SELECT admin.revoke_line_invite($1,$2,$3) data',
              [params.data.id, body.data.version, body.data.reason]
            )
          ).rows[0]?.data
        );
    } catch (error) {
      const f = fail(error);
      return reply.code(f.status).send({ error: f.code });
    }
  });
};
