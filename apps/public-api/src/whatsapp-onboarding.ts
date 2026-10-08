import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { renderApplicationPage } from './application-page.js';
import { renderCheckinPage } from './checkin-page.js';
import { learnerLocale, learnerTexts, localeQuery } from './learner-locale.js';
import { createWhatsAppTextSender, whatsappTransportSchema } from './whatsapp-client.js';
import {
  enrichPracticeHistory,
  isPracticeNoteConflict,
  practiceNoteSchema,
  savePracticeNote
} from './practice-notes.js';

export const whatsappConfigSchema = whatsappTransportSchema.extend({
  businessAccountId: z.string().regex(/^\d+$/),
  appSecret: z.string().min(16),
  verifyToken: z.string().min(20)
});
export type WhatsAppConfig = z.infer<typeof whatsappConfigSchema> & {
  sendText?: (recipient: string, text: string) => Promise<void>;
};
export const loadWhatsAppConfig = (source: NodeJS.ProcessEnv): WhatsAppConfig | undefined => {
  const values = {
    phoneNumberId: source.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: source.WHATSAPP_ACCESS_TOKEN,
    graphVersion: source.WHATSAPP_GRAPH_VERSION,
    businessAccountId: source.WHATSAPP_BUSINESS_ACCOUNT_ID,
    appSecret: source.WHATSAPP_APP_SECRET,
    verifyToken: source.WHATSAPP_VERIFY_TOKEN
  };
  if (!Object.values(values).some(Boolean)) return undefined;
  if (!Object.values(values).every(Boolean))
    throw new Error('WhatsApp API configuration must be supplied together');
  return whatsappConfigSchema.parse(values);
};

const subjectSchema = z.string().regex(/^[0-9]{1,20}$/);
const messageSchema = z.object({
  id: z.string().min(1).max(256),
  from: subjectSchema,
  timestamp: z.string().regex(/^\d{1,12}$/),
  type: z.string(),
  text: z.object({ body: z.string().max(4096) }).optional()
});
const eventSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z
    .array(
      z.object({
        id: z.string(),
        changes: z
          .array(
            z.object({
              field: z.string(),
              value: z.object({
                messaging_product: z.literal('whatsapp'),
                metadata: z.object({ phone_number_id: z.string() }),
                messages: z.array(messageSchema).max(100).optional()
              })
            })
          )
          .max(100)
      })
    )
    .max(10)
});
const credentials = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  locale: z.enum(['zh_TW', 'en']).default('zh_TW')
});
const detailsSchema = credentials.extend({
  name: z.string().trim().min(1).max(150),
  email: z.email().max(254),
  phone: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
  region: z.enum(['tw-general', 'my-general', 'sg-general', 'hk-general', 'other-general']),
  notificationConsent: z.literal(true)
});
const validOrigin = (origin: unknown, contentType: unknown) =>
  origin === 'https://checkin.baiyinqigong.org' &&
  typeof contentType === 'string' &&
  contentType.startsWith('application/json');
const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const knownConflict = (error: unknown) =>
  error instanceof Error &&
  (/^(invalid WhatsApp link|invalid WhatsApp application|WhatsApp region unavailable|WhatsApp application already reviewed|WhatsApp checkin identity unavailable|checkin correction unavailable|makeup deadline passed|practice date has no region assignment|invalid or duplicate practice method)$/.test(
    error.message
  ) ||
    ('code' in error && error.code === '23505'));
