import type { Pool, PoolClient } from '@qigong/database';
import { withRequestContext } from '@qigong/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deliverOnboardingNotifications,
  type NotificationSender,
  type PendingNotification
} from '../src/onboarding-notifications.js';

const mock = vi.hoisted(() => ({
  query: vi.fn<(sql: string, values: readonly unknown[]) => Promise<{ rows: unknown[] }>>()
}));
vi.mock('@qigong/database', () => ({
  withRequestContext: vi.fn(
    async <Result>(
      _pool: Pool,
      _role: string,
      _context: unknown,
      callback: (client: PoolClient) => Promise<Result>
    ): Promise<Result> => {
      // A deliberately query-only synthetic client. No connection is acquired.
      const client = { query: mock.query } as unknown as PoolClient;
      return callback(client);
    }
  )
}));

const pool = {} as Pool;
const sentinel = 'synthetic-private-notification-sentinel';
const subject = 'learner@synthetic.invalid';
const notification = (
  platform: string,
  decision: PendingNotification['decision'] = 'approved'
): PendingNotification => ({
  id: '123e4567-e89b-42d3-a456-426614174000',
  lease_id: '123e4567-e89b-42d3-a456-426614174001',
  platform,
  external_subject_id: subject,
  decision
});
let rows: PendingNotification[];
let locale: string;
let allowed: boolean;
let accepted: boolean;
let preferenceFailure: { error: unknown } | undefined;
const telegram = vi.fn<NotificationSender>();
const line = vi.fn<NotificationSender>();
const whatsapp = vi.fn<NotificationSender>();
const onError = vi.fn<(error: unknown, id: string) => void>();
const finishes = () =>
  mock.query.mock.calls.filter(
    ([sql]) => sql === 'SELECT ops.finish_onboarding_notification($1, $2, $3, $4) AS accepted'
  );

beforeEach(() => {
  vi.clearAllMocks();
  rows = [notification('telegram')];
  locale = 'en';
  allowed = true;
  accepted = true;
  preferenceFailure = undefined;
  telegram.mockResolvedValue(undefined);
  line.mockResolvedValue(undefined);
  whatsapp.mockResolvedValue(undefined);
  mock.query.mockImplementation(async (sql) => {
    if (sql === 'SELECT * FROM ops.claim_onboarding_notifications($1)') return { rows };
    if (sql.includes('get_identity_locale')) {
      if (preferenceFailure) throw preferenceFailure.error;
      return { rows: [{ locale, allowed }] };
    }
    if (sql === 'SELECT ops.finish_onboarding_notification($1, $2, $3, $4) AS accepted')
      return { rows: [{ accepted }] };
    throw new Error('Unexpected synthetic query');
  });
});

const run = (batchSize = 10) =>
  deliverOnboardingNotifications(pool, telegram, onError, batchSize, line, whatsapp);
const getter = vi.fn(() => {
  throw new Error(sentinel);
});
const malicious = Object.defineProperties(
  {},
  {
    code: { get: getter },
    message: { get: getter },
    name: { get: getter },
    cause: { get: getter },
    toJSON: { get: getter }
  }
);
const proxy = new Proxy(
  {},
  { getOwnPropertyDescriptor: getter, get: getter, getPrototypeOf: getter }
);
const circular: { cause?: unknown } = {};
circular.cause = circular;
const failureCases: readonly (readonly [string, unknown, string])[] = [
  ['native error', new Error(sentinel), 'internal'],
  ['primitive', sentinel, 'internal'],
  ['undefined', undefined, 'internal'],
  ['null', null, 'internal'],
  [
    'PG',
    Object.assign(new Error(sentinel), {
      code: '23505',
      detail: sentinel,
      query: sentinel,
      parameters: [sentinel]
    }),
    'database:23505'
  ],
  ['network', { code: 'ETIMEDOUT', response: { body: sentinel } }, 'network:ETIMEDOUT'],
  ['unlisted code', { code: sentinel, name: sentinel, status: 401 }, 'internal'],
  ['malicious accessor', malicious, 'internal'],
  ['proxy', proxy, 'internal'],
  ['cause', new Error(sentinel, { cause: { code: '23505', message: sentinel } }), 'internal'],
  [
    'aggregate',
    new AggregateError([{ code: 'ECONNRESET', message: sentinel }], sentinel),
    'internal'
  ],
  ['circular', circular, 'internal']
];

