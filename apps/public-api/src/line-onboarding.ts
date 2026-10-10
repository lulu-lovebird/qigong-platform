import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import {
  enrichPracticeHistory,
  isPracticeNoteConflict,
  practiceNoteSchema,
  savePracticeNote
} from './practice-notes.js';
import { lineApplicationPage } from './line-application-page.js';
import { renderChannelWorkspacePage } from './channel-workspace-pages.js';
import { registerChannelWorkspace } from './channel-workspace.js';
import {
  beginLearnerPrivacy,
  learnerPrivacyReply,
  isLearnerPrivacyError
} from './learner-privacy-routes.js';

export interface LineConfig {
  channelSecret: string;
  channelAccessToken: string;
  loginChannelId: string;
  liffId: string;
  verifyIdToken?: (idToken: string) => Promise<string>;
  reply?: (replyToken: string, text: string) => Promise<void>;
}

const userId = z.string().regex(/^U[0-9a-f]{32}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const webhookEvent = z.object({
  type: z.string(),
  webhookEventId: z.string().optional(),
  replyToken: z.string().optional(),
  source: z.object({ type: z.string(), userId: userId.optional() }),
  message: z.object({ type: z.string(), text: z.string().optional() }).optional()
});
const details = z.object({
  idToken: z.string().min(1).max(4096),
  token,
  name: z.string().trim().min(1).max(150),
  email: z.email().max(254),
  phone: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
  region: z.enum(['tw-general', 'my-general', 'sg-general', 'hk-general', 'other-general'])
});

export const registerLineOnboarding = (app: FastifyInstance, pool: Pool, config: LineConfig) => {
  const verify =
    config.verifyIdToken ??
    (async (idToken: string) => {
      const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token: idToken, client_id: config.loginChannelId }),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error('LINE ID token verification failed');
      const data: unknown = await response.json();
      const parsed = z.object({ sub: userId, aud: z.string(), exp: z.number() }).safeParse(data);
      if (
        !parsed.success ||
        parsed.data.aud !== config.loginChannelId ||
        parsed.data.exp <= Date.now() / 1000
      )
        throw new Error('Invalid LINE ID token');
      return parsed.data.sub;
    });
  const replyMessage =
    config.reply ??
    (async (replyToken: string, text: string) => {
      const response = await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.channelAccessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error(`LINE reply failed: ${response.status}`);
    });
  const page =
    (html: string) =>
    (
      _request: unknown,
      reply: {
        header: (key: string, value: string) => typeof reply;
        type: (type: string) => typeof reply;
        send: (html: string) => unknown;
      }
    ) =>
      reply
        .header('cache-control', 'no-store')
        .header('referrer-policy', 'no-referrer')
        .header(
          'content-security-policy',
          "default-src 'none'; script-src 'unsafe-inline' https://static.line-scdn.net; style-src 'unsafe-inline'; connect-src 'self' https://api.line.me; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
        )
        .type('text/html; charset=utf-8')
        .send(html);
  // The configured LIFF endpoint must initialize the SDK, including primary redirects.
  app.get(
    '/line/',
    page(renderChannelWorkspacePage({ platform: 'line', liffId: config.liffId }, 'checkin'))
  );
  app.get('/line/apply', page(lineApplicationPage(config.liffId)));
  app.get(
    '/line/checkin',
    page(renderChannelWorkspacePage({ platform: 'line', liffId: config.liffId }, 'checkin'))
  );

  app.register((webhookApp, _options, done) => {
    webhookApp.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: 32_768 },
      (_request, body, done) => done(null, body)
    );
    webhookApp.post('/line/webhook', { bodyLimit: 32_768 }, async (request, reply) => {
      const signature = request.headers['x-line-signature'];
      const raw = request.body;
      if (typeof signature !== 'string' || !Buffer.isBuffer(raw))
        return reply.code(401).send({ error: 'invalid_line_signature' });
      const expected = createHmac('sha256', config.channelSecret).update(raw).digest();
      const supplied = Buffer.from(signature, 'base64');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        return reply.code(401).send({ error: 'invalid_line_signature' });
      let body: unknown;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        return reply.code(400).send({ error: 'invalid_line_event' });
      }
      const parsed = z.object({ events: z.array(webhookEvent).max(100) }).safeParse(body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_line_event' });
      for (const event of parsed.data.events) {
        if (event.source.type !== 'user' || !event.source.userId || !event.replyToken) continue;
        const isCheckin =
          event.type === 'message' &&
          event.message?.type === 'text' &&
          /^(打卡|checkin|\/checkin)$/i.test(event.message.text?.trim() ?? '');
        const isApply =
          event.type === 'follow' ||
          (event.type === 'message' &&
            event.message?.type === 'text' &&
            /^(加入|申請|start|\/start)$/i.test(event.message.text?.trim() ?? ''));
        const isPrivacy =
          event.type === 'message' &&
          event.message?.type === 'text' &&
          /^(隱私|privacy|\/privacy|terms|條款)$/i.test(event.message.text?.trim() ?? '');
        const workspaceCommand =
          event.type === 'message' &&
          event.message?.type === 'text' &&
          /^(?:\/)?(?:menu|選單|leaderboard|排行榜|methods|methodanalysis|功法分析|achievements|我的成就|成就|history|打卡紀錄|journal|share|心得|心得分享)$/i.test(
            event.message.text?.trim() ?? ''
          );
        if (!isCheckin && !isApply && !isPrivacy && !workspaceCommand) continue;
        const privacyToken = createHmac('sha256', config.channelSecret)
          .update(
            'privacy:' + (event.webhookEventId ?? event.replyToken) + ':' + event.source.userId
          )
          .digest('base64url');
        const privacyState = await withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: request.id },
          (client) => beginLearnerPrivacy(client, 'line', event.source.userId!, privacyToken)
        );
        const privacyMessage = learnerPrivacyReply(
          privacyState,
          'line',
          privacyToken,
          'zh_TW',
          isPrivacy
        );
        if (privacyMessage) {
          await replyMessage(event.replyToken, privacyMessage);
          continue;
        }
        if (isCheckin || workspaceCommand) {
          await replyMessage(
            event.replyToken,
            [
              '白雁氣功｜學員工作區',
              '練功打卡：https://checkin.baiyinqigong.org/line/checkin',
              '排行榜：https://checkin.baiyinqigong.org/line/leaderboard',
              '功法分析：https://checkin.baiyinqigong.org/line/method-analysis',
              '我的成就／月曆：https://checkin.baiyinqigong.org/line/achievements',
              '心得分享：https://checkin.baiyinqigong.org/line/journal'
            ].join('\n')
          );
        } else {
          const link = createHmac('sha256', config.channelSecret)
            .update(event.webhookEventId ?? event.replyToken)
            .digest('base64url');
          const result = await withRequestContext(
            pool,
            'qigong_api_runtime',
            { requestId: request.id },
            (client) =>
              client.query<{ status: string }>('SELECT platform.begin_line_link($1,$2) AS status', [
                event.source.userId,
                link
              ])
          );
          const state = result.rows[0]?.status;
          const text =
            state === 'form_required'
              ? `請在 30 分鐘內填寫加入申請：https://checkin.baiyinqigong.org/line/apply#${link}`
              : state === 'approved'
                ? '已核准。請輸入「打卡」開始。'
                : state === 'rejected'
                  ? '申請未獲核准，請聯絡所在地區管理員。'
                  : '申請審核中，請耐心等候。';
          await replyMessage(event.replyToken, text);
        }
      }
      return { ok: true };
    });
    done();
  });

  const validOrigin = (origin: unknown, contentType: unknown) =>
    origin === 'https://checkin.baiyinqigong.org' &&
    typeof contentType === 'string' &&
    contentType.startsWith('application/json');
  const authenticated = async (body: unknown) => {
    const parsed = z.object({ idToken: z.string().min(1).max(4096) }).safeParse(body);
    if (!parsed.success) return null;
    try {
      return await verify(parsed.data.idToken);
    } catch {
      return null;
    }
  };
  registerChannelWorkspace(
    app,
    pool,
    { platform: 'line', liffId: config.liffId },
    async (request) => authenticated(request.body),
    false
  );

  app.post('/line/onboarding/apply', { bodyLimit: 8192 }, async (request, reply) => {
    if (!validOrigin(request.headers.origin, request.headers['content-type']))
      return reply.code(403).send({ error: 'invalid_origin' });
    const parsed = details.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_application_details' });
    const subject = await authenticated(request.body);
    if (!subject) return reply.code(401).send({ error: 'invalid_line_identity' });
    try {
      const result = await withRequestContext(
        pool,
        'qigong_api_runtime',
        { requestId: request.id },
        (client) =>
          client.query<{ status: string }>(
            'SELECT platform.submit_line_application($1,$2,$3,$4,$5,$6) AS status',
            [
              subject,
              parsed.data.token,
              parsed.data.name,
              parsed.data.email,
              parsed.data.phone,
              parsed.data.region
            ]
          )
      );
      return reply.header('cache-control', 'no-store').send({ status: result.rows[0]?.status });
    } catch (error) {
      if (
        error instanceof Error &&
        /^(LINE application link expired or used|LINE application already reviewed|platform identity already linked|LINE application region unavailable)$/.test(
          error.message
        )
      )
        return reply.code(409).send({ error: 'application_unavailable' });
      if (isLearnerPrivacyError(error))
        return reply.code(403).send({ error: 'privacy_acceptance_required' });
      app.log.error({ requestId: request.id }, 'LINE application failed');
      return reply.code(503).send({ error: 'application_unavailable' });
    }
  });

  const route = (name: 'methods' | 'history' | 'submit' | 'correct') => {
    app.post(`/line/checkin/${name}`, { bodyLimit: 16384 }, async (request, reply) => {
      if (!validOrigin(request.headers.origin, request.headers['content-type']))
        return reply.code(403).send({ error: 'invalid_origin' });
      const subject = await authenticated(request.body);
      if (!subject) return reply.code(401).send({ error: 'invalid_line_identity' });
      const payload = z
        .object({
          methods: z.array(z.string().min(1).max(64)).min(1).max(30),
          makeup: z.boolean().optional(),
          checkinId: z.uuid().optional()
        })
        .extend(practiceNoteSchema.shape)
        .safeParse(request.body);
      if (
        (name === 'submit' || name === 'correct') &&
        (!payload.success ||
          (name === 'submit' && payload.data.makeup === undefined) ||
          (name === 'correct' && !payload.data.checkinId))
      )
        return reply.code(400).send({ error: 'invalid_checkin_submission' });
      try {
        const result = await withRequestContext(
          pool,
          'qigong_api_runtime',
          { requestId: request.id },
          async (client): Promise<{ rows: Array<Record<string, unknown>> }> => {
            const result: { rows: Array<Record<string, unknown>> } = await (name === 'methods'
              ? client.query<Record<string, unknown>>(
                  'SELECT * FROM platform.line_checkin_method_tree($1)',
                  [subject]
                )
              : name === 'history'
                ? client.query<{ history: unknown }>(
                    'SELECT platform.line_checkin_history($1) AS history',
                    [subject]
                  )
                : name === 'submit'
                  ? client.query<{ checkin_id: string; practice_date: string; entry_kind: string }>(
                      'SELECT checkin_id, practice_date::text AS practice_date, entry_kind FROM platform.submit_line_checkin($1,$2,$3)',
                      [
                        subject,
                        payload.success ? payload.data.methods : [],
                        payload.success ? payload.data.makeup : false
                      ]
                    )
                  : client.query<{ correct_line_checkin: unknown }>(
                      'SELECT platform.correct_line_checkin($1,$2,$3)',
                      [
                        subject,
                        payload.success ? payload.data.checkinId : null,
                        payload.success ? payload.data.methods : []
                      ]
                    ));
            if (name === 'history')
              return {
                rows: [
                  {
                    history: await enrichPracticeHistory(
                      client,
                      'line',
                      subject,
                      'zh_TW',
                      result.rows[0]?.history
                    )
                  }
                ]
              };
            if ((name === 'submit' || name === 'correct') && payload.success) {
              const id = name === 'submit' ? result.rows[0]?.checkin_id : payload.data.checkinId;
              if (typeof id !== 'string') throw new Error('Checkin write returned no result');
              await savePracticeNote(client, 'line', subject, id, payload.data);
            }
            return result;
          }
        );
        if (name === 'methods')
          return reply.header('cache-control', 'no-store').send({ methods: result.rows });
        if (name === 'history')
          return reply.header('cache-control', 'no-store').send(result.rows[0]?.history);
        if (name === 'submit')
          return reply.header('cache-control', 'no-store').send(result.rows[0]);
        return reply.header('cache-control', 'no-store').send({ ok: true });
      } catch (error) {
        if (
          isPracticeNoteConflict(error) ||
          (error instanceof Error &&
            (/^(LINE checkin identity unavailable|checkin correction unavailable|makeup deadline passed|practice date has no region assignment|invalid or duplicate practice method)$/.test(
              error.message
            ) ||
              ('code' in error && error.code === '23505')))
        )
          return reply.code(409).send({ error: 'checkin_conflict' });
        if (isLearnerPrivacyError(error))
          return reply.code(403).send({ error: 'privacy_acceptance_required' });
        app.log.error({ requestId: request.id }, 'LINE checkin failed');
        return reply.code(503).send({ error: 'checkin_unavailable' });
      }
    });
  };
  for (const name of ['methods', 'history', 'submit', 'correct'] as const) route(name);
};