export const registerWhatsAppOnboarding = (
  app: FastifyInstance,
  pool: Pool,
  config: WhatsAppConfig
) => {
  const sendText = config.sendText ?? createWhatsAppTextSender(config);
  for (const kind of ['apply', 'checkin'] as const) {
    app.get(`/whatsapp/${kind}`, (request, reply) => {
      const query = z.object({ lang: z.string().optional() }).safeParse(request.query);
      const locale = learnerLocale(query.success ? query.data.lang : undefined);
      return reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header(
          'content-security-policy',
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        )
        .type('text/html; charset=utf-8')
        .send(
          kind === 'apply'
            ? renderApplicationPage({ platform: 'whatsapp', locale })
            : renderCheckinPage({ platform: 'whatsapp', locale })
        );
    });
  }
  // Meta puts the verification secret in the query string; suppress automatic URL logging.
  app.get('/whatsapp/webhook', { logLevel: 'silent' }, (request, reply) => {
    const query = z
      .object({
        'hub.mode': z.literal('subscribe'),
        'hub.verify_token': z.string().max(512),
        'hub.challenge': z.string().regex(/^\d{1,100}$/)
      })
      .safeParse(request.query);
    if (!query.success || !safeEqual(query.data['hub.verify_token'], config.verifyToken))
      return reply.code(403).send({ error: 'invalid_whatsapp_verification' });
    return reply
      .header('cache-control', 'no-store')
      .type('text/plain')
      .send(query.data['hub.challenge']);
  });
  app.register((webhook, _options, done) => {
    webhook.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 262144 },
      (_request, body, done) => done(null, body)
    );
    webhook.post('/whatsapp/webhook', { bodyLimit: 262144 }, async (request, reply) => {
      const signature = request.headers['x-hub-signature-256'];
      if (
        !Buffer.isBuffer(request.body) ||
        typeof signature !== 'string' ||
        !/^sha256=[0-9a-f]{64}$/.test(signature) ||
        !safeEqual(
          signature,
          'sha256=' + createHmac('sha256', config.appSecret).update(request.body).digest('hex')
        )
      )
        return reply.code(401).send({ error: 'invalid_whatsapp_signature' });
      let body: unknown;
      try {
        body = JSON.parse(request.body.toString('utf8'));
      } catch {
        return reply.code(400).send({ error: 'invalid_whatsapp_event' });
      }
      const parsed = eventSchema.safeParse(body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_whatsapp_event' });
      if (
        parsed.data.entry.some(
          (entry) =>
            entry.id !== config.businessAccountId ||
            entry.changes.some(
              (change) => change.value.metadata.phone_number_id !== config.phoneNumberId
            )
        )
      )
        return reply.code(403).send({ error: 'wrong_whatsapp_account' });
      const messages = parsed.data.entry.flatMap((entry) =>
        entry.changes
          .filter((change) => change.field === 'messages')
          .flatMap((change) => change.value.messages ?? [])
      );
      if (messages.length > 100) return reply.code(400).send({ error: 'invalid_whatsapp_event' });
      try {
        for (const message of messages) {
          await withRequestContext(
            pool,
            'qigong_api_runtime',
            { requestId: request.id },
            async (client) => {
              const inbox = await client.query<{ fresh: boolean }>(
                'SELECT platform.begin_whatsapp_event($1,$2,$3) AS fresh',
                [
                  message.id,
                  message.from,
                  createHash('sha256').update(JSON.stringify(message)).digest('hex')
                ]
              );
              if (!inbox.rows[0]?.fresh || message.type !== 'text' || !message.text) return;
              // Delayed messages are not a license to send free text outside the customer-service window.
              const age = Date.now() / 1000 - Number(message.timestamp);
              if (age < -300 || age >= 24 * 60 * 60) return;
              const preference = await client.query<{ locale: string }>(
                "SELECT platform.get_identity_locale('whatsapp',$1) AS locale",
                [message.from]
              );
              const locale = learnerLocale(preference.rows[0]?.locale);
              const texts = learnerTexts(locale);
              const text = message.text.body.trim();
              const language = /^\/?language(?:\s+(\S+))?$/i.exec(text);
              if (language) {
                const selected = language[1];
                if (selected !== 'en' && selected !== 'zh_TW') {
                  await sendText(message.from, texts.languageHelp);
                  return;
                }
                await client.query("SELECT platform.set_identity_locale('whatsapp',$1,$2)", [
                  message.from,
                  selected
                ]);
                await sendText(
                  message.from,
                  selected === 'en'
                    ? 'Language set to English. Reply join to apply or checkin to practice.'
                    : '已切換繁體中文。輸入「加入」申請或「打卡」練功。'
                );
                return;
              }
              if (/^(stop|停止通知)$/i.test(text)) {
                await client.query('SELECT platform.withdraw_whatsapp_notifications($1)', [
                  message.from
                ]);
                await sendText(
                  message.from,
                  locale === 'en'
                    ? 'Application decision notifications stopped. Reply join to check your status.'
                    : '已停止申請結果通知。可輸入「加入」查看狀態。'
                );
                return;
              }
              const checkin = /^(?:\/?checkin|打卡)$/i.test(text);
              if (!checkin && !/^(?:\/?start|join|加入|申請)$/i.test(text)) return;
              const purpose = checkin ? 'checkin' : 'apply';
              const token = createHmac('sha256', config.appSecret)
                .update(`${message.id}:${message.from}:${purpose}`)
                .digest('base64url');
              const result = await client.query<{ status: string }>(
                'SELECT platform.begin_whatsapp_link($1,$2,$3) AS status',
                [message.from, token, purpose]
              );
              const status = result.rows[0]?.status;
              let response: string;
              if (status === 'form_required' || status === 'ready')
                response = `${checkin ? texts.checkinLink : texts.applicationLink}\nhttps://checkin.baiyinqigong.org/whatsapp/${purpose}${localeQuery(locale)}#${token}\n${texts.privateLink}`;
              else if (status === 'approved')
                response =
                  locale === 'en'
                    ? 'You are approved. Reply checkin to practice.'
                    : '已核准。請輸入「打卡」開始。';
              else if (status === 'rejected') response = texts.rejected;
              else if (status === 'pending') response = texts.pending;
              else if (status === 'link_pending')
                response =
                  locale === 'en'
                    ? 'Use your previous application link. Reply join after it expires.'
                    : '請使用上一則申請連結；到期後可重新輸入「加入」。';
              else if (status === 'unavailable') response = texts.notApproved;
              else throw new Error('Unexpected WhatsApp onboarding state');
              await sendText(message.from, response);
            }
          );
        }
        return { ok: true };
      } catch {
        app.log.error({ requestId: request.id }, 'WhatsApp webhook processing failed');
        return reply.code(503).send({ error: 'whatsapp_unavailable' });
      }
    });
    done();
  });
  app.post('/whatsapp/onboarding/apply', { bodyLimit: 8192 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!validOrigin(request.headers.origin, request.headers['content-type']))
      return reply.code(403).send({ error: 'invalid_origin' });
    const parsed = detailsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_application_details' });
    const data = parsed.data;
    try {
      await withRequestContext(pool, 'qigong_api_runtime', { requestId: request.id }, (client) =>
        client.query('SELECT platform.submit_whatsapp_application($1,$2,$3,$4,$5,$6,$7)', [
          data.token,
          data.name,
          data.email,
          data.phone,
          data.region,
          data.locale,
          data.notificationConsent
        ])
      );
      return { status: 'pending' };
    } catch (error) {
      return reply
        .code(knownConflict(error) ? 409 : 503)
        .send({ error: 'application_unavailable' });
    }
  });
  app.post('/whatsapp/preferences/language', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!validOrigin(request.headers.origin, request.headers['content-type']))
      return reply.code(403).send({ error: 'invalid_origin' });
    const parsed = credentials.extend({ locale: z.enum(['zh_TW', 'en']) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_language' });
    try {
      await withRequestContext(pool, 'qigong_api_runtime', { requestId: request.id }, (client) =>
        client.query('SELECT platform.set_whatsapp_locale_by_token($1,$2)', [
          parsed.data.token,
          parsed.data.locale
        ])
      );
      return { locale: parsed.data.locale };
    } catch (error) {
      return reply.code(knownConflict(error) ? 403 : 503).send({ error: 'language_unavailable' });
    }
  });
  for (const name of ['methods', 'history', 'submit', 'correct'] as const) {
    app.post(`/whatsapp/checkin/${name}`, { bodyLimit: 16384 }, async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (!validOrigin(request.headers.origin, request.headers['content-type']))
        return reply.code(403).send({ error: 'invalid_origin' });
      const schema =
        name === 'submit'
          ? credentials.extend(practiceNoteSchema.shape).extend({
              methods: z.array(z.string().min(1).max(64)).min(1).max(30),
              makeup: z.boolean()
            })
          : name === 'correct'
            ? credentials.extend(practiceNoteSchema.shape).extend({
                methods: z.array(z.string().min(1).max(64)).min(1).max(30),
                checkinId: z.uuid()
              })
            : credentials.extend(practiceNoteSchema.shape);
      const parsed = schema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_checkin_submission' });
      const data = parsed.data;
      try {
        return await withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: request.id },
          async (client) => {
            const identity = await client.query<{ subject: string }>(
              "SELECT platform.whatsapp_link_subject($1,'checkin') AS subject",
              [data.token]
            );
            const subject = identity.rows[0]!.subject;
            if (name === 'methods')
              return {
                methods: (
                  await client.query<Record<string, unknown>>(
                    'SELECT * FROM platform.whatsapp_localized_methods($1)',
                    [subject]
                  )
                ).rows
              };
            if (name === 'history') {
              const history = await client.query<{ history: unknown }>(
                'SELECT platform.whatsapp_checkin_history($1,$2) AS history',
                [subject, data.locale]
              );
              return enrichPracticeHistory(
                client,
                'whatsapp',
                data.token,
                data.locale,
                history.rows[0]?.history
              );
            }
            if (name === 'submit' && 'methods' in data && 'makeup' in data) {
              const result = await client.query<{
                checkin_id: string;
                practice_date: string;
                entry_kind: string;
              }>(
                'SELECT checkin_id,practice_date::text,entry_kind FROM platform.submit_whatsapp_checkin($1,$2,$3)',
                [subject, data.methods, data.makeup]
              );
              const checkin = result.rows[0];
              if (!checkin) throw new Error('Checkin write returned no result');
              await savePracticeNote(client, 'whatsapp', data.token, checkin.checkin_id, data);
              return checkin;
            }
            if (
              name === 'correct' &&
              'methods' in data &&
              'checkinId' in data &&
              typeof data.checkinId === 'string'
            ) {
              await client.query('SELECT platform.correct_whatsapp_checkin($1,$2,$3)', [
                subject,
                data.checkinId,
                data.methods
              ]);
              await savePracticeNote(client, 'whatsapp', data.token, data.checkinId, data);
              return { ok: true };
            }
            throw new Error('Invalid checkin operation');
          }
        );
      } catch (error) {
        return reply
          .code(knownConflict(error) || isPracticeNoteConflict(error) ? 409 : 503)
          .send({ error: 'checkin_unavailable' });
      }
    });
  }
};
