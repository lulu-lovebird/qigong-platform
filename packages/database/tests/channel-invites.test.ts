import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const opaque = () => randomBytes(32).toString('base64url');
type Platform = 'telegram' | 'whatsapp';
interface Invite {
  id: string;
  revision: number;
}
interface State {
  status: string;
  nonce?: string;
  alreadyMember?: boolean;
  region?: string;
  pendingApplication?: boolean;
}
suite('Additive46to47 invitation upgrade preservation', () => {
  it('preserves all86 old tables, security metadata and other functions with worker/runtime gates unchanged', async () => {
    const database = await createIsolatedTestDatabase(base!);
    const old = await mkdtemp(path.join(tmpdir(), 'channel-before46-'));
    try {
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0047_')
          await copyFile(path.join(directory, file), path.join(old, file));
      await runMigrations(database.pool, old, 'channel-before46');
      await database.pool.query(
        "INSERT INTO identity.people(preferred_name) VALUES('Synthetic preserved learner')"
      );
      const tables = (
        await database.pool.query<{ name: string }>(
          "SELECT schemaname||'.'||tablename name FROM pg_tables WHERE schemaname IN('identity','core','platform','ops','admin','audit') ORDER BY 1"
        )
      ).rows;
      expect(tables).toHaveLength(86);
      const fingerprints = async () => {
        const result: Record<string, string> = {};
        for (const { name } of tables)
          result[name] = (
            await database.pool.query<{ hash: string }>(
              `SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text) hash FROM ${name} r`
            )
          ).rows[0]!.hash;
        return result;
      };
      const security = async () =>
        (
          await database.pool.query(
            "SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner::regrole::text,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname) data FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname||'.'||c.relname=ANY($1)",
            [tables.map((t) => t.name)]
          )
        ).rows[0]!.data as unknown;
      const functions = async () =>
        (
          await database.pool.query(
            "SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) body,p.proowner,p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('identity','core','platform','ops','admin','audit') AND p.prokind='f' AND p.proname NOT IN('submit_telegram_application','submit_whatsapp_application') AND p.oid=ANY($1::oid[]) ORDER BY p.oid",
            [
              (
                await database.pool.query<{ oid: number }>(
                  "SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('identity','core','platform','ops','admin','audit') AND p.proname NOT LIKE '%channel_invite%'"
                )
              ).rows.map((r) => r.oid)
            ]
          )
        ).rows;
      const before = await fingerprints(),
        beforeSecurity = await security(),
        beforeFunctions = await functions();
      expect((await runMigrations(database.pool, directory, 'channel-expand47')).applied).toEqual([
        '0047_channel_invitations.sql'
      ]);
      expect((await runMigrations(database.pool, directory, 'channel-repeat47')).applied).toEqual(
        []
      );
      expect(await fingerprints()).toEqual(before);
      expect(await security()).toEqual(beforeSecurity);
      expect(await functions()).toEqual(beforeFunctions);
      expect(
        (
          await database.pool.query(
            'SELECT ops.achievement_event_streak_schema_ready() ready,ops.versioned_achievements_enabled() enabled'
          )
        ).rows[0]
      ).toEqual({ ready: true, enabled: false });
      expect(
        (
          await database.pool.query(
            "SELECT has_function_privilege('qigong_api_runtime','platform._pre_channel_invite_submit_telegram_application(text,text,text,text,text)','EXECUTE') exposed"
          )
        ).rows[0]!.exposed
      ).toBe(false);
    } finally {
      await database.dispose();
      await rm(old, { recursive: true, force: true });
    }
  });
});
suite('Scoped TG/WA invite approval and subject-bound continuation', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    role: string,
    actor: string,
    session: string,
    grant: string;
  const query = <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
    principal: string | undefined = actor,
    worker = false
  ) =>
    withRequestContext(
      runtime,
      worker ? 'qigong_worker_runtime' : 'qigong_api_runtime',
      { requestId: randomUUID(), ...(principal ? { principalId: principal } : {}) },
      (c) => c.query<Row>(sql, values)
    );
  const create = async (platform: Platform, limit = 1) => {
    const token = opaque();
    const data = (
      await query<{ data: Invite }>(
        'SELECT admin.create_channel_invite($1,$2,$3,$4,$5,$6,$7,$8) data',
        [
          platform,
          token,
          'Synthetic invitation',
          'tw-general',
          new Date(Date.now() + 86400000).toISOString(),
          limit,
          'Synthetic reviewed audience',
          session
        ]
      )
    ).rows[0]!.data;
    return { token, ...data };
  };
  const begin = async (platform: Platform, subject: string, token: string | null) => {
    const nonce = randomUUID(),
      resume = opaque();
    const data = (
      await query<{ data: State }>('SELECT platform.begin_channel_invite($1,$2,$3,$4,$5) data', [
        platform,
        subject,
        token,
        nonce,
        resume
      ])
    ).rows[0]!.data;
    return { data, nonce, resume };
  };
  const redeem = (platform: Platform, token: string, consent = true) =>
    query<{ data: State }>('SELECT platform.redeem_channel_invite($1,$2,$3,$4,$5,$6,$7) data', [
      platform,
      token,
      'Synthetic learner',
      'LEARNER@EXAMPLE.INVALID',
      '+999000000001',
      'zh_TW',
      consent
    ]);
  const state = async (platform: Platform, token: string) =>
    (
      await query<{ data: State }>('SELECT platform.channel_invite_form_state($1,$2,$3) data', [
        platform,
        token,
        'en'
      ])
    ).rows[0]!.data;
  beforeEach(async () => {
    db = await createIsolatedTestDatabase(base!);
    await runMigrations(db.pool, directory, 'channel-invite-test');
    role = 'qigong_channel_test_' + randomUUID().replaceAll('-', '');
    const password = opaque();
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
    grant = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic grant' FROM admin.roles WHERE code='super_admin' RETURNING id",
        [actor]
      )
    ).rows[0]!.id;
    session = opaque();
    await db.pool.query(
      "INSERT INTO admin.sessions(token_hash,principal_id,expires_at) VALUES(public.digest($1,'sha256'),$2,clock_timestamp()+INTERVAL '1 day')",
      [session, actor]
    );
    await db.pool.query(
      "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('channel-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'channel-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en,default_timezone) SELECT id,'tw-general','operational','台灣','Taiwan','Asia/Taipei' FROM c"
    );
  });
  afterEach(async () => {
    await runtime.end();
    await db.pool.query(`DROP OWNED BY ${role}`);
    await db.pool.query(`DROP ROLE ${role}`);
    await db.dispose();
  });
  it('requires a real current super session and does not expose raw tables or secret tokens', async () => {
    const invite = await create('telegram');
    await expect(
      query('SELECT admin.channel_invite_list($1,$2,$3)', ['telegram', 1, opaque()])
    ).rejects.toThrow('denied');
    await expect(query('SELECT * FROM platform.channel_invites')).rejects.toThrow();
    await expect(
      query(
        'SELECT platform.begin_channel_invite($1,$2,$3,$4,$5)',
        ['telegram', '1001', invite.token, randomUUID(), opaque()],
        actor,
        true
      )
    ).rejects.toThrow();
    const list = (
      await query<{ data: unknown }>('SELECT admin.channel_invite_list($1,$2,$3) data', [
        'telegram',
        1,
        session
      ])
    ).rows[0]!.data;
    expect(JSON.stringify(list)).not.toContain(invite.token);
    expect(
      (
        await db.pool.query(
          "SELECT token_hash=public.digest($1,'sha256') same FROM platform.channel_invites",
          [invite.token]
        )
      ).rows[0]!.same
    ).toBe(true);
    await db.pool.query('UPDATE admin.sessions SET revoked_at=clock_timestamp()');
    await expect(create('whatsapp')).rejects.toThrow('denied');
  });
  it.each(['telegram', 'whatsapp'] as const)(
    'approves %s atomically and makes form retries idempotent without personal-data matching',
    async (platform) => {
      const invite = await create(platform, 2),
        a = await begin(platform, '1001', invite.token);
      expect(a.data.status).toBe('form');
      expect((await db.pool.query('SELECT uses FROM platform.channel_invites')).rows[0]!.uses).toBe(
        0
      );
      expect((await redeem(platform, a.resume)).rows[0]!.data).toEqual({
        status: 'approved',
        alreadyMember: false
      });
      expect((await redeem(platform, a.resume)).rows[0]!.data.alreadyMember).toBe(true);
      const b = await begin(platform, '1002', invite.token);
      await redeem(platform, b.resume);
      expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(2);
      expect(
        (await db.pool.query('SELECT * FROM platform.channel_invite_redemptions')).rowCount
      ).toBe(2);
      expect((await db.pool.query('SELECT * FROM ops.onboarding_notifications')).rowCount).toBe(2);
      expect((await db.pool.query('SELECT * FROM admin.role_grants')).rowCount).toBe(1);
      expect(
        (await db.pool.query('SELECT website_email FROM identity.onboarding_applications LIMIT 1'))
          .rows[0]!.website_email
      ).toBe('learner@example.invalid');
      await query('SELECT admin.revoke_channel_invite($1,$2,$3,$4,$5)', [
        platform,
        invite.id,
        1,
        'Synthetic revocation',
        session
      ]);
      expect((await begin(platform, '1001', 'z'.repeat(43))).data.status).toBe('approved');
      expect((await redeem(platform, a.resume)).rows[0]!.data.alreadyMember).toBe(true);
    }
  );
  it.each(['telegram', 'whatsapp'] as const)(
    'serializes the last %s quota and same-subject submissions',
    async (platform) => {
      const invite = await create(platform),
        contexts = await Promise.all(
          ['1001', '1002', '1003'].map((id) => begin(platform, id, invite.token))
        );
      const results = await Promise.allSettled(contexts.map((c) => redeem(platform, c.resume)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await db.pool.query('SELECT uses FROM platform.channel_invites')).rows[0]!.uses).toBe(
        1
      );
      const winner = results.findIndex((r) => r.status === 'fulfilled');
      const retries = await Promise.all([
        redeem(platform, contexts[winner]!.resume),
        redeem(platform, contexts[winner]!.resume)
      ]);
      expect(retries.every((r) => r.rows[0]!.data.alreadyMember)).toBe(true);
    }
  );
  it('scopes shared/private tokens by platform, subject and expiry without sliding continuation lifetime', async () => {
    const invite = await create('telegram');
    expect((await begin('whatsapp', '1001', invite.token)).data.status).toBe('invalid');
    const a = await begin('telegram', '1001', invite.token),
      before = (
        await db.pool.query('SELECT nonce,expires_at FROM platform.channel_invite_continuations')
      ).rows;
    const repeated = await begin('telegram', '1001', null);
    expect(repeated.data.nonce).toBe(a.nonce);
    expect(
      (await db.pool.query('SELECT nonce,expires_at FROM platform.channel_invite_continuations'))
        .rows
    ).toEqual(before);
    await expect(state('whatsapp', a.resume)).rejects.toThrow('unavailable');
    await expect(state('telegram', invite.token)).rejects.toThrow('unavailable');
    expect((await begin('telegram', '1002', null)).data.status).toBe('none');
    await db.pool.query(
      "UPDATE platform.channel_invite_continuations SET created_at=clock_timestamp()-INTERVAL '20 minutes',expires_at=clock_timestamp()-INTERVAL '6 minutes'"
    );
    await expect(redeem('telegram', a.resume)).rejects.toThrow('unavailable');
  });
  it.each(['telegram', 'whatsapp'] as const)(
    'promotes only the same pending %s application after explicit confirmation',
    async (platform) => {
      await db.pool.query(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id) SELECT $1,'1001','Old pending',id FROM core.regions WHERE code='tw-general'",
        [platform]
      );
      const id = (await db.pool.query('SELECT id FROM identity.onboarding_applications')).rows[0]!
        .id;
      const invite = await create(platform),
        c = await begin(platform, '1001', invite.token);
      expect(c.data.pendingApplication).toBe(true);
      await redeem(platform, c.resume);
      expect(
        (await db.pool.query('SELECT id,status FROM identity.onboarding_applications')).rows
      ).toEqual([{ id, status: 'approved' }]);
      expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(1);
    }
  );
  it.each(['telegram', 'whatsapp'] as const)(
    'refuses ordinary %s form downgrade while preserving the original ordinary path after expiry',
    async (platform) => {
      const ordinary = opaque();
      if (platform === 'telegram')
        await db.pool.query(
          "INSERT INTO platform.telegram_application_links(telegram_user_id,token_hash,expires_at) VALUES('1001',public.digest($1,'sha256'),clock_timestamp()+INTERVAL '30 minutes')",
          [ordinary]
        );
      else
        await db.pool.query(
          "INSERT INTO platform.whatsapp_links(subject,purpose,token_hash,expires_at) VALUES('1001','apply',public.digest($1,'sha256'),clock_timestamp()+INTERVAL '30 minutes')",
          [ordinary]
        );
      const invite = await create(platform);
      await begin(platform, '1001', invite.token);
      const submit = () =>
        platform === 'telegram'
          ? query('SELECT platform.submit_telegram_application($1,$2,$3,$4,$5)', [
              ordinary,
              'Manual',
              'ordinary@example.invalid',
              '+999000000001',
              'tw-general'
            ])
          : query('SELECT platform.submit_whatsapp_application($1,$2,$3,$4,$5,$6,$7)', [
              ordinary,
              'Manual',
              'ordinary@example.invalid',
              '+999000000001',
              'tw-general',
              'en',
              true
            ]);
      await expect(submit()).rejects.toThrow('continuation required');
      await db.pool.query(
        "UPDATE platform.channel_invite_continuations SET created_at=clock_timestamp()-INTERVAL '20 minutes',expires_at=clock_timestamp()-INTERVAL '6 minutes'"
      );
      await expect(submit()).resolves.toBeDefined();
      expect(
        (await db.pool.query('SELECT status FROM identity.onboarding_applications')).rows[0]!.status
      ).toBe('pending');
    }
  );
  it('requires explicit active-policy consent and WA decision-message consent without implying reflection consent', async () => {
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    const invite = await create('whatsapp'),
      c = await begin('whatsapp', '1001', invite.token);
    expect(c.data.status).toBe('privacy');
    await expect(redeem('whatsapp', c.resume)).rejects.toThrow('privacy acceptance required');
    const privacy = opaque();
    const gate = (
      await query<{ data: { version: string; hash: string } }>(
        'SELECT platform.begin_privacy_gate($1,$2,$3) data',
        ['whatsapp', '1001', privacy]
      )
    ).rows[0]!.data;
    await query('SELECT platform.accept_privacy($1,$2,$3,$4,$5,$6,$7)', [
      'whatsapp',
      privacy,
      gate.version,
      gate.hash,
      'en',
      true,
      false
    ]);
    await expect(redeem('whatsapp', c.resume, false)).rejects.toThrow('invalid');
    await redeem('whatsapp', c.resume);
    expect(
      (await db.pool.query('SELECT reflection_consent FROM platform.learner_privacy_acceptances'))
        .rows[0]!.reflection_consent
    ).toBe(false);
    expect(
      (await db.pool.query('SELECT allowed FROM platform.whatsapp_notification_consents')).rows[0]!
        .allowed
    ).toBe(true);
  });
  it('does not restore rejected or suspended accounts or revive a revoked invite', async () => {
    const invite = await create('telegram', 3);
    await db.pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,status,rejection_reason,decided_by_principal_id,decided_at) SELECT 'telegram','1001','Rejected',id,'rejected','Synthetic rejection',$1,clock_timestamp() FROM core.regions WHERE code='tw-general'",
      [actor]
    );
    expect((await begin('telegram', '1001', invite.token)).data.status).toBe('blocked');
    const c = await begin('telegram', '1002', invite.token);
    await redeem('telegram', c.resume);
    await db.pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp()'
    );
    await db.pool.query("UPDATE identity.people SET status='suspended'");
    expect((await begin('telegram', '1002', invite.token)).data.status).toBe('blocked');
    const fresh = await begin('telegram', '1003', invite.token);
    await query('SELECT admin.revoke_channel_invite($1,$2,$3,$4,$5)', [
      'telegram',
      invite.id,
      1,
      'Synthetic revoke',
      session
    ]);
    await expect(redeem('telegram', fresh.resume)).rejects.toThrow('unavailable');
  });
  it('rolls back person, approval, quota and notification if audit insertion fails', async () => {
    const invite = await create('telegram'),
      c = await begin('telegram', '1001', invite.token);
    await db.pool.query(
      "CREATE FUNCTION audit.synthetic_channel_failure() RETURNS TRIGGER LANGUAGE plpgsql AS $$BEGIN IF NEW.action='channel_invite.redeem' THEN RAISE EXCEPTION 'synthetic audit failure';END IF;RETURN NEW;END$$;CREATE TRIGGER synthetic_channel_failure BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.synthetic_channel_failure()"
    );
    await expect(redeem('telegram', c.resume)).rejects.toThrow('synthetic audit failure');
    for (const table of [
      'identity.people',
      'identity.onboarding_applications',
      'platform.channel_invite_redemptions',
      'ops.onboarding_notifications'
    ])
      expect((await db.pool.query('SELECT count(*)::int n FROM ' + table)).rows[0]!.n).toBe(0);
    expect((await db.pool.query('SELECT uses FROM platform.channel_invites')).rows[0]!.uses).toBe(
      0
    );
  });
  it.each(['invite', 'context'] as const)(
    'rechecks %s validity after audit-trigger side effects',
    async (kind) => {
      const invite = await create('telegram'),
        c = await begin('telegram', '1001', invite.token);
      const change =
        kind === 'invite'
          ? 'UPDATE platform.channel_invites SET revoked_at=clock_timestamp()'
          : "UPDATE platform.channel_invite_continuations SET created_at=clock_timestamp()-INTERVAL '20 minutes',expires_at=clock_timestamp()-INTERVAL '6 minutes'";
      await db.pool.query(
        `CREATE FUNCTION audit.synthetic_invite_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$BEGIN IF NEW.action='channel_invite.redeem' THEN ${change};END IF;RETURN NEW;END$$;CREATE TRIGGER synthetic_invite_change AFTER INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.synthetic_invite_change()`
      );
      await expect(redeem('telegram', c.resume)).rejects.toThrow('unavailable');
      expect((await db.pool.query('SELECT count(*)::int n FROM identity.people')).rows[0]!.n).toBe(
        0
      );
      expect((await db.pool.query('SELECT uses FROM platform.channel_invites')).rows[0]!.uses).toBe(
        0
      );
    }
  );
  it('rechecks actual session after audit side effects and issuer expiry after a lock wait', async () => {
    await db.pool.query(
      "CREATE FUNCTION audit.synthetic_session_expiry() RETURNS TRIGGER LANGUAGE plpgsql AS $$BEGIN IF NEW.action='channel_invite.create' THEN UPDATE admin.sessions SET revoked_at=clock_timestamp();END IF;RETURN NEW;END$$;CREATE TRIGGER synthetic_session_expiry AFTER INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.synthetic_session_expiry()"
    );
    await expect(create('telegram')).rejects.toThrow('denied');
    expect((await db.pool.query('SELECT * FROM platform.channel_invites')).rowCount).toBe(0);
    await db.pool.query('DROP TRIGGER synthetic_session_expiry ON audit.events');
    const invite = await create('telegram'),
      c = await begin('telegram', '1001', invite.token),
      lock = await db.pool.connect();
    await lock.query('BEGIN');
    await lock.query('SELECT pg_advisory_xact_lock(1919,1)');
    const pending = redeem('telegram', c.resume).then(
      () => 'unexpected success',
      () => 'denied'
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
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(waiting).toBe(true);
      await lock.query(
        "UPDATE admin.role_grants SET valid_to=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",
        [grant]
      );
    } finally {
      await lock.query('COMMIT');
      lock.release();
    }
    expect(await pending).toBe('denied');
    expect((await db.pool.query('SELECT uses FROM platform.channel_invites')).rows[0]!.uses).toBe(
      0
    );
  });
});
