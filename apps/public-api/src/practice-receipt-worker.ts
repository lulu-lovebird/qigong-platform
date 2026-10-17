import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { loadEnvironment } from '@qigong/config';
import { createPool } from '@qigong/database';
import { z } from 'zod';
import { createTelegramPracticeSender } from './telegram-practice-receipts.js';
import { createLinePracticeSender } from './channel-practice-receipts.js';
import {
  realtimeReceiptsEnabled,
  receiptDispatchSettings,
  type ReceiptDispatchEvent
} from './practice-receipt-dispatcher.js';
import { runRealtimePracticeReceipts } from './practice-receipt-runtime.js';
import {
  createReceiptProgress,
  updateReceiptProgress,
  receiptProgressSnapshot
} from './practice-receipt-health.js';

export const runPracticeReceiptWorker = async (
  source: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  if (!realtimeReceiptsEnabled(source.PRACTICE_RECEIPTS_REALTIME_ENABLED)) {
    console.log(JSON.stringify({ event: 'practice_receipt_worker_disabled' }));
    return;
  }
  const token = z
    .string()
    .regex(/^\d+:[A-Za-z0-9_-]{35,}$/)
    .parse(source.TELEGRAM_ONBOARDING_BOT_TOKEN);
  const lineToken = source.LINE_CHANNEL_ACCESS_TOKEN
    ? z.string().min(20).parse(source.LINE_CHANNEL_ACCESS_TOKEN)
    : undefined;
  // Dedicated bounded pool, independent of API and the one-minute operational worker.
  const pool = createPool(loadEnvironment({ ...source, DATABASE_POOL_MAX: '4' }));
  pool.on('error', () =>
    console.error(JSON.stringify({ event: 'practice_receipt_worker_database_error' }))
  );
  const control = new AbortController(),
    stop = () => control.abort();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const started = performance.now();
  let progress = createReceiptProgress(!!lineToken);
  const heartbeat = setInterval(() => {
    const uptimeMs = performance.now() - started;
    console.log(
      JSON.stringify({
        event: 'practice_receipt_worker_heartbeat',
        uptimeSeconds: Math.round(uptimeMs / 1000),
        lanes: receiptProgressSnapshot(progress, uptimeMs)
      })
    );
  }, 30000);
  heartbeat.unref();
  const report = (event: ReceiptDispatchEvent) => {
    progress = updateReceiptProgress(progress, event, performance.now() - started);
    // Successful idle polls update progress without a per-second log stream.
    if (event.kind !== 'poll' || event.failures)
      console.log(JSON.stringify({ event: 'practice_receipt_' + event.kind, ...event }));
  };
  try {
    console.log(
      JSON.stringify({
        event: 'practice_receipt_worker_started',
        pollMs: receiptDispatchSettings.pollMs,
        batchSize: receiptDispatchSettings.batchSize,
        lineEnabled: !!lineToken
      })
    );
    const result = await runRealtimePracticeReceipts({
      pool,
      signal: control.signal,
      telegram: createTelegramPracticeSender(token),
      ...(lineToken ? { line: createLinePracticeSender(lineToken) } : {}),
      report
    });
    if (result.schemaMismatch) process.exitCode = 1;
  } finally {
    clearInterval(heartbeat);
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    await pool.end();
    console.log(JSON.stringify({ event: 'practice_receipt_worker_stopped' }));
  }
};
const entry = process.argv[1];
if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  try {
    await runPracticeReceiptWorker();
  } catch {
    console.error(JSON.stringify({ event: 'practice_receipt_worker_failed' }));
    process.exitCode = 1;
  }
}
