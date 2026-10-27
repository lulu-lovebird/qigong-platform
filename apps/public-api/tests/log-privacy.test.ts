import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyLogFailure,
  createPrivacyLogger,
  logRuntimeDiagnostic,
  logWorkerDiagnostic,
  sanitizeReceiptDispatchEvent,
  sanitizeLogError,
  sanitizeLogRecord,
  type RuntimeDiagnostic
} from '../src/log-privacy.js';

const secret = 'synthetic-private-log-sentinel';
const requestId = '123e4567-e89b-42d3-a456-426614174000';
const routes = new Set(['/synthetic/:id']);

const captureSink = () => {
  const records: unknown[][] = [];
  const write = (...args: unknown[]) => {
    records.push(args);
  };
  const child = vi.fn((): FastifyBaseLogger => sink);
  const sink: FastifyBaseLogger = {
    level: 'trace',
    fatal: write,
    error: write,
    warn: write,
    info: write,
    debug: write,
    trace: write,
    silent: write,
    child
  };
  return { sink, child, records };
};

describe('allowlisted log diagnostics', () => {
  it.each(['23505', '42501', '40P01', '08006'])(
    'retains explicitly allowed SQLSTATE %s without error text',
    (code) => {
      const error = Object.assign(new Error(secret, { cause: new Error(secret) }), {
        code,
        detail: secret,
        query: secret,
        parameters: [secret],
        providerBody: { secret }
      });
      expect(sanitizeLogError(error)).toEqual({ category: 'database', code });
      expect(JSON.stringify(sanitizeLogRecord({ err: error }, routes))).not.toContain(secret);
    }
  );

  it.each(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'])(
    'retains allowlisted network code %s',
    (code) => {
      expect(sanitizeLogError({ code, message: secret })).toEqual({ category: 'network', code });
    }
  );

  it('retains validation category but not validation data', () => {
    expect(
      sanitizeLogError({ code: 'FST_ERR_VALIDATION', validation: [{ message: secret }] })
    ).toEqual({ category: 'validation', code: 'FST_ERR_VALIDATION' });
  });

  it.each([
    undefined,
    null,
    secret,
    42,
    { code: secret },
    { code: 'ZZ999' },
    { code: 'P0001' },
    { code: '23599' },
    { code: { toString: () => secret } },
    Object.create({ code: '23505' }) as unknown
  ])('makes unknown and inherited diagnostics generic (%#)', (input: unknown) => {
    expect(sanitizeLogError(input)).toEqual({ category: 'internal' });
  });

  it('does not traverse aggregate, cause, circular or nested errors', () => {
    const circular: { cause?: unknown; err?: unknown } = {};
    circular.cause = circular;
    circular.err = { code: '23505', message: secret };
    for (const error of [
      new Error(secret, { cause: { code: '23505', message: secret } }),
      new AggregateError([{ code: '23505', message: secret }, new Error(secret)], secret),
      { nested: { code: '23505', message: secret } },
      circular
    ]) {
      expect(sanitizeLogError(error)).toEqual({ category: 'internal' });
      expect(JSON.stringify(sanitizeLogRecord({ err: error }, routes))).not.toContain(secret);
    }
  });

  it('never invokes accessors, prototype hooks or serialization hooks', () => {
    const getter = vi.fn(() => {
      throw new Error(secret);
    });
    const input: object = Object.create({ code: '23505' }) as object;
    for (const key of [
      'code',
      'message',
      'err',
      'reqId',
      'auditRequestId',
      'event',
      'route',
      'toJSON',
      'stack',
      'cause',
      'errors'
    ]) {
      Object.defineProperty(input, key, { get: getter });
    }
    expect(sanitizeLogError(input)).toEqual({ category: 'internal' });
    expect(sanitizeLogRecord(input, routes)).toEqual({ event: 'application' });
    expect(getter).not.toHaveBeenCalled();
    const descriptorTrap = vi.fn(() => {
      throw new Error(secret);
    });
    const proxy = new Proxy(
      {},
      { getOwnPropertyDescriptor: descriptorTrap, getPrototypeOf: getter }
    );
    expect(sanitizeLogError(proxy)).toEqual({ category: 'internal' });
    expect(sanitizeLogRecord(proxy, routes)).toEqual({ event: 'application' });
    expect(descriptorTrap).toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  it('admits only a bounded UUIDv4 audit mapping on the dedicated attempt event', () => {
    const event = 'venue_debug_audit_attempt';
    expect(
      sanitizeLogRecord({ event, reqId: requestId, auditRequestId: requestId }, routes)
    ).toEqual({ event, reqId: requestId, auditRequestId: requestId });
    for (const auditRequestId of [
      secret,
      secret + '\r\n',
      'a'.repeat(1000),
      null,
      { toString: () => requestId },
      [requestId],
      requestId.replace('-4', '-1')
    ]) {
      expect(sanitizeLogRecord({ event, auditRequestId }, routes)).toEqual({ event });
    }
    expect(
      sanitizeLogRecord({ event: 'request_completed', auditRequestId: requestId }, routes)
    ).toEqual({ event: 'request_completed' });
    const inherited: object = Object.create({ auditRequestId: requestId }) as object;
    Object.assign(inherited, { event });
    expect(sanitizeLogRecord(inherited, routes)).toEqual({ event });
    const getter = vi.fn(() => {
      throw new Error(secret);
    });
    const input = Object.defineProperty({ event }, 'auditRequestId', { get: getter });
    expect(sanitizeLogRecord(input, routes)).toEqual({ event });
    expect(getter).not.toHaveBeenCalled();
    expect(
      sanitizeLogRecord(
        {
          event,
          auditRequestId: requestId,
          headers: secret,
          body: secret,
          proof: secret,
          tokenHash: secret,
          latitude: 25,
          longitude: 121
        },
        routes
      )
    ).toEqual({ event, auditRequestId: requestId });
  });

  it('bounds every scalar and accepts routes only from the registered template set', () => {
    expect(
      sanitizeLogRecord(
        {
          event: 'request_completed',
          reqId: requestId,
          method: 'POST',
          route: '/synthetic/:id',
          statusCode: 503,
          responseTime: 1.25,
          signal: 'SIGTERM',
          req: { headers: { cookie: secret } },
          res: { headers: { 'set-cookie': secret } },
          body: secret,
          ip: secret,
          host: secret,
          arbitrary: secret
        },
        routes,
        secret
      )
    ).toEqual({
      event: 'request_completed',
      reqId: requestId,
      method: 'POST',
      route: '/synthetic/:id',
      statusCode: 503,
      responseTime: 1.25,
      signal: 'SIGTERM'
    });
    expect(
      sanitizeLogRecord(
        {
          event: secret,
          reqId: secret,
          method: secret,
          route: '/synthetic/private-value',
          statusCode: 600,
          responseTime: Infinity,
          signal: secret
        },
        routes,
        secret
      )
    ).toEqual({ event: 'application' });
    for (const number of [NaN, Infinity, -1, Number.MAX_VALUE]) {
      expect(sanitizeLogRecord({ statusCode: number, responseTime: number }, routes)).toEqual({
        event: 'application'
      });
    }
  });
});

describe('runtime and persisted diagnostics', () => {
  it('bounds runtime output independently from HTTP events', () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      logRuntimeDiagnostic({
        event: 'api_oidc_failed',
        err: Object.assign(new Error(secret), { code: 'ECONNRESET', detail: secret }),
        signal: 'SIGTERM'
      });
      logRuntimeDiagnostic({
        event: secret,
        signal: secret,
        err: { category: secret, code: secret },
        message: secret
      } as unknown as RuntimeDiagnostic);
      const getter = vi.fn(() => {
        throw new Error(secret);
      });
      const hostile = new Proxy({}, { getOwnPropertyDescriptor: getter });
      logRuntimeDiagnostic(hostile as RuntimeDiagnostic);
      expect(output.mock.calls.map(([text]) => JSON.parse(String(text)) as unknown)).toEqual([
        {
          event: 'api_oidc_failed',
          err: { category: 'network', code: 'ECONNRESET' },
          signal: 'SIGTERM'
        },
        { event: 'api_entry_failed', err: { category: 'internal' } },
        { event: 'api_entry_failed', err: { category: 'internal' } }
      ]);
      expect(JSON.stringify(output.mock.calls)).not.toContain(secret);
      expect(sanitizeLogRecord({ event: 'api_oidc_failed' }, routes)).toEqual({
        event: 'application'
      });
      output.mockImplementation(() => {
        throw new Error(secret);
      });
      expect(() => logRuntimeDiagnostic({ event: 'api_close_failed', err: hostile })).not.toThrow();
    } finally {
      output.mockRestore();
    }
  });

  it('persists only fixed categories and explicitly allowed codes', () => {
    expect(classifyLogFailure({ code: '23505', message: secret })).toBe('database:23505');
    expect(classifyLogFailure({ code: 'ETIMEDOUT', message: secret })).toBe('network:ETIMEDOUT');
    expect(classifyLogFailure({ code: 'FST_ERR_VALIDATION', message: secret })).toBe(
      'validation:FST_ERR_VALIDATION'
    );
    for (const input of [
      secret,
      undefined,
      new Error(secret),
      { name: secret, code: secret },
      new AggregateError([secret], secret)
    ]) {
      expect(classifyLogFailure(input)).toBe('internal');
    }
  });
});

