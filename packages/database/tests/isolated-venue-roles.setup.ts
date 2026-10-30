import pg from 'pg';
import { afterAll, afterEach, beforeAll } from 'vitest';

const baseUrl = process.env.TEST_DATABASE_URL;
const venueRoles = [
  'qigong_venue_qr_writer',
  'qigong_venue_qr_reader',
  'qigong_venue_history_reader',
  'qigong_venue_manager',
  'qigong_venue_config_guard',
  'qigong_venue_people_reader',
  'qigong_venue_debug',
  'qigong_venue_debug_region_guard',
  'qigong_venue_entry_reader',
  'qigong_venue_entry_identity_reader'
] as const;
const preexistingOids = new Set<number>();

interface VenueRole extends pg.QueryResultRow {
  oid: number;
  safe: boolean;
  referenced: boolean;
}

const isCiDedicatedServiceContract = (url: URL): boolean => {
  const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  const isLoopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
  const isDefaultPort = url.port === '5432' || url.port === '';
  const isServiceUser = url.username === 'qigong';
  const isServiceDb = url.pathname === '/qigong_platform_test';

  return isCi && isLoopback && isDefaultPort && isServiceUser && isServiceDb;
};

const hasExplicitEphemeralOptIn = (): boolean => {
  return (
    process.env.TEST_DATABASE_ALLOW_ROLE_TEARDOWN === 'true' ||
    process.env.TEST_DATABASE_ALLOW_ROLE_TEARDOWN === '1' ||
    process.env.EPHEMERAL_TEST_CLUSTER === 'true' ||
    process.env.EPHEMERAL_TEST_CLUSTER === '1'
  );
};

const isAuthorizedIsolationCluster = (url: URL): boolean => {
  return hasExplicitEphemeralOptIn() || isCiDedicatedServiceContract(url);
};

const withMaintenance = async (
  run: (client: pg.Client, url: URL) => Promise<void>
): Promise<void> => {
  if (!baseUrl) return;
  const url = new URL(baseUrl);
  if (!url.pathname.toLowerCase().includes('test'))
    throw new Error('TEST_DATABASE_URL database name must contain "test"');
  const client = new pg.Client({ connectionString: url.toString() });
  try {
    await client.connect();
    await run(client, url);
  } finally {
    await client.end();
  }
};

beforeAll(async () => {
  await withMaintenance(async (client) => {
    const { rows } = await client.query<{ oid: number }>(
      'SELECT oid FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[])',
      [venueRoles]
    );
    for (const role of rows) preexistingOids.add(role.oid);
  });
});

// 0051–0056 intentionally refuse existing roles. Dropping a fixture database removes its
// objects but not its cluster-wide roles. Run after suite-owned DB teardown, never
// DROP OWNED/CASCADE or reuse/relax the production migration's fail-closed guard.
const removeOrphanedFixtureRoles = async (): Promise<void> => {
  await withMaintenance(async (client, url) => {
    for (const name of venueRoles) {
      const { rows } = await client.query<VenueRole>(
        `SELECT r.oid,
          NOT (r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb
            OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS safe,
          EXISTS (SELECT 1 FROM pg_catalog.pg_shdepend d
            WHERE d.refclassid = 'pg_catalog.pg_authid'::regclass AND d.refobjid = r.oid)
          OR EXISTS (SELECT 1 FROM pg_auth_members m
            WHERE m.roleid = r.oid OR m.member = r.oid) AS referenced
        FROM pg_catalog.pg_roles r WHERE r.rolname = $1`,
        [name]
      );
      const role = rows[0];
      // Preserve preexisting roles and roles belonging to any still-live database.
      if (!role || preexistingOids.has(role.oid) || role.referenced) continue;

      // Never drop roles on an unknown or non-opted-in cluster.
      if (!isAuthorizedIsolationCluster(url)) {
        throw new Error(
          'Refusing to drop fixture roles on non-isolated database: explicit opt-in (TEST_DATABASE_ALLOW_ROLE_TEARDOWN=true) or verified CI service contract required'
        );
      }

      if (!role.safe) throw new Error('Refusing to remove an unsafe venue fixture role');
      // name comes only from the fixed identifier allowlist above.
      await client.query(`DROP ROLE ${name}`);
    }
  });
};

// Setup hooks register first; Vitest's default stack order runs these teardown
// hooks last, after each test/suite has disposed its own isolated databases.
afterEach(removeOrphanedFixtureRoles);
afterAll(removeOrphanedFixtureRoles);
