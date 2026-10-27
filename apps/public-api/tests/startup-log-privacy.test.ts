import type * as FileSystem from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  environment: vi.fn(),
  pool: vi.fn(),
  attach: vi.fn(),
  oidc: vi.fn(),
  build: vi.fn(),
  readiness: vi.fn(),
  realpath: vi.fn((path: string) => path)
}));
vi.mock('@qigong/config', () => ({ loadEnvironment: mocks.environment }));
vi.mock('@qigong/database', () => ({
  createPool: mocks.pool,
  attachPoolErrorHandler: mocks.attach
}));
vi.mock('../src/app.js', () => ({ buildApp: mocks.build, checkStartupReadiness: mocks.readiness }));
vi.mock('../src/oidc-provider.js', () => ({ createAdminOidcProvider: mocks.oidc }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  realpathSync: mocks.realpath
}));
import { main, runPublicApi } from '../src/index.js';

const importEffects = {
  environment: mocks.environment.mock.calls.length,
  pool: mocks.pool.mock.calls.length,
  oidc: mocks.oidc.mock.calls.length,
  app: mocks.build.mock.calls.length
};
const sentinel = 'synthetic-private-startup-sentinel';
const environment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.9',
  PORT: 4321,
  DATABASE_URL: 'postgresql://synthetic.invalid/test',
  DATABASE_POOL_MAX: 2,
  DATABASE_CONNECTION_TIMEOUT_MS: 100,
  DATABASE_STATEMENT_TIMEOUT_MS: 100,
  LOG_LEVEL: 'info'
};
const end = vi.fn(async () => {});
const close = vi.fn(async () => {});
const listen = vi.fn(async () => {});
const exit = vi.fn<(code: 0 | 1) => void>();
const hooks = new Map<string, () => void>();
const hostile = new Proxy(
  {},
  {
    getOwnPropertyDescriptor() {
      throw new Error(sentinel);
    },
    get() {
      throw new Error(sentinel);
    }
  }
);
const error = Object.assign(new Error(sentinel, { cause: new Error(sentinel) }), {
  code: 'ECONNRESET',
  detail: sentinel,
  query: sentinel,
  parameters: [sentinel]
});
const captureOutput = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const captureStdout = () => vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
const captureStderr = () => vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
let output: ReturnType<typeof captureOutput>;
let stdout: ReturnType<typeof captureStdout>;
let stderr: ReturnType<typeof captureStderr>;

const records = () =>
  output.mock.calls.map(
    ([text]) =>
      JSON.parse(String(text)) as {
        event: string;
        err?: { category: string; code?: string };
        signal?: string;
      }
  );
