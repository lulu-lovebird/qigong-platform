import { localeSchema, uiText, uiTemplate } from './ui-localization.js';
import { randomUUID } from 'node:crypto';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import { badgeIcons, fallbackBadgeIcon } from './badge-icons.js';
import { legacyBadgeDisplayName } from './legacy-badge-names.js';

const payloadSchema = z.object({
  date: z.iso.date(),
  action: z.enum(['regular', 'makeup', 'corrected']),
  locale: localeSchema,
  methods: z.array(z.string()).min(1).max(30),
  currentStreak: z.number().int().nonnegative(),
  totalDays: z.number().int().nonnegative(),
  unlockedBadges: z
    .array(
      z
        .object({
          code: z.string().min(1).max(80),
          name: z.string().min(1),
          period: z.string().min(1).max(80),
          ruleVersion: z.number().int().positive().optional()
        })
        .passthrough()
    )
    .default([]),
  guidance: z
    .object({
      campaignTitle: z.string().optional(),
      title: z.string().nullable().optional(),
      content: z.string()
    })
    .optional()
});
export type TelegramPracticeSummary = z.infer<typeof payloadSchema>;
export type TelegramPracticeSender = (recipient: string, text: string) => Promise<void>;
interface Receipt {
  id: string;
  lease_id: string;
  recipient: string;
  payload: unknown;
}
const chatText = (text: string, maximum: number): string => {
  if (text.length <= maximum) return text;
  let result = '';
  for (const character of text) {
    if (result.length + character.length > maximum - 1) break;
    result += character;
  }
  return result + '…';
};
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
    : {
        regular: uiText(data.locale, '✅ 打卡成功'),
        makeup: uiText(data.locale, '✅ 補登成功'),
        corrected: uiText(data.locale, '✅ 打卡已修改')
      }[data.action];
  const methods = data.methods
    .map((name) => uiText(data.locale, name))
    .map((name) => [...name].slice(0, 55).join('') + ([...name].length > 55 ? '…' : ''))
    .join(english ? ', ' : '、');
  const baseLines = [
    title,
    (english ? 'Practice date: ' : uiText(data.locale, '練功日期：')) + data.date,
    (english ? 'Practice methods: ' : uiText(data.locale, '練習功法：')) + methods,
    english
      ? `🔥 Current streak: ${data.currentStreak} days`
      : uiTemplate(data.locale)`🔥 連續打卡：${data.currentStreak} 天`,
    english
      ? `⭐ Total practice: ${data.totalDays} days`
      : uiTemplate(data.locale)`⭐ 總打卡天數：${data.totalDays} 天`
  ];

  let message = chatText(baseLines.join('\n'), 3300);
  if (data.unlockedBadges.length) {
    message +=
      '\n' + (english ? '🎉 New achievements unlocked:' : uiText(data.locale, '🎉 新解鎖成就：'));
    let shown = 0;
    for (const badge of data.unlockedBadges) {
      const name = chatText(
        [...(legacyBadgeDisplayName(badge, data.locale) ?? badge.name)]
          .map((character) => {
            const point = character.codePointAt(0) ?? 0;
            return point < 32 || point === 127 || point === 0x2028 || point === 0x2029
              ? ' '
              : character;
          })
          .join(''),
        120
      );
      const period =
        badge.period === 'lifetime'
          ? ''
          : ' (' + badge.period + (!english && /^\d{4}$/.test(badge.period) ? '年' : '') + ')';
      const version = badge.ruleVersion && badge.ruleVersion > 1 ? ' · v' + badge.ruleVersion : '';
      const line = (badgeIcons[badge.code] ?? fallbackBadgeIcon) + ' ' + name + period + version;
      if (message.length + line.length + 1 + 120 > 4000) break;
      message += '\n' + line;
      shown++;
    }
    const remaining = data.unlockedBadges.length - shown;
    if (remaining)
      message +=
        '\n' +
        (english
          ? `${remaining} more — see My achievements.`
          : uiTemplate(data.locale)`其餘 ${remaining} 項請見「我的成就」。`);
  }
  if (data.guidance?.content) {
    const heading = data.guidance.title
      ? `💡【${chatText(data.guidance.title, 120)}】`
      : english
        ? '💡【Daily Guidance】'
        : uiText(data.locale, '💡【今日練功指引】');
    message += '\n' + ['--------------------------', heading, data.guidance.content].join('\n');
  }

  // Shared by Telegram (4096) and LIFF text (5000): UTF-16-safe conservative limit.
  return chatText(message, 4000);
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
