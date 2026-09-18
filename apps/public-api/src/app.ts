import Fastify, { type FastifyBaseLogger } from 'fastify';
import { checkApiRuntimePreflight, getMigrationStatus, type Pool } from '@qigong/database';

export const minimumMigrationVersion = '0003_runtime_roles_and_rls.sql';
export const maximumMigrationVersion = '0003_runtime_roles_and_rls.sql';
const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AppDependencies {
  pool: Pool;
  logger?: FastifyBaseLogger | false;
  serviceVersion?: string;
}

export const checkStartupReadiness = async (pool: Pool) => {
  const migration = await getMigrationStatus(
    pool,
    minimumMigrationVersion,
    maximumMigrationVersion
  );
  if (!migration.ready)
    return { ready: false as const, reason: 'schema_version_mismatch', migration };
  const runtime = await checkApiRuntimePreflight(pool);
  if (!runtime.ready)
    return { ready: false as const, reason: 'runtime_role_misconfigured', runtime };
  return { ready: true as const, migration, runtime };
};

export const buildApp = ({ pool, logger, serviceVersion = 'development' }: AppDependencies) => {
  const app = Fastify({
    logger:
      logger === false
        ? false
        : (logger ?? {
            level: process.env.LOG_LEVEL || 'info',
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers.x-line-access-token',
                'req.headers.x-telegram-init-data',
                'res.headers.set-cookie'
              ],
              censor: '[REDACTED]'
            }
          }),
    genReqId: (request) => {
      const incoming = request.headers['x-request-id'];
      return typeof incoming === 'string' && requestIdPattern.test(incoming)
        ? incoming
        : crypto.randomUUID();
    }
  });

  app.addHook('onSend', (request, reply, payload, done) => {
    void reply.header('x-request-id', request.id);
    done(null, payload);
  });

  app.get('/health/live', () => ({
    ok: true,
    service: 'qigong-public-api',
    version: serviceVersion
  }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      const readiness = await checkStartupReadiness(pool);
      if (!readiness.ready) return reply.code(503).send({ ok: false, ...readiness });
      return { ok: true, ...readiness };
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed');
      return reply.code(503).send({ ok: false, reason: 'database_unavailable' });
    }
  });

  return app;
};
