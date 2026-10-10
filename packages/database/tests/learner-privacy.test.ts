import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Learner consent and scoped suspension', () => {
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
    if (
      (await pool.query("SELECT 1 FROM platform.learner_privacy_policies WHERE state='active'"))
        .rowCount
    )
      await accept('telegram', subject);
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

  const policy = async () => {
    const notice = (
      await query<{ data: { version: string; hash: string } }>(
        'SELECT platform.privacy_notice() data'
      )
    ).rows[0]!.data;
    await pool.query(
      "UPDATE platform.learner_privacy_policies SET state='active' WHERE version=$1",
      [notice.version]
    );
    return notice;
  };
  const subject = async () =>
    (
      await pool.query<{ subject: string }>(
        'SELECT external_subject_id subject FROM identity.platform_identities WHERE id=$1',
        [identity]
      )
    ).rows[0]!.subject;
  const accept = async (platform = 'telegram', external?: string, reflections = true) => {
    const p = await policy(),
      secret = randomBytes(32).toString('base64url'),
      s = external ?? (await subject());
    await query('SELECT platform.begin_privacy_gate($1,$2,$3)', [platform, s, secret]);
    await query('SELECT platform.accept_privacy($1,$2,$3,$4,$5,TRUE,$6)', [
      platform,
      secret,
      p.version,
      p.hash,
      'en',
      reflections
    ]);
    return { secret, ...p };
  };
  const adminQuery = <Row extends pg.QueryResultRow>(sql: string, values: unknown[] = []) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: principal },
      (c) => c.query<Row>(sql, values)
    );
  const grant = async (code = 'super_admin', scope: string | null = null) => {
    await pool.query('DELETE FROM admin.role_grants WHERE principal_id=$1', [principal]);
    await pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,reason) SELECT $1,id,$2,$3,'Consent fixture' FROM admin.roles WHERE code=$4",
      [principal, scope ? 'region' : 'global', scope, code]
    );
  };
  it('starts draft, without acceptance or publications or direct runtime access', async () => {
    expect(
      (await query<{ data: { active: boolean } }>('SELECT platform.privacy_notice() data')).rows[0]!
        .data.active
    ).toBe(false);
    expect(
      (await pool.query<{ count: string }>('SELECT count(*) FROM core.journal_publications'))
        .rows[0]!.count
    ).toBe('0');
    for (const table of [
      'learner_privacy_policies',
      'learner_privacy_sessions',
      'learner_privacy_acceptances',
      'learner_access_states'
    ])
      await expect(query('SELECT * FROM platform.' + table)).rejects.toThrow('permission denied');
    await expect(
      query('SELECT platform._pre_privacy_telegram_checkin_person($1)', [token])
    ).rejects.toThrow('permission denied');
  });
  it('blocks existing credentials and binds explicit acceptance to provider, version and document hash', async () => {
    await policy();
    await expect(
      query(
        'SELECT identity.submit_application($1,$2,$3,$4)',
        ['telegram', await subject(), 'Worker attempt', region],
        true
      )
    ).rejects.toThrow('privacy acceptance required');
    await expect(query('SELECT platform.telegram_checkin_history($1)', [token])).rejects.toThrow(
      'privacy acceptance required'
    );
    const p = await accept();
    expect((await query('SELECT platform.telegram_checkin_history($1)', [token])).rowCount).toBe(1);
    await expect(
      query('SELECT platform.accept_privacy($1,$2,$3,$4,$5,TRUE,TRUE)', [
        'line',
        p.secret,
        p.version,
        p.hash,
        'en'
      ])
    ).rejects.toThrow('privacy session unavailable');
    await expect(
      query('SELECT platform.accept_privacy($1,$2,$3,$4,$5,FALSE,TRUE)', [
        'telegram',
        p.secret,
        p.version,
        p.hash,
        'en'
      ])
    ).rejects.toThrow('invalid privacy acceptance');
    await expect(
      query('SELECT platform.accept_privacy($1,$2,$3,$4,$5,TRUE,TRUE)', [
        'telegram',
        p.secret,
        p.version,
        '0'.repeat(64),
        'en'
      ])
    ).rejects.toThrow('privacy policy conflict');
  });
  it.each(['line', 'whatsapp'] as const)(
    'requires %s consent independently before onboarding or reading',
    async (provider) => {
      const external = provider === 'line' ? 'U' + 'a'.repeat(32) : '886912345678';
      await policy();
      const s = randomBytes(32).toString('base64url');
      await expect(
        query(
          provider === 'line'
            ? 'SELECT platform.begin_line_link($1,$2)'
            : "SELECT platform.begin_whatsapp_link($1,$2,'apply')",
          [external, s]
        )
      ).rejects.toThrow('privacy acceptance required');
      await accept(provider, external);
      expect(
        (
          await query(
            provider === 'line'
              ? 'SELECT platform.begin_line_link($1,$2)'
              : "SELECT platform.begin_whatsapp_link($1,$2,'apply')",
            [external, s]
          )
        ).rowCount
      ).toBe(1);
    }
  );
  it('does not publish old private corrections, but defaults new practice-only entries to sharing', async () => {
    const old = await seed(-1);
    await accept();
    await pool.query(
      "INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) VALUES($1,$2,'Old private')",
      [old, person]
    );
    expect(
      (await pool.query<{ count: string }>('SELECT count(*) FROM core.journal_publications'))
        .rows[0]!.count
    ).toBe('0');
    const current = await seed(0);
    expect(
      (
        await pool.query(
          'SELECT active,external_enabled,shared_with_staff,note_snapshot FROM core.journal_publications WHERE checkin_id=$1',
          [current]
        )
      ).rows[0]
    ).toMatchObject({
      active: true,
      external_enabled: false,
      shared_with_staff: true,
      note_snapshot: ''
    });
  });
  it('requires optional reflection consent before saving notes without preventing practice-only use', async () => {
    await accept('telegram', undefined, false);
    const id = await seed(0);
    await expect(
      query('SELECT platform.save_practice_note($1,$2,$3,$4,$5)', [
        'telegram',
        token,
        id,
        'Health-related reflection',
        []
      ])
    ).rejects.toThrow('reflection consent required');
    await accept();
    await query('SELECT platform.save_practice_note($1,$2,$3,$4,$5)', [
      'telegram',
      token,
      id,
      'Consented reflection',
      []
    ]);
    expect(
      (
        await pool.query<{ note_snapshot: string }>(
          'SELECT note_snapshot FROM core.journal_publications WHERE checkin_id=$1',
          [id]
        )
      ).rows[0]!.note_snapshot
    ).toBe('Consented reflection');
    const v = (
      await pool.query<{ revision: number }>(
        'SELECT revision FROM core.journal_publications WHERE checkin_id=$1',
        [id]
      )
    ).rows[0]!.revision;
    await query('SELECT platform.journal_publish($1,$2,$3,FALSE,TRUE,FALSE,FALSE,$4,$5)', [
      token,
      id,
      v,
      'Alias',
      '0'.repeat(64)
    ]);
    await query('SELECT platform.save_practice_note($1,$2,$3,$4,$5)', [
      'telegram',
      token,
      id,
      'Edited withdrawn reflection',
      []
    ]);
    expect(
      (
        await pool.query<{ active: boolean }>(
          'SELECT active FROM core.journal_publications WHERE checkin_id=$1',
          [id]
        )
      ).rows[0]!.active
    ).toBe(false);
  });
  it('stops reflection sharing on consent withdrawal and requires fresh external opt-in after corrections', async () => {
    await accept();
    const id = await seed(0);
    await query('SELECT platform.save_practice_note($1,$2,$3,$4,$5)', [
      'telegram',
      token,
      id,
      'Original reflection',
      []
    ]);
    const row = (
      await pool.query<{ revision: number; hash: string }>(
        "SELECT p.revision,encode(public.digest(platform.journal_source($1)::text,'sha256'),'hex') hash FROM core.journal_publications p WHERE checkin_id=$1",
        [id]
      )
    ).rows[0]!;
    await query('SELECT platform.journal_publish($1,$2,$3,TRUE,TRUE,FALSE,TRUE,$4,$5)', [
      token,
      id,
      row.revision,
      'Alias',
      row.hash
    ]);
    expect(
      (
        await pool.query<{ external_enabled: boolean }>(
          'SELECT external_enabled FROM core.journal_publications WHERE checkin_id=$1',
          [id]
        )
      ).rows[0]!.external_enabled
    ).toBe(true);
    await query('SELECT platform.save_practice_note($1,$2,$3,$4,$5)', [
      'telegram',
      token,
      id,
      'Corrected reflection',
      []
    ]);
    expect(
      (
        await pool.query<{ external_enabled: boolean }>(
          'SELECT external_enabled FROM core.journal_publications WHERE checkin_id=$1',
          [id]
        )
      ).rows[0]!.external_enabled
    ).toBe(false);
    await accept('telegram', undefined, false);
    expect(
      (
        await pool.query<{ note_snapshot: string }>(
          'SELECT note_snapshot FROM core.journal_publications WHERE checkin_id=$1',
          [id]
        )
      ).rows[0]!.note_snapshot
    ).toBe('');
    expect(
      (
        await pool.query<{ practice_note: string }>(
          'SELECT practice_note FROM core.checkin_notes WHERE checkin_id=$1',
          [id]
        )
      ).rows[0]!.practice_note
    ).toBe('Corrected reflection');
  });
  it('suspends only scoped learners, preserves independent accounts and requires versions', async () => {
    await accept();
    const current = await seed(0);
    await grant('regional_admin', region);
    const outside = await learner(otherRegion);
    await expect(
      adminQuery('SELECT admin.suspend_learner($1,1,$2)', [outside.person, 'Withdrawn'])
    ).rejects.toThrow('learner unavailable');
    await expect(
      adminQuery('SELECT admin.suspend_learner($1,9,$2)', [person, 'Withdrawn'])
    ).rejects.toThrow('learner access conflict');
    const result = await adminQuery<{ data: { status: string; version: number } }>(
      'SELECT admin.suspend_learner($1,1,$2) data',
      [person, 'Course withdrawn']
    );
    expect(result.rows[0]!.data).toEqual({ version: 2, status: 'suspended' });
    expect(
      (
        await pool.query<{ status: string }>('SELECT status FROM identity.people WHERE id=$1', [
          outside.person
        ])
      ).rows[0]!.status
    ).toBe('active');
    expect((await pool.query('SELECT id FROM core.checkins WHERE id=$1', [current])).rowCount).toBe(
      1
    );
    await expect(
      query('SELECT platform.telegram_workspace_report($1,$2,$3)', [token, 'profile', 'en'])
    ).rejects.toThrow();
  });
  it('rechecks regional grant expiry after waiting for the authorization lock', async () => {
    await grant('regional_admin', region);
    const hold = await pool.connect();
    await hold.query('BEGIN');
    await hold.query('SELECT pg_advisory_xact_lock(1919,1)');
    const pending = adminQuery('SELECT admin.suspend_learner($1,1,$2)', [
      person,
      'Queued suspension'
    ]).then(
      () => true,
      () => false
    );
    let queued = false;
    for (let i = 0; i < 80; i++) {
      const q = await pool.query<{ n: string }>(
        "SELECT count(*) n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock' AND query LIKE '%admin.suspend_learner%'",
        [role]
      );
      if (Number(q.rows[0]!.n) > 0) {
        queued = true;
        break;
      }
      await delay(10);
    }
    await pool.query(
      "UPDATE admin.role_grants SET valid_to=clock_timestamp()+INTERVAL '100 milliseconds' WHERE principal_id=$1",
      [principal]
    );
    await delay(200);
    await hold.query('COMMIT');
    hold.release();
    expect(queued).toBe(true);
    expect(await pending).toBe(false);
    expect(
      (
        await pool.query<{ status: string }>('SELECT status FROM identity.people WHERE id=$1', [
          person
        ])
      ).rows[0]!.status
    ).toBe('active');
  });
  it('hides retired shares from learners but retains authorized staff history without exposing old private entries', async () => {
    const old = await seed(-1);
    await pool.query(
      "INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) VALUES($1,$2,'Older private reflection')",
      [old, person]
    );
    await accept();
    const id = await seed(0);
    await query('SELECT platform.save_practice_note($1,$2,$3,$4,$5)', [
      'telegram',
      token,
      id,
      'Shared reflection',
      []
    ]);
    const other = await learner(otherRegion);
    await grant('regional_admin', region);
    await adminQuery('SELECT admin.suspend_learner($1,1,$2)', [person, 'Course paused']);
    expect(
      (
        await query<{ data: { total: number } }>('SELECT platform.journal_feed($1,$2,1) data', [
          other.token,
          'en'
        ])
      ).rows[0]!.data.total
    ).toBe(0);
    await grant('global_viewer');
    const staff = (
      await adminQuery<{ data: { total: number; entries: unknown[] } }>(
        'SELECT admin.shared_journal($1,1) data',
        ['en']
      )
    ).rows[0]!.data;
    expect(staff.total).toBe(1);
    expect(JSON.stringify(staff)).toContain('Shared reflection');
    expect(JSON.stringify(staff)).not.toContain('Older private reflection');
    await expect(adminQuery("SELECT admin.practice_journal(NULL,1,'en')")).rejects.toThrow(
      'journal access denied'
    );
    await grant('regional_viewer', region);
    expect(
      (
        await adminQuery<{ data: { total: number } }>(
          "SELECT admin.practice_journal(NULL,1,'en') data"
        )
      ).rows[0]!.data.total
    ).toBe(2);
    await grant('regional_viewer', otherRegion);
    expect(
      (
        await adminQuery<{ data: { total: number } }>(
          "SELECT admin.practice_journal(NULL,1,'en') data"
        )
      ).rows[0]!.data.total
    ).toBe(0);
  });
  it('only lets a super admin explicitly publish the exact draft policy with a reason', async () => {
    const p = (
      await query<{ data: { version: string; hash: string } }>(
        'SELECT platform.privacy_notice() data'
      )
    ).rows[0]!.data;
    await grant('coach_admin');
    await expect(
      adminQuery('SELECT admin.publish_privacy_policy($1,$2,$3)', [p.version, p.hash, 'Reviewed'])
    ).rejects.toThrow('privacy publication denied');
    await grant();
    await adminQuery('SELECT admin.publish_privacy_policy($1,$2,$3)', [
      p.version,
      p.hash,
      'Operator reviewed'
    ]);
    expect(
      (await query<{ data: { active: boolean } }>('SELECT platform.privacy_notice() data')).rows[0]!
        .data.active
    ).toBe(true);
  });
});
