import type { PoolClient } from '@qigong/database';
import { z } from 'zod';
import { achievementCodeSchema } from './admin-achievements.js';
import {
  draftConfigSchema,
  managementDraftSchema,
  managementPreviewSchema
} from './admin-achievement-management.js';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().min(1).max(2147483647);
const subject = z.enum(['rule', 'activity', 'challenge', 'event']);
const reason = z
  .string()
  .refine((value) => [...value].length <= 1000 && value.trim().length > 0 && !value.includes('\0'));
export const publicationPreparationInputSchema = z
  .object({
    expectedRevision: integer,
    expectedConfigHash: hash,
    expectedBaseHash: hash,
    expectedSourceHash: hash,
    reason,
    confirmed: z.literal(true)
  })
  .strict();
export type PublicationPreparationInput = z.infer<typeof publicationPreparationInputSchema>;
export const publicationReviewSchema = z
  .object({
    draftId: z.uuid(),
    revision: integer,
    subject,
    code: achievementCodeSchema,
    year: z.number().int().nullable(),
    configHash: hash,
    baseHash: hash,
    sourceHash: hash,
    effectiveDate: z.iso.date(),
    eligible: z.boolean(),
    blockedReason: z
      .enum([
        'archived',
        'source_changed',
        'activity_started',
        'effective_date_not_future',
        'activity_year_mismatch'
      ])
      .nullable(),
    phase: z.literal('awaiting_activation_only'),
    activationEnabled: z.literal(false),
    awardingEnabled: z.literal(false)
  })
  .strict();
export const achievementActivationInputSchema = z
  .object({ expectedSnapshotHash: hash, reason, confirmed: z.literal(true) })
  .strict();
export type AchievementActivationInput = z.infer<typeof achievementActivationInputSchema>;
export const achievementActivationReviewSchema = z
  .object({
    id: z.uuid(),
    code: achievementCodeSchema,
    ruleVersion: integer,
    snapshotHash: hash,
    draftRevision: integer,
    effectiveDate: z.iso.date(),
    eligible: z.boolean(),
    blockedReason: z.string().nullable(),
    registered: z.boolean(),
    cancelled: z.boolean(),
    runtimeEnabled: z.literal(true)
  })
  .strict();
export const publicationCandidateSchema = z
  .object({
    id: z.uuid(),
    draftId: z.uuid(),
    draftRevision: integer,
    code: achievementCodeSchema,
    candidateVersion: integer,
    subject,
    year: z.number().int().nullable(),
    configHash: hash,
    baseHash: hash,
    sourceHash: hash,
    snapshotHash: hash,
    effectiveDate: z.iso.date(),
    preparedAt: z.iso.datetime({ offset: true }),
    state: z.literal('awaiting_activation'),
    activationEnabled: z.literal(false),
    awardingEnabled: z.literal(false),
    stale: z.boolean(),
    activation: z
      .object({
        registered: z.literal(true),
        cancelled: z.boolean(),
        state: z.enum(['scheduled', 'published', 'cancelled'])
      })
      .nullable()
      .optional(),
    snapshot: z
      .object({
        formatVersion: z.literal(1),
        draftId: z.uuid(),
        draftRevision: integer,
        code: achievementCodeSchema,
        candidateVersion: integer,
        subject,
        year: z.number().int().nullable(),
        config: draftConfigSchema,
        baseConfig: managementDraftSchema.shape.baseConfig,
        baseHash: hash,
        sourceHash: hash,
        configHash: hash,
        timezoneSnapshot: z.array(z.string()).max(2000),
        deadline: managementPreviewSchema.shape.deadline,
        effectiveDate: z.iso.date(),
        state: z.literal('awaiting_activation'),
        activationEnabled: z.literal(false),
        awardingEnabled: z.literal(false)
      })
      .strict()
  })
  .strict();
export const publicationCandidateListSchema = z
  .object({
    page: integer,
    limit: z.literal(20),
    total: z.number().int().min(0).max(5000),
    rows: z.array(publicationCandidateSchema).max(20)
  })
  .strict();
