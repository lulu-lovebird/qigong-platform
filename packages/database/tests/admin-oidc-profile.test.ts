import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Authenticated administrator metadata refresh without authorization changes', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    login: string,
    principal: string;
  const issuer = 'https://admins.example.invalid',
    subject = 'metadata-subject';
  const refresh = (name: string | null, email: string | null, iss = issuer, sub = subject) =>
    withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
      c.query<{ ok: boolean }>('SELECT admin.refresh_verified_profile($1,$2,$3,$4) ok', [
        iss,
        sub,
        name,
        email
      ])
    );
  const row = async () =>
    (await db.pool.query('SELECT * FROM admin.principals WHERE id=$1', [principal])).rows[0];
  beforeEach(async () => {
    db = await createIsolatedTestDatabase(databaseUrl!);
    await runMigrations(db.pool, directory, 'vitest-profile');
    login = 'qigong_profile_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime,qigong_worker_runtime TO ${login}`);
    const url = new URL(db.databaseUrl);
    url.username = login;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    await withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
      c.query('SELECT admin.begin_access_login($1,$2,$3,$4,$5)', [
        randomBytes(32).toString('base64url'),
        issuer,
        subject,
        'Original name',
        null
      ])
    );
    principal = (
      await db.pool.query<{ id: string }>(
        'SELECT id FROM admin.principals WHERE oidc_issuer=$1 AND oidc_subject=$2',
        [issuer, subject]
      )
    ).rows[0]!.id;
  });
  afterEach(async () => {
    await runtime.end();
    await db.pool.query(`DROP OWNED BY ${login}`);
    await db.pool.query(`DROP ROLE ${login}`);
    await db.dispose();
  });
  it('fills a pending email without creating roles, approving access or exposing profile data in audit', async () => {
    const before = await row();
    expect((await refresh('Updated name', 'verified@example.invalid')).rows[0]!.ok).toBe(true);
    const after = await row();
    expect(after.email).toBe('verified@example.invalid');
    expect(after.display_name).toBe('Updated name');
    expect(after.id).toBe(before.id);
    expect(after.status).toBe(before.status);
    expect(after.access_grant_version).toBe(before.access_grant_version);
    expect(
      (await db.pool.query('SELECT * FROM admin.role_grants WHERE principal_id=$1', [principal]))
        .rows
    ).toEqual([]);
    expect(
      (
        await db.pool.query(
          'SELECT status,version FROM admin.access_applications WHERE principal_id=$1',
          [principal]
        )
      ).rows
    ).toEqual([{ status: 'draft', version: 1 }]);
    const events = (
      await db.pool.query(
        "SELECT metadata,before_data,after_data FROM audit.events WHERE action='admin.profile_refreshed' AND target_id=$1",
        [principal]
      )
    ).rows;
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('verified@example.invalid');
    expect(JSON.stringify(events)).not.toContain('Updated name');
  });
  it('refreshes an existing approved principal without changing grants or revoking sessions', async () => {
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,reason) SELECT $1,id,'global','fixture' FROM admin.roles WHERE code='global_viewer'",
      [principal]
    );
    const token = randomBytes(32).toString('base64url');
    await withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
      c.query('SELECT admin.create_session($1,$2,$3)', [token, issuer, subject])
    );
    const before = await row(),
      grants = (
        await db.pool.query('SELECT * FROM admin.role_grants WHERE principal_id=$1', [principal])
      ).rows,
      sessions = (
        await db.pool.query('SELECT * FROM admin.sessions WHERE principal_id=$1', [principal])
      ).rows;
    expect((await refresh(null, 'verified@example.invalid')).rows[0]!.ok).toBe(true);
    expect((await row()).access_grant_version).toBe(before.access_grant_version);
    expect((await row()).display_name).toBe(before.display_name);
    expect(
      (await db.pool.query('SELECT * FROM admin.role_grants WHERE principal_id=$1', [principal]))
        .rows
    ).toEqual(grants);
    expect(
      (await db.pool.query('SELECT * FROM admin.sessions WHERE principal_id=$1', [principal])).rows
    ).toEqual(sessions);
  });
  it('preserves known metadata when a later login has no verified email, and emits no redundant audit', async () => {
    await refresh('Known name', 'known@example.invalid');
    await refresh(null, null);
    await refresh('Known name', 'known@example.invalid');
    expect((await row()).email).toBe('known@example.invalid');
    expect((await row()).display_name).toBe('Known name');
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM audit.events WHERE action='admin.profile_refreshed' AND target_id=$1",
          [principal]
        )
      ).rows[0].n
    ).toBe(1);
  });
  it('rejects malformed metadata atomically', async () => {
    const before = await row();
    await expect(refresh('   ', 'bad-email')).rejects.toThrow(
      'invalid verified administrator profile'
    );
    expect(await row()).toEqual(before);
  });
  it('does not match by email or update an issuer/subject that does not exist', async () => {
    await db.pool.query(
      "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name,email) VALUES('https://other.example.invalid','other','Other','same@example.invalid')"
    );
    expect(
      (await refresh('Changed', 'same@example.invalid', issuer, 'unknown-subject')).rows[0]!.ok
    ).toBe(false);
    expect(
      (await refresh('Changed', 'same@example.invalid', 'https://wrong.example.invalid', subject))
        .rows[0]!.ok
    ).toBe(false);
    expect((await row()).display_name).toBe('Original name');
    expect((await db.pool.query('SELECT count(*)::int n FROM admin.principals')).rows[0].n).toBe(2);
  });
  it('does not reactivate a suspended principal', async () => {
    await db.pool.query("UPDATE admin.principals SET status='suspended' WHERE id=$1", [principal]);
    const before = await row();
    expect((await refresh('New', 'verified@example.invalid')).rows[0]!.ok).toBe(false);
    expect(await row()).toEqual(before);
  });
  it('keeps direct updates and worker execution denied and rejects the old worker schema contract', async () => {
    await expect(
      withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
        c.query('UPDATE admin.principals SET email=$1 WHERE id=$2', [
          'direct@example.invalid',
          principal
        ])
      )
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      (
        await db.pool.query<{ n: number }>(
          "SELECT count(*)::int n FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='admin.refresh_verified_profile(text,text,text,text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'"
        )
      ).rows[0]!.n
    ).toBe(0);
    await expect(
      withRequestContext(runtime, 'qigong_worker_runtime', { requestId: randomUUID() }, (c) =>
        c.query('SELECT admin.refresh_verified_profile($1,$2,$3,$4)', [
          issuer,
          subject,
          null,
          'worker@example.invalid'
        ])
      )
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      (
        await withRequestContext(
          runtime,
          'qigong_worker_runtime',
          { requestId: randomUUID() },
          (c) =>
            c.query(
              'SELECT ops.admin_achievements_schema_ready() current,ops.line_profile_schema_ready() previous'
            )
        )
      ).rows[0]
    ).toEqual({ current: true, previous: false });
  });
});
