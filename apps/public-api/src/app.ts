import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyLoggerOptions,
  type FastifyReply
} from 'fastify';
import { STATUS_CODES } from 'node:http';
import { types } from 'node:util';
import { createPrivacyLogger, isLogRequestId, ownLogValue } from './log-privacy.js';
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
import { lookupManagedVenue } from './venue-management.js';
import { registerWhatsAppOnboarding, type WhatsAppConfig } from './whatsapp-onboarding.js';
import { registerLearnerHelpPages } from './learner-help-page.js';
import { registerFieldCheckinRoutes } from './field-checkin-routes.js';
import {
  registerVenueQrCheckinRoutes,
  validateVenueQrConfig,
  venueQrMigrationVersion,
  type VenueQrConfig
} from './venue-qr.js';
import type { InviteTransports } from './channel-invites.js';
import { registerVenueHistoryRoutes } from './venue-history.js';
import {
  checkVenueFeatureReadiness,
  validateVenueSuiteConfig,
  venueSuiteMigrationVersion,
  type VenueSuiteConfig,
  type VenueSuiteFeature
} from './venue-suite.js';

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
export const maximumMigrationVersion = venueSuiteMigrationVersion;
const defaultOffMigrationVersions = new Set([
  minimumMigrationVersion,
  '0043_achievement_rule_versions.sql',
  '0044_achievement_publication_candidates.sql',
  '0045_versioned_achievement_runtime.sql',
  '0046_achievement_evaluation_and_readers.sql',
  '0047_channel_invitations.sql',
  nfcMigrationVersion,
  nfcQuarantineMigrationVersion,
  venueQrMigrationVersion,
  venueSuiteMigrationVersion
]);
// HTTP error classes can inherit status/message data (unlike log diagnostics,
// which deliberately ignore prototypes). Preserve that compatibility without
// evaluating accessors, and bound traversal for hostile/cyclic proxy prototypes.
const unsafeErrorField = Symbol('unsafe error field');
const errorDataValue = (input: unknown, key: string): unknown => {
  let current = input;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor)
        return 'value' in descriptor ? (descriptor.value as unknown) : unsafeErrorField;
      current = Object.getPrototypeOf(current) as unknown;
    } catch {
      return unsafeErrorField;
    }
  }
  return current === null || typeof current !== 'object' ? undefined : unsafeErrorField;
};

const httpErrorStatus = (input: unknown): number | undefined =>
  typeof input === 'number' && Number.isInteger(input) && input >= 400 && input <= 599
    ? input
    : undefined;

// @fastify/error constructors inherit Error.prototype without creating native
// Error instances. Recognize only prototypes from Fastify's public constructor
// catalog, rather than accepting a forgeable generic-error brand on plain data.
const fastifyErrorPrototypes = new Set<object>(
  Object.values(Fastify.errorCodes).map((constructor) => constructor.prototype)
);
const isClientErrorInstance = (input: unknown): boolean => {
  if (types.isNativeError(input)) return true;
  let current = input;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    try {
      current = Object.getPrototypeOf(current) as unknown;
      if (typeof current === 'object' && current !== null && fastifyErrorPrototypes.has(current))
        return true;
    } catch {
      return false;
    }
  }
  return false;
};

const privacyErrorCode = (error: unknown) => {
  const message = errorDataValue(error, 'message');
  if (typeof message !== 'string') return undefined;
  if (!types.isNativeError(error)) return undefined;
  // Keep the existing consent classifier without letting it evaluate arbitrary
  // error.message accessors (or proxy get traps).
  if (!isLearnerPrivacyError(new Error(message))) return undefined;
  return message === 'reflection consent required'
    ? 'reflection_consent_required'
    : 'privacy_acceptance_required';
};

interface SafeErrorResponse {
  readonly statusCode: number;
  readonly payload: string;
  readonly retryAfter?: string | number;
}

