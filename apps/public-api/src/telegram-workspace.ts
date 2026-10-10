import type { FastifyInstance } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { learnerLocale } from './learner-locale.js';
import { practiceNoteSchema } from './practice-notes.js';
import { isLearnerPrivacyError } from './learner-privacy-routes.js';
import {
  renderTelegramWorkspacePage,
  telegramWorkspacePaths,
  type TelegramWorkspacePage
} from './telegram-workspace-pages.js';

const credential = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    locale: z.enum(['zh_TW', 'en']).default('zh_TW')
  })
  .strict();
const reportInput = credential.extend({
  view: z.enum(['leaderboard', 'methods', 'achievements', 'history']),
  period: z.enum(['week', 'month', 'quarter', 'year', 'all']).default('month'),
  days: z.union([z.literal(30), z.literal(90)]).default(30),
  month: z
    .string()
    .regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/)
    .optional()
});
export const telegramPracticeSaveSchema = credential.extend(practiceNoteSchema.shape).extend({
  requestId: z.uuid(),
  date: z.iso.date(),
  version: z.number().int().min(0).max(2_147_483_647),
  methods: z
    .array(z.string().regex(/^[a-z0-9_]{1,64}$/))
    .min(1)
    .max(30)
    .refine((codes) => new Set(codes).size === codes.length)
});
const timezoneInput = credential.extend({ timezone: z.string().min(1).max(100) });
const originAllowed = (origin: unknown, type: unknown) =>
  origin === 'https://checkin.baiyinqigong.org' &&
  typeof type === 'string' &&
  type.startsWith('application/json');
const responseObject = z.record(z.string(), z.unknown());

export const registerTelegramWorkspace = (app: FastifyInstance, pool: Pool) => {
  for (const page of Object.keys(telegramWorkspacePaths) as TelegramWorkspacePage[]) {
    app.get(telegramWorkspacePaths[page], async (request, reply) => {
      const query = z.object({ lang: z.string().optional() }).safeParse(request.query);
      return reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header(
          'content-security-policy',
          "default-src 'none'; script-src 'unsafe-inline' https://telegram.org; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org"
        )
        .header('x-content-type-options', 'nosniff')
        .type('text/html; charset=utf-8')
        .send(
          renderTelegramWorkspacePage(
            page,
            learnerLocale(query.success ? query.data.lang : undefined)
          )
        );
    });
  }
  const execute = async (requestId: string, sql: string, values: unknown[]) => {
    const result = await withRequestContext(pool, 'qigong_api_runtime', { requestId }, (client) =>
      client.query<{ data: unknown }>(sql, values)
    );
    return responseObject.parse(result.rows[0]?.data);
  };
  const failure = (error: unknown): { status: 403 | 409 | 503; code: string } => {
    if (isLearnerPrivacyError(error))
      return {
        status: 403,
        code:
          error instanceof Error && error.message === 'reflection consent required'
            ? 'reflection_consent_required'
            : 'privacy_acceptance_required'
      };
    if (error instanceof Error) {
      if (
        /^(practice identity unavailable|checkin link expired or identity unavailable|checkin identity not approved or active)$/.test(
          error.message
        )
      )
        return { status: 403, code: 'workspace_access_unavailable' };
      if (
        /^(workspace (version conflict|request conflict|timezone unconfirmed|timezone cooldown|timezone window differs|region unavailable)|invalid workspace timezone|checkin correction unavailable|makeup deadline passed|practice date has no region assignment|invalid or duplicate practice method|invalid practice note|invalid feeling tags)$/.test(
          error.message
        ) ||
        ('code' in error && (error.code === '40001' || error.code === '23505'))
      )
        return { status: 409, code: 'workspace_conflict' };
    }
    return { status: 503, code: 'workspace_unavailable' };
  };
  app.post('/telegram/workspace/profile', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!originAllowed(request.headers.origin, request.headers['content-type']))
      return reply.code(403).send({ error: 'invalid_origin' });
    const input = credential.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_workspace_request' });
    try {
      return await execute(
        request.id,
        `SELECT platform.telegram_workspace_report($1,$2,$3) || CASE WHEN (platform.privacy_notice()->>'active')::boolean THEN jsonb_build_object('privacy',platform.privacy_usage('telegram',$1)) ELSE '{}'::jsonb END data`,
        [input.data.token, 'profile', input.data.locale]
      );
    } catch (error) {
      const outcome = failure(error);
      if (outcome.status === 503)
        app.log.error({ requestId: request.id }, 'Telegram workspace profile failed');
      return reply.code(outcome.status).send({ error: outcome.code });
    }
  });
  app.post('/telegram/workspace/report', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!originAllowed(request.headers.origin, request.headers['content-type']))
      return reply.code(403).send({ error: 'invalid_origin' });
    const input = reportInput.safeParse(request.body);
    if (!input.success || (input.data.view === 'history' && !input.data.month))
      return reply.code(400).send({ error: 'invalid_workspace_request' });
    try {
      const value = input.data;
      return await execute(
        request.id,
        'SELECT platform.telegram_workspace_report($1,$2,$3,$4,$5,$6) data',
        [
          value.token,
          value.view,
          value.locale,
          value.period,
          value.days,
          value.month ? value.month + '-01' : null
        ]
      );
    } catch (error) {
      const outcome = failure(error);
      if (error instanceof Error && error.message === 'invalid workspace query')
        return reply.code(400).send({ error: 'invalid_workspace_request' });
      if (outcome.status === 503)
        app.log.error({ requestId: request.id }, 'Telegram workspace report failed');
      return reply.code(outcome.status).send({ error: outcome.code });
    }
  });
  app.post('/telegram/preferences/timezone', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!originAllowed(request.headers.origin, request.headers['content-type']))
      return reply.code(403).send({ error: 'invalid_origin' });
    const input = timezoneInput.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_workspace_timezone' });
    try {
      await withRequestContext(pool, 'qigong_api_runtime', { requestId: request.id }, (client) =>
        client.query('SELECT platform.telegram_workspace_timezone($1,$2)', [
          input.data.token,
          input.data.timezone
        ])
      );
      return { ok: true };
    } catch (error) {
      const outcome = failure(error);
      if (outcome.status === 503)
        app.log.error({ requestId: request.id }, 'Telegram workspace timezone failed');
      return reply.code(outcome.status).send({ error: outcome.code });
    }
  });
  app.post('/telegram/workspace/save', { bodyLimit: 16384 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!originAllowed(request.headers.origin, request.headers['content-type']))
      return reply.code(403).send({ error: 'invalid_origin' });
    const input = telegramPracticeSaveSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ error: 'invalid_workspace_save' });
    try {
      const value = input.data;
      return await execute(
        request.id,
        'SELECT platform.telegram_workspace_save($1,$2,$3,$4,$5,$6,$7::uuid[]) data',
        [
          value.token,
          value.requestId,
          value.date,
          value.version,
          value.methods,
          value.practiceNote ?? null,
          value.feelingTagIds ?? null
        ]
      );
    } catch (error) {
      const outcome = failure(error);
      if (outcome.status === 503)
        app.log.error({ requestId: request.id }, 'Telegram workspace save failed');
      return reply.code(outcome.status).send({ error: outcome.code });
    }
  });
};
