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
suite('LINE full learner workspace and private summary', () => {
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
    const subject = 'U' + (++sequence).toString(16).padStart(32, '0');
    const target = (
      await pool.query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES($1,'UTC') RETURNING id",
        [name]
      )
    ).rows[0]!.id;
    const ident = (
      await pool.query<{ id: string }>(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'line',$2) RETURNING id",
        [target, subject]
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
      [target, ident]
    );
    await pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('line',$1,$2,$2,'private@example.test','+886912345600',$3,'approved',$4,CURRENT_TIMESTAMP,$5)",
      [subject, name, targetRegion, target, principal]
    );
    const assign = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-500) RETURNING id",
        [target, targetRegion]
      )
    ).rows[0]!.id;
    const credential = subject;
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

  const report = async (view = 'profile', credential = token) =>
    (
      await query<{ data: Record<string, unknown> }>(
        'SELECT platform.channel_workspace_report($1,$2,$3,$4,$5,$6,$7) data',
        [
          'line',
          credential,
          view,
          'zh_TW',
          'month',
          30,
          new Date().toISOString().slice(0, 7) + '-01'
        ]
      )
    ).rows[0]!.data;
  const save = async (request = randomUUID(), version = 0, note = 'Private test reflection') =>
    (
      await query<{ data: { checkinId: string; version: number; receiptQueued: boolean } }>(
        'SELECT platform.channel_workspace_save($1,$2,$3,$4,$5,$6,$7,$8) data',
        [
          'line',
          token,
          request,
          new Date().toISOString().slice(0, 10),
          version,
          ['dayan_chu'],
          note,
          []
        ]
      )
    ).rows[0]!.data;
  it('provides own metrics, typed methods, achievements, month history and masked region rankings', async () => {
    for (const view of ['profile', 'methods', 'history', 'leaderboard', 'achievements'])
      expect(await report(view)).toBeTruthy();
    expect((await report('achievements')).badges).toHaveLength(49);
    await expect(report('profile', 'U' + 'f'.repeat(32))).rejects.toThrow(
      'practice identity unavailable'
    );
  });
  it('saves atomic practice versions, private notes and one identity-resolved receipt; retries are idempotent', async () => {
    await query('SELECT platform.channel_workspace_timezone($1,$2,$3)', ['line', token, 'UTC']);
    const req = randomUUID(),
      a = await save(req);
    expect(a.receiptQueued).toBe(true);
    expect(await save(req)).toEqual(a);
    await expect(save(randomUUID(), 0)).rejects.toThrow('workspace version conflict');
    const receipts = (
      await pool.query<{ recipient: string; payload: Record<string, unknown> }>(
        'SELECT recipient,payload FROM ops.channel_practice_receipts'
      )
    ).rows;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.recipient).toBe(token);
    expect(JSON.stringify(receipts)).not.toContain('Private test reflection');
    const changed = await save(randomUUID(), a.version, 'Correction');
    expect(changed.version).toBeGreaterThan(a.version);
  });
  it('restricts learner ranking to approved users in the same region', async () => {
    await seed(0);
    const outside = await learner(otherRegion, 'Outside private name');
    await seed(0, ['dayan_chu'], outside);
    const ranking = await report('leaderboard');
    expect(JSON.stringify(ranking)).not.toContain('Outside private name');
    expect(ranking.rows).toHaveLength(1);
  });
  it('requires confirmed timezone and denies direct tables and arbitrary-person helpers', async () => {
    await expect(save()).rejects.toThrow('workspace timezone unconfirmed');
    await expect(query('SELECT * FROM ops.channel_practice_receipts')).rejects.toThrow(
      'permission denied'
    );
    await expect(
      query('SELECT platform.channel_workspace_identity($1,$2,$3)', ['line', token, person])
    ).rejects.toThrow('permission denied');
  });
  it('publishes only owned snapshots, reads global community content and withdraws it', async () => {
    await query('SELECT platform.channel_workspace_timezone($1,$2,$3)', ['line', token, 'UTC']);
    const saved = await save();
    const own = (
      await query<{
        data: { entries: Array<{ checkinId: string; version: number; sourceHash: string }> };
      }>('SELECT platform.channel_journal_own($1,$2,1,$3) data', ['line', token, 'zh_TW'])
    ).rows[0]!.data.entries.find((e) => e.checkinId === saved.checkinId)!;
    await query(
      'SELECT platform.channel_journal_publish($1,$2,$3,$4,TRUE,TRUE,FALSE,FALSE,$5,$6)',
      ['line', token, own.checkinId, own.version, '匿名學員', own.sourceHash]
    );
    expect(
      (
        await query<{ data: { total: number } }>(
          'SELECT platform.community_feed($1,$2,$3,1) data',
          ['line', token, 'zh_TW']
        )
      ).rows[0]!.data.total
    ).toBe(1);
    await query(
      'SELECT platform.channel_journal_publish($1,$2,$3,$4,FALSE,TRUE,FALSE,FALSE,$5,$6)',
      ['line', token, own.checkinId, own.version + 1, '匿名學員', own.sourceHash]
    );
    expect(
      (
        await query<{ data: { total: number } }>(
          'SELECT platform.community_feed($1,$2,$3,1) data',
          ['line', token, 'zh_TW']
        )
      ).rows[0]!.data.total
    ).toBe(0);
  });
  it('supports WhatsApp workspace and refuses summaries after the verified 24-hour window expires', async () => {
    const phone = '886955555555',
      pid = (
        await pool.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('WhatsApp learner','UTC') RETURNING id"
        )
      ).rows[0]!.id;
    const iid = (
      await pool.query<{ id: string }>(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'whatsapp',$2) RETURNING id",
        [pid, phone]
      )
    ).rows[0]!.id;
    await pool.query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
      [pid, iid]
    );
    await pool.query(
      "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-10)",
      [pid, region]
    );
    await pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('whatsapp',$1,'WA learner','WA learner','demo@example.test','+886955555555',$2,'approved',$3,CURRENT_TIMESTAMP,$4)",
      [phone, region, pid, principal]
    );
    const credential = randomBytes(32).toString('base64url');
    await query('SELECT platform.begin_whatsapp_link($1,$2,$3)', [phone, credential, 'checkin']);
    await query('SELECT platform.record_whatsapp_service_window($1,clock_timestamp())', [phone]);
    await query('SELECT platform.channel_workspace_timezone($1,$2,$3)', [
      'whatsapp',
      credential,
      'UTC'
    ]);
    const saved = (
      await query<{ data: { version: number; receiptQueued: boolean } }>(
        'SELECT platform.channel_workspace_save($1,$2,$3,CURRENT_DATE,0,$4,$5,$6) data',
        ['whatsapp', credential, randomUUID(), ['dayan_chu'], 'WA private note', []]
      )
    ).rows[0]!.data;
    expect(saved.receiptQueued).toBe(true);
    expect(
      (
        await query<{ data: { badges: unknown[] } }>(
          'SELECT platform.channel_workspace_report($1,$2,$3,$4) data',
          ['whatsapp', credential, 'achievements', 'en']
        )
      ).rows[0]!.data.badges
    ).toHaveLength(49);
    const receipt = (
      await query<{ id: string; lease_id: string }>(
        'SELECT * FROM ops.claim_channel_practice_receipts($1,3)',
        ['whatsapp'],
        true
      )
    ).rows[0]!;
    await pool.query(
      "UPDATE platform.whatsapp_service_windows SET expires_at=clock_timestamp()-INTERVAL '1 second'"
    );
    expect(
      (
        await query<{ allowed: boolean }>(
          'SELECT ops.channel_practice_receipt_allowed($1,$2) allowed',
          [receipt.id, receipt.lease_id],
          true
        )
      ).rows[0]!.allowed
    ).toBe(false);
    const changed = (
      await query<{ data: { receiptQueued: boolean } }>(
        'SELECT platform.channel_workspace_save($1,$2,$3,CURRENT_DATE,$4,$5,$6,$7) data',
        ['whatsapp', credential, randomUUID(), saved.version, ['dayan_chu'], 'Updated private', []]
      )
    ).rows[0]!.data;
    expect(changed.receiptQueued).toBe(false);
  });
  it('leases retries and suppresses receipts after identity withdrawal', async () => {
    await query('SELECT platform.channel_workspace_timezone($1,$2,$3)', ['line', token, 'UTC']);
    await save();
    const first = (
      await query<{ id: string; lease_id: string }>(
        'SELECT * FROM ops.claim_channel_practice_receipts($1,3)',
        ['line'],
        true
      )
    ).rows[0]!;
    expect(
      (
        await query<{ allowed: boolean }>(
          'SELECT ops.channel_practice_receipt_allowed($1,$2) allowed',
          [first.id, first.lease_id],
          true
        )
      ).rows[0]!.allowed
    ).toBe(true);
    await pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
      [person]
    );
    expect(
      (
        await query<{ allowed: boolean }>(
          'SELECT ops.channel_practice_receipt_allowed($1,$2) allowed',
          [first.id, first.lease_id],
          true
        )
      ).rows[0]!.allowed
    ).toBe(false);
  });
});
