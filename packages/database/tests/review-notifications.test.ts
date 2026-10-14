import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Scoped private reviewer outbox and two-sided Telegram binding', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    role: string,
    superId: string,
    regional: string,
    region: string,
    otherRegion: string,
    appId: string;
  let cleanups: Array<() => Promise<void>> = [];
  const query = <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
    principal: string | null = superId,
    worker = false
  ) =>
    withRequestContext(
      runtime,
      worker ? 'qigong_worker_runtime' : 'qigong_api_runtime',
      { requestId: randomUUID(), ...(principal ? { principalId: principal } : {}) },
      (c) => c.query<Row>(sql, values)
    );
  const bind = async (principal = superId, subject = '548000000032') => {
    const token = randomBytes(32).toString('base64url'),
      link = (
        await query<{ data: { id: string } }>(
          'SELECT admin.begin_review_notification_link($1) data',
          [token],
          principal
        )
      ).rows[0]!.data;
    expect(
      (
        await query<{ claimed: boolean }>(
          'SELECT platform.claim_review_notification_link($1,$2,$3) claimed',
          [token, subject, '123456'],
          null
        )
      ).rows[0]!.claimed
    ).toBe(true);
    expect(
      (
        await query<{ data: { confirmed: boolean } }>(
          'SELECT admin.confirm_review_notification_link($1,$2,1) data',
          [link.id, '123456'],
          principal
        )
      ).rows[0]!.data.confirmed
    ).toBe(true);
    await query(
      "SELECT admin.save_review_notification_preferences(2,true,true,'zh_TW',false)",
      [],
      principal
    );
  };
  const learner = async (targetRegion = region, complete = true) => {
    const id = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id) VALUES('line',$1,'Private applicant',$2) RETURNING id",
        ['U' + randomBytes(16).toString('hex'), targetRegion]
      )
    ).rows[0]!.id;
    if (complete)
      await db.pool.query(
        "UPDATE identity.onboarding_applications SET learner_name='Private legal name',website_email='private@example.invalid',phone_e164='+659900000032',updated_at=clock_timestamp() WHERE id=$1",
        [id]
      );
    return id;
  };
  const queue = () => query('SELECT ops.queue_review_notifications(200)', [], null, true);
  const claim = async () => {
    await db.pool.query(
      "UPDATE ops.review_notification_deliveries SET available_at=clock_timestamp()-INTERVAL '1 second'"
    );
    return query<{ id: string; lease_id: string }>(
      'SELECT * FROM ops.claim_review_notifications(5)',
      [],
      null,
      true
    );
  };
  beforeEach(async () => {
    cleanups = [];
    db = await createIsolatedTestDatabase(base!);
    const database = db;
    cleanups.push(() => database.dispose());
    await runMigrations(db.pool, directory, 'review-test');
    role = 'qigong_review_test_' + randomUUID().replaceAll('-', '');
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
    const pool = runtime;
    cleanups.push(() => pool.end());
    const ids = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://review.example.invalid','super','Synthetic super'),('https://review.example.invalid','regional','Synthetic regional') RETURNING id"
      )
    ).rows;
    superId = ids[0]!.id;
    regional = ids[1]!.id;
    const regions = (
      await db.pool.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('review-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'review-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tw-general','operational','台灣','Taiwan' FROM c UNION ALL SELECT id,'review-other','operational','另一地區','Other' FROM c RETURNING id"
      )
    ).rows;
    region = regions[0]!.id;
    otherRegion = regions[1]!.id;
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,valid_from,reason) SELECT $1,id,'global',NULL,clock_timestamp()-INTERVAL '1 day','Synthetic' FROM admin.roles WHERE code='super_admin'",
      [superId]
    );
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,valid_from,reason) SELECT $1,id,'region',$2,clock_timestamp()-INTERVAL '1 day','Synthetic' FROM admin.roles WHERE code='regional_admin'",
      [regional, region]
    );
    appId = '';
  });
  afterEach(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup();
  });
  it('requires admin+Telegram+correct confirmation, hashes secrets and persists wrong-code attempts', async () => {
    const token = randomBytes(32).toString('base64url'),
      link = (
        await query<{ data: { id: string } }>(
          'SELECT admin.begin_review_notification_link($1) data',
          [token]
        )
      ).rows[0]!.data;
    expect(
      (
        await query<{ claimed: boolean }>(
          'SELECT platform.claim_review_notification_link($1,$2,$3) claimed',
          [token, '54832', '123456'],
          null
        )
      ).rows[0]!.claimed
    ).toBe(true);
    await expect(
      query('SELECT admin.confirm_review_notification_link($1,$2,1)', [link.id, '123456'], regional)
    ).rejects.toThrow('conflict');
    for (let i = 0; i < 5; i++)
      expect(
        (
          await query<{ data: { confirmed: boolean } }>(
            'SELECT admin.confirm_review_notification_link($1,$2,1) data',
            [link.id, '654321']
          )
        ).rows[0]!.data.confirmed
      ).toBe(false);
    const raw = (
      await db.pool.query(
        'SELECT attempts,revoked_at,token_hash,code_hash FROM admin.review_notification_links'
      )
    ).rows[0]!;
    expect(raw.attempts).toBe(5);
    expect(raw.revoked_at).toBeTruthy();
    expect(Buffer.isBuffer(raw.token_hash)).toBe(true);
    expect(
      JSON.stringify(
        (await query<{ data: unknown }>('SELECT admin.review_notification_state() data')).rows[0]!
          .data
      )
    ).not.toContain(token);
  });
  it('only emits complete learner submissions and admin pending transitions, never drafts or auto-approved invites', async () => {
    await learner(region, false);
    expect((await db.pool.query('SELECT * FROM ops.review_notification_events')).rowCount).toBe(0);
    appId = await learner();
    expect((await db.pool.query('SELECT * FROM ops.review_notification_events')).rowCount).toBe(1);
    await db.pool.query(
      'UPDATE identity.onboarding_applications SET display_name=display_name WHERE id=$1',
      [appId]
    );
    expect((await db.pool.query('SELECT * FROM ops.review_notification_events')).rowCount).toBe(1);
    const principal = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://review.example.invalid','applicant','Private applicant') RETURNING id"
      )
    ).rows[0]!.id;
    await db.pool.query('INSERT INTO admin.access_applications(principal_id) VALUES($1)', [
      principal
    ]);
    expect((await db.pool.query('SELECT * FROM ops.review_notification_events')).rowCount).toBe(1);
    await db.pool.query(
      "UPDATE admin.access_applications SET status='pending',version=version+1,requested_role='regional_admin',scope_description='Region',applicant_reason='Private reason' WHERE principal_id=$1",
      [principal]
    );
    expect((await db.pool.query('SELECT * FROM ops.review_notification_events')).rowCount).toBe(2);
  });
  it('routes only to bound opted-in in-scope admins and aggregates without applicant PII', async () => {
    await bind(regional, '548000000033');
    await learner();
    await learner();
    await learner(otherRegion);
    await queue();
    expect((await db.pool.query('SELECT * FROM ops.review_notification_deliveries')).rowCount).toBe(
      2
    );
    const jobs = await claim();
    expect(jobs.rowCount).toBe(1);
    const j = jobs.rows[0]!,
      payload = (
        await query<{ data: { allowed: boolean; recipient: string; count: number; kind: string } }>(
          'SELECT ops.review_notification_payload($1,$2) data',
          [j.id, j.lease_id],
          null,
          true
        )
      ).rows[0]!.data;
    expect(payload.allowed).toBe(true);
    expect(payload.count).toBe(2);
    expect(payload.recipient).toBe('548000000033');
    const text = JSON.stringify(payload);
    expect(text).not.toContain('private@example.invalid');
    expect(text).not.toContain('Private legal name');
  });
  it('rechecks grants and pending state before sending, and restores the caller context after scope probes', async () => {
    await bind();
    appId = await learner();
    await queue();
    const j = (await claim()).rows[0]!;
    await db.pool.query(
      "UPDATE admin.role_grants SET valid_to=clock_timestamp()-INTERVAL '1 second' WHERE principal_id=$1",
      [superId]
    );
    expect(
      (
        await query<{ data: { allowed: boolean } }>(
          'SELECT ops.review_notification_payload($1,$2) data',
          [j.id, j.lease_id],
          null,
          true
        )
      ).rows[0]!.data.allowed
    ).toBe(false);
  });
  it('cancels resolved or moved-region requests before pre-send and never emits review alerts for auto-approved LINE invites', async () => {
    await bind(regional, '548000000034');
    appId = await learner();
    await queue();
    const job = (await claim()).rows[0]!;
    await db.pool.query(
      'UPDATE identity.onboarding_applications SET requested_region_id=$1,updated_at=clock_timestamp() WHERE id=$2',
      [otherRegion, appId]
    );
    expect(
      (
        await query<{ data: { allowed: boolean } }>(
          'SELECT ops.review_notification_payload($1,$2) data',
          [job.id, job.lease_id],
          null,
          true
        )
      ).rows[0]!.data.allowed
    ).toBe(false);
    expect((await db.pool.query('SELECT * FROM ops.review_notification_events')).rowCount).toBe(2);
    await db.pool.query(
      "UPDATE identity.onboarding_applications SET status='rejected',decided_at=clock_timestamp(),decided_by_principal_id=$1,rejection_reason='Synthetic reviewed' WHERE id=$2",
      [superId, appId]
    );
    await queue();
    expect((await claim()).rowCount).toBe(0);
    const token = randomBytes(32).toString('base64url');
    await query('SELECT admin.create_line_invite($1,$2,$3,$4,$5,$6)', [
      token,
      'Synthetic preapproval',
      'tw-general',
      new Date(Date.now() + 86400000).toISOString(),
      1,
      'Synthetic review'
    ]);
    await query(
      'SELECT platform.redeem_line_invite($1,$2,$3,$4,$5)',
      [
        'U' + 'd'.repeat(32),
        token,
        'Synthetic invited',
        'synthetic@example.invalid',
        '+659900000034'
      ],
      null
    );
    expect((await db.pool.query('SELECT * FROM ops.review_notification_events')).rowCount).toBe(2);
  });
  it('routes master-role applications only to super and ordinary access requests to permitted managers', async () => {
    const manager = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://review.example.invalid','master','Synthetic master') RETURNING id"
      )
    ).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic' FROM admin.roles WHERE code='master_admin'",
      [manager]
    );
    await bind(manager, '548000000035');
    await bind();
    for (const requested of ['master_admin', 'coach_admin']) {
      const target = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://review.example.invalid',$1,'Private applicant') RETURNING id",
          [requested]
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO admin.access_applications(principal_id,status,version,requested_role,scope_description,applicant_reason) VALUES($1,'pending',2,$2,'Synthetic scope','Private reason')",
        [target, requested]
      );
    }
    await queue();
    const deliveries = (
      await db.pool.query<{ principal_id: string; requested_role: string }>(
        'SELECT d.principal_id,a.requested_role FROM ops.review_notification_deliveries d JOIN ops.review_notification_events e ON e.id=d.event_id JOIN admin.access_applications a ON a.principal_id=e.target_id ORDER BY 1,2'
      )
    ).rows;
    expect(
      deliveries.filter((d) => d.principal_id === manager).map((d) => d.requested_role)
    ).toEqual(['coach_admin']);
    expect(deliveries.filter((d) => d.principal_id === superId)).toHaveLength(2);
  });
  it('does not queue while subscriptions are off and shows unrouted warnings', async () => {
    appId = await learner();
    const state = (
      await query<{ data: { pendingCount: number; unroutedCount: number; bound: boolean } }>(
        'SELECT admin.review_notification_state() data'
      )
    ).rows[0]!.data;
    expect(state.bound).toBe(false);
    expect(state.pendingCount).toBe(1);
    expect(state.unroutedCount).toBe(1);
    await queue();
    expect((await db.pool.query('SELECT * FROM ops.review_notification_deliveries')).rowCount).toBe(
      0
    );
  });
  it('cancels pending jobs on disconnect and permits explicit re-subscription with a new revision', async () => {
    await bind();
    await learner();
    await queue();
    await query("SELECT admin.save_review_notification_preferences(3,false,false,'zh_TW',false)");
    await queue();
    expect(
      (await db.pool.query('SELECT status FROM ops.review_notification_deliveries')).rows[0]!.status
    ).toBe('cancelled');
    await query("SELECT admin.save_review_notification_preferences(4,true,true,'zh_TW',false)");
    await queue();
    expect(
      (await db.pool.query('SELECT status FROM ops.review_notification_deliveries')).rows[0]!.status
    ).toBe('pending');
  });
  it('keeps the leader in every50-event merged lease under large bursts', async () => {
    await bind();
    await db.pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164) SELECT 'line','U'||md5('review-burst-'||n),'Private legal',$1,'Private legal','private@example.invalid','+659900000038' FROM generate_series(1,101) n",
      [region]
    );
    await queue();
    const jobs = await claim();
    expect(jobs.rows).toHaveLength(3);
    const counts: number[] = [];
    for (const j of jobs.rows) {
      const data = (
        await query<{ data: { allowed: boolean; count: number } }>(
          'SELECT ops.review_notification_payload($1,$2) data',
          [j.id, j.lease_id],
          null,
          true
        )
      ).rows[0]!.data;
      expect(data.allowed).toBe(true);
      counts.push(data.count);
    }
    expect(counts.sort((a, b) => b - a)).toEqual([50, 50, 1]);
  });
  it('keeps caller principal context unchanged after an internal recipient permission probe', async () => {
    appId = await learner();
    const event = (
      await db.pool.query<{ id: string }>('SELECT id FROM ops.review_notification_events')
    ).rows[0]!.id;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('qigong.principal_id',$1,true)", [superId]);
      await client.query('SELECT admin.review_notification_can_review($1,$2)', [regional, event]);
      expect(
        (await client.query<{ id: string }>('SELECT admin.request_principal_id() id')).rows[0]!.id
      ).toBe(superId);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
  it('retries failures with leases and does not repeat sent events or expose runtime tables', async () => {
    await bind();
    await learner();
    await queue();
    const j = (await claim()).rows[0]!;
    expect(
      (
        await query<{ ok: boolean }>(
          'SELECT ops.finish_review_notification($1,$2,false) ok',
          [j.id, j.lease_id],
          null,
          true
        )
      ).rows[0]!.ok
    ).toBe(true);
    expect(
      (await db.pool.query('SELECT status,attempts FROM ops.review_notification_deliveries'))
        .rows[0]
    ).toEqual({ status: 'pending', attempts: 1 });
    await db.pool.query(
      'UPDATE ops.review_notification_deliveries SET available_at=clock_timestamp()'
    );
    const k = (await claim()).rows[0]!;
    await query(
      'SELECT ops.finish_review_notification($1,$2,true)',
      [k.id, k.lease_id],
      null,
      true
    );
    await queue();
    expect((await claim()).rowCount).toBe(0);
    await expect(query('SELECT * FROM admin.review_notification_preferences')).rejects.toThrow();
    await expect(
      query('SELECT admin.review_notification_state()', [], null, true)
    ).rejects.toThrow();
  });
});
