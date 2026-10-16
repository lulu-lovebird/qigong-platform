import { describe, expect, it } from 'vitest';
import { telegramProfileDisplayName } from '../src/telegram-profile.js';
describe('Verified Telegram display metadata normalization', () => {
  it('keeps provider display names verbatim, never converting or interpreting markup', () => {
    expect(
      telegramProfileDisplayName({
        first_name: ' 已儲存😀 ',
        last_name: '<b>原文</b>',
        username: 'metadata_only'
      })
    ).toBe('已儲存😀 <b>原文</b>');
  });
  it('uses a provider username only when no first name was supplied', () => {
    expect(telegramProfileDisplayName({ username: 'synthetic_user' })).toBe('@synthetic_user');
    expect(telegramProfileDisplayName({ id: 123 })).toBeUndefined();
  });
  it('never falls back to application, legal or browser display-name fields', () => {
    expect(
      telegramProfileDisplayName({
        name: '報名姓名',
        displayName: 'Browser name',
        learner_name: '私人姓名',
        email: 'synthetic@example.invalid'
      })
    ).toBeUndefined();
  });
  it.each([
    { first_name: 'a\0b' },
    { first_name: 'a\nb' },
    { first_name: 'a\u007fb' },
    { first_name: 42 },
    { first_name: '字'.repeat(151) },
    { first_name: 'Bot', is_bot: true },
    { username: '@invalid' },
    { first_name: '字'.repeat(140), last_name: '字'.repeat(11) }
  ])('omits malformed display metadata without making it identity authority: %j', (value) => {
    expect(telegramProfileDisplayName(value)).toBeUndefined();
  });
});
