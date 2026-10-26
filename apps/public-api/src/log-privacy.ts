import type { FastifyBaseLogger, FastifyLogFn, LogLevel } from 'fastify';
import { types } from 'node:util';
import type { ReceiptDispatchEvent } from './practice-receipt-dispatcher.js';

const sqlStates = [
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '22001',
  '22P02',
  '23502',
  '23503',
  '23505',
  '23514',
  '40001',
  '40P01',
  '42501',
  '53300',
  '53400',
  '57P01',
  '57P02',
  '57P03'
] as const;
const networkCodes = [
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_STREAM_PREMATURE_CLOSE'
] as const;
const events = [
  'application',
  'request_started',
  'request_completed',
  'request_failed',
  'readiness_failed',
  'channel_invite_unavailable',
  'help_image_unavailable'
] as const;
const methods = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'TRACE',
  'CONNECT'
]);
const levelValues = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Infinity
} as const;
const isLevel = (value: unknown): value is LogLevel =>
  typeof value === 'string' && Object.hasOwn(levelValues, value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SqlState = (typeof sqlStates)[number];
type NetworkCode = (typeof networkCodes)[number];
type LogEvent = (typeof events)[number];
export type SafeLogError =
  | { readonly category: 'database'; readonly code: SqlState }
  | { readonly category: 'network'; readonly code: NetworkCode }
  | { readonly category: 'validation'; readonly code: 'FST_ERR_VALIDATION' }
  | { readonly category: 'internal' };
export interface SafeLogRecord {
  readonly event: LogEvent;
  readonly reqId?: string;
  readonly method?: string;
  readonly route?: string;
  readonly statusCode?: number;
  readonly responseTime?: number;
  readonly signal?: 'SIGINT' | 'SIGTERM';
  readonly err?: SafeLogError;
}

// Never traverse input, call toJSON/toString, or evaluate an accessor. Even proxy
// descriptor traps fail closed. Inherited fields (including polluted prototypes)
// are deliberately not diagnostic evidence.
export const ownLogValue = (input: unknown, key: string): unknown => {
  if (typeof input !== 'object' || input === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && 'value' in descriptor ? (descriptor.value as unknown) : undefined;
  } catch {
    return undefined;
  }
};

export const isLogRequestId = (input: unknown): input is string =>
  typeof input === 'string' && uuid.test(input);

export const sanitizeLogError = (input: unknown): SafeLogError => {
  const code = ownLogValue(input, 'code');
  const sqlState = sqlStates.find((allowed) => allowed === code);
  if (sqlState) return { category: 'database', code: sqlState };
  const networkCode = networkCodes.find((allowed) => allowed === code);
  if (networkCode) return { category: 'network', code: networkCode };
  if (code === 'FST_ERR_VALIDATION') return { category: 'validation', code };
  return { category: 'internal' };
};

// Runtime diagnostics deliberately have a separate allowlist from HTTP logs.
const runtimeEvents = [
  'api_entry_failed',
  'api_environment_failed',
  'api_channels_failed',
  'api_pool_failed',
  'api_oidc_failed',
  'api_invites_failed',
  'api_build_failed',
  'api_readiness_failed',
  'api_listen_failed',
  'api_idle_pool_failed',
  'api_shutdown_started',
  'api_close_failed',
  'api_pool_end_failed'
] as const;
export type RuntimeDiagnosticEvent = (typeof runtimeEvents)[number];
export interface RuntimeDiagnostic {
  readonly event: RuntimeDiagnosticEvent;
  readonly err?: unknown;
  readonly signal?: 'SIGINT' | 'SIGTERM';
}

// Called at the actual output boundary; even incorrectly typed callers cannot
// supply arbitrary events or pre-sanitized objects that bypass classification.
export const logRuntimeDiagnostic = (input: RuntimeDiagnostic): void => {
  const requestedEvent = ownLogValue(input, 'event');
  const event = runtimeEvents.find((allowed) => allowed === requestedEvent) ?? 'api_entry_failed';
  const signal = ownLogValue(input, 'signal');
  const record = {
    event,
    ...(event === 'api_shutdown_started'
      ? {}
      : { err: sanitizeLogError(ownLogValue(input, 'err')) }),
    ...(signal === 'SIGINT' || signal === 'SIGTERM' ? { signal } : {})
  };
  // Logging must not turn a contained startup/cleanup failure into an unhandled
  // rejection (e.g. a closed diagnostic stream). No raw-error fallback/retry.
  try {
    console.error(JSON.stringify(record));
  } catch {
    // The sink is unavailable; there is no safe secondary sink to retry.
  }
};

// Worker metrics are not HTTP events, and never accept arbitrary message/binding data.
const processedEvents = [
  'onboarding_notifications_processed',
  'telegram_practice_receipts_processed',
  'line_practice_receipts_processed',
  'telegram_reminders_processed',
  'review_notifications_processed',
  'practice_badges_reconciled'
] as const;
const workerFailures = [
  'notification_worker_entry_failed',
  'notification_worker_config_failed',
  'notification_worker_pool_failed',
  'notification_worker_database_error',
  'notification_worker_schema_failed',
  'notification_worker_lane_failed',
  'notification_worker_delivery_failed',
  'notification_worker_pool_end_failed',
  'practice_receipt_worker_failed',
  'practice_receipt_worker_database_error',
  'practice_receipt_worker_pool_end_failed',
  'practice_receipt_worker_report_invalid'
] as const;
const workerLanes = ['onboarding', 'telegram', 'line', 'reminders', 'review', 'badges'] as const;
export type WorkerFailureEvent = (typeof workerFailures)[number];
const boundedNumber = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;
const boundedCount = (value: unknown): value is number =>
  boundedNumber(value) && Number.isSafeInteger(value);

// Validate before updating progress as well as at the output boundary. No getters,
// inherited evidence, coercion, serialization hooks or arbitrary provider fields.
export const sanitizeReceiptDispatchEvent = (input: unknown): ReceiptDispatchEvent | undefined => {
  const kind = ownLogValue(input, 'kind');
  const channel = ownLogValue(input, 'channel');
  if (channel !== 'line' && channel !== 'telegram') return;
  if (kind === 'error' || kind === 'schema_mismatch') return { kind, channel };
  if (kind !== 'batch' && kind !== 'poll') return;
  const claimed = ownLogValue(input, 'claimed');
  const failures = ownLogValue(input, 'failures');
  const durationMs = ownLogValue(input, 'durationMs');
  if (
    !boundedCount(claimed) ||
    claimed > 3 ||
    !boundedCount(failures) ||
    // Both existing senders can report delivery failure AND lease rejection
    // for the same receipt. This counts error signals, not distinct receipts.
    failures > claimed * 2 ||
    !boundedNumber(durationMs) ||
    (kind === 'poll' ? claimed !== 0 : claimed === 0)
  )
    return;
  return { kind, channel, claimed, failures, durationMs };
};

const safeHeartbeatLane = (input: unknown) => {
  if (input === null) return null;
  const consecutiveErrors = ownLogValue(input, 'consecutiveErrors');
  const errorSignals = ownLogValue(input, 'errorSignals');
  const schemaMismatch = ownLogValue(input, 'schemaMismatch');
  const lastCompletedPollAgeMs = ownLogValue(input, 'lastCompletedPollAgeMs');
  const lastSuccessfulPollAgeMs = ownLogValue(input, 'lastSuccessfulPollAgeMs');
  const lastErrorAgeMs = ownLogValue(input, 'lastErrorAgeMs');
  if (
    !boundedCount(consecutiveErrors) ||
    !boundedCount(errorSignals) ||
    typeof schemaMismatch !== 'boolean' ||
    ![lastCompletedPollAgeMs, lastSuccessfulPollAgeMs, lastErrorAgeMs].every(
      (value) => value === null || boundedNumber(value)
    )
  )
    return null;
  return {
    lastCompletedPollAgeMs,
    lastSuccessfulPollAgeMs,
    lastErrorAgeMs,
    consecutiveErrors,
    errorSignals,
    schemaMismatch
  };
};

export const logWorkerDiagnostic = (input: unknown): void => {
  const requestedEvent = ownLogValue(input, 'event');
  let record: object;
  const failure = workerFailures.find((allowed) => allowed === requestedEvent);
  const processed = processedEvents.find((allowed) => allowed === requestedEvent);
  if (failure) {
    const requestedLane = ownLogValue(input, 'lane');
    const lane = workerLanes.find((allowed) => allowed === requestedLane);
    record = {
      event: failure,
      err: sanitizeLogError(ownLogValue(input, 'err')),
      ...(lane ? { lane } : {})
    };
  } else if (processed) {
    const count = ownLogValue(input, 'processed');
    record = { event: processed, ...(boundedCount(count) ? { processed: count } : {}) };
  } else if (requestedEvent === 'practice_receipt_worker_heartbeat') {
    const uptimeSeconds = ownLogValue(input, 'uptimeSeconds');
    const lanes = ownLogValue(input, 'lanes');
    record = {
      event: requestedEvent,
      ...(boundedCount(uptimeSeconds) ? { uptimeSeconds } : {}),
      lanes: {
        line: safeHeartbeatLane(ownLogValue(lanes, 'line')),
        telegram: safeHeartbeatLane(ownLogValue(lanes, 'telegram'))
      }
    };
  } else if (requestedEvent === 'practice_receipt_worker_started') {
    const pollMs = ownLogValue(input, 'pollMs');
    const batchSize = ownLogValue(input, 'batchSize');
    const lineEnabled = ownLogValue(input, 'lineEnabled');
    record = {
      event: requestedEvent,
      ...(boundedCount(pollMs) ? { pollMs } : {}),
      ...(boundedCount(batchSize) ? { batchSize } : {}),
      ...(typeof lineEnabled === 'boolean' ? { lineEnabled } : {})
    };
  } else if (
    requestedEvent === 'practice_receipt_worker_disabled' ||
    requestedEvent === 'practice_receipt_worker_stopped'
  ) {
    record = { event: requestedEvent };
  } else {
    const metric = sanitizeReceiptDispatchEvent(input);
    record =
      metric && requestedEvent === 'practice_receipt_' + metric.kind
        ? { event: requestedEvent, ...metric }
        : { event: 'practice_receipt_worker_report_invalid', err: { category: 'internal' } };
  }
  try {
    const text = JSON.stringify(record);
    if (failure || ownLogValue(record, 'event') === 'practice_receipt_worker_report_invalid')
      console.error(text);
    else console.log(text);
  } catch {
    // No raw-error fallback when the output stream is unavailable.
  }
};

export const classifyLogFailure = (input: unknown): string => {
  const safe = sanitizeLogError(input);
  return safe.category === 'internal' ? safe.category : `${safe.category}:${safe.code}`;
};

export const sanitizeLogRecord = (
  input: unknown,
  registeredRoutes: ReadonlySet<string>,
  message?: unknown,
  fallbackEvent: LogEvent = 'application'
): SafeLogRecord => {
  const requestedEvent = ownLogValue(input, 'event');
  const event =
    events.find((allowed) => allowed === requestedEvent) ??
    (message === 'incoming request'
      ? 'request_started'
      : message === 'request completed'
        ? 'request_completed'
        : message === 'request errored'
          ? 'request_failed'
          : fallbackEvent);
  const reqId = ownLogValue(input, 'reqId') ?? ownLogValue(input, 'requestId');
  const method = ownLogValue(input, 'method');
  const route = ownLogValue(input, 'route');
  const statusCode = ownLogValue(input, 'statusCode');
  const responseTime = ownLogValue(input, 'responseTime');
  const signal = ownLogValue(input, 'signal');
  const error = ownLogValue(input, 'err');
  // Native detection neither walks prototypes nor invokes proxy/getter hooks,
  // and recognizes empty Error/TypeError/AggregateError on supported Node versions.
  const directError = types.isNativeError(input);
  return {
    event,
    ...(isLogRequestId(reqId) ? { reqId } : {}),
    ...(typeof method === 'string' && methods.has(method) ? { method } : {}),
    ...(typeof route === 'string' && registeredRoutes.has(route) ? { route } : {}),
    ...(typeof statusCode === 'number' &&
    Number.isInteger(statusCode) &&
    statusCode >= 100 &&
    statusCode <= 599
      ? { statusCode }
      : {}),
    ...(typeof responseTime === 'number' &&
    Number.isFinite(responseTime) &&
    responseTime >= 0 &&
    responseTime <= Number.MAX_SAFE_INTEGER
      ? { responseTime }
      : {}),
    ...(signal === 'SIGINT' || signal === 'SIGTERM' ? { signal } : {}),
    ...(error !== undefined || directError
      ? { err: sanitizeLogError(error !== undefined ? error : input) }
      : {})
  };
};

// This is the boundary, not a serializer/redaction blacklist. Neither arbitrary
// fields/messages nor caller child bindings/serializers reach the sink. Only a
// validated level may be passed to a trusted sink child to lower its threshold.
// The sink is trusted infrastructure; callers must not use its raw reference.
export const createPrivacyLogger = (
  sink: FastifyBaseLogger,
  registeredRoutes: ReadonlySet<string>
): FastifyBaseLogger => {
  const sinkLevel = isLevel(sink.level) ? sink.level : 'info';
  const sinkForLevel = (level: LogLevel): FastifyBaseLogger =>
    levelValues[level] < levelValues[sinkLevel] ? sink.child({}, { level }) : sink;
  const wrap = (bindings: SafeLogRecord, initialLevel: LogLevel): FastifyBaseLogger => {
    let effectiveLevel = initialLevel;
    let target = sinkForLevel(initialLevel);
    const log =
      (level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'): FastifyLogFn =>
      (input: unknown, message?: unknown): void => {
        if (level === 'silent' || levelValues[level] < levelValues[effectiveLevel]) return;
        const safe = sanitizeLogRecord(input, registeredRoutes, message, bindings.event);
        target[level]({ ...bindings, ...safe }, safe.event);
      };
    return {
      get level() {
        return effectiveLevel;
      },
      set level(value: string) {
        if (isLevel(value)) {
          effectiveLevel = value;
          target = sinkForLevel(value);
        }
      },
      fatal: log('fatal'),
      error: log('error'),
      warn: log('warn'),
      info: log('info'),
      debug: log('debug'),
      trace: log('trace'),
      silent: log('silent'),
      child: (input, options) => {
        const level = ownLogValue(options, 'level');
        return wrap(
          { ...bindings, ...sanitizeLogRecord(input, registeredRoutes, undefined, bindings.event) },
          isLevel(level) ? level : effectiveLevel
        );
      }
    };
  };
  return wrap({ event: 'application' }, sinkLevel);
};
