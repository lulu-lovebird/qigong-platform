import type { Pool, PoolClient } from '@qigong/database';
import type * as FileSystem from 'node:fs';
import type * as Reminders from '../src/telegram-reminders.js';
import type * as Reviews from '../src/review-notifications.js';
import type * as WhatsApp from '../src/whatsapp-client.js';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  environment: vi.fn(),
  pool: vi.fn(),
  on: vi.fn(),
  end: vi.fn(),
  query: vi.fn<(sql: string) => Promise<{ rows: unknown[] }>>(),
  onboarding: vi.fn(),
  telegram: vi.fn(),
  line: vi.fn(),
  reminders: vi.fn(),
  review: vi.fn(),
  directReview: vi.fn(),
  directTransport: vi.fn(),
  telegramSender: vi.fn(),
  lineSender: vi.fn(),
  whatsappSender: vi.fn(),
  practiceSender: vi.fn(),
  linePracticeSender: vi.fn(),
  reminderSender: vi.fn(),
  reviewSender: vi.fn(),
  realpath: vi.fn((path: string) => path)
}));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof FileSystem>()),
  realpathSync: mocks.realpath
}));
vi.mock('@qigong/config', () => ({ loadEnvironment: mocks.environment }));
vi.mock('@qigong/database', () => ({
  createPool: mocks.pool,
  withRequestContext: vi.fn(
    async <Result>(
      _pool: Pool,
      _role: string,
      _context: unknown,
      callback: (client: PoolClient) => Promise<Result>
    ): Promise<Result> => callback({ query: mocks.query } as unknown as PoolClient)
  )
}));
vi.mock('../src/onboarding-notifications.js', () => ({
  createTelegramNotificationSender: mocks.telegramSender,
  createLineNotificationSender: mocks.lineSender,
  deliverOnboardingNotifications: mocks.onboarding
}));
vi.mock('../src/telegram-practice-receipts.js', () => ({
  createTelegramPracticeSender: mocks.practiceSender,
  deliverTelegramPracticeReceipts: mocks.telegram
}));
vi.mock('../src/channel-practice-receipts.js', () => ({
  createLinePracticeSender: mocks.linePracticeSender,
  deliverChannelPracticeReceipts: mocks.line
}));
vi.mock('../src/telegram-reminders.js', async (original) => ({
  ...(await original<typeof Reminders>()),
  createTelegramReminderSender: mocks.reminderSender,
  deliverTelegramReminders: mocks.reminders
}));
vi.mock('../src/review-notifications.js', async (original) => ({
  ...(await original<typeof Reviews>()),
  createReviewNotificationSender: mocks.reviewSender,
  deliverReviewNotifications: mocks.review
}));
vi.mock('../src/telegram-learner-review-notifications.js', () => ({
  deliverTelegramLearnerReviews: mocks.directReview
}));
vi.mock('../src/telegram-learner-review.js', () => ({
  createTelegramReviewTransport: mocks.directTransport
}));
vi.mock('../src/whatsapp-client.js', async (original) => ({
  ...(await original<typeof WhatsApp>()),
  createWhatsAppNotificationSender: mocks.whatsappSender
}));
import { withRequestContext } from '@qigong/database';
import { main, runNotificationWorker } from '../src/notification-worker.js';
const importCalls = [
  mocks.environment.mock.calls.length,
  mocks.pool.mock.calls.length,
  mocks.onboarding.mock.calls.length
];
const sentinel = 'synthetic-private-worker@sentinel.invalid';
const failure = Object.assign(new Error(sentinel, { cause: new Error(sentinel) }), {
  code: 'ECONNRESET',
  detail: sentinel,
  query: sentinel,
  token: sentinel
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
const environment = { DATABASE_URL: 'postgresql://synthetic.invalid/test' };
const source = { TELEGRAM_ONBOARDING_BOT_TOKEN: '123456:' + 'x'.repeat(35) };
const activePool = { on: mocks.on, end: mocks.end };
const captureLog = () => vi.spyOn(console, 'log').mockImplementation(() => {});
const captureError = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const captureOut = () => vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
const captureErr = () => vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
let log: ReturnType<typeof captureLog>, error: ReturnType<typeof captureError>;
let stdout: ReturnType<typeof captureOut>, stderr: ReturnType<typeof captureErr>;
let exitCode: typeof process.exitCode;
const errors = () =>
  error.mock.calls.map(
    ([text]) =>
      JSON.parse(String(text)) as {
        event: string;
        lane?: string;
        err: { category: string; code?: string };
      }
  );
const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.clearAllMocks();
  exitCode = process.exitCode;
  process.exitCode = undefined;
  log = captureLog();
  error = captureError();
  stdout = captureOut();
  stderr = captureErr();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected synthetic transport call');
    })
  );
  mocks.directReview.mockResolvedValue(4);
  mocks.directTransport.mockReturnValue({ send: vi.fn(), edit: vi.fn(), answer: vi.fn() });
  mocks.environment.mockReturnValue(environment);
  mocks.pool.mockReturnValue(activePool);
  mocks.on.mockImplementation(() => activePool);
  mocks.end.mockResolvedValue(undefined);
  mocks.realpath.mockImplementation((path: string) => path);
  mocks.query.mockImplementation(async (sql) => ({
    rows: sql.includes('schema_ready') ? [{ ready: true }] : [{ processed: 2 }]
  }));
  for (const mock of [mocks.onboarding, mocks.telegram, mocks.line, mocks.reminders, mocks.review])
    mock.mockResolvedValue(1);
  for (const mock of [
    mocks.telegramSender,
    mocks.lineSender,
    mocks.whatsappSender,
    mocks.practiceSender,
    mocks.linePracticeSender,
    mocks.reminderSender,
    mocks.reviewSender
  ])
    mock.mockReturnValue(vi.fn());
});
afterEach(() => {
  expect(
    JSON.stringify([log.mock.calls, error.mock.calls, stdout.mock.calls, stderr.mock.calls])
  ).not.toContain(sentinel);
  expect(fetch).not.toHaveBeenCalled();
  process.exitCode = exitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('notification entry containment and unchanged lane contracts', () => {
  it('is import safe', () => {
    expect(importCalls).toEqual([0, 0, 0]);
  });
  it.each([
    {},
    { TELEGRAM_ONBOARDING_BOT_TOKEN: sentinel },
    { ...source, LINE_CHANNEL_ACCESS_TOKEN: 'short' },
    { ...source, WHATSAPP_ACCESS_TOKEN: sentinel },
    { ...source, WHATSAPP_TEMPLATE_LANGUAGE_ZH_CN: 'zh_CN' },
    { ...source, TELEGRAM_REMINDERS_ENABLED: 'yes' },
    { ...source, REVIEW_NOTIFICATIONS_ENABLED: 'yes' }
  ])('contains invalid or partial enabled configuration %#', async (input) => {
    await runNotificationWorker(input);
    expect(process.exitCode).toBe(1);
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(errors()).toEqual([
      { event: 'notification_worker_config_failed', err: { category: 'internal' } }
    ]);
  });
  it.each(['environment', 'pool'] as const)('contains %s startup throws', async (phase) => {
    mocks[phase].mockImplementationOnce(() => {
      throw failure;
    });
    await runNotificationWorker(source);
    expect(errors()).toEqual([
      {
        event:
          phase === 'environment'
            ? 'notification_worker_config_failed'
            : 'notification_worker_pool_failed',
        err: { category: 'network', code: 'ECONNRESET' }
      }
    ]);
    expect(mocks.end).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
  it('contains module evaluation failure before pool acquisition', async () => {
    vi.doMock('../src/whatsapp-client.js', () => {
      throw failure;
    });
    try {
      await runNotificationWorker(source);
      expect(errors()[0]?.event).toBe('notification_worker_config_failed');
      expect(mocks.pool).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    } finally {
      vi.doMock('../src/whatsapp-client.js', async (original) => ({
        ...(await original<typeof WhatsApp>()),
        createWhatsAppNotificationSender: mocks.whatsappSender
      }));
    }
  });
  it('keeps optional lanes disabled, existing attempt limits and schema/SQL/role bindings', async () => {
    await runNotificationWorker(source);
    expect(mocks.environment).toHaveBeenCalledExactlyOnceWith(source);
    expect(mocks.pool).toHaveBeenCalledExactlyOnceWith(environment);
    expect(mocks.telegramSender).toHaveBeenCalledExactlyOnceWith(
      source.TELEGRAM_ONBOARDING_BOT_TOKEN
    );
    expect(mocks.practiceSender).toHaveBeenCalledExactlyOnceWith(
      source.TELEGRAM_ONBOARDING_BOT_TOKEN
    );
    expect(mocks.onboarding.mock.calls[0]).toEqual([
      activePool,
      expect.any(Function),
      expect.any(Function),
      3,
      undefined,
      undefined
    ]);
    expect(mocks.telegram.mock.calls[0]?.[3]).toBe(3);
    for (const mock of [mocks.line, mocks.reminders, mocks.review])
      expect(mock).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls).toEqual([
      ['SELECT ops.achievement_event_streak_schema_ready() ready'],
      ['SELECT ops.reconcile_practice_badges(20) processed']
    ]);
    for (const [pool, role, context] of vi.mocked(withRequestContext).mock.calls) {
      expect(pool).toBe(activePool);
      expect(role).toBe('qigong_worker_runtime');
      expect(context).toEqual({ requestId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    }
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(process.exitCode).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(3);
  });
  it('keeps schema58 count-only and uses direct delivery only when schema59 functions are present', async () => {
    await runNotificationWorker({ ...source, REVIEW_NOTIFICATIONS_ENABLED: 'true' });
    expect(mocks.directReview).not.toHaveBeenCalled();
    mocks.query.mockImplementation(async (sql) => ({
      rows:
        sql.includes('schema_ready') || sql.includes('to_regprocedure')
          ? [{ ready: true }]
          : [{ processed: 2 }]
    }));
    await runNotificationWorker({ ...source, REVIEW_NOTIFICATIONS_ENABLED: 'true' });
    expect(mocks.directReview).toHaveBeenCalledExactlyOnceWith(
      activePool,
      mocks.directTransport.mock.results[0]!.value,
      expect.any(Function)
    );
    expect(mocks.directTransport).toHaveBeenCalledExactlyOnceWith(
      source.TELEGRAM_ONBOARDING_BOT_TOKEN
    );
    expect(
      log.mock.calls
        .map(([entry]) => String(entry))
        .some((entry) => entry.includes('review_notifications_processed') && entry.includes('5'))
    ).toBe(true);
  });
  it('retains all six lanes, sender bindings and enabled flags without contacting providers', async () => {
    const enabled = {
      ...source,
      LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-line-token-value',
      TELEGRAM_REMINDERS_ENABLED: 'true',
      REVIEW_NOTIFICATIONS_ENABLED: 'true',
      WHATSAPP_PHONE_NUMBER_ID: '1234',
      WHATSAPP_ACCESS_TOKEN: 'synthetic-whatsapp-token',
      WHATSAPP_GRAPH_VERSION: 'v25.0',
      WHATSAPP_APPROVED_TEMPLATE: 'synthetic_approved',
      WHATSAPP_REJECTED_TEMPLATE: 'synthetic_rejected',
      WHATSAPP_TEMPLATE_LANGUAGE_EN: 'en_US'
    };
    await runNotificationWorker(enabled);
    expect(mocks.lineSender).toHaveBeenCalledExactlyOnceWith(enabled.LINE_CHANNEL_ACCESS_TOKEN);
    expect(mocks.linePracticeSender).toHaveBeenCalledExactlyOnceWith(
      enabled.LINE_CHANNEL_ACCESS_TOKEN
    );
    expect(mocks.whatsappSender).toHaveBeenCalledExactlyOnceWith({
      phoneNumberId: '1234',
      accessToken: enabled.WHATSAPP_ACCESS_TOKEN,
      graphVersion: 'v25.0',
      approvedTemplate: 'synthetic_approved',
      rejectedTemplate: 'synthetic_rejected',
      englishTemplateLocale: 'en_US',
      chineseTemplateLocale: 'zh_TW'
    });
    expect(mocks.telegram.mock.calls[0]?.[3]).toBe(2);
    expect(mocks.line.mock.calls[0]?.[4]).toBe(1);
    expect(mocks.reminderSender).toHaveBeenCalledExactlyOnceWith(
      source.TELEGRAM_ONBOARDING_BOT_TOKEN
    );
    expect(mocks.reviewSender).toHaveBeenCalledExactlyOnceWith(
      source.TELEGRAM_ONBOARDING_BOT_TOKEN
    );
    expect(log).toHaveBeenCalledTimes(6);
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain(enabled.LINE_CHANNEL_ACCESS_TOKEN);
  });
  it.each([false, undefined])(
    'fails closed for schema ready=%s and independently reports cleanup failure',
    async (ready) => {
      mocks.query.mockResolvedValueOnce({ rows: [{ ready, reason: sentinel }] });
      mocks.end.mockRejectedValueOnce(hostile);
      await runNotificationWorker(source);
      expect(errors().map(({ event }) => event)).toEqual([
        'notification_worker_schema_failed',
        'notification_worker_pool_end_failed'
      ]);
      expect(mocks.onboarding).not.toHaveBeenCalled();
      expect(mocks.end).toHaveBeenCalledOnce();
      expect(process.exitCode).toBe(1);
    }
  );
  it('contains a schema rejection and independently reports a second cleanup rejection', async () => {
    mocks.query.mockRejectedValueOnce(failure);
    mocks.end.mockRejectedValueOnce(hostile);
    await runNotificationWorker(source);
    expect(errors()).toEqual([
      {
        event: 'notification_worker_schema_failed',
        err: { category: 'network', code: 'ECONNRESET' }
      },
      { event: 'notification_worker_pool_end_failed', err: { category: 'internal' } }
    ]);
    expect(mocks.onboarding).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });
  it('contains idle pool errors and handler setup failure', async () => {
    mocks.on.mockImplementationOnce((_event, handler: (error: unknown) => void) => {
      handler(failure);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise unknown runtime failure containment.
      throw hostile;
    });
    await runNotificationWorker(source);
    expect(errors().map(({ event }) => event)).toEqual([
      'notification_worker_database_error',
      'notification_worker_pool_failed'
    ]);
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });
  it.each(['sender', 'sync', 'async'] as const)(
    'awaits live sibling lanes after %s failure before the single cleanup',
    async (mode) => {
      const started = deferred<void>(),
        pending = deferred<number>();
      mocks.onboarding.mockImplementationOnce(() => {
        started.resolve(undefined);
        return pending.promise;
      });
      const mock = mode === 'sender' ? mocks.practiceSender : mocks.telegram;
      if (mode === 'async') mock.mockRejectedValueOnce(failure);
      else
        mock.mockImplementationOnce(() => {
          throw failure;
        });
      const running = runNotificationWorker(source);
      await started.promise;
      for (let n = 0; n < 20; n++) await Promise.resolve();
      expect(mocks.end).not.toHaveBeenCalled();
      pending.resolve(2);
      await running;
      expect(mocks.query).toHaveBeenCalledTimes(2);
      expect(mocks.end).toHaveBeenCalledOnce();
      expect(errors()).toEqual([
        {
          event: 'notification_worker_lane_failed',
          err: { category: 'network', code: 'ECONNRESET' },
          lane: 'telegram'
        }
      ]);
      expect(process.exitCode).toBe(1);
    }
  );
  it('drops callback IDs and hostile unknown errors for every lane', async () => {
    for (const mock of [
      mocks.onboarding,
      mocks.telegram,
      mocks.line,
      mocks.reminders,
      mocks.review
    ]) {
      mock.mockImplementationOnce(async (...args: unknown[]) => {
        const callback = args[mock === mocks.line ? 3 : 2] as (err: unknown, id: string) => void;
        callback(hostile, sentinel);
        return 1;
      });
    }
    await runNotificationWorker({
      ...source,
      LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-line-token-value',
      TELEGRAM_REMINDERS_ENABLED: 'true',
      REVIEW_NOTIFICATIONS_ENABLED: 'true'
    });
    expect(errors()).toHaveLength(5);
    expect(
      errors().every(
        ({ event, err }) =>
          event === 'notification_worker_delivery_failed' && err.category === 'internal'
      )
    ).toBe(true);
  });
  it('makes cleanup-only rejection nonzero without unhandled rejection', async () => {
    mocks.end.mockRejectedValueOnce(new AggregateError([failure], sentinel));
    await runNotificationWorker(source);
    expect(errors()).toEqual([
      { event: 'notification_worker_pool_end_failed', err: { category: 'internal' } }
    ]);
    expect(process.exitCode).toBe(1);
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it('does not serialize nonfinite or hostile processed counts', async () => {
    const getter = vi.fn(() => {
      throw failure;
    });
    mocks.onboarding.mockResolvedValueOnce(NaN);
    mocks.telegram.mockResolvedValueOnce(Object.defineProperty({}, 'toJSON', { get: getter }));
    await runNotificationWorker(source);
    expect(getter).not.toHaveBeenCalled();
    expect(log.mock.calls.map(([text]) => JSON.parse(String(text)) as unknown)).toEqual([
      { event: 'onboarding_notifications_processed' },
      { event: 'telegram_practice_receipts_processed' },
      { event: 'practice_badges_reconciled', processed: 2 }
    ]);
  });
  it.each([false, true])(
    'runs the direct-entry branch only with synthetic configuration and stubbed providers, cleanup failure=%s',
    async (cleanupFails) => {
      if (cleanupFails) mocks.end.mockRejectedValueOnce(failure);
      const actual = process;
      vi.stubGlobal('process', { env: source });
      try {
        await main(fileURLToPath(new URL('../src/notification-worker.ts', import.meta.url)));
        expect(mocks.environment).toHaveBeenCalledExactlyOnceWith(source);
        expect(mocks.onboarding).toHaveBeenCalledOnce();
        expect(mocks.end).toHaveBeenCalledOnce();
        expect(process.exitCode).toBe(cleanupFails ? 1 : undefined);
        expect(errors().map(({ event }) => event)).toEqual(
          cleanupFails ? ['notification_worker_pool_end_failed'] : []
        );
      } finally {
        vi.stubGlobal('process', actual);
      }
    }
  );
  it('contains bad entry paths without doing work', async () => {
    mocks.realpath.mockImplementationOnce(() => {
      throw failure;
    });
    await main('/synthetic.invalid/entry');
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(errors()[0]?.event).toBe('notification_worker_entry_failed');
    expect(process.exitCode).toBe(1);
  });
  it('executes the actual direct-entry branch only through mocked configuration', async () => {
    mocks.environment.mockImplementationOnce(() => {
      throw failure;
    });
    await main(fileURLToPath(new URL('../src/notification-worker.ts', import.meta.url)));
    expect(mocks.environment).toHaveBeenCalledOnce();
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(errors()[0]?.event).toBe('notification_worker_config_failed');
    expect(process.exitCode).toBe(1);
  });
});
