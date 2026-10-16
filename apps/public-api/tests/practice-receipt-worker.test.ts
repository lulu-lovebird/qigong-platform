import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPracticeReceiptWorker } from '../src/practice-receipt-worker.js';
afterEach(() => vi.restoreAllMocks());
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
  it('fails closed on incomplete enabled configuration without installing signals', async () => {
    const count = process.listenerCount('SIGTERM');
    await expect(
      runPracticeReceiptWorker({ PRACTICE_RECEIPTS_REALTIME_ENABLED: 'true' })
    ).rejects.toThrow();
    expect(process.listenerCount('SIGTERM')).toBe(count);
  });
});
