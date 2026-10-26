import Fastify, { type FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { apiLogRedaction, buildApp } from '../src/app.js';
import { isLogRequestId, ownLogValue } from '../src/log-privacy.js';

const secret = 'SYNTHETIC_PRIVATE_SENTINEL';
const requestId = '123e4567-e89b-42d3-a456-426614174000';

// Only the deliberately failing readiness query is implemented. No real pool,
// connection, credentials, database state or transport is created by these tests.
const createPoolStub = () => {
  const query = vi.fn<Pool['query']>().mockRejectedValue(
    Object.assign(new Error(secret, { cause: new Error(secret) }), {
      code: 'ECONNREFUSED',
      detail: secret,
      query: secret,
      parameters: [secret]
    })
  );
  return { pool: { query } as unknown as Pool, query };
};

const createLogCapture = (mode: 'default' | 'injected', level = 'trace') => {
  let output = '';
  const records: unknown[] = [];
  const levels: number[] = [];
  const atLevel =
    (level: number) =>
    (fields: unknown, message?: unknown, ...args: unknown[]) => {
      levels.push(level);
      write(fields, message, ...args);
    };
  const write = (fields: unknown, message?: unknown, ...args: unknown[]) => {
    records.push(fields);
    output += JSON.stringify([fields, message, args]) + '\n';
  };
  const child = vi.fn((): FastifyBaseLogger => sink);
  const sink: FastifyBaseLogger = {
    level,
    fatal: atLevel(60),
    error: atLevel(50),
    warn: atLevel(40),
    info: atLevel(30),
    debug: atLevel(20),
    trace: atLevel(10),
    silent: atLevel(Infinity),
    child
  };
  const logStream = {
    write: (line: string) => {
      output += line;
      for (const value of line.trim().split('\n')) {
        const record: unknown = JSON.parse(value);
        records.push(record);
        levels.push(Number(ownLogValue(record, 'level')));
      }
    }
  };
  return {
    options: mode === 'default' ? { logStream } : { logger: sink },
    records,
    sequence: () =>
      records.map((record, index) => ({
        event: ownLogValue(record, 'event'),
        statusCode: ownLogValue(record, 'statusCode'),
        level: levels[index]
      })),
    child,
    assertPrivate: () => {
      expect(output).not.toContain(secret);
    }
  };
};

for (const mode of ['default', 'injected'] as const) {
  describe(`real buildApp ${mode} logging boundary`, () => {
    it('never promotes an internal failure to a client error merely because the reply is already 4xx', async () => {
      const capture = createLogCapture(mode);
      const app = buildApp({ pool: createPoolStub().pool, ...capture.options });
      for (const status of [400, 404, 409, 422]) {
        app.get(
          `/serializer-${status}`,
          {
            schema: {
              response: {
                [status]: {
                  type: 'object',
                  required: [secret],
                  properties: { [secret]: { type: 'string' } }
                }
              }
            }
          },
          (_request, reply) => reply.code(status).send({})
        );
        app.get(`/internal-${status}`, (_request, reply) => {
          reply.code(status);
          throw Object.assign(new Error(secret), { code: '23505', detail: secret });
        });
        app.get(
          `/preserialize-${status}`,
          {
            preSerialization: async () => {
              throw new TypeError(secret);
            }
          },
          (_request, reply) => reply.code(status).send({ ok: false })
        );
        app.get(
          `/onsend-${status}`,
          {
            onSend: async (_request, reply, payload) => {
              if (reply.statusCode === status) throw new Error(secret);
              return payload;
            }
          },
          (_request, reply) => reply.code(status).send({ ok: false })
        );
      }
      try {
        for (const status of [400, 404, 409, 422]) {
          for (const phase of ['serializer', 'internal', 'preserialize', 'onsend']) {
            const offset = capture.records.length;
            const response = await app.inject({ url: `/${phase}-${status}` });
            await setImmediate();
            expect(response.statusCode).toBe(500);
            expect(response.json()).toEqual({
              statusCode: 500,
              error: 'Internal Server Error',
              message: 'Internal Server Error'
            });
            expect(response.body).not.toContain(secret);
            expect(capture.sequence().slice(offset)).toEqual([
              { event: 'request_started', statusCode: undefined, level: 30 },
              { event: 'request_failed', statusCode: 500, level: 50 },
              { event: 'request_completed', statusCode: 500, level: 30 }
            ]);
          }
        }
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });

    it('preserves genuine Fastify parser error codes and messages without logging their input', async () => {
      const capture = createLogCapture(mode);
      const app = buildApp({ pool: createPoolStub().pool, ...capture.options });
      const baseline = Fastify({ logger: false });
      const delegated = baseline.errorHandler;
      baseline.setErrorHandler((error, request, reply) =>
        delegated.call(baseline, error, request, reply)
      );
      for (const target of [app, baseline]) target.post('/parser', () => ({ ok: true }));
      const cases = [
        {
          contentType: 'application/json',
          payload: `{"private":"${secret}"`,
          status: 400,
          code: 'FST_ERR_CTP_INVALID_JSON_BODY'
        },
        {
          contentType: 'application/json',
          payload: '',
          status: 400,
          code: 'FST_ERR_CTP_EMPTY_JSON_BODY'
        },
        {
          contentType: 'application/unsupported',
          payload: secret,
          status: 415,
          code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
        },
        {
          contentType: 'application/json',
          payload: JSON.stringify({ private: 'x'.repeat(1_048_576) }),
          status: 413,
          code: 'FST_ERR_CTP_BODY_TOO_LARGE'
        }
      ];
      try {
        for (const fixture of cases) {
          const options = {
            method: 'POST' as const,
            url: '/parser',
            headers: { 'content-type': fixture.contentType },
            payload: fixture.payload
          };
          const expected = await baseline.inject(options);
          const response = await app.inject(options);
          expect(response.statusCode).toBe(fixture.status);
          expect(response.json()).toEqual(expected.json());
          expect(response.json()).toMatchObject({ code: fixture.code });
        }
        capture.assertPrivate();
      } finally {
        await app.close();
        await baseline.close();
      }
    });

    it('emits exactly one start, failure when needed, and completion per request', async () => {
      const capture = createLogCapture(mode);
      const app = buildApp({ pool: createPoolStub().pool, ...capture.options });
      app.get('/bad', () => {
        throw Object.assign(new Error('fixed bad request'), { statusCode: 400 });
      });
      app.get('/broken', () => {
        throw new Error(secret);
      });
      try {
        for (const [url, status] of [
          ['/health/live', 200],
          ['/missing', 404],
          ['/bad', 400],
          ['/broken', 500]
        ] as const) {
          const offset = capture.records.length;
          const response = await app.inject({ url });
          await setImmediate();
          expect(response.statusCode).toBe(status);
          expect(capture.sequence().slice(offset)).toEqual([
            { event: 'request_started', statusCode: undefined, level: 30 },
            ...(url === '/bad' || url === '/broken'
              ? [{ event: 'request_failed', statusCode: status, level: status >= 500 ? 50 : 30 }]
              : []),
            { event: 'request_completed', statusCode: status, level: 30 }
          ]);
        }
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });

    it('ignores hostile headers and copies only a scalar retry-after once', async () => {
      const capture = createLogCapture(mode);
      const app = buildApp({ pool: createPoolStub().pool, ...capture.options });
      const getter = vi.fn(() => {
        throw new Error(secret);
      });
      const descriptorTrap = vi.fn(() => {
        throw new Error(secret);
      });
      const revokedHeaders = Proxy.revocable({}, {});
      revokedHeaders.revoke();
      const headers: unknown[] = [
        null,
        secret,
        [secret],
        Object.defineProperty({}, 'retry-after', { get: getter }),
        new Proxy({}, { getOwnPropertyDescriptor: descriptorTrap }),
        { 'retry-after': { toString: getter } },
        { 'retry-after': '\r\n' + secret },
        { 'retry-after': '3', 'set-cookie': secret },
        { 'retry-after': 4 },
        revokedHeaders.proxy
      ];
      headers.forEach((value, index) =>
        app.get(`/headers/${index}`, (_request, reply) => {
          reply.header('set-cookie', 'fixed=1');
          throw Object.assign(new Error(secret), { statusCode: 503, headers: value });
        })
      );
      app.get('/headers-getter', () => {
        throw Object.defineProperty(
          Object.assign(new Error(secret), { statusCode: 503 }),
          'headers',
          { get: getter }
        );
      });
      try {
        for (const index of headers.keys()) {
          const response = await app.inject({ url: `/headers/${index}` });
          expect(response.statusCode).toBe(503);
          expect(response.body).not.toContain(secret);
          expect(response.headers['set-cookie']).toBe('fixed=1');
          expect(response.headers['retry-after']).toBe(
            index === 7 ? '3' : index === 8 ? '4' : undefined
          );
          expect(response.headers['0']).toBeUndefined();
        }
        expect(descriptorTrap).toHaveBeenCalledTimes(1);
        const response = await app.inject({ url: '/headers-getter' });
        expect(response.statusCode).toBe(503);
        expect(response.body).not.toContain(secret);
        expect(getter).not.toHaveBeenCalled();
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });

    it('fails ambiguous accessors closed without calling getters or unsafe serializers', async () => {
      const capture = createLogCapture(mode);
      const app = buildApp({ pool: createPoolStub().pool, ...capture.options });
      const getter = vi.fn(() => {
        throw new Error(secret);
      });
      const serializer = vi.fn(() => {
        throw new Error(secret);
      });
      for (const key of ['status', 'statusCode', 'message', 'code']) {
        app.get(`/getter/${key}`, () => {
          const error = Object.assign(new Error(secret), { statusCode: 400 });
          Object.defineProperty(error, key, { get: getter });
          throw error;
        });
      }
      app.get('/getter/status-value', () => {
        throw Object.defineProperty(
          Object.assign(new Error(secret), { statusCode: 400 }),
          'status',
          { get: () => 503 }
        );
      });
      app.get('/getter/name', () => {
        throw Object.defineProperty(new Error(secret), 'name', { get: getter });
      });
      app.get('/getter/toJSON', () => {
        throw Object.defineProperty(new Error(secret), 'toJSON', { get: getter });
      });
      for (const statusCode of [400, 500]) {
        app.get(
          `/error-serializer/${statusCode}`,
          {
            schema: { response: { [statusCode]: { type: 'object' }, 500: { type: 'object' } } },
            serializerCompiler: () => serializer
          },
          () => {
            throw Object.assign(new Error(statusCode === 400 ? 'fixed bad request' : secret), {
              statusCode
            });
          }
        );
      }
      try {
        for (const key of [
          'status',
          'statusCode',
          'message',
          'code',
          'status-value',
          'name',
          'toJSON'
        ]) {
          const offset = capture.records.length;
          const response = await app.inject({ url: `/getter/${key}` });
          expect(response.statusCode).toBe(500);
          expect(response.body).not.toContain(secret);
          expect(capture.sequence().slice(offset)).toEqual([
            { event: 'request_started', statusCode: undefined, level: 30 },
            { event: 'request_failed', statusCode: 500, level: 50 },
            { event: 'request_completed', statusCode: 500, level: 30 }
          ]);
        }
        for (const status of [400, 500]) {
          const response = await app.inject({ url: `/error-serializer/${status}` });
          expect(response.statusCode).toBe(status);
          expect(response.body).not.toContain(secret);
        }
        expect(getter).not.toHaveBeenCalled();
        expect(serializer).not.toHaveBeenCalled();
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });

    it('does not serialize non-Error 4xx objects or primitives and honors silent routes', async () => {
      const capture = createLogCapture(mode);
      const app = buildApp({ pool: createPoolStub().pool, ...capture.options });
      app.get('/object-400', () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw { statusCode: 400, message: secret, code: secret, body: secret };
      });
      app.get('/primitive-400', (_request, reply) => {
        reply.code(400);
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw secret;
      });
      app.get('/silent-ok', { logLevel: 'silent' }, (request) => {
        request.log.error(secret);
        return { ok: true };
      });
      app.get('/silent-error', { logLevel: 'silent' }, () => {
        throw new Error(secret);
      });
      try {
        for (const url of ['/object-400', '/primitive-400']) {
          const response = await app.inject({ url });
          expect(response.statusCode).toBe(400);
          expect(response.json()).toEqual({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Bad Request'
          });
        }
        const offset = capture.records.length;
        expect((await app.inject({ url: '/silent-ok' })).statusCode).toBe(200);
        expect((await app.inject({ url: '/silent-error' })).statusCode).toBe(500);
        expect(capture.records).toHaveLength(offset);
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });

    it('contains hostile Error proxies and prototype traps without invoking get/name hooks', async () => {
      const capture = createLogCapture(mode);
      const app = buildApp({ pool: createPoolStub().pool, ...capture.options });
      const getter = vi.fn(() => {
        throw new Error(secret);
      });
      const prototypeTrap = vi.fn(() => {
        throw new Error(secret);
      });
      app.get('/proxy-error', () => {
        throw new Proxy(new Error(secret), { get: getter, getPrototypeOf: prototypeTrap });
      });
      try {
        const response = await app.inject({ url: '/proxy-error' });
        expect(response.statusCode).toBe(500);
        expect(response.body).not.toContain(secret);
        expect(getter).not.toHaveBeenCalled();
        expect(prototypeTrap).toHaveBeenCalled();
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });

    it('keeps the real WhatsApp verification route silent', async () => {
      const capture = createLogCapture(mode);
      const { pool, query } = createPoolStub();
      const app = buildApp({
        pool,
        ...capture.options,
        whatsapp: {
          accessToken: 'synthetic-token',
          appSecret: 'synthetic-app-secret',
          verifyToken: secret,
          phoneNumberId: '12345',
          businessAccountId: '67890',
          graphVersion: 'v25.0',
          sendText: async () => {}
        }
      });
      try {
        for (const token of [secret, 'synthetic-wrong-token']) {
          const response = await app.inject({
            url: `/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=123`
          });
          expect(response.statusCode).toBe(token === secret ? 200 : 403);
        }
        expect(capture.records).toEqual([]);
        expect(query).not.toHaveBeenCalled();
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });

    it('bounds request/response/route logs and preserves template, method, UUID, status and duration', async () => {
      const { pool, query } = createPoolStub();
      const capture = createLogCapture(mode);
      const app = buildApp({ pool, ...capture.options });
      app.post('/synthetic/:id', async (request, reply) => {
        const error = Object.assign(new Error(secret, { cause: new Error(secret) }), {
          code: '23505',
          detail: secret,
          query: secret,
          parameters: [secret],
          response: { body: secret }
        });
        request.log.error(
          { err: error, req: request, res: reply, body: request.body, query: request.query },
          secret,
          secret
        );
        app.log.warn(secret);
        app.log.error({ err: error, body: secret }, secret);
        app.log
          .child({ body: secret, cookie: secret }, { serializers: { err: () => ({ secret }) } })
          .warn({ err: error }, secret);
        reply.header('set-cookie', `synthetic=${secret}; HttpOnly`);
        return { ok: true };
      });
      try {
        const response = await app.inject({
          method: 'POST',
          url: `/synthetic/${secret}?access_token=${secret}&liff.state=${secret}`,
          headers: {
            'x-request-id': secret,
            authorization: `Bearer ${secret}`,
            cookie: `synthetic=${secret}`,
            'x-line-access-token': secret,
            'x-telegram-init-data': secret,
            'x-whatsapp-csrf-token': secret,
            'x-telegram-bot-api-secret-token': secret,
            host: `${secret}.invalid`,
            'x-forwarded-for': secret
          },
          payload: { reflection: secret, contact: secret }
        });
        await setImmediate();
        expect(response.statusCode).toBe(200);
        expect(String(response.headers['set-cookie'])).toContain(secret);
        const generated = response.headers['x-request-id'];
        expect(isLogRequestId(generated)).toBe(true);
        expect(capture.records).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: 'request_started',
              reqId: generated,
              method: 'POST',
              route: '/synthetic/:id'
            }),
            expect.objectContaining({
              event: 'request_completed',
              reqId: generated,
              method: 'POST',
              route: '/synthetic/:id',
              statusCode: 200,
              responseTime: expect.any(Number)
            }),
            expect.objectContaining({
              reqId: generated,
              err: { category: 'database', code: '23505' }
            })
          ])
        );
        expect(query).not.toHaveBeenCalled();
        expect(capture.child).not.toHaveBeenCalled();
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });

    it('accepts only UUID request IDs and never logs unmatched raw URLs', async () => {
      const { pool } = createPoolStub();
      const capture = createLogCapture(mode);
      const app = buildApp({ pool, ...capture.options });
      try {
        const accepted = await app.inject({
          url: '/health/live',
          headers: { 'x-request-id': requestId }
        });
        expect(accepted.headers['x-request-id']).toBe(requestId);
        const multiple = await app.inject({
          url: '/health/live',
          headers: { 'x-request-id': [requestId, secret] }
        });
        expect(isLogRequestId(multiple.headers['x-request-id'])).toBe(true);
        expect(multiple.headers['x-request-id']).not.toBe(requestId);
        for (const invalid of [
          secret,
          `${requestId},${secret}`,
          '123e4567-e89b-02d3-a456-426614174000',
          '123e4567-e89b-42d3-0456-426614174000'
        ]) {
          const response = await app.inject({
            url: `/unmatched/${secret}?private=${secret}`,
            headers: { 'x-request-id': invalid }
          });
          expect(response.statusCode).toBe(404);
          expect(isLogRequestId(response.headers['x-request-id'])).toBe(true);
          expect(response.headers['x-request-id']).not.toBe(invalid);
        }
        await setImmediate();
        expect(capture.records).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              reqId: requestId,
              method: 'GET',
              route: '/health/live',
              statusCode: 200
            })
          ])
        );
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });

    it('keeps readiness 503 with bounded network diagnostics', async () => {
      const { pool, query } = createPoolStub();
      const capture = createLogCapture(mode);
      const app = buildApp({ pool, ...capture.options });
      try {
        const response = await app.inject({
          url: '/health/ready',
          headers: { 'x-request-id': requestId }
        });
        await setImmediate();
        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ ok: false, reason: 'database_unavailable' });
        expect(query).toHaveBeenCalledExactlyOnceWith('SELECT 1');
        expect(capture.records).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: 'readiness_failed',
              reqId: requestId,
              method: 'GET',
              route: '/health/ready',
              statusCode: 503,
              err: { category: 'network', code: 'ECONNREFUSED' }
            }),
            expect.objectContaining({
              event: 'request_completed',
              statusCode: 503,
              responseTime: expect.any(Number)
            })
          ])
        );
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });

    it('bounds unhandled Error, non-Error, aggregate and validator/serializer 500 paths', async () => {
      const { pool } = createPoolStub();
      const capture = createLogCapture(mode);
      const app = buildApp({ pool, ...capture.options });
      app.get('/throw-error', () => {
        throw Object.assign(new Error(secret), { code: '23505', detail: secret });
      });
      const messageGetter = vi.fn(() => {
        throw new Error(secret);
      });
      app.get('/throw-getter', () => {
        const error = Object.assign(new Error(), { code: '23505' });
        Object.defineProperty(error, 'message', { get: messageGetter });
        throw error;
      });
      app.get('/throw-consent-object', () => {
        // A plain object must not gain consent-error treatment or change status.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw { message: 'reflection consent required', body: secret };
      });
      app.get('/throw-string', () => {
        // Deliberately exercise Fastify's non-Error throw handling.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw secret;
      });
      app.get('/throw-object', () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw { message: secret, statusCode: 502, code: secret, body: secret };
      });
      app.get('/throw-aggregate', () => {
        throw new AggregateError(
          [Object.assign(new Error(secret), { code: 'ECONNRESET' })],
          secret,
          { cause: new Error(secret) }
        );
      });
      app.post(
        '/validator-500',
        {
          schema: { body: { type: 'object' } },
          validatorCompiler: () => () => {
            throw Object.assign(new Error(secret), {
              code: 'FST_ERR_VALIDATION',
              validation: [{ message: secret }]
            });
          }
        },
        () => ({ ok: true })
      );
      app.get(
        '/serializer-500',
        {
          schema: {
            response: {
              200: {
                type: 'object',
                required: [secret],
                properties: { [secret]: { type: 'string' } }
              }
            }
          }
        },
        () => ({})
      );
      try {
        for (const url of [
          '/throw-error',
          '/throw-getter',
          '/throw-consent-object',
          '/throw-string',
          '/throw-object',
          '/throw-aggregate',
          '/validator-500',
          '/serializer-500'
        ]) {
          const response = await app.inject({
            method: url === '/validator-500' ? 'POST' : 'GET',
            url,
            ...(url === '/validator-500' ? { payload: { private: secret } } : {})
          });
          const status = url === '/throw-object' ? 502 : 500;
          expect(response.statusCode).toBe(status);
          expect(response.json()).toEqual({
            statusCode: status,
            error: status === 502 ? 'Bad Gateway' : 'Internal Server Error',
            message: 'Internal Server Error'
          });
          expect(response.body).not.toContain(secret);
        }
        await setImmediate();
        expect(messageGetter).not.toHaveBeenCalled();
        expect(capture.records).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: 'request_failed',
              route: '/throw-error',
              statusCode: 500,
              err: { category: 'database', code: '23505' }
            }),
            expect.objectContaining({
              event: 'request_failed',
              route: '/validator-500',
              statusCode: 500,
              err: { category: 'validation', code: 'FST_ERR_VALIDATION' }
            }),
            expect.objectContaining({
              event: 'request_failed',
              route: '/throw-aggregate',
              err: { category: 'internal' }
            })
          ])
        );
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });

    it('retains 5xx HTTP status and response headers without exposing arbitrary response errors', async () => {
      const { pool } = createPoolStub();
      const capture = createLogCapture(mode);
      const app = buildApp({ pool, ...capture.options });
      app.get('/unavailable', () => {
        throw Object.assign(new Error(secret), {
          statusCode: 503,
          code: secret,
          headers: { 'retry-after': '1' }
        });
      });
      try {
        const response = await app.inject({ url: '/unavailable' });
        expect(response.statusCode).toBe(503);
        expect(response.headers['retry-after']).toBe('1');
        expect(response.json()).toEqual({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Internal Server Error'
        });
        await setImmediate();
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });

    it('preserves existing delegated Fastify status resolution for conflicting scalar error statuses', async () => {
      const { pool } = createPoolStub();
      const capture = createLogCapture(mode);
      const app = buildApp({ pool, ...capture.options });
      const baseline = Fastify({ logger: false });
      // Reproduce buildApp's existing default-handler delegation, rather than
      // comparing with bare Fastify (delegation can re-enter its parent handler).
      const baselineDefault = baseline.errorHandler;
      baseline.setErrorHandler((error, request, reply) =>
        baselineDefault.call(baseline, error, request, reply)
      );
      const cases = [
        { status: 400, statusCode: 409 },
        { status: 418, statusCode: 422, replyStatus: 409 },
        { status: 400, statusCode: 503 },
        { status: 503, statusCode: 400 },
        { status: 400, statusCode: 503, replyStatus: 200 },
        { status: 503, statusCode: 400, replyStatus: 200 },
        { status: 400, statusCode: 503, replyStatus: 422 }
      ];
      for (const [index, values] of cases.entries()) {
        for (const target of [app, baseline]) {
          target.get(`/status/${index}`, (_request, reply) => {
            if (values.replyStatus !== undefined) reply.code(values.replyStatus);
            throw Object.assign(new Error('fixed conflict'), values);
          });
        }
      }
      try {
        for (const index of cases.keys()) {
          const url = `/status/${index}`;
          const expected = await baseline.inject({ url });
          const response = await app.inject({ url });
          expect(response.statusCode).toBe(expected.statusCode);
          const failures = capture.records.filter(
            (record) =>
              ownLogValue(record, 'event') === 'request_failed' &&
              ownLogValue(record, 'route') === url
          );
          expect(failures).toHaveLength(1);
          expect(ownLogValue(failures[0], 'statusCode')).toBe(response.statusCode);
          // One resolved status controls HTTP, message and diagnostic severity.
          expect(response.json()).toMatchObject({
            message: response.statusCode >= 500 ? 'Internal Server Error' : 'fixed conflict'
          });
          const failureSequence = capture
            .sequence()
            .filter(
              (entry, position) =>
                ownLogValue(capture.records[position], 'route') === url &&
                entry.event === 'request_failed'
            );
          expect(failureSequence).toEqual([
            {
              event: 'request_failed',
              statusCode: response.statusCode,
              level: response.statusCode >= 500 ? 50 : 30
            }
          ]);
        }
        await setImmediate();
        capture.assertPrivate();
      } finally {
        await app.close();
        await baseline.close();
      }
    });

    it('preserves 400 validation, 4xx default response compatibility and exact consent 403 mappings', async () => {
      const { pool } = createPoolStub();
      const capture = createLogCapture(mode);
      const app = buildApp({ pool, ...capture.options });
      app.post(
        '/validation',
        {
          schema: {
            body: {
              type: 'object',
              required: ['count'],
              properties: { count: { type: 'integer' } }
            }
          }
        },
        () => ({ ok: true })
      );
      app.get('/conflict', () => {
        throw Object.assign(new Error('fixed conflict'), {
          statusCode: 409,
          code: 'FIXED_CONFLICT'
        });
      });
      app.get('/inherited-status', () => {
        const prototype: object = Object.assign(Object.create(Error.prototype) as object, {
          statusCode: 418
        });
        const error = new Error('fixed inherited status');
        Object.setPrototypeOf(error, prototype);
        throw error;
      });
      app.get('/inherited-consent', () => {
        const prototype: object = Object.assign(Object.create(Error.prototype) as object, {
          message: 'reflection consent required'
        });
        const error = new Error();
        Object.setPrototypeOf(error, prototype);
        throw error;
      });
      const consentMessages = [
        'privacy acceptance required',
        'privacy credential unavailable',
        'privacy session unavailable',
        'learner eligibility unavailable',
        'reflection consent required'
      ];
      consentMessages.forEach((message, index) => {
        app.get(`/consent/${index}`, () => {
          throw new Error(message);
        });
      });
      try {
        const invalid = await app.inject({
          method: 'POST',
          url: '/validation',
          payload: { count: secret }
        });
        expect(invalid.statusCode).toBe(400);
        expect(invalid.json()).toMatchObject({
          statusCode: 400,
          code: 'FST_ERR_VALIDATION',
          error: 'Bad Request'
        });
        const malformed = await app.inject({
          method: 'POST',
          url: '/validation',
          headers: { 'content-type': 'application/json' },
          payload: `{"private":"${secret}"`
        });
        expect(malformed.statusCode).toBe(400);
        const conflict = await app.inject({ url: '/conflict' });
        expect(conflict.statusCode).toBe(409);
        expect(conflict.json()).toEqual({
          statusCode: 409,
          code: 'FIXED_CONFLICT',
          error: 'Conflict',
          message: 'fixed conflict'
        });
        const inheritedStatus = await app.inject({ url: '/inherited-status' });
        expect(inheritedStatus.statusCode).toBe(418);
        expect(inheritedStatus.json()).toMatchObject({
          statusCode: 418,
          message: 'fixed inherited status'
        });
        const inheritedConsent = await app.inject({ url: '/inherited-consent' });
        expect(inheritedConsent.statusCode).toBe(403);
        expect(inheritedConsent.json()).toEqual({ error: 'reflection_consent_required' });
        for (const [index, message] of consentMessages.entries()) {
          const response = await app.inject({ url: `/consent/${index}` });
          expect(response.statusCode).toBe(403);
          expect(response.json()).toEqual({
            error:
              message === 'reflection consent required'
                ? 'reflection_consent_required'
                : 'privacy_acceptance_required'
          });
        }
        await setImmediate();
        expect(capture.records).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: 'request_failed',
              route: '/validation',
              statusCode: 400,
              err: { category: 'validation', code: 'FST_ERR_VALIDATION' }
            })
          ])
        );
        capture.assertPrivate();
      } finally {
        await app.close();
      }
    });
  });
}

