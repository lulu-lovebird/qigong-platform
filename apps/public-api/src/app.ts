import Fastify, { type FastifyBaseLogger } from 'fastify';
import { isLocale, resolveLocale, learnerLocaleCookie } from './ui-localization.js';
import { localizeSystemLabels } from './system-label-localization.js';
import { adminLocaleCookie } from './admin-locale.js';
import { checkApiRuntimePreflight, getMigrationStatus, type Pool } from '@qigong/database';
import {
  registerAdminRoutes,
  type AdminAuthProvider,
  nfcMigrationVersion,
  nfcQuarantineMigrationVersion,
  isNfcEnabled,
  checkNfcFeatureReadiness,
  registerNfcFeature
} from './admin-auth.js';
import { registerExternalJournalRoutes } from './journal-routes.js';
import { registerLearnerPrivacyRoutes, isLearnerPrivacyError } from './learner-privacy-routes.js';
import {
  registerTelegramOnboarding,
  type TelegramOnboardingConfig
} from './telegram-onboarding.js';
import { registerLineOnboarding, type LineConfig } from './line-onboarding.js';
import { registerVenueEntry } from './venue-entry.js';
import { registerWhatsAppOnboarding, type WhatsAppConfig } from './whatsapp-onboarding.js';
import { registerLearnerHelpPages } from './learner-help-page.js';
import { registerFieldCheckinRoutes } from './field-checkin-routes.js';
import {
  registerVenueQrCheckinRoutes,
  validateVenueQrConfig,
  venueQrMigrationVersion,
  type VenueQrConfig
} from './venue-qr.js';

// LIFF primary redirects can contain both SDK credentials and private application fragments in the query.
export const apiLogRedaction = Object.freeze({
  paths: [
    'req.url',
    'req.body',
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers.x-line-access-token',
    'req.headers.x-whatsapp-csrf-token',
    'req.headers.x-telegram-init-data',
    'req.headers.x-telegram-bot-api-secret-token',
    'res.headers.set-cookie'
  ],
  censor: '[REDACTED]'
});

export const minimumMigrationVersion = '0042_activity_consecutive_drafts.sql';
// Exact QR schema compatibility does not enable QR or the old NFC routes.
export const maximumMigrationVersion = venueQrMigrationVersion;
const defaultOffMigrationVersions = new Set([
  minimumMigrationVersion,
  '0043_achievement_rule_versions.sql',
  '0044_achievement_publication_candidates.sql',
  '0045_versioned_achievement_runtime.sql',
  '0046_achievement_evaluation_and_readers.sql',
  '0047_channel_invitations.sql',
  nfcMigrationVersion,
  nfcQuarantineMigrationVersion,
  venueQrMigrationVersion
]);
const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AppDependencies {
  pool: Pool;
  logger?: FastifyBaseLogger | false;
  serviceVersion?: string;
  adminAuth?: AdminAuthProvider;
  telegramOnboarding?: TelegramOnboardingConfig;
  line?: LineConfig;
  whatsapp?: WhatsAppConfig;
  venueQr?: VenueQrConfig;
}

export const checkStartupReadiness = async (pool: Pool, venueQrEnabled = false) => {
  const status = await getMigrationStatus(
    pool,
    minimumMigrationVersion,
    maximumMigrationVersion,
    'qigong_api_runtime'
  );
  // Admit only the exact reviewed forward versions above the old compatibility range.
  // A disabled QR deployment can still run preview/daily practice after migration.
  const migration = {
    ...status,
    ready: venueQrEnabled
      ? status.ready && status.currentVersion === venueQrMigrationVersion
      : status.ready &&
        status.currentVersion !== null &&
        defaultOffMigrationVersions.has(status.currentVersion)
  };
  if (!migration.ready)
    return { ready: false as const, reason: 'schema_version_mismatch', migration };
  const runtime = await checkApiRuntimePreflight(pool);
  if (!runtime.ready)
    return { ready: false as const, reason: 'runtime_role_misconfigured', runtime };
  if (isNfcEnabled()) {
    const nfc = await checkNfcFeatureReadiness(pool);
    if (!nfc.ready) return { ready: false as const, reason: nfc.reason, migration, runtime };
  }
  return { ready: true as const, migration, runtime };
};

