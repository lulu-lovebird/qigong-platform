import { randomUUID } from 'node:crypto';
import { withRequestContext, type Pool } from '@qigong/database';

export interface PendingNotification {
  id: string;
  lease_id: string;
  platform: string;
  external_subject_id: string;
  decision: 'approved' | 'rejected';
}

export type NotificationSender = (
  recipient: string,
  decision: PendingNotification['decision']
) => Promise<void>;

export const createTelegramNotificationSender =
  (botToken: string): NotificationSender =>
  async (recipient, decision) => {
    const text =
      decision === 'approved'
        ? '你的氣功小幫手加入申請已核准！現在可以私訊 @qigong_checkin_bot 輸入 /checkin 開始打卡。'
        : '你的氣功小幫手加入申請未獲核准；如需了解原因，請聯絡所在地區管理員。';
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

export const deliverOnboardingNotifications = async (
  pool: Pool,
  sendTelegram: NotificationSender,
  onError: (error: unknown, id: string) => void,
  batchSize = 10
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
      if (notification.platform !== 'telegram')
        throw new Error('Unsupported notification platform');
      await sendTelegram(notification.external_subject_id, notification.decision);
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
