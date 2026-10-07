import { randomUUID } from 'node:crypto';
import { withRequestContext, type Pool } from '@qigong/database';
import { learnerLocale, learnerTexts, type LearnerLocale } from './learner-locale.js';

export interface PendingNotification {
  id: string;
  lease_id: string;
  platform: string;
  external_subject_id: string;
  decision: 'approved' | 'rejected';
}

export type NotificationSender = (
  recipient: string,
  decision: PendingNotification['decision'],
  locale?: LearnerLocale
) => Promise<void>;

export const createTelegramNotificationSender =
  (botToken: string): NotificationSender =>
  async (recipient, decision, locale = 'zh_TW') => {
    const texts = learnerTexts(locale);
    const text = decision === 'approved' ? texts.notificationApproved : texts.notificationRejected;
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: recipient, text }),
        signal: AbortSignal.timeout(10_000)
      });
    } catch {
      throw new Error('Telegram transport failed');
    }
    if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('ok' in body) || body.ok !== true) {
      throw new Error('Telegram response not accepted');
    }
  };

export const createLineNotificationSender =
  (channelAccessToken: string): NotificationSender =>
  async (recipient, decision) => {
    const text =
      decision === 'approved'
        ? '你的氣功小幫手加入申請已核准！請在 LINE 私聊輸入「打卡」開始練功打卡。若已有其它主要打卡管道，請繼續使用原管道。'
        : '你的氣功小幫手加入申請未獲核准；如需了解原因，請聯絡所在地區管理員。';
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${channelAccessToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ to: recipient, messages: [{ type: 'text', text }] }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`LINE HTTP ${response.status}`);
  };

export const deliverOnboardingNotifications = async (
  pool: Pool,
  sendTelegram: NotificationSender,
  onError: (error: unknown, id: string) => void,
  batchSize = 10,
  sendLine?: NotificationSender,
  sendWhatsApp?: NotificationSender
) => {
  const claim = await withRequestContext(
    pool,
    'qigong_worker_runtime',
    { requestId: randomUUID() },
    (client) =>
      client.query<PendingNotification>('SELECT * FROM ops.claim_onboarding_notifications($1)', [
        batchSize
      ])
  );
  for (const notification of claim.rows) {
    let failure: string | null = null;
    try {
      if (notification.platform === 'telegram') {
        const preference = await withRequestContext(
          pool,
          'qigong_worker_runtime',
          { requestId: randomUUID() },
          (client) =>
            client.query<{ locale: string }>(
              "SELECT platform.get_identity_locale('telegram',$1) AS locale",
              [notification.external_subject_id]
            )
        );
        await sendTelegram(
          notification.external_subject_id,
          notification.decision,
          learnerLocale(preference.rows[0]?.locale)
        );
      } else if (notification.platform === 'line' && sendLine)
        await sendLine(notification.external_subject_id, notification.decision);
      else if (notification.platform === 'whatsapp' && sendWhatsApp) {
        const preference = await withRequestContext(
          pool,
          'qigong_worker_runtime',
          { requestId: randomUUID() },
          (client) =>
            client.query<{ locale: string; allowed: boolean }>(
              "SELECT platform.get_identity_locale('whatsapp',$1) AS locale, platform.whatsapp_notification_allowed($1) AS allowed",
              [notification.external_subject_id]
            )
        );
        if (!preference.rows[0]?.allowed)
          throw new Error('WhatsApp notification consent unavailable');
        await sendWhatsApp(
          notification.external_subject_id,
          notification.decision,
          learnerLocale(preference.rows[0]?.locale)
        );
      } else throw new Error('Unsupported notification platform');
    } catch (error) {
      failure = error instanceof Error ? error.message.slice(0, 200) : 'Delivery failed';
      onError(error, notification.id);
    }
    const finished = await withRequestContext(
      pool,
      'qigong_worker_runtime',
      { requestId: randomUUID() },
      (client) =>
        client.query<{ accepted: boolean }>(
          'SELECT ops.finish_onboarding_notification($1, $2, $3, $4) AS accepted',
          [notification.id, notification.lease_id, failure === null, failure]
        )
    );
    if (!finished.rows[0]?.accepted)
      onError(new Error('Notification lease expired'), notification.id);
  }
  return claim.rows.length;
};
