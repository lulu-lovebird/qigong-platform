import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isPracticeNoteConflict, practiceNoteSchema } from '../src/practice-notes.js';

describe('practice note HTTP validation', () => {
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
