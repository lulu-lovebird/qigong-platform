import { createHmac, randomUUID } from 'node:crypto';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
export const reviewNotificationsEnabled = (value: string | undefined) =>
  z.enum(['true', 'false']).default('false').parse(value) === 'true';
export const handleReviewNotificationBind = async (
  pool: Pool,
  requestId: string,
  text: string,
  subject: string,
  secret: string
) => {
  const match = /^\/admin_notify(?:@\w+)?\s+([A-Za-z0-9_-]{43})\s*$/.exec(text);
  if (!match) return '請從已登入後台的「我的通知設定」產生新綁定指令，不要使用別人轉傳的連結。';
  const token = match[1]!,
    digest = createHmac('sha256', secret)
      .update('review-bind:' + token + ':' + subject)
      .digest(),
    code = String(100000 + (digest.readUInt32BE(0) % 900000));
  const result = await withRequestContext(pool, 'qigong_api_runtime', { requestId }, (c) =>
    c.query<{ claimed: boolean }>(
      'SELECT platform.claim_review_notification_link($1,$2,$3) claimed',
      [token, subject, code]
    )
  );
  return result.rows[0]?.claimed
    ? '🔐 請回到你已登入的後台，輸入確認碼：' +
        code +
        '\n\n此步尚未完成綁定。請勿將確認碼交給其他人；若不是你本人發起，請不要確認。'
    : '綁定連結已失效或已由其他帳號使用，請回後台重新產生。';
};
const payloadSchema = z
  .object({
    allowed: z.literal(true),
    recipient: z.string().regex(/^[0-9]{1,20}$/),
    kind: z.enum(['admin', 'learner', 'test']),
    count: z.number().int().min(1).max(50),
    locale: z.enum(['zh_TW', 'en']),
    region: z.string().nullable()
  })
  .strict();
export type ReviewNotification = z.infer<typeof payloadSchema>;
export const buildReviewNotification = (data: ReviewNotification) => {
  const en = data.locale === 'en';
  return {
    title:
      data.kind === 'test'
        ? en
          ? '🔔 Reviewer notification test'
          : '🔔 審核通知測試'
        : data.kind === 'admin'
          ? en
            ? '🔔 New administrator application'
            : '🔔 有新的管理員申請待審核'
          : en
            ? '🔔 New learner application'
            : '🔔 有新的學員申請待審核',
    text:
      data.kind === 'test'
        ? en
          ? 'Your private notification channel is working.'
          : '你的私人通知管道已可使用。'
        : (data.region ? (en ? 'Region: ' : '地區：') + data.region + '\n' : '') +
          (en
            ? `${data.count} new pending application(s) you can review.`
            : `有 ${data.count} 筆新申請仍待你審核。`),
    url:
      'https://checkin.baiyinqigong.org' +
      (data.kind === 'learner'
        ? '/admin/applications'
        : data.kind === 'admin'
          ? '/admin/administrators'
          : '/admin/notifications'),
    button: en ? 'Open secure admin portal' : '開啟後台（需登入）'
  };
};
export type ReviewNotificationSender = (data: ReviewNotification) => Promise<void>;
export const createReviewNotificationSender =
  (token: string): ReviewNotificationSender =>
  async (data) => {
    const safe = payloadSchema.parse(data),
      message = buildReviewNotification(safe);
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: safe.recipient,
          text: message.title + '\n\n' + message.text,
          link_preview_options: { is_disabled: true },
          reply_markup: { inline_keyboard: [[{ text: message.button, url: message.url }]] }
        }),
        signal: AbortSignal.timeout(5000)
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== 'object' || !('ok' in body) || body.ok !== true)
        throw Error('Unaccepted');
    } catch {
      throw Error('Private reviewer notification delivery failed');
    }
  };
export const deliverReviewNotifications = async (
  pool: Pool,
  sender: ReviewNotificationSender,
  onError: (error: Error, id: string) => void
) => {
  const query = <Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) =>
    withRequestContext(pool, 'qigong_worker_runtime', { requestId: randomUUID() }, (c) =>
      c.query<Row>(sql, values)
    );
  await query('SELECT ops.queue_review_notifications(200)');
  const jobs = await query<{ id: string; lease_id: string }>(
    'SELECT * FROM ops.claim_review_notifications(5)'
  );
  await Promise.all(
    jobs.rows.map(async (job) => {
      let sent = false;
      try {
        const result = await query<{ data: unknown }>(
          'SELECT ops.review_notification_payload($1,$2) data',
          [job.id, job.lease_id]
        );
        const data = payloadSchema.safeParse(result.rows[0]?.data);
        if (!data.success) throw Error('Review or permission no longer available');
        await sender(data.data);
        sent = true;
      } catch {
        onError(new Error('Private reviewer notification delivery failed'), job.id);
      }
      const finish = await query<{ accepted: boolean }>(
        'SELECT ops.finish_review_notification($1,$2,$3) accepted',
        [job.id, job.lease_id, sent]
      );
      if (!finish.rows[0]?.accepted)
        onError(new Error('Reviewer notification lease unavailable'), job.id);
    })
  );
  return jobs.rows.length;
};
