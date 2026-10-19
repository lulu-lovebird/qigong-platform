import type { PoolClient } from '@qigong/database';
import { z } from 'zod';
import { achievementCodeSchema } from './admin-achievements.js';
import { uiText } from './ui-localization.js';
import type { AdminLocale } from './admin-locale.js';
const text = (max: number) =>
  z.string().refine((value) => [...value].length <= max && !value.includes('\0'));
const date = z.iso.date().refine((value) => value >= '2000-01-01' && value <= '2201-12-31');
export const achievementKinds = [
  'streak',
  'total',
  'morning',
  'night',
  'combo',
  'method',
  'summer',
  'winter'
] as const;
const common = {
  nameZhTw: text(160).refine((value) => value.trim().length > 0),
  nameZhCn: text(160).default(''),
  nameEn: text(160).default(''),
  description: text(2000).default(''),
  effectiveDate: date
};
export const ruleDraftConfigSchema = z
  .object({
    ...common,
    threshold: z.number().int().min(1).max(10000),
    methodCodes: z
      .array(achievementCodeSchema)
      .max(100)
      .refine((codes) => new Set(codes).size === codes.length)
      .transform((codes) => [...codes].sort())
  })
  .strict();
export const activityDraftConfigSchema = z
  .object({
    ...common,
    startDate: date,
    endDate: date,
    timezone: z.string().min(1).max(100),
    requiredDays: z.number().int().min(1).max(367)
  })
  .strict()
  .refine(
    (value) =>
      value.effectiveDate === value.startDate &&
      value.endDate >= value.startDate &&
      value.requiredDays <=
        (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86400000 + 1 &&
      (Date.parse(value.endDate) - Date.parse(value.startDate)) / 86400000 <= 366
  );
// Keep absent flags absent when reading41 drafts: no default injection or hash change.
export const eventDraftConfigSchema = activityDraftConfigSchema.safeExtend({
  continuous: z.boolean().optional()
});
export type EventDraftConfig = z.infer<typeof eventDraftConfigSchema>;
export const challengeDraftConfigSchema = z
  .object({
    ...common,
    threshold: z.number().int().min(1).max(10000),
    continuous: z.boolean().default(false),
    methodCodes: z
      .array(achievementCodeSchema)
      .min(1)
      .max(100)
      .refine((codes) => new Set(codes).size === codes.length)
      .transform((codes) => [...codes].sort()),
    methodMatch: z.enum(['any', 'all']).default('any'),
    startMode: z.enum(['effective', 'date']).default('effective'),
    startDate: date.nullable().default(null)
  })
  .strict()
  .refine((value) =>
    value.startMode === 'effective'
      ? value.startDate === null
      : value.startDate !== null && value.startDate >= value.effectiveDate
  );
export type ChallengeDraftConfig = z.infer<typeof challengeDraftConfigSchema>;
export const draftConfigSchema = z.union([
  ruleDraftConfigSchema,
  activityDraftConfigSchema,
  eventDraftConfigSchema,
  challengeDraftConfigSchema
]);
const reason = text(1000).refine((value) => value.trim().length > 0);
const ruleInput = z
  .object({
    subject: z.literal('rule'),
    code: achievementCodeSchema.refine(
      (code) => !['seasonal_summer', 'seasonal_winter'].includes(code)
    ),
    year: z.null().default(null),
    config: ruleDraftConfigSchema,
    reason,
    expectedRevision: z.number().int().nonnegative()
  })
  .strict();
const activityInput = z
  .object({
    subject: z.literal('activity'),
    code: z.enum(['seasonal_summer', 'seasonal_winter']),
    year: z.number().int().min(2000).max(2200),
    config: activityDraftConfigSchema,
    reason,
    expectedRevision: z.number().int().nonnegative()
  })
  .strict();
const challengeCode = z.string().regex(/^challenge_[a-f0-9]{32}$/);
const challengeInput = z
  .object({
    subject: z.literal('challenge'),
    code: challengeCode.nullable(),
    year: z.null().default(null),
    config: challengeDraftConfigSchema,
    reason,
    expectedRevision: z.number().int().nonnegative()
  })
  .strict();
const eventInput = z
  .object({
    subject: z.literal('event'),
    code: z
      .string()
      .regex(/^event_[a-f0-9]{32}$/)
      .nullable(),
    year: z.null().default(null),
    config: eventDraftConfigSchema,
    reason,
    expectedRevision: z.number().int().nonnegative()
  })
  .strict();
export const achievementDraftInputSchema = z
  .discriminatedUnion('subject', [ruleInput, activityInput, challengeInput, eventInput])
  .refine(
    (value) =>
      !['challenge', 'event'].includes(value.subject) ||
      (value.expectedRevision === 0 ? value.code === null : value.code !== null)
  );
export type AchievementDraftInput = z.infer<typeof achievementDraftInputSchema>;
export type RuleDraftConfig = z.infer<typeof ruleDraftConfigSchema>;
export type ActivityDraftConfig = z.infer<typeof activityDraftConfigSchema>;
export const draftRevisionSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
export const archiveDraftInputSchema = draftRevisionSchema.extend({ reason }).strict();
export const managementQuerySchema = z
  .object({
    lang: z.enum(['zh_TW', 'zh_CN', 'en']).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1)
  })
  .strict();
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  count = z.number().int().min(0).max(5000);
export const managementDefinitionSchema = z
  .object({
    code: achievementCodeSchema,
    kind: z.enum(achievementKinds),
    name_zh_tw: z.string(),
    name_en: z.string(),
    threshold: z.number().int().positive(),
    method_codes: z.array(z.string()),
    rule_version: z.number().int().positive(),
    sort_order: z.number().int()
  })
  .strict();
