import { randomUUID } from 'node:crypto';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';

const payloadSchema = z.object({
  date: z.iso.date(),
  action: z.enum(['regular', 'makeup', 'corrected']),
  locale: z.enum(['zh_TW', 'en']),
  methods: z.array(z.string()).min(1).max(30),
  currentStreak: z.number().int().nonnegative(),
  totalDays: z.number().int().nonnegative()
});
export type TelegramPracticeSummary = z.infer<typeof payloadSchema>;
export type TelegramPracticeSender = (recipient: string, text: string) => Promise<void>;
interface Receipt {
  id: string;
  lease_id: string;
  recipient: string;
  payload: unknown;
}
export const buildTelegramPracticeSummary = (input: unknown) => {
  // Explicit allow-list: even a corrupted payload cannot append private notes or feelings.
  const data = payloadSchema.parse(input),
    english = data.locale === 'en';
  const title = english
    ? {
        regular: '✅ Check-in saved',
        makeup: '✅ Makeup check-in saved',
        corrected: '✅ Check-in updated'
      }[data.action]
    : { regular: '✅ 打卡成功', makeup: '✅ 補登成功', corrected: '✅ 打卡已修改' }[data.action];
  const methods = data.methods
    .map((name) => [...name].slice(0, 55).join('') + ([...name].length > 55 ? '…' : ''))
    .join(english ? ', ' : '、');
  return [
    title,
    (english ? 'Practice date: ' : '練功日期：') + data.date,
    (english ? 'Practice methods: ' : '練習功法：') + methods,
    english
      ? `🔥 Current streak: ${data.currentStreak} days`
      : `🔥 連續打卡：${data.currentStreak} 天`,
    english ? `⭐ Total practice: ${data.totalDays} days` : `⭐ 總打卡天數：${data.totalDays} 天`
  ].join('\n');
};
export const createTelegramPracticeSender =
  (botToken: string): TelegramPracticeSender =>
  async (recipient, text) => {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: recipient,
          text,
          link_preview_options: { is_disabled: true }
        }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw new Error('Telegram HTTP failure');
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true)
        throw new Error('Telegram response not accepted');
    } catch {
      throw new Error('Telegram practice delivery failed');
    }
  };
export const deliverTelegramPracticeReceipts = async (
  pool: Pool,
  sender: TelegramPracticeSender,
  onError: (error: Error, id: string) => void,
  batchSize = 3
) => {
  const query = <Row extends Record<string, unknown>>(sql: string, values: unknown[]) =>
    withRequestContext(pool, 'qigong_worker_runtime', { requestId: randomUUID() }, (client) =>
      client.query<Row>(sql, values)
    );
  const claimed = await withRequestContext(
    pool,
    'qigong_worker_runtime',
    { requestId: randomUUID() },
    (client) =>
      client.query<Receipt>('SELECT * FROM ops.claim_telegram_practice_receipts($1)', [batchSize])
  );
  for (const receipt of claimed.rows) {
    let delivered = false;
    try {
      const allowed = await query<{ allowed: boolean }>(
        'SELECT ops.telegram_practice_receipt_allowed($1,$2) allowed',
        [receipt.id, receipt.lease_id]
      );
      if (!allowed.rows[0]?.allowed) throw new Error('Receipt unavailable');
      if (!/^[0-9]{1,20}$/.test(receipt.recipient)) throw new Error('Invalid recipient');
      await sender(receipt.recipient, buildTelegramPracticeSummary(receipt.payload));
      delivered = true;
    } catch {
      onError(new Error('Telegram practice delivery failed'), receipt.id);
    }
    const finished = await query<{ accepted: boolean }>(
      'SELECT ops.finish_telegram_practice_receipt($1,$2,$3) accepted',
      [receipt.id, receipt.lease_id, delivered]
    );
    if (!finished.rows[0]?.accepted)
      onError(new Error('Telegram practice lease expired'), receipt.id);
  }
  return claimed.rows.length;
};
