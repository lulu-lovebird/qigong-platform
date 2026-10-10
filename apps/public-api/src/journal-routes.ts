import type { FastifyInstance } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { learnerLocale } from './learner-locale.js';
import { renderLearnerJournalPage } from './learner-journal-pages.js';
import { isLearnerPrivacyError } from './learner-privacy-routes.js';
const query = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    lang: z.enum(['zh_TW', 'en']).default('zh_TW')
  })
  .strict();
const credential = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    locale: z.enum(['zh_TW', 'en']).default('zh_TW')
  })
  .strict();
const list = credential.extend({ page: z.number().int().min(1).max(100000).default(1) });
export const journalPublishInput = credential
  .extend({
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    checkinId: z.uuid(),
    version: z.number().int().min(0).max(2_147_483_647),
    active: z.boolean(),
    shareNote: z.boolean(),
    shareFeelings: z.boolean(),
    externalEnabled: z.boolean(),
    alias: z
      .string()
      .trim()
      .refine(
        (v) =>
          [...v].length >= 1 &&
          [...v].length <= 40 &&
          [...v].every((c) => c.codePointAt(0)! >= 32 && c.codePointAt(0)! !== 127)
      )
  })
  .strict();
const object = z.record(z.string(), z.unknown());
const execute = async (pool: Pool, requestId: string, sql: string, values: unknown[]) =>
  object.parse(
    (
      await withRequestContext(pool, 'qigong_api_runtime', { requestId }, (c) =>
        c.query<{ data: unknown }>(sql, values)
      )
    ).rows[0]?.data
  );
const failure = (error: unknown) => {
  if (isLearnerPrivacyError(error))
    return {
      status: 403,
      code:
        error instanceof Error && error.message === 'reflection consent required'
          ? 'reflection_consent_required'
          : 'privacy_acceptance_required'
    };
  const message = error instanceof Error ? error.message : '';
  if (
    message === 'practice identity unavailable' ||
    /^(checkin link expired|checkin identity not approved)/.test(message)
  )
    return { status: 403, code: 'journal_access_unavailable' };
  if (message === 'journal unavailable') return { status: 404, code: 'journal_unavailable' };
  if (message === 'journal version conflict' || message === 'journal source conflict')
    return { status: 409, code: 'journal_conflict' };
  if (
    ['invalid journal publication', 'empty journal publication', 'invalid journal query'].includes(
      message
    )
  )
    return { status: 400, code: 'invalid_journal_request' };
  return { status: 503, code: 'journal_unavailable' };
};
export const registerLearnerJournalRoutes = (app: FastifyInstance, pool: Pool) => {
  app.get('/telegram/journal', async (request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .header(
        'content-security-policy',
        "default-src 'none'; script-src 'unsafe-inline' https://telegram.org; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org"
      )
      .type('text/html; charset=utf-8')
      .send(
        renderLearnerJournalPage(
          learnerLocale(
            z.object({ lang: z.string().optional() }).safeParse(request.query).data?.lang
          )
        )
      )
  );
  for (const view of ['feed', 'own'] as const)
    app.post('/telegram/journal/' + view, { bodyLimit: 4096 }, async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (
        request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
        !request.headers['content-type']?.startsWith('application/json')
      )
        return reply.code(403).send({ error: 'invalid_origin' });
      const parsed = list.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_journal_request' });
      try {
        return await execute(
          pool,
          request.id,
          view === 'feed'
            ? `SELECT platform.journal_feed($1,$2,$3) || CASE WHEN (platform.privacy_notice()->>'active')::boolean THEN jsonb_build_object('privacy',platform.privacy_usage('telegram',$1)) ELSE '{}'::jsonb END data`
            : `SELECT platform.journal_own($1,$3,$2) || CASE WHEN (platform.privacy_notice()->>'active')::boolean THEN jsonb_build_object('privacy',platform.privacy_usage('telegram',$1)) ELSE '{}'::jsonb END data`,
          [parsed.data.token, parsed.data.locale, parsed.data.page]
        );
      } catch (e) {
        const result = failure(e);
        return reply.code(result.status).send({ error: result.code });
      }
    });
  app.post('/telegram/journal/publish', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (
      request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
      !request.headers['content-type']?.startsWith('application/json')
    )
      return reply.code(403).send({ error: 'invalid_origin' });
    const parsed = journalPublishInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_journal_publication' });
    const value = parsed.data;
    try {
      return await execute(
        pool,
        request.id,
        'SELECT platform.journal_publish($1,$2,$3,$4,$5,$6,$7,$8,$9) data',
        [
          value.token,
          value.checkinId,
          value.version,
          value.active,
          value.shareNote,
          value.shareFeelings,
          value.externalEnabled,
          value.alias,
          value.sourceHash
        ]
      );
    } catch (e) {
      const result = failure(e);
      return reply.code(result.status).send({ error: result.code });
    }
  });
};
export const registerExternalJournalRoutes = (app: FastifyInstance, pool: Pool) => {
  // A partner backend must authenticate its own end users. Never enable browser CORS for service credentials.
  app.get('/api/v1/shared-journal', async (request, reply) => {
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff');
    if (request.headers.origin !== undefined)
      return reply.code(403).send({ error: 'server_integration_required' });
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? '')?.[1];
    if (!token) return reply.code(401).send({ error: 'integration_unauthorized' });
    const parsed = query.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_journal_query' });
    try {
      return await execute(
        pool,
        request.id,
        'SELECT platform.external_journal_feed($1,$2,$3) data',
        [token, parsed.data.lang, parsed.data.page]
      );
    } catch (e) {
      if (e instanceof Error && e.message === 'journal client unauthorized')
        return reply.code(401).send({ error: 'integration_unauthorized' });
      if (e instanceof Error && e.message === 'journal rate limited')
        return reply
          .header('retry-after', '60')
          .code(429)
          .send({ error: 'integration_rate_limited' });
      return reply.code(503).send({ error: 'journal_unavailable' });
    }
  });
};
