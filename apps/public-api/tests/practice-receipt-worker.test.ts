import type * as FileSystem from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReceiptDispatchEvent } from '../src/practice-receipt-dispatcher.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  pool: vi.fn(),
  fetch: vi.fn(() => {
    throw new Error('Unexpected synthetic transport call');
  }),
  end: vi.fn(),
  on: vi.fn(),
  telegram: vi.fn(),
  line: vi.fn(),
  realpath: vi.fn((path: string) => path)
}));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof FileSystem>()),
  realpathSync: mocks.realpath
}));
vi.mock('@qigong/database', () => ({ createPool: mocks.pool }));
vi.mock('../src/telegram-practice-receipts.js', () => ({
  createTelegramPracticeSender: mocks.telegram
}));
vi.mock('../src/channel-practice-receipts.js', () => ({ createLinePracticeSender: mocks.line }));
import { main, runPracticeReceiptWorker } from '../src/practice-receipt-worker.js';
import * as runtime from '../src/practice-receipt-runtime.js';
import * as config from '@qigong/config';
const initialCalls = mocks.pool.mock.calls.length;
const sentinel = 'synthetic-private-receipt@sentinel.invalid';
const failure = Object.assign(new Error(sentinel, { cause: new Error(sentinel) }), {
  code: 'ECONNRESET',
  query: sentinel,
  detail: sentinel
});
const hostile = new Proxy(
  {},
  {
    getOwnPropertyDescriptor() {
      throw failure;
    },
    get() {
      throw failure;
    }
  }
);
const enabled = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://synthetic.invalid/test',
  PRACTICE_RECEIPTS_REALTIME_ENABLED: 'true',
  TELEGRAM_ONBOARDING_BOT_TOKEN: '123456:' + 'a'.repeat(35)
};
const activePool = { on: mocks.on, end: mocks.end };
const captureLog = () => vi.spyOn(console, 'log').mockImplementation(() => {});
const captureError = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const captureOut = () => vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
const captureErr = () => vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
let log: ReturnType<typeof captureLog>, error: ReturnType<typeof captureError>;
let stdout: ReturnType<typeof captureOut>, stderr: ReturnType<typeof captureErr>;
let sigint: number, sigterm: number, exitCode: typeof process.exitCode;
const records = () =>
  log.mock.calls.map(([text]) => JSON.parse(String(text)) as { event: string; lanes?: unknown });
const errors = () =>
  error.mock.calls.map(
    ([text]) =>
      JSON.parse(String(text)) as { event: string; err: { category: string; code?: string } }
  );