const safeErrorResponse = (error: unknown, currentStatus: number): SafeErrorResponse => {
  const status = errorDataValue(error, 'status');
  const statusCode = errorDataValue(error, 'statusCode');
  const message = errorDataValue(error, 'message');
  const code = errorDataValue(error, 'code');
  const serialization = errorDataValue(error, 'serialization');
  const ambiguous = [status, statusCode, message, code, serialization].includes(unsafeErrorField);
  const consentCode = ambiguous ? undefined : privacyErrorCode(error);
  const explicitStatus = httpErrorStatus(status) ?? httpErrorStatus(statusCode);
  // A previously selected 4xx does not make an untagged internal exception a
  // client error. In particular, failed 4xx response serialization is a 500.
  const internalFailure =
    serialization !== undefined ||
    (types.isNativeError(error) && explicitStatus === undefined && consentCode === undefined);
  // Match the previous delegated handler's eventual scalar-status precedence,
  // but use the single resolved result for the response, message and log level.
  const finalStatus =
    ambiguous || internalFailure
      ? 500
      : consentCode
        ? 403
        : (explicitStatus ?? httpErrorStatus(currentStatus) ?? 500);
  const title = STATUS_CODES[finalStatus] ?? 'Error';
  const generic = finalStatus >= 500;
  const clientError = !generic && explicitStatus !== undefined && isClientErrorInstance(error);
  const clientCode =
    clientError &&
    ((typeof code === 'string' && code.length <= 128) ||
      typeof code === 'boolean' ||
      (typeof code === 'number' && Number.isFinite(code)))
      ? String(code)
      : undefined;
  const body = consentCode
    ? { error: consentCode }
    : {
        statusCode: finalStatus,
        ...(clientCode !== undefined ? { code: clientCode } : {}),
        error: title,
        message: generic
          ? 'Internal Server Error'
          : clientError && typeof message === 'string' && message.length <= 8192
            ? message
            : title
      };
  // Only Retry-After is required locally. Never pass original headers, inherited
  // fields, objects, arrays or coercion hooks to reply.headers()/Node's writer.
  const headers = ownLogValue(error, 'headers');
  const retryAfter = (() => {
    try {
      return Array.isArray(headers) ? undefined : ownLogValue(headers, 'retry-after');
    } catch {
      // Even Array.isArray throws on a revoked proxy. Headers are optional;
      // discard them without replacing the original failure/status/diagnostic.
      return undefined;
    }
  })();
  const validRetryAfter =
    (typeof retryAfter === 'number' && Number.isSafeInteger(retryAfter) && retryAfter >= 0) ||
    (typeof retryAfter === 'string' &&
      retryAfter.length <= 128 &&
      /^(?:[0-9]+|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT)$/.test(
        retryAfter
      ));
  return {
    statusCode: finalStatus,
    payload: JSON.stringify(body),
    ...(validRetryAfter ? { retryAfter } : {})
  };
};

interface AppDependencies {
  pool: Pool;
  logger?: FastifyBaseLogger | false;
  logStream?: FastifyLoggerOptions['stream'];
  serviceVersion?: string;
  adminAuth?: AdminAuthProvider;
  telegramOnboarding?: TelegramOnboardingConfig;
  line?: LineConfig;
  whatsapp?: WhatsAppConfig;
  venueQr?: VenueQrConfig;
  venueSuite?: VenueSuiteConfig;
  inviteTransports?: InviteTransports;
}

export const checkStartupReadiness = async (
  pool: Pool,
  venueQrEnabled = false,
  venueSuite: VenueSuiteConfig = {}
) => {
  const enabledFeatures = (Object.keys(venueSuite) as VenueSuiteFeature[]).filter(
    (feature) => venueSuite[feature]?.enabled === true
  );
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
    ready:
      status.ready &&
      (enabledFeatures.length > 0
        ? status.currentVersion === venueSuiteMigrationVersion
        : venueQrEnabled
          ? status.currentVersion === venueQrMigrationVersion ||
            status.currentVersion === venueSuiteMigrationVersion
          : status.currentVersion !== null &&
            defaultOffMigrationVersions.has(status.currentVersion))
  };
  if (!migration.ready)
    return { ready: false as const, reason: 'schema_version_mismatch', migration };
  const runtime = await checkApiRuntimePreflight(pool);
  if (!runtime.ready)
    return { ready: false as const, reason: 'runtime_role_misconfigured', runtime };
  for (const feature of enabledFeatures) {
    const capability = await checkVenueFeatureReadiness(pool, feature);
    if (!capability.ready)
      return { ready: false as const, reason: 'venue_feature_not_ready', capability };
  }
  if (isNfcEnabled()) {
    const nfc = await checkNfcFeatureReadiness(pool);
    if (!nfc.ready) return { ready: false as const, reason: nfc.reason, migration, runtime };
  }
  return { ready: true as const, migration, runtime };
};

