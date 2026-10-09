import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Private journal scopes and explicit sharing', () => {
  let pool: Pool;
  let runtime: Pool;
  let role: string;
  let dispose: () => Promise<void>;
  let principal: string;
  let region: string;
  let otherRegion: string;
  let person: string;
  let identity: string;
  let assignment: string;
  let token: string;
  let sequence: number;
  const query = <Row extends pg.QueryResultRow>(
    sql: string,
    values: unknown[] = [],
    worker = false
  ) =>
    withRequestContext(
      runtime,
      worker ? 'qigong_worker_runtime' : 'qigong_api_runtime',
      { requestId: randomUUID() },
      (client) => client.query<Row>(sql, values)
    );
  const learner = async (targetRegion = region, name = 'Secret legal learner name') => {
    const subject = String(++sequence);
    const target = (
      await pool.query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES($1,'UTC') RETURNING id",
        [name]
      )
    ).rows[0]!.id;
    const ident = (
      await pool.query<{ id: string }>(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'telegram',$2) RETURNING id",
        [target, subject]
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
      [target, ident]
    );
    await pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('telegram',$1,$2,$2,'private@example.test','+886912345600',$3,'approved',$4,CURRENT_TIMESTAMP,$5)",
      [subject, name, targetRegion, target, principal]
    );
    const assign = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-500) RETURNING id",
        [target, targetRegion]
      )
    ).rows[0]!.id;
    const credential = randomBytes(32).toString('base64url');
    await query('SELECT platform.begin_telegram_checkin($1,$2)', [subject, credential]);
    return { person: target, identity: ident, assignment: assign, token: credential, subject };
  };
  const seed = async (
    offset: number,
    methods = ['dayan_chu'],
    target = { person, identity, assignment },
    kind = 'regular',
    hour = 6
  ) => {
    const id = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id,created_at) VALUES($1,$2,CURRENT_DATE+$3::integer,'UTC',$4,$5,(CURRENT_DATE+$3::integer+make_time($6::integer,0,0)) AT TIME ZONE 'UTC') RETURNING id",
        [target.person, target.identity, offset, kind, target.assignment, hour]
      )
    ).rows[0]!.id;
    await pool.query(
      'INSERT INTO core.checkin_method_selections(checkin_id,practice_method_id) SELECT $1,id FROM core.practice_methods WHERE code=ANY($2::text[])',
      [id, methods]
    );
    return id;
  };
  beforeEach(async () => {
    const isolated = await createIsolatedTestDatabase(base!);
    pool = isolated.pool;
    dispose = () => isolated.dispose();
    await runMigrations(pool, directory, 'journal-test');
    role = 'qigong_workspace_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await pool.query(`GRANT qigong_api_runtime,qigong_worker_runtime TO ${role}`);
    const url = new URL(isolated.databaseUrl);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    principal = (
      await pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://workspace.test','root','Workspace test') RETURNING id"
      )
    ).rows[0]!.id;
    const global = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('workspace-global','global','全球','Global') RETURNING id"
      )
    ).rows[0]!.id;
    const country = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'workspace-country','country','國家','Country') RETURNING id",
        [global]
      )
    ).rows[0]!.id;
    const regions = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'workspace-region','operational','區域','Region'),($1,'workspace-other','operational','他區','Other') RETURNING id",
        [country]
      )
    ).rows;
    region = regions[0]!.id;
    otherRegion = regions[1]!.id;
    sequence = 200000;
    ({ person, identity, assignment, token } = await learner());
  });
  afterEach(async () => {
    await runtime?.end();
    if (role) {
      await pool.query(`DROP OWNED BY ${role}`);
      await pool.query(`DROP ROLE ${role}`);
    }
    await dispose?.();
  });

  interface Feed {
    total: number;
    entries: Record<string, unknown>[];
  }
  const feed = async (externalToken?: string) =>
    (
      await query<{ data: Feed }>(
        externalToken
          ? 'SELECT platform.external_journal_feed($1,$2,$3) data'
          : 'SELECT platform.journal_feed($1,$2,$3) data',
        [externalToken ?? token, 'en', 1]
      )
    ).rows[0]!.data;
  const publish = async (
    id: string,
    version = 0,
    active = true,
    external = false,
    auth = token,
    note = true,
    feelings = false
  ) => {
    const sourceHash = (
      await pool.query<{ hash: string }>(
        "SELECT encode(public.digest(platform.journal_source($1)::text,'sha256'),'hex') hash",
        [id]
      )
    ).rows[0]!.hash;
    return (
      await query<{ data: { version: number; active: boolean } }>(
        'SELECT platform.journal_publish($1,$2,$3,$4,$5,$6,$7,$8,$9) data',
        [auth, id, version, active, note, feelings, external, 'Shared alias', sourceHash]
      )
    ).rows[0]!.data;
  };
  const privateNote = async (id: string, text = 'Original private note') =>
    pool.query(
      'INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) SELECT id,person_id,$2 FROM core.checkins WHERE id=$1',
      [id, text]
    );
  const grant = async (code: string, regionId: string | null = null) => {
    await pool.query('DELETE FROM admin.role_grants WHERE principal_id=$1', [principal]);
    await pool.query(
      'INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,reason) SELECT $1,id,$2,$3,$4 FROM admin.roles WHERE code=$5',
      [principal, regionId ? 'region' : 'global', regionId, 'Isolated journal test', code]
    );
  };
  const adminQuery = <Row extends pg.QueryResultRow>(sql: string, values: unknown[] = []) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: principal },
      (c) => c.query<Row>(sql, values)
    );
  const issue = async (secret = randomBytes(32).toString('base64url')) => {
    const result = await adminQuery<{ id: string }>(
      "SELECT admin.issue_journal_client($1,$2,clock_timestamp()+INTERVAL '1 day',$3) id",
      [secret, 'Isolated partner', 'Approved test integration']
    );
    return { secret, id: result.rows[0]!.id };
  };
  it('starts private, exposes no direct tables or arbitrary-person facade, and denies invalid tokens', async () => {
    const id = await seed(0);
    await privateNote(id);
    expect((await feed()).total).toBe(0);
    const own = await query<{ data: Feed }>('SELECT platform.journal_own($1,1,$2) data', [
      token,
      'en'
    ]);
    expect(own.rows[0]!.data.entries[0]).toMatchObject({
      version: 0,
      active: false,
      externalEnabled: false
    });
    for (const sql of [
      'SELECT * FROM core.journal_publications',
      'SELECT * FROM platform.journal_api_clients',
      "SELECT core.shared_journal_feed('en',1,FALSE)",
      'SELECT platform.journal_person($1)'
    ])
      await expect(query(sql, sql.includes('$1') ? [token] : [])).rejects.toThrow(
        'permission denied'
      );
    await expect(
      query('SELECT platform.journal_feed($1,$2,1)', [randomBytes(32).toString('base64url'), 'en'])
    ).rejects.toThrow('practice identity unavailable');
  });
  it('publishes a selected snapshot to all regions without private identity fields; private corrections never update it', async () => {
    const id = await seed(0);
    await privateNote(id);
    expect(await publish(id)).toEqual({ version: 1, active: true });
    const other = await learner(otherRegion);
    const across = (
      await query<{ data: Feed }>('SELECT platform.journal_feed($1,$2,1) data', [other.token, 'en'])
    ).rows[0]!.data;
    expect(across.total).toBe(1);
    expect(across.entries[0]).toMatchObject({
      alias: 'Shared alias',
      practiceNote: 'Original private note',
      version: 1,
      feelingTags: []
    });
    const serialized = JSON.stringify(across);
    for (const value of [
      person,
      identity,
      id,
      'Secret legal learner name',
      'private@example.test',
      '+886912345600'
    ])
      expect(serialized).not.toContain(value);
    await pool.query('UPDATE core.checkin_notes SET practice_note=$2 WHERE checkin_id=$1', [
      id,
      'Changed private note'
    ]);
    expect((await feed()).entries[0]!.practiceNote).toBe('Original private note');
    expect(await publish(id, 1)).toEqual({ version: 2, active: true });
    expect((await feed()).entries[0]!.practiceNote).toBe('Changed private note');
  });
  it('requires a separate external opt-in and removes withdrawn versions from both feeds', async () => {
    await grant('super_admin');
    const client = await issue();
    const id = await seed(0);
    await privateNote(id);
    await publish(id);
    expect((await feed(client.secret)).total).toBe(0);
    await publish(id, 1, true, true);
    expect((await feed(client.secret)).total).toBe(1);
    await publish(id, 2, false);
    expect((await feed()).total).toBe(0);
    expect((await feed(client.secret)).total).toBe(0);
  });
  it('shares tag-only snapshots independently and preserves labels through catalog changes', async () => {
    const id = await seed(0);
    await privateNote(id);
    const tag = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.practice_feeling_tags(name_zh_tw,name_en,sort_order) VALUES('放鬆','Relaxed',1) RETURNING id"
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO core.checkin_note_tags(checkin_id,person_id,tag_id,name_zh_tw,name_en,sort_order) VALUES($1,$2,$3,'放鬆','Relaxed',1)",
      [id, person, tag]
    );
    await publish(id, 0, true, false, token, false, true);
    expect((await feed()).entries[0]).toMatchObject({ practiceNote: '', feelingTags: ['Relaxed'] });
    await pool.query(
      "UPDATE core.practice_feeling_tags SET name_en='Renamed',active=FALSE WHERE id=$1",
      [tag]
    );
    expect((await feed()).entries[0]!.feelingTags).toEqual(['Relaxed']);
  });
  it('rejects other people, empty selections, stale versions and concurrent overwrite', async () => {
    const id = await seed(0);
    await privateNote(id);
    const other = await learner(otherRegion);
    await expect(publish(id, 0, true, false, other.token)).rejects.toThrow('journal unavailable');
    await expect(publish(id, 0, true, false, token, false, false)).rejects.toThrow(
      'empty journal publication'
    );
    const outcomes = await Promise.allSettled([publish(id), publish(id)]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(publish(id)).rejects.toThrow('journal version conflict');
    expect((await feed()).total).toBe(1);
  });
  it('hides shares after author identity withdrawal, channel closure, or person suspension', async () => {
    const id = await seed(0);
    await privateNote(id);
    await publish(id);
    const other = await learner(otherRegion);
    const read = async () =>
      (
        await query<{ data: Feed }>('SELECT platform.journal_feed($1,$2,1) data', [
          other.token,
          'en'
        ])
      ).rows[0]!.data.total;
    await pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=CURRENT_TIMESTAMP WHERE person_id=$1 AND valid_to IS NULL',
      [person]
    );
    expect(await read()).toBe(0);
    await pool.query("UPDATE identity.people SET status='suspended' WHERE id=$1", [person]);
    expect(await read()).toBe(0);
    await pool.query("UPDATE identity.people SET status='active' WHERE id=$1", [person]);
    await pool.query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
      [person, identity]
    );
    expect(await read()).toBe(1);
    await pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=CURRENT_TIMESTAMP WHERE person_id=$1 AND valid_to IS NULL',
      [person]
    );
    await pool.query(
      'UPDATE identity.platform_identities SET revoked_at=CURRENT_TIMESTAMP WHERE id=$1',
      [identity]
    );
    expect(await read()).toBe(0);
  });
  it('limits regional viewers to their region, while coaches and masters read globally without expanding other roles', async () => {
    const id = await seed(0);
    await privateNote(id);
    const other = await learner(otherRegion);
    const foreign = await seed(0, ['dayan_chu'], other);
    await privateNote(foreign, 'Other region private note');
    await grant('regional_viewer', region);
    let result = await adminQuery<{ data: Feed }>('SELECT admin.practice_journal(NULL,1,$1) data', [
      'en'
    ]);
    expect(result.rows[0]!.data.total).toBe(1);
    await expect(
      adminQuery('SELECT admin.practice_journal($1,1,$2)', [other.person, 'en'])
    ).rejects.toThrow('learner unavailable');
    for (const code of ['coach_admin', 'master_admin', 'super_admin']) {
      await grant(code);
      result = await adminQuery('SELECT admin.practice_journal(NULL,1,$1) data', ['en']);
      expect(result.rows[0]!.data.total).toBe(2);
    }
    await grant('regional_admin', region);
    await expect(adminQuery('SELECT admin.practice_journal(NULL,1,$1)', ['en'])).rejects.toThrow(
      'journal access denied'
    );
    await grant('global_viewer');
    await expect(adminQuery('SELECT admin.practice_journal(NULL,1,$1)', ['en'])).rejects.toThrow(
      'journal access denied'
    );
  });
  it('issues hashed expiring credentials only to super admins and rejects revoked or expired callers', async () => {
    await grant('master_admin');
    await expect(issue()).rejects.toThrow('journal client management denied');
    await grant('super_admin');
    const client = await issue();
    expect(
      (
        await pool.query('SELECT token_hash FROM platform.journal_api_clients WHERE id=$1', [
          client.id
        ])
      ).rows[0]!.token_hash
    ).not.toEqual(Buffer.from(client.secret));
    await adminQuery('SELECT admin.revoke_journal_client($1,$2)', [
      client.id,
      'Integration withdrawn'
    ]);
    await expect(feed(client.secret)).rejects.toThrow('journal client unauthorized');
    const expired = await issue();
    await pool.query(
      "UPDATE platform.journal_api_clients SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE id=$1",
      [expired.id]
    );
    await expect(feed(expired.secret)).rejects.toThrow('journal client unauthorized');
  });
  it('enforces per-client request limits, validates pagination and audits reads without content', async () => {
    await grant('super_admin');
    const client = await issue();
    for (let i = 0; i < 60; i++) await feed(client.secret);
    await expect(feed(client.secret)).rejects.toThrow('journal rate limited');
    expect(
      (
        await pool.query(
          "SELECT count(*)::int count FROM audit.events WHERE action='journal.external_read'"
        )
      ).rows[0]!.count
    ).toBe(60);
    await pool.query(
      "UPDATE platform.journal_api_clients SET rate_window=CURRENT_TIMESTAMP-INTERVAL '2 minutes' WHERE id=$1",
      [client.id]
    );
    expect((await feed(client.secret)).total).toBe(0);
    await expect(query('SELECT platform.journal_feed($1,$2,0)', [token, 'en'])).rejects.toThrow(
      'invalid journal query'
    );
  });
  it('rejects publishing content changed after preview, but always allows withdrawal', async () => {
    const id = await seed(0);
    await privateNote(id);
    const hash = (
      await pool.query<{ hash: string }>(
        "SELECT encode(public.digest(platform.journal_source($1)::text,'sha256'),'hex') hash",
        [id]
      )
    ).rows[0]!.hash;
    await pool.query('UPDATE core.checkin_notes SET practice_note=$2 WHERE checkin_id=$1', [
      id,
      'New unseen text'
    ]);
    await expect(
      query('SELECT platform.journal_publish($1,$2,0,TRUE,TRUE,FALSE,FALSE,$3,$4)', [
        token,
        id,
        'Alias',
        hash
      ])
    ).rejects.toThrow('journal source conflict');
    expect((await feed()).total).toBe(0);
    await publish(id);
    await query('SELECT platform.journal_publish($1,$2,1,FALSE,TRUE,FALSE,FALSE,$3,$4)', [
      token,
      id,
      'Alias',
      hash
    ]);
    expect((await feed()).total).toBe(0);
  });
  it('rechecks expired capabilities after waiting for the person lock', async () => {
    const id = await seed(0);
    await privateNote(id);
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM identity.people WHERE id=$1 FOR UPDATE', [person]);
    await pool.query(
      "UPDATE platform.telegram_checkin_links SET expires_at=clock_timestamp()+INTERVAL '100 milliseconds' WHERE token_hash=public.digest($1,'sha256')",
      [token]
    );
    const pending = publish(id);
    const outcome = expect(pending).rejects.toThrow('practice identity unavailable');
    await new Promise((r) => setTimeout(r, 150));
    await blocker.query('COMMIT');
    blocker.release();
    await outcome;
    expect(
      (await pool.query('SELECT count(*)::int n FROM core.journal_publications')).rows[0]!.n
    ).toBe(0);
  });
});
