import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const migrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);
interface Status extends pg.QueryResultRow {
  data: { principalId: string; version: number; status: string; requestedRole: string | null };
}
suite('versioned administrator grant management', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  let runtime: Pool;
  let login: string;
  let actor: string;
  let region: string;
  let cohort: string;
  let pending: string;
  const query = <T extends pg.QueryResultRow>(
    sql: string,
    values: unknown[] = [],
    principalId?: string
  ) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), ...(principalId ? { principalId } : {}) },
      (c) => c.query<T>(sql, values)
    );
  const status = async () =>
    (await query<Status>('SELECT admin.access_status($1) data', [pending])).rows[0]!.data;
  const request = async (role = 'regional_admin') => {
    const s = await status();
    return (
      await query<Status>('SELECT admin.submit_access_application($1,$2,$3,$4,$5) data', [
        pending,
        s.version,
        role,
        'Requested scope',
        'Applicant reason'
      ])
    ).rows[0]!.data;
  };
  const decide = (
    target: string,
    version: number,
    decision = 'approved',
    role: string | null = 'regional_admin',
    r: string | null = region,
    c: string | null = null
  ) =>
    query<{ grant_id: string }>(
      'SELECT admin.decide_access_application($1,$2,$3,$4,$5,$6,$7) grant_id',
      [target, version, decision, role, r, c, 'Reviewed identity and scope'],
      actor
    );
  beforeEach(async () => {
    db = await createIsolatedTestDatabase(url!);
    await runMigrations(db.pool, migrations, 'vitest');
    login = 'qigong_access_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime TO ${login}`);
    const connection = new URL(db.databaseUrl);
    connection.username = login;
    connection.password = password;
    runtime = new pg.Pool({ connectionString: connection.href });
    actor = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://access.example','root','Root') RETURNING id"
      )
    ).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,reason) SELECT $1,id,'global','bootstrap fixture' FROM admin.roles WHERE code='super_admin'",
      [actor]
    );
    const global = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('access-global','global','全球','Global') RETURNING id"
      )
    ).rows[0]!.id;
    const country = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'access-country','country','國家','Country') RETURNING id",
        [global]
      )
    ).rows[0]!.id;
    region = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'access-region','operational','區域','Region') RETURNING id",
        [country]
      )
    ).rows[0]!.id;
    cohort = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO core.cohorts(region_id,code,name) VALUES($1,'access-cohort','Cohort') RETURNING id",
        [region]
      )
    ).rows[0]!.id;
    pending = randomBytes(32).toString('base64url');
    await query('SELECT admin.begin_access_login($1,$2,$3,$4,$5)', [
      pending,
      'https://access.example',
      'applicant',
      'Applicant',
      'verified@example.com'
    ]);
  });
  afterEach(async () => {
    await runtime?.end();
    if (login) {
      await db.pool.query(`DROP OWNED BY ${login}`);
      await db.pool.query(`DROP ROLE ${login}`);
    }
    await db?.dispose();
  });
  const revision = async (target: string) =>
    (
      await db.pool.query<{ version: number }>(
        'SELECT access_grant_version version FROM admin.principals WHERE id=$1',
        [target]
      )
    ).rows[0]!.version;
  const approved = async () => {
    const s = await request();
    const grant = (await decide(s.principalId, s.version)).rows[0]!.grant_id;
    return { ...s, grant };
  };
  const edit = (
    id: string,
    v: number,
    role = 'coach_admin',
    r: string | null = null,
    who = actor
  ) =>
    query<{ id: string }>(
      'SELECT admin.edit_managed_role($1,$2,$3,$4,NULL,$5) id',
      [id, v, role, r, 'Identity and responsibilities reviewed'],
      who
    );
  const bulk = (id: string, v: number, who = actor) =>
    query<{ n: number }>(
      'SELECT admin.revoke_all_managed_roles($1,$2,$3) n',
      [id, v, 'Responsibilities ended'],
      who
    );
  const list = async (who = actor) =>
    (
      await query<{
        data: {
          entries: Array<{
            principalId: string;
            accountStatus: string;
            canRevokeAll: boolean;
            grantVersion: number;
            grants: Array<{ id: string; effective: boolean; canEdit: boolean; canRevoke: boolean }>;
          }>;
        };
      }>("SELECT admin.access_admin_list(1,'authorized') data", [], who)
    ).rows[0]!.data;
  const master = async () => {
    const id = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://access.example','master','Master') RETURNING id"
      )
    ).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,reason) SELECT $1,id,'global','fixture' FROM admin.roles WHERE code='master_admin'",
      [id]
    );
    return id;
  };
  it('lists provisioned and scoped authorized accounts, not drafts, rejected accounts or historical-only grants', async () => {
    const before = await list();
    expect(before.entries.map((e) => e.principalId)).toEqual([actor]);
    const s = await approved();
    expect((await list()).entries.map((e) => e.principalId).sort()).toEqual(
      [actor, s.principalId].sort()
    );
    await db.pool.query("UPDATE admin.principals SET status='suspended' WHERE id=$1", [
      s.principalId
    ]);
    expect((await list()).entries.find((e) => e.principalId === s.principalId)).toMatchObject({
      accountStatus: 'suspended',
      grants: [{ effective: false }]
    });
    await bulk(s.principalId, await revision(s.principalId));
    expect((await list()).entries.map((e) => e.principalId)).toEqual([actor]);
    expect(
      (
        await db.pool.query('SELECT status FROM admin.access_applications WHERE principal_id=$1', [
          s.principalId
        ])
      ).rows[0]!.status
    ).toBe('approved');
  });
  it('atomically replaces a role, preserves history/audit, and invalidates old sessions', async () => {
    const s = await approved();
    const token = randomBytes(32).toString('base64url');
    await query('SELECT admin.create_session($1,$2,$3)', [
      token,
      'https://access.example',
      'applicant'
    ]);
    const v = await revision(s.principalId);
    const replacement = (await edit(s.grant, v)).rows[0]!.id;
    expect(replacement).not.toBe(s.grant);
    expect(await revision(s.principalId)).toBe(v + 2);
    expect(
      (await db.pool.query('SELECT valid_to FROM admin.role_grants WHERE id=$1', [s.grant]))
        .rows[0]!.valid_to
    ).not.toBeNull();
    expect(
      (await query<{ id: string | null }>('SELECT admin.session_principal($1) id', [token]))
        .rows[0]!.id
    ).toBeNull();
    const event = (
      await db.pool.query("SELECT * FROM audit.events WHERE action='admin_access.edit'")
    ).rows[0]!;
    expect(event).toMatchObject({
      actor_principal_id: actor,
      target_id: s.principalId,
      before_data: { id: s.grant },
      after_data: { grantId: replacement, role: 'coach_admin' }
    });
    await expect(edit(s.grant, v)).rejects.toThrow('admin grant conflict');
  });
  it('rolls back invalid scopes, duplicate replacements and all associated audits and revisions', async () => {
    const s = await approved();
    await query(
      'SELECT admin.add_managed_role($1,$2,NULL,NULL,$3)',
      [s.principalId, 'global_viewer', 'Second responsibility'],
      actor
    );
    const v = await revision(s.principalId);
    const audits = (await db.pool.query('SELECT count(*)::int n FROM audit.events')).rows[0]!.n;
    await expect(edit(s.grant, v, 'global_viewer')).rejects.toThrow('admin grant conflict');
    await expect(edit(s.grant, v, 'regional_admin', randomUUID())).rejects.toThrow(
      'invalid admin grant'
    );
    expect(await revision(s.principalId)).toBe(v);
    expect(
      (await db.pool.query('SELECT valid_to FROM admin.role_grants WHERE id=$1', [s.grant]))
        .rows[0]!.valid_to
    ).toBeNull();
    expect((await db.pool.query('SELECT count(*)::int n FROM audit.events')).rows[0]!.n).toBe(
      audits
    );
  });
  it('only allows one concurrent edit and rejects stale single/all revocations', async () => {
    const s = await approved();
    const v = await revision(s.principalId);
    const results = await Promise.allSettled([edit(s.grant, v), edit(s.grant, v, 'global_viewer')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(bulk(s.principalId, v)).rejects.toThrow('admin grant conflict');
    const current = (
      await db.pool.query<{ id: string }>(
        'SELECT id FROM admin.role_grants WHERE principal_id=$1 AND valid_to IS NULL',
        [s.principalId]
      )
    ).rows[0]!.id;
    await expect(
      query('SELECT admin.revoke_managed_role_versioned($1,$2,$3)', [current, v, 'Stale'], actor)
    ).rejects.toThrow('admin grant conflict');
  });
  it('revokes all grants atomically without deleting Authgear identity or learner data', async () => {
    const s = await approved();
    await query(
      'SELECT admin.add_managed_role($1,$2,NULL,NULL,$3)',
      [s.principalId, 'coach_admin', 'Additional responsibility'],
      actor
    );
    const v = await revision(s.principalId);
    expect((await bulk(s.principalId, v)).rows[0]!.n).toBe(2);
    expect(
      (
        await db.pool.query('SELECT * FROM admin.role_grants WHERE principal_id=$1', [
          s.principalId
        ])
      ).rows
    ).toHaveLength(2);
    expect(
      (
        await db.pool.query(
          'SELECT * FROM admin.role_grants WHERE principal_id=$1 AND valid_to IS NULL',
          [s.principalId]
        )
      ).rows
    ).toEqual([]);
    expect(
      (
        await db.pool.query('SELECT status,oidc_subject FROM admin.principals WHERE id=$1', [
          s.principalId
        ])
      ).rows[0]
    ).toEqual({ status: 'active', oidc_subject: 'applicant' });
    const e = (
      await db.pool.query("SELECT * FROM audit.events WHERE action='admin_access.revoke_all'")
    ).rows[0]!;
    expect(e.before_data).toHaveLength(2);
    expect(e.actor_principal_id).toBe(actor);
  });
  it('allows delegated ordinary edits but blocks promotion, self changes and protected accounts', async () => {
    const who = await master();
    const s = await approved();
    const v = await revision(s.principalId);
    await expect(edit(s.grant, v, 'master_admin', null, who)).rejects.toThrow(
      'admin access denied'
    );
    expect(await revision(s.principalId)).toBe(v);
    const replacement = (await edit(s.grant, v, 'global_viewer', null, who)).rows[0]!.id;
    await expect(bulk(actor, await revision(actor), who)).rejects.toThrow('admin access denied');
    await expect(bulk(who, await revision(who), who)).rejects.toThrow('admin access denied');
    await expect(bulk(actor, await revision(actor))).rejects.toThrow('admin access denied');
    await query(
      'SELECT admin.revoke_managed_role_versioned($1,$2,$3)',
      [replacement, await revision(s.principalId), 'Remove ordinary role'],
      who
    );
  });
  it('lets masters manage regional viewers only with explicit regions and versioned ordinary-role protections', async () => {
    const s = await approved();
    await db.pool.query('DELETE FROM admin.role_grants WHERE principal_id=$1', [actor]);
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,reason) SELECT $1,id,'global','Master fixture' FROM admin.roles WHERE code='master_admin'",
      [actor]
    );
    await expect(
      edit(s.grant, await revision(s.principalId), 'regional_viewer', null)
    ).rejects.toThrow('invalid admin grant');
    const grant = (await edit(s.grant, await revision(s.principalId), 'regional_viewer', region))
      .rows[0]!.id;
    expect(
      (
        await db.pool.query(
          'SELECT r.code,g.scope_type,g.region_id FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id WHERE g.id=$1',
          [grant]
        )
      ).rows[0]
    ).toMatchObject({ code: 'regional_viewer', scope_type: 'region', region_id: region });
    expect(
      (await list()).entries
        .find((e) => e.principalId === s.principalId)
        ?.grants.find((g) => g.id === grant)
    ).toMatchObject({ canEdit: true, canRevoke: true });
    expect((await bulk(s.principalId, await revision(s.principalId))).rows[0]!.n).toBe(1);
  });
  it('prevalidates the whole removal batch, never partially revoking unsupported or scheduled grants', async () => {
    const who = await master();
    const s = await approved();
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,cohort_id,reason) SELECT $1,id,'cohort',$2,'Legacy role' FROM admin.roles WHERE code='coach'",
      [s.principalId, cohort]
    );
    const v = await revision(s.principalId);
    expect(
      (await list(who)).entries.find((e) => e.principalId === s.principalId)?.canRevokeAll
    ).toBe(false);
    await expect(bulk(s.principalId, v, who)).rejects.toThrow('admin access denied');
    expect(await revision(s.principalId)).toBe(v);
    await db.pool.query(
      "UPDATE admin.role_grants SET valid_from=clock_timestamp()+INTERVAL '1 day' WHERE principal_id=$1 AND scope_type='cohort'",
      [s.principalId]
    );
    const newer = await revision(s.principalId);
    expect((await list()).entries.find((e) => e.principalId === s.principalId)?.canRevokeAll).toBe(
      false
    );
    await expect(bulk(s.principalId, newer)).rejects.toThrow('admin access denied');
    expect(await revision(s.principalId)).toBe(newer);
  });
});
