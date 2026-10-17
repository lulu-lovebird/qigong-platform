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
const notice = 'student-community-notes-v1';
interface Learner {
  person: string;
  identity: string;
  credential: string;
  channel: 'line' | 'telegram';
}
interface Saved {
  checkinId: string;
  version: number;
  communitySharing?: string;
  communityShared?: boolean;
}
suite.each(['line', 'telegram'] as const)('Disclosed %s community notes', (channel) => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    role: string,
    principal: string,
    regions: string[],
    writer: Learner,
    reader: Learner;
  const query = <R extends Record<string, unknown>>(sql: string, values: unknown[] = []) =>
    withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
      c.query<R>(sql, values)
    );
  const learner = async (c: 'line' | 'telegram', region: string): Promise<Learner> => {
    const subject =
      c === 'line'
        ? 'U' + randomBytes(16).toString('hex')
        : String(Math.floor(Math.random() * 100000000) + 10000000);
    const person = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('PRIVATE LEGAL NAME','UTC') RETURNING id"
      )
    ).rows[0]!.id;
    const identity = (
      await db.pool.query<{ id: string }>(
        'INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,$2,$3) RETURNING id',
        [person, c, subject]
      )
    ).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,valid_from) VALUES($1,$2,'onboarding',clock_timestamp()-INTERVAL '1 day')",
      [person, identity]
    );
    await db.pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES($1,$2,'PRIVATE LEGAL NAME','PRIVATE LEGAL NAME','private@example.invalid','+659900000034',$3,'approved',$4,clock_timestamp(),$5)",
      [c, subject, region, person, principal]
    );
    await db.pool.query(
      "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-30)",
      [person, region]
    );
    let credential = subject;
    if (c === 'telegram') {
      credential = randomBytes(32).toString('base64url');
      const opened = await query<{ status: string }>(
        'SELECT platform.begin_telegram_checkin($1,$2) status',
        [subject, credential]
      );
      expect(opened.rows[0]!.status).toBe('ready');
      await query('SELECT platform.telegram_workspace_timezone($1,$2)', [credential, 'UTC']);
    } else
      await query('SELECT platform.channel_workspace_timezone($1,$2,$3)', [c, credential, 'UTC']);
    return { person, identity, credential, channel: c };
  };
  const save = async (
    text: string | null,
    version = 0,
    request = randomUUID(),
    disclosure: string | null = notice
  ): Promise<Saved> =>
    (
      await query<{ data: Saved }>(
        'SELECT platform.community_workspace_save($1,$2,$3,CURRENT_DATE,$4,$5,$6,$7,$8) data',
        [channel, writer.credential, request, version, ['dayan_chu'], text, [], disclosure]
      )
    ).rows[0]!.data;
  const feed = async (who = reader) =>
    (
      await query<{
        data: { snapshotAt?: string; entries: Array<{ id: string; practiceNote: string }> };
      }>(
        who.channel === 'line'
          ? 'SELECT platform.line_journal_stream($1,NULL) data'
          : "SELECT platform.journal_feed($1,'zh_TW',1) data",
        [who.credential]
      )
    ).rows[0]!.data;
  const own = async () =>
    (
      await query<{
        data: {
          entries: Array<{ checkinId: string; sourceHash: string; version: number; alias: string }>;
        };
      }>(
        channel === 'line'
          ? "SELECT platform.channel_journal_own('line',$1,1,'zh_TW') data"
          : "SELECT platform.journal_own($1,1,'zh_TW') data",
        [writer.credential]
      )
    ).rows[0]!.data.entries[0]!;
  beforeEach(async () => {
    db = await createIsolatedTestDatabase(base!);
    await runMigrations(db.pool, directory, 'community-test');
    role = 'qigong_community_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime TO ${role}`);
    const u = new URL(db.databaseUrl);
    u.username = role;
    u.password = password;
    runtime = new pg.Pool({ connectionString: u.href });
    principal = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://community.example.invalid','staff','Synthetic staff') RETURNING id"
      )
    ).rows[0]!.id;
    regions = (
      await db.pool.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('community-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'community-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,x,'operational',x,x FROM c CROSS JOIN unnest(ARRAY['community-a','community-b']) x RETURNING id"
      )
    ).rows.map((r) => r.id);
    writer = await learner(channel, regions[0]!);
    reader = await learner(channel === 'line' ? 'telegram' : 'line', regions[1]!);
  });
  afterEach(async () => {
    await runtime?.end();
    if (db) {
      await db.pool.query(`DROP OWNED BY ${role}`);
      await db.pool.query(`DROP ROLE ${role}`);
      await db.dispose();
    }
  });
  it('publishes a new disclosed note across regions/channels, without legal consent backfill or external opt-in', async () => {
    const result = await save('Public reflection');
    expect(result).toMatchObject({ communitySharing: 'automatic', communityShared: true });
    const data = await feed();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0]!.practiceNote).toBe('Public reflection');
    expect(JSON.stringify(data)).not.toMatch(
      /PRIVATE LEGAL NAME|private@example.invalid|659900000034/
    );
    expect(
      (
        await db.pool.query(
          'SELECT active,external_enabled,share_note,shared_with_staff FROM core.journal_publications'
        )
      ).rows[0]
    ).toEqual({ active: true, external_enabled: false, share_note: true, shared_with_staff: true });
    expect(
      (await db.pool.query('SELECT * FROM platform.learner_privacy_acceptances')).rowCount
    ).toBe(0);
    expect((await db.pool.query('SELECT * FROM core.checkin_privacy_origins')).rowCount).toBe(0);
    expect(
      (await db.pool.query("SELECT * FROM platform.learner_privacy_policies WHERE state='active'"))
        .rowCount
    ).toBe(0);
    await expect(query('SELECT * FROM core.community_note_origins')).rejects.toThrow();
    await expect(
      query('SELECT core.publish_community_note($1)', [result.checkinId])
    ).rejects.toThrow();
  });
  it('leaves an empty/whitespace note unlisted, then shares a newly written note on that disclosed record', async () => {
    const first = await save('   ');
    expect(first.communityShared).toBe(false);
    expect((await feed()).entries).toEqual([]);
    const next = await save('New note', first.version);
    expect(next.communityShared).toBe(true);
    expect((await feed()).entries[0]!.practiceNote).toBe('New note');
    const cleared = await save('', next.version);
    expect(cleared.communityShared).toBe(false);
    expect((await feed()).entries).toEqual([]);
    await save('Written again', cleared.version);
    expect((await feed()).entries[0]!.practiceNote).toBe('Written again');
  });
  it('shares a first newly written reflection on an existing practice-only record, without publishing any prior private note', async () => {
    const empty = await save(null, 0, randomUUID(), null);
    expect((await db.pool.query('SELECT * FROM core.community_note_origins')).rowCount).toBe(0);
    const firstNote = await save('First new reflection', empty.version);
    expect(firstNote.communitySharing).toBe('automatic');
    expect((await feed()).entries[0]!.practiceNote).toBe('First new reflection');
  });
  it('keeps old-interface notes private, including an idempotent retry with a newly added notice', async () => {
    const id = randomUUID();
    const first = await save('Legacy private', 0, id, null);
    expect(first).not.toHaveProperty('communitySharing');
    const replay = await save('Legacy private', 0, id);
    expect(replay.communitySharing).toBe('legacy_private');
    expect(replay.communityShared).toBe(false);
    await save('Edited private', first.version);
    expect((await feed()).entries).toEqual([]);
    expect((await db.pool.query('SELECT * FROM core.community_note_origins')).rowCount).toBe(0);
  });
  it('does not republish later private legacy edits when an earlier disclosed request is replayed', async () => {
    const id = randomUUID();
    const first = await save('Public snapshot', 0, id);
    const privateEdit = await save('LATER PRIVATE TEXT', first.version, randomUUID(), null);
    const afterPrivate = await feed();
    // Preserve the original content assertion. On failure, expose only timing/eligibility
    // aggregates, never the snapshot text, aliases, IDs, credentials or provider subjects.
    let diagnostic: Record<string, number | boolean | null> | undefined;
    if (afterPrivate.entries.length !== 1) {
      diagnostic = (
        await db.pool.query<{ data: Record<string, number | boolean | null> }>(
          `SELECT jsonb_build_object(
          'publications',count(*),
          'active',count(*) FILTER(WHERE active),
          'atOrBeforeSnapshot',count(*) FILTER(WHERE published_at<=coalesce($1::timestamptz,clock_timestamp())),
          'maxPublicationAheadMs',max(extract(epoch FROM(published_at-coalesce($1::timestamptz,clock_timestamp())))*1000),
          'authorEligible',coalesce(bool_and(platform.learner_public_author_name(identity_id,alias,'zh_TW') IS NOT NULL),FALSE),
          'futureChannels',(SELECT count(*) FROM identity.person_interaction_channels WHERE valid_from>clock_timestamp()),
          'snapshotAheadOfClockMs',extract(epoch FROM($1::timestamptz-clock_timestamp()))*1000
        ) data FROM core.journal_publications`,
          [afterPrivate.snapshotAt ?? null]
        )
      ).rows[0]?.data;
    }
    expect(afterPrivate.entries, JSON.stringify(diagnostic)).toHaveLength(1);
    expect(afterPrivate.entries[0]!.practiceNote).toBe('Public snapshot');
    await save('Public snapshot', 0, id);
    expect(JSON.stringify(await feed())).not.toContain('LATER PRIVATE TEXT');
    await save('Confirmed new public text', privateEdit.version);
    expect((await feed()).entries[0]!.practiceNote).toBe('Confirmed new public text');
  });
  it('preserves explicit withdrawal/manual control through subsequent saves and retries', async () => {
    const first = await save('First note');
    const entry = await own();
    const args = [
      writer.credential,
      entry.checkinId,
      entry.version,
      false,
      true,
      true,
      false,
      entry.alias,
      entry.sourceHash
    ];
    await query(
      channel === 'line'
        ? 'SELECT platform.channel_journal_publish($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'
        : 'SELECT platform.journal_publish($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      channel === 'line' ? ['line', ...args] : args
    );
    const changed = await save('Do not resurrect', first.version);
    expect(changed.communitySharing).toBe('manual');
    expect(changed.communityShared).toBe(false);
    expect((await feed()).entries).toEqual([]);
  });
  it('keeps necessary and optional privacy gates independent from the writing notice', async () => {
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    await expect(save('No recorded acceptance')).rejects.toThrow('privacy acceptance required');
    const subject = (
      await db.pool.query<{ subject: string }>(
        'SELECT external_subject_id subject FROM identity.platform_identities WHERE id=$1',
        [writer.identity]
      )
    ).rows[0]!.subject;
    const policy = (
      await db.pool.query<{ version: string; hash: string }>(
        "SELECT version,document_hash hash FROM platform.learner_privacy_policies WHERE state='active'"
      )
    ).rows[0]!;
    const accept = async (reflections: boolean) => {
      const proof = randomBytes(32).toString('base64url');
      await query('SELECT platform.begin_privacy_gate($1,$2,$3)', [channel, subject, proof]);
      await query('SELECT platform.accept_privacy($1,$2,$3,$4,$5,TRUE,$6)', [
        channel,
        proof,
        policy.version,
        policy.hash,
        'zh_TW',
        reflections
      ]);
    };
    await accept(false);
    await expect(save('No reflection consent')).rejects.toThrow('reflection consent required');
    const practiceOnly = await save(null);
    expect(practiceOnly.communityShared).toBe(false);
    await accept(true);
    const shared = await save('Now permitted', practiceOnly.version);
    expect(shared.communityShared).toBe(true);
    await expect(feed()).rejects.toThrow('privacy acceptance required');
    await accept(false);
    expect(
      (
        await db.pool.query(
          'SELECT note_snapshot,share_note,external_enabled FROM core.journal_publications'
        )
      ).rows[0]
    ).toEqual({ note_snapshot: '', share_note: false, external_enabled: false });
    await expect(save('Do not bypass revocation', shared.version)).rejects.toThrow(
      'reflection consent required'
    );
  });
  it('rolls back invalid notes atomically and hides the author after suspension', async () => {
    await expect(save('x'.repeat(1001))).rejects.toThrow('invalid practice note');
    expect((await db.pool.query('SELECT * FROM core.checkins')).rowCount).toBe(0);
    expect((await db.pool.query('SELECT * FROM core.community_note_origins')).rowCount).toBe(0);
    await expect(save('Wrong version', 0, randomUUID(), 'unknown-notice')).rejects.toThrow(
      'invalid community notice'
    );
    await save('Visible');
    await db.pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
      [writer.person]
    );
    await db.pool.query("UPDATE identity.people SET status='suspended' WHERE id=$1", [
      writer.person
    ]);
    expect((await feed()).entries).toEqual([]);
  });
});
