import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/index.js';
import { runMigrations } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const baseMigrationSql = 'CREATE TABLE migration_test (id INTEGER PRIMARY KEY);\n';

describeWithDatabase('runMigrations', () => {
  let pool: Pool;
  let dispose: () => Promise<void>;
  let directory: string;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase(databaseUrl!);
    pool = database.pool;
    dispose = () => database.dispose();
    directory = await mkdtemp(path.join(os.tmpdir(), 'qigong-migrations-'));
    await writeFile(path.join(directory, '0001_create_test_table.sql'), baseMigrationSql);
  });

  afterAll(async () => {
    await dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it('applies each migration once and verifies checksums', async () => {
    const first = await runMigrations(pool, directory, 'vitest');
    const second = await runMigrations(pool, directory, 'vitest');
    expect(first.applied).toEqual(['0001_create_test_table.sql']);
    expect(second.applied).toEqual([]);

    await writeFile(
      path.join(directory, '0001_create_test_table.sql'),
      'CREATE TABLE migration_test (id BIGINT PRIMARY KEY);\n'
    );
    await expect(runMigrations(pool, directory, 'vitest')).rejects.toThrow(
      'Migration checksum mismatch'
    );
  });

  it('rolls back failed migration SQL and releases the lock', async () => {
    const failingDirectory = await mkdtemp(path.join(os.tmpdir(), 'qigong-failing-migration-'));
    await writeFile(path.join(failingDirectory, '0001_create_test_table.sql'), baseMigrationSql);
    await writeFile(
      path.join(failingDirectory, '0002_fail.sql'),
      'CREATE TABLE migration_partial (id INTEGER PRIMARY KEY); SELECT 1 / 0;\n'
    );

    await expect(runMigrations(pool, failingDirectory, 'vitest')).rejects.toThrow();
    const table = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'migration_partial'`
    );
    const ledger = await pool.query<{ version: string }>(
      `SELECT version FROM schema_migrations WHERE version = '0002_fail.sql'`
    );
    expect(table.rows).toEqual([]);
    expect(ledger.rows).toEqual([]);

    await writeFile(path.join(failingDirectory, '0002_fail.sql'), 'SELECT 1;\n');
    await expect(runMigrations(pool, failingDirectory, 'vitest')).resolves.toMatchObject({
      applied: ['0002_fail.sql']
    });
    await rm(failingDirectory, { recursive: true, force: true });
  });

  it('rejects artifacts that omit an applied migration', async () => {
    const incompleteDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'qigong-incomplete-migrations-')
    );
    await expect(runMigrations(pool, incompleteDirectory, 'vitest')).rejects.toThrow(
      'Applied migrations missing from artifact'
    );
    await rm(incompleteDirectory, { recursive: true, force: true });
  });
});
