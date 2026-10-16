import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';

export type ReceiptChannel = 'line' | 'telegram';
export const realtimeReceiptsEnabled = (value: string | undefined) =>
  z.enum(['true', 'false']).default('false').parse(value) === 'true';
export const receiptDispatchSettings = Object.freeze({
  pollMs: 1000,
  burstPauseMs: 25,
  batchSize: 3,
  maxBurstBatches: 10,
  maxErrorPauseMs: 30000
});
export interface ReceiptBatchResult {
  claimed: number;
  failures: number;
}
export type ReceiptDispatchEvent =
  | {
      kind: 'batch';
      channel: ReceiptChannel;
      claimed: number;
      failures: number;
      durationMs: number;
    }
  | { kind: 'error' | 'schema_mismatch'; channel: ReceiptChannel };
interface ReceiptLaneOptions {
  channel: ReceiptChannel;
  signal: AbortSignal;
  deliver: () => Promise<ReceiptBatchResult>;
  ready: () => Promise<boolean>;
  onSchemaMismatch: () => void;
  report: (event: ReceiptDispatchEvent) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
export const waitForReceiptPoll = async (milliseconds: number, signal: AbortSignal) => {
  try {
    await delay(milliseconds, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
};
// One in-flight batch per provider. Independent lanes prevent a slow LINE call blocking Telegram.
// Claims/eligibility/finish remain the existing restricted, committed-outbox functions.
export const runPracticeReceiptLane = async (options: ReceiptLaneOptions): Promise<void> => {
  const { channel, signal, deliver, ready, onSchemaMismatch, report } = options,
    wait = options.wait ?? waitForReceiptPoll;
  let burst = 0,
    errors = 0;
  while (!signal.aborted) {
    let pause: number = receiptDispatchSettings.pollMs;
    try {
      if (!(await ready())) {
        report({ kind: 'schema_mismatch', channel });
        onSchemaMismatch();
        return;
      }
      if (signal.aborted) return;
      const started = performance.now(),
        result = await deliver();
      if (
        !Number.isInteger(result.claimed) ||
        result.claimed < 0 ||
        result.claimed > receiptDispatchSettings.batchSize ||
        !Number.isInteger(result.failures) ||
        result.failures < 0
      )
        throw Error('Invalid receipt batch result');
      if (result.claimed)
        report({
          kind: 'batch',
          channel,
          claimed: result.claimed,
          failures: result.failures,
          durationMs: Math.round(performance.now() - started)
        });
      if (result.failures) {
        errors = Math.min(errors + 1, 6);
        burst = 0;
        pause = Math.min(receiptDispatchSettings.maxErrorPauseMs, 1000 * 2 ** (errors - 1));
      } else {
        errors = 0;
        if (
          result.claimed === receiptDispatchSettings.batchSize &&
          ++burst < receiptDispatchSettings.maxBurstBatches
        )
          pause = receiptDispatchSettings.burstPauseMs;
        else burst = 0;
      }
    } catch {
      if (signal.aborted) return;
      errors = Math.min(errors + 1, 6);
      burst = 0;
      pause = Math.min(receiptDispatchSettings.maxErrorPauseMs, 1000 * 2 ** (errors - 1));
      report({ kind: 'error', channel });
    }
    if (signal.aborted) return;
    await wait(pause, signal);
  }
};
