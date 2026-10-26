import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { createPool } from '@qigong/database';
import { logWorkerDiagnostic, type WorkerFailureEvent } from './log-privacy.js';

export const runNotificationWorker = async (
  source: NodeJS.ProcessEnv = process.env
): Promise<void> => {
  let phase: WorkerFailureEvent = 'notification_worker_config_failed';
  let pool: ReturnType<typeof createPool> | undefined;
  try {
    const { loadEnvironment } = await import('@qigong/config');
    const { z } = await import('zod');
    const environment = loadEnvironment(source);
    const token = z
      .string()
      .regex(/^\d+:[A-Za-z0-9_-]{35,}$/)
      .parse(source.TELEGRAM_ONBOARDING_BOT_TOKEN);
    const lineToken = source.LINE_CHANNEL_ACCESS_TOKEN
      ? z.string().min(20).parse(source.LINE_CHANNEL_ACCESS_TOKEN)
      : undefined;
    const { createWhatsAppNotificationSender, loadWhatsAppNotificationConfig } =
      await import('./whatsapp-client.js');
    const {
      reviewNotificationsEnabled,
      deliverReviewNotifications,
      createReviewNotificationSender
    } = await import('./review-notifications.js');
    const {
      createTelegramReminderSender,
      deliverTelegramReminders,
      telegramReminderWorkerEnabled
    } = await import('./telegram-reminders.js');
    const { createTelegramPracticeSender, deliverTelegramPracticeReceipts } =
      await import('./telegram-practice-receipts.js');
    const { createLinePracticeSender, deliverChannelPracticeReceipts } =
      await import('./channel-practice-receipts.js');
    const {
      createLineNotificationSender,
      createTelegramNotificationSender,
      deliverOnboardingNotifications
    } = await import('./onboarding-notifications.js');
    const whatsapp = loadWhatsAppNotificationConfig(source);
    const remindersEnabled = telegramReminderWorkerEnabled(source.TELEGRAM_REMINDERS_ENABLED);
    const reviewEnabled = reviewNotificationsEnabled(source.REVIEW_NOTIFICATIONS_ENABLED);
    phase = 'notification_worker_pool_failed';
    const { createPool, withRequestContext } = await import('@qigong/database');
    const activePool = createPool(environment);
    pool = activePool;
    activePool.on('error', (err: unknown) => {
      logWorkerDiagnostic({ event: 'notification_worker_database_error', err });
      process.exitCode = 1;
    });
    phase = 'notification_worker_schema_failed';
    const schema = await withRequestContext(
      activePool,
      'qigong_worker_runtime',
      { requestId: randomUUID() },
      (client) =>
        client.query<{ ready: boolean }>('SELECT ops.achievement_event_streak_schema_ready() ready')
    );
    if (schema.rows[0]?.ready !== true) throw new Error('Notification worker schema mismatch');
    phase = 'notification_worker_lane_failed';
    const deliveryFailure = (lane: string) => (err: unknown) =>
      logWorkerDiagnostic({ event: 'notification_worker_delivery_failed', lane, err });
    // Build delayed jobs first: even a synchronous sender factory or lane throw
    // becomes a settled lane outcome, never early cleanup over a live sibling.
    // Existing six-attempt limits, optional flags, roles and transport budgets stay unchanged.
    const jobs = [
      {
        lane: 'onboarding',
        event: 'onboarding_notifications_processed',
        run: () =>
          deliverOnboardingNotifications(
            activePool,
            createTelegramNotificationSender(token),
            deliveryFailure('onboarding'),
            3,
            lineToken ? createLineNotificationSender(lineToken) : undefined,
            whatsapp ? createWhatsAppNotificationSender(whatsapp) : undefined
          )
      },
      {
        lane: 'telegram',
        event: 'telegram_practice_receipts_processed',
        run: () =>
          deliverTelegramPracticeReceipts(
            activePool,
            createTelegramPracticeSender(token),
            deliveryFailure('telegram'),
            lineToken ? 2 : 3
          )
      },
      ...(lineToken
        ? [
            {
              lane: 'line',
              event: 'line_practice_receipts_processed',
              run: () =>
                deliverChannelPracticeReceipts(
                  activePool,
                  'line',
                  createLinePracticeSender(lineToken),
                  deliveryFailure('line'),
                  1
                )
            }
          ]
        : []),
      ...(remindersEnabled
        ? [
            {
              lane: 'reminders',
              event: 'telegram_reminders_processed',
              run: () =>
                deliverTelegramReminders(
                  activePool,
                  createTelegramReminderSender(token),
                  deliveryFailure('reminders')
                )
            }
          ]
        : []),
      ...(reviewEnabled
        ? [
            {
              lane: 'review',
              event: 'review_notifications_processed',
              run: () =>
                deliverReviewNotifications(
                  activePool,
                  createReviewNotificationSender(token),
                  deliveryFailure('review')
                )
            }
          ]
        : []),
      {
        lane: 'badges',
        event: 'practice_badges_reconciled',
        run: async () => {
          const result = await withRequestContext(
            activePool,
            'qigong_worker_runtime',
            { requestId: randomUUID() },
            (client) =>
              client.query<{ processed: number }>(
                'SELECT ops.reconcile_practice_badges(20) processed'
              )
          );
          return result.rows[0]?.processed ?? 0;
        }
      }
    ];
    const outcomes = await Promise.allSettled(
      jobs.map((job) =>
        Promise.resolve()
          .then(job.run)
          .then((processed) => {
            logWorkerDiagnostic({ event: job.event, processed });
          })
      )
    );
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        logWorkerDiagnostic({
          event: 'notification_worker_lane_failed',
          lane: jobs[index]?.lane,
          err: outcome.reason as unknown
        });
        process.exitCode = 1;
      }
    });
  } catch (err) {
    logWorkerDiagnostic({ event: phase, err });
    process.exitCode = 1;
  } finally {
    if (pool) {
      try {
        await pool.end();
      } catch (err) {
        logWorkerDiagnostic({ event: 'notification_worker_pool_end_failed', err });
        process.exitCode = 1;
      }
    }
  }
};

export const main = async (entry: string | undefined = process.argv[1]): Promise<void> => {
  try {
    if (entry && realpathSync(entry) === fileURLToPath(import.meta.url))
      await runNotificationWorker();
  } catch (err) {
    logWorkerDiagnostic({ event: 'notification_worker_entry_failed', err });
    process.exitCode = 1;
  }
};
await main();
