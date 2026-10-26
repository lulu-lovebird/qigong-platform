import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { createPool } from './pool.js';

// Package-local boundary: the database package must never depend on an app.
const phases = [
  'entry',
  'environment',
  'imports',
  'pool',
  'idle_pool',
  'migrate',
  'result',
  'cleanup',
  'output'
] as const;
type Phase = (typeof phases)[number];
const codes = [
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '22001',
  '22P02',
  '23502',
  '23503',
  '23505',
  '23514',
  '40001',
  '40P01',
  '42501',
  '53300',
  '53400',
  '57P01',
  '57P02',
  '57P03',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_STREAM_PREMATURE_CLOSE'
] as const;
const own = (input: unknown, key: string): unknown => {
  if (typeof input !== 'object' || input === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && 'value' in descriptor ? (descriptor.value as unknown) : undefined;
  } catch {
    return undefined;
  }
};
const diagnostic = (phase: Phase, error: unknown): void => {
  const requested = own(error, 'code');
  const code = codes.find((allowed) => allowed === requested);
  const safePhase = phases.find((allowed) => allowed === phase) ?? 'entry';
  try {
    console.error(
      JSON.stringify({
        event: 'migrations_failed',
        phase: safePhase,
        err: code ? { code } : { category: 'internal' }
      })
    );
  } catch {
    // A broken diagnostic stream must not expose a raw secondary failure.
  }
};

const migrationMetadata = (result: unknown, files: readonly string[]) => {
  // Only bounded, known artifact filenames can appear in success metadata.
  // Never spread result objects, traverse prototypes, or serialize hooks.
  const versions = files.filter((file) => /^\d{4}_[a-z0-9_]{1,150}\.sql$/.test(file)).sort();
  const known = new Set(versions);
  const expectedCurrentVersion = versions.at(-1) ?? null;
  const input = own(result, 'applied');
  const length = own(input, 'length');
  const currentVersion = own(result, 'currentVersion');
  if (
    !Array.isArray(input) ||
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > 10000 ||
    length > known.size ||
    currentVersion !== expectedCurrentVersion
  )
    throw new Error('Invalid migration result');
  const applied: string[] = [];
  for (let index = 0; index < length; index++) {
    const version = own(input, String(index));
    if (typeof version !== 'string' || !known.has(version))
      throw new Error('Invalid migration result');
    applied.push(version);
  }
  if (new Set(applied).size !== applied.length) throw new Error('Invalid migration result');
  return { applied, currentVersion };
};

export const runDatabaseCli = async (source: NodeJS.ProcessEnv = process.env): Promise<void> => {
  let phase: Phase = 'environment';
  let pool: ReturnType<typeof createPool> | undefined;
  let failed = false;
  let metadata: ReturnType<typeof migrationMetadata> | undefined;
  try {
    const { loadEnvironment } = await import('@qigong/config');
    const environment = loadEnvironment(source);
    phase = 'imports';
    const { createPool } = await import('./pool.js');
    const { runMigrations } = await import('./migrations.js');
    const { readdir } = await import('node:fs/promises');
    const directory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../migrations'
    );
    phase = 'pool';
    pool = createPool(environment);
    pool.on('error', (err: unknown) => {
      failed = true;
      process.exitCode = 1;
      diagnostic('idle_pool', err);
    });
    phase = 'migrate';
    const result = await runMigrations(pool, directory, source.DEPLOYED_BY || source.USER);
    phase = 'result';
    metadata = migrationMetadata(result, await readdir(directory));
  } catch (err) {
    failed = true;
    process.exitCode = 1;
    diagnostic(phase, err);
  } finally {
    if (pool) {
      try {
        await pool.end();
      } catch (err) {
        failed = true;
        process.exitCode = 1;
        diagnostic('cleanup', err);
      }
    }
  }
  // Complete means migration AND cleanup succeeded. Never emit a premature
  // success record over a pending/rejected end(), or after an idle pool error.
  if (!failed && metadata) {
    try {
      console.log(
        JSON.stringify({
          event: 'migrations_complete',
          applied: metadata.applied,
          currentVersion: metadata.currentVersion
        })
      );
    } catch (err) {
      diagnostic('output', err);
      process.exitCode = 1;
    }
  }
};

export const main = async (entry: string | undefined = process.argv[1]): Promise<void> => {
  try {
    if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) await runDatabaseCli();
  } catch (err) {
    diagnostic('entry', err);
    process.exitCode = 1;
  }
};
await main();
