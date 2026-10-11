import Fastify from 'fastify';
import { Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { apiLogRedaction } from '../src/app.js';

describe('API request log privacy', () => {
  it('masks LIFF state, OAuth credentials and request cookies while preserving request IDs and methods', async () => {
    let output = '';
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output += chunk.toString('utf8');
        callback();
      }
    });
    const app = Fastify({ logger: { level: 'info', redact: apiLogRedaction, stream } });
    app.get('/line/', () => ({ ok: true }));
    try {
      await app.inject({
        url: '/line/?liff.state=%2Fapply%23synthetic-private-application&access_token=synthetic-sdk-credential',
        headers: { authorization: 'Bearer synthetic-auth', cookie: 'session=synthetic-cookie' }
      });
      await setImmediate();
      expect(output).toContain('[REDACTED]');
      expect(output).toContain('GET');
      expect(output).toContain('reqId');
      for (const value of [
        'synthetic-private-application',
        'synthetic-sdk-credential',
        'liff.state',
        'synthetic-auth',
        'synthetic-cookie'
      ])
        expect(output).not.toContain(value);
    } finally {
      await app.close();
    }
  });
});
