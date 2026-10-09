import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { resolveAdminLocale } from './admin-locale.js';
import { renderAccessPendingPage, renderAdminAccessPage } from './admin-access-pages.js';
export const accessCookie = '__Host-qigong-admin-access';
const text = z
  .string()
  .trim()
  .min(1)
  .refine((v) => [...v].length <= 500 && !v.includes('\0'));
const version = z.number().int().min(1).max(2147483647);
const role = z.enum([
  'regional_admin',
  'regional_viewer',
  'global_viewer',
  'coach_admin',
  'master_admin'
]);
const fields = { role, regionId: z.uuid().optional(), cohortId: z.uuid().optional(), reason: text };
const validScope = (v: {
  role: string;
  regionId?: string | undefined;
  cohortId?: string | undefined;
}) =>
  ['regional_admin', 'regional_viewer'].includes(v.role)
    ? v.regionId !== undefined && v.cohortId === undefined
    : v.cohortId === undefined && v.regionId === undefined;
export const grantSchema = z.object(fields).strict().refine(validScope);
export const grantEditSchema = z
  .object({ version, ...fields })
  .strict()
  .refine(validScope);
export const grantRemovalSchema = z.object({ version, reason: text }).strict();
export const accessRequestSchema = z
  .object({ version, role, scopeDescription: text, reason: text })
  .strict();
