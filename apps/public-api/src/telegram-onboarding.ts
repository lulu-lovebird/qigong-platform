import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { renderApplicationPage } from './application-page.js';
import { renderCheckinPage } from './checkin-page.js';
import { learnerLocale, learnerTexts, localeQuery } from './learner-locale.js';

const queryLocale = (query: unknown) => {
  const parsed = z.object({ lang: z.string().optional() }).safeParse(query);
  return learnerLocale(parsed.success ? parsed.data.lang : undefined);
};

const telegramUpdate = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: z
    .object({
      chat: z.object({ id: z.number().int().safe(), type: z.string() }),
      from: z.object({
        id: z.number().int().positive().safe(),
        first_name: z.string().min(1).max(255),
        last_name: z.string().max(255).optional(),
        is_bot: z.boolean().optional()
      }),
      text: z.string().optional()
    })
    .optional()
});

const applicationDetails = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  name: z.string().trim().min(1).max(150),
  email: z.email().max(254),
  phone: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
  region: z.enum(['tw-general', 'my-general', 'sg-general', 'hk-general', 'other-general'])
});

export interface TelegramOnboardingConfig {
  botToken: string;
  webhookSecret: string;
  regionCode: string;
  sendMessage?: (chatId: number, text: string) => Promise<void>;
}

