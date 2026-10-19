import { describe, expect, it } from 'vitest';
import {
  achievementDraftInputSchema,
  activityDraftConfigSchema,
  ruleDraftConfigSchema,
  challengeDraftConfigSchema,
  managementPreviewSchema,
  achievementManagementFailure
} from '../src/admin-achievement-management.js';
const common = {
  nameZhTw: '合成草稿',
  nameZhCn: '',
  nameEn: 'Synthetic draft',
  description: '',
  effectiveDate: '2027-12-01'
};
describe('Strict draft-only achievement management contracts', () => {
  it('normalizes leaf code order without mutating the caller or translating source text', () => {
    const input = { ...common, threshold: 7, methodCodes: ['dayan_gao', 'dayan_chu'] },
      before = JSON.stringify(input),
      result = ruleDraftConfigSchema.parse(input);
    expect(result.methodCodes).toEqual(['dayan_chu', 'dayan_gao']);
    expect(result.nameZhTw).toBe(input.nameZhTw);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('accepts a cross-year activity and requires the new progress effective date to equal its start', () => {
    const value = {
      ...common,
      startDate: '2027-12-01',
      endDate: '2028-01-05',
      timezone: 'Asia/Taipei',
      requiredDays: 27
    };
    expect(activityDraftConfigSchema.safeParse(value).success).toBe(true);
    for (const bad of [
      { ...value, effectiveDate: '2027-11-30' },
      { ...value, endDate: '2027-11-30' },
      { ...value, requiredDays: 100 },
      { ...value, endDate: '2029-01-01' }
    ])
      expect(activityDraftConfigSchema.safeParse(bad).success).toBe(false);
  });
  it.each([
    { threshold: 0 },
    { threshold: 1.2 },
    { threshold: 10001 },
    { effectiveDate: '2027-02-30' },
    { effectiveDate: '1999-01-01' },
    { methodCodes: ['dayan_chu', 'dayan_chu'] },
    { nameZhTw: '' },
    { nameZhTw: 'x\0' },
    { unknown: true }
  ])('rejects invalid rule configuration %j', (bad) => {
    expect(
      ruleDraftConfigSchema.safeParse({ ...common, threshold: 7, methodCodes: [], ...bad }).success
    ).toBe(false);
  });
  it('does not accept identity overrides, publication flags, executable expressions or seasonal edits through a rule payload', () => {
    const input = {
      subject: 'rule',
      code: 'streak_3',
      year: null,
      config: { ...common, threshold: 3, methodCodes: [] },
      expectedRevision: 0,
      reason: 'Synthetic reason'
    };
    expect(achievementDraftInputSchema.safeParse(input).success).toBe(true);
    for (const bad of [
      { ...input, principalId: 'forged' },
      { ...input, publish: true },
      { ...input, code: 'seasonal_winter' },
      { ...input, config: { ...input.config, expression: 'SELECT private_data' } },
      { ...input, reason: ' ' },
      { ...input, expectedRevision: -1 }
    ])
      expect(achievementDraftInputSchema.safeParse(bad).success).toBe(false);
  });
  it('bounds Unicode by code points rather than silently truncating an input', () => {
    expect(
      ruleDraftConfigSchema.safeParse({
        ...common,
        nameZhTw: '😀'.repeat(160),
        threshold: 3,
        methodCodes: []
      }).success
    ).toBe(true);
    expect(
      ruleDraftConfigSchema.safeParse({
        ...common,
        nameZhTw: '😀'.repeat(161),
        threshold: 3,
        methodCodes: []
      }).success
    ).toBe(false);
  });
  it('never validates a preview that claims publication, revocation or a personal-data roster', () => {
    const p = {
      draftId: '11111111-1111-4111-8111-111111111111',
      revision: 1,
      code: 'streak_3',
      subject: 'rule',
      year: null,
      configHash: 'a'.repeat(64),
      baseHash: 'b'.repeat(64),
      observedAt: '2027-01-01T00:00:00Z',
      expiresAt: '2027-01-01T00:10:00Z',
      effectiveDate: '2027-01-01',
      counts: {
        population: 2,
        currentlyAwarded: 1,
        qualifyingAsOf: 0,
        additionalQualifying: 0,
        existingAwardsPreserved: 1,
        wouldRevoke: 0
      },
      deadline: null,
      awardableNow: 0,
      publicationEnabled: false
    };
    expect(managementPreviewSchema.safeParse(p).success).toBe(true);
    for (const value of [
      { ...p, publicationEnabled: true },
      { ...p, rows: [{ phone: 'synthetic' }] },
      { ...p, counts: { ...p.counts, wouldRevoke: 1 } }
    ])
      expect(managementPreviewSchema.safeParse(value).success).toBe(false);
  });
  it('separates a fresh method badge from revisions of existing definitions and defaults to cumulative rule-effective progress', () => {
    const cfg = challengeDraftConfigSchema.parse({
      ...common,
      threshold: 30,
      methodCodes: ['huichun_zhong', 'huichun_chu']
    });
    expect(cfg).toMatchObject({
      continuous: false,
      methodMatch: 'any',
      startMode: 'effective',
      startDate: null
    });
    expect(cfg.methodCodes).toEqual(['huichun_chu', 'huichun_zhong']);
    expect(
      achievementDraftInputSchema.safeParse({
        subject: 'challenge',
        code: null,
        year: null,
        config: cfg,
        expectedRevision: 0,
        reason: 'Synthetic new rule'
      }).success
    ).toBe(true);
    expect(
      achievementDraftInputSchema.safeParse({
        subject: 'challenge',
        code: 'challenge_' + 'a'.repeat(32),
        year: null,
        config: cfg,
        expectedRevision: 1,
        reason: 'Synthetic edit'
      }).success
    ).toBe(true);
    expect(
      achievementDraftInputSchema.safeParse({
        subject: 'challenge',
        code: 'method_huichun_30',
        year: null,
        config: cfg,
        expectedRevision: 0,
        reason: 'Synthetic invalid'
      }).success
    ).toBe(false);
    expect(
      achievementDraftInputSchema.safeParse({
        subject: 'challenge',
        code: null,
        year: null,
        config: cfg,
        expectedRevision: 1,
        reason: 'Synthetic invalid'
      }).success
    ).toBe(false);
  });
  it.each([
    { methodCodes: [] },
    { methodCodes: ['huichun_chu', 'huichun_chu'] },
    { continuous: 'true' },
    { methodMatch: 'expression' },
    { startMode: 'all_history' },
    { startMode: 'effective', startDate: '2027-12-01' },
    { startMode: 'date', startDate: null },
    { startMode: 'date', startDate: '2027-11-30' }
  ])('rejects invalid new-rule method badge configuration %j', (extra) => {
    expect(
      challengeDraftConfigSchema.safeParse({
        ...common,
        threshold: 30,
        methodCodes: ['huichun_chu'],
        ...extra
      }).success
    ).toBe(false);
  });
  it('makes consecutive and later explicit starts independent options without mutating the simulated rule effective day', () => {
    const cfg = challengeDraftConfigSchema.parse({
      ...common,
      threshold: 30,
      methodCodes: ['huichun_chu'],
      continuous: true,
      methodMatch: 'all',
      startMode: 'date',
      startDate: '2028-01-01'
    });
    expect(cfg.effectiveDate).toBe('2027-12-01');
    expect(cfg.startDate).toBe('2028-01-01');
    expect(cfg.continuous).toBe(true);
  });
  it('maps only known failure states without exposing SQL diagnostics', () => {
    expect(achievementManagementFailure(Error('achievement draft conflict'))).toEqual({
      status: 409,
      code: 'achievement_draft_conflict'
    });
    expect(achievementManagementFailure(Error('achievement activity locked')).status).toBe(423);
    expect(achievementManagementFailure(Error('PRIVATE SQL WITH CONTACT DATA'))).toEqual({
      status: 503,
      code: 'achievement_management_unavailable'
    });
  });
});
