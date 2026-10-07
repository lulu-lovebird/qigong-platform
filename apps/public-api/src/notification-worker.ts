import { loadEnvironment } from '@qigong/config';
import { createPool } from '@qigong/database';
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
pool.on('error', (error) => console.error('notification worker database connection failed', error));

try {
  const processed = await deliverOnboardingNotifications(
    pool,
    createTelegramNotificationSender(token),
    (error, id) => console.error('onboarding notification delivery failed', { id, error }),
    10,
    lineToken ? createLineNotificationSender(lineToken) : undefined,
    whatsapp ? createWhatsAppNotificationSender(whatsapp) : undefined
  );
  console.log(JSON.stringify({ event: 'onboarding_notifications_processed', processed }));
} finally {
  await pool.end();
}
