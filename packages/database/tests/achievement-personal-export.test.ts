import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const migrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);
interface ExportData {
  code: string;
  name: string;
  ruleVersion: number;
  count: number;
  rows: Array<{
    lineId: string;
    telegramId: string;
    whatsappId: string;
    name: string;
    phone: string;
    email: string;
    periods: string;
    contactStatus: string;
  }>;
}
suite('Permission-separated audited achievement personal export', () => {
  let root: Pool,
    runtime: Pool,
    dispose: () => Promise<void>,
    login: string,
    region: string,
    alice: string;
  const actors = new Map<string, string>();
  const invoke = async <T extends pg.QueryResultRow>(
    actor: string,
    sql: string,
    params: unknown[] = []
  ) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: actors.get(actor)! },
      (client) => client.query<T>(sql, params)
    );
  const prepare = async (actor = 'super', purpose = 'award_contact', q = '') =>
    (
      await invoke<{ data: ExportData }>(
        actor,
        'SELECT admin.prepare_achievement_personal_export($1,$2,$3,$4,$5,$6,$7) data',
        ['streak_3', 'zh_TW', null, null, q, null, purpose]
      )
    ).rows[0]!.data;
  const preview = async (actor = 'super') =>
    (
      await invoke<{ data: { count: number; overLimit: boolean } }>(
        actor,
        "SELECT admin.achievement_export_preview('streak_3','zh_TW',NULL,NULL,'',NULL) data"
      )
    ).rows[0]!.data;
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    await runMigrations(root, migrations, 'export-test');
    login = 'export_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime TO ${login}`);
    const url = new URL(db.databaseUrl);
    url.username = login;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    region = (
      await root.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('export-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'export-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'export-region','operational','區域','Region' FROM c RETURNING id"
      )
    ).rows[0]!.id;
    for (const [name, role] of [
      ['super', 'super_admin'],
      ['master', 'master_admin'],
      ['viewer', 'global_viewer'],
      ['regional', 'regional_admin'],
      ['expiring', 'master_admin']
    ] as const) {
      const id = (
        await root.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://export.example.invalid',$1,$1) RETURNING id",
          [name]
        )
      ).rows[0]!.id;
      actors.set(name, id);
      await root.query(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,valid_from,reason) SELECT $1,id,$3,$4,clock_timestamp()-INTERVAL '1 day','Synthetic export fixture' FROM admin.roles WHERE code=$2",
        [id, role, name === 'regional' ? 'region' : 'global', name === 'regional' ? region : null]
      );
    }
    for (let n = 0; n < 3; n++) {
      const person = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.people(legal_name,preferred_name) VALUES($1,'DO NOT USE PROVIDER NICKNAME') RETURNING id",
          [n === 0 ? 'CSV "Legal", Name' : n === 1 ? 'CSV "Legal", Name' : 'Missing contacts']
        )
      ).rows[0]!.id;
      if (n === 0) alice = person;
      await root.query(
        "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-30)",
        [person, region]
      );
      const ident = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at) VALUES($1,'telegram',$2,clock_timestamp()-INTERVAL '1 day') RETURNING id",
          [person, String(700000000000 + n)]
        )
      ).rows[0]!.id;
      if (n < 2) {
        await root.query(
          "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,valid_from) VALUES($1,$2,'onboarding',clock_timestamp()-INTERVAL '1 day')",
          [person, ident]
        );
        await root.query(
          "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_by_principal_id,decided_at) VALUES('telegram',$1,'REGISTERED','Registered name','export@example.invalid','+886912345678',$2,'approved',$3,$4,clock_timestamp())",
          [String(700000000000 + n), region, person, actors.get('super')]
        );
      }
      await root.query(
        "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',1),($1,'seasonal_summer','2025',1),($1,'seasonal_summer','2026',1)",
        [person]
      );
    }
    await root.query(
      "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at) VALUES($1,'line','U11111111111111111111111111111111',clock_timestamp()-INTERVAL '1 day'),($1,'line','U22222222222222222222222222222222',clock_timestamp()-INTERVAL '1 day'),($1,'whatsapp','659900000001',clock_timestamp()-INTERVAL '1 day')",
      [alice]
    );
    await root.query(
      "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at,revoked_at) VALUES($1,'line','REVOKED NEVER EXPORT',clock_timestamp()-INTERVAL '2 days',clock_timestamp()-INTERVAL '1 day')",
      [alice]
    );
    await root.query(
      "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at) VALUES($1,'line','NOT YET VERIFIED',clock_timestamp()+INTERVAL '1 day')",
      [alice]
    );
    await root.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_by_principal_id,decided_at) VALUES('line','U11111111111111111111111111111111','Other provider','NOT CURRENT APP','wrong-provider@example.invalid','+659900000001',$1,'approved',$2,$3,clock_timestamp())",
      [region, alice, actors.get('super')]
    );
  });
  beforeEach(async () => {
    await root.query('TRUNCATE admin.achievement_export_limits');
    await root.query("DELETE FROM audit.events WHERE action='achievement.export_prepared'");
  });
  afterAll(async () => {
    await runtime?.end();
    if (login) {
      await root.query(`DROP OWNED BY ${login}`);
      await root.query(`DROP ROLE ${login}`);
    }
    await dispose?.();
  });
  it('grants the new permission only to super/master and preserves ordinary report visibility without contact leakage', async () => {
    const roles = (
      await root.query<{ code: string }>(
        "SELECT r.code FROM admin.role_permissions rp JOIN admin.roles r ON r.id=rp.role_id JOIN admin.permissions p ON p.id=rp.permission_id WHERE p.code='achievement.export_personal' ORDER BY r.code"
      )
    ).rows.map((r) => r.code);
    expect(roles).toEqual(['master_admin', 'super_admin']);
    for (const actor of ['viewer', 'regional']) {
      await expect(preview(actor)).rejects.toMatchObject({ code: '42501' });
      await expect(prepare(actor)).rejects.toMatchObject({ code: '42501' });
      const ordinary = await invoke<{ data: { rows: Array<Record<string, unknown>> } }>(
        actor,
        "SELECT admin.achievement_recipients('streak_3','zh_TW',NULL,NULL,'',NULL,1,20) data"
      );
      expect(
        ordinary.rows[0]?.data.rows.every(
          (r) => !('phone' in r) && !('email' in r) && !('telegramId' in r)
        )
      ).toBe(true);
    }
    await expect(
      invoke('super', 'SELECT * FROM admin.achievement_export_limits')
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      invoke(
        'super',
        "SELECT * FROM admin._achievement_export_population('streak_3',NULL,NULL,'',NULL)"
      )
    ).rejects.toMatchObject({ code: '42501' });
  });
  it.each(['super', 'master'])(
    'allows %s and exports only linked active IDs plus the current approved application contacts',
    async (actor) => {
      const result = await prepare(actor);
      expect(result.count).toBe(3);
      expect(result.rows).toHaveLength(3);
      const row = result.rows.find((r) => r.telegramId === '700000000000')!;
      expect(row).toMatchObject({
        name: 'CSV "Legal", Name',
        lineId: 'U11111111111111111111111111111111;U22222222222222222222222222222222',
        whatsappId: '659900000001',
        phone: '+886912345678',
        email: 'export@example.invalid',
        contactStatus: 'matched_current_application'
      });
      expect(result.rows.some((r) => r.lineId.includes('REVOKED'))).toBe(false);
      expect(result.rows.find((r) => r.name === 'Missing contacts')).toMatchObject({
        phone: '',
        email: '',
        contactStatus: 'missing_current_application'
      });
      const audit = (
        await root.query<{ data: Record<string, unknown>; reason: string }>(
          "SELECT metadata data,reason FROM audit.events WHERE action='achievement.export_prepared'"
        )
      ).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0]?.data).toMatchObject({
        rowCount: 3,
        purpose: 'award_contact',
        queryApplied: false,
        delivery: 'prepared_not_confirmed_saved'
      });
      const text = JSON.stringify(audit);
      for (const secret of [
        'export@example.invalid',
        '+886912345678',
        '700000000000',
        'CSV "Legal", Name',
        alice
      ])
        expect(text.includes(secret)).toBe(false);
    }
  );
  it('returns metadata only for preview, deduplicates years and does not impose current page limits', async () => {
    expect(await preview()).toEqual(expect.objectContaining({ count: 3, overLimit: false }));
    expect(
      (await root.query("SELECT id FROM audit.events WHERE action='achievement.export_prepared'"))
        .rows
    ).toEqual([]);
    expect((await root.query('SELECT * FROM admin.achievement_export_limits')).rows).toEqual([]);
    const result = (
      await invoke<{ data: ExportData }>(
        'master',
        "SELECT admin.prepare_achievement_personal_export('seasonal_summer','en',NULL,NULL,'',NULL,'internal_review') data"
      )
    ).rows[0]!.data;
    expect(result.count).toBe(3);
    expect(result.rows.every((r) => r.periods === '2025;2026')).toBe(true);
  });
  it('serializes issuance and rate limits repeats without creating another successful audit', async () => {
    await prepare();
    await expect(prepare()).rejects.toThrow('achievement export rate limited');
    expect(
      (
        await root.query(
          "SELECT count(*)::int n FROM audit.events WHERE action='achievement.export_prepared'"
        )
      ).rows[0]?.n
    ).toBe(1);
  });
  it('rolls audit/cooldown back if the caller cannot produce or authorize a file', async () => {
    await expect(
      withRequestContext(
        runtime,
        'qigong_api_runtime',
        { requestId: randomUUID(), principalId: actors.get('super')! },
        async (client) => {
          await client.query(
            "SELECT admin.prepare_achievement_personal_export('streak_3','en',NULL,NULL,'',NULL,'award_contact')"
          );
          throw Error('Synthetic CSV generation refused');
        }
      )
    ).rejects.toThrow('Synthetic CSV generation refused');
    expect(
      (
        await root.query(
          "SELECT count(*)::int n FROM audit.events WHERE action='achievement.export_prepared'"
        )
      ).rows[0]?.n
    ).toBe(0);
    expect((await root.query('SELECT * FROM admin.achievement_export_limits')).rows).toEqual([]);
  });
  it('rechecks natural grant expiry after waiting for the authorization lock, not transaction-start time', async () => {
    const hold = await root.connect();
    await hold.query('BEGIN');
    await hold.query('SELECT pg_advisory_xact_lock(1919,1)');
    const pending = prepare('expiring').then(
      () => true,
      () => false
    );
    let queued = false;
    try {
      for (let n = 0; n < 100; n++) {
        const wait = (
          await root.query<{ n: number }>(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock' AND query LIKE '%prepare_achievement_personal_export%'",
            [login]
          )
        ).rows[0]!.n;
        if (wait) {
          queued = true;
          break;
        }
        await delay(10);
      }
      expect(queued).toBe(true);
      await root.query(
        "UPDATE admin.role_grants SET valid_to=clock_timestamp()+INTERVAL '100 milliseconds' WHERE principal_id=$1",
        [actors.get('expiring')]
      );
      await delay(200);
    } finally {
      await hold.query('COMMIT');
      hold.release();
    }
    expect(await pending).toBe(false);
    expect(
      (await root.query("SELECT id FROM audit.events WHERE action='achievement.export_prepared'"))
        .rows
    ).toEqual([]);
  });
  it('refuses export when audit insertion fails and never modifies awards/jobs', async () => {
    const snapshot = async () =>
      (
        await root.query<{ h: string }>(
          'SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(b) ORDER BY person_id,badge_code,period,rule_version) FROM core.person_practice_badges b),(SELECT jsonb_agg(to_jsonb(j) ORDER BY person_id) FROM ops.practice_badge_jobs j))::text) h'
        )
      ).rows[0]!.h;
    const before = await snapshot();
    await root.query(
      "CREATE FUNCTION audit.deny_synthetic_export() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='achievement.export_prepared' THEN RAISE EXCEPTION 'synthetic audit refusal';END IF;RETURN NEW;END$$;CREATE TRIGGER deny_synthetic_export BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.deny_synthetic_export()"
    );
    try {
      await expect(prepare()).rejects.toThrow('synthetic audit refusal');
      expect((await root.query('SELECT * FROM admin.achievement_export_limits')).rows).toEqual([]);
      expect(await snapshot()).toBe(before);
    } finally {
      await root.query(
        'DROP TRIGGER deny_synthetic_export ON audit.events;DROP FUNCTION audit.deny_synthetic_export()'
      );
    }
  });
  it('rejects unsupported purposes and denies worker/PUBLIC execution', async () => {
    await expect(prepare('super', 'PRIVATE PURPOSE MUST NOT BE STORED')).rejects.toMatchObject({
      code: '22023'
    });
    const data = (
      await root.query<{ public_exec: number; worker_exec: boolean }>(
        "SELECT (SELECT count(*)::int FROM pg_proc p WHERE p.proname IN('can_export_achievement_personal_now','_achievement_export_population','achievement_export_preview','prepare_achievement_personal_export','achievement_export_session_current','achievement_export_schema_ready') AND EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) public_exec,has_function_privilege('qigong_worker_runtime','admin.prepare_achievement_personal_export(text,text,uuid,text,text,integer,text)','EXECUTE') worker_exec"
      )
    ).rows[0];
    expect(data).toEqual({ public_exec: 0, worker_exec: false });
  });
  it('refuses more than5000 winners rather than silently truncating or auditing a partial export', async () => {
    await root.query(
      "WITH p AS(INSERT INTO identity.people(preferred_name) SELECT 'Synthetic bulk export '||n FROM generate_series(1,5001) n RETURNING id) INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) SELECT id,'streak_3','lifetime',1 FROM p"
    );
    expect(await preview()).toMatchObject({ count: 5001, overLimit: true });
    await expect(prepare()).rejects.toMatchObject({ code: '54000' });
    expect(
      (await root.query("SELECT id FROM audit.events WHERE action='achievement.export_prepared'"))
        .rows
    ).toEqual([]);
  }, 20000);
});
