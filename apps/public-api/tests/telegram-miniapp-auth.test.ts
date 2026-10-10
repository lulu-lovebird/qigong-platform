import { describe, it, expect } from 'vitest';
import { verifyTelegramMiniapp } from '../src/telegram-miniapp-auth.js';
const token = '123456:fake-bot-token-for-tests-only',
  now = 1800000000;
import { signMiniapp } from './telegram-miniapp-fixtures.js';
describe('Verified Telegram Mini App launch proof', () => {
  it('uses only a validated signed subject', () => {
    expect(verifyTelegramMiniapp(signMiniapp(token, 123456, now), token, now)).toEqual({
      subject: '123456',
      authDate: now
    });
  });
  it('rejects altered users, wrong bot and duplicate fields', () => {
    const proof = signMiniapp(token, 123456, now);
    expect(() => verifyTelegramMiniapp(proof.replace('123456', '654321'), token, now)).toThrow();
    expect(() => verifyTelegramMiniapp(proof, 'other-token', now)).toThrow();
    expect(() => verifyTelegramMiniapp(proof + '&user=%7B%22id%22%3A2%7D', token, now)).toThrow();
  });
  it('rejects old, future, unsafe identities and malformed proof', () => {
    for (const date of [now - 3601, now + 61])
      expect(() => verifyTelegramMiniapp(signMiniapp(token, 123456, date), token, now)).toThrow();
    for (const id of [0, -1, Number.MAX_SAFE_INTEGER + 1])
      expect(() => verifyTelegramMiniapp(signMiniapp(token, id, now), token, now)).toThrow();
    expect(() => verifyTelegramMiniapp('user=123456', token, now)).toThrow();
  });
});
