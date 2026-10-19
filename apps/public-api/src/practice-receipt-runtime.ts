import { randomUUID } from 'node:crypto';
import { withRequestContext, type Pool } from '@qigong/database';
import {
  deliverChannelPracticeReceipts,
  type ChannelPracticeSender
} from './channel-practice-receipts.js';
import {
  deliverTelegramPracticeReceipts,
  type TelegramPracticeSender
} from './telegram-practice-receipts.js';
import {
  receiptDispatchSettings,
  runPracticeReceiptLane,
  type ReceiptDispatchEvent
} from './practice-receipt-dispatcher.js';
interface ReceiptRuntimeOptions {
  pool: Pool;
  signal: AbortSignal;
  telegram: TelegramPracticeSender;
  line?: ChannelPracticeSender;
  report: (event: ReceiptDispatchEvent) => void;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}
export const runRealtimePracticeReceipts = async (
  options: ReceiptRuntimeOptions
): Promise<{ schemaMismatch: boolean }> => {
  const control = new AbortController(),
    abort = () => control.abort();
  let schemaMismatch = false;
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) abort();
  const ready = async () => {
    const result = await withRequestContext(
      options.pool,
      'qigong_worker_runtime',
      { requestId: randomUUID() },
      (client) =>
        client.query<{ ready: boolean }>('SELECT ops.achievement_event_streak_schema_ready() ready')
    );
    return result.rows[0]?.ready === true;
  };
  const common = {
    signal: control.signal,
    ready,
    onSchemaMismatch: () => {
      schemaMismatch = true;
      abort();
    },
    report: options.report,
    ...(options.wait ? { wait: options.wait } : {})
  };
  const run = (work: Promise<void>) =>
    work.catch(() => {
      abort();
      throw Error('Receipt dispatcher lane stopped');
    });
  try {
    const telegram = run(
      runPracticeReceiptLane({
        ...common,
        channel: 'telegram',
        deliver: async () => {
          let failures = 0;
          const claimed = await deliverTelegramPracticeReceipts(
            options.pool,
            options.telegram,
            () => {
              failures++;
            },
            receiptDispatchSettings.batchSize
          );
          return { claimed, failures };
        }
      })
    );
    const lineSender = options.line;
    const line = lineSender
      ? run(
          runPracticeReceiptLane({
            ...common,
            channel: 'line',
            deliver: async () => {
              let failures = 0;
              const claimed = await deliverChannelPracticeReceipts(
                options.pool,
                'line',
                lineSender,
                () => {
                  failures++;
                },
                receiptDispatchSettings.batchSize
              );
              return { claimed, failures };
            }
          })
        )
      : null;
    const outcomes = await Promise.allSettled(line ? [telegram, line] : [telegram]);
    if (outcomes.some((outcome) => outcome.status === 'rejected'))
      throw Error('Receipt dispatcher lane stopped');
    return { schemaMismatch };
  } finally {
    options.signal.removeEventListener('abort', abort);
  }
};