const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<Value>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const settle = async () => {
  for (let count = 0; count < 12; count++) await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  hooks.clear();
  output = captureOutput();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  stdout = captureStdout();
  stderr = captureStderr();
  vi.spyOn(process, 'on').mockImplementation((event, listener) => {
    if (event === 'SIGINT' || event === 'SIGTERM') hooks.set(event, listener as () => void);
    return process;
  });
  vi.spyOn(process, 'off').mockImplementation((event) => {
    if (typeof event === 'string') hooks.delete(event);
    return process;
  });
  mocks.environment.mockReturnValue(environment);
  mocks.pool.mockReturnValue({ end });
  mocks.oidc.mockResolvedValue({ syntheticProvider: true });
  mocks.build.mockReturnValue({ close, listen });
  mocks.readiness.mockResolvedValue({ ready: true });
  mocks.realpath.mockImplementation((path: string) => path);
  end.mockResolvedValue(undefined);
  close.mockResolvedValue(undefined);
  listen.mockResolvedValue(undefined);
});
afterEach(() => {
  expect(JSON.stringify([output.mock.calls, stdout.mock.calls, stderr.mock.calls])).not.toContain(
    sentinel
  );
  expect(console.log).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('contained startup boundaries', () => {
  it('does not initialize configuration, pools, providers or app on import', () => {
    expect(importEffects).toEqual({ environment: 0, pool: 0, oidc: 0, app: 0 });
  });

  it('contains app module evaluation failure before an app exists', async () => {
    vi.doMock('../src/app.js', () => {
      throw new Error(sentinel);
    });
    try {
      await runPublicApi({}, exit);
      expect(records()).toEqual([{ event: 'api_build_failed', err: { category: 'internal' } }]);
      expect(mocks.build).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      expect(end).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      vi.doMock('../src/app.js', () => ({
        buildApp: mocks.build,
        checkStartupReadiness: mocks.readiness
      }));
    }
  });
  it.each([
    ['environment', 'api_environment_failed', 0, 0],
    ['pool', 'api_pool_failed', 0, 0],
    ['oidc', 'api_oidc_failed', 1, 0],
    ['build', 'api_build_failed', 1, 0],
    ['readiness', 'api_readiness_failed', 1, 1]
  ] as const)(
    'contains %s throws and cleans acquired resources',
    async (stage, event, ends, closes) => {
      mocks[stage].mockImplementationOnce(() => {
        throw error;
      });
      await runPublicApi({}, exit);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(end).toHaveBeenCalledTimes(ends);
      expect(close).toHaveBeenCalledTimes(closes);
      expect(listen).not.toHaveBeenCalled();
      expect(records()).toEqual([{ event, err: { category: 'network', code: 'ECONNRESET' } }]);
    }
  );

  it.each([
    { VENUE_QR_CHECKIN_ENABLED: sentinel },
    { VENUE_QR_CHECKIN_ENABLED: 'true' },
    { VENUE_QR_CHECKIN_ENABLED: 'true', VENUE_QR_PUBLIC_ORIGIN: sentinel },
    { TELEGRAM_ONBOARDING_BOT_TOKEN: sentinel },
    { TELEGRAM_ONBOARDING_BOT_TOKEN: sentinel, TELEGRAM_ONBOARDING_WEBHOOK_SECRET: sentinel },
    { LINE_CHANNEL_SECRET: sentinel },
    {
      LINE_CHANNEL_SECRET: sentinel,
      LINE_CHANNEL_ACCESS_TOKEN: sentinel,
      LINE_LOGIN_CHANNEL_ID: sentinel,
      LINE_LIFF_ID: sentinel
    },
    { WHATSAPP_ACCESS_TOKEN: sentinel },
    {
      WHATSAPP_PHONE_NUMBER_ID: sentinel,
      WHATSAPP_ACCESS_TOKEN: sentinel,
      WHATSAPP_GRAPH_VERSION: sentinel,
      WHATSAPP_BUSINESS_ACCOUNT_ID: sentinel,
      WHATSAPP_APP_SECRET: sentinel,
      WHATSAPP_VERIFY_TOKEN: sentinel
    }
  ])('contains partial/invalid channel configuration %#', async (source) => {
    await runPublicApi(source, exit);
    expect(records()).toEqual([{ event: 'api_channels_failed', err: { category: 'internal' } }]);
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('contains invalid WhatsApp invite configuration without changing startup order', async () => {
    await runPublicApi({ WHATSAPP_INVITE_CHAT_NUMBER: sentinel }, exit);
    expect(mocks.oidc).toHaveBeenCalledOnce();
    expect(mocks.build).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledOnce();
    expect(records()[0]?.event).toBe('api_invites_failed');
  });

  it('contains asynchronous readiness rejection', async () => {
    mocks.readiness.mockRejectedValueOnce(hostile);
    await runPublicApi({}, exit);
    expect(listen).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(records()).toEqual([{ event: 'api_readiness_failed', err: { category: 'internal' } }]);
  });

  it('contains Zod configuration errors including embedded input', async () => {
    mocks.environment.mockImplementationOnce(() => z.literal('allowed').parse(sentinel));
    await runPublicApi({}, exit);
    expect(records()[0]?.event).toBe('api_environment_failed');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('validates invites after OIDC but before build without leaking their value', async () => {
    await runPublicApi({ TELEGRAM_INVITE_BOT_USERNAME: sentinel }, exit);
    expect(mocks.oidc).toHaveBeenCalledOnce();
    expect(mocks.build).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledOnce();
    expect(records()[0]?.event).toBe('api_invites_failed');
  });

  it.each([sentinel, undefined, hostile, new AggregateError([error], sentinel), { cause: error }])(
    'contains unknown OIDC rejection %# and a second cleanup failure',
    async (thrown) => {
      mocks.oidc.mockRejectedValueOnce(thrown);
      end.mockRejectedValueOnce(hostile);
      await runPublicApi({}, exit);
      expect(records()).toEqual([
        { event: 'api_oidc_failed', err: { category: 'internal' } },
        { event: 'api_pool_end_failed', err: { category: 'internal' } }
      ]);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    }
  );

  it('fails closed for readiness false without copying its reason', async () => {
    mocks.readiness.mockResolvedValueOnce({ ready: false, reason: sentinel });
    await runPublicApi({}, exit);
    expect(listen).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(records()[0]?.event).toBe('api_readiness_failed');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('preserves listen failure and independently contains both cleanup rejections', async () => {
    listen.mockRejectedValueOnce(error);
    close.mockRejectedValueOnce(hostile);
    end.mockRejectedValueOnce(new Error(sentinel));
    await runPublicApi({}, exit);
    expect(records().map(({ event }) => event)).toEqual([
      'api_listen_failed',
      'api_close_failed',
      'api_pool_end_failed'
    ]);
    expect(close).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('contains entry realpath failure without running the API', async () => {
    const previous = process.exitCode;
    mocks.realpath.mockImplementationOnce(() => {
      throw error;
    });
    try {
      await main('/synthetic.invalid/entry');
      expect(process.exitCode).toBe(1);
      expect(mocks.environment).not.toHaveBeenCalled();
      expect(records()[0]?.event).toBe('api_entry_failed');
    } finally {
      process.exitCode = previous;
    }
  });

  it('executes the direct-entry failure boundary with synthetic process state', async () => {
    const directExit = vi.fn();
    vi.stubGlobal('process', { env: {}, exit: directExit, on: vi.fn(), off: vi.fn() });
    mocks.environment.mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- Exercise arbitrary thrown configuration input.
      throw hostile;
    });
    await main(fileURLToPath(new URL('../src/index.ts', import.meta.url)));
    expect(directExit).toHaveBeenCalledExactlyOnceWith(1);
    expect(records()[0]?.event).toBe('api_environment_failed');
    vi.unstubAllGlobals();
  });
});

describe('running API lifecycle', () => {
  it('passes enabled channel config, invites, version, host and port through unchanged', async () => {
    const source = {
      TELEGRAM_ONBOARDING_BOT_TOKEN: '123456:' + 'x'.repeat(35),
      TELEGRAM_ONBOARDING_WEBHOOK_SECRET: 'y'.repeat(32),
      TELEGRAM_ONBOARDING_REGION_CODE: 'synthetic-region',
      LINE_CHANNEL_SECRET: 's'.repeat(16),
      LINE_CHANNEL_ACCESS_TOKEN: 't'.repeat(20),
      LINE_LOGIN_CHANNEL_ID: '1234',
      LINE_LIFF_ID: '1234-Synthetic',
      WHATSAPP_PHONE_NUMBER_ID: '1234',
      WHATSAPP_ACCESS_TOKEN: 'w'.repeat(20),
      WHATSAPP_GRAPH_VERSION: 'v25.0',
      WHATSAPP_BUSINESS_ACCOUNT_ID: '5678',
      WHATSAPP_APP_SECRET: 'a'.repeat(16),
      WHATSAPP_VERIFY_TOKEN: 'v'.repeat(20),
      TELEGRAM_INVITE_BOT_USERNAME: 'SyntheticBot',
      WHATSAPP_INVITE_CHAT_NUMBER: '+12025550123',
      SERVICE_VERSION: 'synthetic-version',
      VENUE_QR_CHECKIN_ENABLED: 'true',
      VENUE_QR_PUBLIC_ORIGIN: 'https://synthetic.invalid'
    };
    await runPublicApi(source, exit);
    expect(mocks.environment).toHaveBeenCalledExactlyOnceWith(source);
    expect(mocks.pool).toHaveBeenCalledExactlyOnceWith(environment);
    expect(mocks.build).toHaveBeenCalledExactlyOnceWith({
      pool: { end },
      adminAuth: { syntheticProvider: true },
      serviceVersion: source.SERVICE_VERSION,
      venueQr: { enabled: true, publicOrigin: source.VENUE_QR_PUBLIC_ORIGIN },
      telegramOnboarding: {
        botToken: source.TELEGRAM_ONBOARDING_BOT_TOKEN,
        webhookSecret: source.TELEGRAM_ONBOARDING_WEBHOOK_SECRET,
        regionCode: source.TELEGRAM_ONBOARDING_REGION_CODE
      },
      line: {
        channelSecret: source.LINE_CHANNEL_SECRET,
        channelAccessToken: source.LINE_CHANNEL_ACCESS_TOKEN,
        loginChannelId: source.LINE_LOGIN_CHANNEL_ID,
        liffId: source.LINE_LIFF_ID
      },
      whatsapp: {
        phoneNumberId: source.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: source.WHATSAPP_ACCESS_TOKEN,
        graphVersion: source.WHATSAPP_GRAPH_VERSION,
        businessAccountId: source.WHATSAPP_BUSINESS_ACCOUNT_ID,
        appSecret: source.WHATSAPP_APP_SECRET,
        verifyToken: source.WHATSAPP_VERIFY_TOKEN
      },
      inviteTransports: { telegram: 'SyntheticBot', whatsapp: '12025550123' }
    });
    expect(mocks.readiness).toHaveBeenCalledExactlyOnceWith({ end }, true);
    expect(listen).toHaveBeenCalledExactlyOnceWith({
      host: environment.HOST,
      port: environment.PORT
    });
    expect(exit).not.toHaveBeenCalled();
    expect(mocks.pool.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.oidc.mock.invocationCallOrder[0]!
    );
    expect(mocks.readiness.mock.invocationCallOrder[0]).toBeLessThan(
      listen.mock.invocationCallOrder[0]!
    );
  });

  it('forwards independently enabled venue suite configuration to both build and readiness', async () => {
    const origin = 'https://synthetic.invalid';
    await runPublicApi(
      {
        VENUE_HISTORY_ENABLED: 'true',
        VENUE_HISTORY_PUBLIC_ORIGIN: origin,
        VENUE_MANAGEMENT_ENABLED: 'true',
        VENUE_MANAGEMENT_PUBLIC_ORIGIN: origin,
        VENUE_PEOPLE_ENABLED: 'true',
        VENUE_PEOPLE_PUBLIC_ORIGIN: origin,
        LINE_CHANNEL_SECRET: 'synthetic-secret-at-least-16',
        LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-token-at-least-20',
        LINE_LOGIN_CHANNEL_ID: '123',
        LINE_LIFF_ID: '123-synthetic'
      },
      exit
    );
    const enabled = { enabled: true, publicOrigin: origin };
    const venueSuite = { history: enabled, management: enabled, people: enabled };
    expect(mocks.build).toHaveBeenCalledWith(expect.objectContaining({ venueSuite }));
    expect(mocks.readiness).toHaveBeenCalledExactlyOnceWith({ end }, false, venueSuite);
    expect(listen).toHaveBeenCalledOnce();
  });
  it.each(['HISTORY', 'MANAGEMENT', 'PEOPLE'])(
    'rejects enabled %s without a trusted origin before allocating a pool',
    async (feature) => {
      await runPublicApi({ ['VENUE_' + feature + '_ENABLED']: 'true' }, exit);
      expect(mocks.pool).not.toHaveBeenCalled();
      expect(mocks.build).not.toHaveBeenCalled();
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    }
  );
  it('does not enable omitted channels or change development version fallback', async () => {
    await runPublicApi({}, exit);
    expect(mocks.readiness).toHaveBeenCalledExactlyOnceWith({ end }, false);
    expect(mocks.build).toHaveBeenCalledExactlyOnceWith({
      pool: { end },
      adminAuth: { syntheticProvider: true },
      inviteTransports: {},
      serviceVersion: 'development'
    });
  });

  it('reports idle pool errors safely even before app construction', async () => {
    mocks.oidc.mockImplementationOnce(async () => {
      const callback = mocks.attach.mock.calls[0]?.[1] as (err: unknown) => void;
      callback(error);
      callback(hostile);
      return {};
    });
    await runPublicApi({}, exit);
    expect(records()).toEqual([
      { event: 'api_idle_pool_failed', err: { category: 'network', code: 'ECONNRESET' } },
      { event: 'api_idle_pool_failed', err: { category: 'internal' } }
    ]);
    expect(exit).not.toHaveBeenCalled();
  });

  it.each([
    { stage: 'readiness', signal: 'SIGTERM', timing: 'during cleanup' },
    { stage: 'readiness', signal: 'SIGINT', timing: 'after cleanup' },
    { stage: 'listen', signal: 'SIGINT', timing: 'during cleanup' },
    { stage: 'listen', signal: 'SIGTERM', timing: 'after cleanup' }
  ] as const)(
    'exits once with failure when $stage rejects $timing after $signal',
    async ({ stage, signal, timing }) => {
      const entered = deferred<void>();
      const pending = deferred<unknown>();
      const closing = deferred<void>();
      const ended = deferred<void>();
      const operation = stage === 'readiness' ? mocks.readiness : listen;
      operation.mockImplementationOnce(() => {
        entered.resolve(undefined);
        return pending.promise;
      });
      if (timing === 'during cleanup') close.mockReturnValueOnce(closing.promise);
      end.mockImplementationOnce(async () => {
        ended.resolve(undefined);
      });
      const running = runPublicApi({}, exit);
      await entered.promise;
      hooks.get(signal)?.();
      hooks.get(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT')?.();
      if (timing === 'after cleanup') {
        await ended.promise;
        await settle();
      }
      const prematureExits = exit.mock.calls.length;
      pending.reject(error);
      await settle();
      closing.resolve(undefined);
      await running;
      await settle();
      expect(prematureExits).toBe(0);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(close).toHaveBeenCalledOnce();
      expect(end).toHaveBeenCalledOnce();
      expect(hooks.size).toBe(0);
      expect(records().map(({ event }) => event)).toEqual([
        'api_shutdown_started',
        stage === 'readiness' ? 'api_readiness_failed' : 'api_listen_failed'
      ]);
    }
  );

  it.each(['readiness', 'listen'] as const)(
    'does not resolve a stopped $stage startup before cleanup and exit finish',
    async (stage) => {
      const closing = deferred<void>();
      const entered = deferred<void>();
      close.mockImplementationOnce(() => {
        entered.resolve(undefined);
        return closing.promise;
      });
      const operation = stage === 'readiness' ? mocks.readiness : listen;
      operation.mockImplementationOnce(async () => {
        hooks.get('SIGTERM')?.();
        return stage === 'readiness' ? { ready: true } : undefined;
      });
      let resolved = false;
      const running = runPublicApi({}, exit).then(() => {
        resolved = true;
      });
      await entered.promise;
      await settle();
      const prematureResolution = resolved;
      expect(exit).not.toHaveBeenCalled();
      closing.resolve(undefined);
      await running;
      await settle();
      expect(prematureResolution).toBe(false);
      expect(exit).toHaveBeenCalledExactlyOnceWith(0);
      expect(hooks.size).toBe(0);
      expect(close).toHaveBeenCalledOnce();
      expect(end).toHaveBeenCalledOnce();
      if (stage === 'readiness') expect(listen).not.toHaveBeenCalled();
    }
  );

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'closes exactly once despite repeated %s and the other signal',
    async (signal) => {
      await runPublicApi({}, exit);
      hooks.get(signal)?.();
      hooks.get(signal)?.();
      hooks.get(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT')?.();
      await settle();
      expect(close).toHaveBeenCalledOnce();
      expect(end).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledExactlyOnceWith(0);
      expect(records()).toEqual([{ event: 'api_shutdown_started', signal }]);
      expect(hooks.size).toBe(0);
    }
  );

  it('does not listen after a signal arrives during readiness', async () => {
    mocks.readiness.mockImplementationOnce(async () => {
      hooks.get('SIGTERM')?.();
      hooks.get('SIGINT')?.();
      return { ready: true };
    });
    await runPublicApi({}, exit);
    await settle();
    expect(listen).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it.each(['close', 'pool', 'both'])(
    'returns nonzero on %s shutdown failure and still ends pool',
    async (failure) => {
      await runPublicApi({}, exit);
      if (failure !== 'pool') close.mockRejectedValueOnce(hostile);
      if (failure !== 'close') end.mockRejectedValueOnce(error);
      hooks.get('SIGTERM')?.();
      hooks.get('SIGINT')?.();
      await settle();
      expect(close).toHaveBeenCalledOnce();
      expect(end).toHaveBeenCalledOnce();
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(records().map(({ event }) => event)).toContain(
        failure === 'pool' ? 'api_pool_end_failed' : 'api_close_failed'
      );
    }
  );
});
