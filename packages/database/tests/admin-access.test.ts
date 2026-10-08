import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
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
suite('super admin access approval and isolated pending credentials', () => {
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
  it('never treats pending tokens as admin sessions or auto-grants roles; no direct access to pending tables', async () => {
    const s = await request();
    expect(s.status).toBe('pending');
    expect(
      (await query<{ id: string | null }>('SELECT admin.session_principal($1) id', [pending]))
        .rows[0]?.id
    ).toBeNull();
    expect(
      (
        await db.pool.query('SELECT * FROM admin.role_grants WHERE principal_id=$1', [
          s.principalId
        ])
      ).rows
    ).toEqual([]);
    await expect(query('SELECT * FROM admin.access_sessions')).rejects.toThrow('permission denied');
    await expect(query('SELECT * FROM admin.access_applications')).rejects.toThrow(
      'permission denied'
    );
    await expect(
      query('SELECT admin.access_admin_list(1,$1)', ['all'], s.principalId)
    ).rejects.toThrow('admin access denied');
    await expect(
      query(
        'SELECT admin.add_managed_role($1,$2,$3,NULL,$4)',
        [s.principalId, 'regional_admin', region, 'Bypass'],
        actor
      )
    ).rejects.toThrow('access approval required');
  });
  it('approves only explicit regional scopes with audit attribution and requires a fresh normal login', async () => {
    const s = await request();
    const grant = (await decide(s.principalId, s.version)).rows[0]!.grant_id;
    expect((await status()).status).toBe('approved');
    expect(
      (await db.pool.query('SELECT * FROM admin.role_grants WHERE id=$1', [grant])).rows[0]
    ).toMatchObject({
      principal_id: s.principalId,
      region_id: region,
      cohort_id: null,
      scope_type: 'region',
      granted_by_principal_id: actor
    });
    expect(
      (await query<{ id: string | null }>('SELECT admin.session_principal($1) id', [pending]))
        .rows[0]?.id
    ).toBeNull();
    const normal = randomBytes(32).toString('base64url');
    expect(
      (
        await query<{ allowed: boolean }>('SELECT admin.create_session($1,$2,$3) allowed', [
          normal,
          'https://access.example',
          'applicant'
        ])
      ).rows[0]?.allowed
    ).toBe(true);
    expect(
      (await query<{ id: string | null }>('SELECT admin.session_principal($1) id', [normal]))
        .rows[0]?.id
    ).toBe(s.principalId);
    expect(
      (
        await query<{
          data: { entries: Array<{ subject: string }>; roles: Array<{ code: string }> };
        }>('SELECT admin.access_admin_list(1,$1) data', ['all'], actor)
      ).rows[0]?.data.roles.map((r) => r.code)
    ).toEqual(['coach_admin', 'global_viewer', 'master_admin', 'regional_admin']);
    expect(
      (await db.pool.query("SELECT * FROM audit.events WHERE action='admin_access.decide'")).rows[0]
    ).toMatchObject({ actor_principal_id: actor, target_id: s.principalId, outcome: 'success' });
    await query(
      'SELECT admin.revoke_managed_role($1,$2)',
      [grant, 'Scope no longer needed'],
      actor
    );
    expect(
      (await query<{ id: string | null }>('SELECT admin.session_principal($1) id', [normal]))
        .rows[0]?.id
    ).toBeNull();
  });
  it('rejects self-elevation, stale decisions, wrong scope combinations and inactive regions atomically', async () => {
    const s = await request('coach_admin');
    await expect(
      decide(s.principalId, s.version, 'approved', 'super_admin', null, null)
    ).rejects.toThrow('invalid admin grant');
    await expect(
      decide(s.principalId, s.version, 'approved', 'coach_admin', region, cohort)
    ).rejects.toThrow('invalid admin grant');
    await db.pool.query('UPDATE core.regions SET active=FALSE WHERE id=$1', [region]);
    await expect(
      decide(s.principalId, s.version, 'approved', 'regional_admin', region, null)
    ).rejects.toThrow('invalid admin grant');
    expect((await status()).status).toBe('pending');
    await db.pool.query('UPDATE core.regions SET active=TRUE WHERE id=$1', [region]);
    await decide(s.principalId, s.version, 'approved', 'coach_admin', null, null);
    await expect(decide(s.principalId, s.version)).rejects.toThrow('access version conflict');
    await expect(
      query(
        'SELECT admin.add_managed_role($1,$2,$3,NULL,$4)',
        [actor, 'regional_admin', region, 'Self grant'],
        actor
      )
    ).rejects.toThrow('invalid admin grant');
    await expect(
      query(
        'SELECT admin.revoke_managed_role(id,$1) FROM admin.role_grants WHERE principal_id=$2',
        ['Self revoke', actor],
        actor
      )
    ).rejects.toThrow('invalid admin revocation');
  });
  const provisionMaster = async () => {
    const principal = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://access.example','master','Master') RETURNING id"
      )
    ).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,reason) SELECT $1,id,'global','master fixture' FROM admin.roles WHERE code='master_admin'",
      [principal]
    );
    return principal;
  };
  it.each(['global_viewer', 'coach_admin', 'master_admin', 'regional_admin'] as const)(
    'enforces %s private-note visibility and immutable read-only capabilities across regions',
    async (role) => {
      const s = await request(role);
      await decide(
        s.principalId,
        s.version,
        'approved',
        role,
        role === 'regional_admin' ? region : null,
        null
      );
      const outside = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT parent_region_id,'outside','operational','外區','Outside' FROM core.regions WHERE id=$1 RETURNING id",
          [region]
        )
      ).rows[0]!.id;
      for (const [i, r] of [region, outside].entries()) {
        const person = (
          await db.pool.query<{ id: string }>(
            "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES($1,'UTC') RETURNING id",
            ['Learner ' + i]
          )
        ).rows[0]!.id;
        const identity = (
          await db.pool.query<{ id: string }>(
            "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'line',$2) RETURNING id",
            [person, 'note-' + i]
          )
        ).rows[0]!.id;
        const assignment = (
          await db.pool.query<{ id: string }>(
            "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-10) RETURNING id",
            [person, r]
          )
        ).rows[0]!.id;
        const checkin = (
          await db.pool.query<{ id: string }>(
            "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) VALUES($1,$2,CURRENT_DATE,'UTC','regular',$3) RETURNING id",
            [person, identity, assignment]
          )
        ).rows[0]!.id;
        await db.pool.query(
          "INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) VALUES($1,$2,'Private note')",
          [checkin, person]
        );
        const tag = (
          await db.pool.query<{ id: string }>(
            "INSERT INTO core.practice_feeling_tags(name_zh_tw,name_en,sort_order) VALUES('放鬆','Relaxed',$1) RETURNING id",
            [i]
          )
        ).rows[0]!.id;
        await db.pool.query(
          "INSERT INTO core.checkin_note_tags(checkin_id,person_id,tag_id,name_zh_tw,name_en,sort_order) VALUES($1,$2,$3,'放鬆','Relaxed',0)",
          [checkin, person, tag]
        );
      }
      const privateAccess = role === 'coach_admin' || role === 'master_admin';
      expect(
        (await query('SELECT * FROM core.checkin_notes', [], s.principalId)).rows
      ).toHaveLength(privateAccess ? 2 : 0);
      expect(
        (await query('SELECT * FROM core.checkin_note_tags', [], s.principalId)).rows
      ).toHaveLength(privateAccess ? 2 : 0);
      if (privateAccess) {
        const journal = (
          await query<{
            data: {
              total: number;
              entries: Array<{ practiceNote: string; feelingTags: Array<{ name: string }> }>;
            };
          }>("SELECT admin.practice_journal(NULL,1,'en') data", [], s.principalId)
        ).rows[0]!.data;
        expect(journal.total).toBe(2);
        expect(
          journal.entries.every(
            (e) => e.practiceNote === 'Private note' && e.feelingTags[0]?.name === 'Relaxed'
          )
        ).toBe(true);
      } else
        await expect(
          query("SELECT admin.practice_journal(NULL,1,'en')", [], s.principalId)
        ).rejects.toThrow('journal access denied');
      for (const permission of [
        'checkin.correct',
        'stats.export',
        'taxonomy.manage',
        'privacy.delete',
        'broadcast.approve'
      ])
        expect(
          (
            await query<{ allowed: boolean }>(
              'SELECT admin.has_permission($1) allowed',
              [permission],
              s.principalId
            )
          ).rows[0]!.allowed
        ).toBe(false);
      expect(
        (
          await query<{ allowed: boolean }>(
            'SELECT admin.can_manage_admin_access() allowed',
            [],
            s.principalId
          )
        ).rows[0]!.allowed
      ).toBe(role === 'master_admin');
      await expect(
        query(
          'SELECT admin.add_managed_role($1,$2,NULL,NULL,$3)',
          [s.principalId, 'super_admin', 'Elevate'],
          s.principalId
        )
      ).rejects.toThrow();
    }
  );
  it('delegates ordinary approvals and revocations without exposing protected roles or accounts to masters', async () => {
    const master = await provisionMaster();
    const s = await request('coach_admin');
    const grant = (
      await query<{ id: string }>(
        'SELECT admin.decide_access_application($1,$2,$3,$4,NULL,NULL,$5) id',
        [s.principalId, s.version, 'approved', 'coach_admin', 'Approved by master'],
        master
      )
    ).rows[0]!.id;
    const list = (
      await query<{
        data: {
          canAssignMaster: boolean;
          roles: Array<{ code: string }>;
          entries: Array<{
            principalId: string;
            canManage: boolean;
            grants: Array<{ canRevoke: boolean }>;
          }>;
        };
      }>("SELECT admin.access_admin_list(1,'all') data", [], master)
    ).rows[0]!.data;
    expect(list.canAssignMaster).toBe(false);
    expect(list.roles.map((r) => r.code)).toEqual([
      'coach_admin',
      'global_viewer',
      'regional_admin'
    ]);
    expect(list.entries.find((e) => e.principalId === actor)).toMatchObject({
      canManage: false,
      grants: [{ canRevoke: false }]
    });
    for (const [target, role] of [
      [s.principalId, 'master_admin'],
      [actor, 'global_viewer'],
      [master, 'global_viewer']
    ])
      await expect(
        query(
          'SELECT admin.add_managed_role($1,$2,NULL,NULL,$3)',
          [target, role, 'Forbidden'],
          master
        )
      ).rejects.toThrow();
    const protectedGrant = (
      await db.pool.query<{ id: string }>(
        'SELECT id FROM admin.role_grants WHERE principal_id=$1',
        [actor]
      )
    ).rows[0]!.id;
    await expect(
      query('SELECT admin.revoke_managed_role($1,$2)', [protectedGrant, 'Forbidden'], master)
    ).rejects.toThrow('admin access denied');
    await query('SELECT admin.revoke_managed_role($1,$2)', [grant, 'No longer needed'], master);
    expect(
      (
        await db.pool.query(
          'SELECT * FROM audit.events WHERE actor_principal_id=$1 AND action IN ($2,$3)',
          [master, 'admin_access.grant', 'admin_access.revoke']
        )
      ).rows
    ).toHaveLength(2);
    await expect(
      db.pool.query(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,reason) SELECT $1,id,'region',$2,'Wrong scope' FROM admin.roles WHERE code='coach_admin'",
        [s.principalId, region]
      )
    ).rejects.toThrow('global admin scope required');
  });
  it('reserves master requests and role assignment to super admins, without accepting self-service promotion', async () => {
    const master = await provisionMaster();
    const s = await request('master_admin');
    for (const decision of ['approved', 'rejected'])
      await expect(
        query(
          'SELECT admin.decide_access_application($1,$2,$3,$4,NULL,NULL,$5)',
          [
            s.principalId,
            s.version,
            decision,
            decision === 'approved' ? 'global_viewer' : null,
            'Forbidden'
          ],
          master
        )
      ).rejects.toThrow('admin access denied');
    await decide(s.principalId, s.version, 'approved', 'master_admin', null, null);
    expect(
      (
        await query<{ allowed: boolean }>(
          'SELECT admin.can_manage_admin_access() allowed',
          [],
          s.principalId
        )
      ).rows[0]!.allowed
    ).toBe(true);
    const grant = (
      await db.pool.query<{ id: string }>(
        'SELECT id FROM admin.role_grants WHERE principal_id=$1',
        [s.principalId]
      )
    ).rows[0]!.id;
    await expect(
      query('SELECT admin.revoke_managed_role($1,$2)', [grant, 'Forbidden'], master)
    ).rejects.toThrow('admin access denied');
    await query(
      'SELECT admin.revoke_managed_role($1,$2)',
      [grant, 'Revoked by super admin'],
      actor
    );
    expect(
      (
        await query<{ allowed: boolean }>(
          'SELECT admin.can_manage_admin_access() allowed',
          [],
          s.principalId
        )
      ).rows[0]!.allowed
    ).toBe(false);
  });
  it('allows rejection then explicit resubmission, but not duplicated pending requests', async () => {
    const s = await request();
    await decide(s.principalId, s.version, 'rejected', null, null, null);
    expect((await status()).status).toBe('rejected');
    const again = await request('coach_admin');
    expect(again.version).toBeGreaterThan(s.version);
    await expect(request()).rejects.toThrow('access version conflict');
    await query('SELECT admin.revoke_access_session($1)', [pending]);
    await expect(status()).rejects.toThrow('access session unavailable');
  });
  it('serializes concurrent approval so only one scoped grant and decision event are created', async () => {
    const s = await request();
    const results = await Promise.allSettled([
      decide(s.principalId, s.version),
      decide(s.principalId, s.version)
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (
        await db.pool.query('SELECT * FROM admin.role_grants WHERE principal_id=$1', [
          s.principalId
        ])
      ).rows
    ).toHaveLength(1);
    expect(
      (await db.pool.query("SELECT * FROM audit.events WHERE action='admin_access.decide'")).rows
    ).toHaveLength(1);
  });
  it.each(['super_admin', 'master_admin'] as const)(
    'rechecks a queued %s after concurrent revocation rather than trusting an earlier session',
    async (actingRole) => {
      const s = await request();
      const second = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://access.example','second-root','Second root') RETURNING id"
        )
      ).rows[0]!.id;
      const grant = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,reason) SELECT $1,id,'global','test second root' FROM admin.roles WHERE code=$2 RETURNING id",
          [second, actingRole]
        )
      ).rows[0]!.id;
      let release: () => void = () => {};
      let acquired: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const holder = withRequestContext(
        runtime,
        'qigong_api_runtime',
        { requestId: randomUUID(), principalId: actor },
        async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(1919,1)');
          acquired();
          await held;
          await client.query('SELECT admin.revoke_managed_role($1,$2)', [
            grant,
            'No longer authorized'
          ]);
        }
      );
      await ready;
      const queued = query(
        'SELECT admin.decide_access_application($1,$2,$3,$4,$5,NULL,$6)',
        [s.principalId, s.version, 'approved', 'regional_admin', region, 'Queued decision'],
        second
      );
      const outcome = queued.then(
        () => null,
        (error) => error as unknown
      );
      try {
        let waiting = false;
        for (let i = 0; i < 50; i++) {
          waiting =
            (
              await db.pool.query<{ n: number }>(
                "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'"
              )
            ).rows[0]!.n > 0;
          if (waiting) break;
          await setTimeout(10);
        }
        expect(waiting).toBe(true);
      } finally {
        release();
      }
      await holder;
      expect(await outcome).toMatchObject({ message: 'admin access denied' });
      expect((await status()).status).toBe('pending');
    }
  );
  it.each(['super_admin', 'master_admin'] as const)(
    'checks %s grant expiry against the clock after waiting, not the transaction start timestamp',
    async (actingRole) => {
      const s = await request();
      const second = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://access.example','expiring-root','Expiring root') RETURNING id"
        )
      ).rows[0]!.id;
      const grant = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,reason,valid_to) SELECT $1,id,'global','expiry test',clock_timestamp()+INTERVAL '1 hour' FROM admin.roles WHERE code=$2 RETURNING id",
          [second, actingRole]
        )
      ).rows[0]!.id;
      let release: () => void = () => {};
      let acquired: () => void = () => {};
      const held = new Promise<void>((r) => {
        release = r;
      });
      const ready = new Promise<void>((r) => {
        acquired = r;
      });
      const holder = withRequestContext(
        runtime,
        'qigong_api_runtime',
        { requestId: randomUUID(), principalId: actor },
        async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(1919,1)');
          acquired();
          await held;
        }
      );
      await ready;
      const queued = query(
        'SELECT admin.decide_access_application($1,$2,$3,$4,$5,NULL,$6)',
        [s.principalId, s.version, 'approved', 'regional_admin', region, 'Queued expiry decision'],
        second
      );
      const outcome = queued.then(
        () => null,
        (error) => error as unknown
      );
      try {
        let waiting = false;
        for (let i = 0; i < 50; i++) {
          waiting =
            (
              await db.pool.query<{ n: number }>(
                "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'"
              )
            ).rows[0]!.n > 0;
          if (waiting) break;
          await setTimeout(10);
        }
        expect(waiting).toBe(true);
        await db.pool.query('UPDATE admin.role_grants SET valid_to=clock_timestamp() WHERE id=$1', [
          grant
        ]);
      } finally {
        release();
      }
      await holder;
      expect(await outcome).toMatchObject({ message: 'admin access denied' });
      expect((await status()).status).toBe('pending');
    }
  );
  it('binds identities to issuer and subject; disabled and expired credentials cannot request access', async () => {
    const first = await status();
    const other = randomBytes(32).toString('base64url');
    await query('SELECT admin.begin_access_login($1,$2,$3,$4,$5)', [
      other,
      'https://other-issuer.example',
      'applicant',
      'Applicant',
      'verified@example.com'
    ]);
    expect(
      (await query<Status>('SELECT admin.access_status($1) data', [other])).rows[0]?.data
        .principalId
    ).not.toBe(first.principalId);
    await db.pool.query('UPDATE admin.access_sessions SET expires_at=CURRENT_TIMESTAMP');
    await expect(status()).rejects.toThrow('access session unavailable');
    await db.pool.query("UPDATE admin.principals SET status='suspended' WHERE id=$1", [
      first.principalId
    ]);
    const token = randomBytes(32).toString('base64url');
    expect(
      (
        await query<{ allowed: boolean }>(
          'SELECT admin.begin_access_login($1,$2,$3,NULL,NULL) allowed',
          [token, 'https://access.example', 'applicant']
        )
      ).rows[0]?.allowed
    ).toBe(false);
  });
});
