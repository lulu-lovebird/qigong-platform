import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPracticeReceiptWorker } from '../src/practice-receipt-worker.js';
import * as runtime from '../src/practice-receipt-runtime.js';
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('Explicit near-real-time worker entry point', () => {
  it.each([undefined, 'false'])(
    'does not connect or require provider credentials when enabled=%s',
    async (value) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await runPracticeReceiptWorker(value ? { PRACTICE_RECEIPTS_REALTIME_ENABLED: value } : {});
      expect(log).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({ event: 'practice_receipt_worker_disabled' })
      );
    }
  );
  it('does not echo disabled credentials or attempt to parse them', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runPracticeReceiptWorker({
      PRACTICE_RECEIPTS_REALTIME_ENABLED: 'false',
      TELEGRAM_ONBOARDING_BOT_TOKEN: 'synthetic-private-value'
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-private-value');
  });
  it('rejects a loose activation flag before installing signals or creating a pool', async () => {
    const count = process.listenerCount('SIGTERM');
    await expect(
      runPracticeReceiptWorker({ PRACTICE_RECEIPTS_REALTIME_ENABLED: 'yes' })
    ).rejects.toThrow();
    expect(process.listenerCount('SIGTERM')).toBe(count);
  });
  it('reports per-lane idle progress on bounded heartbeats without per-poll logs and cleans up timers/signals', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const signals = process.listenerCount('SIGTERM');
    vi.spyOn(runtime, 'runRealtimePracticeReceipts').mockImplementation(async (options) => {
      for (const channel of ['line', 'telegram'] as const) {
        for (let n = 0; n < 100; n++)
          options.report({ kind: 'poll', channel, claimed: 0, failures: 0, durationMs: 1 });
      }
      options.report({ kind: 'error', channel: 'line' });
      await vi.advanceTimersByTimeAsync(30000);
      return { schemaMismatch: false };
    });
    await runPracticeReceiptWorker({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://localhost:9/qigong_monitor_test',
      PRACTICE_RECEIPTS_REALTIME_ENABLED: 'true',
      TELEGRAM_ONBOARDING_BOT_TOKEN: '123456:' + 'a'.repeat(35),
      LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-no-provider-token'
    });
    const heartbeat = log.mock.calls.find(
      ([value]) => typeof value === 'string' && value.includes('practice_receipt_worker_heartbeat')
    )?.[0];
    expect(typeof heartbeat).toBe('string');
    const value: unknown = JSON.parse(String(heartbeat));
    expect(value).toMatchObject({
      event: 'practice_receipt_worker_heartbeat',
      lanes: {
        line: {
          consecutiveErrors: 1,
          errorSignals: 1,
          lastSuccessfulPollAgeMs: expect.any(Number)
        },
        telegram: {
          consecutiveErrors: 0,
          errorSignals: 0,
          lastSuccessfulPollAgeMs: expect.any(Number)
        }
      }
    });
    expect(log.mock.calls).toHaveLength(4);
    expect(JSON.stringify(log.mock.calls)).not.toContain('practice_receipt_poll');
    expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-no-provider-token');
    await vi.advanceTimersByTimeAsync(30000);
    expect(log.mock.calls).toHaveLength(4);
    expect(process.listenerCount('SIGTERM')).toBe(signals);
  });
  it('fails closed on incomplete enabled configuration without installing signals', async () => {
    const count = process.listenerCount('SIGTERM');
    await expect(
      runPracticeReceiptWorker({ PRACTICE_RECEIPTS_REALTIME_ENABLED: 'true' })
    ).rejects.toThrow();
    expect(process.listenerCount('SIGTERM')).toBe(count);
  });
});
