import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
interface Cursor {
  snapshotAt: string;
  publishedAt: string;
  id: string;
}
interface Entry {
  id: string;
  date: string;
  alias: string;
  region: string;
  currentStreak: number;
  totalDays: number;
  practiceNote: string;
  timezone: string;
  checkedInAt: string;
  publishedAt: string;
}
interface Feed {
  snapshotAt: string;
  pageSize: number;
  hasMore: boolean;
  nextCursor: Cursor | null;
  entries: Entry[];
}
suite('LINE10-entry cursor stream and public-only data envelope', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    app: FastifyInstance,
    role: string,
    author: string,
    viewer: string,
    identity: string,
    assignment: string,
    region: string,
    reviewer: string;
  let cleaners: Array<() => Promise<void>> = [];
  const uid = 'U' + 'e'.repeat(32),
    origin = 'https://checkin.baiyinqigong.org';
  const request = (body: Record<string, unknown> = { cursor: null }) =>
    app.inject({
      method: 'POST',
      url: '/line/journal/feed',
      headers: { origin },
      payload: { idToken: 'verified-stream-id', ...body }
    });
  const feed = async (cursor: Cursor | null = null) => {
    const r = await request({ cursor });
    const diagnostics =
      r.statusCode === 200
        ? undefined
        : (
            await db.pool.query(
              "SELECT platform.line_checkin_person($1) IS NOT NULL owner_lookup,(SELECT status FROM identity.people WHERE id=$2) viewer_status,(SELECT bool_and(revoked_at IS NULL) FROM identity.platform_identities WHERE person_id=$2) identity_active,(SELECT min(extract(epoch FROM clock_timestamp()-valid_from)) FROM identity.person_interaction_channels WHERE person_id=$2) channel_age_seconds,platform.privacy_status('line',$1)->>'required' privacy_required",
              [uid, viewer]
            )
          ).rows[0];
    expect(r.statusCode, r.body + ' ' + JSON.stringify(diagnostics)).toBe(200);
    return r.json<Feed>();
  };
  const seed = async (
    person: string,
    ident: string,
    assignmentId: string,
    offset: number,
    publishedAt?: string
  ) => {
    const checkin = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) VALUES($1,$2,CURRENT_DATE+$3::integer,'UTC','regular',$4) RETURNING id",
        [person, ident, offset, assignmentId]
      )
    ).rows[0]!.id;
    if (publishedAt) {
      await db.pool.query(
        'INSERT INTO core.journal_publications(checkin_id,person_id,identity_id,revision,active,external_enabled,share_note,share_feelings,alias,practice_date,note_snapshot,method_snapshot,tag_snapshot,published_at) SELECT $1,$2,$3,1,true,false,true,true,\'Synthetic public alias\',practice_date,\'Public snapshot\', \'[{"zh_TW":"大雁功初級","en":"Dayan"}]\',\'[{"zh_TW":"放鬆","en":"Relaxed"}]\',$4::timestamptz FROM core.checkins WHERE id=$1',
        [checkin, person, ident, publishedAt]
      );
    }
    return checkin;
  };
  beforeEach(async () => {
    cleaners = [];
    db = await createIsolatedTestDatabase(base!);
    const database = db;
    cleaners.push(() => database.dispose());
    await runMigrations(db.pool, directory, 'line-stream-test');
    role = 'qigong_stream_test_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime,qigong_worker_runtime TO ${role}`);
    const roleName = role;
    cleaners.push(async () => {
      await database.pool.query(`DROP OWNED BY ${roleName}`);
      await database.pool.query(`DROP ROLE ${roleName}`);
    });
    const url = new URL(db.databaseUrl);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    const runtimePool = runtime;
    cleaners.push(() => runtimePool.end());
    reviewer = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://stream.example.invalid','reviewer','Synthetic reviewer') RETURNING id"
      )
    ).rows[0]!.id;
    region = (
      await db.pool.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('stream-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'stream-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tw-general','operational','台灣地區','Taiwan' FROM k RETURNING id"
      )
    ).rows[0]!.id;
    for (const [provider, subject] of [
      ['line', uid],
      ['telegram', '548003000001']
    ] as const) {
      const person = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Confidential real name','UTC') RETURNING id"
        )
      ).rows[0]!.id;
      const ident = (
        await db.pool.query<{ id: string }>(
          'INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,$2,$3) RETURNING id',
          [person, provider, subject]
        )
      ).rows[0]!.id;
      // These learners are already eligible; activation boundaries are tested separately.
      await db.pool.query(
        "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,valid_from) VALUES($1,$2,'onboarding',CURRENT_TIMESTAMP-INTERVAL '1 day')",
        [person, ident]
      );
      const assigned = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-100) RETURNING id",
          [person, region]
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES($1,$2,'Confidential','Confidential','confidential@example.invalid','+65970000001',$3,'approved',$4,clock_timestamp(),$5)",
        [provider, subject, region, person, reviewer]
      );
      if (provider === 'line') viewer = person;
      else {
        author = person;
        identity = ident;
        assignment = assigned;
      }
    }
    const past = (
      await db.pool.query<{ value: string }>(
        "SELECT (clock_timestamp()-INTERVAL '1 minute')::text value"
      )
    ).rows[0]!.value;
    for (let offset = -24; offset <= 0; offset++)
      await seed(author, identity, assignment, offset, past);
    const privateId = await seed(author, identity, assignment, -40);
    await db.pool.query(
      "INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) VALUES($1,$2,'Secret original must not leak')",
      [privateId, author]
    );
    await seed(author, identity, assignment, 1);
    app = buildApp({
      pool: runtime,
      logger: false,
      line: {
        channelSecret: 'synthetic-secret-not-real',
        channelAccessToken: 'synthetic-access-token-not-real',
        loginChannelId: '123',
        liffId: '123-stream',
        verifyIdToken: async (token) => {
          if (token !== 'verified-stream-id') throw Error('Unverified');
          return uid;
        },
        reply: async () => {}
      }
    });
  });
  afterEach(async () => {
    await app?.close();
    for (const cleanup of cleaners.reverse()) await cleanup();
  });
  it('returns10/10/5 with equal timestamp tie-breaks, no duplicates and a terminal cursor', async () => {
    const a = await feed(),
      b = await feed(a.nextCursor),
      c = await feed(b.nextCursor);
    expect([a.entries.length, b.entries.length, c.entries.length]).toEqual([10, 10, 5]);
    expect(new Set([...a.entries, ...b.entries, ...c.entries].map((e) => e.id)).size).toBe(25);
    expect(c.hasMore).toBe(false);
    expect(c.nextCursor).toBeNull();
  });
  it('attaches only aggregate as-of counts and historical region/time, never private originals or identifiers', async () => {
    const all: Entry[] = [];
    let cursor: Cursor | null = null;
    do {
      const data = await feed(cursor);
      all.push(...data.entries);
      cursor = data.nextCursor;
    } while (cursor);
    const newest = all.reduce((a, b) => (a.date > b.date ? a : b)),
      oldest = all.reduce((a, b) => (a.date < b.date ? a : b));
    expect(newest.currentStreak).toBe(25);
    expect(newest.totalDays).toBe(26);
    expect(oldest.currentStreak).toBe(1);
    expect(oldest.totalDays).toBe(2);
    for (const e of all) {
      expect(e.region).toBe('台灣地區');
      expect(e.timezone).toBe('UTC');
      expect(e.practiceNote).toBe('Public snapshot');
      expect(e.checkedInAt).toBeTruthy();
    }
    const raw = JSON.stringify(all);
    for (const privateValue of [
      author,
      viewer,
      identity,
      'confidential@example.invalid',
      'Secret original',
      'Confidential real name'
    ])
      expect(raw).not.toContain(privateValue);
  });
  it('freezes the upper boundary against newly shared records while refresh sees them', async () => {
    const first = await feed();
    expect(first.entries).toHaveLength(10);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    expect(first.nextCursor!.snapshotAt).toBe(first.snapshotAt);
    const v = (
      await db.pool.query<{ id: string; assignment: string }>(
        'SELECT i.id,a.id assignment FROM identity.platform_identities i JOIN core.person_region_assignments a ON a.person_id=i.person_id WHERE i.person_id=$1',
        [viewer]
      )
    ).rows[0]!;
    // Use the DB clock without rounding to host milliseconds or moving the old anchor.
    const publicationTime = (
      await db.pool.query<{ value: string; afterSnapshot: boolean; deltaMicroseconds: string }>(
        `WITH observed AS MATERIALIZED (SELECT clock_timestamp() AS value)
         SELECT value::text, value>$1::timestamptz AS "afterSnapshot",
           (extract(epoch FROM (value-$1::timestamptz))*1000000)::text AS "deltaMicroseconds"
         FROM observed`,
        [first.nextCursor!.snapshotAt]
      )
    ).rows[0]!;
    expect(
      publicationTime.afterSnapshot,
      'DB clock did not advance beyond the frozen snapshot: ' +
        JSON.stringify({ snapshotAt: first.nextCursor!.snapshotAt, ...publicationTime })
    ).toBe(true);
    const checkin = await seed(viewer, v.id, v.assignment, 0, publicationTime.value);
    const publication = (
      await db.pool.query<{ id: string }>(
        'SELECT id FROM core.journal_publications WHERE checkin_id=$1',
        [checkin]
      )
    ).rows[0]!;
    const tail = await feed(first.nextCursor);
    expect(tail.snapshotAt).toBe(first.nextCursor!.snapshotAt);
    expect(tail.entries).toHaveLength(10);
    expect(tail.entries.some((e) => e.id === publication.id)).toBe(false);
    expect(
      tail.entries.some(
        (e) => e.alias === 'Synthetic public alias' && e.currentStreak === 1 && e.totalDays === 1
      )
    ).toBe(false);
    const last = await feed(tail.nextCursor);
    expect(last.snapshotAt).toBe(first.nextCursor!.snapshotAt);
    expect(last.entries).toHaveLength(5);
    expect(last.nextCursor).toBeNull();
    expect(last.entries.some((e) => e.id === publication.id)).toBe(false);
    const refreshed = await feed();
    const refreshTime = (
      await db.pool.query<{ includesPublication: boolean; deltaMicroseconds: string }>(
        `SELECT $1::timestamptz >= $2::timestamptz AS "includesPublication",
           (extract(epoch FROM ($1::timestamptz-$2::timestamptz))*1000000)::text AS "deltaMicroseconds"`,
        [refreshed.snapshotAt, publicationTime.value]
      )
    ).rows[0]!;
    expect(
      refreshTime.includesPublication,
      'DB refresh snapshot precedes the new publication: ' +
        JSON.stringify({
          snapshotAt: refreshed.snapshotAt,
          publishedAt: publicationTime.value,
          ...refreshTime
        })
    ).toBe(true);
    expect(refreshed.entries.some((e) => e.currentStreak === 1 && e.totalDays === 1)).toBe(true);
    expect(refreshed.entries.some((e) => e.id === publication.id)).toBe(true);
  });
  it('keeps the checkin region snapshot after the author changes primary region', async () => {
    const parent = (
      await db.pool.query<{ parent_region_id: string }>(
        'SELECT parent_region_id FROM core.regions WHERE id=$1',
        [region]
      )
    ).rows[0]!.parent_region_id;
    const next = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'stream-other-region','operational','新地區','New region') RETURNING id",
        [parent]
      )
    ).rows[0]!.id;
    await db.pool.query(
      'UPDATE core.person_region_assignments SET valid_to=CURRENT_DATE WHERE id=$1',
      [assignment]
    );
    await db.pool.query(
      "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE)",
      [author, next]
    );
    expect((await feed()).entries.every((e) => e.region === '台灣地區')).toBe(true);
  });
  it('filters withdrawn and suspended authors anew on later reads', async () => {
    const first = await feed();
    await db.pool.query('UPDATE core.journal_publications SET active=false WHERE id=$1', [
      first.entries[0]!.id
    ]);
    expect((await feed()).entries.some((e) => e.id === first.entries[0]!.id)).toBe(false);
    await db.pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
      [author]
    );
    await db.pool.query("UPDATE identity.people SET status='suspended' WHERE id=$1", [author]);
    expect((await feed(first.nextCursor)).entries).toEqual([]);
  });
  it('rejects malformed/future/expired cursors and rechecks reader identity/consent', async () => {
    expect(
      (
        await request({
          cursor: { snapshotAt: 'invalid', publishedAt: 'invalid', id: randomUUID() }
        })
      ).statusCode
    ).toBe(400);
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(
      (await request({ cursor: { snapshotAt: future, publishedAt: future, id: randomUUID() } }))
        .statusCode
    ).toBe(400);
    expect((await request({ cursor: null, idToken: 'wrong' })).statusCode).toBe(401);
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    expect((await request()).statusCode).toBe(403);
  });
  it('keeps old20-entry LINE paging and external content shape untouched', async () => {
    const old = await request({ page: 1 });
    expect(old.statusCode).toBe(200);
    const data = old.json<{ entries: unknown[]; total: number }>();
    expect(data.entries).toHaveLength(20);
    expect(data.total).toBe(25);
    expect(old.body).not.toContain('totalDays');
    await expect(
      withRequestContext(runtime, 'qigong_worker_runtime', { requestId: randomUUID() }, (c) =>
        c.query('SELECT platform.line_journal_stream($1,NULL)', [uid])
      )
    ).rejects.toThrow();
  });
});
