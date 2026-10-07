import { loadEnvironment } from '@qigong/config';
import { attachPoolErrorHandler, createPool } from '@qigong/database';
import { buildApp, checkStartupReadiness } from './app.js';
import { createAdminOidcProvider } from './oidc-provider.js';
import { z } from 'zod';
import { loadWhatsAppConfig } from './whatsapp-onboarding.js';

const environment = loadEnvironment();
const telegramValues = [
  process.env.TELEGRAM_ONBOARDING_BOT_TOKEN,
  process.env.TELEGRAM_ONBOARDING_WEBHOOK_SECRET
];
if (telegramValues.some(Boolean) && !telegramValues.every(Boolean)) {
  throw new Error('Telegram onboarding token and webhook secret must be configured together');
}
const telegramOnboarding = telegramValues.every(Boolean)
  ? z
      .object({
        botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]{35,}$/),
        webhookSecret: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
        regionCode: z.string().min(1)
      })
      .parse({
        botToken: process.env.TELEGRAM_ONBOARDING_BOT_TOKEN,
        webhookSecret: process.env.TELEGRAM_ONBOARDING_WEBHOOK_SECRET,
        regionCode: process.env.TELEGRAM_ONBOARDING_REGION_CODE
      })
  : undefined;
const lineValues = [
  process.env.LINE_CHANNEL_SECRET,
  process.env.LINE_CHANNEL_ACCESS_TOKEN,
  process.env.LINE_LOGIN_CHANNEL_ID,
  process.env.LINE_LIFF_ID
];
if (lineValues.some(Boolean) && !lineValues.every(Boolean))
  throw new Error(
    'LINE channel secret, access token, login channel ID and LIFF ID must be configured together'
  );
const line = lineValues.every(Boolean)
  ? z
      .object({
        channelSecret: z.string().min(16),
        channelAccessToken: z.string().min(20),
        loginChannelId: z.string().regex(/^\d+$/),
        liffId: z.string().regex(/^\d+-[A-Za-z0-9]+$/)
      })
      .parse({
        channelSecret: process.env.LINE_CHANNEL_SECRET,
        channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
        loginChannelId: process.env.LINE_LOGIN_CHANNEL_ID,
        liffId: process.env.LINE_LIFF_ID
      })
  : undefined;
const whatsapp = loadWhatsAppConfig(process.env);
const pool = createPool(environment);
let adminAuth: Awaited<ReturnType<typeof createAdminOidcProvider>>;
try {
  adminAuth = await createAdminOidcProvider();
} catch (error) {
  console.error('failed to initialize administrator OIDC provider', error);
  await pool.end();
  process.exit(1);
}
const app = buildApp({
  pool,
  adminAuth,
  ...(telegramOnboarding ? { telegramOnboarding } : {}),
  ...(line ? { line } : {}),
  ...(whatsapp ? { whatsapp } : {}),
  serviceVersion: process.env.SERVICE_VERSION || 'development'
});

attachPoolErrorHandler(pool, (error) => {
  app.log.error({ err: error }, 'idle PostgreSQL client error');
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal)
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'graceful shutdown failed');
        process.exit(1);
      });
  });
}

try {
  const readiness = await checkStartupReadiness(pool);
  if (!readiness.ready) throw new Error(`startup readiness failed: ${readiness.reason}`);
  await app.listen({ host: environment.HOST, port: environment.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'failed to start public API');
  await pool.end();
  process.exit(1);
}
