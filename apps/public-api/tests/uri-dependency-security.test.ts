import { createRequire } from 'node:module';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

type Options = {
  reference?: string;
  scheme?: string;
  skipEscape?: boolean;
  unicodeSupport?: boolean;
};
type Components = { error?: string; scheme?: string; host?: string; userinfo?: string };
type Uri = {
  parse: (input: string, options?: Options) => Components;
  normalize: (input: string, options?: Options) => string;
  equal: (left: string, right: string) => boolean;
  resolve: (base: string, relative: string, options?: Options) => string;
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const isUri = (value: unknown): value is Uri =>
  record(value) &&
  typeof value.parse === 'function' &&
  typeof value.normalize === 'function' &&
  typeof value.equal === 'function' &&
  typeof value.resolve === 'function';

// Resolve only along declared owner edges; no undeclared application-level import
// or assumption about pnpm hoisting. GHSA vectors come from fast-uri's own tests.
const appRequire = createRequire(import.meta.url);
const fastifyRequire = createRequire(appRequire.resolve('fastify'));
const compilerRequire = createRequire(fastifyRequire.resolve('@fastify/ajv-compiler'));
const ajvRequire = createRequire(compilerRequire.resolve('ajv'));
const serializerRequire = createRequire(fastifyRequire.resolve('fast-json-stringify'));
const branches = [
  { label: 'ajv-compiler -> fast-uri 4', owner: compilerRequire, version: '4.2.3' },
  { label: 'ajv-compiler -> ajv -> fast-uri 3', owner: ajvRequire, version: '3.1.9' },
  { label: 'fast-json-stringify -> fast-uri 4', owner: serializerRequire, version: '4.2.3' }
];

for (const { label, owner, version } of branches) {
  const loaded: unknown = owner('fast-uri');
  if (!isUri(loaded)) throw new Error(`Unexpected URI dependency API: ${label}`);
  const uri = loaded;
  describe(label, () => {
    it('uses the patched version from the actual owner resolution', () => {
      const metadata: unknown = owner('fast-uri/package.json');
      if (!record(metadata)) throw new Error('Invalid package metadata');
      expect(metadata.version).toBe(version);
      if (version === '4.2.3') {
        expect(owner.resolve('fast-uri')).toBe(compilerRequire.resolve('fast-uri'));
      } else {
        expect(owner.resolve('fast-uri')).not.toBe(compilerRequire.resolve('fast-uri'));
      }
    });

    it.each([
      '%6Aavascript:alert(1)',
      'j%61vascript:alert(1)',
      '%64ata:text/html,x',
      'vb%73cript:msgbox(1)',
      'ht%74ps://example.com:443'
    ])('rejects encoded schemes without promoting %s', (input) => {
      expect(uri.parse(input).error).toBe('URI scheme is malformed.');
      expect(uri.normalize(input)).toBe(input);
      expect(uri.equal(input, input)).toBe(false);
      expect(uri.equal('%68ttp://a/', 'http://a/')).toBe(false);
      expect(() => uri.resolve('https://example.com/app/', input)).toThrow(
        'URI scheme is malformed.'
      );
    });

    it.each([
      'b@evil.example',
      'ev\til.example',
      'ev\nil.example',
      'ev\ril.example',
      'ev\r\nil.example'
    ])('does not reinterpret the forbidden host %j', (host) => {
      const input = `http://user@${host}/path`;
      expect(uri.parse(input).error).toBe('URI host is malformed.');
      expect(uri.parse(input).host).not.toBe('evil.example');
      expect(uri.normalize(input)).toBe(input);
      expect(uri.normalize(input, { unicodeSupport: true })).toBe(input);
      expect(uri.equal(input, input)).toBe(false);
      expect(uri.equal(input, 'http://user@evil.example/path')).toBe(false);
      expect(() => uri.resolve('http://trusted.example/', `//user@${host}/path`)).toThrow(
        'URI host is malformed.'
      );
    });

    it('preserves relative path meaning and prevents authority/scheme promotion', () => {
      const cases = [
        ['a/../b', 'b'],
        ['x/..', './'],
        ['../x', '../x'],
        ['a/..//x', './/x'],
        ['./a:b', './a:b']
      ];
      for (const [input, expected] of cases) {
        if (input === undefined || expected === undefined) throw new Error('Invalid fixture');
        const normalized = uri.normalize(input);
        expect(normalized).toBe(expected);
        expect(uri.normalize(normalized)).toBe(normalized);
        expect(uri.parse(normalized).host).toBeUndefined();
        expect(uri.parse(normalized).scheme).toBeUndefined();
        // Deliberately no trailing-// vectors: v3's documented resolver limitation
        // is not fixed by 3.1.9 and must not be represented as fixed here.
        expect(uri.resolve('http://h/p/q/r', normalized)).toBe(
          uri.resolve('http://h/p/q/r', input)
        );
      }
      expect(uri.equal('../x', 'x')).toBe(false);
      expect(uri.equal('a/../b', '/b')).toBe(false);
      expect(uri.equal('a/../b', 'b')).toBe(true);
      expect(uri.resolve('http://h/p/q/r', uri.normalize('../x'))).toBe('http://h/p/x');
    });

    it('escapes a suffix first-segment colon but keeps later colons', () => {
      const options = { reference: 'suffix', scheme: 'x' };
      expect(uri.normalize('javascript:alert(1)', options)).toBe('javascript%3Aalert(1)');
      for (const input of [
        'javascript:alert(1)',
        '%6Aavascript:alert(1)',
        'data:text/html,x',
        'vbscript:msgbox(1)'
      ]) {
        expect(uri.normalize(input, options)).not.toMatch(/^(?:javascript|data|vbscript):/i);
      }
      expect(
        uri.resolve('https://a.example/base/', '%6Aavascript:alert(1)', { reference: 'suffix' })
      ).not.toMatch(/^(?:javascript|data|vbscript):/i);
      expect(uri.normalize('path/to/file', options)).toBe('path/to/file');
      expect(uri.normalize('a/b:c', options)).toBe('a/b:c');
    });

    it('preserves valid IDN, escaped hosts, case, userinfo, IPv6, mailto and URN inputs', () => {
      expect(uri.normalize('http://Example.COM/')).toBe('http://example.com/');
      expect(uri.normalize('http://%65xample.com/')).toBe('http://example.com/');
      expect(uri.normalize('http://bücher.de/')).toBe('http://xn--bcher-kva.de/');
      expect(uri.parse('http://user:pass@example.com:8080/').host).toBe('example.com');
      expect(uri.resolve('http://trusted.example/', '//user@example.com/p')).toBe(
        'http://user@example.com/p'
      );
      for (const input of [
        'http://[::1]/',
        'mailto:user@example.com',
        'urn:uuid:123e4567-e89b-12d3-a456-426614174000'
      ]) {
        expect(uri.parse(input).error).toBeUndefined();
        expect(uri.normalize(input)).toBe(input);
      }
    });
  });
}

it('keeps Fastify relative $ref body validation and response serialization working without network access', async () => {
  const app = Fastify({ logger: false });
  const schema = {
    $id: 'https://schema.invalid/security/body.json',
    type: 'object',
    $defs: { value: { type: 'string', const: 'MiXeD' } },
    properties: { value: { $ref: '#/$defs/value' } },
    required: ['value'],
    additionalProperties: false
  };
  app.addSchema(schema);
  app.post('/synthetic-uri', {
    schema: { body: schema, response: { 200: schema } },
    handler: () => ({ value: 'MiXeD', omitted: 'not serialized' })
  });
  try {
    const valid = await app.inject({
      method: 'POST',
      url: '/synthetic-uri',
      payload: { value: 'MiXeD' }
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ value: 'MiXeD' });
    const invalid = await app.inject({
      method: 'POST',
      url: '/synthetic-uri',
      payload: { value: 'mixed' }
    });
    expect(invalid.statusCode).toBe(400);
  } finally {
    await app.close();
  }
});
