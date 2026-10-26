import type * as FileSystem from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  environment: vi.fn(),
  pool: vi.fn(),
  migrate: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
  readdir: vi.fn(),
  realpath: vi.fn((entry: string) => entry)
}));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof FileSystem>()),
  realpathSync: mocks.realpath
}));
vi.mock('node:fs/promises', () => ({ readdir: mocks.readdir }));
vi.mock('@qigong/config', () => ({ loadEnvironment: mocks.environment }));
vi.mock('../src/pool.js', () => ({ createPool: mocks.pool }));
vi.mock('../src/migrations.js', () => ({ runMigrations: mocks.migrate }));
import { main, runDatabaseCli } from '../src/cli.js';
const importCalls = {
  environment: mocks.environment.mock.calls.length,
  pool: mocks.pool.mock.calls.length,
  migrate: mocks.migrate.mock.calls.length,
  readdir: mocks.readdir.mock.calls.length
};
const sentinel = 'synthetic-private-migration@sentinel.invalid';
const failure = Object.assign(new Error(sentinel, { cause: new Error(sentinel) }), {
  code: '23505',
  detail: sentinel,
  query: sentinel,
  parameters: [sentinel],
  token: sentinel
});
const hostile = new Proxy(
  {},
  {
    getOwnPropertyDescriptor() {
      throw failure;
    },
    get() {
      throw failure;
    }
  }
);
const environment = { DATABASE_URL: 'postgresql://synthetic.invalid/test', DATABASE_POOL_MAX: 2 };
const activePool = { on: mocks.on, end: mocks.end };
const versions = ['0001_synthetic.sql', '0002_synthetic.sql'];
const captureLog = () => vi.spyOn(console, 'log').mockImplementation(() => {});
const captureError = () => vi.spyOn(console, 'error').mockImplementation(() => {});
const captureOut = () => vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
const captureErr = () => vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
let log: ReturnType<typeof captureLog>, error: ReturnType<typeof captureError>;
let stdout: ReturnType<typeof captureOut>,
  stderr: ReturnType<typeof captureErr>,
  exitCode: typeof process.exitCode;
const errors = () =>
  error.mock.calls.map(
    ([text]) =>
      JSON.parse(String(text)) as {
        event: string;
        phase: string;
        err: { category?: string; code?: string };
      }
  );