describe('separate worker boundaries', () => {
  it('retains valid metrics but never arbitrary runtime fields or serialization hooks', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hook = vi.fn(() => {
      throw new Error(secret);
    });
    try {
      const metric = Object.defineProperty(
        {
          event: 'practice_receipt_batch',
          kind: 'batch',
          channel: 'line',
          claimed: 3,
          failures: 1,
          durationMs: 5,
          subject: secret,
          cause: new AggregateError([secret], secret)
        },
        'toJSON',
        { get: hook }
      );
      logWorkerDiagnostic(metric);
      logWorkerDiagnostic({
        event: 'notification_worker_delivery_failed',
        lane: 'onboarding',
        err: { code: '23505', detail: secret },
        id: secret
      });
      expect(log.mock.calls).toEqual([
        [
          JSON.stringify({
            event: 'practice_receipt_batch',
            kind: 'batch',
            channel: 'line',
            claimed: 3,
            failures: 1,
            durationMs: 5
          })
        ]
      ]);
      expect(error.mock.calls).toEqual([
        [
          JSON.stringify({
            event: 'notification_worker_delivery_failed',
            err: { category: 'database', code: '23505' },
            lane: 'onboarding'
          })
        ]
      ]);
      expect(hook).not.toHaveBeenCalled();
      expect(sanitizeLogRecord(metric, routes)).toEqual({ event: 'application' });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it.each([
    { channel: 'telegram', claimed: 1 },
    { channel: 'telegram', claimed: 3 },
    { channel: 'line', claimed: 1 },
    { channel: 'line', claimed: 3 }
  ])(
    'retains both delivery and lease error signals for $claimed claimed $channel receipts',
    ({ channel, claimed }) => {
      const event = { kind: 'batch', channel, claimed, failures: claimed * 2, durationMs: 1 };
      expect(sanitizeReceiptDispatchEvent({ ...event, detail: secret })).toEqual(event);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        logWorkerDiagnostic({ ...event, event: 'practice_receipt_batch', detail: secret });
        expect(log.mock.calls).toEqual([
          [JSON.stringify({ event: 'practice_receipt_batch', ...event })]
        ]);
        expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
      } finally {
        vi.restoreAllMocks();
      }
    }
  );

  it.each([
    { kind: 'poll', channel: 'telegram', claimed: 3, failures: 0, durationMs: 1 },
    { kind: 'batch', channel: 'line', claimed: 0, failures: 0, durationMs: 1 },
    { kind: 'batch', channel: 'line', claimed: 4, failures: 0, durationMs: 1 },
    { kind: 'batch', channel: 'line', claimed: 1, failures: 3, durationMs: 1 },
    { kind: 'batch', channel: 'telegram', claimed: 3, failures: 7, durationMs: 1 },
    { kind: 'poll', channel: 'telegram', claimed: 0, failures: 1, durationMs: 1 },
    ...[NaN, Infinity, -1, Number.MAX_VALUE, secret].map((failures) => ({
      kind: 'batch',
      channel: 'line',
      claimed: 1,
      failures,
      durationMs: 1
    })),
    Object.create({ kind: 'error', channel: 'line' }) as unknown,
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error(secret);
        }
      }
    ),
    Object.defineProperty({ channel: 'line' }, 'kind', {
      get() {
        throw new Error(secret);
      }
    })
  ])('rejects malformed progress evidence %#', (event) => {
    expect(sanitizeReceiptDispatchEvent(event)).toBeUndefined();
  });

  it('reconstructs heartbeat fields and nulls without traversing hostile lane data', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const lane = {
        lastCompletedPollAgeMs: 10,
        lastSuccessfulPollAgeMs: null,
        lastErrorAgeMs: 1,
        consecutiveErrors: 1,
        errorSignals: 2,
        schemaMismatch: false,
        subject: secret,
        toJSON() {
          throw new Error(secret);
        }
      };
      logWorkerDiagnostic({
        event: 'practice_receipt_worker_heartbeat',
        uptimeSeconds: 30,
        lanes: { line: lane, telegram: null },
        secret
      });
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
        event: 'practice_receipt_worker_heartbeat',
        uptimeSeconds: 30,
        lanes: {
          line: {
            lastCompletedPollAgeMs: 10,
            lastSuccessfulPollAgeMs: null,
            lastErrorAgeMs: 1,
            consecutiveErrors: 1,
            errorSignals: 2,
            schemaMismatch: false
          },
          telegram: null
        }
      });
      logWorkerDiagnostic({
        event: 'practice_receipt_worker_heartbeat',
        uptimeSeconds: Infinity,
        lanes: {
          line: { ...lane, errorSignals: NaN },
          telegram: new Proxy(
            {},
            {
              getOwnPropertyDescriptor() {
                throw new Error(secret);
              }
            }
          )
        }
      });
      expect(JSON.parse(String(log.mock.calls[1]?.[0]))).toEqual({
        event: 'practice_receipt_worker_heartbeat',
        lanes: { line: null, telegram: null }
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('contains unknown events, circular errors, and closed sinks', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const circular: { cause?: unknown } = {};
      circular.cause = circular;
      logWorkerDiagnostic({ event: secret, err: circular });
      expect(error.mock.calls).toEqual([
        [
          JSON.stringify({
            event: 'practice_receipt_worker_report_invalid',
            err: { category: 'internal' }
          })
        ]
      ]);
      error.mockImplementation(() => {
        throw new Error(secret);
      });
      expect(() =>
        logWorkerDiagnostic({ event: 'notification_worker_pool_failed', err: circular })
      ).not.toThrow();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('logger sink boundary', () => {
  it('recognizes empty native errors without inspecting hostile prototypes', () => {
    for (const error of [new Error(), new TypeError(), new AggregateError([])]) {
      expect(sanitizeLogRecord(error, routes)).toEqual({
        event: 'application',
        err: { category: 'internal' }
      });
    }
    expect(sanitizeLogRecord({ err: null, code: '23505' }, routes)).toEqual({
      event: 'application',
      err: { category: 'internal' }
    });
  });

  it('isolates child levels and preserves nested bound events', () => {
    const { sink, records } = captureSink();
    const logger = createPrivacyLogger(sink, routes);
    const sibling = logger.child({});
    const child = logger.child({ event: 'help_image_unavailable' }, { level: 'warn' }).child({});
    child.info({});
    child.warn({});
    child.level = 'silent';
    child.error(new Error());
    expect(child.level).toBe('silent');
    expect(logger.level).toBe('trace');
    expect(sibling.level).toBe('trace');
    expect(sink.level).toBe('trace');
    sibling.info({});
    expect(records).toEqual([
      [{ event: 'help_image_unavailable' }, 'help_image_unavailable'],
      [{ event: 'application' }, 'application']
    ]);
    const getter = vi.fn(() => 'trace');
    const options = Object.defineProperty({}, 'level', { get: getter });
    logger.child({}, options).info({});
    expect(getter).not.toHaveBeenCalled();
  });

  it('uses only a sanitized level when a child lowers the sink threshold', () => {
    const root = captureSink();
    const lower = captureSink();
    root.sink.level = 'warn';
    root.child.mockReturnValue(lower.sink);
    const logger = createPrivacyLogger(root.sink, routes);
    const child = logger.child(
      { event: 'help_image_unavailable' },
      {
        level: 'info',
        serializers: { err: () => ({ secret }) }
      }
    );
    child.info(new Error());
    expect(root.child).toHaveBeenCalledExactlyOnceWith({}, { level: 'info' });
    expect(root.records).toEqual([]);
    expect(lower.records).toEqual([
      [{ event: 'help_image_unavailable', err: { category: 'internal' } }, 'help_image_unavailable']
    ]);
    child.level = 'trace';
    expect(root.child).toHaveBeenLastCalledWith({}, { level: 'trace' });
    expect(root.sink.level).toBe('warn');
    expect(logger.level).toBe('warn');
  });

  it('normalizes the legacy requestId field and ignores hostile inherited bindings', () => {
    const { sink, records } = captureSink();
    const logger = createPrivacyLogger(sink, routes);
    logger.error({ requestId, err: { code: '42501', message: secret } }, secret);
    const inherited: object = Object.create({
      reqId: secret,
      route: secret,
      err: { code: '23505' }
    }) as object;
    logger.child(inherited).info({ signal: 'SIGINT' }, secret);
    expect(records).toEqual([
      [
        { event: 'application', reqId: requestId, err: { category: 'database', code: '42501' } },
        'application'
      ],
      [{ event: 'application', signal: 'SIGINT' }, 'application']
    ]);
  });

  it('bounds every level, direct errors, messages, interpolation and child bindings', () => {
    const { sink, records, child } = captureSink();
    const logger = createPrivacyLogger(sink, routes);
    const bound = logger
      .child(
        { reqId: requestId, method: 'POST', route: '/synthetic/:id', cookie: secret },
        {
          serializers: { err: () => ({ secret }) }
        }
      )
      .child({ nested: { secret }, requestId: secret });
    for (const level of ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const) {
      bound[level](
        { err: Object.assign(new Error(secret), { code: '23505' }), body: secret },
        secret,
        secret
      );
      bound[level](secret);
      bound[level](Object.assign(new Error(secret), { code: 'ECONNRESET' }));
    }
    expect(child).not.toHaveBeenCalled();
    expect(records).toHaveLength(18);
    expect(JSON.stringify(records)).not.toContain(secret);
    expect(records[0]).toEqual([
      {
        event: 'application',
        reqId: requestId,
        method: 'POST',
        route: '/synthetic/:id',
        err: { category: 'database', code: '23505' }
      },
      'application'
    ]);
    expect(records[2]).toEqual([
      {
        event: 'application',
        reqId: requestId,
        method: 'POST',
        route: '/synthetic/:id',
        err: { category: 'network', code: 'ECONNRESET' }
      },
      'application'
    ]);
    logger.level = secret;
    expect(sink.level).toBe('trace');
    logger.level = 'warn';
    expect(logger.level).toBe('warn');
    expect(sink.level).toBe('trace');
  });
});
