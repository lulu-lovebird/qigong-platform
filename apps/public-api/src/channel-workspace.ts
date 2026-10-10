import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { practiceNoteSchema } from './practice-notes.js';
import { journalPublishInput } from './journal-routes.js';
import { isLearnerPrivacyError } from './learner-privacy-routes.js';
import {
  renderChannelWorkspacePage,
  channelWorkspacePaths,
  type WorkspaceChannel
} from './channel-workspace-pages.js';
export const registerChannelWorkspace = (
  app: FastifyInstance,
  pool: Pool,
  channel: WorkspaceChannel,
  resolveCredential: (r: FastifyRequest) => string | null | Promise<string | null>,
  includeCheckin = true
) => {
  const provider = channel.platform,
    locale =
      provider === 'line'
        ? z.literal('zh_TW').default('zh_TW')
        : z.enum(['zh_TW', 'en']).default('zh_TW');
  const credential =
    provider === 'line'
      ? z.object({ idToken: z.string().min(1).max(4096), locale }).strict()
      : z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), locale }).strict();
  const reportInput = credential
    .extend({
      view: z.enum(['leaderboard', 'methods', 'achievements', 'history']),
      period: z.enum(['week', 'month', 'quarter', 'year', 'all']).default('month'),
      days: z.union([z.literal(30), z.literal(90)]).default(30),
      month: z
        .string()
        .regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/)
        .optional()
    })
    .strict();
  const saveInput = credential
    .extend(practiceNoteSchema.shape)
    .extend({
      requestId: z.uuid(),
      date: z.iso.date(),
      version: z.number().int().min(0).max(2147483647),
      methods: z
        .array(z.string().regex(/^[a-z0-9_]{1,64}$/))
        .min(1)
        .max(30)
        .refine((v) => new Set(v).size === v.length)
    })
    .strict();
  const publishInput = journalPublishInput
    .omit({ token: true, locale: true })
    .extend(credential.shape)
    .strict();
  const execute = async (requestId: string, sql: string, values: unknown[]) =>
    z
      .record(z.string(), z.unknown())
      .parse(
        (
          await withRequestContext(pool, 'qigong_api_runtime', { requestId }, (c) =>
            c.query<{ data: unknown }>(sql, values)
          )
        ).rows[0]?.data
      );
  const fail = (e: unknown) => {
    const msg = e instanceof Error ? e.message : '';
    if (
      isLearnerPrivacyError(e) ||
      /^(practice identity unavailable|LINE checkin identity unavailable|WhatsApp checkin identity unavailable|invalid WhatsApp link)$/.test(
        msg
      )
    )
      return { status: 403, error: 'workspace_access_unavailable' };
    if (
      (e instanceof Error && 'code' in e && e.code === '40001') ||
      /^(workspace |journal .*conflict|checkin correction unavailable|makeup deadline passed|invalid or duplicate practice method|invalid practice note|invalid feeling tags)/.test(
        msg
      )
    )
      return { status: 409, error: 'workspace_conflict' };
    if (msg.startsWith('invalid ') || msg === 'empty journal publication')
      return { status: 400, error: 'invalid_workspace_request' };
    return { status: 503, error: 'workspace_unavailable' };
  };
  for (const page of ['checkin', 'leaderboard', 'methods', 'achievements', 'journal'] as const) {
    if (page === 'checkin' && !includeCheckin) continue;
    app.get('/' + provider + channelWorkspacePaths[page], async (request, reply) => {
      const q = z.object({ lang: z.enum(['zh_TW', 'en']).optional() }).safeParse(request.query);
      const lang = provider === 'line' ? 'zh_TW' : (q.data?.lang ?? 'zh_TW');
      return reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff')
        .header(
          'content-security-policy',
          provider === 'line'
            ? "default-src 'none'; script-src 'unsafe-inline' https://static.line-scdn.net; style-src 'unsafe-inline'; connect-src 'self' https://api.line.me; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
            : "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        )
        .type('text/html; charset=utf-8')
        .send(renderChannelWorkspacePage(channel, page, lang));
    });
  }
  for (const mode of ['profile', 'report', 'save', 'timezone', 'feed', 'own', 'publish'] as const) {
    const path =
      mode === 'timezone'
        ? '/preferences/timezone'
        : mode === 'feed' || mode === 'own' || mode === 'publish'
          ? '/journal/' + mode
          : '/workspace/' + mode;
    app.post('/' + provider + path, { bodyLimit: 16384 }, async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (
        request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
        !request.headers['content-type']?.startsWith('application/json')
      )
        return reply.code(403).send({ error: 'invalid_origin' });
      const schema =
        mode === 'report'
          ? reportInput
          : mode === 'save'
            ? saveInput
            : mode === 'timezone'
              ? credential.extend({ timezone: z.string().min(1).max(100) }).strict()
              : mode === 'publish'
                ? publishInput
                : mode === 'feed' || mode === 'own'
                  ? credential
                      .extend({ page: z.number().int().min(1).max(100000).default(1) })
                      .strict()
                  : credential;
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_workspace_request' });
      const cred = await resolveCredential(request);
      if (!cred) return reply.code(401).send({ error: 'invalid_workspace_identity' });
      const data = parsed.data;
      try {
        if (mode === 'profile' || mode === 'report') {
          const v = mode === 'report' ? reportInput.parse(data) : null;
          return await execute(
            request.id,
            "SELECT platform.channel_workspace_report($1,$2,$3,$4,$5,$6,$7) || CASE WHEN (platform.privacy_notice()->>'active')::boolean THEN jsonb_build_object('privacy',platform.privacy_usage($1,$2)) ELSE '{}'::jsonb END data",
            [
              provider,
              cred,
              v?.view ?? 'profile',
              data.locale,
              v?.period ?? 'month',
              v?.days ?? 30,
              v?.month ? v.month + '-01' : null
            ]
          );
        }
        if (mode === 'timezone') {
          const v = credential.extend({ timezone: z.string() }).parse(data);
          await withRequestContext(pool, 'qigong_api_runtime', { requestId: request.id }, (c) =>
            c.query('SELECT platform.channel_workspace_timezone($1,$2,$3)', [
              provider,
              cred,
              v.timezone
            ])
          );
          return { ok: true };
        }
        if (mode === 'save') {
          const v = saveInput.parse(data);
          return await execute(
            request.id,
            'SELECT platform.channel_workspace_save($1,$2,$3,$4,$5,$6,$7,$8) data',
            [
              provider,
              cred,
              v.requestId,
              v.date,
              v.version,
              v.methods,
              v.practiceNote ?? null,
              v.feelingTagIds ?? null
            ]
          );
        }
        if (mode === 'publish') {
          const v = publishInput.parse(data);
          return await execute(
            request.id,
            'SELECT platform.channel_journal_publish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) data',
            [
              provider,
              cred,
              v.checkinId,
              v.version,
              v.active,
              v.shareNote,
              v.shareFeelings,
              v.externalEnabled,
              v.alias,
              v.sourceHash
            ]
          );
        }
        const v = credential.extend({ page: z.number() }).parse(data);
        return await execute(
          request.id,
          (mode === 'feed'
            ? 'SELECT platform.community_feed($1,$2,$3,$4)'
            : 'SELECT platform.channel_journal_own($1,$2,$4,$3)') +
            " || CASE WHEN (platform.privacy_notice()->>'active')::boolean THEN jsonb_build_object('privacy',platform.privacy_usage($1,$2)) ELSE '{}'::jsonb END data",
          [provider, cred, data.locale, v.page]
        );
      } catch (e) {
        const f = fail(e);
        return reply.code(f.status).send({ error: f.error });
      }
    });
  }
};
