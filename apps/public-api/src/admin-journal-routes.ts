import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { journalQuerySchema, queryPracticeJournal } from './admin-journal.js';
import { renderAdminJournalPage } from './admin-journal-pages.js';
import { resolveAdminLocale } from './admin-locale.js';

const label = (max: number) =>
  z
    .string()
    .trim()
    .refine((v) => [...v].length >= 1 && [...v].length <= max && !v.includes('\0'));
export const feelingTagsInput = z
  .object({
    version: z.number().int().min(1).max(2_147_483_647),
    tags: z
      .array(
        z
          .object({
            id: z.uuid().optional(),
            name_zh_tw: label(40),
            name_en: label(80),
            active: z.boolean()
          })
          .strict()
      )
      .max(30)
  })
  .strict();
const reason = label(500);
const clientInput = z
  .object({ label: label(80), expiresAt: z.iso.datetime({ offset: true }), reason })
  .strict();
const object = z.record(z.string(), z.unknown());
const journalFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'learner unavailable' || message === 'journal client unavailable')
    return { status: 404, code: 'journal_unavailable' };
  if (message === 'tag version conflict') return { status: 409, code: 'tag_version_conflict' };
  if (
    ['journal access denied', 'tag management denied', 'journal client management denied'].includes(
      message
    )
  )
    return { status: 403, code: 'journal_denied' };
  if (['invalid journal query', 'invalid feeling tags', 'invalid journal client'].includes(message))
    return { status: 400, code: 'invalid_journal_request' };
  return { status: 503, code: 'journal_unavailable' };
};
export const registerAdminJournalRoutes = (
  app: FastifyInstance,
  pool: Pool,
  principalFor: (request: FastifyRequest) => Promise<string | null>,
  validCsrf: (request: FastifyRequest) => boolean
) => {
  const query = <Row extends Record<string, unknown>>(
    principalId: string,
    requestId: string,
    sql: string,
    values: unknown[] = []
  ) =>
    withRequestContext(pool, 'qigong_api_runtime', { principalId, requestId }, (c) =>
      c.query<Row>(sql, values)
    );
  const capabilities = async (principalId: string, requestId: string) =>
    (
      await query<{
        canReadJournal: boolean;
        canManageTags: boolean;
        canManageAdmins: boolean;
        canManageLearners: boolean;
        canReadShared: boolean;
        canPublishPrivacy: boolean;
      }>(
        principalId,
        requestId,
        `SELECT admin.has_permission('learner.read') AND admin.has_permission('checkin.read_private_note') AS "canReadJournal",admin.has_permission('taxonomy.manage') AS "canManageTags",admin.can_manage_admin_access() AS "canManageAdmins",admin.has_permission('learner.manage_profile') AS "canManageLearners",admin.has_permission('journal.read_shared') AS "canReadShared",admin.is_super_admin() AS "canPublishPrivacy"`
      )
    ).rows[0]!;
  app.get('/admin/api/journal/capabilities', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    return capabilities(principal, request.id);
  });
  for (const [path, kind] of [
    ['/admin/journal', 'journal'],
    ['/admin/practice-feeling-tags', 'tags']
  ] as const)
    app.get(path, async (request, reply) => {
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
      const principal = await principalFor(request);
      if (!principal) return reply.redirect('/admin/auth/login');
      const allowed = await capabilities(principal, request.id);
      if (!(kind === 'journal' ? allowed.canReadJournal : allowed.canManageTags))
        return reply.code(403).send({ error: 'journal_denied' });
      return reply
        .header(
          'content-security-policy',
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        )
        .header('x-content-type-options', 'nosniff')
        .type('text/html; charset=utf-8')
        .send(
          renderAdminJournalPage(
            kind,
            resolveAdminLocale(request.query, request.headers.cookie),
            allowed.canManageAdmins
          )
        );
    });
  app.get('/admin/api/journal', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    const parsed = journalQuerySchema.strict().safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_journal_query' });
    try {
      return await withRequestContext(
        pool,
        'qigong_api_runtime',
        { principalId: principal, requestId: request.id },
        (c) =>
          queryPracticeJournal(c, {
            ...parsed.data,
            lang: resolveAdminLocale(request.query, request.headers.cookie)
          })
      );
    } catch (e) {
      const failure = journalFailure(e);
      return reply.code(failure.status).send({ error: failure.code });
    }
  });
  app.get('/admin/api/practice-feeling-tags', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    try {
      return object.parse(
        (
          await query<{ data: unknown }>(
            principal,
            request.id,
            'SELECT admin.feeling_tag_catalog() data'
          )
        ).rows[0]?.data
      );
    } catch (e) {
      const failure = journalFailure(e);
      return reply.code(failure.status).send({ error: failure.code });
    }
  });
  app.put('/admin/api/practice-feeling-tags', { bodyLimit: 32768 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    if (!validCsrf(request)) return reply.code(403).send({ error: 'invalid_csrf' });
    const parsed = feelingTagsInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_feeling_tags' });
    try {
      return object.parse(
        (
          await query<{ data: unknown }>(
            principal,
            request.id,
            'SELECT admin.save_feeling_tags($1,$2::jsonb) data',
            [parsed.data.version, JSON.stringify(parsed.data.tags)]
          )
        ).rows[0]?.data
      );
    } catch (e) {
      const failure = journalFailure(e);
      return reply.code(failure.status).send({ error: failure.code });
    }
  });
  // Operational endpoints only. No credentials are created automatically or returned by lists.
  app.post('/admin/api/journal/clients', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    if (!validCsrf(request)) return reply.code(403).send({ error: 'invalid_csrf' });
    const parsed = clientInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_journal_client' });
    const credential = randomBytes(32).toString('base64url');
    try {
      const result = await query<{ id: string }>(
        principal,
        request.id,
        'SELECT admin.issue_journal_client($1,$2,$3,$4) id',
        [credential, parsed.data.label, parsed.data.expiresAt, parsed.data.reason]
      );
      return {
        id: result.rows[0]!.id,
        token: credential,
        expiresAt: parsed.data.expiresAt,
        scope: 'shared_journal.read'
      };
    } catch (e) {
      const failure = journalFailure(e);
      return reply.code(failure.status).send({ error: failure.code });
    }
  });
  app.post('/admin/api/journal/clients/:id/revoke', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const principal = await principalFor(request);
    if (!principal) return reply.code(401).send({ error: 'unauthenticated' });
    if (!validCsrf(request)) return reply.code(403).send({ error: 'invalid_csrf' });
    const params = z.object({ id: z.uuid() }).safeParse(request.params),
      body = z.object({ reason }).strict().safeParse(request.body);
    if (!params.success || !body.success)
      return reply.code(400).send({ error: 'invalid_journal_client' });
    try {
      await query(principal, request.id, 'SELECT admin.revoke_journal_client($1,$2)', [
        params.data.id,
        body.data.reason
      ]);
      return { revoked: true };
    } catch (e) {
      const failure = journalFailure(e);
      return reply.code(failure.status).send({ error: failure.code });
    }
  });
};
