import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Hashed scoped LINE invitations and atomic learner approval', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    role: string,
    actor: string,
    other: string,
    region: string,
    cap: string,
    invite: { id: string; revision: number },
    grant: string;
  const subject = 'U' + 'a'.repeat(32);
  const query = <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
    principal: string | null = actor,
    worker = false
  ) =>
    withRequestContext(
      runtime,
      worker ? 'qigong_worker_runtime' : 'qigong_api_runtime',
      { requestId: randomUUID(), ...(principal ? { principalId: principal } : {}) },
      (c) => c.query<Row>(sql, values)
    );
  const create = async (limit = 100) => {
    cap = randomBytes(32).toString('base64url');
    invite = (
      await query<{ data: { id: string; revision: number } }>(
        'SELECT admin.create_line_invite($1,$2,$3,$4,$5,$6) data',
        [
          cap,
          'Synthetic invite',
          'tw-general',
          new Date(Date.now() + 7 * 86400000).toISOString(),
          limit,
          'Synthetic reviewed invite'
        ]
      )
    ).rows[0]!.data;
  };
  const redeem = (id = subject, token = cap) =>
    query<{ data: { status: string; alreadyMember: boolean } }>(
      'SELECT platform.redeem_line_invite($1,$2,$3,$4,$5) data',
      [id, token, 'Synthetic learner', 'same@example.invalid', '+65960000001'],
      null
    );
  beforeEach(async () => {
    db = await createIsolatedTestDatabase(base!);
    await runMigrations(db.pool, directory, 'line-invite-test');
    role = 'qigong_invite_test_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime,qigong_worker_runtime TO ${role}`);
    const url = new URL(db.databaseUrl);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    actor = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://invite.example.invalid','super','Synthetic super') RETURNING id"
      )
    ).rows[0]!.id;
    other = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://invite.example.invalid','other','Synthetic other') RETURNING id"
      )
    ).rows[0]!.id;
    grant = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic super' FROM admin.roles WHERE code='super_admin' RETURNING id",
        [actor]
      )
    ).rows[0]!.id;
    region = (
      await db.pool.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('invite-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'invite-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en,default_timezone) SELECT id,'tw-general','operational','台灣','Taiwan','Asia/Taipei' FROM k RETURNING id"
      )
    ).rows[0]!.id;
    await create();
  });
  afterEach(async () => {
    await runtime.end();
    await db.pool.query(`DROP OWNED BY ${role}`);
    await db.pool.query(`DROP ROLE ${role}`);
    await db.dispose();
  });
  it('limits management to active super, hashes the secret, and never lists it', async () => {
    await expect(query('SELECT admin.line_invite_list()', [], other)).rejects.toThrow('denied');
    await expect(query('SELECT * FROM platform.line_invites')).rejects.toThrow();
    await expect(query('SELECT admin.line_invite_list()', [], null, true)).rejects.toThrow();
    const list = (await query<{ data: unknown }>('SELECT admin.line_invite_list() data')).rows[0]!
      .data;
    expect(JSON.stringify(list)).not.toContain(cap);
    expect(
      (
        await db.pool.query(
          'SELECT token_hash=public.digest($1,$2) matched FROM platform.line_invites',
          [cap, 'sha256']
        )
      ).rows[0]!.matched
    ).toBe(true);
  });
  it('atomically creates a new person, exact verified identity, region and one normal notification without admin roles', async () => {
    const grantsBefore = (await db.pool.query('SELECT * FROM admin.role_grants')).rows;
    expect((await redeem()).rows[0]!.data).toEqual({ status: 'approved', alreadyMember: false });
    expect((await redeem()).rows[0]!.data.alreadyMember).toBe(true);
    expect((await db.pool.query('SELECT uses FROM platform.line_invites')).rows[0]!.uses).toBe(1);
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(1);
    expect((await db.pool.query('SELECT * FROM ops.onboarding_notifications')).rowCount).toBe(1);
    expect((await db.pool.query('SELECT * FROM admin.role_grants')).rows).toEqual(grantsBefore);
    expect(
      (await db.pool.query('SELECT region_id FROM core.person_region_assignments')).rows[0]!
        .region_id
    ).toBe(region);
    expect(
      (await db.pool.query('SELECT practice_timezone FROM identity.people')).rows[0]!
        .practice_timezone
    ).toBe('Asia/Taipei');
  });
  it('does not identify or merge learners by identical email, name or phone', async () => {
    await redeem();
    await redeem('U' + 'b'.repeat(32));
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(2);
    expect((await db.pool.query('SELECT uses FROM platform.line_invites')).rows[0]!.uses).toBe(2);
  });
  it('enforces the last quota atomically under concurrent different-user and same-user retries', async () => {
    await create(1);
    const results = await Promise.allSettled([
      redeem(subject),
      redeem('U' + 'b'.repeat(32)),
      redeem('U' + 'c'.repeat(32))
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.pool.query('SELECT * FROM platform.line_invite_redemptions')).rowCount).toBe(
      1
    );
    const approved = (
      await db.pool.query<{ external_subject_id: string }>(
        'SELECT external_subject_id FROM identity.platform_identities'
      )
    ).rows[0]!.external_subject_id;
    const retry = await Promise.all([redeem(approved), redeem(approved)]);
    expect(retry.every((r) => r.rows[0]!.data.alreadyMember)).toBe(true);
    expect(
      (await db.pool.query('SELECT uses FROM platform.line_invites WHERE id=$1', [invite.id]))
        .rows[0]!.uses
    ).toBe(1);
  });
  it('lets existing authorized learners bypass expired/revoked/exhausted/unknown invitations without changing profile', async () => {
    await redeem();
    const before = (await db.pool.query('SELECT * FROM identity.onboarding_applications')).rows;
    await query('SELECT admin.revoke_line_invite($1,$2,$3)', [
      invite.id,
      invite.revision,
      'Synthetic revoke'
    ]);
    expect((await redeem(subject, 'z'.repeat(43))).rows[0]!.data.alreadyMember).toBe(true);
    expect(
      (
        await query<{ data: { status: string } }>(
          'SELECT platform.line_invite_state($1,$2) data',
          [subject, cap],
          null
        )
      ).rows[0]!.data.status
    ).toBe('approved');
    expect((await db.pool.query('SELECT * FROM identity.onboarding_applications')).rows).toEqual(
      before
    );
    await expect(redeem('U' + 'b'.repeat(32))).rejects.toThrow('unavailable');
  });
  it('does not override rejected/suspended identities or grant implicit restoration', async () => {
    await db.pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id) VALUES('line',$1,'Rejected',$2)",
      [subject, region]
    );
    await db.pool.query(
      "UPDATE identity.onboarding_applications SET status='rejected',rejection_reason='Synthetic refusal',decided_at=clock_timestamp(),decided_by_principal_id=$2 WHERE external_subject_id=$1",
      [subject, actor]
    );
    await expect(redeem()).rejects.toThrow('unavailable');
    expect((await db.pool.query('SELECT uses FROM platform.line_invites')).rows[0]!.uses).toBe(0);
    const fresh = 'U' + 'b'.repeat(32);
    await redeem(fresh);
    const person = (
      await db.pool.query<{ person_id: string }>(
        'SELECT person_id FROM identity.platform_identities'
      )
    ).rows[0]!.person_id;
    await db.pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
      [person]
    );
    await db.pool.query("UPDATE identity.people SET status='suspended' WHERE id=$1", [person]);
    await expect(redeem(fresh)).rejects.toThrow('unavailable');
  });
  it('promotes only the same pending subject on explicit valid redemption, reassigns the confirmed invite region and cancels unsent review alerts', async () => {
    const oldRegion = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT parent_region_id,'my-general','operational','馬來西亞','Malaysia' FROM core.regions WHERE id=$1 RETURNING id",
        [region]
      )
    ).rows[0]!.id;
    const app = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id) VALUES('line',$1,'Old draft','Old draft','old@example.invalid','+65960000009',$2) RETURNING id",
        [subject, oldRegion]
      )
    ).rows[0]!.id;
    const event = (
      await db.pool.query<{ id: string }>(
        'SELECT id FROM ops.review_notification_events WHERE target_id=$1',
        [app]
      )
    ).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO ops.review_notification_deliveries(event_id,principal_id,preferences_revision,status,lease_id,leased_until) VALUES($1,$2,1,'sending',gen_random_uuid(),clock_timestamp()+INTERVAL '2 minutes'),($1,$3,1,'pending',NULL,NULL)",
      [event, actor, other]
    );
    const state = (
      await query<{ data: { status: string; pendingApplication: boolean } }>(
        'SELECT platform.line_invite_state($1,$2) data',
        [subject, cap],
        null
      )
    ).rows[0]!.data;
    expect(state).toMatchObject({ status: 'form', pendingApplication: true });
    expect(
      (
        await db.pool.query('SELECT status FROM identity.onboarding_applications WHERE id=$1', [
          app
        ])
      ).rows[0]!.status
    ).toBe('pending');
    const results = await Promise.all([redeem(), redeem()]);
    expect(results.filter((r) => !r.rows[0]!.data.alreadyMember)).toHaveLength(1);
    expect(
      (
        await db.pool.query(
          'SELECT id,status,requested_region_id,learner_name FROM identity.onboarding_applications WHERE id=$1',
          [app]
        )
      ).rows[0]
    ).toEqual({
      id: app,
      status: 'approved',
      requested_region_id: region,
      learner_name: 'Synthetic learner'
    });
    expect((await db.pool.query('SELECT uses FROM platform.line_invites')).rows[0]!.uses).toBe(1);
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(1);
    expect((await db.pool.query('SELECT * FROM ops.onboarding_notifications')).rowCount).toBe(1);
    expect((await db.pool.query('SELECT * FROM ops.review_notification_events')).rowCount).toBe(1);
    expect(
      (
        await db.pool.query(
          "SELECT * FROM ops.review_notification_deliveries WHERE status='cancelled' AND lease_id IS NULL"
        )
      ).rowCount
    ).toBe(2);
  });
  it('does not mutate a pending draft without a currently valid invitation', async () => {
    await db.pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id) VALUES('line',$1,'Unchanged pending',$2)",
      [subject, region]
    );
    const before = (await db.pool.query('SELECT * FROM identity.onboarding_applications')).rows;
    await expect(redeem(subject, 'z'.repeat(43))).rejects.toThrow('unavailable');
    await query('SELECT admin.revoke_line_invite($1,$2,$3)', [
      invite.id,
      invite.revision,
      'Synthetic revoke'
    ]);
    await expect(redeem()).rejects.toThrow('unavailable');
    expect((await db.pool.query('SELECT * FROM identity.onboarding_applications')).rows).toEqual(
      before
    );
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(0);
  });
  it('stores only a short-lived subject-bound resume hash, prevents ordinary downgrades and rejects cross-subject/expired resumes', async () => {
    const nonce = randomUUID(),
      resume = 'r'.repeat(43);
    await query(
      'SELECT platform.remember_line_invite($1,$2,$3,$4)',
      [subject, cap, nonce, resume],
      null
    );
    await expect(
      query('SELECT * FROM platform.line_invite_continuations', [], null)
    ).rejects.toThrow();
    await expect(
      query('SELECT platform.line_invite_continuation($1)', [subject], null, true)
    ).rejects.toThrow();
    await expect(
      query('SELECT platform.line_invite_target($1,$2)', [subject, resume], null)
    ).rejects.toThrow();
    expect(
      (
        await db.pool.query(
          "SELECT token_hash=public.digest($1,'sha256') matched,expires_at<=created_at+INTERVAL '15 minutes' bounded FROM platform.line_invite_continuations",
          [resume]
        )
      ).rows[0]
    ).toEqual({ matched: true, bounded: true });
    expect(
      (
        await query<{ nonce: string }>(
          'SELECT platform.line_invite_continuation($1) nonce',
          [subject],
          null
        )
      ).rows[0]!.nonce
    ).toBe(nonce);
    await expect(
      query(
        'SELECT platform.submit_line_application($1,$2,$3,$4,$5,$6)',
        [subject, 'x'.repeat(43), 'Draft', 'draft@example.invalid', '+65960000009', 'tw-general'],
        null
      )
    ).rejects.toThrow('continuation required');
    await expect(redeem('U' + 'b'.repeat(32), resume)).rejects.toThrow('unavailable');
    expect((await redeem(subject, resume)).rows[0]!.data.status).toBe('approved');
    expect((await db.pool.query('SELECT * FROM platform.line_invite_continuations')).rowCount).toBe(
      0
    );
    const fresh = 'U' + 'c'.repeat(32);
    await query(
      'SELECT platform.remember_line_invite($1,$2,$3,$4)',
      [fresh, cap, randomUUID(), 's'.repeat(43)],
      null
    );
    await db.pool.query(
      "UPDATE platform.line_invite_continuations SET created_at=clock_timestamp()-INTERVAL '16 minutes',expires_at=clock_timestamp()-INTERVAL '2 minutes'"
    );
    await expect(redeem(fresh, 's'.repeat(43))).rejects.toThrow('unavailable');
    expect(
      (
        await query<{ nonce: string | null }>(
          'SELECT platform.line_invite_continuation($1) nonce',
          [fresh],
          null
        )
      ).rows[0]!.nonce
    ).toBeNull();
    expect((await db.pool.query('SELECT * FROM platform.line_invite_continuations')).rowCount).toBe(
      0
    );
  });
  it('does not extend continuation lifetime on repeated status, and can refresh its hash after a signing-key rotation', async () => {
    const nonce = randomUUID(),
      resume = 'r'.repeat(43),
      rotated = 'q'.repeat(43);
    await query(
      'SELECT platform.remember_line_invite($1,$2,$3,$4)',
      [subject, cap, nonce, resume],
      null
    );
    const before = (
      await db.pool.query('SELECT expires_at FROM platform.line_invite_continuations')
    ).rows[0]!.expires_at;
    const stable = await query<{ nonce: string }>(
      'SELECT platform.remember_line_invite($1,$2,$3,$4) nonce',
      [subject, cap, randomUUID(), 's'.repeat(43)],
      null
    );
    expect(stable.rows[0]!.nonce).toBe(nonce);
    expect(
      (await db.pool.query('SELECT expires_at FROM platform.line_invite_continuations')).rows[0]!
        .expires_at
    ).toEqual(before);
    await query(
      'SELECT platform.remember_line_invite($1,$2,$3,$4)',
      [subject, cap, nonce, rotated],
      null
    );
    await expect(redeem(subject, resume)).rejects.toThrow('unavailable');
    expect((await redeem(subject, rotated)).rows[0]!.data.status).toBe('approved');
  });
  it('rechecks continuation expiry after waiting on an existing pending application row', async () => {
    const app = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id) VALUES('line',$1,'Pending',$2) RETURNING id",
        [subject, region]
      )
    ).rows[0]!.id;
    const resume = 'r'.repeat(43);
    await query(
      'SELECT platform.remember_line_invite($1,$2,$3,$4)',
      [subject, cap, randomUUID(), resume],
      null
    );
    const lock = await db.pool.connect();
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM identity.onboarding_applications WHERE id=$1 FOR UPDATE', [
      app
    ]);
    const result = redeem(subject, resume).then(
      () => 'unexpected success',
      () => 'rejected'
    );
    try {
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        waiting = (
          await db.pool.query<{ waiting: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock') waiting",
            [role]
          )
        ).rows[0]!.waiting;
        if (waiting) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await db.pool.query(
        "UPDATE platform.line_invite_continuations SET created_at=clock_timestamp()-INTERVAL '16 minutes',expires_at=clock_timestamp()-INTERVAL '2 minutes'"
      );
    } finally {
      await lock.query('COMMIT');
      lock.release();
    }
    expect(await result).toBe('rejected');
    expect(
      (await db.pool.query('SELECT status FROM identity.onboarding_applications')).rows[0]!.status
    ).toBe('pending');
    expect((await db.pool.query('SELECT uses FROM platform.line_invites')).rows[0]!.uses).toBe(0);
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(0);
  });
  it('rechecks issuer permission after waiting and honors stale revoke versions', async () => {
    await expect(
      query('SELECT admin.revoke_line_invite($1,$2,$3)', [invite.id, 42, 'Stale'])
    ).rejects.toThrow('conflict');
    const client = await db.pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1919,1)');
    const pending = redeem();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await client.query(
      "UPDATE admin.role_grants SET valid_to=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
      [grant]
    );
    await client.query('COMMIT');
    client.release();
    await expect(pending).rejects.toThrow('unavailable');
    expect((await db.pool.query('SELECT uses FROM platform.line_invites')).rows[0]!.uses).toBe(0);
  });
  it('requires current privacy acceptance for new and already approved users while allowing normal manual applications unchanged', async () => {
    await redeem();
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    expect(
      (
        await query<{ data: { status: string } }>(
          'SELECT platform.line_invite_state($1,$2) data',
          [subject, cap],
          null
        )
      ).rows[0]!.data.status
    ).toBe('privacy');
    await expect(redeem('U' + 'b'.repeat(32))).rejects.toThrow('privacy acceptance required');
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='draft'");
    const otherId = 'U' + 'b'.repeat(32),
      short = randomBytes(32).toString('base64url');
    await query('SELECT platform.begin_line_link($1,$2)', [otherId, short], null);
    expect(
      (
        await query<{ state: string }>(
          'SELECT platform.submit_line_application($1,$2,$3,$4,$5,$6) state',
          [otherId, short, 'Manual', 'manual@example.invalid', '+65960000002', 'tw-general'],
          null
        )
      ).rows[0]!.state
    ).toBe('pending');
  });
  it('rejects expired invitations, inactive regions and invalid input without consuming quota', async () => {
    await expect(
      query(
        'SELECT platform.redeem_line_invite($1,$2,$3,$4,$5)',
        [subject, cap, 'Fake', 'invalid', 'bad'],
        null
      )
    ).rejects.toThrow('invalid');
    await db.pool.query(
      "UPDATE platform.line_invites SET created_at=clock_timestamp()-INTERVAL '2 days',expires_at=clock_timestamp()-INTERVAL '1 second'"
    );
    await expect(redeem()).rejects.toThrow('unavailable');
    expect((await db.pool.query('SELECT uses FROM platform.line_invites')).rows[0]!.uses).toBe(0);
  });
});
