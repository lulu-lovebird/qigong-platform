import { afterEach, describe, expect, it, vi } from 'vitest';
import { learnerLocale, learnerTexts } from '../src/learner-locale.js';
import { createTelegramNotificationSender } from '../src/onboarding-notifications.js';

afterEach(() => vi.unstubAllGlobals());
describe('learner localization', () => {
  it('has complete nonempty dictionaries and safe locale fallback', () => {
    expect(Object.keys(learnerTexts('en')).sort()).toEqual(
      Object.keys(learnerTexts('zh_TW')).sort()
    );
    for (const locale of ['en', 'zh_TW'] as const)
      for (const text of Object.values(learnerTexts(locale)))
        expect(text.length).toBeGreaterThan(0);
    expect(learnerLocale('en')).toBe('en');
    for (const value of [undefined, 'fr', '<script>', {}, null])
      expect(learnerLocale(value)).toBe('zh_TW');
  });
  it.each(['approved', 'rejected'] as const)(
    'sends an English %s decision through the existing retry-compatible sender',
    async (decision) => {
      const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true })));
      vi.stubGlobal('fetch', fetchMock);
      await createTelegramNotificationSender('mock-token')('88888', decision, 'en');
      const body = fetchMock.mock.calls[0]?.[1]?.body;
      if (typeof body !== 'string') throw new Error('Expected JSON message');
      const payload: unknown = JSON.parse(body);
      expect(payload).toMatchObject({
        chat_id: '88888',
        text:
          decision === 'approved'
            ? learnerTexts('en').notificationApproved
            : learnerTexts('en').notificationRejected
      });
    }
  );
});
