import type { PoolClient } from '@qigong/database';
import { z } from 'zod';

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
  return z.record(z.string(), z.unknown()).parse(result.rows[0]?.data);
};
