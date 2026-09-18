import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '@qigong/config';
import { createPool } from './pool.js';
import { runMigrations } from './migrations.js';

const environment = loadEnvironment();
const pool = createPool(environment);
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');

try {
  const result = await runMigrations(pool, directory, process.env.DEPLOYED_BY || process.env.USER);
  console.log(JSON.stringify({ event: 'migrations_complete', ...result }));
} finally {
  await pool.end();
}
