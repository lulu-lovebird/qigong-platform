import { loadEnvironment } from '@qigong/config';
import { randomUUID } from 'node:crypto';
import { createPool, withRequestContext } from '@qigong/database';
import {
  createTelegramPracticeSender,
  deliverTelegramPracticeReceipts
} from './telegram-practice-receipts.js';
import { z } from 'zod';
import {
  createWhatsAppNotificationSender,
  loadWhatsAppNotificationConfig
} from './whatsapp-client.js';
import {
  createLineNotificationSender,
  createTelegramNotificationSender,
  deliverOnboardingNotifications
} from './onboarding-notifications.js';

const environment = loadEnvironment();
const token = z
  .string()
  .regex(/^\d+:[A-Za-z0-9_-]{35,}$/)
  .parse(process.env.TELEGRAM_ONBOARDING_BOT_TOKEN);
const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN
  ? z.string().min(20).parse(process.env.LINE_CHANNEL_ACCESS_TOKEN)
  : undefined;
const whatsapp = loadWhatsAppNotificationConfig(process.env);
const pool = createPool(environment);
pool.on('error', () => console.error('notification worker database connection failed'));

try {
  const schema = await withRequestContext(
    pool,
    'qigong_worker_runtime',
    { requestId: randomUUID() },
    (client) =>
      client.query<{ ready: boolean }>('SELECT ops.telegram_workspace_schema_ready() ready')
  );
  if (!schema.rows[0]?.ready) throw new Error('Notification worker schema mismatch');
  // Independent lanes, three sends each: worst-case transport time remains below
  // the existing 60s service budget. Never close the pool while another lane runs.
  const outcomes = await Promise.allSettled([
    deliverOnboardingNotifications(
      pool,
      createTelegramNotificationSender(token),
      (_error, id) => console.error('onboarding notification delivery failed', { id }),
      3,
      lineToken ? createLineNotificationSender(lineToken) : undefined,
      whatsapp ? createWhatsAppNotificationSender(whatsapp) : undefined
    ).then((processed) =>
      console.log(JSON.stringify({ event: 'onboarding_notifications_processed', processed }))
    ),
    deliverTelegramPracticeReceipts(
      pool,
      createTelegramPracticeSender(token),
      (_error, id) => console.error('Telegram practice receipt delivery failed', { id }),
      3
    ).then((processed) =>
      console.log(JSON.stringify({ event: 'telegram_practice_receipts_processed', processed }))
    ),
    withRequestContext(pool, 'qigong_worker_runtime', { requestId: randomUUID() }, (client) =>
      client.query<{ processed: number }>('SELECT ops.reconcile_practice_badges(20) processed')
    ).then((result) =>
      console.log(
        JSON.stringify({
          event: 'practice_badges_reconciled',
          processed: result.rows[0]?.processed ?? 0
        })
      )
    )
  ]);
  if (outcomes.some((outcome) => outcome.status === 'rejected')) {
    console.error('notification worker lane failed');
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