export const buildApp = ({
  pool,
  logger,
  logStream,
  serviceVersion = 'development',
  adminAuth,
  telegramOnboarding,
  line,
  whatsapp,
  venueQr,
  venueSuite = {},
  inviteTransports = {}
}: AppDependencies) => {
  const qr = venueQr ? validateVenueQrConfig(venueQr) : undefined;
  const suite = validateVenueSuiteConfig(venueSuite);
  if (qr && !line) throw new Error('venue QR requires LINE configuration');
  if (suite.history && !line) throw new Error('venue history requires LINE configuration');
  if ((suite.management || suite.people) && !adminAuth)
    throw new Error('venue administration requires admin authentication');
  const enabledInviteTransports: InviteTransports = {
    ...(telegramOnboarding && inviteTransports.telegram
      ? { telegram: inviteTransports.telegram }
      : {}),
    ...(whatsapp && inviteTransports.whatsapp ? { whatsapp: inviteTransports.whatsapp } : {})
  };
  const registeredRoutes = new Set<string>();
  // Fastify has no public standalone logger constructor. Own this unlistened
  // helper explicitly and close it with the app; injected/disabled sinks need none.
  // Residual allocation: one helper instance (router/Avvio/server), never a socket.
  const loggerOwner =
    logger === undefined
      ? Fastify({
          logger: {
            level: process.env.LOG_LEVEL || 'info',
            redact: apiLogRedaction,
            ...(logStream ? { stream: logStream } : {})
          }
        })
      : undefined;
  const sink = logger === false ? undefined : (logger ?? loggerOwner?.log);
  // Replace lifecycle records with equivalent bounded events. Retain stream,
  // serializer and other framework diagnostics behind the same safe boundary.
  const incomingRequest: LogController['incomingRequest'] = (request, reply) => {
    request.log = request.log.child({ method: request.method, route: request.routeOptions.url });
    reply.log = request.log;
    request.log.info({ event: 'request_started' });
  };
  const requestCompleted: LogController['requestCompleted'] = (error, request, reply) => {
    request.log[error ? 'error' : 'info']({
      event: error ? 'request_failed' : 'request_completed',
      ...(error ? { err: error } : {}),
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime
    });
  };
  const app = Fastify({
    ...(sink ? { loggerInstance: createPrivacyLogger(sink, registeredRoutes) } : { logger: false }),
    logController: Object.assign(new LogController(), {
      incomingRequest,
      requestCompleted,
      // onError emits the equivalent request_failed; completion covers 404s.
      defaultErrorLog: () => {},
      routeNotFound: () => {}
    }),
    genReqId: (request) => {
      const incoming = request.headers['x-request-id'];
      return isLogRequestId(incoming) ? incoming : crypto.randomUUID();
    }
  });

  if (loggerOwner)
    app.addHook('onClose', async () => {
      await loggerOwner.close();
    });
  if (Object.keys(suite).length > 0)
    app.addHook('onReady', async () => {
      const readiness = await checkStartupReadiness(pool, qr?.enabled === true, suite);
      if (!readiness.ready) throw new Error('venue suite readiness failed');
    });
  const errorResponses = new WeakMap<FastifyReply, SafeErrorResponse>();
  app.addHook('onRoute', (route) => {
    registeredRoutes.add(route.url);
  });
  app.addHook('onError', (request, reply, error, done) => {
    const response = safeErrorResponse(error, reply.statusCode);
    errorResponses.set(reply, response);
    const { statusCode } = response;
    request.log[statusCode >= 500 ? 'error' : 'info']({
      event: 'request_failed',
      err: error,
      statusCode
    });
    done();
  });

  app.setErrorHandler((error, _request, reply) => {
    const response = errorResponses.get(reply) ?? safeErrorResponse(error, reply.statusCode);
    if (response.retryAfter !== undefined) reply.header('retry-after', response.retryAfter);
    // Intentional compatibility boundary: error bodies bypass route schemas and
    // custom reply serializers. Those may themselves throw sensitive errors; no
    // original Error/accessor/toJSON/non-Error payload reaches Fastify's fallback.
    // Genuine bounded scalar 4xx Error fields and exact consent mappings survive;
    // ambiguous accessors fail closed and non-Error 4xx bodies become generic.
    reply.serializer(() => response.payload);
    return reply
      .code(response.statusCode)
      .type('application/json; charset=utf-8')
      .send(response.payload);
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

  app.get('/health/ready', async (request, reply) => {
    try {
      await pool.query('SELECT 1');
      const readiness = await checkStartupReadiness(pool, qr?.enabled === true, suite);
      if (!readiness.ready) return reply.code(503).send({ ok: false, ...readiness });
      return { ok: true, ...readiness };
    } catch (error) {
      request.log.error({ event: 'readiness_failed', err: error, statusCode: 503 });
      return reply.code(503).send({ ok: false, reason: 'database_unavailable' });
    }
  });

  registerVenueEntry(
    app,
    line?.liffId,
    suite.management ? (requestId, code) => lookupManagedVenue(pool, requestId, code) : undefined
  );
  registerLearnerHelpPages(app);
  registerLearnerPrivacyRoutes(app, pool);
  registerExternalJournalRoutes(app, pool);
  registerNfcFeature(app, pool, registerFieldCheckinRoutes);
  if (adminAuth)
    registerAdminRoutes(app, pool, adminAuth, line?.liffId, enabledInviteTransports, qr, suite);
  if (telegramOnboarding)
    registerTelegramOnboarding(app, pool, telegramOnboarding, enabledInviteTransports.telegram);
  if (line) {
    registerLineOnboarding(app, pool, line, qr?.enabled === true, suite.history?.enabled === true);
    if (suite.history)
      registerVenueHistoryRoutes(app, pool, {
        publicOrigin: suite.history.publicOrigin,
        loginChannelId: line.loginChannelId,
        ...(line.verifyIdentity ? { verifyIdentity: line.verifyIdentity } : {})
      });
    if (qr) registerVenueQrCheckinRoutes(app, pool, line, qr);
  }
  if (whatsapp) registerWhatsAppOnboarding(app, pool, whatsapp, enabledInviteTransports.whatsapp);

  return app;
};
