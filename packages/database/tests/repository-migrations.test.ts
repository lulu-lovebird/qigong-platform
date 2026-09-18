import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/index.js';
import { getMigrationStatus, runMigrations } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);

describeWithDatabase('repository migrations', () => {
  let pool: Pool;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase(databaseUrl!);
    pool = database.pool;
    dispose = () => database.dispose();
  });

  afterAll(async () => {
    await dispose();
  });

  it('applies the checked-in chain idempotently and satisfies readiness', async () => {
    const first = await runMigrations(pool, migrationsDirectory, 'vitest');
    const second = await runMigrations(pool, migrationsDirectory, 'vitest');
    const status = await getMigrationStatus(
      pool,
      '0001_platform_baseline.sql',
      '0002_identity_region_rbac.sql'
    );

    expect(first.applied).toEqual(['0001_platform_baseline.sql', '0002_identity_region_rbac.sql']);
    expect(second.applied).toEqual([]);
    expect(status).toEqual({
      currentVersion: '0002_identity_region_rbac.sql',
      minimumVersion: '0001_platform_baseline.sql',
      maximumVersion: '0002_identity_region_rbac.sql',
      ready: true
    });
  });
});
