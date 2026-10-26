import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { logWorkerDiagnostic, sanitizeReceiptDispatchEvent } from './log-privacy.js';

export const runPracticeReceiptWorker = async (
  source: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  const { realtimeReceiptsEnabled, receiptDispatchSettings } =
    await import('./practice-receipt-dispatcher.js');
  if (!realtimeReceiptsEnabled(source.PRACTICE_RECEIPTS_REALTIME_ENABLED)) {
    logWorkerDiagnostic({ event: 'practice_receipt_worker_disabled' });
    return;
  }
  const { z } = await import('zod');
  const token = z
    .string()
    .regex(/^\d+:[A-Za-z0-9_-]{35,}$/)
    .parse(source.TELEGRAM_ONBOARDING_BOT_TOKEN);
  const lineToken = source.LINE_CHANNEL_ACCESS_TOKEN
    ? z.string().min(20).parse(source.LINE_CHANNEL_ACCESS_TOKEN)
    : undefined;
  const { loadEnvironment } = await import('@qigong/config');
  const { createPool } = await import('@qigong/database');
  const { createTelegramPracticeSender } = await import('./telegram-practice-receipts.js');
  const { createLinePracticeSender } = await import('./channel-practice-receipts.js');
  const { runRealtimePracticeReceipts } = await import('./practice-receipt-runtime.js');
  const { createReceiptProgress, updateReceiptProgress, receiptProgressSnapshot } =
    await import('./practice-receipt-health.js');
  // Dedicated bounded pool, independent of API and the one-minute operational worker.
  const pool = createPool(loadEnvironment({ ...source, DATABASE_POOL_MAX: '4' }));
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let stop: (() => void) | undefined;
  let cleanupFailure: { err: unknown } | undefined;
  try {
    pool.on('error', (err: unknown) =>
      logWorkerDiagnostic({ event: 'practice_receipt_worker_database_error', err })
    );
    const control = new AbortController();
    stop = () => control.abort();
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    const started = performance.now();
    let progress = createReceiptProgress(!!lineToken);
    heartbeat = setInterval(() => {
      const uptimeMs = performance.now() - started;
      logWorkerDiagnostic({
        event: 'practice_receipt_worker_heartbeat',
        uptimeSeconds: Math.round(uptimeMs / 1000),
        lanes: receiptProgressSnapshot(progress, uptimeMs)
      });
    }, 30000);
    heartbeat.unref();
    let invalidReportLogged = false;
    const report = (input: unknown) => {
      const event = sanitizeReceiptDispatchEvent(input);
      if (!event) {
        if (!invalidReportLogged)
          logWorkerDiagnostic({ event: 'practice_receipt_worker_report_invalid' });
        invalidReportLogged = true;
        return;
      }
      progress = updateReceiptProgress(progress, event, performance.now() - started);
      // Successful idle polls update progress without a per-second log stream.
      if (event.kind !== 'poll' || event.failures)
        logWorkerDiagnostic({ event: 'practice_receipt_' + event.kind, ...event });
    };
    logWorkerDiagnostic({
      event: 'practice_receipt_worker_started',
      pollMs: receiptDispatchSettings.pollMs,
      batchSize: receiptDispatchSettings.batchSize,
      lineEnabled: !!lineToken
    });
    const result = await runRealtimePracticeReceipts({
      pool,
      signal: control.signal,
      telegram: createTelegramPracticeSender(token),
      ...(lineToken ? { line: createLinePracticeSender(lineToken) } : {}),
      report
    });
    if (result.schemaMismatch) process.exitCode = 1;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (stop) {
      process.off('SIGTERM', stop);
      process.off('SIGINT', stop);
    }
    try {
      await pool.end();
    } catch (err) {
      logWorkerDiagnostic({ event: 'practice_receipt_worker_pool_end_failed', err });
      cleanupFailure = { err };
    } finally {
      logWorkerDiagnostic({ event: 'practice_receipt_worker_stopped' });
    }
  }
  // This is reached only when the runtime succeeded: cleanup must never mask
  // an original rejection (even undefined). Entry owns its safe diagnostic.
  if (cleanupFailure) throw cleanupFailure.err;
};

export const main = async (entry: string | undefined = process.argv[1]): Promise<void> => {
  try {
    if (entry && realpathSync(entry) === fileURLToPath(import.meta.url))
      await runPracticeReceiptWorker();
  } catch (err) {
    logWorkerDiagnostic({ event: 'practice_receipt_worker_failed', err });
    process.exitCode = 1;
  }
};
await main();