describe.each(['telegram', 'line', 'whatsapp'])('%s new persisted diagnostics', (platform) => {
  it.each(failureCases)(
    'stores only bounded classification for %s and preserves original callback',
    async (_label, thrown, classification) => {
      rows = [notification(platform)];
      const sender = platform === 'telegram' ? telegram : platform === 'line' ? line : whatsapp;
      sender.mockRejectedValueOnce(thrown);
      expect(await run(7)).toBe(1);
      expect(mock.query).toHaveBeenNthCalledWith(
        1,
        'SELECT * FROM ops.claim_onboarding_notifications($1)',
        [7]
      );
      expect(sender).toHaveBeenCalledExactlyOnceWith(subject, 'approved', 'en');
      expect(finishes()).toEqual([
        [
          'SELECT ops.finish_onboarding_notification($1, $2, $3, $4) AS accepted',
          [rows[0]!.id, rows[0]!.lease_id, false, classification]
        ]
      ]);
      expect(onError).toHaveBeenCalledOnce();
      expect(onError.mock.calls[0]?.[0]).toBe(thrown);
      expect(onError.mock.calls[0]?.[1]).toBe(rows[0]!.id);
      const diagnostic = finishes()[0]?.[1][3];
      expect(typeof diagnostic).toBe('string');
      expect(String(diagnostic).length).toBeLessThan(64);
      expect(diagnostic).not.toContain(sentinel);
      expect(diagnostic).not.toContain(subject);
    }
  );

  it('preserves successful decision, locale, lease, null failure and accepted=false callback', async () => {
    rows = [notification(platform, 'rejected')];
    locale = 'zh_CN';
    accepted = false;
    const sender = platform === 'telegram' ? telegram : platform === 'line' ? line : whatsapp;
    expect(await run()).toBe(1);
    expect(sender).toHaveBeenCalledExactlyOnceWith(subject, 'rejected', 'zh_CN');
    expect(finishes()[0]?.[1]).toEqual([rows[0]!.id, rows[0]!.lease_id, true, null]);
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'Notification lease expired' }),
      rows[0]!.id
    );
    const preferences = mock.query.mock.calls.filter(([sql]) =>
      sql.includes('get_identity_locale')
    );
    expect(preferences).toEqual([
      [
        platform === 'telegram'
          ? "SELECT platform.get_identity_locale('telegram',$1) AS locale"
          : platform === 'line'
            ? "SELECT platform.get_identity_locale('line',$1) locale"
            : "SELECT platform.get_identity_locale('whatsapp',$1) AS locale, platform.whatsapp_notification_allowed($1) AS allowed",
        [subject]
      ]
    ]);
  });
});

describe('delivery control-flow compatibility (mocked SQL only)', () => {
  it('never evaluates error accessors for classification', async () => {
    telegram.mockRejectedValueOnce(malicious);
    await run();
    expect(getter).not.toHaveBeenCalled();
    expect(finishes()[0]?.[1][3]).toBe('internal');
  });

  it('classifies locale lookup errors without sending or changing the callback', async () => {
    const thrown = { code: '08006', message: sentinel };
    preferenceFailure = { error: thrown };
    expect(await run()).toBe(1);
    expect(telegram).not.toHaveBeenCalled();
    expect(finishes()[0]?.[1]).toEqual([rows[0]!.id, rows[0]!.lease_id, false, 'database:08006']);
    expect(onError).toHaveBeenCalledExactlyOnceWith(thrown, rows[0]!.id);
  });

  it('keeps WhatsApp consent gating and stores a generic failure when absent', async () => {
    rows = [notification('whatsapp')];
    allowed = false;
    expect(await run()).toBe(1);
    expect(whatsapp).not.toHaveBeenCalled();
    expect(finishes()[0]?.[1]).toEqual([rows[0]!.id, rows[0]!.lease_id, false, 'internal']);
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'WhatsApp notification consent unavailable' }),
      rows[0]!.id
    );
  });

  it.each(['unsupported', 'line', 'whatsapp'])(
    'does not send unsupported/missing %s sender',
    async (platform) => {
      rows = [notification(platform)];
      expect(await deliverOnboardingNotifications(pool, telegram, onError)).toBe(1);
      expect(telegram).not.toHaveBeenCalled();
      expect(line).not.toHaveBeenCalled();
      expect(whatsapp).not.toHaveBeenCalled();
      expect(finishes()[0]?.[1][3]).toBe('internal');
      expect(onError).toHaveBeenCalledOnce();
      expect(mock.query).toHaveBeenCalledTimes(2);
    }
  );

  it('preserves batch count and worker contexts across all three successful channels without adding consent checks elsewhere', async () => {
    rows = [notification('telegram'), notification('line'), notification('whatsapp')];
    locale = 'unrecognized';
    expect(await run(3)).toBe(3);
    for (const sender of [telegram, line, whatsapp])
      expect(sender).toHaveBeenCalledExactlyOnceWith(subject, 'approved', 'zh_TW');
    expect(finishes()).toHaveLength(3);
    expect(finishes().map(([, values]) => values.slice(2))).toEqual([
      [true, null],
      [true, null],
      [true, null]
    ]);
    expect(onError).not.toHaveBeenCalled();
    expect(withRequestContext).toHaveBeenCalledTimes(7);
    for (const [actualPool, role, context] of vi.mocked(withRequestContext).mock.calls) {
      expect(actualPool).toBe(pool);
      expect(role).toBe('qigong_worker_runtime');
      expect(context).toEqual({ requestId: expect.any(String) });
    }
    expect(
      mock.query.mock.calls.filter(([sql]) => sql.includes('whatsapp_notification_allowed'))
    ).toHaveLength(1);
  });

  it('keeps both delivery failure and rejected lease callbacks, without retrying', async () => {
    accepted = false;
    telegram.mockRejectedValueOnce(sentinel);
    expect(await run()).toBe(1);
    expect(telegram).toHaveBeenCalledOnce();
    expect(finishes()).toHaveLength(1);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenNthCalledWith(1, sentinel, rows[0]!.id);
    expect(onError).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: 'Notification lease expired' }),
      rows[0]!.id
    );
  });

  it('does not finish or send when the claim is empty', async () => {
    rows = [];
    expect(await run()).toBe(0);
    expect(mock.query).toHaveBeenCalledTimes(1);
    expect(finishes()).toEqual([]);
    expect(telegram).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
