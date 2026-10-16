import { withRequestContext, type Pool } from '@qigong/database';
import { z } from 'zod';
const part = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) =>
    [...value].every((c) => (c.codePointAt(0) ?? 0) >= 32 && c.codePointAt(0) !== 127)
  );
const display = part.refine((value) => [...value].length <= 150);
// Accept metadata only from a caller's already verified Telegram proof; never from form fields.
export const telegramProfileDisplayName = (input: unknown): string | undefined => {
  const parsed = z
    .object({
      first_name: part.optional(),
      last_name: part.optional(),
      username: z
        .string()
        .regex(/^[A-Za-z0-9_]{1,32}$/)
        .optional(),
      is_bot: z.boolean().optional()
    })
    .safeParse(input);
  if (!parsed.success || parsed.data.is_bot) return undefined;
  const user = parsed.data,
    value = user.first_name
      ? [user.first_name, user.last_name].filter(Boolean).join(' ')
      : user.username
        ? '@' + user.username
        : undefined;
  const result = display.safeParse(value);
  return result.success ? result.data : undefined;
};
export interface VerifiedTelegramProfile {
  subject: string;
  displayName: string;
  source: 'webhook' | 'miniapp';
  proofTime: number;
  updateId?: number;
}
export const refreshVerifiedTelegramProfile = async (
  pool: Pool,
  requestId: string,
  profile: VerifiedTelegramProfile
): Promise<boolean> => {
  const result = await withRequestContext(pool, 'qigong_api_runtime', { requestId }, (client) =>
    client.query<{ refreshed: boolean }>(
      'SELECT platform.refresh_verified_telegram_profile($1,$2,$3,$4,$5) refreshed',
      [
        profile.subject,
        profile.displayName,
        profile.source,
        new Date(profile.proofTime * 1000).toISOString(),
        profile.updateId ?? null
      ]
    )
  );
  return result.rows[0]?.refreshed === true;
};
