import { describe, expect, it, vi } from 'vitest';
import {
  runPracticeReceiptLane,
  realtimeReceiptsEnabled,
  waitForReceiptPoll,
  type ReceiptDispatchEvent
} from '../src/practice-receipt-dispatcher.js';
const base = (controller: AbortController) => ({
  channel: 'line' as const,
  signal: controller.signal,
  ready: async () => true,
  onSchemaMismatch: () => controller.abort(),
  report: vi.fn<(event: ReceiptDispatchEvent) => void>()
});
describe('Dedicated near-real-time practice receipt lanes', () => {
  it('requires an explicit operational opt-in and never accepts loose truthy flags', () => {
    expect(realtimeReceiptsEnabled(undefined)).toBe(false);
    expect(realtimeReceiptsEnabled('false')).toBe(false);
    expect(realtimeReceiptsEnabled('true')).toBe(true);
    for (const value of ['1', 'yes', 'TRUE', ''])
      expect(() => realtimeReceiptsEnabled(value)).toThrow();
  });
  it('checks immediately and picks up newly committed work after a one-second idle poll', async () => {
    const c = new AbortController(),
      options = base(c),
      events: string[] = [];
    let queued = false;
    await runPracticeReceiptLane({
      ...options,
      deliver: async () => {
        events.push(queued ? 'claim1' : 'claim0');
        if (queued) c.abort();
        return { claimed: queued ? 1 : 0, failures: 0 };
      },
      wait: async (ms) => {
        events.push('wait' + ms);
        queued = true;
      }
    });
    expect(events).toEqual(['claim0', 'wait1000', 'claim1']);
    expect(options.report.mock.calls.map(([event]) => event)).toEqual([
      { kind: 'poll', channel: 'line', claimed: 0, failures: 0, durationMs: expect.any(Number) },
      { kind: 'batch', channel: 'line', claimed: 1, failures: 0, durationMs: expect.any(Number) }
    ]);
  });
  it('drains full batches without a minute wait but pauses every bounded burst', async () => {
    const c = new AbortController(),
      pauses: number[] = [];
    let batches = 0;
    await runPracticeReceiptLane({
      ...base(c),
      deliver: async () => {
        batches++;
        return { claimed: 3, failures: 0 };
      },
      wait: async (ms) => {
        pauses.push(ms);
        if (pauses.length === 10) c.abort();
      }
    });
    expect(batches).toBe(10);
    expect(pauses).toEqual([...Array<number>(9).fill(25), 1000]);
  });
  it('backs off delivery failures rather than spinning on a failed provider', async () => {
    const c = new AbortController(),
      pauses: number[] = [];
    await runPracticeReceiptLane({
      ...base(c),
      deliver: async () => ({ claimed: 3, failures: 3 }),
      wait: async (ms) => {
        pauses.push(ms);
        if (pauses.length === 7) c.abort();
      }
    });
    expect(pauses).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
  it('sanitizes database failures and retries with bounded backoff', async () => {
    const c = new AbortController(),
      options = base(c),
      pauses: number[] = [];
    await runPracticeReceiptLane({
      ...options,
      deliver: async () => {
        throw Error('private token and reflection must not escape');
      },
      wait: async (ms) => {
        pauses.push(ms);
        if (pauses.length === 2) c.abort();
      }
    });
    expect(pauses).toEqual([1000, 2000]);
    expect(options.report.mock.calls.map(([event]) => event)).toEqual([
      { kind: 'error', channel: 'line' },
      { kind: 'error', channel: 'line' }
    ]);
  });
  it('fails closed on a schema mismatch and never claims or sends', async () => {
    const c = new AbortController(),
      options = base(c),
      deliver = vi.fn(async () => ({ claimed: 1, failures: 0 }));
    await runPracticeReceiptLane({ ...options, ready: async () => false, deliver });
    expect(deliver).not.toHaveBeenCalled();
    expect(c.signal.aborted).toBe(true);
    expect(options.report).toHaveBeenCalledWith({ kind: 'schema_mismatch', channel: 'line' });
  });
  it('keeps Telegram draining while a LINE batch is still in flight, without overlapping LINE batches', async () => {
    const c = new AbortController();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let lineCalls = 0,
      tgCalls = 0;
    const line = runPracticeReceiptLane({
      ...base(c),
      deliver: async () => {
        lineCalls++;
        await pending;
        return { claimed: 1, failures: 0 };
      }
    });
    const telegram = runPracticeReceiptLane({
      ...base(c),
      channel: 'telegram',
      deliver: async () => {
        tgCalls++;
        return { claimed: 1, failures: 0 };
      },
      wait: async () => {
        if (tgCalls === 3) c.abort();
      }
    });
    await telegram;
    expect(tgCalls).toBe(3);
    expect(lineCalls).toBe(1);
    finish();
    await line;
    expect(lineCalls).toBe(1);
  });
  it('stops claiming after cancellation during a readiness check', async () => {
    const c = new AbortController(),
      deliver = vi.fn(async () => ({ claimed: 0, failures: 0 }));
    await runPracticeReceiptLane({
      ...base(c),
      ready: async () => {
        c.abort();
        return true;
      },
      deliver
    });
    expect(deliver).not.toHaveBeenCalled();
  });
  it('finishes in-flight work before exiting and never schedules the next batch on shutdown', async () => {
    const c = new AbortController(),
      wait = vi.fn(async () => {});
    let finish!: () => void;
    const pending = new Promise<void>((r) => {
      finish = r;
    });
    const deliver = vi.fn(async () => {
      await pending;
      return { claimed: 3, failures: 0 };
    });
    const done = runPracticeReceiptLane({ ...base(c), deliver, wait });
    await Promise.resolve();
    c.abort();
    finish();
    await done;
    expect(deliver).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });
  it('wakes an idle sleep immediately on termination', async () => {
    const c = new AbortController();
    const pending = waitForReceiptPoll(30000, c.signal);
    c.abort();
    await expect(pending).resolves.toBeUndefined();
  });
  it('rejects out-of-contract batch sizes without leaking arbitrary result fields', async () => {
    const c = new AbortController(),
      options = base(c);
    await runPracticeReceiptLane({
      ...options,
      deliver: async () => ({ claimed: 21, failures: 0 }),
      wait: async () => {
        c.abort();
      }
    });
    expect(options.report).toHaveBeenCalledWith({ kind: 'error', channel: 'line' });
  });
});
