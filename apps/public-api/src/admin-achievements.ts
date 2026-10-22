import type { PoolClient } from '@qigong/database';
import { z } from 'zod';
import { localeSchema } from './ui-localization.js';
import { localizeSystemLabels } from './system-label-localization.js';
import type { AdminLocale } from './admin-locale.js';
import { hasAchievementVersions } from './achievement-version-compat.js';
import { addLegacyBadgeDisplayNames } from './legacy-badge-names.js';
export const achievementQuerySchema = z
  .object({
    lang: localeSchema.optional(),
    region: z.uuid().optional(),
    platform: z.enum(['line', 'telegram', 'whatsapp']).optional(),
    q: z
      .string()
      .trim()
      .refine((value) => [...value].length <= 100 && !value.includes('\0'))
      .default(''),
    year: z.coerce.number().int().min(2000).max(2200).optional(),
    version: z
      .preprocess(
        (value) =>
          typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : value,
        z.number().int().min(1).max(2147483647)
      )
      .optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20)
  })
  .strict();
export type AchievementQuery = z.infer<typeof achievementQuerySchema>;
export const achievementCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,79}$/);
const count = z.number().int().nonnegative();
const award = z.object({
  period: z.string(),
  ruleVersion: z.number().int().positive(),
  earnedAt: z.iso.datetime({ offset: true })
});
export const achievementCatalogSchema = z.object({
  readOnly: z.literal(true),
  observedAt: z.iso.datetime({ offset: true }),
  seasonYear: z.number().int().nullable(),
  regions: z.array(z.object({ id: z.uuid(), name: z.string() })),
  badges: z.array(
    z.object({
      code: achievementCodeSchema,
      kind: z.enum([
        'streak',
        'total',
        'morning',
        'night',
        'method',
        'combo',
        'summer',
        'winter',
        'event',
        'challenge'
      ]),
      provenance: z.string().nullable().optional(),
      continuous: z.boolean().optional(),
      methodMatch: z.enum(['any', 'all']).optional(),
      effectiveDate: z.iso.date().optional(),
      startDate: z.iso.date().nullable().optional(),
      endDate: z.iso.date().nullable().optional(),
      activationState: z.enum(['scheduled', 'published', 'cancelled']).optional(),
      name: z.string(),
      displayName: z.string().optional(),
      threshold: z.number().int().positive(),
      methodCodes: z.array(z.string()),
      ruleVersion: z.number().int().positive(),
      configured: z.boolean(),
      recipientCount: count,
      progressStartDate: z.iso.date().optional(),
      versions: z
        .array(
          z.object({
            code: achievementCodeSchema,
            ruleVersion: z.number().int().positive(),
            name: z.string(),
            displayName: z.string().optional(),
            kind: z.enum([
              'streak',
              'total',
              'morning',
              'night',
              'method',
              'combo',
              'summer',
              'winter',
              'unknown',
              'event',
              'challenge'
            ]),
            threshold: z.number().int().positive().nullable(),
            methodCodes: z.array(z.string()),
            seasons: z.array(
              z.object({
                year: z.number().int(),
                startDate: z.iso.date(),
                endDate: z.iso.date(),
                timezone: z.string(),
                requiredDays: z.number().int().positive()
              })
            ),
            provenance: z.string().nullable().optional(),
            continuous: z.boolean().optional(),
            methodMatch: z.enum(['any', 'all']).optional(),
            effectiveDate: z.iso.date().optional(),
            startDate: z.iso.date().nullable().optional(),
            endDate: z.iso.date().nullable().optional(),
            activationState: z.enum(['scheduled', 'published', 'cancelled']).optional(),
            configurationKnown: z.boolean(),
            configured: z.boolean(),
            progressStartDate: z.iso.date().optional(),
            isCurrent: z.boolean(),
            recipientCount: count
          })
        )
        .optional(),
      periods: z.array(z.object({ period: z.string(), recipientCount: count })),
      seasons: z.array(
        z.object({
          year: z.number().int(),
          startDate: z.iso.date(),
          endDate: z.iso.date(),
          timezone: z.string(),
          requiredDays: z.number().int().positive()
        })
      )
    })
  )
});
export const achievementRecipientsSchema = z.object({
  code: achievementCodeSchema,
  ruleVersion: z.number().int().positive(),
  name: z.string().optional(),
  configurationKnown: z.boolean().optional(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: count,
  totalPages: z.number().int().positive(),
  rows: z.array(
    z.object({
      personId: z.uuid(),
      displayName: z.string(),
      regionId: z.uuid().nullable(),
      regionName: z.string().nullable(),
      platform: z.enum(['line', 'telegram', 'whatsapp']).nullable(),
      awards: z.array(award)
    })
  )
});
export type AchievementCatalog = z.infer<typeof achievementCatalogSchema>;
export type AchievementRecipients = z.infer<typeof achievementRecipientsSchema>;
const parameters = (query: AchievementQuery, locale: AdminLocale) => [
  locale,
  query.region ?? null,
  query.platform ?? null,
  query.q,
  query.year ?? null
];
export const getAchievementCatalog = async (
  client: PoolClient,
  query: AchievementQuery,
  locale: AdminLocale
) => {
  const versioned = await hasAchievementVersions(client);
  const result = await client.query<{ data: unknown }>(
    versioned
      ? 'SELECT admin.achievement_version_catalog($1,$2,$3,$4,$5) data'
      : 'SELECT admin.achievement_catalog($1,$2,$3,$4,$5) data',
    parameters(query, locale)
  );
  return achievementCatalogSchema.parse(
    localizeSystemLabels(
      locale,
      achievementCatalogSchema.parse(
        addLegacyBadgeDisplayNames(
          z.record(z.string(), z.unknown()).parse(result.rows[0]?.data),
          locale
        )
      )
    )
  );
};
export const getAchievementRecipients = async (
  client: PoolClient,
  code: string,
  query: AchievementQuery,
  locale: AdminLocale
) => {
  const versioned = query.version !== undefined;
  if (versioned && !(await hasAchievementVersions(client)))
    throw Error('invalid achievement query');
  const result = await client.query<{ data: unknown }>(
    versioned
      ? 'SELECT admin.achievement_version_recipients($1,$2,$3,$4,$5,$6,$7,$8,$9) data'
      : 'SELECT admin.achievement_recipients($1,$2,$3,$4,$5,$6,$7,$8) data',
    [
      code,
      ...parameters(query, locale),
      query.page,
      query.limit,
      ...(versioned ? [query.version] : [])
    ]
  );
  return achievementRecipientsSchema.parse(
    localizeSystemLabels(locale, achievementRecipientsSchema.parse(result.rows[0]?.data))
  );
};
export const achievementFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message === 'achievement access denied' || message === 'achievement scope unavailable')
    return { status: 403, code: 'achievement_denied' };
  if (message === 'achievement unavailable')
    return { status: 404, code: 'achievement_unavailable' };
  if (message === 'invalid achievement query')
    return { status: 400, code: 'invalid_achievement_query' };
  return { status: 503, code: 'achievement_unavailable' };
};
