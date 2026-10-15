import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isPracticeNoteConflict, practiceNoteSchema } from '../src/practice-notes.js';
import { feelingTagsInput } from '../src/admin-journal-routes.js';

describe('practice note HTTP validation', () => {
  it('validates an optional literal Simplified translation without coercion, accepting explicit clearing and legacy omission', () => {
    const tag = { name_zh_tw: '放鬆', name_en: 'Relaxed', active: true },
      parse = (name: unknown) =>
        feelingTagsInput.safeParse({ version: 1, tags: [{ ...tag, name_zh_cn: name }] });
    for (const value of ['已儲存', '字'.repeat(40), '😀'.repeat(40), '', null])
      expect(parse(value).success).toBe(true);
    for (const value of ['字'.repeat(41), 'a\0', 3, {}, []])
      expect(parse(value).success).toBe(false);
    expect(feelingTagsInput.parse({ version: 1, tags: [tag] }).tags[0]).not.toHaveProperty(
      'name_zh_cn'
    );
    expect(
      feelingTagsInput.parse({ version: 1, tags: [{ ...tag, name_zh_cn: ' 已儲存 ' }] }).tags[0]
        ?.name_zh_cn
    ).toBe('已儲存');
  });
  it('accepts independent text and tag selection, preserving omission rather than clearing', () => {
    expect(practiceNoteSchema.parse({})).toEqual({});
    expect(
      practiceNoteSchema.parse({ practiceNote: '放鬆是我手寫的字', feelingTagIds: [] })
    ).toEqual({ practiceNote: '放鬆是我手寫的字', feelingTagIds: [] });
    expect(
      practiceNoteSchema.parse({ feelingTagIds: [randomUUID()] }).practiceNote
    ).toBeUndefined();
  });
  it('uses Unicode code points, accepts exactly 1000 emoji and rejects NUL or oversize text', () => {
    expect(practiceNoteSchema.safeParse({ practiceNote: '😀'.repeat(1000) }).success).toBe(true);
    expect(practiceNoteSchema.safeParse({ practiceNote: '😀'.repeat(1001) }).success).toBe(false);
    expect(practiceNoteSchema.safeParse({ practiceNote: 'invalid\0note' }).success).toBe(false);
  });
  it('rejects forged, duplicated, excessive IDs and invalid field types', () => {
    const id = randomUUID();
    for (const input of [
      { practiceNote: null },
      { practiceNote: 42 },
      { feelingTagIds: null },
      { feelingTagIds: ['tag'] },
      { feelingTagIds: [id, id] },
      { feelingTagIds: Array.from({ length: 31 }, () => randomUUID()) }
    ])
      expect(practiceNoteSchema.safeParse(input).success).toBe(false);
  });
  it('only exposes controlled domain conflicts, not private diagnostics', () => {
    expect(isPracticeNoteConflict(new Error('invalid feeling tags'))).toBe(true);
    expect(isPracticeNoteConflict(new Error('private note contents'))).toBe(false);
    expect(isPracticeNoteConflict({ message: 'invalid practice note' })).toBe(false);
  });
});
