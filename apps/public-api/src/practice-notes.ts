import { z } from 'zod';
import type { PoolClient } from '@qigong/database';
import type { LearnerLocale } from './learner-locale.js';

export type PracticeChannel = 'telegram' | 'line' | 'whatsapp';
export const practiceNoteSchema = z.object({
  practiceNote: z
    .string()
    .refine((value) => [...value].length <= 1000 && !value.includes('\0'), 'invalid practice note')
    .optional(),
  feelingTagIds: z
    .array(z.uuid())
    .max(30)
    .refine((ids) => new Set(ids).size === ids.length, 'duplicate feeling tags')
    .optional()
});
export type PracticeNoteInput = z.infer<typeof practiceNoteSchema>;
const tag = z.object({ id: z.uuid(), name: z.string() });
const supplement = z.object({
  privacy: z.object({ active: z.boolean(), reflectionConsent: z.boolean() }).optional(),
  tags: z.array(tag),
  notes: z.array(
    z.object({ checkin_id: z.uuid(), practice_note: z.string(), feeling_tags: z.array(tag) })
  )
});
const historySchema = z
  .object({ entries: z.array(z.object({ id: z.uuid() }).passthrough()) })
  .passthrough();

export const savePracticeNote = async (
  client: PoolClient,
  channel: PracticeChannel,
  credential: string,
  checkinId: string,
  input: PracticeNoteInput
) => {
  // Omission is NOT an instruction to clear an existing note or its historical labels.
  if (input.practiceNote === undefined && input.feelingTagIds === undefined) return;
  await client.query('SELECT platform.save_practice_note($1,$2,$3,$4,$5::uuid[])', [
    channel,
    credential,
    checkinId,
    input.practiceNote ?? null,
    input.feelingTagIds ?? null
  ]);
};

export const enrichPracticeHistory = async (
  client: PoolClient,
  channel: PracticeChannel,
  credential: string,
  locale: LearnerLocale,
  history: unknown
) => {
  const original = historySchema.safeParse(history);
  const result = await client.query<{ data: unknown }>(
    'SELECT platform.practice_notes($1,$2,$3) data',
    [channel, credential, locale]
  );
  const extra = supplement.safeParse(result.rows[0]?.data);
  if (!original.success || !extra.success) throw new Error('practice history unavailable');
  const notes = new Map(extra.data.notes.map((note) => [note.checkin_id, note]));
  return {
    ...original.data,
    feelingTags: extra.data.tags,
    ...(extra.data.privacy ? { privacy: extra.data.privacy } : {}),
    entries: original.data.entries.map((entry) => ({
      ...entry,
      practice_note: notes.get(entry.id)?.practice_note ?? '',
      feeling_tags: notes.get(entry.id)?.feeling_tags ?? []
    }))
  };
};

export const isPracticeNoteConflict = (error: unknown) =>
  error instanceof Error &&
  /^(practice identity unavailable|practice note correction unavailable|invalid practice note|invalid feeling tags)$/.test(
    error.message
  );
