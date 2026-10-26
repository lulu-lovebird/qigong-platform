import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const headerNames = ['X-Debug-Override', 'x-DeBuG-oVeRrIdE', 'x-debug-override'];
const constraints = [
  { label: 'not.enum', make: (name: string) => ({ not: { enum: [name] } }) },
  { label: 'not.const', make: (name: string) => ({ not: { const: name } }) },
  {
    label: 'allOf/not.enum',
    make: (name: string) => ({ allOf: [{ not: { enum: [name] } }] })
  },
  {
    label: 'anyOf/not.const',
    make: (name: string) => ({ anyOf: [{ not: { const: name } }] })
  }
];

// Synthetic, unlistened fixtures only. Wire casing is normalized before validation;
// the regression is the schema's enum/const casing, not Node's header handling.
// Patterns and propertyNames $refs still need lowercase authoring (FSTSEC003).
for (const { label, make } of constraints) {
  describe(`header propertyNames ${label}`, () => {
    for (const authoredName of headerNames) {
      it.each(headerNames)(
        `rejects wire header %s when the deny-list spells it ${authoredName}`,
        async (wireName) => {
          const app = Fastify({ logger: false });
          const handler = vi.fn(() => ({ ok: true }));
          const observedNames: string[][] = [];
          app.addHook('preValidation', async (request) => {
            observedNames.push(Object.keys(request.headers));
          });
          app.get('/synthetic', {
            schema: { headers: { type: 'object', propertyNames: make(authoredName) } },
            handler
          });
          try {
            const response = await app.inject({
              url: '/synthetic',
              headers: { [wireName]: 'blocked.invalid' }
            });
            expect(observedNames[0]).toContain('x-debug-override');
            expect.soft(response.statusCode).toBe(400);
            expect.soft(handler).not.toHaveBeenCalled();
          } finally {
            await app.close();
          }
        }
      );

      it(`allows an unrelated header with the ${authoredName} deny-list`, async () => {
        const app = Fastify({ logger: false });
        const handler = vi.fn(() => ({ ok: true }));
        app.get('/synthetic', {
          schema: { headers: { type: 'object', propertyNames: make(authoredName) } },
          handler
        });
        try {
          const response = await app.inject({
            url: '/synthetic',
            headers: { 'X-Allowed': 'allowed.invalid' }
          });
          expect(response.statusCode).toBe(200);
          expect(response.json()).toEqual({ ok: true });
          expect(handler).toHaveBeenCalledTimes(1);
        } finally {
          await app.close();
        }
      });
    }
  });
}

it('preserves reused source schemas, case-sensitive values and non-header schema references', async () => {
  const schemaId = 'https://schema.invalid/synthetic';
  const shared = {
    type: 'object',
    propertyNames: { not: { enum: ['X-Debug-Override'] } },
    properties: { 'X-Allowed': { type: 'string', const: 'MiXeD.Invalid' } },
    additionalProperties: true
  };
  const original = structuredClone(shared);
  for (let index = 0; index < 2; index++) {
    const app = Fastify({ logger: false });
    const handler = vi.fn(() => ({ 'X-Allowed': 'MiXeD.Invalid' }));
    app.addSchema({ $id: schemaId, ...shared });
    for (const url of ['/first', '/second']) {
      app.post(url, {
        schema: {
          headers: shared,
          body: { $ref: schemaId },
          response: { 200: { $ref: schemaId } }
        },
        handler
      });
    }
    try {
      for (const url of ['/first', '/second']) {
        const allowed = await app.inject({
          method: 'POST',
          url,
          headers: { 'X-Allowed': 'MiXeD.Invalid' },
          payload: { 'X-Allowed': 'MiXeD.Invalid' }
        });
        expect(allowed.statusCode).toBe(200);
        expect(allowed.json()).toEqual({ 'X-Allowed': 'MiXeD.Invalid' });
        handler.mockClear();
        // Values are case-sensitive even though header names are not.
        const wrongValue = await app.inject({
          method: 'POST',
          url,
          headers: { 'X-Allowed': 'mixed.invalid' },
          payload: {}
        });
        expect(wrongValue.statusCode).toBe(400);
        expect(handler).not.toHaveBeenCalled();
        // A body reference must not inherit header-only name normalization.
        const forbiddenBody = await app.inject({
          method: 'POST',
          url,
          payload: { 'X-Debug-Override': 'blocked.invalid' }
        });
        expect(forbiddenBody.statusCode).toBe(400);
        expect(handler).not.toHaveBeenCalled();
      }
      expect(shared).toEqual(original);
      expect(app.getSchema(schemaId)).toEqual({ $id: schemaId, ...original });
    } finally {
      await app.close();
    }
    expect(shared).toEqual(original);
  }
});
