// Isolated phone-test adapter, not a production entrypoint.
// Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../packages/config/src/index.js';
import { createPool, runMigrations } from '../packages/database/src/index.js';
import { buildApp, checkStartupReadiness } from '../apps/public-api/src/app.js';
import type { LineConfig } from '../apps/public-api/src/line-onboarding.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicOrigin = 'https://mingyenmac-mini.tailbf9b8d.ts.net';
const root = process.argv[3];
const validateCluster = async (directory: string | undefined): Promise<string> => {
  if (!directory || !/^\/tmp\/venue-phone-pg\.[A-Za-z0-9]+$/.test(directory))
    throw new Error('unrecognized private directory');
  const info = await stat(directory);
  const actual = await realpath(directory);
  const pid = (await readFile(directory + '/data/postmaster.pid', 'utf8')).split('\n');
  if (
    info.uid !== process.getuid?.() ||
    (info.mode & 0o077) !== 0 ||
    (actual !== directory && actual !== '/private' + directory) ||
    (await readFile(directory + '/venue-phone-marker', 'utf8')).trim() !== directory ||
    ![directory + '/data', actual + '/data'].includes(pid[1] ?? '') ||
    pid[3] !== '55480' ||
    ![directory + '/socket', actual + '/socket'].includes(pid[4] ?? '')
  )
    throw new Error('unsafe private cluster');
  return directory;
};
const poolFor = (directory: string, user: 'venue_phone_owner' | 'venue_phone_login') => {
  const url = new URL(`postgresql://${user}@localhost/postgres`);
  url.searchParams.set('host', directory + '/socket');
  url.searchParams.set('port', '55480');
  // Never consumes the inherited DATABASE_URL or other service settings.
  return createPool(
    loadEnvironment({
      DATABASE_URL: url.toString(),
      HOST: '127.0.0.1',
      PORT: '3100',
      LOG_LEVEL: 'silent',
      DATABASE_POOL_MAX: '5'
    })
  );
};
const seed = async (directory: string) => {
  const pool = poolFor(directory, 'venue_phone_owner');
  try {
    const existing = await pool.query(
      "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p')"
    );
    if (existing.rowCount !== 0) throw new Error('cluster must be pristine');
    const result = await runMigrations(
      pool,
      resolve(repository, 'migrations'),
      'isolated-phone-test'
    );
    if (result.currentVersion !== '0050_venue_qr_attendance.sql')
      throw new Error('unexpected schema version');
    await pool.query(`
      BEGIN;
      CREATE ROLE venue_phone_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
      GRANT qigong_api_runtime TO venue_phone_login;
      INSERT INTO core.regions(code,region_type,name_zh_tw,name_en)
        VALUES ('venue-phone-global','global','合成全球','Synthetic phone global');
      INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en)
        SELECT id,'venue-phone-tw','country','合成台灣','Synthetic phone Taiwan'
        FROM core.regions WHERE code='venue-phone-global';
      INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en,default_timezone)
        SELECT id,'tw-general','operational','合成手機測試地區','Synthetic phone region','Asia/Taipei'
        FROM core.regions WHERE code='venue-phone-tw';
      INSERT INTO core.practice_fields(region_id,code,name_zh_tw,latitude,longitude,radius_meters,timezone,active_time_rules)
        SELECT id,'tw-location-test','目前位置測試場',24.992936,121.502550,100,'Asia/Taipei',
        '{"day_of_week":[0,1,2,3,4,5,6],"start_time":"00:00","end_time":"24:00"}'::jsonb
        FROM core.regions WHERE code='tw-general';
      UPDATE platform.learner_privacy_policies SET state='active',published_at=clock_timestamp()
        WHERE version='baiyin-checkin-supplement-v1';
      COMMIT;
    `);
    // No learners, identities, principals, sessions, invitations or acceptances are seeded.
  } finally {
    await pool.end();
  }
};
const serve = async (directory: string) => {
  if (process.env.NFC_FIELD_CHECKIN_ENABLED !== 'false') throw new Error('NFC must remain off');
  const line: LineConfig = {
    channelSecret: process.env.LINE_CHANNEL_SECRET ?? '',
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? '',
    loginChannelId: process.env.LINE_LOGIN_CHANNEL_ID ?? '',
    liffId: process.env.LINE_LIFF_ID ?? '',
    reply: async () => {
      throw new Error('LINE replies disabled in isolated phone runtime');
    }
  };
  if (
    line.channelSecret.length < 16 ||
    line.channelAccessToken.length < 20 ||
    !/^\d+$/.test(line.loginChannelId) ||
    line.liffId !== '2011968988-KX3MjakL'
  )
    throw new Error('LINE configuration unavailable');
  const pool = poolFor(directory, 'venue_phone_login');
  // No adminAuth => no admin routes, no OIDC discovery, no default admin key.
  // No mock verifiers: the existing verifier runs only for actual user requests.
  const app = buildApp({
    pool,
    logger: false,
    line,
    venueQr: { enabled: true, publicOrigin },
    serviceVersion: 'isolated-venue-phone'
  });
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.split('?')[0] === '/line/webhook')
      return reply.code(404).send({ error: 'not_found' });
  });
  pool.on('error', () => {
    /* No credential, SQL parameter or location diagnostics. */
  });
  const shutdown = async () => {
    await app.close();
    await pool.end();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown().then(
        () => process.exit(0),
        () => process.exit(1)
      );
    });
  }
  try {
    const readiness = await checkStartupReadiness(pool, true);
    if (!readiness.ready) throw new Error('isolated readiness failed');
    await app.listen({ host: '127.0.0.1', port: 3100 });
  } catch {
    await shutdown();
    throw new Error('isolated API startup failed');
  }
};
try {
  const directory = await validateCluster(root);
  if (process.argv[2] === 'seed') await seed(directory);
  else if (process.argv[2] === 'serve') await serve(directory);
  else throw new Error('unsupported mode');
} catch {
  // Deliberately omit exception objects: they may contain driver parameters or tokens.
  process.stderr.write('Isolated phone runtime failed; diagnostics suppressed\n');
  process.exitCode = 1;
}
