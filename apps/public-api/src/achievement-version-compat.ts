import type { PoolClient } from '@qigong/database';
import { z } from 'zod';
import { addLegacyBadgeDisplayNames } from './legacy-badge-names.js';
import { localeSchema } from './ui-localization.js';

// Additive43 readers are absent on42. Do not resolve a missing SQL function on42.
export const hasAchievementVersions = async (client: PoolClient): Promise<boolean> =>
  (
    await client.query<{ ready: boolean }>(
      "SELECT to_regprocedure('admin.achievement_version_catalog(text,uuid,text,text,integer)') IS NOT NULL ready"
    )
  ).rows[0]?.ready === true;

export interface VersionedLearnerRequest {
  platform: 'telegram' | 'line' | 'whatsapp';
  credential: string;
  locale: string;
}
export const readVersionedLearnerAchievements = async (
  client: PoolClient,
  input: VersionedLearnerRequest
): Promise<Record<string, unknown> | null> => {
  if (!(await hasAchievementVersions(client))) return null;
  const telegram = input.platform === 'telegram';
  const result = await client.query<{ data: unknown }>(
    telegram
      ? 'SELECT platform.telegram_versioned_achievements($1,$2) data'
      : "SELECT platform.channel_versioned_achievements($1,$2,$3) || CASE WHEN (platform.privacy_notice()->>'active')::boolean THEN jsonb_build_object('privacy',platform.privacy_usage($1,$2)) ELSE '{}'::jsonb END data",
    telegram ? [input.credential, input.locale] : [input.platform, input.credential, input.locale]
  );
  const data = z.record(z.string(), z.unknown()).parse(result.rows[0]?.data);

  // If venue badges schema is available, append venue badges for learner
  try {
    const hasVenue =
      (
        await client.query<{ exists: boolean }>(
          "SELECT to_regclass('core.venue_badge_definitions') IS NOT NULL AS exists"
        )
      ).rows[0]?.exists === true;

    if (hasVenue && Array.isArray(data.badges)) {
      const targetQuery = telegram
        ? "SELECT platform.practice_person('telegram', $1) AS target"
        : 'SELECT platform.channel_workspace_person($1, $2) AS target';
      const targetParams = telegram ? [input.credential] : [input.platform, input.credential];
      const targetRes = await client.query<{ target: string | null }>(targetQuery, targetParams);
      const target = targetRes.rows[0]?.target;

      if (target) {
        const venueBadgesRes = await client.query<{ venue_badges: unknown[] }>(
          `SELECT coalesce(jsonb_agg(jsonb_build_object(
            'code', vd.code,
            'kind', vd.kind,
            'name', CASE WHEN $2 = 'en' THEN vd.name_en ELSE vd.name_zh_tw END,
            'threshold', vd.threshold,
            'ruleVersion', vd.rule_version,
            'configured', true,
            'configurationKnown', true,
            'isVenue', true,
            'methodCodes', '[]'::jsonb,
            'seasons', '[]'::jsonb,
            'awards', coalesce((
              SELECT jsonb_agg(jsonb_build_object('period', b.period, 'earnedAt', b.earned_at, 'revoked', b.revoked_at IS NOT NULL) ORDER BY b.period)
              FROM core.person_venue_badges b
              WHERE b.person_id = $1 AND b.badge_code = vd.code AND b.rule_version = vd.rule_version
            ), '[]'::jsonb)
          ) ORDER BY vd.sort_order, vd.code), '[]'::jsonb) AS venue_badges
          FROM core.venue_badge_definitions vd`,
          [target, input.locale]
        );
        const venueBadges = venueBadgesRes.rows[0]?.venue_badges;
        const badges = Array.isArray(data.badges) ? (data.badges as unknown[]) : [];
        if (Array.isArray(venueBadges) && venueBadges.length > 0) {
          data.badges = [...badges, ...venueBadges];
        }
      }
    }
  } catch {
    // Non-fatal: keep online badges on transient error
  }

  return addLegacyBadgeDisplayNames(data, localeSchema.parse(input.locale));
};