beforeEach(() => {
  vi.clearAllMocks();
  exitCode = process.exitCode;
  process.exitCode = undefined;
  sigint = process.listenerCount('SIGINT');
  sigterm = process.listenerCount('SIGTERM');
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  log = captureLog();
  error = captureError();
  stdout = captureOut();
  stderr = captureErr();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.pool.mockReturnValue(activePool);
  mocks.on.mockReturnValue(activePool);
  mocks.end.mockResolvedValue(undefined);
  mocks.telegram.mockReturnValue(vi.fn());
  mocks.line.mockReturnValue(vi.fn());
  mocks.realpath.mockImplementation((path: string) => path);
});
afterEach(() => {
  expect(process.listenerCount('SIGINT')).toBe(sigint);
  expect(process.listenerCount('SIGTERM')).toBe(sigterm);
  expect(vi.getTimerCount()).toBe(0);
  expect(
    JSON.stringify([log.mock.calls, error.mock.calls, stdout.mock.calls, stderr.mock.calls])
  ).not.toContain(sentinel);
  expect(mocks.fetch).not.toHaveBeenCalled();
  process.exitCode = exitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('Explicit near-real-time worker entry point', () => {
  it('does not create a pool on import', () => {
    expect(initialCalls).toBe(0);
  });
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
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(mocks.telegram).not.toHaveBeenCalled();
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

  it('preserves sender and bounded pool configuration bindings, schema status, and heartbeat nulls', async () => {
    const load = vi.spyOn(config, 'loadEnvironment');
    vi.spyOn(runtime, 'runRealtimePracticeReceipts').mockImplementationOnce(async (options) => {
      expect(options.pool).toBe(activePool);
      expect(options.line).toBeUndefined();
      expect(options.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
      options.report({
        kind: 'batch',
        channel: 'telegram',
        claimed: 3,
        failures: 1,
        durationMs: 4
      });
      options.report({ kind: 'schema_mismatch', channel: 'telegram' });
      await vi.advanceTimersByTimeAsync(30000);
      return { schemaMismatch: true };
    });
    await runPracticeReceiptWorker({ ...enabled, DATABASE_POOL_MAX: '99' });
    expect(load).toHaveBeenCalledExactlyOnceWith({ ...enabled, DATABASE_POOL_MAX: '4' });
    expect(mocks.pool.mock.calls[0]?.[0]).toMatchObject({
      DATABASE_URL: enabled.DATABASE_URL,
      DATABASE_POOL_MAX: 4
    });
    expect(mocks.telegram).toHaveBeenCalledExactlyOnceWith(enabled.TELEGRAM_ONBOARDING_BOT_TOKEN);
    expect(mocks.line).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
    expect(records().map(({ event }) => event)).toEqual([
      'practice_receipt_worker_started',
      'practice_receipt_batch',
      'practice_receipt_schema_mismatch',
      'practice_receipt_worker_heartbeat',
      'practice_receipt_worker_stopped'
    ]);
    expect(
      records().find(({ event }) => event === 'practice_receipt_worker_heartbeat')
    ).toMatchObject({
      lanes: {
        line: null,
        telegram: {
          lastSuccessfulPollAgeMs: null,
          lastCompletedPollAgeMs: expect.any(Number),
          lastErrorAgeMs: expect.any(Number),
          consecutiveErrors: 2,
          errorSignals: 2,
          schemaMismatch: true
        }
      }
    });
  });

  it.each([
    { channel: 'telegram', claimed: 1 },
    { channel: 'telegram', claimed: 3 },
    { channel: 'line', claimed: 1 },
    { channel: 'line', claimed: 3 }
  ] as const)(
    'preserves delivery plus lease failures in $channel heartbeat for $claimed receipts',
    async ({ channel, claimed }) => {
      vi.spyOn(runtime, 'runRealtimePracticeReceipts').mockImplementationOnce(async (options) => {
        options.report({ kind: 'batch', channel, claimed, failures: claimed * 2, durationMs: 1 });
        await vi.advanceTimersByTimeAsync(30000);
        return { schemaMismatch: false };
      });
      await runPracticeReceiptWorker({
        ...enabled,
        LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-no-provider-token'
      });
      expect(records().map(({ event }) => event)).toEqual([
        'practice_receipt_worker_started',
        'practice_receipt_batch',
        'practice_receipt_worker_heartbeat',
        'practice_receipt_worker_stopped'
      ]);
      expect(records().find(({ event }) => event === 'practice_receipt_batch')).toEqual({
        event: 'practice_receipt_batch',
        kind: 'batch',
        channel,
        claimed,
        failures: claimed * 2,
        durationMs: 1
      });
      expect(
        records().find(({ event }) => event === 'practice_receipt_worker_heartbeat')
      ).toMatchObject({
        lanes: {
          [channel]: {
            lastCompletedPollAgeMs: expect.any(Number),
            lastSuccessfulPollAgeMs: null,
            lastErrorAgeMs: expect.any(Number),
            consecutiveErrors: 1,
            errorSignals: claimed * 2,
            schemaMismatch: false
          }
        }
      });
      expect(errors()).toEqual([]);
      expect(mocks.end).toHaveBeenCalledOnce();
    }
  );

  it('validates malformed reports before progress and logs only one diagnostic without fabricating success', async () => {
    const getter = vi.fn(() => {
      throw failure;
    });
    const circular: { cause?: unknown } = {};
    circular.cause = circular;
    vi.spyOn(runtime, 'runRealtimePracticeReceipts').mockImplementationOnce(async (options) => {
      const malformed: unknown[] = [
        hostile,
        circular,
        Object.create({
          kind: 'poll',
          channel: 'telegram',
          claimed: 0,
          failures: 0,
          durationMs: 1
        }),
        Object.defineProperty({ channel: 'telegram' }, 'kind', { get: getter }),
        ...[NaN, Infinity, -1, Number.MAX_VALUE, sentinel].map((failures) => ({
          kind: 'poll',
          channel: 'telegram',
          claimed: 0,
          failures,
          durationMs: 1
        })),
        { kind: 'poll', channel: 'telegram', claimed: 3, failures: 0, durationMs: 1 },
        { kind: 'batch', channel: 'telegram', claimed: 1, failures: 0, durationMs: Infinity }
      ];
      for (let n = 0; n < 100; n++)
        for (const value of malformed) options.report(value as ReceiptDispatchEvent);
      await vi.advanceTimersByTimeAsync(30000);
      expect(
        records().find(({ event }) => event === 'practice_receipt_worker_heartbeat')
      ).toMatchObject({
        lanes: {
          line: null,
          telegram: {
            lastCompletedPollAgeMs: null,
            lastSuccessfulPollAgeMs: null,
            lastErrorAgeMs: null,
            consecutiveErrors: 0,
            errorSignals: 0,
            schemaMismatch: false
          }
        }
      });
      options.report(
        Object.defineProperty(
          {
            kind: 'batch',
            channel: 'telegram',
            claimed: 1,
            failures: 0,
            durationMs: 2,
            subject: sentinel,
            cause: circular
          },
          'toJSON',
          { get: getter }
        )
      );
      return { schemaMismatch: false };
    });
    await runPracticeReceiptWorker(enabled);
    expect(errors()).toEqual([
      { event: 'practice_receipt_worker_report_invalid', err: { category: 'internal' } }
    ]);
    expect(getter).not.toHaveBeenCalled();
    expect(records()).toHaveLength(4);
    expect(records()[2]).toEqual({
      event: 'practice_receipt_batch',
      kind: 'batch',
      channel: 'telegram',
      claimed: 1,
      failures: 0,
      durationMs: 2
    });
  });

  it.each(['runtime', 'sender', 'pool-handler'] as const)(
    'cleans once and preserves the original %s failure when end also rejects',
    async (phase) => {
      mocks.end.mockRejectedValueOnce(hostile);
      if (phase === 'runtime')
        vi.spyOn(runtime, 'runRealtimePracticeReceipts').mockRejectedValueOnce(failure);
      if (phase === 'sender')
        mocks.telegram.mockImplementationOnce(() => {
          throw failure;
        });
      if (phase === 'pool-handler')
        mocks.on.mockImplementationOnce(() => {
          throw failure;
        });
      await expect(runPracticeReceiptWorker(enabled)).rejects.toBe(failure);
      expect(mocks.end).toHaveBeenCalledOnce();
      expect(errors()).toEqual([
        { event: 'practice_receipt_worker_pool_end_failed', err: { category: 'internal' } }
      ]);
      expect(records().at(-1)).toEqual({ event: 'practice_receipt_worker_stopped' });
    }
  );

  it('preserves even an undefined original rejection rather than masking it with cleanup', async () => {
    vi.spyOn(runtime, 'runRealtimePracticeReceipts').mockRejectedValueOnce(undefined);
    mocks.end.mockRejectedValueOnce(failure);
    await expect(runPracticeReceiptWorker(enabled)).rejects.toBeUndefined();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('waits for the runtime to settle before closing and preserves existing signal abort behavior', async () => {
    let finish: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      vi.spyOn(runtime, 'runRealtimePracticeReceipts').mockImplementationOnce(async (options) => {
        resolve();
        await new Promise<void>((done) => {
          finish = done;
        });
        expect(options.signal.aborted).toBe(true);
        return { schemaMismatch: false };
      });
    });
    const running = runPracticeReceiptWorker(enabled);
    await entered;
    process.emit('SIGTERM');
    process.emit('SIGINT');
    expect(mocks.end).not.toHaveBeenCalled();
    finish?.();
    await running;
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('reports idle pool errors with only bounded code and no provider diagnostics', async () => {
    vi.spyOn(runtime, 'runRealtimePracticeReceipts').mockImplementationOnce(async () => {
      const handler = mocks.on.mock.calls[0]?.[1] as (error: unknown) => void;
      handler(failure);
      handler(hostile);
      return { schemaMismatch: false };
    });
    await runPracticeReceiptWorker(enabled);
    expect(errors()).toEqual([
      {
        event: 'practice_receipt_worker_database_error',
        err: { category: 'network', code: 'ECONNRESET' }
      },
      { event: 'practice_receipt_worker_database_error', err: { category: 'internal' } }
    ]);
  });

  it('contains realpath failure and does not initialize the worker', async () => {
    mocks.realpath.mockImplementationOnce(() => {
      throw failure;
    });
    await main('/synthetic.invalid/entry');
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errors()).toEqual([
      { event: 'practice_receipt_worker_failed', err: { category: 'network', code: 'ECONNRESET' } }
    ]);
  });

  it.each([
    { PRACTICE_RECEIPTS_REALTIME_ENABLED: 'yes' },
    { PRACTICE_RECEIPTS_REALTIME_ENABLED: 'true', TELEGRAM_ONBOARDING_BOT_TOKEN: sentinel },
    { ...enabled, LINE_CHANNEL_ACCESS_TOKEN: 'short' },
    { ...enabled, DATABASE_URL: sentinel }
  ])('contains direct-entry parser/config failures %#', async (env) => {
    vi.stubGlobal('process', { env });
    await main(fileURLToPath(new URL('../src/practice-receipt-worker.ts', import.meta.url)));
    expect(process.exitCode).toBe(1);
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(errors()).toEqual([
      { event: 'practice_receipt_worker_failed', err: { category: 'internal' } }
    ]);
    vi.unstubAllGlobals();
  });

  it('contains config module evaluation failure before acquiring a pool', async () => {
    vi.doMock('@qigong/config', () => {
      throw failure;
    });
    try {
      await expect(runPracticeReceiptWorker(enabled)).rejects.toMatchObject({ cause: failure });
      expect(mocks.pool).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('@qigong/config');
    }
  });

  it('reports both failures safely at direct entry, after waiting for the single cleanup', async () => {
    vi.spyOn(runtime, 'runRealtimePracticeReceipts').mockRejectedValueOnce(failure);
    mocks.end.mockRejectedValueOnce(hostile);
    const actual = process;
    vi.stubGlobal('process', {
      env: enabled,
      on: actual.on.bind(actual),
      off: actual.off.bind(actual)
    });
    await main(fileURLToPath(new URL('../src/practice-receipt-worker.ts', import.meta.url)));
    expect(process.exitCode).toBe(1);
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(errors()).toEqual([
      { event: 'practice_receipt_worker_pool_end_failed', err: { category: 'internal' } },
      { event: 'practice_receipt_worker_failed', err: { category: 'network', code: 'ECONNRESET' } }
    ]);
    vi.unstubAllGlobals();
  });

  it('rejects cleanup-only failure and reports it safely at direct entry', async () => {
    vi.spyOn(runtime, 'runRealtimePracticeReceipts').mockResolvedValueOnce({
      schemaMismatch: false
    });
    mocks.end.mockRejectedValueOnce(failure);
    const actual = process;
    vi.stubGlobal('process', {
      env: enabled,
      on: actual.on.bind(actual),
      off: actual.off.bind(actual)
    });
    await main(fileURLToPath(new URL('../src/practice-receipt-worker.ts', import.meta.url)));
    expect(process.exitCode).toBe(1);
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(errors().map(({ event }) => event)).toEqual([
      'practice_receipt_worker_pool_end_failed',
      'practice_receipt_worker_failed'
    ]);
    vi.unstubAllGlobals();
  });
});
