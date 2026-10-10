import { randomUUID } from 'node:crypto';
import { withRequestContext, type Pool } from '@qigong/database';
import { buildTelegramPracticeSummary } from './telegram-practice-receipts.js';
import { createWhatsAppTextSender, type WhatsAppTransport } from './whatsapp-client.js';
export type ChannelPracticeSender = (
  recipient: string,
  text: string,
  receiptId: string
) => Promise<void>;
export const createLinePracticeSender =
  (token: string): ChannelPracticeSender =>
  async (recipient, text, receiptId) => {
    try {
      const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
          'X-Line-Retry-Key': receiptId
        },
        body: JSON.stringify({ to: recipient, messages: [{ type: 'text', text }] }),
        signal: AbortSignal.timeout(10000)
      });
      if (
        !response.ok &&
        !(response.status === 409 && response.headers.get('x-line-accepted-request-id'))
      )
        throw new Error('LINE response not accepted');
    } catch {
      throw new Error('LINE practice delivery failed');
    }
  };
export const createWhatsAppPracticeSender =
  (config: WhatsAppTransport): ChannelPracticeSender =>
  async (recipient, text) => {
    try {
      await createWhatsAppTextSender(config)(recipient, text);
    } catch {
      throw new Error('WhatsApp practice delivery failed');
    }
  };
export const deliverChannelPracticeReceipts = async (
  pool: Pool,
  platform: 'line' | 'whatsapp',
  sender: ChannelPracticeSender,
  onError: (error: Error, id: string) => void,
  batchSize = 1
) => {
  const query = <Row extends Record<string, unknown>>(sql: string, values: unknown[]) =>
    withRequestContext(pool, 'qigong_worker_runtime', { requestId: randomUUID() }, (c) =>
      c.query<Row>(sql, values)
    );
  const claimed = await query<{
    id: string;
    lease_id: string;
    recipient: string;
    payload: unknown;
  }>('SELECT * FROM ops.claim_channel_practice_receipts($1,$2)', [platform, batchSize]);
  for (const receipt of claimed.rows) {
    let delivered = false;
    try {
      const allowed = await query<{ allowed: boolean }>(
        'SELECT ops.channel_practice_receipt_allowed($1,$2) allowed',
        [receipt.id, receipt.lease_id]
      );
      if (!allowed.rows[0]?.allowed) throw Error('Receipt unavailable');
      if (!(platform === 'line' ? /^U[0-9a-f]{32}$/ : /^[0-9]{1,20}$/).test(receipt.recipient))
        throw Error('Invalid recipient');
      await sender(receipt.recipient, buildTelegramPracticeSummary(receipt.payload), receipt.id);
      delivered = true;
    } catch {
      onError(new Error('Messaging practice delivery failed'), receipt.id);
    }
    const done = await query<{ accepted: boolean }>(
      'SELECT ops.finish_channel_practice_receipt($1,$2,$3) accepted',
      [receipt.id, receipt.lease_id, delivered]
    );
    if (!done.rows[0]?.accepted) onError(new Error('Messaging practice lease expired'), receipt.id);
  }
  return claimed.rows.length;
};
