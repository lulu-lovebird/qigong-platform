import { z } from 'zod';
import type { ReceiptChannel, ReceiptDispatchEvent } from './practice-receipt-dispatcher.js';

interface LaneProgress {
  lastCompletedPollMs: number | null;
  lastSuccessfulPollMs: number | null;
  lastErrorMs: number | null;
  consecutiveErrors: number;
  errorSignals: number;
  schemaMismatch: boolean;
}
export type ReceiptProgress = Readonly<Record<ReceiptChannel, LaneProgress | null>>;
const newLane = (): LaneProgress => ({
  lastCompletedPollMs: null,
  lastSuccessfulPollMs: null,
  lastErrorMs: null,
  consecutiveErrors: 0,
  errorSignals: 0,
  schemaMismatch: false
});
export const createReceiptProgress = (lineEnabled: boolean): ReceiptProgress => ({
  line: lineEnabled ? newLane() : null,
  telegram: newLane()
});
export const updateReceiptProgress = (
  progress: ReceiptProgress,
  event: ReceiptDispatchEvent,
  uptimeMs: number
): ReceiptProgress => {
  const lane = progress[event.channel];
  if (!lane) return progress;
  const completed = event.kind === 'batch' || event.kind === 'poll';
  const failures = completed ? event.failures : 1;
  return {
    ...progress,
    [event.channel]: {
      lastCompletedPollMs: completed ? uptimeMs : lane.lastCompletedPollMs,
      lastSuccessfulPollMs: completed && !failures ? uptimeMs : lane.lastSuccessfulPollMs,
      lastErrorMs: failures ? uptimeMs : lane.lastErrorMs,
      consecutiveErrors: failures ? lane.consecutiveErrors + 1 : 0,
      errorSignals: lane.errorSignals + failures,
      schemaMismatch: lane.schemaMismatch || event.kind === 'schema_mismatch'
    }
  };
};
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const duration = z.number().finite().nonnegative();
const channel = z.enum(['line', 'telegram']);
const laneSnapshot = z.object({
  lastCompletedPollAgeMs: duration.nullable(),
  lastSuccessfulPollAgeMs: duration.nullable(),
  lastErrorAgeMs: duration.nullable(),
  consecutiveErrors: count,
  errorSignals: count,
  schemaMismatch: z.boolean()
});
export const receiptProgressSnapshot = (progress: ReceiptProgress, uptimeMs: number) => {
  const snapshot = (lane: LaneProgress | null): z.infer<typeof laneSnapshot> | null => {
    if (!lane) return null;
    const age = (value: number | null) =>
      value === null ? null : Math.max(0, Math.round(uptimeMs - value));
    return {
      lastCompletedPollAgeMs: age(lane.lastCompletedPollMs),
      lastSuccessfulPollAgeMs: age(lane.lastSuccessfulPollMs),
      lastErrorAgeMs: age(lane.lastErrorMs),
      consecutiveErrors: lane.consecutiveErrors,
      errorSignals: lane.errorSignals,
      schemaMismatch: lane.schemaMismatch
    };
  };
  return { line: snapshot(progress.line), telegram: snapshot(progress.telegram) };
};
export const receiptQueueSchema = z
  .object({
    channel,
    pending: count,
    due: count,
    sending: count,
    failed: count,
    expiredLeases: count,
    retrying: count,
    oldestDueAgeMs: duration.nullable(),
    oldestOutstandingAgeMs: duration.nullable(),
    deliverySamples: count,
    p50Ms: duration.nullable(),
    p95Ms: duration.nullable(),
    maxMs: duration.nullable(),
    clockAnomalies: count
  })
  .superRefine((value, context) => {
    if (
      value.due > value.pending ||
      value.expiredLeases > value.sending ||
      value.retrying > value.pending + value.sending ||
      (value.due === 0) !== (value.oldestDueAgeMs === null) ||
      (value.pending + value.sending === 0) !== (value.oldestOutstandingAgeMs === null) ||
      [value.p50Ms, value.p95Ms, value.maxMs].some(
        (v) => (value.deliverySamples === 0) !== (v === null)
      ) ||
      (value.p50Ms !== null &&
        value.p95Ms !== null &&
        value.maxMs !== null &&
        (value.p50Ms > value.p95Ms || value.p95Ms > value.maxMs))
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent queue aggregates' });
    }
  });
