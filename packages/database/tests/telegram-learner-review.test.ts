import { randomBytes, randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const opaque = () => randomBytes(32).toString('base64url');
const subject = '548000000059';
interface Result {
  state: string;
  reason?: string;
  messageId?: number;
}
suite('Telegram learner review: actual nonowner SQL and concurrent authorization', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
  let runtime: pg.Pool;
  let role: string;
  let principal: string;
  let region: string;
  let otherRegion: string;
  let application: string;
  const query = <Row extends pg.QueryResultRow>(
    sql: string,
    values: unknown[] = [],
    actor: string | null = null,
    worker = false
  ) =>
    withRequestContext(
      runtime,
      worker ? 'qigong_worker_runtime' : 'qigong_api_runtime',
      { requestId: randomUUID(), ...(actor ? { principalId: actor } : {}) },
      (c) => c.query<Row>(sql, values)
    );
  const optIn = async (enabled = true) => {
    const rev = (
      await db.pool.query<{ revision: number }>(
        'SELECT revision FROM admin.review_notification_preferences WHERE principal_id=$1',
        [principal]
      )
    ).rows[0]!.revision;
    await query(
      "SELECT admin.save_telegram_learner_review_preferences($1,false,true,'en',false,$2,$3)",
      [rev, enabled, enabled ? 'telegram-learner-review-v1' : null],
      principal
    );
  };
  const claims = () =>
    query<{ id: string; lease_id: string }>(
      'SELECT * FROM ops.claim_telegram_learner_reviews(5)',
      [],
      null,
      true
    );
  const payload = (id: string, lease: string, token: string) =>
    query<{ data: { allowed: boolean; sourceId?: string } }>(
      'SELECT ops.telegram_learner_review_payload($1,$2,$3) data',
      [id, lease, token],
      null,
      true
    );
  const deliver = async (message = 590) => {
    const job = (await claims()).rows[0]!;
    const token = opaque();
    expect((await payload(job.id, job.lease_id, token)).rows[0]!.data.allowed).toBe(true);
    expect(
      (
        await query<{ ok: boolean }>(
          'SELECT ops.finish_telegram_learner_review($1,$2,$3) ok',
          [job.id, job.lease_id, message],
          null,
          true
        )
      ).rows[0]!.ok
    ).toBe(true);
    return { ...job, token, message };
  };
  const action = async (
    token: string,
    name: string,
    next = opaque(),
    from = subject,
    message = 590
  ) => {
    const result = await query<{ data: Result }>(
      'SELECT platform.telegram_learner_review_action($1,$2,$3,$4,$5) data',
      [from, message, token, name, next]
    );
    return { ...result.rows[0]!.data, token: next };
  };
  beforeEach(async () => {
    db = await createIsolatedTestDatabase(base!);
    await runMigrations(db.pool, directory, 'tgapply-test');
    role = 'tgapply_test_' + randomUUID().replaceAll('-', '');
    await db.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS`);
    await db.pool.query(`GRANT qigong_api_runtime,qigong_worker_runtime TO ${role}`);
    const url = new URL(db.databaseUrl);
    url.username = role;
    runtime = new pg.Pool({ connectionString: url.href });
    principal = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://tgapply.example.invalid','reviewer','Synthetic reviewer') RETURNING id"
      )
    ).rows[0]!.id;
    const regions = (
      await db.pool.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('tg-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tg-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tg-region','operational','地區','Region' FROM c UNION ALL SELECT id,'tg-other','operational','其他','Other' FROM c RETURNING id"
      )
    ).rows;
    region = regions[0]!.id;
    otherRegion = regions[1]!.id;
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,valid_from,reason) SELECT $1,id,'region',$2,clock_timestamp()-INTERVAL '1 day','Synthetic grant' FROM admin.roles WHERE code='regional_admin'",
      [principal, region]
    );
    // Use the real two-sided binding; direct review is still off afterwards.
    const binding = opaque();
    const link = (
      await query<{ data: { id: string } }>(
        'SELECT admin.begin_review_notification_link($1) data',
        [binding],
        principal
      )
    ).rows[0]!.data;
    await query('SELECT platform.claim_review_notification_link($1,$2,$3)', [
      binding,
      subject,
      '123456'
    ]);
    await query(
      'SELECT admin.confirm_review_notification_link($1,$2,1)',
      [link.id, '123456'],
      principal
    );
    await query(
      "SELECT admin.save_review_notification_preferences(2,false,true,'en',false)",
      [],
      principal
    );
    application = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164) VALUES('line',$1,'Synthetic nickname',$2,'Synthetic self-report','synthetic@example.invalid','+659900000059') RETURNING id",
        ['U' + randomBytes(16).toString('hex'), region]
      )
    ).rows[0]!.id;
  });
  afterEach(async () => {
    await runtime?.end();
    if (role) {
      await db.pool.query(`DROP OWNED BY ${role}`);
      await db.pool.query(`DROP ROLE ${role}`);
    }
    await db?.dispose();
  });
  it('keeps existing learner consent count-only and requires the exact revised disclosure', async () => {
    expect((await claims()).rows).toEqual([]);
    await expect(
      query(
        "SELECT admin.save_telegram_learner_review_preferences(3,false,true,'en',false,true,'old')",
        [],
        principal
      )
    ).rejects.toThrow('invalid');
    await optIn();
    expect((await claims()).rows).toHaveLength(1);
    expect(
      (
        await query<{ data: { learnerReviewEnabled: boolean } }>(
          'SELECT admin.review_notification_state() data',
          [],
          principal
        )
      ).rows[0]!.data.learnerReviewEnabled
    ).toBe(true);
  });
  it('separates per-application leases, hashes tokens, and scrubs revoked pre-send payloads', async () => {
    await optIn();
    await db.pool.query(
      'INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164) SELECT platform,$1,display_name,requested_region_id,learner_name,website_email,phone_e164 FROM identity.onboarding_applications WHERE id=$2',
      ['U' + randomBytes(16).toString('hex'), application]
    );
    const jobs = (await claims()).rows;
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((j) => j.lease_id)).size).toBe(2);
    const token = opaque();
    expect((await payload(jobs[0]!.id, jobs[0]!.lease_id, token)).rows[0]!.data.allowed).toBe(true);
    const raw = (
      await db.pool.query<{ token_hash: Buffer }>(
        'SELECT token_hash FROM ops.telegram_learner_reviews WHERE id=$1',
        [jobs[0]!.id]
      )
    ).rows[0]!;
    expect(raw.token_hash).toEqual(createHash('sha256').update(token).digest());
    await optIn(false);
    expect((await payload(jobs[0]!.id, jobs[0]!.lease_id, opaque())).rows[0]!.data).toEqual({
      allowed: false
    });
  });
  it('requires sender/message/current state, then commits approval, audit and result outbox exactly once', async () => {
    await optIn();
    const j = await deliver();
    expect((await action(j.token, 'approve', opaque(), '548000000060')).state).toBe('unavailable');
    expect((await action(j.token, 'approve', opaque(), subject, 591)).state).toBe('unavailable');
    expect((await action(j.token, 'confirm')).state).toBe('unavailable');
    const confirm = await action(j.token, 'approve');
    expect(confirm.state).toBe('confirm_approve');
    expect((await action(j.token, 'confirm')).state).toBe('unavailable');
    const results = await Promise.all([
      action(confirm.token, 'confirm'),
      action(confirm.token, 'confirm')
    ]);
    expect(results.map((r) => r.state).sort()).toEqual(['decided', 'unavailable']);
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(1);
    expect(
      (await db.pool.query("SELECT * FROM audit.events WHERE action='onboarding.approved'"))
        .rowCount
    ).toBe(1);
    expect((await db.pool.query('SELECT * FROM ops.onboarding_notifications')).rowCount).toBe(1);
  });
  it('supports selected reasons, custom explicit prompt replies, second confirmation and cancellation', async () => {
    await optIn();
    const j = await deliver();
    const deny = await action(j.token, 'deny');
    const selected = await action(deny.token, 'incomplete');
    expect(selected.state).toBe('confirm_deny');
    const cancel = await action(selected.token, 'cancel');
    expect(cancel.state).toBe('ready');
    const denial = await action(cancel.token, 'deny');
    const custom = await action(denial.token, 'custom');
    expect(custom.state).toBe('input');
    await query('SELECT platform.telegram_learner_review_prompt($1,590,$2,592)', [
      subject,
      custom.token
    ]);
    const reply = async (from: string, prompt: number, text: string) =>
      (
        await query<{ data: Result }>(
          'SELECT platform.telegram_learner_review_reason($1,$2,$3,$4) data',
          [from, prompt, text, opaque()]
        )
      ).rows[0]!.data;
    expect((await reply(subject, 593, 'Wrong prompt')).state).toBe('unavailable');
    expect((await reply('548000000060', 592, 'Wrong sender')).state).toBe('unavailable');
    expect((await reply(subject, 592, '/journal')).state).toBe('unavailable');
    expect((await reply(subject, 592, ' ')).state).toBe('unavailable');
    const token = opaque();
    expect(
      (
        await query<{ data: Result }>(
          'SELECT platform.telegram_learner_review_reason($1,592,$2,$3) data',
          [subject, '<plain reason>', token]
        )
      ).rows[0]!.data.state
    ).toBe('confirm_deny');
    expect((await action(token, 'confirm')).state).toBe('decided');
    expect(
      (
        await db.pool.query<{ rejection_reason: string }>(
          'SELECT rejection_reason FROM identity.onboarding_applications WHERE id=$1',
          [application]
        )
      ).rows[0]!.rejection_reason
    ).toBe('<plain reason>');
    expect((await reply(subject, 592, 'Replay')).state).toBe('unavailable');
  });
  it.each([
    'off',
    'rebind',
    'expired',
    'grant',
    'principal',
    'region',
    'edit',
    'webadmin'
  ] as const)('invalidates %s before any decision', async (change) => {
    await optIn();
    const j = await deliver();
    const confirm = await action(j.token, 'approve');
    if (change === 'off') await optIn(false);
    if (change === 'rebind')
      await db.pool.query(
        "UPDATE admin.review_notification_preferences SET telegram_subject='548000000061',revision=revision+1 WHERE principal_id=$1",
        [principal]
      );
    if (change === 'expired')
      await db.pool.query(
        "UPDATE ops.telegram_learner_reviews SET expires_at=clock_timestamp()-INTERVAL '1 second'"
      );
    if (change === 'grant')
      await db.pool.query(
        "UPDATE admin.role_grants SET valid_to=clock_timestamp()-INTERVAL '1 second' WHERE principal_id=$1",
        [principal]
      );
    if (change === 'principal')
      await db.pool.query("UPDATE admin.principals SET status='suspended' WHERE id=$1", [
        principal
      ]);
    if (change === 'region')
      await db.pool.query(
        'UPDATE identity.onboarding_applications SET requested_region_id=$1 WHERE id=$2',
        [otherRegion, application]
      );
    if (change === 'edit')
      await db.pool.query(
        "UPDATE identity.onboarding_applications SET learner_name='Changed self-report' WHERE id=$1",
        [application]
      );
    if (change === 'webadmin')
      await query(
        "SELECT identity.decide_application($1,'rejected','Synthetic WebAdmin decision')",
        [application],
        principal
      );
    expect(['unavailable', 'stale']).toContain((await action(confirm.token, 'confirm')).state);
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(0);
  });
  it.each(['grant', 'region', 'expiry'] as const)(
    'rechecks %s after a real authorization lock wait, not its transaction start',
    async (change) => {
      await optIn();
      const j = await deliver();
      const confirm = await action(j.token, 'approve');
      const blocker = await db.pool.connect();
      try {
        await blocker.query('BEGIN');
        if (change === 'grant')
          await blocker.query(
            "UPDATE admin.role_grants SET valid_to=clock_timestamp()-INTERVAL '1 second' WHERE principal_id=$1",
            [principal]
          );
        else if (change === 'region')
          await blocker.query(
            'UPDATE identity.onboarding_applications SET requested_region_id=$1 WHERE id=$2',
            [otherRegion, application]
          );
        else {
          await db.pool.query(
            "UPDATE ops.telegram_learner_reviews SET expires_at=clock_timestamp()+INTERVAL '500 milliseconds'"
          );
          await blocker.query(
            'SELECT id FROM identity.onboarding_applications WHERE id=$1 FOR UPDATE',
            [application]
          );
        }
        const decision = action(confirm.token, 'confirm');
        // Wait for the actual lock waiter, not a scheduling delay.
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await blocker.query<{ n: number }>(
            "SELECT count(*)::integer n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()"
          );
          if (waiting.rows[0]!.n > 0) break;
          if (attempt === 99) throw Error('No authorization lock waiter observed');
        }
        if (change === 'expiry') await blocker.query('SELECT pg_sleep(0.6)');
        await blocker.query('COMMIT');
        expect((await decision).state).toBe('unavailable');
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
      }
      expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(0);
    }
  );
  it('preserves administrator/test batching while direct learner leases remain per application', async () => {
    await optIn();
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic' FROM admin.roles WHERE code='super_admin'",
      [principal]
    );
    await query(
      "SELECT admin.save_telegram_learner_review_preferences(4,true,true,'en',false,true,'telegram-learner-review-v1')",
      [],
      principal
    );
    for (let n = 0; n < 2; n++) {
      const target = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://tgapply.example.invalid',$1,'Synthetic pending') RETURNING id",
          ['pending-' + n]
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO admin.access_applications(principal_id,status,version,requested_role,scope_description,applicant_reason) VALUES($1,'pending',2,'coach_admin','Synthetic scope','Synthetic reason')",
        [target]
      );
      await db.pool.query(
        "INSERT INTO ops.review_notification_events(kind,target_id,version) VALUES('test',$1,$2)",
        [principal, 'test-' + n]
      );
    }
    await query('SELECT ops.queue_review_notifications(200)', [], null, true);
    await db.pool.query(
      'UPDATE ops.review_notification_deliveries SET available_at=clock_timestamp()'
    );
    const jobs = await query<{ id: string; lease_id: string }>(
      'SELECT * FROM ops.claim_review_notifications(5)',
      [],
      null,
      true
    );
    const messages = [];
    for (const j of jobs.rows)
      messages.push(
        (
          await query<{ data: { kind: string; count: number } }>(
            'SELECT ops.review_notification_payload($1,$2) data',
            [j.id, j.lease_id],
            null,
            true
          )
        ).rows[0]!.data
      );
    expect(messages.map((m) => [m.kind, m.count]).sort()).toEqual([
      ['admin', 2],
      ['test', 2]
    ]);
    expect((await claims()).rows).toHaveLength(1);
    expect(
      (
        await query<{ data: { unroutedCount: number } }>(
          'SELECT admin.review_notification_state() data',
          [],
          principal
        )
      ).rows[0]!.data.unroutedCount
    ).toBe(0);
  });
  it('rotates ambiguous-send tokens on lease recovery and never revives the old message', async () => {
    await optIn();
    const j = (await claims()).rows[0]!;
    const old = opaque();
    await payload(j.id, j.lease_id, old);
    await query(
      'SELECT ops.finish_telegram_learner_review($1,$2,NULL)',
      [j.id, j.lease_id],
      null,
      true
    );
    await db.pool.query('UPDATE ops.telegram_learner_reviews SET available_at=clock_timestamp()');
    const fresh = await deliver(591);
    expect(fresh.lease_id).not.toBe(j.lease_id);
    expect((await action(old, 'approve')).state).toBe('unavailable');
    expect((await action(fresh.token, 'approve', opaque(), subject, 591)).state).toBe(
      'confirm_approve'
    );
  });
  it('serializes independent reviewers and lazily clears the other authorized stale message', async () => {
    await optIn();
    const first = await deliver();
    const firstConfirm = await action(first.token, 'approve');
    const second = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://tgapply.example.invalid','second','Synthetic second') RETURNING id"
      )
    ).rows[0]!.id;
    await db.pool.query(
      'INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,valid_from,reason) SELECT $1,role_id,scope_type,region_id,valid_from,reason FROM admin.role_grants WHERE principal_id=$2',
      [second, principal]
    );
    await db.pool.query(
      "INSERT INTO admin.review_notification_preferences(principal_id,telegram_subject,learner_enabled,learner_review_enabled,learner_review_disclosure,locale) VALUES($1,'548000000060',true,true,'telegram-learner-review-v1','en')",
      [second]
    );
    const secondJob = await deliver(600);
    const secondConfirm = await action(secondJob.token, 'approve', opaque(), '548000000060', 600);
    const results = await Promise.all([
      action(firstConfirm.token, 'confirm'),
      action(secondConfirm.token, 'confirm', opaque(), '548000000060', 600)
    ]);
    expect(results.map((r) => r.state).sort()).toEqual(['decided', 'stale']);
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(1);
    expect(
      (await db.pool.query("SELECT * FROM audit.events WHERE action='onboarding.approved'"))
        .rowCount
    ).toBe(1);
  });
  it('rolls back a failed business audit and restores the original context before a safe retry', async () => {
    await optIn();
    const j = await deliver();
    const confirm = await action(j.token, 'approve');
    await db.pool.query(
      "CREATE FUNCTION audit.tgapply_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='onboarding.approved' THEN RAISE EXCEPTION 'Synthetic audit failure';END IF;RETURN NEW;END$$;CREATE TRIGGER tgapply_fail BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.tgapply_fail()"
    );
    await expect(action(confirm.token, 'confirm')).rejects.toThrow('Synthetic audit failure');
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(0);
    expect((await db.pool.query('SELECT * FROM ops.onboarding_notifications')).rowCount).toBe(0);
    await db.pool.query(
      'DROP TRIGGER tgapply_fail ON audit.events;DROP FUNCTION audit.tgapply_fail()'
    );
    expect((await action(confirm.token, 'confirm')).state).toBe('decided');
  });
  it('restores principal on success/failure and seals table/internal function/PUBLIC ACL surfaces', async () => {
    await optIn();
    const j = await deliver();
    const confirm = await action(j.token, 'approve');
    const check = async () =>
      withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, async (c) => {
        await c.query('SELECT platform.telegram_learner_review_action($1,590,$2,$3,$4)', [
          subject,
          confirm.token,
          'confirm',
          opaque()
        ]);
        return (
          await c.query<{ actor: string | null }>('SELECT admin.request_principal_id() actor')
        ).rows[0]!.actor;
      });
    expect(await check()).toBeNull();
    await expect(query('SELECT * FROM ops.telegram_learner_reviews')).rejects.toThrow();
    await expect(
      query('SELECT ops.telegram_learner_review_allowed($1,$2)', [principal, region])
    ).rejects.toThrow();
    await expect(query('SELECT admin.review_notification_state_58()')).rejects.toThrow();
    await expect(query('SELECT ops.claim_telegram_learner_reviews(5)')).rejects.toThrow();
    await expect(
      query(
        'SELECT platform.telegram_learner_review_action($1,590,$2,$3,$4)',
        [subject, opaque(), 'approve', opaque()],
        null,
        true
      )
    ).rejects.toThrow();
    const publicAcl = await db.pool.query(
      "SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.proname LIKE '%telegram_learner_review%' AND a.grantee=0"
    );
    expect(publicAcl.rows).toEqual([]);
    expect(
      (
        await db.pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='ops.telegram_learner_reviews'::regclass"
        )
      ).rows[0]
    ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
