import { randomBytes, randomUUID } from 'node:crypto';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { localeSchema, uiText } from './ui-localization.js';
import {
  learnerReviewCallback,
  learnerReviewPlainField as field,
  type TelegramReviewTransport
} from './telegram-learner-review.js';

const payloadSchema = z
  .object({
    allowed: z.literal(true),
    recipient: z.string().regex(/^[1-9][0-9]{0,19}$/),
    locale: localeSchema,
    name: z.string().min(1).max(150),
    platform: z.enum(['line', 'telegram', 'whatsapp']),
    sourceId: z.string().min(1).max(128),
    phone: z.string().min(1).max(32),
    email: z.string().min(1).max(254),
    region: z.string().min(1).max(150)
  })
  .strict()
  .refine((value) =>
    value.platform === 'line'
      ? /^U[0-9a-f]{32}$/.test(value.sourceId)
      : /^[1-9][0-9]{0,19}$/.test(value.sourceId)
  );
export type TelegramLearnerReviewNotification = z.infer<typeof payloadSchema>;
export const buildTelegramLearnerReviewNotification = (
  data: TelegramLearnerReviewNotification,
  token: string
) => {
  const en = data.locale === 'en';
  const text = (english: string, chinese: string) => (en ? english : uiText(data.locale, chinese));
  return {
    text: [
      text(
        '🔒 Private learner application — for authorized review only',
        '🔒 私人學員申請 — 僅限授權審核用途'
      ),
      text('Name (self-reported): ', '姓名（自行填寫）：') + field(data.name),
      text(
        'Source platform nickname: not captured / unavailable',
        '來源平台暱稱：未擷取／無法提供'
      ),
      data.platform.toUpperCase() +
        text(' verified source system ID: ', ' 已驗證來源系統 ID：') +
        data.sourceId,
      text(
        'Verification identifies the source channel, not a verified person or legal name. This is the source system identifier, NOT a chosen LINE handle. No other-platform identity has been inferred.',
        '驗證僅識別來源管道，不代表已驗證本人或法定姓名。這是來源系統識別碼，不是自選 LINE 帳號；未推斷其他平台身分。'
      ),
      text('Phone (self-reported): ', '電話（自行填寫）：') + field(data.phone),
      text('Email (self-reported): ', '電子信箱（自行填寫）：') + field(data.email),
      text('Requested region: ', '申請地區：') + field(data.region),
      '',
      text(
        'Approve or deny below; a second confirmation is required. Buttons expire within 24 hours and after permission, binding or application changes. Do not forward. Telegram cloud chats are not end-to-end encrypted.',
        '可在下方通過或拒絕；必須再次確認。按鈕於 24 小時內及權限、綁定或申請資料變更後失效。請勿轉傳。Telegram 雲端聊天並非端對端加密。'
      )
    ].join('\n'),
    buttons: [
      [
        { text: text('Approve', '通過'), callback_data: learnerReviewCallback(token, 'a') },
        { text: text('Deny', '拒絕'), callback_data: learnerReviewCallback(token, 'd') }
      ]
    ]
  };
};
export const deliverTelegramLearnerReviews = async (
  pool: Pool,
  transport: TelegramReviewTransport,
  onError: (error: Error) => void
) => {
  const query = <Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) =>
    withRequestContext(pool, 'qigong_worker_runtime', { requestId: randomUUID() }, (c) =>
      c.query<Row>(sql, values)
    );
  const jobs = await query<{ id: string; lease_id: string }>(
    'SELECT * FROM ops.claim_telegram_learner_reviews(5)'
  );
  await Promise.all(
    jobs.rows.map(async (job) => {
      let messageId: number | null = null;
      try {
        const token = randomBytes(32).toString('base64url');
        // Fresh DB payload is obtained after claim and immediately before send.
        const result = await query<{ data: unknown }>(
          'SELECT ops.telegram_learner_review_payload($1,$2,$3) data',
          [job.id, job.lease_id, token]
        );
        const parsed = payloadSchema.safeParse(result.rows[0]?.data);
        if (!parsed.success) throw Error('Review unavailable');
        const message = buildTelegramLearnerReviewNotification(parsed.data, token);
        messageId = z
          .number()
          .int()
          .positive()
          .safe()
          .parse(await transport.send(parsed.data.recipient, message.text, message.buttons));
      } catch {
        onError(Error('Private learner review delivery unavailable'));
      }
      // A timeout may have delivered a message. Its unacknowledged token remains
      // unusable; lease recovery rotates it. Delivery is not exactly-once.
      try {
        const finish = await query<{ accepted: boolean }>(
          'SELECT ops.finish_telegram_learner_review($1,$2,$3) accepted',
          [job.id, job.lease_id, messageId]
        );
        if (finish.rows[0]?.accepted !== true) throw Error('Lease unavailable');
      } catch {
        onError(Error('Private learner review acknowledgement unavailable'));
      }
    })
  );
  return jobs.rows.length;
};