const observed = z
  .object({
    kind: z.literal('observed'),
    observedAtMs: count,
    windowStartMs: count,
    service: z.object({
      active: z.boolean(),
      restarts: count,
      uptimeMs: duration,
      heartbeatAgeMs: duration.nullable(),
      lanes: z.object({ line: laneSnapshot.nullable(), telegram: laneSnapshot.nullable() })
    }),
    queues: z.array(receiptQueueSchema).length(2)
  })
  .superRefine((value, context) => {
    if (
      value.windowStartMs > value.observedAtMs ||
      new Set(value.queues.map((q) => q.channel)).size !== 2
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid observation window' });
    }
  });
export const receiptObservationSchema = z.union([
  observed,
  z.object({ kind: z.literal('unavailable'), observedAtMs: count })
]);
export type ReceiptObservation = z.infer<typeof receiptObservationSchema>;
const severity = z.enum(['warning', 'critical']);
const code = z.enum([
  'collection_failed',
  'service_inactive',
  'heartbeat_stale',
  'progress_missing',
  'schema_mismatch',
  'poll_stalled',
  'consecutive_errors',
  'due_backlog',
  'outstanding_backlog',
  'failed_receipts',
  'expired_leases',
  'delivery_latency',
  'clock_anomaly'
]);
export interface ReceiptHealthCondition {
  code: z.infer<typeof code>;
  channel: ReceiptChannel | null;
  severity: z.infer<typeof severity>;
  holdMs: number;
}
export const evaluateReceiptHealth = (input: ReceiptObservation): ReceiptHealthCondition[] => {
  const snapshot = receiptObservationSchema.parse(input);
  const conditions: ReceiptHealthCondition[] = [];
  const add = (
    c: ReceiptHealthCondition['code'],
    level: ReceiptHealthCondition['severity'],
    target: ReceiptChannel | null = null,
    holdMs = 0
  ) => conditions.push({ code: c, severity: level, channel: target, holdMs });
  if (snapshot.kind === 'unavailable') {
    add('collection_failed', 'critical');
    return conditions;
  }
  const service = snapshot.service;
  if (!service.active) add('service_inactive', 'critical');
  else {
    if (
      (service.heartbeatAgeMs === null && service.uptimeMs >= 90000) ||
      (service.heartbeatAgeMs !== null && service.heartbeatAgeMs >= 90000)
    )
      add('heartbeat_stale', 'critical');
    for (const target of ['line', 'telegram'] as const) {
      const lane = service.lanes[target];
      if (!lane) {
        if (service.uptimeMs >= 120000) add('progress_missing', 'critical', target);
        continue;
      }
      // A lane's age in the heartbeat must include the time since that heartbeat.
      const age = (value: number | null) =>
        value === null ? service.uptimeMs : value + (service.heartbeatAgeMs ?? 0);
      if (lane.schemaMismatch) add('schema_mismatch', 'critical', target);
      if (age(lane.lastSuccessfulPollAgeMs) >= 120000) add('poll_stalled', 'critical', target);
      if (lane.consecutiveErrors >= 3) add('consecutive_errors', 'warning', target, 30000);
    }
  }
  for (const queue of snapshot.queues) {
    if (queue.clockAnomalies) add('clock_anomaly', 'critical', queue.channel);
    if (queue.failed) add('failed_receipts', 'critical', queue.channel);
    if (queue.expiredLeases) add('expired_leases', 'warning', queue.channel, 30000);
    if (queue.oldestDueAgeMs !== null && queue.oldestDueAgeMs >= 15000)
      add(
        'due_backlog',
        queue.oldestDueAgeMs >= 60000 ? 'critical' : 'warning',
        queue.channel,
        queue.oldestDueAgeMs >= 60000 ? 0 : 30000
      );
    if (queue.oldestOutstandingAgeMs !== null && queue.oldestOutstandingAgeMs >= 300000)
      add('outstanding_backlog', 'warning', queue.channel, 30000);
    // Small samples remain observations, not a statistically useful p95 alarm.
    if (queue.deliverySamples >= 20 && queue.p95Ms !== null && queue.p95Ms >= 5000)
      add('delivery_latency', queue.p95Ms >= 15000 ? 'critical' : 'warning', queue.channel, 30000);
  }
  return conditions;
};
const alertEntry = z.object({
  code,
  channel: channel.nullable(),
  severity,
  firstObservedAtMs: count,
  lastObservedAtMs: count,
  notifiedSeverity: severity.nullable()
});
export const receiptAlertStateSchema = z
  .object({
    version: z.literal(1),
    observedAtMs: count,
    entries: z.array(alertEntry).max(30)
  })
  .superRefine((state, context) => {
    const keys = new Set<string>();
    for (const entry of state.entries) {
      const key = `${entry.channel}:${entry.code}`;
      if (
        keys.has(key) ||
        entry.firstObservedAtMs > entry.lastObservedAtMs ||
        entry.lastObservedAtMs > state.observedAtMs
      )
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid alert history' });
      keys.add(key);
    }
  });
