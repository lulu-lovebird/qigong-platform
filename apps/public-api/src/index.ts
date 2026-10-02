import { loadEnvironment } from '@qigong/config';
import { attachPoolErrorHandler, createPool } from '@qigong/database';
import { buildApp, checkStartupReadiness } from './app.js';
import { createAdminOidcProvider } from './oidc-provider.js';

const environment = loadEnvironment();
const pool = createPool(environment);
let adminAuth: Awaited<ReturnType<typeof createAdminOidcProvider>>;
try {
  adminAuth = await createAdminOidcProvider();
} catch (error) {
  console.error('failed to initialize administrator OIDC provider', error);
  await pool.end();
  process.exit(1);
}
const app = buildApp({
  pool,
  adminAuth,
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
  const readiness = await checkStartupReadiness(pool);
  if (!readiness.ready) throw new Error(`startup readiness failed: ${readiness.reason}`);
  await app.listen({ host: environment.HOST, port: environment.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'failed to start public API');
  await pool.end();
  process.exit(1);
}
