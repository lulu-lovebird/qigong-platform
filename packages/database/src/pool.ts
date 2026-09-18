import pg from 'pg';
import type { Environment } from '@qigong/config';

const { Pool } = pg;

export const createPool = (environment: Environment) =>
  new Pool({
    connectionString: environment.DATABASE_URL,
    max: environment.DATABASE_POOL_MAX,
    connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS,
    statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    application_name: 'qigong-platform'
  });

export const attachPoolErrorHandler = (
  pool: InstanceType<typeof Pool>,
  handler: (error: Error) => void
) => {
  pool.on('error', handler);
};
