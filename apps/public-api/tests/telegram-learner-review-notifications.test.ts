import pg, { type PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Database from '@qigong/database';
import {
  buildTelegramLearnerReviewNotification,
  deliverTelegramLearnerReviews
} from '../src/telegram-learner-review-notifications.js';
import type { TelegramReviewTransport } from '../src/telegram-learner-review.js';
const fixture = vi.hoisted(
  (): { query: ReturnType<typeof vi.fn>; revoked: boolean; finished: unknown[][] } => ({
    query: vi.fn(),
    revoked: false,
    finished: []
  })
);
vi.mock('@qigong/database', async (original) => ({
  ...(await original<typeof Database>()),
  withRequestContext: async (
    _p: pg.Pool,
    _r: string,
    _c: unknown,
    callback: (client: PoolClient) => Promise<unknown>
  ) => callback({ query: fixture.query } as unknown as PoolClient)
}));
const pool = new pg.Pool();
const payload = {
  allowed: true as const,
  recipient: '548000000059',
  locale: 'en' as const,
  name: '<Self-report>\nFake field',
  nickname: 'Nickname',
  platform: 'line' as const,
  sourceId: 'U' + 'a'.repeat(32),
  phone: '+659900000059',
  email: 'synthetic@example.invalid',
  region: 'Synthetic region'
};
const transport: TelegramReviewTransport = {
  send: vi.fn(async () => 590),
  edit: vi.fn(async () => {}),
  answer: vi.fn(async () => {})
};
beforeEach(() => {
  vi.clearAllMocks();
  fixture.revoked = false;
  fixture.finished.length = 0;
  fixture.query.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.includes('claim_telegram'))
      return {
        rows: [
          { id: 'job-one', lease_id: 'lease-one' },
          { id: 'job-two', lease_id: 'lease-two' }
        ]
      };
    if (sql.includes('_payload'))
      return { rows: [{ data: fixture.revoked ? { allowed: false } : payload }] };
    fixture.finished.push(values);
    return { rows: [{ accepted: true }] };
  });
});
describe('Per-application private learner delivery', () => {
  it('distinguishes self-reports, source nickname and verified source identifier without inferring other accounts', () => {
    for (const locale of ['zh_TW', 'zh_CN', 'en'] as const) {
      const result = buildTelegramLearnerReviewNotification({ ...payload, locale }, 'X'.repeat(43));
      expect(result.text.length).toBeLessThan(4096);
      expect(result.buttons.flat()).toHaveLength(2);
      expect(JSON.stringify(result.buttons)).not.toContain(payload.sourceId);
      expect(JSON.stringify(result.buttons)).not.toContain(payload.name);
      expect(result.text).not.toContain('<Self-report>\nFake');
    }
    const text = buildTelegramLearnerReviewNotification(payload, 'X'.repeat(43)).text;
    expect(text).toContain('self-reported');
    expect(text).toContain('NOT a chosen LINE handle');
    expect(text).toContain('not end-to-end encrypted');
    expect(text).not.toContain('https://');
  });
  it('obtains a fresh payload/token per application and acknowledges accepted message IDs separately', async () => {
    const failure = vi.fn();
    expect(await deliverTelegramLearnerReviews(pool, transport, failure)).toBe(2);
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(fixture.finished).toEqual([
      ['job-one', 'lease-one', 590],
      ['job-two', 'lease-two', 590]
    ]);
    const tokens = fixture.query.mock.calls
      .filter(([sql]) => String(sql).includes('_payload'))
      .map(([, values]) => (values as unknown[])[2]);
    expect(new Set(tokens).size).toBe(2);
    expect(failure).not.toHaveBeenCalled();
  });
  it('never sends a revoked or malformed payload and only emits scrubbed diagnostics', async () => {
    fixture.revoked = true;
    const failure = vi.fn();
    await deliverTelegramLearnerReviews(pool, transport, failure);
    expect(transport.send).not.toHaveBeenCalled();
    expect(fixture.finished.every((values) => values[2] === null)).toBe(true);
    expect(
      failure.mock.calls
        .flat()
        .map((v) => String(v))
        .join()
    ).not.toMatch(/synthetic@example|548000000059|lease-one|job-one/);
  });
  it('does not retry sends immediately after ambiguous timeouts or lost acknowledgements', async () => {
    vi.mocked(transport.send).mockRejectedValueOnce(Error('Synthetic token URL with PII'));
    const failure = vi.fn();
    await deliverTelegramLearnerReviews(pool, transport, failure);
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(fixture.finished[0]?.[2]).toBeNull();
    expect(failure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Private learner review delivery unavailable' })
    );
    fixture.query.mockImplementation(async (sql: string) => {
      if (sql.includes('claim_telegram')) return { rows: [{ id: 'one', lease_id: 'lease' }] };
      if (sql.includes('_payload')) return { rows: [{ data: payload }] };
      throw Error('Synthetic ack failure');
    });
    await deliverTelegramLearnerReviews(pool, transport, failure);
    expect(transport.send).toHaveBeenCalledTimes(3);
    expect(failure).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'Private learner review acknowledgement unavailable' })
    );
  });
});
