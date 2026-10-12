import { randomUUID } from 'node:crypto';
import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
import type { LearnerLocale } from './learner-locale.js';
export const telegramReminderWorkerEnabled = (value: string | undefined) =>
  z.enum(['true', 'false']).default('false').parse(value) === 'true';
export type ReminderAction = 'read' | 'on' | 'off' | 'hour' | 'timezone' | 'preview';
export const parseTelegramReminder = (
  text: string
): { action: ReminderAction; value?: string } | null => {
  if (/^\/remindtest(?:@\w+)?\s*$/i.test(text)) return { action: 'preview' };
  const match = /^\/remind(?:@\w+)?(?:\s+(.*))?\s*$/i.exec(text);
  if (!match) return null;
  const value = match[1]?.trim() ?? '';
  if (!value) return { action: 'read' };
  if (/^(on|off)$/i.test(value)) return { action: value.toLowerCase() as 'on' | 'off' };
  if (/^\d{1,2}$/.test(value) && Number(value) <= 23) return { action: 'hour', value };
  const zone = /^tz\s+(\S+)$/i.exec(value);
  return zone ? { action: 'timezone', value: zone[1]! } : null;
};
export const telegramReminderHelp = (locale: LearnerLocale) =>
  locale === 'en'
    ? '🔔 Use /remind, /remind on, /remind off, /remind 21, /remind tz America/New_York or /remindtest.'
    : '🔔 可用 /remind、/remind on、/remind off、/remind 21、/remind tz Asia/Taipei 或 /remindtest。';
const settings = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  timezone: z.string(),
  revision: z.number().int(),
  previewQueued: z.boolean(),
  replayed: z.boolean()
});
export const handleTelegramReminder = async (
  pool: Pool,
  requestId: string,
  update: number,
  subject: string,
  locale: LearnerLocale,
  text: string
) => {
  const command = parseTelegramReminder(text);
  if (!command) return telegramReminderHelp(locale);
  try {
    const result = await withRequestContext(pool, 'qigong_api_runtime', { requestId }, (client) =>
      client.query<{ data: unknown }>(
        'SELECT platform.telegram_reminder_command($1,$2,$3,$4) data',
        [update, subject, command.action, command.value ?? null]
      )
    );
    const data = settings.parse(result.rows[0]?.data);
    if (data.replayed) return null;
    if (data.previewQueued)
      return locale === 'en'
        ? '🔔 Your reminder preview is queued. Delivery requires the reminder worker to be enabled.'
        : '🔔 本人提醒預覽已排入佇列，需提醒排程啟用才會發送。';
    const hour = String(data.hour).padStart(2, '0') + ':00';
    return (
      (locale === 'en'
        ? `🔔 Your check-in reminders\nStatus: ${data.enabled ? 'On' : 'Off'}\nTime: ${hour}\nTime zone: ${data.timezone}\nReminders are sent even after check-in.`
        : `🔔 你的打卡提醒設定\n狀態：${data.enabled ? '已開啟' : '已關閉'}\n時間：${hour}\n時區：${data.timezone}\n已打卡仍會提醒。`) +
      '\n\n' +
      telegramReminderHelp(locale)
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'reminder preview rate limited')
      return locale === 'en'
        ? 'Please wait five minutes before another preview.'
        : '請間隔五分鐘後再測試提醒。';
    if (error instanceof Error && error.message === 'invalid reminder timezone')
      return locale === 'en'
        ? 'Unknown IANA time zone. Use /remind tz America/New_York.'
        : '無效的 IANA 時區，請用 /remind tz Asia/Taipei。';
    if (error instanceof Error && error.message === 'reminder access unavailable')
      return locale === 'en'
        ? 'Reminders require an approved, active learner and current privacy acceptance.'
        : '提醒限已核准、有效且已完成必要隱私同意的學員。';
    throw new Error('Telegram reminder settings unavailable');
  }
};
export type TelegramReminderSender = (recipient: string, locale: LearnerLocale) => Promise<void>;
export const buildTelegramReminder = (locale: LearnerLocale) =>
  locale === 'en'
    ? '🔔 Time for qigong practice! Complete your check-in and keep your rhythm going.'
    : '🔔 氣功時間到了！記得完成打卡，守住你的練功節奏。';
export const createTelegramReminderSender =
  (token: string): TelegramReminderSender =>
  async (recipient, locale) => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: recipient,
          text: buildTelegramReminder(locale),
          link_preview_options: { is_disabled: true },
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: locale === 'en' ? '✅ Start check-in' : '✅ 開始打卡',
                  web_app: {
                    url: 'https://checkin.baiyinqigong.org/telegram/checkin?lang=' + locale
                  }
                }
              ]
            ]
          }
        }),
        signal: AbortSignal.timeout(5000)
      });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== 'object' || !('ok' in body) || body.ok !== true)
        throw Error('Unaccepted');
    } catch {
      throw Error('Telegram reminder delivery failed');
    }
  };
export const deliverTelegramReminders = async (
  pool: Pool,
  sender: TelegramReminderSender,
  onError: (error: Error, id: string) => void
) => {
  const query = <Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) =>
    withRequestContext(pool, 'qigong_worker_runtime', { requestId: randomUUID() }, (c) =>
      c.query<Row>(sql, values)
    );
  await query('SELECT ops.queue_telegram_reminders(100)');
  const jobs = await query<{ id: string; lease_id: string; recipient: string; locale: unknown }>(
    'SELECT * FROM ops.claim_telegram_reminders(25)'
  );
  const deliver = async (job: (typeof jobs.rows)[number]) => {
    let sent = false;
    try {
      const allowed = await query<{ allowed: boolean }>(
        'SELECT ops.telegram_reminder_allowed($1,$2) allowed',
        [job.id, job.lease_id]
      );
      if (!allowed.rows[0]?.allowed) throw Error('Unavailable');
      if (!/^\d{1,20}$/.test(job.recipient)) throw Error('Invalid recipient');
      await sender(job.recipient, z.enum(['zh_TW', 'en']).parse(job.locale));
      sent = true;
    } catch {
      onError(new Error('Telegram reminder delivery failed'), job.id);
    }
    const finish = await query<{ accepted: boolean }>(
      'SELECT ops.finish_telegram_reminder($1,$2,$3) accepted',
      [job.id, job.lease_id, sent]
    );
    if (!finish.rows[0]?.accepted)
      onError(new Error('Telegram reminder lease unavailable'), job.id);
  };
  for (let offset = 0; offset < jobs.rows.length; offset += 5)
    await Promise.all(jobs.rows.slice(offset, offset + 5).map(deliver));
  return jobs.rows.length;
};
