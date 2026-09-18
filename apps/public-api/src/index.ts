import { loadEnvironment } from '@qigong/config';
import { attachPoolErrorHandler, createPool } from '@qigong/database';
import { buildApp } from './app.js';

const environment = loadEnvironment();
const pool = createPool(environment);
const app = buildApp({
  pool,
  serviceVersion: process.env.SERVICE_VERSION || 'development'
});

attachPoolErrorHandler(pool, (error) => {
  app.log.error({ err: error }, 'idle PostgreSQL client error');
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal)
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        app.log.error({ err: error }, 'graceful shutdown failed');
        process.exit(1);
      });
  });
}

try {
  await app.listen({ host: environment.HOST, port: environment.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'failed to start public API');
  await pool.end();
  process.exit(1);
}
