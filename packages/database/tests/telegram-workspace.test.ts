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
interface Entry {
  id: string;
  date: string;
  version: number;
  practiceNote: string;
  methods: { code: string; name: string }[];
}
interface Profile {
  today: string;
  timezone: string;
  confirmed: boolean;
  makeupOpen: boolean;
  totalDays: number;
  currentStreak: number;
  longestStreak: number;
  entries: Entry[];
}
interface Badge {
  code: string;
  configured: boolean;
  awards: { period: string; revoked: boolean }[];
}
interface Receipt {
  id: string;
  lease_id: string;
  recipient: string;
  payload: Record<string, unknown>;
}
suite('Telegram learner workspace, private summaries and reconciled achievements', () => {
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
  const report = async <Data>(
    view = 'profile',
    auth = token,
    period = 'month',
    days = 30,
    month: string | null = null
  ) =>
    (
      await query<{ data: Data }>(
        'SELECT platform.telegram_workspace_report($1,$2,$3,$4,$5,$6) data',
        [auth, view, 'en', period, days, month]
      )
    ).rows[0]!.data;
  const confirm = (zone = 'UTC') =>
    query('SELECT platform.telegram_workspace_timezone($1,$2)', [token, zone]);
  const save = async (
    date: string,
    version = 0,
    methods = ['dayan_chu'],
    request = randomUUID(),
    note: string | null = null,
    tags: string[] | null = null
  ) =>
    (
      await query<{ data: { checkinId: string; version: number; action: string } }>(
        'SELECT platform.telegram_workspace_save($1,$2,$3,$4,$5,$6,$7) data',
        [token, request, date, version, methods, note, tags]
      )
    ).rows[0]!.data;
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
    await runMigrations(pool, directory, 'workspace-test');
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
  it('requires timezone confirmation and fails closed for invalid credentials and internal helpers', async () => {
    const profile = await report<Profile>();
    expect(profile.confirmed).toBe(false);
    await expect(save(profile.today)).rejects.toThrow('workspace timezone unconfirmed');
    await expect(report('profile', randomBytes(32).toString('base64url'))).rejects.toThrow(
      'practice identity unavailable'
    );
    await expect(
      query('SELECT platform.telegram_workspace_entries($1,CURRENT_DATE-5,CURRENT_DATE+1,$2)', [
        person,
        'en'
      ])
    ).rejects.toThrow('permission denied');
    await expect(query('SELECT core.evaluate_practice_badges($1)', [person])).rejects.toThrow(
      'permission denied'
    );
    await expect(query('SELECT * FROM ops.telegram_practice_receipts')).rejects.toThrow(
      'permission denied'
    );
    await expect(query('SELECT * FROM core.person_practice_badges')).rejects.toThrow(
      'permission denied'
    );
    await expect(confirm('not/a/timezone')).rejects.toThrow('invalid workspace timezone');
    await confirm();
    expect((await report<Profile>()).confirmed).toBe(true);
  });
  it('saves once, keeps a usable workspace token, and returns the committed result on duplicate retries', async () => {
    await confirm();
    const { today } = await report<Profile>();
    const request = randomUUID();
    const first = await save(today, 0, ['dayan_chu'], request, 'Private note not for chat');
    expect(await save(today, 0, ['dayan_chu'], request, 'Private note not for chat')).toEqual(
      first
    );
    await expect(
      save(today, 0, ['dayan_gao'], request, 'Private note not for chat')
    ).rejects.toThrow('workspace request conflict');
    const profile = await report<Profile>();
    expect(profile.totalDays).toBe(1);
    expect(profile.entries[0]!.practiceNote).toBe('Private note not for chat');
    const receipts = (
      await pool.query<{ payload: Record<string, unknown>; recipient: string }>(
        'SELECT payload,recipient FROM ops.telegram_practice_receipts'
      )
    ).rows;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.recipient).toBe('200001');
    expect(JSON.stringify(receipts)).not.toContain('Private note');
    expect(JSON.stringify(receipts)).not.toMatch(/feeling|@|phone|token/i);
    expect(receipts[0]!.payload.methods).toEqual(['大雁初']);
  });
  it('rejects stale corrections and rolls back the complete mutation when private input is invalid', async () => {
    await confirm();
    const { today } = await report<Profile>();
    const first = await save(today);
    await expect(
      save(today, first.version, ['dayan_gao'], randomUUID(), 'a'.repeat(1001))
    ).rejects.toThrow('invalid practice note');
    expect((await report<Profile>()).entries[0]!.version).toBe(first.version);
    const second = await save(today, first.version, ['dayan_gao']);
    expect(second.action).toBe('corrected');
    await expect(save(today, first.version, ['dayan_chu'])).rejects.toThrow(
      'workspace version conflict'
    );
    expect((await pool.query('SELECT * FROM ops.telegram_practice_receipts')).rowCount).toBe(2);
    expect((await report<Profile>()).entries[0]!.methods.map((m) => m.code)).toEqual(['dayan_gao']);
  });
  it('serializes concurrent writes with one winner and no duplicate summary', async () => {
    await confirm();
    const { today } = await report<Profile>();
    const results = await Promise.allSettled([save(today), save(today)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await pool.query('SELECT * FROM ops.telegram_practice_receipts')).rowCount).toBe(1);
  });
  it('preserves omitted notes and selected tag snapshots through correction', async () => {
    await confirm();
    const tag = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.practice_feeling_tags(name_zh_tw,name_en,sort_order) VALUES('放鬆','Relaxed',1) RETURNING id"
      )
    ).rows[0]!.id;
    const { today } = await report<Profile>();
    const first = await save(today, 0, ['dayan_chu'], randomUUID(), 'Handwritten 放鬆', [tag]);
    await pool.query(
      "UPDATE core.practice_feeling_tags SET name_en='Changed',active=false WHERE id=$1",
      [tag]
    );
    await save(today, first.version, ['dayan_gao']);
    const profile = await report<Profile>();
    expect(profile.entries[0]!.practiceNote).toBe('Handwritten 放鬆');
    expect(JSON.stringify(profile.entries[0])).toContain('Relaxed');
    expect(JSON.stringify(profile.entries[0])).not.toContain('Changed');
  });
  it('uses bounded monthly own-history and unique person-days for method mix', async () => {
    await seed(-2, ['dayan_chu', 'dayan_gao']);
    await seed(-40, ['huanghai']);
    const another = await learner();
    const otherCheckin = await seed(-1, ['lotus'], another);
    await pool.query(
      "INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) VALUES($1,$2,'Another private journal')",
      [otherCheckin, another.person]
    );
    const mix30 = await report<{ mix: { code: string; days: number }[] }>('methods');
    expect(mix30.mix).toEqual([{ code: 'dayan', name: 'Dayan Qigong', days: 1 }]);
    const mix90 = await report<{ mix: { code: string; days: number }[] }>(
      'methods',
      token,
      'month',
      90
    );
    expect(mix90.mix).toHaveLength(2);
    expect(JSON.stringify(mix90)).not.toContain('Another private');
    const profile = await report<Profile>();
    const history = await report<{ entries: Entry[] }>(
      'history',
      token,
      'month',
      30,
      profile.today.slice(0, 7) + '-01'
    );
    expect(history.entries.every((entry) => entry.id !== otherCheckin)).toBe(true);
    await expect(report('methods', token, 'month', 365)).rejects.toThrow('invalid workspace query');
    await expect(report('history', token, 'month', 30, '2200-01-01')).rejects.toThrow(
      'invalid workspace query'
    );
  });
  it('masks the same-region leaderboard and excludes other-region and revoked accounts', async () => {
    await seed(-1);
    const other = await learner();
    await seed(-1, ['dayan_chu'], other);
    const outside = await learner(otherRegion);
    await seed(-1, ['dayan_chu'], outside);
    const revoked = await learner();
    await seed(-1, ['dayan_chu'], revoked);
    await pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=CURRENT_TIMESTAMP WHERE platform_identity_id=$1 AND valid_to IS NULL',
      [revoked.identity]
    );
    await pool.query(
      'UPDATE identity.platform_identities SET revoked_at=CURRENT_TIMESTAMP WHERE id=$1',
      [revoked.identity]
    );
    const data = await report<{
      rows: { rank: number; self: boolean; label: string }[];
      ownRank: number;
    }>('leaderboard', token, 'all');
    expect(data.rows).toHaveLength(2);
    expect(data.ownRank).toBe(1);
    expect(data.rows.every((r) => r.rank === 1)).toBe(true);
    expect(data.rows.find((r) => r.self)?.label).toBe('You');
    expect(JSON.stringify(data)).not.toMatch(/Secret|private@|20000|phone|person_id/i);
    for (const period of ['week', 'month', 'quarter', 'year', 'all'])
      await report('leaderboard', token, period);
    await expect(report('leaderboard', token, 'forever')).rejects.toThrow(
      'invalid workspace query'
    );
  });
  it('awards streak, cumulative, method, time and yearly combo badges idempotently', async () => {
    for (let offset = -9; offset <= 0; offset++) await seed(offset, ['dayan_chu', 'dayan_gao']);
    const first = await report<Profile & { badges: Badge[] }>('achievements');
    expect(first.totalDays).toBe(10);
    expect(first.currentStreak).toBe(10);
    expect(first.longestStreak).toBe(10);
    for (const code of [
      'streak_3',
      'streak_7',
      'total_10',
      'method_dayan_7',
      'time_morning',
      'combo_dayan_7'
    ]) {
      expect(first.badges.find((b) => b.code === code)?.awards.some((a) => !a.revoked)).toBe(true);
    }
    expect(first.badges.find((b) => b.code === 'seasonal_winter')?.configured).toBe(false);
    const audit = (await pool.query('SELECT * FROM audit.practice_badge_changes')).rowCount;
    await report('achievements');
    expect((await pool.query('SELECT * FROM audit.practice_badge_changes')).rowCount).toBe(audit);
    expect(first.badges).toHaveLength(49);
  });
  it('never treats makeup submission timestamps as qualifying morning or night practice', async () => {
    for (let offset = -4; offset <= 0; offset++)
      await seed(offset, ['dayan_chu'], undefined, 'makeup', 6);
    const data = await report<{ badges: Badge[] }>('achievements');
    expect(data.badges.find((b) => b.code === 'time_morning')?.awards).toEqual([]);
    expect(data.badges.find((b) => b.code === 'streak_3')?.awards).toHaveLength(1);
  });
  it('reconciles corrected qualifications, retaining award history and recording restoration', async () => {
    const id = await seed(0, ['dayan_chu', 'dayan_gao']);
    await report('achievements');
    await pool.query(
      "DELETE FROM core.checkin_method_selections WHERE checkin_id=$1 AND practice_method_id=(SELECT id FROM core.practice_methods WHERE code='dayan_gao')",
      [id]
    );
    await query('SELECT ops.reconcile_practice_badges(20)', [], true);
    const revoked = await report<{ badges: Badge[] }>('achievements');
    expect(revoked.badges.find((b) => b.code === 'combo_dayan_7')?.awards[0]?.revoked).toBe(true);
    await pool.query(
      "INSERT INTO core.checkin_method_selections(checkin_id,practice_method_id) SELECT $1,id FROM core.practice_methods WHERE code='dayan_gao'",
      [id]
    );
    await query('SELECT ops.reconcile_practice_badges(20)', [], true);
    expect(
      (await report<{ badges: Badge[] }>('achievements')).badges.find(
        (b) => b.code === 'combo_dayan_7'
      )?.awards[0]?.revoked
    ).toBe(false);
    expect(
      (
        await pool.query<{ action: string }>(
          "SELECT action FROM audit.practice_badge_changes WHERE badge_code='combo_dayan_7' ORDER BY created_at,id"
        )
      ).rows.map((r) => r.action)
    ).toEqual(['earned', 'revoked', 'restored']);
  });
  it('uses only explicitly configured seasons and structured Guishou selections across a year boundary', async () => {
    const lastYear = new Date().getUTCFullYear() - 1;
    await pool.query(
      "INSERT INTO core.practice_badge_seasons(kind,year,start_date,end_date,timezone,required_days) VALUES('winter',$1,make_date($1,12,21),make_date($1+1,1,16),'UTC',27)",
      [lastYear]
    );
    for (let index = 0; index < 27; index++) {
      const offset = (
        await pool.query<{ day_offset: number }>(
          'SELECT (make_date($1::integer,12,21)+$2::integer-CURRENT_DATE)::integer AS day_offset',
          [lastYear, index]
        )
      ).rows[0]!.day_offset;
      await seed(offset, ['guishou_bagua']);
    }
    const data = await report<{ badges: Badge[] }>('achievements');
    expect(data.badges.find((b) => b.code === 'seasonal_winter')?.awards).toEqual([
      expect.objectContaining({ period: String(lastYear), revoked: false })
    ]);
  });
  it('leases summaries once, retries with backoff, and rejects stale lease acknowledgements', async () => {
    await confirm();
    await save((await report<Profile>()).today);
    const claim = () =>
      query<Receipt>('SELECT * FROM ops.claim_telegram_practice_receipts(10)', [], true);
    const first = (await claim()).rows[0]!;
    expect((await claim()).rows).toEqual([]);
    expect(
      (
        await query<{ done: boolean }>(
          'SELECT ops.finish_telegram_practice_receipt($1,$2,false) done',
          [first.id, first.lease_id],
          true
        )
      ).rows[0]!.done
    ).toBe(true);
    expect((await claim()).rows).toEqual([]);
    await pool.query(
      "UPDATE ops.telegram_practice_receipts SET available_at=CURRENT_TIMESTAMP-INTERVAL '1 second'"
    );
    const second = (await claim()).rows[0]!;
    expect(second.lease_id).not.toBe(first.lease_id);
    expect(
      (
        await query<{ done: boolean }>(
          'SELECT ops.finish_telegram_practice_receipt($1,$2,true) done',
          [first.id, first.lease_id],
          true
        )
      ).rows[0]!.done
    ).toBe(false);
    expect(
      (
        await query<{ done: boolean }>(
          'SELECT ops.finish_telegram_practice_receipt($1,$2,true) done',
          [second.id, second.lease_id],
          true
        )
      ).rows[0]!.done
    ).toBe(true);
    expect((await claim()).rows).toEqual([]);
  });
  it('cancels queued summaries after access is withdrawn and recovers an exhausted crashed lease', async () => {
    await confirm();
    await save((await report<Profile>()).today);
    await pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=CURRENT_TIMESTAMP WHERE platform_identity_id=$1 AND valid_to IS NULL',
      [identity]
    );
    await pool.query(
      'UPDATE identity.platform_identities SET revoked_at=CURRENT_TIMESTAMP WHERE id=$1',
      [identity]
    );
    expect(
      (await query('SELECT * FROM ops.claim_telegram_practice_receipts(10)', [], true)).rows
    ).toEqual([]);
    expect(
      (await pool.query<{ status: string }>('SELECT status FROM ops.telegram_practice_receipts'))
        .rows[0]!.status
    ).toBe('cancelled');
    await pool.query('UPDATE identity.platform_identities SET revoked_at=NULL WHERE id=$1', [
      identity
    ]);
    await pool.query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
      [person, identity]
    );
    await pool.query(
      "UPDATE ops.telegram_practice_receipts SET status='sending',attempts=8,lease_id=gen_random_uuid(),leased_until=CURRENT_TIMESTAMP-INTERVAL '1 second'"
    );
    await query('SELECT * FROM ops.claim_telegram_practice_receipts(10)', [], true);
    expect(
      (await pool.query<{ status: string }>('SELECT status FROM ops.telegram_practice_receipts'))
        .rows[0]!.status
    ).toBe('failed');
  });
  it('rechecks real token expiry after waiting for the person lock', async () => {
    const blocker = await pool.connect();
    let committed = false;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT 1 FROM identity.people WHERE id=$1 FOR UPDATE', [person]);
      const waiting = confirm().then(
        () => ({ error: null }),
        (error) => ({ error: error instanceof Error ? error.message : 'unknown' })
      );
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        blocked = Boolean(
          (
            await pool.query(
              "SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock' AND query LIKE 'SELECT platform.telegram_workspace_timezone%'",
              [role]
            )
          ).rowCount
        );
        if (blocked) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      await pool.query(
        "UPDATE platform.telegram_checkin_links SET expires_at=clock_timestamp()-INTERVAL '1 millisecond' WHERE token_hash=public.digest($1,'sha256')",
        [token]
      );
      await blocker.query('COMMIT');
      committed = true;
      expect((await waiting).error).toBe('practice identity unavailable');
      expect(
        (
          await pool.query(
            'SELECT * FROM platform.telegram_workspace_preferences WHERE person_id=$1',
            [person]
          )
        ).rowCount
      ).toBe(0);
    } finally {
      if (!committed) await blocker.query('ROLLBACK');
      blocker.release();
    }
  });
  it('does not rewrite historical practice dates or zones when confirming or changing a timezone', async () => {
    await seed(-1);
    const before = (await pool.query('SELECT practice_date,practice_timezone FROM core.checkins'))
      .rows;
    await confirm();
    await confirm('Etc/UTC');
    await expect(confirm('UTC')).rejects.toThrow('workspace timezone cooldown');
    expect(
      (await pool.query('SELECT practice_date,practice_timezone FROM core.checkins')).rows
    ).toEqual(before);
  });
});
