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
suite('LINE verified nickname display without authorization or identity changes', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    role: string,
    app: FastifyInstance,
    displayName: string | undefined,
    viewer: string,
    peer: string,
    identity: string;
  let cleanups: Array<() => Promise<void>> = [];
  const uid = 'U' + 'a'.repeat(32),
    peerUid = 'U' + 'b'.repeat(32),
    origin = 'https://checkin.baiyinqigong.org';
  const post = (path: string, values: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: path,
      headers: { origin },
      payload: { idToken: 'verified-profile-id', ...values }
    });
  const query = <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[],
    worker = false
  ) =>
    withRequestContext(
      runtime,
      worker ? 'qigong_worker_runtime' : 'qigong_api_runtime',
      { requestId: randomUUID() },
      (c) => c.query<Row>(sql, values)
    );
  beforeEach(async () => {
    displayName = 'LINE自己😀';
    cleanups = [];
    db = await createIsolatedTestDatabase(base!);
    const database = db;
    cleanups.push(() => database.dispose());
    await runMigrations(db.pool, directory, 'line-profile-http');
    role = 'qigong_profile_http_' + randomUUID().replaceAll('-', '');
    const roleName = role,
      password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime,qigong_worker_runtime TO ${role}`);
    cleanups.push(async () => {
      await database.pool.query(`DROP OWNED BY ${roleName}`);
      await database.pool.query(`DROP ROLE ${roleName}`);
    });
    const url = new URL(db.databaseUrl);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    const runtimePool = runtime;
    cleanups.push(() => runtimePool.end());
    const reviewer = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://nickname.example.invalid','reviewer','Synthetic reviewer') RETURNING id"
      )
    ).rows[0]!.id;
    const region = (
      await db.pool.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('nickname-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'nickname-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tw-general','operational','地區','Region' FROM k RETURNING id"
      )
    ).rows[0]!.id;
    for (const [provider, subject, alias] of [
      ['line', uid, 'Chosen self alias'],
      ['line', peerUid, 'Chosen peer alias'],
      ['telegram', '548000000031', 'TG分享暱稱']
    ] as const) {
      const person = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('申請表真實姓名','UTC') RETURNING id"
        )
      ).rows[0]!.id;
      const ident = (
        await db.pool.query<{ id: string }>(
          'INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,display_name) VALUES($1,$2,$3,$4) RETURNING id',
          [person, provider, subject, '申請表真實姓名']
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
        [person, ident]
      );
      const assignment = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-30) RETURNING id",
          [person, region]
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES($1,$2,'Legal','Legal','private@example.invalid','+659900000031',$3,'approved',$4,clock_timestamp(),$5)",
        [provider, subject, region, person, reviewer]
      );
      const checkin = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) VALUES($1,$2,CURRENT_DATE,'UTC','regular',$3) RETURNING id",
          [person, ident, assignment]
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO core.journal_publications(checkin_id,person_id,identity_id,revision,active,external_enabled,share_note,share_feelings,alias,practice_date,note_snapshot,method_snapshot,tag_snapshot) VALUES($1,$2,$3,1,true,false,true,false,$4,CURRENT_DATE,'Shared snapshot','[]','[]')",
        [checkin, person, ident, alias]
      );
      if (subject === uid) {
        viewer = person;
        identity = ident;
      }
      if (subject === peerUid) peer = person;
    }
    app = buildApp({
      pool: runtime,
      logger: false,
      line: {
        channelSecret: 'synthetic-secret-not-real',
        channelAccessToken: 'synthetic-access-not-real',
        loginChannelId: '123',
        liffId: '123-profile',
        verifyIdentity: async (token) => {
          if (token !== 'verified-profile-id') throw Error('Unverified');
          return { subject: uid, ...(displayName ? { displayName } : {}) };
        },
        reply: async () => {}
      }
    });
    const api = app;
    cleanups.push(() => api.close());
  });
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  });
  it('displays the verified own nickname and anonymous peer without legal-name or ID fallback', async () => {
    const r = await post('/line/workspace/report', { view: 'leaderboard' });
    expect(r.statusCode, r.body).toBe(200);
    const data = r.json<{
      scope: string;
      rows: Array<{ self: boolean; label: string; days: number }>;
    }>();
    expect(data.scope).toBe('same_region_line_nicknames');
    expect(data.rows.find((v) => v.self)?.label).toBe('LINE自己😀（你）');
    expect(data.rows.find((v) => !v.self)?.label).toBe('匿名學員');
    for (const forbidden of ['申請表真實姓名', uid, peerUid, viewer, peer])
      expect(r.body).not.toContain(forbidden);
    expect(
      (await post('/line/workspace/report', { view: 'leaderboard', displayName: 'Spoof' }))
        .statusCode
    ).toBe(400);
  });
  it('refreshes only this verified identity and does not change applications, names or grants', async () => {
    const people = (await db.pool.query('SELECT * FROM identity.people')).rows,
      identities = (await db.pool.query('SELECT * FROM identity.platform_identities')).rows,
      applications = (await db.pool.query('SELECT * FROM identity.onboarding_applications')).rows,
      grants = (await db.pool.query('SELECT * FROM admin.role_grants')).rows;
    await post('/line/workspace/profile');
    displayName = '更新的LINE暱稱';
    await post('/line/workspace/profile');
    expect(
      (
        await db.pool.query(
          'SELECT display_name FROM platform.line_verified_profiles WHERE identity_id=$1',
          [identity]
        )
      ).rows[0]!.display_name
    ).toBe(displayName);
    expect((await db.pool.query('SELECT * FROM identity.people')).rows).toEqual(people);
    expect((await db.pool.query('SELECT * FROM identity.platform_identities')).rows).toEqual(
      identities
    );
    expect((await db.pool.query('SELECT * FROM identity.onboarding_applications')).rows).toEqual(
      applications
    );
    expect((await db.pool.query('SELECT * FROM admin.role_grants')).rows).toEqual(grants);
  });
  it('uses LINE author nicknames in LINE feed only, preserving TG aliases and old audience feed', async () => {
    await query('SELECT platform.refresh_verified_line_profile($1,$2)', [peerUid, 'LINE另一位']);
    const r = await post('/line/journal/feed', { cursor: null });
    expect(r.statusCode, r.body).toBe(200);
    const aliases = r.json<{ entries: Array<{ alias: string }> }>().entries.map((e) => e.alias);
    expect(aliases).toEqual(expect.arrayContaining(['LINE自己😀', 'LINE另一位', 'TG分享暱稱']));
    expect(aliases).not.toContain('Chosen peer alias');
    const old = await query<{ data: { entries: Array<{ alias: string }> } }>(
      'SELECT platform.community_feed($1,$2,$3,1) data',
      ['line', uid, 'zh_TW']
    );
    expect(old.rows[0]!.data.entries.map((e) => e.alias)).toEqual(
      expect.arrayContaining(['Chosen self alias', 'Chosen peer alias', 'TG分享暱稱'])
    );
  });
  it('does not erase a known nickname when later verified claims omit it, or emit redundant profile audits', async () => {
    await post('/line/workspace/profile');
    const audits = Number(
      (
        await db.pool.query(
          "SELECT count(*) n FROM audit.events WHERE action='line.profile_refresh'"
        )
      ).rows[0]!.n
    );
    await post('/line/workspace/profile');
    displayName = undefined;
    await post('/line/workspace/profile');
    expect(
      Number(
        (
          await db.pool.query(
            "SELECT count(*) n FROM audit.events WHERE action='line.profile_refresh'"
          )
        ).rows[0]!.n
      )
    ).toBe(audits);
    expect(
      (
        await db.pool.query(
          'SELECT display_name FROM platform.line_verified_profiles WHERE identity_id=$1',
          [identity]
        )
      ).rows[0]!.display_name
    ).toBe('LINE自己😀');
  });
  it('rejects malformed metadata, worker/table access, and stops naming inactive authors', async () => {
    await expect(query('SELECT * FROM platform.line_verified_profiles', [])).rejects.toThrow();
    await expect(
      query('SELECT platform.refresh_verified_line_profile($1,$2)', [uid, 'Worker spoof'], true)
    ).rejects.toThrow();
    await expect(
      query('SELECT platform.refresh_verified_line_profile($1,$2)', [uid, 'bad\nname'])
    ).rejects.toThrow();
    expect(
      (
        await query<{ ok: boolean }>('SELECT platform.refresh_verified_line_profile($1,$2) ok', [
          'U' + 'f'.repeat(32),
          'Unlinked'
        ])
      ).rows[0]!.ok
    ).toBe(false);
    await query('SELECT platform.refresh_verified_line_profile($1,$2)', [peerUid, 'Peer nickname']);
    await db.pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
      [peer]
    );
    await db.pool.query("UPDATE identity.people SET status='suspended' WHERE id=$1", [peer]);
    const r = await post('/line/journal/feed', { cursor: null });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain('Peer nickname');
    expect((await post('/line/workspace/report', { view: 'leaderboard' })).body).not.toContain(
      'Peer nickname'
    );
  });
  it('does not reveal a cached author nickname when that author lacks current necessary acceptance', async () => {
    await query('SELECT platform.refresh_verified_line_profile($1,$2)', [
      peerUid,
      'Peer private until acceptance'
    ]);
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    const token = randomBytes(32).toString('base64url');
    await query("SELECT platform.begin_privacy_gate('line',$1,$2)", [uid, token]);
    const policy = (
      await db.pool.query<{ version: string; document_hash: string }>(
        "SELECT version,document_hash FROM platform.learner_privacy_policies WHERE state='active'"
      )
    ).rows[0]!;
    await query("SELECT platform.accept_privacy('line',$1,$2,$3,'zh_TW',true,false)", [
      token,
      policy.version,
      policy.document_hash
    ]);
    const r = await post('/line/workspace/report', { view: 'leaderboard' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.body).not.toContain('Peer private until acceptance');
    expect(r.body).toContain('匿名學員');
    const feed = await post('/line/journal/feed', { cursor: null });
    expect(feed.statusCode).toBe(200);
    expect(feed.body).not.toContain('Peer private until acceptance');
  });
  it('still requires valid identity and applicable necessary consent', async () => {
    expect((await post('/line/workspace/profile', { idToken: 'wrong' })).statusCode).toBe(401);
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    expect((await post('/line/workspace/report', { view: 'leaderboard' })).statusCode).toBe(403);
    expect((await post('/line/journal/feed', { cursor: null })).statusCode).toBe(403);
  });
});