export const registerTelegramOnboarding = (
  app: FastifyInstance,
  pool: Pool,
  config: TelegramOnboardingConfig
) => {
  app.get('/telegram/apply', async (request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header(
        'content-security-policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      )
      .type('text/html; charset=utf-8')
      .send(renderApplicationPage({ platform: 'telegram', locale: queryLocale(request.query) }))
  );
  app.get('/telegram/checkin', async (request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header(
        'content-security-policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      )
      .type('text/html; charset=utf-8')
      .send(renderCheckinPage({ platform: 'telegram', locale: queryLocale(request.query) }))
  );
  const sendMessage =
    config.sendMessage ??
    (async (chatId: number, text: string) => {
      const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error(`Telegram sendMessage failed: ${response.status}`);
    });
  app.post('/telegram/onboarding/webhook', { bodyLimit: 32_768 }, async (request, reply) => {
    const incoming = request.headers['x-telegram-bot-api-secret-token'];
    const expected = Buffer.from(config.webhookSecret);
    const supplied = typeof incoming === 'string' ? Buffer.from(incoming) : Buffer.alloc(0);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply.code(401).send({ error: 'invalid_telegram_webhook' });
    }

    const parsed = telegramUpdate.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_telegram_update' });
    const message = parsed.data.message;
    if (
      !message ||
      message.chat.type !== 'private' ||
      message.chat.id !== message.from.id ||
      message.from.is_bot
    ) {
      return { ok: true };
    }
    const isCheckin = /^\/checkin(?:@\w+)?(?:\s|$)/i.test(message.text ?? '');
    const languageCommand = /^\/language(?:@\w+)?(?:\s+(\S+))?\s*$/i.exec(message.text ?? '');
    if (
      !isCheckin &&
      !languageCommand &&
      !/^\/(start|apply)(?:@\w+)?(?:\s|$)/i.test(message.text ?? '')
    ) {
      return { ok: true };
    }

    const linkToken = createHmac('sha256', config.webhookSecret)
      .update(`${parsed.data.update_id}:${message.from.id}`)
      .digest('base64url');
    try {
      const localeResult = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id },
        (client) =>
          client.query<{ locale: string }>(
            "SELECT platform.get_identity_locale('telegram',$1) AS locale",
            [String(message.from.id)]
          )
      );
      const locale = learnerLocale(localeResult.rows[0]?.locale);
      const texts = learnerTexts(locale);
      if (languageCommand) {
        const selected = languageCommand[1];
        if (selected !== 'en' && selected !== 'zh_TW') {
          await sendMessage(message.chat.id, texts.languageHelp);
        } else {
          const change = await withRequestContext(
            pool,
            'qigong_api_runtime',
            { requestId: request.id },
            (client) =>
              client.query<{ changed: boolean }>(
                'SELECT platform.set_telegram_locale_from_update($1,$2,$3) AS changed',
                [parsed.data.update_id, String(message.from.id), selected]
              )
          );
          if (!change.rows[0]?.changed) return { ok: true };
          await sendMessage(message.chat.id, learnerTexts(selected).languageSaved);
        }
        return { ok: true };
      }
      if (isCheckin) {
        const result = await withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: request.id },
          (client) =>
            client.query<{ status: string }>(
              'SELECT platform.begin_telegram_checkin($1, $2) AS status',
              [String(message.from.id), linkToken]
            )
        );
        const text =
          result.rows[0]?.status === 'ready'
            ? `${texts.checkinLink}\nhttps://checkin.baiyinqigong.org/telegram/checkin${localeQuery(locale)}#${linkToken}\n${texts.privateLink}`
            : texts.notApproved;
        await sendMessage(message.chat.id, text);
        return { ok: true };
      }
      const result = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id },
        (client) =>
          client.query<{ status: string }>(
            `SELECT platform.begin_telegram_application($1, $2, $3) AS status`,
            [parsed.data.update_id, String(message.from.id), linkToken]
          )
      );
      const status = result.rows[0]?.status;
      if (status === 'duplicate') return { ok: true };
      if (
        !['form_required', 'link_pending', 'pending', 'approved', 'rejected'].includes(status ?? '')
      ) {
        throw new Error('Unexpected Telegram onboarding state');
      }
      const text =
        status === 'approved'
          ? texts.approved
          : status === 'rejected'
            ? texts.rejected
            : status === 'pending'
              ? texts.pending
              : status === 'link_pending'
                ? texts.linkPending
                : `${texts.applicationLink}\nhttps://checkin.baiyinqigong.org/telegram/apply${localeQuery(locale)}#${linkToken}\n${texts.privateLink}`;
      await sendMessage(message.chat.id, text);
      return { ok: true };
    } catch (error) {
      app.log.error({ err: error, updateId: parsed.data.update_id }, 'telegram onboarding failed');
      return reply.code(503).send({ error: 'telegram_onboarding_unavailable' });
    }
  });

  app.post('/telegram/onboarding/apply', { bodyLimit: 4096 }, async (request, reply) => {
    if (
      request.headers.origin !== 'https://checkin.baiyinqigong.org' ||
      !request.headers['content-type']?.startsWith('application/json')
    ) {
      return reply.code(403).send({ error: 'invalid_origin' });
    }
    const details = applicationDetails.safeParse(request.body);
    if (!details.success) return reply.code(400).send({ error: 'invalid_application_details' });
    try {
      await withRequestContext(pool, 'qigong_api_runtime', { requestId: request.id }, (client) =>
        client.query(`SELECT platform.submit_telegram_application($1, $2, $3, $4, $5)`, [
          details.data.token,
          details.data.name,
          details.data.email,
          details.data.phone,
          details.data.region
        ])
      );
      return { status: 'pending' };
    } catch (error) {
      if (
        error instanceof Error &&
        /^(application link expired or used|application already reviewed|invalid application details|application region unavailable)$/.test(
          error.message
        )
      ) {
        return reply.code(409).send({ error: 'application_unavailable' });
      }
      app.log.error({ err: error }, 'application submission failed');
      return reply.code(503).send({ error: 'application_submission_failed' });
    }
  });

  const checkinToken = z.object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    locale: z.enum(['zh_TW', 'en']).default('zh_TW')
  });
  const checkinSubmission = checkinToken.extend({
    methods: z.array(z.string().min(1).max(64)).min(1).max(30),
    makeup: z.boolean()
  });
  const checkOrigin = (origin: unknown, contentType: unknown) =>
    origin === 'https://checkin.baiyinqigong.org' &&
    typeof contentType === 'string' &&
    contentType.startsWith('application/json');

  app.post('/telegram/preferences/language', { bodyLimit: 4096 }, async (request, reply) => {
    if (!checkOrigin(request.headers.origin, request.headers['content-type']))
      return reply.code(403).send({ error: 'invalid_origin' });
    const parsed = checkinToken.extend({ locale: z.enum(['zh_TW', 'en']) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_language' });
    try {
      await withRequestContext(pool, 'qigong_api_runtime', { requestId: request.id }, (client) =>
        client.query('SELECT platform.set_telegram_locale_by_token($1,$2)', [
          parsed.data.token,
          parsed.data.locale
        ])
      );
      return reply.header('cache-control', 'no-store').send({ locale: parsed.data.locale });
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid language link')
        return reply.code(403).send({ error: 'invalid_language_link' });
      app.log.error({ err: error }, 'Telegram language preference failed');
      return reply.code(503).send({ error: 'language_unavailable' });
    }
  });

  app.post('/telegram/checkin/methods', { bodyLimit: 4096 }, async (request, reply) => {
    if (!checkOrigin(request.headers.origin, request.headers['content-type'])) {
      return reply.code(403).send({ error: 'invalid_origin' });
    }
    const parsed = checkinToken.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_checkin_token' });
    const result = await withRequestContext(
      pool,
      'qigong_api_runtime',
      { requestId: request.id },
      (client) =>
        client.query<{
          code: string;
          name_zh_tw: string;
          sort_order: number;
          parent_code: string | null;
          parent_name_zh_tw: string | null;
          parent_sort_order: number | null;
        }>('SELECT * FROM platform.telegram_localized_methods($1)', [parsed.data.token])
    );
    if (!result.rows.length) return reply.code(403).send({ error: 'checkin_unavailable' });
    return reply.header('cache-control', 'no-store').send({ methods: result.rows });
  });

  app.post('/telegram/checkin/history', { bodyLimit: 4096 }, async (request, reply) => {
    if (!checkOrigin(request.headers.origin, request.headers['content-type'])) {
      return reply.code(403).send({ error: 'invalid_origin' });
    }
    const parsed = checkinToken.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_checkin_token' });
    try {
      const result = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id },
        (client) =>
          client.query<{ history: unknown }>(
            'SELECT platform.telegram_checkin_history($1,$2) AS history',
            [parsed.data.token, parsed.data.locale]
          )
      );
      return reply.header('cache-control', 'no-store').send(result.rows[0]?.history);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'checkin link expired or identity unavailable'
      ) {
        return reply.code(403).send({ error: 'checkin_unavailable' });
      }
      app.log.error({ err: error }, 'telegram checkin history failed');
      return reply.code(503).send({ error: 'checkin_unavailable' });
    }
  });

  app.post('/telegram/checkin/correct', { bodyLimit: 4096 }, async (request, reply) => {
    if (!checkOrigin(request.headers.origin, request.headers['content-type'])) {
      return reply.code(403).send({ error: 'invalid_origin' });
    }
    const parsed = checkinSubmission
      .omit({ makeup: true })
      .extend({
        checkinId: z.uuid()
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_checkin_correction' });
    try {
      await withRequestContext(pool, 'qigong_api_runtime', { requestId: request.id }, (client) =>
        client.query('SELECT platform.correct_telegram_checkin($1, $2, $3)', [
          parsed.data.token,
          parsed.data.checkinId,
          parsed.data.methods
        ])
      );
      return reply.header('cache-control', 'no-store').send({ ok: true });
    } catch (error) {
      if (
        error instanceof Error &&
        /^(checkin link expired or identity unavailable|checkin correction unavailable|invalid or duplicate practice method)$/.test(
          error.message
        )
      ) {
        return reply.code(409).send({ error: 'checkin_conflict' });
      }
      app.log.error({ err: error }, 'telegram checkin correction failed');
      return reply.code(503).send({ error: 'checkin_unavailable' });
    }
  });

  app.post('/telegram/checkin/submit', { bodyLimit: 4096 }, async (request, reply) => {
    if (!checkOrigin(request.headers.origin, request.headers['content-type'])) {
      return reply.code(403).send({ error: 'invalid_origin' });
    }
    const parsed = checkinSubmission.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_checkin_submission' });
    try {
      const result = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id },
        (client) =>
          client.query<{ checkin_id: string; practice_date: string; entry_kind: string }>(
            'SELECT checkin_id, practice_date::text AS practice_date, entry_kind FROM platform.submit_telegram_checkin($1, $2, $3)',
            [parsed.data.token, parsed.data.methods, parsed.data.makeup]
          )
      );
      const checkin = result.rows[0];
      if (!checkin) throw new Error('Checkin write returned no result');
      return {
        checkinId: checkin.checkin_id,
        practiceDate: checkin.practice_date,
        entryKind: checkin.entry_kind
      };
    } catch (error) {
      if (
        error instanceof Error &&
        (/^(checkin link expired or used|checkin identity not approved or active|makeup deadline passed|practice date has no region assignment|invalid or duplicate practice method)$/.test(
          error.message
        ) ||
          ('code' in error && error.code === '23505'))
      ) {
        return reply.code(409).send({ error: 'checkin_conflict' });
      }
      app.log.error({ err: error }, 'telegram checkin failed');
      return reply.code(503).send({ error: 'checkin_unavailable' });
    }
  });
};
