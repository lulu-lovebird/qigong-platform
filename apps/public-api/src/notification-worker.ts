import { loadEnvironment } from '@qigong/config';
import { createPool } from '@qigong/database';
import { z } from 'zod';
import {
  createTelegramNotificationSender,
  deliverOnboardingNotifications
} from './onboarding-notifications.js';

const environment = loadEnvironment();
const token = z
  .string()
  .regex(/^\d+:[A-Za-z0-9_-]{35,}$/)
  .parse(process.env.TELEGRAM_ONBOARDING_BOT_TOKEN);
const pool = createPool(environment);
pool.on('error', (error) => console.error('notification worker database connection failed', error));

try {
  const processed = await deliverOnboardingNotifications(
    pool,
    createTelegramNotificationSender(token),
    (error, id) => console.error('onboarding notification delivery failed', { id, error })
  );
  console.log(JSON.stringify({ event: 'onboarding_notifications_processed', processed }));
} finally {
  await pool.end();
}