export const canPreparePublication = async (client: PoolClient): Promise<boolean> => {
  const installed =
    (
      await client.query<{ ready: boolean }>(
        "SELECT to_regprocedure('admin.can_prepare_achievement_publication_now()') IS NOT NULL ready"
      )
    ).rows[0]?.ready === true;
  return (
    installed &&
    (
      await client.query<{ allowed: boolean }>(
        'SELECT admin.can_prepare_achievement_publication_now() allowed'
      )
    ).rows[0]?.allowed === true
  );
};
export const canActivatePublication = async (client: PoolClient): Promise<boolean> => {
  const installed =
    (
      await client.query<{ ready: boolean }>(
        "SELECT to_regprocedure('admin.can_activate_achievement_now()') IS NOT NULL ready"
      )
    ).rows[0]?.ready === true;
  return (
    installed &&
    (
      await client.query<{ allowed: boolean }>(
        'SELECT admin.can_activate_achievement_now() allowed'
      )
    ).rows[0]?.allowed === true
  );
};
export const getActivationReview = async (client: PoolClient, id: string) =>
  achievementActivationReviewSchema.parse(
    (
      await client.query<{ data: unknown }>('SELECT admin.achievement_activation_review($1) data', [
        id
      ])
    ).rows[0]?.data
  );
export const activatePublication = async (
  client: PoolClient,
  id: string,
  input: AchievementActivationInput
) =>
  achievementActivationReviewSchema.parse(
    (
      await client.query<{ data: unknown }>(
        'SELECT admin.activate_achievement_version($1,$2,$3,$4) data',
        [id, input.expectedSnapshotHash, input.reason, input.confirmed]
      )
    ).rows[0]?.data
  );
export const cancelPublicationActivation = async (
  client: PoolClient,
  id: string,
  input: AchievementActivationInput
) =>
  achievementActivationReviewSchema.parse(
    (
      await client.query<{ data: unknown }>(
        'SELECT admin.cancel_achievement_activation($1,$2,$3,$4) data',
        [id, input.expectedSnapshotHash, input.reason, input.confirmed]
      )
    ).rows[0]?.data
  );
export const getPublicationReview = async (client: PoolClient, id: string) =>
  publicationReviewSchema.parse(
    (
      await client.query<{ data: unknown }>(
        'SELECT admin.achievement_publication_review($1) data',
        [id]
      )
    ).rows[0]?.data
  );
export const getPublicationCandidate = async (client: PoolClient, id: string) =>
  publicationCandidateSchema.parse(
    (
      await client.query<{ data: unknown }>(
        'SELECT admin.achievement_publication_candidate($1) data',
        [id]
      )
    ).rows[0]?.data
  );
export const getPublicationCandidates = async (client: PoolClient, page: number) =>
  publicationCandidateListSchema.parse(
    (
      await client.query<{ data: unknown }>(
        'SELECT admin.achievement_publication_candidates($1) data',
        [page]
      )
    ).rows[0]?.data
  );
export const preparePublication = async (
  client: PoolClient,
  id: string,
  input: PublicationPreparationInput
) =>
  publicationCandidateSchema.parse(
    (
      await client.query<{ data: unknown }>(
        'SELECT admin.prepare_achievement_publication($1,$2,$3,$4,$5,$6,$7) data',
        [
          id,
          input.expectedRevision,
          input.expectedConfigHash,
          input.expectedBaseHash,
          input.expectedSourceHash,
          input.reason,
          input.confirmed
        ]
      )
    ).rows[0]?.data
  );
export const publicationPreparationFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'achievement activation denied')
    return { status: 403, code: 'achievement_activation_denied' };
  if (message === 'achievement activation conflict')
    return { status: 409, code: 'achievement_activation_conflict' };
  if (message === 'achievement activation blocked')
    return { status: 423, code: 'achievement_activation_blocked' };
  if (message === 'invalid achievement activation')
    return { status: 400, code: 'invalid_achievement_activation' };
  if (message === 'publication preparation denied')
    return { status: 403, code: 'publication_preparation_denied' };
  if (message === 'publication preparation conflict')
    return { status: 409, code: 'publication_preparation_conflict' };
  if (message === 'publication preparation blocked')
    return { status: 423, code: 'publication_preparation_blocked' };
  if (message === 'publication preparation capacity')
    return { status: 413, code: 'publication_preparation_capacity' };
  if (message === 'invalid publication preparation')
    return { status: 400, code: 'invalid_publication_preparation' };
  if (
    message === 'publication candidate unavailable' ||
    message === 'achievement draft unavailable'
  )
    return { status: 404, code: 'publication_preparation_unavailable' };
  return { status: 503, code: 'publication_preparation_unavailable' };
};
