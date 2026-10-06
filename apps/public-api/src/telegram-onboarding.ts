import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { telegramApplicationPage } from './telegram-application-page.js';
import { telegramCheckinPage } from './telegram-checkin-page.js';

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
  app.get('/telegram/apply', async (_request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header(
        'content-security-policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      )
      .type('text/html; charset=utf-8')
      .send(telegramApplicationPage)
  );
  app.get('/telegram/checkin', async (_request, reply) =>
    reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .header(
        'content-security-policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      )
      .type('text/html; charset=utf-8')
      .send(telegramCheckinPage)
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
    if (!isCheckin && !/^\/(start|apply)(?:@\w+)?(?:\s|$)/i.test(message.text ?? '')) {
      return { ok: true };
    }

    const linkToken = createHmac('sha256', config.webhookSecret)
      .update(`${parsed.data.update_id}:${message.from.id}`)
      .digest('base64url');
    try {
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
            ? `請在 15 分鐘內開啟打卡表單：\nhttps://checkin.baiyinqigong.org/telegram/checkin#${linkToken}\n請勿轉傳連結。`
            : '尚未通過加入審核，或目前不是你的主要打卡管道。';
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
          ? '你已通過氣功小幫手的加入審核。打卡功能將在新平台開放後通知你。'
          : status === 'rejected'
            ? '你的申請目前未獲核准。如有疑問，請聯絡地區管理員。'
            : status === 'pending'
              ? '你的加入申請已送審，請等待地區管理員核對。審核前尚無法打卡。'
              : status === 'link_pending'
                ? '先前的申請連結仍有效，請使用上一則訊息的連結填寫資料；若連結已過期，請在 30 分鐘後重新輸入 /start。'
                : `請在 30 分鐘內填寫姓名、官網註冊 Email、含國碼電話與地區，填妥後才會送審：\nhttps://checkin.baiyinqigong.org/telegram/apply#${linkToken}\n請勿將連結轉傳他人。`;
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

  const checkinToken = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
  const checkinSubmission = checkinToken.extend({
    methods: z.array(z.string().min(1).max(64)).min(1).max(30),
    makeup: z.boolean()
  });
  const checkOrigin = (origin: unknown, contentType: unknown) =>
    origin === 'https://checkin.baiyinqigong.org' &&
    typeof contentType === 'string' &&
    contentType.startsWith('application/json');

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
        client.query<{ code: string; name_zh_tw: string; sort_order: number }>(
          'SELECT * FROM platform.telegram_checkin_methods($1)',
          [parsed.data.token]
        )
    );
    if (!result.rows.length) return reply.code(403).send({ error: 'checkin_unavailable' });
    return reply.header('cache-control', 'no-store').send({ methods: result.rows });
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
