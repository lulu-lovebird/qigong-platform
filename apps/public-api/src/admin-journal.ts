import { z } from 'zod';
import type { PoolClient } from '@qigong/database';

export const journalQuerySchema = z.object({
  personId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  lang: z.enum(['zh_TW', 'en']).default('zh_TW')
});
export const queryPracticeJournal = async (
  client: PoolClient,
  input: z.infer<typeof journalQuerySchema>
) => {
  const result = await client.query<{ data: unknown }>(
    'SELECT admin.practice_journal($1,$2,$3) data',
    [input.personId ?? null, input.page, input.lang]
  );
  return result.rows[0]?.data;
};
