import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const reader = 'qigong_whatsapp_venue_session_reader';
interface Fixture {
  person: string;
  identity: string;
  session: string;
  csrf: string;
}
suite('migrated WhatsApp venue Session-only SQL authority (isolated PostgreSQL)', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>> | undefined;
  let runtimePool: pg.Pool | undefined;
  let createdRuntime = false;
  const runtimeRole = 'wa_venue_test_' + randomUUID().replaceAll('-', '');
  let first: Fixture;
  let second: Fixture;
  const owner = () => {
    if (!db) throw new Error('Missing isolated test database');
    return db.pool;
  };
  const runtime = <T>(run: Parameters<typeof withRequestContext<T>>[3]) => {
    if (!runtimePool) throw new Error('Missing isolated runtime connection');
    return withRequestContext(runtimePool, 'qigong_api_runtime', { requestId: randomUUID() }, run);
  };
  const status = (session: string | null, csrf: string | null) =>
    runtime((c) =>
      c.query<{ data: unknown }>('SELECT platform.whatsapp_venue_session_status($1,$2) data', [
        session,
        csrf
      ])
    );

  beforeAll(async () => {
    db = await createIsolatedTestDatabase(base!);
    const migration = await runMigrations(
      owner(),
      path.join(root, 'migrations'),
      'vitest-wa-venue-migrated'
    );
    expect(migration.currentVersion).toBe('0066_practice_badge_receipts.sql');
    expect((await runMigrations(owner(), path.join(root, 'migrations'))).applied).toEqual([]);
    const password = randomBytes(24).toString('hex');
    await owner().query(
      `CREATE ROLE ${runtimeRole} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`
    );
    createdRuntime = true;
    await owner().query(`GRANT qigong_api_runtime TO ${runtimeRole}`);
    const runtimeUrl = new URL(db.databaseUrl);
    runtimeUrl.username = runtimeRole;
    runtimeUrl.password = password;
    runtimePool = new pg.Pool({ connectionString: runtimeUrl.href });
    const principal = (
      await owner().query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://wa-venue-test.invalid','reviewer','Synthetic') RETURNING id"
      )
    ).rows[0]!.id;
    const region = (
      await owner().query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('wa-test-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'wa-test-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'wa-test-operational','operational','地區','Region' FROM k RETURNING id"
      )
    ).rows[0]!.id;
    const create = async (subject: string): Promise<Fixture> => {
      const person = (
        await owner().query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic WA venue learner','Asia/Kuala_Lumpur') RETURNING id"
        )
      ).rows[0]!.id;
      const identity = (
        await owner().query<{ id: string }>(
          "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'whatsapp',$2) RETURNING id",
          [person, subject]
        )
      ).rows[0]!.id;
      await owner().query(
        "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
        [person, identity]
      );
      await owner().query(
        "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-1)",
        [person, region]
      );
      await owner().query(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('whatsapp',$1,'Synthetic','Synthetic','synthetic@example.invalid',$2,$3,'approved',$4,CURRENT_TIMESTAMP,$5)",
        [subject, '+' + subject, region, person, principal]
      );
      const session = randomBytes(32).toString('base64url');
      const csrf = randomBytes(32).toString('base64url');
      await owner().query(
        "INSERT INTO platform.whatsapp_browser_sessions(token_hash,csrf_hash,identity_id,person_id,remembered,expires_at) VALUES(public.digest($1,'sha256'),public.digest($2,'sha256'),$3,$4,TRUE,clock_timestamp()+INTERVAL '1 day')",
        [session, csrf, identity, person]
      );
      return { person, identity, session, csrf };
    };
    first = await create('60110000001');
    second = await create('65910000002');
  }, 60000);

  beforeEach(async () => {
    if (!first) return;
    for (const value of [first, second]) {
      await owner().query("UPDATE identity.people SET status='active' WHERE id=$1", [value.person]);
      await owner().query(
        "UPDATE identity.platform_identities SET revoked_at=NULL,verified_at=clock_timestamp()-INTERVAL '1 day' WHERE id=$1",
        [value.identity]
      );
      await owner().query(
        'UPDATE identity.person_interaction_channels SET valid_to=NULL WHERE platform_identity_id=$1',
        [value.identity]
      );
      await owner().query(
        "UPDATE identity.onboarding_applications SET status='approved' WHERE person_id=$1",
        [value.person]
      );
      await owner().query(
        "UPDATE platform.whatsapp_browser_sessions SET created_at=clock_timestamp()-INTERVAL '1 day',expires_at=clock_timestamp()+INTERVAL '1 day',revoked_at=NULL WHERE token_hash=public.digest($1,'sha256')",
        [value.session]
      );
    }
  });
  afterAll(async () => {
    if (runtimePool) await runtimePool.end();
    if (createdRuntime) await owner().query(`DROP ROLE ${runtimeRole}`);
    // The shared safe fixture teardown removes only newly-created, orphaned roles
    // after this database is gone; never manually adopt/drop a migrated owner.
    if (db) await db.dispose();
  });

  it('returns only bounded status, not person IDs or credentials', async () => {
    const result = await status(first.session, first.csrf);
    expect(result.rows[0]!.data).toEqual({ version: 1, status: 'approved', privacy: 'clear' });
    const text = JSON.stringify(result.rows[0]!.data);
    for (const secret of [first.session, first.csrf, first.person, first.identity])
      expect(text).not.toContain(secret);
  });
  it('cannot mix Session and CSRF from different learners', async () => {
    await expect(status(first.session, second.csrf)).rejects.toMatchObject({ code: '42501' });
    expect((await status(second.session, second.csrf)).rows[0]!.data).toEqual({
      version: 1,
      status: 'approved',
      privacy: 'clear'
    });
  });
  it.each([
    [null, 'x'.repeat(43)],
    ['x'.repeat(43), null],
    ['short', 'x'.repeat(43)],
    ['x'.repeat(43), 'y'.repeat(43)],
    ['x'.repeat(43) + '\n', 'y'.repeat(43)]
  ])('rejects absent, malformed or unknown credentials', async (session, csrf) => {
    await expect(status(session, csrf)).rejects.toMatchObject({ code: '42501' });
  });
  it('does not fall back to an existing private check-in link', async () => {
    const token = randomBytes(32).toString('base64url');
    await runtime((c) =>
      c.query("SELECT platform.begin_whatsapp_link($1,$2,'checkin')", ['60110000001', token])
    );
    await expect(status(token, first.csrf)).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects revoked and wall-clock expired Sessions', async () => {
    await owner().query(
      "UPDATE platform.whatsapp_browser_sessions SET revoked_at=clock_timestamp() WHERE token_hash=public.digest($1,'sha256')",
      [first.session]
    );
    await expect(status(first.session, first.csrf)).rejects.toMatchObject({ code: '42501' });
    await owner().query(
      "UPDATE platform.whatsapp_browser_sessions SET revoked_at=NULL,expires_at=clock_timestamp()-INTERVAL '1 second' WHERE token_hash=public.digest($1,'sha256')",
      [first.session]
    );
    await expect(status(first.session, first.csrf)).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects removed learner eligibility', async () => {
    await owner().query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE platform_identity_id=$1',
      [first.identity]
    );
    await owner().query("UPDATE identity.people SET status='suspended' WHERE id=$1", [
      first.person
    ]);
    await expect(status(first.session, first.csrf)).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects revoked identities and channels even if a Session is manually restored by fixture owner', async () => {
    await owner().query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE platform_identity_id=$1',
      [first.identity]
    );
    await owner().query(
      'UPDATE identity.platform_identities SET revoked_at=clock_timestamp() WHERE id=$1',
      [first.identity]
    );
    await owner().query(
      "UPDATE platform.whatsapp_browser_sessions SET revoked_at=NULL WHERE token_hash=public.digest($1,'sha256')",
      [first.session]
    );
    await expect(status(first.session, first.csrf)).rejects.toMatchObject({ code: '42501' });
    await owner().query('UPDATE identity.platform_identities SET revoked_at=NULL WHERE id=$1', [
      first.identity
    ]);
    await owner().query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE platform_identity_id=$1',
      [first.identity]
    );
    await owner().query(
      "UPDATE platform.whatsapp_browser_sessions SET revoked_at=NULL WHERE token_hash=public.digest($1,'sha256')",
      [first.session]
    );
    await expect(status(first.session, first.csrf)).rejects.toMatchObject({ code: '42501' });
  });
  it('does not authorize using forged caller context or expose the owner role', async () => {
    await expect(
      runtime(async (c) => {
        await c.query(
          "SELECT set_config('qigong.wa_venue_session_hash',encode(public.digest($1,'sha256'),'hex'),TRUE),set_config('qigong.wa_venue_csrf_hash',encode(public.digest($2,'sha256'),'hex'),TRUE)",
          [first.session, first.csrf]
        );
        return c.query('SELECT platform.whatsapp_venue_session_status($1,$2)', [
          'x'.repeat(43),
          'y'.repeat(43)
        ]);
      })
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime((c) => c.query('SET ROLE qigong_whatsapp_venue_session_reader'))
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('clears credential hashes before returning and cannot read other tables as runtime', async () => {
    await runtime(async (c) => {
      await c.query('SELECT platform.whatsapp_venue_session_status($1,$2)', [
        first.session,
        first.csrf
      ]);
      const result = await c.query<{ session: string; csrf: string }>(
        "SELECT current_setting('qigong.wa_venue_session_hash',TRUE) session,current_setting('qigong.wa_venue_csrf_hash',TRUE) csrf"
      );
      expect(result.rows[0]).toEqual({ session: '', csrf: '' });
    });
    await expect(
      runtime((c) => c.query('SELECT token_hash FROM platform.whatsapp_browser_sessions'))
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('keeps the reader isolated, read-only and without worker execute access', async () => {
    const result = await owner().query<{
      safe: boolean;
      member: boolean;
      writes: boolean;
      privateNames: boolean;
      worker: boolean;
    }>(
      `SELECT NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) safe,
       EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=r.oid OR member=r.oid) member,
       has_table_privilege($1,'core.field_attendance','INSERT') writes,
       has_column_privilege($1,'identity.people','legal_name','SELECT') "privateNames",
       has_function_privilege('qigong_worker_runtime','platform.whatsapp_venue_session_status(text,text)','EXECUTE') worker
       FROM pg_roles r WHERE rolname=$1`,
      [reader]
    );
    expect(result.rows[0]).toEqual({
      safe: true,
      member: false,
      writes: false,
      privateNames: false,
      worker: false
    });
  });
  it('rejects a missing request context', async () => {
    await expect(
      runtime(async (c) => {
        await c.query("SELECT set_config('qigong.request_id','',TRUE)");
        return c.query('SELECT platform.whatsapp_venue_session_status($1,$2)', [
          first.session,
          first.csrf
        ]);
      })
    ).rejects.toMatchObject({ code: '42501' });
  });
  it.each(['person_id', 'principal_id'])('rejects caller-supplied %s context', async (key) => {
    await expect(
      runtime(async (c) => {
        await c.query('SELECT set_config($1,$2,TRUE)', ['qigong.' + key, first.person]);
        return c.query('SELECT platform.whatsapp_venue_session_status($1,$2)', [
          first.session,
          first.csrf
        ]);
      })
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('safely revalidates after a failed facade call is rolled back to a savepoint', async () => {
    await runtime(async (c) => {
      const marker = 'a'.repeat(64);
      await c.query(
        "SELECT set_config('qigong.wa_venue_session_hash',$1,TRUE),set_config('qigong.wa_venue_csrf_hash',$1,TRUE)",
        [marker]
      );
      await c.query('SAVEPOINT candidate_failure');
      await expect(
        c.query('SELECT platform.whatsapp_venue_session_status($1,$2)', [
          first.session,
          second.csrf
        ])
      ).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK TO SAVEPOINT candidate_failure');
      expect(
        (await c.query("SELECT current_setting('qigong.wa_venue_session_hash',TRUE) value")).rows[0]
      ).toEqual({ value: marker });
      expect(
        (
          await c.query<{ data: unknown }>(
            'SELECT platform.whatsapp_venue_session_status($1,$2) data',
            [first.session, first.csrf]
          )
        ).rows[0]!.data
      ).toEqual({ version: 1, status: 'approved', privacy: 'clear' });
      expect(
        (await c.query("SELECT current_setting('qigong.wa_venue_session_hash',TRUE) value")).rows[0]
      ).toEqual({ value: '' });
    });
  });
  it('restricts reader RLS to the credential-matched learner and hides rows for wrong hashes', async () => {
    const client = await owner().connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE qigong_whatsapp_venue_session_reader');
      await client.query(
        "SELECT set_config('qigong.wa_venue_session_hash',encode(public.digest($1,'sha256'),'hex'),TRUE),set_config('qigong.wa_venue_csrf_hash',encode(public.digest($2,'sha256'),'hex'),TRUE)",
        [first.session, first.csrf]
      );
      expect((await client.query('SELECT id FROM identity.people')).rows).toEqual([
        { id: first.person }
      ]);
      expect((await client.query('SELECT id FROM identity.platform_identities')).rows).toEqual([
        { id: first.identity }
      ]);
      await client.query(
        "SELECT set_config('qigong.wa_venue_csrf_hash',encode(public.digest($1,'sha256'),'hex'),TRUE)",
        [second.csrf]
      );
      expect((await client.query('SELECT id FROM identity.people')).rows).toEqual([]);
      await client.query('ROLLBACK');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
  it('does not write attendance or queue chat receipts', async () => {
    const before = (
      await owner().query(
        'SELECT (SELECT count(*) FROM core.field_attendance) attendance,(SELECT count(*) FROM ops.channel_practice_receipts) receipts'
      )
    ).rows[0];
    await status(first.session, first.csrf);
    const after = (
      await owner().query(
        'SELECT (SELECT count(*) FROM core.field_attendance) attendance,(SELECT count(*) FROM ops.channel_practice_receipts) receipts'
      )
    ).rows[0];
    expect(after).toEqual(before);
  });
  it('enforces published consent without treating a Session as consent', async () => {
    const version = 'baiyin-checkin-supplement-v1';
    try {
      await owner().query(
        "UPDATE platform.learner_privacy_policies SET state='active',published_at=clock_timestamp() WHERE version=$1",
        [version]
      );
      await expect(status(first.session, first.csrf)).rejects.toMatchObject({ code: '42501' });
      await owner().query(
        "INSERT INTO platform.learner_privacy_acceptances(platform,subject_hash,policy_version,document_hash,locale,reflection_consent) SELECT 'whatsapp',platform.privacy_subject_hash('whatsapp',$1),version,document_hash,'en',FALSE FROM platform.learner_privacy_policies WHERE version=$2",
        ['60110000001', version]
      );
      expect((await status(first.session, first.csrf)).rows[0]!.data).toEqual({
        version: 1,
        status: 'approved',
        privacy: 'clear'
      });
      await owner().query(
        "UPDATE platform.learner_privacy_acceptances SET revoked_at=clock_timestamp() WHERE platform='whatsapp'"
      );
      await expect(status(first.session, first.csrf)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await owner().query(
        "DELETE FROM platform.learner_privacy_acceptances WHERE platform='whatsapp'"
      );
      await owner().query(
        "UPDATE platform.learner_privacy_policies SET state='draft',published_at=NULL WHERE version=$1",
        [version]
      );
    }
  });
});