describe('disabled and threshold logging', () => {
  it('keeps normal, genuine 4xx and generic 5xx responses with logging disabled', async () => {
    const app = buildApp({ pool: createPoolStub().pool, logger: false });
    app.get('/bad', () => {
      throw Object.assign(new Error('fixed bad request'), { statusCode: 400, code: 'FIXED_BAD' });
    });
    app.get('/broken', () => {
      throw new Error(secret);
    });
    try {
      expect((await app.inject({ url: '/health/live' })).statusCode).toBe(200);
      const bad = await app.inject({ url: '/bad' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        message: 'fixed bad request',
        code: 'FIXED_BAD'
      });
      const broken = await app.inject({ url: '/broken' });
      expect(broken.statusCode).toBe(500);
      expect(broken.body).not.toContain(secret);
    } finally {
      await app.close();
    }
  });

  it.each([
    ['default', 'warn'],
    ['default', 'error'],
    ['injected', 'warn'],
    ['injected', 'error']
  ] as const)('retains 503 error diagnostics with %s sink at %s threshold', async (mode, level) => {
    const capture = createLogCapture(mode, level);
    const app = buildApp({ pool: createPoolStub().pool, ...capture.options });
    app.log.level = level;
    app.get('/unavailable', () => {
      throw Object.assign(new Error(secret), { statusCode: 503, code: 'ECONNREFUSED' });
    });
    try {
      expect((await app.inject({ url: '/unavailable' })).statusCode).toBe(503);
      expect(capture.sequence()).toEqual([{ event: 'request_failed', statusCode: 503, level: 50 }]);
      expect(ownLogValue(capture.records[0], 'err')).toEqual({
        category: 'network',
        code: 'ECONNREFUSED'
      });
      const offset = capture.records.length;
      expect((await app.inject({ url: '/health/ready' })).statusCode).toBe(503);
      expect(capture.sequence().slice(offset)).toEqual([
        { event: 'readiness_failed', statusCode: 503, level: 50 }
      ]);
      expect(ownLogValue(capture.records[offset], 'err')).toEqual({
        category: 'network',
        code: 'ECONNREFUSED'
      });
      capture.assertPrivate();
    } finally {
      await app.close();
    }
  });
});

describe('legacy redaction export', () => {
  it('retains its compatible redaction configuration', () => {
    expect(apiLogRedaction.censor).toBe('[REDACTED]');
    expect(apiLogRedaction.paths).toContain('req.url');
  });
});
