import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);

describeWithDatabase('administrator OIDC sessions', () => {
  let database: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  let runtimePool: Pool;
  let loginRole: string;
  let principalId: string;

  beforeAll(async () => {
    database = await createIsolatedTestDatabase(databaseUrl!);
    await runMigrations(database.pool, migrationsDirectory, 'vitest');
    loginRole = `qigong_auth_${randomUUID().replaceAll('-', '')}`;
    const password = randomUUID().replaceAll('-', '');
    await database.pool.query(
      `CREATE ROLE ${loginRole} LOGIN PASSWORD '${password}' NOINHERIT NOBYPASSRLS`
    );
    await database.pool.query(`GRANT qigong_api_runtime TO ${loginRole}`);
    const url = new URL(database.databaseUrl);
    url.username = loginRole;
    url.password = password;
    runtimePool = new pg.Pool({ connectionString: url.toString() });
    const principal = await database.pool.query<{ id: string }>(
      `INSERT INTO admin.principals (oidc_issuer, oidc_subject, display_name)
       VALUES ('https://admin.example.com', 'admin-1', 'Reviewer') RETURNING id`
    );
    principalId = principal.rows[0]!.id;
    await database.pool.query(
      `INSERT INTO admin.role_grants (principal_id, role_id, scope_type, reason)
       SELECT $1, id, 'global', 'provisioned' FROM admin.roles WHERE code = 'super_admin'`,
      [principalId]
    );
  });

  afterAll(async () => {
    await runtimePool.end();
    await database.pool.query(`DROP OWNED BY ${loginRole}`);
    await database.pool.query(`DROP ROLE ${loginRole}`);
    await database.dispose();
  });

  const invoke = <T>(sql: string, params: string[]) =>
    withRequestContext(runtimePool, 'qigong_api_runtime', { requestId: randomUUID() }, (client) =>
      client.query<T>(sql, params)
    );

  it('consumes login challenges only once and refuses unprovisioned OIDC identities', async () => {
    const state = randomUUID() + randomUUID();
    await invoke('SELECT admin.start_login($1, $2, $3)', [
      state,
      randomUUID() + randomUUID(),
      randomUUID() + randomUUID()
    ]);
    expect(
      (await invoke<{ verifier: string }>('SELECT * FROM admin.consume_login($1)', [state])).rows
    ).toHaveLength(1);
    expect((await invoke('SELECT * FROM admin.consume_login($1)', [state])).rows).toHaveLength(0);
    const session = randomUUID() + randomUUID();
    expect(
      (
        await invoke<{ allowed: boolean }>('SELECT admin.create_session($1, $2, $3) AS allowed', [
          session,
          'https://admin.example.com',
          'unknown'
        ])
      ).rows[0]?.allowed
    ).toBe(false);
    expect(
      (
        await invoke<{ principal_id: string | null }>(
          'SELECT admin.session_principal($1) AS principal_id',
          [session]
        )
      ).rows[0]?.principal_id
    ).toBeNull();
  });

  it('revokes sessions immediately when principal is disabled or its grant ends', async () => {
    const session = randomUUID() + randomUUID();
    expect(
      (
        await invoke<{ allowed: boolean }>('SELECT admin.create_session($1, $2, $3) AS allowed', [
          session,
          'https://admin.example.com',
          'admin-1'
        ])
      ).rows[0]?.allowed
    ).toBe(true);
    const resolve = async () =>
      (
        await invoke<{ principal_id: string | null }>(
          'SELECT admin.session_principal($1) AS principal_id',
          [session]
        )
      ).rows[0]?.principal_id;
    expect(await resolve()).toBe(principalId);
    await database.pool.query(`UPDATE admin.principals SET status = 'disabled' WHERE id = $1`, [
      principalId
    ]);
    expect(await resolve()).toBeNull();
    await database.pool.query(`UPDATE admin.principals SET status = 'active' WHERE id = $1`, [
      principalId
    ]);
    await database.pool.query(
      `UPDATE admin.role_grants SET valid_to = CURRENT_TIMESTAMP WHERE principal_id = $1`,
      [principalId]
    );
    expect(await resolve()).toBeNull();
    await invoke('SELECT admin.revoke_session($1)', [session]);
    expect(await resolve()).toBeNull();
  });
});
