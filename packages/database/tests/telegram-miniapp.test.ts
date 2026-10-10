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
suite('Telegram Mini App independent capabilities', () => {
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

  const subject = async () =>
    (
      await pool.query<{ id: string }>(
        'SELECT external_subject_id id FROM identity.platform_identities WHERE id=$1',
        [identity]
      )
    ).rows[0]!.id;
  it('keeps existing tokens and creates independent sessions without replacing older links', async () => {
    const s = await subject(),
      next = randomBytes(32).toString('base64url');
    expect(
      (
        await query<{ state: string }>(
          'SELECT platform.begin_telegram_miniapp_session($1,$2) state',
          [s, next]
        )
      ).rows[0]!.state
    ).toBe('ready');
    for (const t of [token, next])
      expect(
        (await query('SELECT platform.telegram_workspace_report($1,$2,$3)', [t, 'profile', 'en']))
          .rowCount
      ).toBe(1);
    expect(
      (
        await pool.query(
          'SELECT 1 FROM platform.telegram_checkin_links WHERE telegram_user_id=$1',
          [s]
        )
      ).rowCount
    ).toBe(2);
  });
  it('refuses unavailable learners and caps exchanges without granting table access', async () => {
    expect(
      (
        await query<{ state: string }>(
          'SELECT platform.begin_telegram_miniapp_session($1,$2) state',
          ['987654321', randomBytes(32).toString('base64url')]
        )
      ).rows[0]!.state
    ).toBe('unavailable');
    const s = await subject();
    for (let i = 0; i < 12; i++)
      await query('SELECT platform.begin_telegram_miniapp_session($1,$2)', [
        s,
        randomBytes(32).toString('base64url')
      ]);
    await expect(
      query('SELECT platform.begin_telegram_miniapp_session($1,$2)', [
        s,
        randomBytes(32).toString('base64url')
      ])
    ).rejects.toThrow('rate limited');
    await expect(query('SELECT * FROM platform.telegram_miniapp_exchange_limits')).rejects.toThrow(
      'permission denied'
    );
  });
  it('retains own-only history and region scope across independent launches', async () => {
    await seed(0);
    const outside = await learner(otherRegion);
    await seed(0, ['dayan_chu'], outside);
    const fresh = randomBytes(32).toString('base64url');
    await query('SELECT platform.begin_telegram_miniapp_session($1,$2)', [await subject(), fresh]);
    const profile = (
      await query<{ data: { entries: unknown[] } }>(
        "SELECT platform.telegram_workspace_report($1,'profile','en') data",
        [fresh]
      )
    ).rows[0]!.data;
    expect(profile.entries).toHaveLength(1);
    const rank = (
      await query<{ data: { rows: unknown[] } }>(
        "SELECT platform.telegram_workspace_report($1,'leaderboard','en') data",
        [fresh]
      )
    ).rows[0]!.data;
    expect(rank.rows).toHaveLength(1);
  });
  it('still rejects expired capabilities and suspended identities', async () => {
    await pool.query(
      "UPDATE platform.telegram_checkin_links SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE token_hash=public.digest($1,'sha256')",
      [token]
    );
    await expect(
      query('SELECT platform.telegram_workspace_report($1,$2,$3)', [token, 'profile', 'en'])
    ).rejects.toThrow();
    await pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
      [person]
    );
    await pool.query("UPDATE identity.people SET status='suspended' WHERE id=$1", [person]);
    expect(
      (
        await query<{ ready: boolean }>('SELECT platform.telegram_workspace_ready($1) ready', [
          await subject()
        ])
      ).rows[0]!.ready
    ).toBe(false);
  });
});
