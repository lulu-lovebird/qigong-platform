import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
interface Config {
  nameZhTw: string;
  nameZhCn: string;
  nameEn: string;
  description: string;
  effectiveDate: string;
  threshold?: number;
  methodCodes?: string[];
  startDate?: string;
  endDate?: string;
  timezone?: string;
  requiredDays?: number;
}
interface Draft {
  id: string;
  revision: number;
  state: string;
  config: Config;
  sourceChanged: boolean;
  locked: boolean;
  latestPreview: unknown;
}
interface Preview {
  previewId?: string;
  counts: {
    population: number;
    currentlyAwarded: number;
    qualifyingAsOf: number;
    additionalQualifying: number;
    existingAwardsPreserved: number;
    wouldRevoke: number;
  };
  awardableNow: number;
  deadline: { latestMakeupCutoff: string; settlementAt: string; timezoneCount: number } | null;
  publicationEnabled: boolean;
}
suite('Draft-only global achievement management without award mutation', () => {
  let root: Pool,
    runtime: Pool,
    dispose: () => Promise<void>,
    login: string,
    effective: string,
    region: string;
  const actors = new Map<string, string>();
  const invoke = async <T extends pg.QueryResultRow>(
    actor: string,
    sql: string,
    values: unknown[] = []
  ) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: actors.get(actor)! },
      (client) => client.query<T>(sql, values)
    );
  const config = (threshold = 1): Config => ({
    nameZhTw: '合成規則 <img src=x>',
    nameZhCn: '',
    nameEn: 'Synthetic rule',
    description: 'Synthetic draft only',
    effectiveDate: effective,
    threshold,
    methodCodes: []
  });
  const save = async (
    actor = 'super',
    id: string | null = null,
    revision = 0,
    c: Config = config(),
    subject = 'rule',
    code = 'streak_3',
    year: number | null = null
  ) =>
    (
      await invoke<{ data: Draft }>(
        actor,
        'SELECT admin.save_achievement_config_draft($1,$2,$3,$4,$5,$6,$7) data',
        [id, revision, subject, code, year, JSON.stringify(c), 'Synthetic configuration test']
      )
    ).rows[0]!.data;
  const prepare = async (id: string, revision = 1, actor = 'super') =>
    (
      await invoke<{ data: Preview }>(
        actor,
        'SELECT admin.prepare_achievement_config_preview($1,$2) data',
        [id, revision]
      )
    ).rows[0]!.data;
  const snapshot = async () =>
    (
      await root.query<{ h: string }>(
        'SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(b) ORDER BY person_id,badge_code,period,rule_version) FROM core.person_practice_badges b),(SELECT jsonb_agg(to_jsonb(j) ORDER BY person_id) FROM ops.practice_badge_jobs j),(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM core.checkins c),(SELECT jsonb_agg(to_jsonb(d) ORDER BY code) FROM core.practice_badge_definitions d),(SELECT jsonb_agg(to_jsonb(s) ORDER BY kind,year) FROM core.practice_badge_seasons s))::text) h'
      )
    ).rows[0]!.h;
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    await runMigrations(root, dir, 'draft-management');
    login = 'draft_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime TO ${login}`);
    const url = new URL(db.databaseUrl);
    url.username = login;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    effective = (
      await root.query<{ d: string }>(
        "SELECT ((clock_timestamp() AT TIME ZONE 'UTC')::date-2)::text d"
      )
    ).rows[0]!.d;
    region = (
      await root.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('draft-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'draft-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'draft-region','operational','區域','Region' FROM c RETURNING id"
      )
    ).rows[0]!.id;
    for (const [actor, role] of [
      ['super', 'super_admin'],
      ['master', 'master_admin'],
      ['viewer', 'global_viewer'],
      ['regional', 'regional_admin'],
      ['expiring', 'master_admin']
    ] as const) {
      const id = (
        await root.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://draft.example.invalid',$1,$1) RETURNING id",
          [actor]
        )
      ).rows[0]!.id;
      actors.set(actor, id);
      await root.query(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,valid_from,reason) SELECT $1,id,$3,$4,clock_timestamp()-INTERVAL '1 day','Synthetic draft fixture' FROM admin.roles WHERE code=$2",
        [id, role, actor === 'regional' ? 'region' : 'global', actor === 'regional' ? region : null]
      );
    }
    for (let n = 0; n < 2; n++) {
      const p = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic rule learner','UTC') RETURNING id"
        )
      ).rows[0]!.id;
      const ident = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at) VALUES($1,'telegram',$2,clock_timestamp()-INTERVAL '1 day') RETURNING id",
          [p, '76543210000' + n]
        )
      ).rows[0]!.id;
      const assignment = (
        await root.query<{ id: string }>(
          "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-30) RETURNING id",
          [p, region]
        )
      ).rows[0]!.id;
      await root.query(
        "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,valid_from) VALUES($1,$2,'onboarding',clock_timestamp()-INTERVAL '1 day')",
        [p, ident]
      );
      for (const offset of [0, 1]) {
        const checkin = (
          await root.query<{ id: string }>(
            "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id,created_at) VALUES($1,$2,$3::date+$4::integer,'UTC','regular',$5,($3::date+$4::integer)+TIME '06:00') RETURNING id",
            [p, ident, effective, offset, assignment]
          )
        ).rows[0]!.id;
        await root.query(
          "INSERT INTO core.checkin_method_selections(checkin_id,practice_method_id) SELECT $1,id FROM core.practice_methods WHERE code='dayan_chu'",
          [checkin]
        );
      }
      if (n === 0)
        await root.query(
          "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',1)",
          [p]
        );
    }
  });
  beforeEach(async () => {
    await root.query(
      'DELETE FROM admin.achievement_config_previews;DELETE FROM admin.achievement_config_drafts'
    );
    await root.query("DELETE FROM audit.events WHERE action LIKE 'achievement.draft_%'");
  });
  afterAll(async () => {
    await runtime?.end();
    if (login) {
      await root.query(`DROP OWNED BY ${login}`);
      await root.query(`DROP ROLE ${login}`);
    }
    await dispose?.();
  });
  it('grants only global super/master draft management, keeps publication absent and denies raw/helper access', async () => {
    const roles = (
      await root.query<{ code: string }>(
        "SELECT r.code FROM admin.role_permissions rp JOIN admin.roles r ON r.id=rp.role_id JOIN admin.permissions p ON p.id=rp.permission_id WHERE p.code='achievement.manage_drafts' ORDER BY r.code"
      )
    ).rows.map((r) => r.code);
    expect(roles).toEqual(['master_admin', 'super_admin']);
    for (const actor of ['viewer', 'regional'])
      await expect(save(actor)).rejects.toMatchObject({ code: '42501' });
    for (const sql of [
      'SELECT * FROM admin.achievement_config_drafts',
      'SELECT * FROM admin.achievement_config_previews',
      "SELECT admin._achievement_config_source('rule','streak_3',NULL)"
    ])
      await expect(invoke('super', sql)).rejects.toMatchObject({ code: '42501' });
    const catalog = (
      await invoke<{ data: { canPublish: boolean; definitions: unknown[] } }>(
        'master',
        'SELECT admin.achievement_management_catalog() data'
      )
    ).rows[0]!.data;
    expect(catalog.canPublish).toBe(false);
    expect(catalog.definitions).toHaveLength(49);
    const security = (
      await root.query<{ public_exec: number; worker: boolean }>(
        "SELECT (SELECT count(*)::int FROM pg_proc p WHERE p.proname IN('can_manage_achievement_drafts_now','can_preview_achievement_drafts_now','achievement_management_session_current','_achievement_config_source','_achievement_config_locked','_achievement_config_validate','achievement_management_catalog','achievement_config_drafts','achievement_config_draft','save_achievement_config_draft','archive_achievement_config_draft','_achievement_activity_deadline','compute_achievement_config_preview','prepare_achievement_config_preview','achievement_management_schema_ready') AND EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')) public_exec,has_function_privilege('qigong_worker_runtime','admin.prepare_achievement_config_preview(uuid,integer)','EXECUTE') worker"
      )
    ).rows[0];
    expect(security).toEqual({ public_exec: 0, worker: false });
  });
  it.each(['super', 'master'])(
    'lets %s create/update/archive a draft without changing live rules or awards',
    async (actor) => {
      const before = await snapshot(),
        draft = await save(actor);
      expect(draft.revision).toBe(1);
      expect(draft.config.nameZhTw).toContain('<img');
      const changed = await save(actor, draft.id, 1, config(2));
      expect(changed.revision).toBe(2);
      await expect(save(actor, draft.id, 1)).rejects.toMatchObject({ code: '40001' });
      const archived = (
        await invoke<{ data: Draft }>(
          actor,
          'SELECT admin.archive_achievement_config_draft($1,$2,$3) data',
          [draft.id, 2, 'Synthetic archive']
        )
      ).rows[0]!.data;
      expect(archived.state).toBe('archived');
      expect(archived.revision).toBe(3);
      await expect(prepare(draft.id, 3, actor)).rejects.toMatchObject({ code: '40001' });
      expect(await snapshot()).toBe(before);
    }
  );
  it('computes new progress from effectiveDate, preserves prior awards and is executable in a read-only transaction', async () => {
    const before = await snapshot(),
      draft = await save(),
      client = await runtime.connect();
    let data: Preview | undefined;
    try {
      await client.query('BEGIN READ ONLY');
      await client.query('SET LOCAL ROLE qigong_api_runtime');
      await client.query("SELECT set_config('qigong.principal_id',$1,true)", [actors.get('super')]);
      data = (
        await client.query<{ data: Preview }>(
          'SELECT admin.compute_achievement_config_preview($1,1) data',
          [draft.id]
        )
      ).rows[0]!.data;
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(data?.counts).toEqual({
      population: 2,
      currentlyAwarded: 1,
      qualifyingAsOf: 2,
      additionalQualifying: 1,
      existingAwardsPreserved: 1,
      wouldRevoke: 0
    });
    expect(data?.publicationEnabled).toBe(false);
    expect((await root.query('SELECT * FROM admin.achievement_config_previews')).rows).toEqual([]);
    expect(await snapshot()).toBe(before);
    const future = { ...config(), effectiveDate: '2199-01-01' },
      next = await save('master', null, 0, future);
    const preview = await prepare(next.id, 1, 'master');
    expect(preview.counts.qualifyingAsOf).toBe(0);
    expect(preview.counts.existingAwardsPreserved).toBe(1);
    expect(await snapshot()).toBe(before);
  });
  it.each([
    ['total_10', 2, [], 2],
    ['method_dayan_7', 2, ['dayan_chu'], 2],
    ['method_dayan_7', 2, ['dayan_gao'], 0],
    ['combo_dayan_7', 1, ['dayan_chu', 'dayan_gao'], 0],
    ['combo_dayan_7', 1, ['dayan_chu'], 2],
    ['time_morning', 2, [], 2],
    ['time_night', 1, [], 0],
    ['streak_3', 3, [], 0]
  ] as const)(
    'uses the actual %s rule family rather than a generic threshold-only calculation',
    async (code, threshold, methods, expected) => {
      const before = await snapshot(),
        d = await save(
          'super',
          null,
          0,
          { ...config(threshold), methodCodes: [...methods] },
          'rule',
          code
        ),
        p = (
          await invoke<{ data: Preview }>(
            'super',
            'SELECT admin.compute_achievement_config_preview($1,1) data',
            [d.id]
          )
        ).rows[0]!.data;
      expect(p.counts.qualifyingAsOf).toBe(expected);
      expect(p.counts.wouldRevoke).toBe(0);
      expect(await snapshot()).toBe(before);
    }
  );
  it.each(['seasonal_summer', 'seasonal_winter'] as const)(
    'counts %s from its draft activity days and waits for global makeup plus24h',
    async (code) => {
      const end = (await root.query<{ d: string }>('SELECT ($1::date+1)::text d', [effective]))
        .rows[0]!.d;
      const c: Config = {
          nameZhTw: '合成歷史模擬',
          nameZhCn: '',
          nameEn: 'Synthetic only',
          description: '',
          effectiveDate: effective,
          startDate: effective,
          endDate: end,
          timezone: 'UTC',
          requiredDays: 2
        },
        before = await snapshot(),
        d = await save('super', null, 0, c, 'activity', code, Number(effective.slice(0, 4))),
        p = (
          await invoke<{ data: Preview }>(
            'super',
            'SELECT admin.compute_achievement_config_preview($1,1) data',
            [d.id]
          )
        ).rows[0]!.data;
      expect(p.counts.qualifyingAsOf).toBe(code === 'seasonal_summer' ? 2 : 0);
      expect(p.awardableNow).toBe(0);
      expect(await snapshot()).toBe(before);
    }
  );
  it('records aggregate-only previews, reuses a same-revision preview without extending its observation and rejects stale revisions', async () => {
    const before = await snapshot(),
      d = await save(),
      one = await prepare(d.id),
      two = await prepare(d.id);
    expect(two).toEqual(one);
    expect((await root.query('SELECT * FROM admin.achievement_config_previews')).rows).toHaveLength(
      1
    );
    expect(
      (await root.query("SELECT id FROM audit.events WHERE action='achievement.draft_previewed'"))
        .rows
    ).toHaveLength(1);
    const audit = (
      await root.query<{ metadata: unknown }>(
        "SELECT metadata FROM audit.events WHERE action LIKE 'achievement.draft_%'"
      )
    ).rows;
    const serialized = JSON.stringify(audit);
    for (const secret of ['Synthetic rule learner', '76543210000', 'Synthetic draft only', '<img'])
      expect(serialized.includes(secret)).toBe(false);
    await save('super', d.id, 1, config(2));
    await expect(prepare(d.id, 1)).rejects.toMatchObject({ code: '40001' });
    await expect(prepare(d.id, 2)).rejects.toThrow('achievement preview rate limited');
    expect(await snapshot()).toBe(before);
  });
  it('separates metadata management from aggregate preview authority and hides previous aggregates after read permission loss', async () => {
    const d = await save('master');
    await prepare(d.id, 1, 'master');
    await root.query(
      "DELETE FROM admin.role_permissions WHERE role_id=(SELECT id FROM admin.roles WHERE code='master_admin') AND permission_id=(SELECT id FROM admin.permissions WHERE code='stats.read')"
    );
    try {
      const detail = (
        await invoke<{ data: Draft }>('master', 'SELECT admin.achievement_config_draft($1) data', [
          d.id
        ])
      ).rows[0]!.data;
      expect(detail.latestPreview).toBeNull();
      await expect(prepare(d.id, 1, 'master')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await root.query(
        "INSERT INTO admin.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM admin.roles r CROSS JOIN admin.permissions p WHERE r.code='master_admin' AND p.code='stats.read'"
      );
    }
  });
  it('rejects current-source changes and locks a real activity after it starts', async () => {
    const d = await save();
    await root.query(
      "UPDATE core.practice_badge_definitions SET threshold=threshold+1 WHERE code='streak_3'"
    );
    try {
      await expect(save('super', d.id, 1)).rejects.toMatchObject({ code: '40001' });
      await expect(prepare(d.id)).rejects.toMatchObject({ code: '40001' });
    } finally {
      await root.query(
        "UPDATE core.practice_badge_definitions SET threshold=threshold-1 WHERE code='streak_3'"
      );
    }
    await root.query(
      "INSERT INTO core.practice_badge_seasons(kind,year,start_date,end_date,timezone,required_days) VALUES('winter',2020,'2020-12-01','2020-12-27','UTC',27)"
    );
    try {
      const c: Config = {
        nameZhTw: '合成活動',
        nameZhCn: '',
        nameEn: 'Synthetic activity',
        description: '',
        effectiveDate: '2020-12-01',
        startDate: '2020-12-01',
        endDate: '2020-12-27',
        timezone: 'UTC',
        requiredDays: 27
      };
      await expect(
        save('super', null, 0, c, 'activity', 'seasonal_winter', 2020)
      ).rejects.toMatchObject({ code: '55000' });
    } finally {
      await root.query("DELETE FROM core.practice_badge_seasons WHERE kind='winter' AND year=2020");
    }
  });
  it('uses the latest supported timezone makeup cutoff plus exactly24 hours, without changing the makeup window', async () => {
    const before = await snapshot(),
      c: Config = {
        nameZhTw: '合成跨年活動',
        nameZhCn: '',
        nameEn: 'Synthetic cross-year',
        description: 'No actual calendar',
        effectiveDate: '2199-12-15',
        startDate: '2199-12-15',
        endDate: '2200-01-15',
        timezone: 'Asia/Taipei',
        requiredDays: 20
      };
    const d = await save('super', null, 0, c, 'activity', 'seasonal_winter', 2199),
      p = await prepare(d.id);
    expect(p.awardableNow).toBe(0);
    expect(p.deadline?.timezoneCount).toBeGreaterThan(100);
    expect(Date.parse(p.deadline!.settlementAt) - Date.parse(p.deadline!.latestMakeupCutoff)).toBe(
      86400000
    );
    expect(await snapshot()).toBe(before);
    for (const [end, localHour] of [
      ['2026-03-06', '13:00'],
      ['2026-10-30', '11:00']
    ] as const) {
      const value = (
        await root.query<{ seconds: number; local_hour: string }>(
          "WITH d AS(SELECT admin._achievement_activity_deadline($1,ARRAY['America/New_York']) v) SELECT extract(epoch FROM((v->>'settlementAt')::timestamptz-(v->>'latestMakeupCutoff')::timestamptz))::int seconds,to_char((v->>'settlementAt')::timestamptz AT TIME ZONE 'America/New_York','HH24:MI') local_hour FROM d",
          [end]
        )
      ).rows[0]!;
      expect(value.seconds).toBe(86400);
      expect(value.local_hour).toBe(localHour);
    }
  }, 20000);
  it('validates immutable identifiers, leaf sets, dates, timezone and per-kind parameters', async () => {
    for (const c of [
      { ...config(), threshold: 0 },
      { ...config(), threshold: 1.5 },
      { ...config(), unexpected: 'no' },
      { ...config(), methodCodes: ['dayan_chu'] },
      { ...config(), effectiveDate: '2026-02-30' }
    ])
      await expect(save('super', null, 0, c)).rejects.toMatchObject({ code: '22023' });
    await expect(save('super', null, 0, config(), 'rule', 'unknown_rule')).rejects.toMatchObject({
      code: 'P0002'
    });
    const c: Config = {
      nameZhTw: 'Synthetic',
      nameZhCn: '',
      nameEn: '',
      description: '',
      effectiveDate: '2199-01-01',
      startDate: '2199-01-01',
      endDate: '2199-01-02',
      timezone: 'Not/AZone',
      requiredDays: 2
    };
    await expect(
      save('super', null, 0, c, 'activity', 'seasonal_summer', 2199)
    ).rejects.toMatchObject({ code: '22023' });
    await expect(
      save(
        'super',
        null,
        0,
        { ...config(), threshold: 2, methodCodes: ['dayan_chu'] },
        'rule',
        'combo_dayan_7'
      )
    ).rejects.toMatchObject({ code: '22023' });
  });
  it('allows only one concurrent save for an expected revision', async () => {
    const d = await save(),
      result = await Promise.allSettled([
        save('super', d.id, 1, config(2)),
        save('master', d.id, 1, config(3))
      ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
  it('rolls back a draft if audit storage refuses the operation', async () => {
    await root.query(
      "CREATE FUNCTION audit.refuse_synthetic_draft() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='achievement.draft_created' THEN RAISE EXCEPTION 'synthetic draft audit refused';END IF;RETURN NEW;END$$;CREATE TRIGGER refuse_synthetic_draft BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.refuse_synthetic_draft()"
    );
    try {
      await expect(save()).rejects.toThrow('synthetic draft audit refused');
      expect((await root.query('SELECT id FROM admin.achievement_config_drafts')).rows).toEqual([]);
    } finally {
      await root.query(
        'DROP TRIGGER refuse_synthetic_draft ON audit.events;DROP FUNCTION audit.refuse_synthetic_draft()'
      );
    }
  });
  it('rechecks the activity source and started-state after waiting for the global draft-capacity lock', async () => {
    const dates = (
      await root.query<{ year: number; start: string; end: string }>(
        'SELECT extract(year FROM CURRENT_DATE)::int AS "year",(CURRENT_DATE+1)::text AS "start",(CURRENT_DATE+30)::text AS "end"'
      )
    ).rows[0]!;
    await root.query(
      "INSERT INTO core.practice_badge_seasons(kind,year,start_date,end_date,timezone,required_days) VALUES('summer',$1,$2,$3,'UTC',1)",
      [dates.year, dates.start, dates.end]
    );
    const hold = await root.connect();
    await hold.query('BEGIN');
    await hold.query('SELECT pg_advisory_xact_lock(1940,1)');
    const cfg: Config = {
      nameZhTw: 'Synthetic lock boundary',
      nameZhCn: '',
      nameEn: '',
      description: '',
      effectiveDate: dates.start,
      startDate: dates.start,
      endDate: dates.end,
      timezone: 'UTC',
      requiredDays: 1
    };
    const pending = save('super', null, 0, cfg, 'activity', 'seasonal_summer', dates.year).then(
      () => 'allowed',
      (error: unknown) =>
        typeof error === 'object' && error !== null && 'code' in error ? error.code : 'failed'
    );
    let queued = false;
    try {
      for (let n = 0; n < 100; n++) {
        if (
          (
            await root.query<{ n: number }>(
              "SELECT count(*)::int n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock' AND query LIKE '%save_achievement_config_draft%'",
              [login]
            )
          ).rows[0]!.n
        ) {
          queued = true;
          break;
        }
        await delay(10);
      }
      expect(queued).toBe(true);
      await hold.query(
        "UPDATE core.practice_badge_seasons SET start_date=CURRENT_DATE-1 WHERE kind='summer' AND year=$1",
        [dates.year]
      );
    } finally {
      await hold.query('COMMIT');
      hold.release();
    }
    try {
      expect(await pending).toBe('55000');
      expect((await root.query('SELECT id FROM admin.achievement_config_drafts')).rows).toEqual([]);
    } finally {
      await root.query("DELETE FROM core.practice_badge_seasons WHERE kind='summer' AND year=$1", [
        dates.year
      ]);
    }
  });
  it('rechecks natural management grant expiry after waiting for the authorization lock', async () => {
    const hold = await root.connect();
    await hold.query('BEGIN');
    await hold.query('SELECT pg_advisory_xact_lock(1919,1)');
    const pending = save('expiring').then(
      () => true,
      () => false
    );
    let queued = false;
    try {
      for (let n = 0; n < 100; n++) {
        if (
          (
            await root.query<{ n: number }>(
              "SELECT count(*)::int n FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock' AND query LIKE '%save_achievement_config_draft%'",
              [login]
            )
          ).rows[0]!.n
        ) {
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
    expect((await root.query('SELECT id FROM admin.achievement_config_drafts')).rows).toEqual([]);
  });
});