const deferred = <Value>() => {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.clearAllMocks();
  exitCode = process.exitCode;
  process.exitCode = undefined;
  log = captureLog();
  error = captureError();
  stdout = captureOut();
  stderr = captureErr();
  mocks.environment.mockReturnValue(environment);
  mocks.pool.mockReturnValue(activePool);
  mocks.on.mockReturnValue(activePool);
  mocks.end.mockResolvedValue(undefined);
  mocks.realpath.mockImplementation((entry: string) => entry);
  mocks.migrate.mockResolvedValue({ applied: versions, currentVersion: versions[1] });
  mocks.readdir.mockResolvedValue(versions);
});
afterEach(() => {
  expect(
    JSON.stringify([log.mock.calls, error.mock.calls, stdout.mock.calls, stderr.mock.calls])
  ).not.toContain(sentinel);
  process.exitCode = exitCode;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('import-safe database CLI with exclusively mocked migrations and pools', () => {
  it('does not read configuration, directories, connect, or migrate at import', () => {
    expect(importCalls).toEqual({ environment: 0, pool: 0, migrate: 0, readdir: 0 });
  });
  it.each([
    [{ DEPLOYED_BY: 'synthetic-deployer', USER: 'synthetic-user' }, 'synthetic-deployer'],
    [{ DEPLOYED_BY: '', USER: 'synthetic-user' }, 'synthetic-user'],
    [{ USER: 'synthetic-user' }, 'synthetic-user'],
    [{}, undefined]
  ] as const)(
    'preserves deployer precedence and migration directory/arguments %#',
    async (source, deployedBy) => {
      await runDatabaseCli(source);
      expect(mocks.environment).toHaveBeenCalledExactlyOnceWith(source);
      expect(mocks.pool).toHaveBeenCalledExactlyOnceWith(environment);
      const directory = path.resolve(
        path.dirname(fileURLToPath(new URL('../src/cli.ts', import.meta.url))),
        '../../../migrations'
      );
      expect(mocks.migrate).toHaveBeenCalledExactlyOnceWith(activePool, directory, deployedBy);
      expect(mocks.readdir).toHaveBeenCalledExactlyOnceWith(directory);
      expect(mocks.end).toHaveBeenCalledOnce();
      expect(process.exitCode).toBeUndefined();
      expect(log).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({
          event: 'migrations_complete',
          applied: versions,
          currentVersion: versions[1]
        })
      );
    }
  );
  it('logs completion only after cleanup has finished, reconstructing only known metadata', async () => {
    const started = deferred<void>(),
      pending = deferred<void>();
    mocks.end.mockImplementationOnce(() => {
      started.resolve(undefined);
      return pending.promise;
    });
    const hook = vi.fn(() => {
      throw failure;
    });
    mocks.migrate.mockResolvedValueOnce(
      Object.defineProperty(
        {
          applied: [versions[1]],
          currentVersion: versions[1],
          deployedBy: sentinel,
          sql: sentinel,
          credentials: sentinel,
          cause: hostile
        },
        'toJSON',
        { get: hook }
      )
    );
    const running = runDatabaseCli({});
    await started.promise;
    expect(log).not.toHaveBeenCalled();
    pending.resolve(undefined);
    await running;
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        event: 'migrations_complete',
        applied: [versions[1]],
        currentVersion: versions[1]
      })
    );
    expect(hook).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it('allows the empty-artifact null-version success contract', async () => {
    mocks.readdir.mockResolvedValueOnce([]);
    mocks.migrate.mockResolvedValueOnce({ applied: [], currentVersion: null });
    await runDatabaseCli({});
    expect(log).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ event: 'migrations_complete', applied: [], currentVersion: null })
    );
  });
  it.each(['environment', 'pool', 'migrate', 'readdir'] as const)(
    'contains %s throws without a raw fallback',
    async (stage) => {
      mocks[stage].mockImplementationOnce(() => {
        throw failure;
      });
      await runDatabaseCli({});
      const phase = {
        environment: 'environment',
        pool: 'pool',
        migrate: 'migrate',
        readdir: 'result'
      }[stage];
      expect(errors()).toEqual([{ event: 'migrations_failed', phase, err: { code: '23505' } }]);
      expect(log).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(mocks.end).toHaveBeenCalledTimes(stage === 'migrate' || stage === 'readdir' ? 1 : 0);
    }
  );
  it('contains dynamic module initialization failure without invoking migrations or creating a pool', async () => {
    vi.doMock('../src/migrations.js', () => {
      throw failure;
    });
    try {
      await runDatabaseCli({});
      expect(process.exitCode).toBe(1);
      expect(errors()).toEqual([
        { event: 'migrations_failed', phase: 'imports', err: { category: 'internal' } }
      ]);
      expect(mocks.pool).not.toHaveBeenCalled();
      expect(mocks.migrate).not.toHaveBeenCalled();
    } finally {
      vi.doMock('../src/migrations.js', () => ({ runMigrations: mocks.migrate }));
    }
  });
  it.each([
    undefined,
    sentinel,
    hostile,
    new AggregateError([failure], sentinel),
    { cause: failure },
    Object.create({ code: '23505' }) as unknown,
    { code: 'P0001', message: sentinel },
    Object.defineProperty({}, 'code', {
      get() {
        throw failure;
      }
    })
  ])(
    'contains unknown migration rejection %# and an independent cleanup rejection',
    async (value) => {
      mocks.migrate.mockRejectedValueOnce(value);
      mocks.end.mockRejectedValueOnce(failure);
      await runDatabaseCli({});
      expect(errors()).toEqual([
        { event: 'migrations_failed', phase: 'migrate', err: { category: 'internal' } },
        { event: 'migrations_failed', phase: 'cleanup', err: { code: '23505' } }
      ]);
      expect(log).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(mocks.end).toHaveBeenCalledOnce();
    }
  );
  it('contains cleanup-only failure and never claims completed cleanup', async () => {
    mocks.end.mockRejectedValueOnce(hostile);
    await runDatabaseCli({});
    expect(log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errors()).toEqual([
      { event: 'migrations_failed', phase: 'cleanup', err: { category: 'internal' } }
    ]);
  });
  it('registers an idle pool handler immediately and does not print success after a pool failure', async () => {
    mocks.migrate.mockImplementationOnce(async () => {
      const handler = mocks.on.mock.calls[0]?.[1] as (error: unknown) => void;
      handler(failure);
      handler(hostile);
      return { applied: [], currentVersion: versions[1] };
    });
    await runDatabaseCli({});
    expect(mocks.on.mock.calls[0]?.[0]).toBe('error');
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(errors()).toEqual([
      { event: 'migrations_failed', phase: 'idle_pool', err: { code: '23505' } },
      { event: 'migrations_failed', phase: 'idle_pool', err: { category: 'internal' } }
    ]);
    expect(log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
  it('cleans a pool whose handler installation throws before migration', async () => {
    mocks.on.mockImplementationOnce(() => {
      throw failure;
    });
    await runDatabaseCli({});
    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(errors()[0]?.phase).toBe('pool');
    expect(process.exitCode).toBe(1);
  });
  it.each([
    { applied: [sentinel], currentVersion: versions[1] },
    { applied: versions, currentVersion: '0003_unrecognized.sql' },
    { applied: [versions[0], versions[0]], currentVersion: versions[1] },
    { applied: new Array<string>(10001), currentVersion: versions[1] },
    { applied: [], currentVersion: undefined },
    { applied: [], currentVersion: null },
    { applied: [], currentVersion: versions[0] },
    Object.create({ applied: versions, currentVersion: versions[1] }) as unknown,
    Object.defineProperty({ currentVersion: versions[1] }, 'applied', {
      get() {
        throw failure;
      }
    }),
    {
      applied: Object.defineProperty([versions[0]], '0', {
        get() {
          throw failure;
        }
      }),
      currentVersion: versions[1]
    },
    {
      applied: new Proxy([], {
        getOwnPropertyDescriptor() {
          throw failure;
        }
      }),
      currentVersion: versions[1]
    },
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw failure;
        }
      }
    )
  ])(
    'rejects malformed or unknown result metadata without invoking runtime hooks %#',
    async (value) => {
      mocks.migrate.mockResolvedValueOnce(value);
      await runDatabaseCli({});
      expect(errors()).toEqual([
        { event: 'migrations_failed', phase: 'result', err: { category: 'internal' } }
      ]);
      expect(log).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(mocks.end).toHaveBeenCalledOnce();
    }
  );
  it('contains success sink failure only after cleanup, without a raw error fallback', async () => {
    log.mockImplementationOnce(() => {
      throw failure;
    });
    await runDatabaseCli({});
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
    expect(errors()).toEqual([
      { event: 'migrations_failed', phase: 'output', err: { code: '23505' } }
    ]);
  });
  it('retains a known network code without inspecting nested causes or error text', async () => {
    mocks.migrate.mockRejectedValueOnce({ code: 'ECONNRESET', message: sentinel, cause: failure });
    await runDatabaseCli({});
    expect(errors()).toEqual([
      { event: 'migrations_failed', phase: 'migrate', err: { code: 'ECONNRESET' } }
    ]);
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });
  it('contains invalid entry paths without loading configuration', async () => {
    mocks.realpath.mockImplementationOnce(() => {
      throw failure;
    });
    await main('/synthetic.invalid/entry');
    expect(errors()).toEqual([
      { event: 'migrations_failed', phase: 'entry', err: { code: '23505' } }
    ]);
    expect(mocks.environment).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
  it('runs direct entry with only mocked migrations and preserves explicit synthetic environment bindings', async () => {
    const env = { DEPLOYED_BY: 'synthetic-deployer', USER: 'synthetic-user' };
    vi.stubGlobal('process', { env });
    await main(fileURLToPath(new URL('../src/cli.ts', import.meta.url)));
    expect(mocks.environment).toHaveBeenCalledExactlyOnceWith(env);
    expect(mocks.migrate.mock.calls[0]?.[2]).toBe('synthetic-deployer');
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(process.exitCode).toBeUndefined();
    vi.unstubAllGlobals();
  });
  it('contains direct-entry configuration failure and failed diagnostic streams', async () => {
    mocks.environment.mockImplementationOnce(() => {
      throw failure;
    });
    error.mockImplementationOnce(() => {
      throw new Error(sentinel);
    });
    vi.stubGlobal('process', { env: {} });
    await main(fileURLToPath(new URL('../src/cli.ts', import.meta.url)));
    expect(mocks.pool).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    vi.unstubAllGlobals();
  });
});