export const buildApp = ({
  pool,
  logger,
  serviceVersion = 'development',
  adminAuth,
  telegramOnboarding,
  line,
  whatsapp,
  venueQr
}: AppDependencies) => {
  const qr = venueQr ? validateVenueQrConfig(venueQr) : undefined;
  if (qr && !line) throw new Error('venue QR requires LINE configuration');
  const app = Fastify({
    logger:
      logger === false
        ? false
        : (logger ?? {
            level: process.env.LOG_LEVEL || 'info',
            redact: apiLogRedaction
          }),
    genReqId: (request) => {
      const incoming = request.headers['x-request-id'];
      return typeof incoming === 'string' && requestIdPattern.test(incoming)
        ? incoming
        : crypto.randomUUID();
    }
  });

  const defaultErrorHandler = app.errorHandler;
  app.setErrorHandler((error, request, reply) => {
    if (isLearnerPrivacyError(error))
      return reply.code(403).send({
        error:
          error instanceof Error && error.message === 'reflection consent required'
            ? 'reflection_consent_required'
            : 'privacy_acceptance_required'
      });
    return defaultErrorHandler.call(app, error, request, reply);
  });

  app.addHook('onSend', (request, reply, payload, done) => {
    void reply.header('x-request-id', request.id);
    const body = request.body;
    const requested =
      typeof body === 'object' && body !== null && 'locale' in body ? body.locale : undefined;
    const locale = isLocale(requested)
      ? requested
      : resolveLocale(
          request.query,
          request.headers.cookie,
          request.url.startsWith('/admin/') ? adminLocaleCookie : undefined
        );
    const query = request.query;
    const explicit =
      typeof query === 'object' && query !== null && 'lang' in query ? query.lang : undefined;
    if (isLocale(explicit) && String(reply.getHeader('content-type') ?? '').includes('text/html')) {
      const name = request.url.startsWith('/admin/') ? adminLocaleCookie : learnerLocaleCookie;
      const existing = reply.getHeader('set-cookie');
      const cookies = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
      if (!cookies.some((cookie) => cookie.startsWith(name + '='))) {
        const value = name + '=' + explicit + '; Path=/; Max-Age=31536000; Secure; SameSite=Lax';
        reply.header('set-cookie', cookies.length ? [...cookies, value] : value);
      }
    }
    if (
      locale === 'zh_CN' &&
      typeof payload === 'string' &&
      String(reply.getHeader('content-type') ?? '').includes('application/json')
    ) {
      try {
        const data: unknown = JSON.parse(payload);
        return done(null, JSON.stringify(localizeSystemLabels(locale, data)));
      } catch {
        return done(null, payload);
      }
    }
    done(null, payload);
  });

  app.get('/health/live', () => ({
    ok: true,
    service: 'qigong-public-api',
    version: serviceVersion
  }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      const readiness = await checkStartupReadiness(pool, qr?.enabled === true);
      if (!readiness.ready) return reply.code(503).send({ ok: false, ...readiness });
      return { ok: true, ...readiness };
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed');
      return reply.code(503).send({ ok: false, reason: 'database_unavailable' });
    }
  });

  registerVenueEntry(app, line?.liffId);
  registerLearnerHelpPages(app);
  registerLearnerPrivacyRoutes(app, pool);
  registerExternalJournalRoutes(app, pool);
  registerNfcFeature(app, pool, registerFieldCheckinRoutes);
  if (adminAuth) registerAdminRoutes(app, pool, adminAuth, line?.liffId, qr);
  if (telegramOnboarding) registerTelegramOnboarding(app, pool, telegramOnboarding);
  if (line) {
    registerLineOnboarding(app, pool, line, qr?.enabled === true);
    if (qr) registerVenueQrCheckinRoutes(app, pool, line, qr);
  }
  if (whatsapp) registerWhatsAppOnboarding(app, pool, whatsapp);

  return app;
};
