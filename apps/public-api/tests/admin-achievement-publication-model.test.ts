import { describe, expect, it } from 'vitest';
import {
  publicationPreparationInputSchema,
  publicationReviewSchema,
  publicationPreparationFailure
} from '../src/admin-achievement-publication.js';
const input = {
  expectedRevision: 1,
  expectedConfigHash: 'a'.repeat(64),
  expectedBaseHash: 'b'.repeat(64),
  expectedSourceHash: 'c'.repeat(64),
  reason: 'Synthetic release preparation',
  confirmed: true
};
describe('Strict pending-only publication contracts', () => {
  it('accepts only the saved revision/hashes and explicit confirmation, not caller config/identity/activation', () => {
    expect(publicationPreparationInputSchema.parse(input)).toEqual(input);
    for (const change of [
      { confirmed: false },
      { expectedRevision: 0 },
      { expectedRevision: '1' },
      { expectedConfigHash: 'bad' },
      { reason: '' },
      { reason: 'x\0' },
      { config: {} },
      { actor: 'forged' },
      { code: 'forged' },
      { candidateVersion: 1 },
      { activationEnabled: true },
      { awardingEnabled: true }
    ])
      expect(publicationPreparationInputSchema.safeParse({ ...input, ...change }).success).toBe(
        false
      );
  });
  it('never accepts a review claiming activation or awarding, and preserves an explicit blocked reason', () => {
    const review = {
      draftId: '11111111-1111-4111-8111-111111111111',
      revision: 1,
      subject: 'event',
      code: 'event_' + 'a'.repeat(32),
      year: null,
      configHash: input.expectedConfigHash,
      baseHash: input.expectedBaseHash,
      sourceHash: input.expectedSourceHash,
      effectiveDate: '2199-01-01',
      eligible: false,
      blockedReason: 'effective_date_not_future',
      phase: 'awaiting_activation_only',
      activationEnabled: false,
      awardingEnabled: false
    };
    expect(publicationReviewSchema.parse(review)).toEqual(review);
    expect(publicationReviewSchema.safeParse({ ...review, activationEnabled: true }).success).toBe(
      false
    );
    expect(publicationReviewSchema.safeParse({ ...review, awardingEnabled: true }).success).toBe(
      false
    );
  });
  it.each([
    ['publication preparation denied', 403],
    ['publication preparation conflict', 409],
    ['publication preparation blocked', 423],
    ['publication preparation capacity', 413],
    ['invalid publication preparation', 400],
    ['publication candidate unavailable', 404],
    ['untrusted database detail', 503]
  ] as const)('maps %s to %s without leaking internals', (message, status) => {
    const result = publicationPreparationFailure(new Error(message));
    expect(result.status).toBe(status);
    expect(result.code).not.toContain(message);
  });
});
