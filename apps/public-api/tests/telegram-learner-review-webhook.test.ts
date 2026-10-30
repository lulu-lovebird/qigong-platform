import { randomUUID } from 'node:crypto';
import pg from 'pg';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Review from '../src/telegram-learner-review.js';
import { handleTelegramLearnerReview } from '../src/telegram-learner-review.js';
import { registerTelegramOnboarding } from '../src/telegram-onboarding.js';
vi.mock('../src/telegram-learner-review.js', async (original) => ({
  ...(await original<typeof Review>()),
  handleTelegramLearnerReview: vi.fn(async () => true)
}));
const secret = 'synthetic-webhook-secret';
const pool = new pg.Pool();
let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify({ genReqId: () => randomUUID() });
  registerTelegramOnboarding(app, pool, {
    botToken: '59000:synthetic-token',
    webhookSecret: secret,
    regionCode: 'synthetic-region'
  });
  await app.ready();
});
afterEach(async () => {
  await app.close();
});
const inject = (payload: string | Record<string, unknown>, authenticated = true) =>
  app.inject({
    method: 'POST',
    url: '/telegram/onboarding/webhook',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { 'x-telegram-bot-api-secret-token': secret } : {})
    },
    payload
  });
describe('Review webhook ordering, authentication and body bounds', () => {
  it('authenticates before JSON parsing or callback handling', async () => {
    expect((await inject('{invalid-json', false)).statusCode).toBe(401);
    expect((await inject('{invalid-json')).statusCode).toBe(400);
    expect(handleTelegramLearnerReview).not.toHaveBeenCalled();
  });
  it('dispatches callback-only updates before the old message-only early return', async () => {
    const update = { update_id: 1, callback_query: { data: 'opaque-fixture' } };
    expect((await inject(update)).statusCode).toBe(200);
    expect(handleTelegramLearnerReview).toHaveBeenCalledWith(
      pool,
      expect.any(String),
      update,
      '59000',
      expect.any(Object),
      false
    );
  });
  it('keeps 32KiB body limit and rejects oversized callbacks before handling', async () => {
    expect(
      (await inject({ update_id: 1, callback_query: { data: 'X'.repeat(33000) } })).statusCode
    ).toBe(413);
    expect(handleTelegramLearnerReview).not.toHaveBeenCalled();
  });
  it('allows ordinary message routing to continue when the reason adapter declines the update', async () => {
    vi.mocked(handleTelegramLearnerReview).mockResolvedValueOnce(false);
    expect(
      (
        await inject({
          update_id: 2,
          message: {
            chat: { id: 59, type: 'private' },
            from: { id: 59, first_name: 'Synthetic' },
            text: 'ordinary unrelated chat'
          }
        })
      ).statusCode
    ).toBe(200);
    expect(handleTelegramLearnerReview).toHaveBeenCalledTimes(1);
  });
  it('contains SQL failures without echoing callback or PII', async () => {
    vi.mocked(handleTelegramLearnerReview).mockRejectedValueOnce(
      Error('synthetic@example.invalid SECRET')
    );
    const response = await inject({ update_id: 1, callback_query: {} });
    expect(response.statusCode).toBe(503);
    expect(response.body).toBe('{"error":"learner_review_unavailable"}');
  });
});