const seasonSchema = z
  .object({
    kind: z.enum(['summer', 'winter']),
    year: z.number().int(),
    start_date: z.iso.date(),
    end_date: z.iso.date(),
    timezone: z.string(),
    required_days: z.number().int().positive()
  })
  .strict();
export const managementCatalogSchema = z
  .object({
    phase: z.literal('draft_preview_only'),
    canPublish: z.literal(false),
    definitions: z.array(managementDefinitionSchema).max(1000),
    seasons: z.array(seasonSchema),
    methods: z.array(
      z
        .object({
          code: z.string(),
          nameZhTw: z.string(),
          nameEn: z.string().nullable(),
          parentCode: z.string().nullable(),
          groupZhTw: z.string(),
          groupEn: z.string().nullable()
        })
        .strict()
    ),
    timezones: z.array(z.string()).max(2000)
  })
  .strict();
export type ManagementCatalog = z.infer<typeof managementCatalogSchema>;
export const managementPreviewSchema = z
  .object({
    draftId: z.uuid(),
    previewId: z.uuid().optional(),
    revision: z.number().int().positive(),
    code: achievementCodeSchema,
    subject: z.enum(['activity', 'rule', 'challenge', 'event']),
    year: z.number().int().nullable(),
    configHash: hash,
    baseHash: hash,
    observedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    effectiveDate: z.iso.date(),
    progressStartDate: z.iso.date().optional(),
    counts: z
      .object({
        population: count,
        currentlyAwarded: count,
        qualifyingAsOf: count,
        additionalQualifying: count,
        existingAwardsPreserved: count,
        wouldRevoke: z.literal(0)
      })
      .strict(),
    deadline: z
      .object({
        latestMakeupCutoff: z.iso.datetime({ offset: true }),
        settlementAt: z.iso.datetime({ offset: true }),
        timezoneCount: z.number().int().positive(),
        timezonePolicy: z.literal('all_supported_timezones'),
        timezoneHash: hash
      })
      .strict()
      .nullable(),
    awardableNow: count,
    continuous: z.boolean().optional(),
    publicationEnabled: z.literal(false)
  })
  .strict();
export type ManagementPreview = z.infer<typeof managementPreviewSchema>;
export const managementDraftSchema = z
  .object({
    id: z.uuid(),
    subject: z.enum(['activity', 'rule', 'challenge', 'event']),
    code: achievementCodeSchema,
    year: z.number().int().nullable(),
    config: draftConfigSchema,
    baseConfig: z
      .object({
        definition: managementDefinitionSchema.nullable(),
        season: seasonSchema.nullable()
      })
      .strict(),
    baseHash: hash,
    revision: z.number().int().positive(),
    state: z.enum(['draft', 'archived']),
    updatedAt: z.iso.datetime({ offset: true }),
    locked: z.boolean(),
    sourceChanged: z.boolean(),
    latestPreview: managementPreviewSchema.nullable()
  })
  .strict();