export const accessDecisionSchema = z.discriminatedUnion('decision', [
  z
    .object({ version, decision: z.literal('approved'), ...fields })
    .strict()
    .refine(validScope),
  z.object({ version, decision: z.literal('rejected'), reason: text }).strict()
]);
const pendingToken = (r: FastifyRequest) => {
  const value = (r.headers.cookie ?? '')
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(accessCookie + '='))
    ?.slice(accessCookie.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
};
export const registerAdminAccessRoutes = (
  app: FastifyInstance,
  pool: Pool,
  principalFor: (r: FastifyRequest) => Promise<string | null>,
  validCsrf: (r: FastifyRequest) => boolean
) => {
  const noStore = (_request: FastifyRequest, reply: FastifyReply, done: () => void) => {
    void reply.header('cache-control', 'no-store');
    done();
  };
  const opts = { onRequest: noStore };
  const failure = (
    error: unknown,
    reply: FastifyReply,
    request: FastifyRequest,
    pending = false
  ) => {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
    if (code === '42501') return reply.code(pending ? 401 : 403).send({ error: 'access_denied' });
    if (
      code === '40001' ||
      (error instanceof Error && error.message === 'last super admin protected')
    )
      return reply.code(409).send({ error: 'access_conflict' });
    if (error instanceof Error && error.message === 'principal unavailable')
      return reply.code(404).send({ error: 'account_unavailable' });
    if (error instanceof Error && error.message === 'access approval required')
      return reply.code(409).send({ error: 'approval_required' });
    if (error instanceof Error && /^invalid (access|admin)/.test(error.message))
      return reply.code(400).send({ error: 'invalid_access_operation' });
    app.log.warn({ requestId: request.id }, 'administrator access operation failed');
    return reply.code(503).send({ error: 'access_unavailable' });
  };
  const html = (reply: FastifyReply, body: string) =>
    reply
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header(
        'content-security-policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      )
      .type('text/html; charset=utf-8')
      .send(body);
  app.get('/admin/access', opts, async (request, reply) => {
    const token = pendingToken(request);
    if (!token) return reply.redirect('/admin/auth/login');
    try {
      await withRequestContext(pool, 'qigong_api_runtime', { requestId: request.id }, (c) =>
        c.query('SELECT admin.access_status($1)', [token])
      );
    } catch (error) {
      return failure(error, reply, request, true);
    }
    return html(
      reply,
      renderAccessPendingPage(resolveAdminLocale(request.query, request.headers.cookie))
    );
  });
  app.get('/admin/access/status', opts, async (request, reply) => {
    const token = pendingToken(request);
    if (!token) return reply.code(401).send({ error: 'unauthenticated' });
    try {
      const result = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id },
        (c) => c.query<{ data: unknown }>('SELECT admin.access_status($1) data', [token])
      );
      return result.rows[0]?.data;
    } catch (error) {
      return failure(error, reply, request, true);
    }
  });
  app.post('/admin/access/request', { ...opts, bodyLimit: 16384 }, async (request, reply) => {
    const token = pendingToken(request);
    if (!token) return reply.code(401).send({ error: 'unauthenticated' });
    if (!validCsrf(request)) return reply.code(403).send({ error: 'invalid_csrf' });
    const parsed = accessRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_access_request' });
    try {
      const p = parsed.data;
      const result = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id },
        (c) =>
          c.query<{ data: unknown }>(
            'SELECT admin.submit_access_application($1,$2,$3,$4,$5) data',
            [token, p.version, p.role, p.scopeDescription, p.reason]
          )
      );
      return result.rows[0]?.data;
    } catch (error) {
      return failure(error, reply, request, true);
    }
  });
  app.get('/admin/administrators', opts, async (request, reply) => {
    const principalId = await principalFor(request);
    if (!principalId) return reply.redirect('/admin/auth/login');
    const result = await withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId: request.id, principalId },
      (c) => c.query<{ allowed: boolean }>('SELECT admin.can_manage_admin_access() allowed')
    );
    if (!result.rows[0]?.allowed) return reply.code(403).send({ error: 'access_denied' });
    return html(
      reply,
      renderAdminAccessPage(resolveAdminLocale(request.query, request.headers.cookie))
    );
  });
  app.get('/admin/api/access/accounts', opts, async (request, reply) => {
    const principalId = await principalFor(request);
    if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
    const parsed = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        status: z
          .enum(['authorized', 'all', 'draft', 'pending', 'approved', 'rejected', 'provisioned'])
          .default('pending')
      })
      .strict()
      .safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_access_query' });
    try {
      const result = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id, principalId },
        (c) =>
          c.query<{ data: unknown }>('SELECT admin.access_admin_list($1,$2) data', [
            parsed.data.page,
            parsed.data.status
          ])
      );
      return result.rows[0]?.data;
    } catch (error) {
      return failure(error, reply, request);
    }
  });
  for (const action of ['decision', 'grants', 'revoke', 'edit', 'revoke-all'] as const) {
    const path =
      action === 'revoke' || action === 'edit'
        ? '/admin/api/access/grants/:id/' + action
        : '/admin/api/access/accounts/:id/' + action;
    app.post(path, { ...opts, bodyLimit: 16384 }, async (request, reply) => {
      const principalId = await principalFor(request);
      if (!principalId) return reply.code(401).send({ error: 'unauthenticated' });
      if (!validCsrf(request)) return reply.code(403).send({ error: 'invalid_csrf' });
      const id = z.object({ id: z.uuid() }).safeParse(request.params);
      if (!id.success) return reply.code(400).send({ error: 'invalid_account' });
      try {
        if (action === 'decision') {
          const parsed = accessDecisionSchema.safeParse(request.body);
          if (!parsed.success) return reply.code(400).send({ error: 'invalid_access_decision' });
          const d = parsed.data;
          const result = await withRequestContext(
            pool,
            'qigong_api_runtime',
            { requestId: request.id, principalId },
            (c) =>
              c.query<{ grant_id: string | null }>(
                'SELECT admin.decide_access_application($1,$2,$3,$4,$5,$6,$7) grant_id',
                [
                  id.data.id,
                  d.version,
                  d.decision,
                  d.decision === 'approved' ? d.role : null,
                  d.decision === 'approved' ? (d.regionId ?? null) : null,
                  d.decision === 'approved' ? (d.cohortId ?? null) : null,
                  d.reason
                ]
              )
          );
          return { ok: true, grantId: result.rows[0]?.grant_id ?? null };
        }
        if (action === 'grants') {
          const parsed = grantSchema.safeParse(request.body);
          if (!parsed.success) return reply.code(400).send({ error: 'invalid_admin_grant' });
          const d = parsed.data;
          const result = await withRequestContext(
            pool,
            'qigong_api_runtime',
            { requestId: request.id, principalId },
            (c) =>
              c.query<{ grant_id: string }>(
                'SELECT admin.add_managed_role($1,$2,$3,$4,$5) grant_id',
                [id.data.id, d.role, d.regionId ?? null, d.cohortId ?? null, d.reason]
              )
          );
          return { ok: true, grantId: result.rows[0]?.grant_id };
        }
        if (action === 'edit') {
          const parsed = grantEditSchema.safeParse(request.body);
          if (!parsed.success) return reply.code(400).send({ error: 'invalid_admin_edit' });
          const d = parsed.data;
          const result = await withRequestContext(
            pool,
            'qigong_api_runtime',
            { requestId: request.id, principalId },
            (c) =>
              c.query<{ grant_id: string }>(
                'SELECT admin.edit_managed_role($1,$2,$3,$4,$5,$6) grant_id',
                [id.data.id, d.version, d.role, d.regionId ?? null, d.cohortId ?? null, d.reason]
              )
          );
          return { ok: true, grantId: result.rows[0]?.grant_id };
        }
        const parsed = grantRemovalSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_admin_revocation' });
        if (action === 'revoke-all') {
          const result = await withRequestContext(
            pool,
            'qigong_api_runtime',
            { requestId: request.id, principalId },
            (c) =>
              c.query<{ n: number }>('SELECT admin.revoke_all_managed_roles($1,$2,$3) n', [
                id.data.id,
                parsed.data.version,
                parsed.data.reason
              ])
          );
          return { ok: true, revokedCount: result.rows[0]?.n };
        }
        await withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: request.id, principalId },
          (c) =>
            c.query('SELECT admin.revoke_managed_role_versioned($1,$2,$3)', [
              id.data.id,
              parsed.data.version,
              parsed.data.reason
            ])
        );
        return { ok: true };
      } catch (error) {
        return failure(error, reply, request);
      }
    });
  }
};
