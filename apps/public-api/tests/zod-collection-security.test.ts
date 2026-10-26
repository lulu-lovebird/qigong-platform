import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// GHSA-mrhx-c7xc-m3w5: deliberately tiny inputs, not a memory/timing benchmark.
// Only leading upper bounds are covered; an overwrite before a cap must still run.
for (const mode of ['interpreter', 'compiled'] as const) {
  const prepare = <T extends z.ZodType>(schema: T): T =>
    mode === 'compiled' ? z.core.compile(schema, { strict: true }) : schema;

  describe(`bounded collections (${mode})`, () => {
    for (const kind of ['array', 'map', 'set'] as const) {
      it(`${kind} rejects oversized input before parsing children or refining the collection`, () => {
        const child = vi.fn(() => true);
        const collection = vi.fn(() => true);
        const element = z.string().refine(child);
        const schema = prepare(
          kind === 'array'
            ? z.array(element).max(2).refine(collection)
            : kind === 'map'
              ? z.map(element, element).max(2).refine(collection)
              : z.set(element).max(2).refine(collection)
        );
        const oversized =
          kind === 'array'
            ? ['a', 'b', 'c']
            : kind === 'map'
              ? new Map([
                  ['a', 'a'],
                  ['b', 'b'],
                  ['c', 'c']
                ])
              : new Set(['a', 'b', 'c']);
        const result = schema.safeParse(oversized);
        expect(result.success).toBe(false);
        expect(result.error?.issues).toMatchObject([{ code: 'too_big', maximum: 2, path: [] }]);
        expect(result.error?.issues).toHaveLength(1);
        expect(child).not.toHaveBeenCalled();
        expect(collection).not.toHaveBeenCalled();
      });

      it(`${kind} reports only the upper-bound issue for oversized invalid children`, () => {
        const schema = prepare(
          kind === 'array'
            ? z.array(z.string()).max(2)
            : kind === 'map'
              ? z.map(z.string(), z.string()).max(2)
              : z.set(z.string()).max(2)
        );
        const input =
          kind === 'array'
            ? [1, 2, 3]
            : kind === 'map'
              ? new Map([
                  [1, 1],
                  [2, 2],
                  [3, 3]
                ])
              : new Set([1, 2, 3]);
        const result = schema.safeParse(input);
        expect(result.success).toBe(false);
        expect(result.error?.issues).toMatchObject([{ code: 'too_big', path: [] }]);
        expect(result.error?.issues).toHaveLength(1);
      });

      it(`${kind} still validates in-bounds children and accepts valid values`, () => {
        const schema = prepare(
          kind === 'array'
            ? z.array(z.string()).max(2)
            : kind === 'map'
              ? z.map(z.string(), z.string()).max(2)
              : z.set(z.string()).max(2)
        );
        const invalid = kind === 'array' ? [1] : kind === 'map' ? new Map([[1, 1]]) : new Set([1]);
        const valid =
          kind === 'array'
            ? ['a', 'b']
            : kind === 'map'
              ? new Map([
                  ['a', 'a'],
                  ['b', 'b']
                ])
              : new Set(['a', 'b']);
        expect(schema.safeParse(invalid).success).toBe(false);
        expect(schema.parse(valid)).toEqual(valid);
      });
    }

    it('preserves exact length and nested issue paths without parsing children', () => {
      const child = vi.fn(() => true);
      const schema = prepare(z.object({ items: z.array(z.string().refine(child)).length(2) }));
      const result = schema.safeParse({ items: [1, 2, 3] });
      expect(result.success).toBe(false);
      expect(result.error?.issues).toMatchObject([
        { code: 'too_big', exact: true, maximum: 2, path: ['items'] }
      ]);
      expect(result.error?.issues).toHaveLength(1);
      expect(child).not.toHaveBeenCalled();
      expect(schema.safeParse({ items: ['a'] }).success).toBe(false);
      expect(schema.parse({ items: ['a', 'b'] })).toEqual({ items: ['a', 'b'] });
    });

    it('runs an overwrite before a later bound rather than rejecting the raw length', () => {
      const schema = prepare(
        z
          .array(z.number())
          .overwrite((items) => items.slice(0, 2))
          .max(2)
      );
      expect(schema.parse([1, 2, 3])).toEqual([1, 2]);
      expect(schema.safeParse(['invalid', 2, 3]).success).toBe(false);
    });
  });
}
