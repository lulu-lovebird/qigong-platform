import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { createPool } from '@qigong/database';
import type { buildApp } from './app.js';
import { logRuntimeDiagnostic, type RuntimeDiagnosticEvent } from './log-privacy.js';

export const runPublicApi = async (
  source: NodeJS.ProcessEnv = process.env,
  exit: (code: 0 | 1) => void = (code) => process.exit(code)
): Promise<void> => {
  let phase: RuntimeDiagnosticEvent = 'api_environment_failed';
  let pool: ReturnType<typeof createPool> | undefined;
  let app: ReturnType<typeof buildApp> | undefined;
  let cleanup: Promise<boolean> | undefined;
  let stopping = false;
  let startupFailed = false;
  let shuttingDown: Promise<void> | undefined;
  let completeStartup: (() => void) | undefined;
  const startupFinished = new Promise<void>((resolve) => {
    completeStartup = resolve;
  });
  const close = (): Promise<boolean> => {
    cleanup ??= (async () => {
      let failed = false;
      try {
        await app?.close();
      } catch (err) {
        failed = true;
        logRuntimeDiagnostic({ event: 'api_close_failed', err });
      }
      try {
        await pool?.end();
      } catch (err) {
        failed = true;
        logRuntimeDiagnostic({ event: 'api_pool_end_failed', err });
      }
      return failed;
    })();
    return cleanup;
  };
  const shutdown = (signal?: 'SIGINT' | 'SIGTERM'): Promise<void> => {
    if (shuttingDown) return shuttingDown;
    stopping = true;
    if (signal) logRuntimeDiagnostic({ event: 'api_shutdown_started', signal });
    shuttingDown = (async () => {
      // Start cleanup immediately, but do not choose an exit code until an
      // in-flight readiness/listen operation has settled. Even cleanup that
      // finishes first must not hide a later startup rejection behind exit(0).
      const closing = close();
      await startupFinished;
      const cleanupFailed = await closing;
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
      exit(startupFailed || cleanupFailed ? 1 : 0);
    })();
    return shuttingDown;
  };
  // Keep both listeners installed through cleanup so repeated signals cannot
  // trigger default termination or race another close/end; remove before exit.
  const interrupt = () => {
    void shutdown('SIGINT');
  };
  const terminate = () => {
    void shutdown('SIGTERM');
  };
  try {
    // Defer application/configuration module evaluation into the same boundary
    // as startup. Importing this entrypoint must not initialize providers/pools
    // or evaluate app modules (including their file-backed assets).
    const { loadEnvironment } = await import('@qigong/config');
    const environment = loadEnvironment(source);
    phase = 'api_channels_failed';
    const { z } = await import('zod');
    const { loadWhatsAppConfig } = await import('./whatsapp-onboarding.js');
    const telegramValues = [
      source.TELEGRAM_ONBOARDING_BOT_TOKEN,
      source.TELEGRAM_ONBOARDING_WEBHOOK_SECRET
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
            botToken: source.TELEGRAM_ONBOARDING_BOT_TOKEN,
            webhookSecret: source.TELEGRAM_ONBOARDING_WEBHOOK_SECRET,
            regionCode: source.TELEGRAM_ONBOARDING_REGION_CODE
          })
      : undefined;
    const lineValues = [
      source.LINE_CHANNEL_SECRET,
      source.LINE_CHANNEL_ACCESS_TOKEN,
      source.LINE_LOGIN_CHANNEL_ID,
      source.LINE_LIFF_ID
    ];
    if (lineValues.some(Boolean) && !lineValues.every(Boolean)) {
      throw new Error(
        'LINE channel secret, access token, login channel ID and LIFF ID must be configured together'
      );
    }
    const line = lineValues.every(Boolean)
      ? z
          .object({
            channelSecret: z.string().min(16),
            channelAccessToken: z.string().min(20),
            loginChannelId: z.string().regex(/^\d+$/),
            liffId: z.string().regex(/^\d+-[A-Za-z0-9]+$/)
          })
          .parse({
            channelSecret: source.LINE_CHANNEL_SECRET,
            channelAccessToken: source.LINE_CHANNEL_ACCESS_TOKEN,
            loginChannelId: source.LINE_LOGIN_CHANNEL_ID,
            liffId: source.LINE_LIFF_ID
          })
      : undefined;
    const venueQrEnabled =
      z.enum(['true', 'false']).default('false').parse(source.VENUE_QR_CHECKIN_ENABLED) === 'true';
    const venueQr = venueQrEnabled
      ? { enabled: true as const, publicOrigin: z.url().parse(source.VENUE_QR_PUBLIC_ORIGIN) }
      : undefined;
    const venueFeature = (enabled: string | undefined, publicOrigin: string | undefined) =>
      z.enum(['true', 'false']).default('false').parse(enabled) === 'true'
        ? { enabled: true as const, publicOrigin: z.url().parse(publicOrigin) }
        : undefined;
    const history = venueFeature(source.VENUE_HISTORY_ENABLED, source.VENUE_HISTORY_PUBLIC_ORIGIN);
    const management = venueFeature(
      source.VENUE_MANAGEMENT_ENABLED,
      source.VENUE_MANAGEMENT_PUBLIC_ORIGIN
    );
    const people = venueFeature(source.VENUE_PEOPLE_ENABLED, source.VENUE_PEOPLE_PUBLIC_ORIGIN);
    const venueSuite = {
      ...(history ? { history } : {}),
      ...(management ? { management } : {}),
      ...(people ? { people } : {})
    };
    const whatsapp = loadWhatsAppConfig(source);
    phase = 'api_pool_failed';
    const { attachPoolErrorHandler, createPool } = await import('@qigong/database');
    pool = createPool(environment);
    // Register immediately: an idle pool error is safe even before app creation.
    attachPoolErrorHandler(pool, (err) => {
      logRuntimeDiagnostic({ event: 'api_idle_pool_failed', err });
    });
    phase = 'api_oidc_failed';
    const { createAdminOidcProvider } = await import('./oidc-provider.js');
    const adminAuth = await createAdminOidcProvider();
    phase = 'api_invites_failed';
    const { loadInviteTransports } = await import('./channel-invites.js');
    const inviteTransports = loadInviteTransports(source);
    phase = 'api_build_failed';
    const { buildApp, checkStartupReadiness } = await import('./app.js');
    app = buildApp({
      pool,
      adminAuth,
      ...(telegramOnboarding ? { telegramOnboarding } : {}),
      ...(line ? { line } : {}),
      ...(venueQr ? { venueQr } : {}),
      ...(Object.keys(venueSuite).length ? { venueSuite } : {}),
      ...(whatsapp ? { whatsapp } : {}),
      inviteTransports,
      serviceVersion: source.SERVICE_VERSION || 'development'
    });
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    phase = 'api_readiness_failed';
    const readiness = Object.keys(venueSuite).length
      ? await checkStartupReadiness(pool, venueQrEnabled, venueSuite)
      : await checkStartupReadiness(pool, venueQrEnabled);
    if (!readiness.ready) throw new Error('startup readiness failed');
    if (!stopping) {
      phase = 'api_listen_failed';
      await app.listen({ host: environment.HOST, port: environment.PORT });
    }
  } catch (err) {
    // One terminal flow owns cleanup/exit, whether a signal or failure came first.
    startupFailed = true;
    logRuntimeDiagnostic({ event: phase, err });
  } finally {
    completeStartup?.();
  }
  if (startupFailed) await shutdown();
  else if (shuttingDown) await shuttingDown;
};

// Import-safe and guarded: realpath itself may throw a path-bearing error.
export const main = async (entry: string | undefined = process.argv[1]): Promise<void> => {
  try {
    if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) await runPublicApi();
  } catch (err) {
    logRuntimeDiagnostic({ event: 'api_entry_failed', err });
    process.exitCode = 1;
  }
};
await main();