export type ManagementDraft = z.infer<typeof managementDraftSchema>;
export const managementDraftListSchema = z
  .object({
    page: z.number().int().positive(),
    limit: z.literal(20),
    total: z.number().int().nonnegative(),
    rows: z
      .array(
        z
          .object({
            id: z.uuid(),
            subject: z.enum(['activity', 'rule', 'challenge', 'event']),
            code: achievementCodeSchema,
            year: z.number().int().nullable(),
            name: z.string(),
            nameZhCn: z.string(),
            nameEn: z.string(),
            revision: z.number().int().positive(),
            state: z.enum(['draft', 'archived']),
            updatedAt: z.iso.datetime({ offset: true })
          })
          .strict()
      )
      .max(20)
  })
  .strict();
export const getManagementCatalog = async (client: PoolClient, locale: AdminLocale) => {
  const result = await client.query<{ data: unknown }>(
    'SELECT admin.achievement_management_catalog() data'
  );
  const data = managementCatalogSchema.parse(result.rows[0]?.data);
  return {
    ...data,
    definitions: data.definitions.map((d) => ({
      ...d,
      displayName: locale === 'en' ? d.name_en : uiText(locale, d.name_zh_tw)
    })),
    methods: data.methods.map((m) => ({
      ...m,
      displayName: locale === 'en' ? m.nameEn || m.nameZhTw : uiText(locale, m.nameZhTw),
      groupDisplayName: locale === 'en' ? m.groupEn || m.groupZhTw : uiText(locale, m.groupZhTw)
    }))
  };
};
export const getManagementDraft = async (client: PoolClient, id: string) =>
  managementDraftSchema.parse(
    (await client.query<{ data: unknown }>('SELECT admin.achievement_config_draft($1) data', [id]))
      .rows[0]?.data
  );
export const getManagementDrafts = async (client: PoolClient, page: number) =>
  managementDraftListSchema.parse(
    (
      await client.query<{ data: unknown }>('SELECT admin.achievement_config_drafts($1) data', [
        page
      ])
    ).rows[0]?.data
  );
export const saveManagementDraft = async (
  client: PoolClient,
  id: string | null,
  input: AchievementDraftInput
) =>
  managementDraftSchema.parse(
    (
      await client.query<{ data: unknown }>(
        'SELECT admin.save_achievement_config_draft($1,$2,$3,$4,$5,$6,$7) data',
        [
          id,
          input.expectedRevision,
          input.subject,
          input.code,
          input.year,
          JSON.stringify(input.config),
          input.reason
        ]
      )
    ).rows[0]?.data
  );
export const archiveManagementDraft = async (
  client: PoolClient,
  id: string,
  input: z.infer<typeof archiveDraftInputSchema>
) =>
  managementDraftSchema.parse(
    (
      await client.query<{ data: unknown }>(
        'SELECT admin.archive_achievement_config_draft($1,$2,$3) data',
        [id, input.expectedRevision, input.reason]
      )
    ).rows[0]?.data
  );
export const prepareManagementPreview = async (client: PoolClient, id: string, revision: number) =>
  managementPreviewSchema.parse(
    (
      await client.query<{ data: unknown }>(
        'SELECT admin.prepare_achievement_config_preview($1,$2) data',
        [id, revision]
      )
    ).rows[0]?.data
  );
export const achievementManagementFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (
    [
      'achievement management denied',
      'achievement access denied',
      'achievement scope unavailable'
    ].includes(message)
  )
    return { status: 403, code: 'achievement_management_denied' };
  if (message === 'achievement draft conflict')
    return { status: 409, code: 'achievement_draft_conflict' };
  if (message === 'achievement activity locked')
    return { status: 423, code: 'achievement_activity_locked' };
  if (['achievement configuration unavailable', 'achievement draft unavailable'].includes(message))
    return { status: 404, code: 'achievement_draft_unavailable' };
  if (message === 'achievement management capacity')
    return { status: 413, code: 'achievement_management_capacity' };
  if (message === 'achievement preview rate limited')
    return { status: 429, code: 'achievement_preview_rate_limited' };
  if (
    [
      'invalid achievement configuration',
      'invalid achievement query',
      'ambiguous activity deadline'
    ].includes(message)
  )
    return { status: 400, code: 'invalid_achievement_configuration' };
  return { status: 503, code: 'achievement_management_unavailable' };
};