export type ReceiptAlertState = z.infer<typeof receiptAlertStateSchema>;
export interface ReceiptAlertEvent {
  kind: 'opened' | 'escalated' | 'recovered';
  code: ReceiptHealthCondition['code'];
  channel: ReceiptChannel | null;
  severity: ReceiptHealthCondition['severity'];
}
export const advanceReceiptAlerts = (
  input: ReceiptObservation,
  previous: ReceiptAlertState | null
) => {
  const snapshot = receiptObservationSchema.parse(input);
  const prior = previous === null ? null : receiptAlertStateSchema.parse(previous);
  if (prior && snapshot.observedAtMs < prior.observedAtMs)
    throw Error('Observation clock moved backwards');
  const key = (entry: Pick<ReceiptHealthCondition, 'code' | 'channel'>) =>
    `${entry.channel}:${entry.code}`;
  const conditions = evaluateReceiptHealth(snapshot);
  const warming =
    snapshot.kind === 'observed' && snapshot.service.active && snapshot.service.uptimeMs < 120000;
  const awaitingProof = (entry: Pick<ReceiptHealthCondition, 'code' | 'channel'>) => {
    if (!warming || snapshot.kind !== 'observed') return false;
    if (entry.code === 'heartbeat_stale') return snapshot.service.heartbeatAgeMs === null;
    return (
      entry.channel !== null &&
      ['progress_missing', 'poll_stalled', 'consecutive_errors', 'schema_mismatch'].includes(
        entry.code
      ) &&
      (snapshot.service.lanes[entry.channel]?.lastSuccessfulPollAgeMs ?? null) === null
    );
  };
  const starting =
    warming &&
    snapshot.kind === 'observed' &&
    (snapshot.service.heartbeatAgeMs === null ||
      (['line', 'telegram'] as const).some(
        (target) => snapshot.service.lanes[target]?.lastSuccessfulPollAgeMs == null
      ));
  const current = new Set(conditions.map(key));
  const events: ReceiptAlertEvent[] = [];
  const entries: ReceiptAlertState['entries'] = conditions.map((condition) => {
    const old = prior?.entries.find((entry) => key(entry) === key(condition));
    const continuous = old && snapshot.observedAtMs - old.lastObservedAtMs <= 90000;
    const firstObservedAtMs = continuous ? old.firstObservedAtMs : snapshot.observedAtMs;
    let notifiedSeverity = old?.notifiedSeverity ?? null;
    if (
      snapshot.observedAtMs - firstObservedAtMs >= condition.holdMs &&
      (notifiedSeverity === null ||
        (notifiedSeverity === 'warning' && condition.severity === 'critical'))
    ) {
      events.push({
        kind: notifiedSeverity ? 'escalated' : 'opened',
        code: condition.code,
        channel: condition.channel,
        severity: condition.severity
      });
      notifiedSeverity = condition.severity;
    }
    return {
      code: condition.code,
      channel: condition.channel,
      severity: condition.severity,
      firstObservedAtMs,
      lastObservedAtMs: snapshot.observedAtMs,
      notifiedSeverity
    };
  });
  for (const old of prior?.entries ?? []) {
    if (current.has(key(old))) continue;
    // A failed collection cannot prove that previous problems have recovered.
    if (snapshot.kind === 'unavailable' || awaitingProof(old)) {
      // Preserve confirmed alerts until fresh collection/progress proves recovery.
      // Broken observation cannot confirm a pending warning.
      if (old.notifiedSeverity) entries.push(old);
    } else if (old.notifiedSeverity)
      events.push({
        kind: 'recovered',
        code: old.code,
        channel: old.channel,
        severity: old.notifiedSeverity
      });
  }
  const state: ReceiptAlertState = { version: 1, observedAtMs: snapshot.observedAtMs, entries };
  const active = entries.filter((entry) => entry.notifiedSeverity !== null);
  const status =
    snapshot.kind === 'unavailable'
      ? 'unknown'
      : active.some((entry) => entry.notifiedSeverity === 'critical')
        ? 'critical'
        : active.length
          ? 'warning'
          : entries.length || starting
            ? 'pending'
            : 'healthy';
  return { state, events, status };
};
