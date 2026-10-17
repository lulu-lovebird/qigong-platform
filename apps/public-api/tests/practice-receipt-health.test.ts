import { describe, expect, it } from 'vitest';
import {
  createReceiptProgress,
  updateReceiptProgress,
  receiptProgressSnapshot,
  receiptObservationSchema,
  evaluateReceiptHealth,
  advanceReceiptAlerts,
  type ReceiptObservation
} from '../src/practice-receipt-health.js';

type Observed = Extract<ReceiptObservation, { kind: 'observed' }>;
const healthy = (now = 1000000): Observed => ({
  kind: 'observed',
  observedAtMs: now,
  windowStartMs: 0,
  service: {
    active: true,
    restarts: 0,
    uptimeMs: 500000,
    heartbeatAgeMs: 1000,
    lanes: receiptProgressSnapshot(
      updateReceiptProgress(
        updateReceiptProgress(
          createReceiptProgress(true),
          { kind: 'poll', channel: 'line', claimed: 0, failures: 0, durationMs: 1 },
          499000
        ),
        { kind: 'poll', channel: 'telegram', claimed: 0, failures: 0, durationMs: 1 },
        499000
      ),
      500000
    )
  },
  queues: ['line', 'telegram'].map((channel) => ({
    channel: channel === 'line' ? 'line' : 'telegram',
    pending: 0,
    due: 0,
    sending: 0,
    failed: 0,
    expiredLeases: 0,
    retrying: 0,
    oldestDueAgeMs: null,
    oldestOutstandingAgeMs: null,
    deliverySamples: 0,
    p50Ms: null,
    p95Ms: null,
    maxMs: null,
    clockAnomalies: 0
  }))
});
describe('Privacy-safe receipt progress and health', () => {
  it('distinguishes an idle successful poll from an unstarted or hung lane', () => {
    const initial = createReceiptProgress(true);
    expect(receiptProgressSnapshot(initial, 1000).line?.lastSuccessfulPollAgeMs).toBeNull();
    const next = updateReceiptProgress(
      initial,
      { kind: 'poll', channel: 'line', claimed: 0, failures: 0, durationMs: 1 },
      1000
    );
    expect(receiptProgressSnapshot(next, 1010).line?.lastSuccessfulPollAgeMs).toBe(10);
    expect(initial.line?.lastSuccessfulPollMs).toBeNull();
    const snapshot = healthy();
    snapshot.service.lanes.line = receiptProgressSnapshot(initial, 500000).line;
    expect(evaluateReceiptHealth(snapshot)).toContainEqual({
      code: 'poll_stalled',
      channel: 'line',
      severity: 'critical',
      holdMs: 0
    });
  });
  it('counts failures without treating a completed failed batch as successful work', () => {
    let state = updateReceiptProgress(
      createReceiptProgress(true),
      { kind: 'batch', channel: 'line', claimed: 3, failures: 2, durationMs: 1 },
      100
    );
    state = updateReceiptProgress(state, { kind: 'error', channel: 'line' }, 200);
    expect(receiptProgressSnapshot(state, 300).line).toMatchObject({
      lastCompletedPollAgeMs: 200,
      lastSuccessfulPollAgeMs: null,
      lastErrorAgeMs: 100,
      consecutiveErrors: 2,
      errorSignals: 3
    });
    state = updateReceiptProgress(
      state,
      { kind: 'poll', channel: 'line', claimed: 0, failures: 0, durationMs: 1 },
      300
    );
    expect(receiptProgressSnapshot(state, 300).line).toMatchObject({
      consecutiveErrors: 0,
      errorSignals: 3,
      lastSuccessfulPollAgeMs: 0
    });
  });
  it('keeps channels independent and records schema mismatch as a sticky failure', () => {
    const state = updateReceiptProgress(
      createReceiptProgress(true),
      { kind: 'schema_mismatch', channel: 'line' },
      100
    );
    expect(state.line?.schemaMismatch).toBe(true);
    expect(state.telegram?.schemaMismatch).toBe(false);
    expect(createReceiptProgress(false).line).toBeNull();
  });
  it('does not invent latency from zero samples or alarm on one slow observation', () => {
    const empty = healthy();
    expect(evaluateReceiptHealth(empty)).toEqual([]);
    const one = healthy();
    one.queues[0] = {
      ...one.queues[0]!,
      deliverySamples: 1,
      p50Ms: 60000,
      p95Ms: 60000,
      maxMs: 60000
    };
    expect(evaluateReceiptHealth(one)).toEqual([]);
    one.queues[0].deliverySamples = 20;
    expect(evaluateReceiptHealth(one).map((c) => c.code)).toContain('delivery_latency');
  });
  it('includes heartbeat age when deciding whether progress is stale', () => {
    const snapshot = healthy();
    snapshot.service.heartbeatAgeMs = 70000;
    snapshot.service.lanes.line!.lastSuccessfulPollAgeMs = 50000;
    expect(evaluateReceiptHealth(snapshot).map((c) => c.code)).toContain('poll_stalled');
  });
  it('distinguishes deployment startup grace from missing or stale heartbeat/progress', () => {
    const snapshot = healthy();
    snapshot.service = {
      ...snapshot.service,
      uptimeMs: 5000,
      heartbeatAgeMs: null,
      lanes: { line: null, telegram: null }
    };
    expect(evaluateReceiptHealth(snapshot)).toEqual([]);
    snapshot.service.uptimeMs = 120000;
    expect(evaluateReceiptHealth(snapshot).map((c) => c.code)).toEqual([
      'heartbeat_stale',
      'progress_missing',
      'progress_missing'
    ]);
  });
  it('does not hide retry backlog when retry backoff means nothing is due yet', () => {
    const snapshot = healthy();
    snapshot.queues[0] = {
      ...snapshot.queues[0]!,
      pending: 2,
      retrying: 2,
      oldestOutstandingAgeMs: 300000
    };
    expect(evaluateReceiptHealth(snapshot).map((c) => c.code)).toContain('outstanding_backlog');
  });
  it('fails closed for inconsistent counts, missing channels, future windows and nonfinite metrics', () => {
    const snapshot = healthy();
    snapshot.queues[0]!.due = 1;
    expect(() => evaluateReceiptHealth(snapshot)).toThrow();
    expect(receiptObservationSchema.safeParse({ ...healthy(), queues: [] }).success).toBe(false);
    expect(
      receiptObservationSchema.safeParse({ ...healthy(), windowStartMs: 2000000 }).success
    ).toBe(false);
    expect(receiptObservationSchema.safeParse({ ...healthy(), observedAtMs: NaN }).success).toBe(
      false
    );
  });
  it('projects only allowlisted telemetry, not arbitrary provider or personal payloads', () => {
    const value = receiptObservationSchema.parse({
      ...healthy(),
      recipient: 'PRIVATE',
      payload: 'PRIVATE'
    });
    expect(JSON.stringify(value)).not.toContain('PRIVATE');
  });
});
describe('Stateful alert confirmation, deduplication and recovery', () => {
  const backlog = (now = 1000000, age = 20000) => {
    const snapshot = healthy(now);
    snapshot.queues[0] = {
      ...snapshot.queues[0]!,
      pending: 1,
      due: 1,
      oldestDueAgeMs: age,
      oldestOutstandingAgeMs: age
    };
    return snapshot;
  };
  it('requires sustained warning observations, suppresses repeats and emits recovery once', () => {
    const first = advanceReceiptAlerts(backlog(), null);
    expect(first.status).toBe('pending');
    expect(first.events).toEqual([]);
    const second = advanceReceiptAlerts(backlog(1030000), first.state);
    expect(second.status).toBe('warning');
    expect(second.events).toEqual([
      { kind: 'opened', code: 'due_backlog', channel: 'line', severity: 'warning' }
    ]);
    const third = advanceReceiptAlerts(backlog(1060000), second.state);
    expect(third.events).toEqual([]);
    const recovered = advanceReceiptAlerts(healthy(1090000), third.state);
    expect(recovered.events[0]?.kind).toBe('recovered');
    expect(advanceReceiptAlerts(healthy(1120000), recovered.state).events).toEqual([]);
  });
  it('escalates a confirmed warning immediately when the due backlog becomes critical', () => {
    const first = advanceReceiptAlerts(backlog(), null);
    const warned = advanceReceiptAlerts(backlog(1030000), first.state);
    const critical = advanceReceiptAlerts(backlog(1060000, 60000), warned.state);
    expect(critical.events[0]).toMatchObject({ kind: 'escalated', severity: 'critical' });
  });
  it('does not claim recovery when collection fails, and announces collection failure once', () => {
    const first = advanceReceiptAlerts(backlog(1000000, 60000), null);
    const failed = advanceReceiptAlerts(
      { kind: 'unavailable', observedAtMs: 1030000 },
      first.state
    );
    expect(failed.status).toBe('unknown');
    expect(failed.events.map((e) => e.kind)).toEqual(['opened']);
    expect(failed.state.entries).toHaveLength(2);
    const again = advanceReceiptAlerts(
      { kind: 'unavailable', observedAtMs: 1060000 },
      failed.state
    );
    expect(again.events).toEqual([]);
    expect(
      advanceReceiptAlerts(healthy(1090000), again.state).events.filter(
        (e) => e.kind === 'recovered'
      )
    ).toHaveLength(2);
  });
  it('does not confirm a pending warning across failed collection or call startup healthy/recovered without progress proof', () => {
    const pending = advanceReceiptAlerts(backlog(), null);
    const lost = advanceReceiptAlerts(
      { kind: 'unavailable', observedAtMs: 1030000 },
      pending.state
    );
    expect(lost.state.entries.some((entry) => entry.code === 'due_backlog')).toBe(false);
    expect(
      advanceReceiptAlerts(backlog(1060000), lost.state).events.some(
        (event) => event.code === 'due_backlog'
      )
    ).toBe(false);
    const stalled = healthy();
    stalled.service.lanes.line!.lastSuccessfulPollAgeMs = 120000;
    const alert = advanceReceiptAlerts(stalled, null);
    const restarting = healthy(1030000);
    restarting.service = {
      ...restarting.service,
      uptimeMs: 5000,
      heartbeatAgeMs: null,
      lanes: { line: null, telegram: null }
    };
    expect(advanceReceiptAlerts(restarting, null).status).toBe('pending');
    const notRecovered = advanceReceiptAlerts(restarting, alert.state);
    expect(notRecovered.events).toEqual([]);
    expect(notRecovered.status).toBe('critical');
    expect(advanceReceiptAlerts(healthy(1060000), notRecovered.state).events[0]).toMatchObject({
      kind: 'recovered',
      code: 'poll_stalled'
    });
  });
  it('does not treat sparse samples or a backwards clock as continuous warning evidence', () => {
    const first = advanceReceiptAlerts(backlog(), null);
    expect(advanceReceiptAlerts(backlog(1200000), first.state).events).toEqual([]);
    expect(() => advanceReceiptAlerts(healthy(999999), first.state)).toThrow('backwards');
  });
  it('detects inactive service, expired lease, schema mismatch, failed receipts and clock anomalies independently', () => {
    const snapshot = healthy();
    snapshot.service.lanes.line!.schemaMismatch = true;
    snapshot.service.lanes.telegram!.consecutiveErrors = 3;
    snapshot.queues[0] = {
      ...snapshot.queues[0]!,
      failed: 1,
      sending: 1,
      expiredLeases: 1,
      oldestOutstandingAgeMs: 100,
      clockAnomalies: 1
    };
    expect(evaluateReceiptHealth(snapshot).map((c) => c.code)).toEqual([
      'schema_mismatch',
      'consecutive_errors',
      'clock_anomaly',
      'failed_receipts',
      'expired_leases'
    ]);
    snapshot.service.active = false;
    expect(evaluateReceiptHealth(snapshot).map((c) => c.code)).toContain('service_inactive');
  });
});
