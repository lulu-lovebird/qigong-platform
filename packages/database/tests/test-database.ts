import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadEnvironment } from '@qigong/config';
import { createPool } from '../src/index.js';

const { Client } = pg;

export const createIsolatedTestDatabase = async (baseUrl: string) => {
  const source = new URL(baseUrl);
  if (!source.pathname.toLowerCase().includes('test')) {
    throw new Error('TEST_DATABASE_URL database name must contain "test"');
  }

  const databaseName = `qigong_platform_test_${randomUUID().replaceAll('-', '')}`;
  const maintenanceUrl = new URL(source);
  maintenanceUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: maintenanceUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${databaseName}`);

  const testUrl = new URL(source);
  testUrl.pathname = `/${databaseName}`;
  const pool = createPool(loadEnvironment({ NODE_ENV: 'test', DATABASE_URL: testUrl.toString() }));

  return {
    pool,
    async dispose() {
      await pool.end();
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName]
      );
      await admin.query(`DROP DATABASE ${databaseName}`);
      await admin.end();
    }
  };
};
