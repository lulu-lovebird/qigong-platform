import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getMigrationStatus, runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
interface Config {
  nameZhTw: string;
  nameZhCn: string;
  nameEn: string;
  description: string;
  effectiveDate: string;
  startDate: string;
  endDate: string;
  timezone: string;
  requiredDays: number;
  continuous?: boolean;
}
interface Draft {
  id: string;
  code: string;
  revision: number;
  baseHash: string;
  config: Config;
  latestPreview: Preview | null;
}
interface Preview {
  previewId?: string;
  continuous?: boolean;
  publicationEnabled: boolean;
  observedAt: string;
  expiresAt: string;
  counts: { qualifyingAsOf: number; wouldRevoke: number; currentlyAwarded: number };
  deadline: { latestMakeupCutoff: string; settlementAt: string };
}
suite('Independent event cumulative/consecutive drafts, lossless41→42', () => {
  let root: Pool,
    runtime: Pool,
    dispose: () => Promise<void>,
    login: string,
    oldDir: string,
    start: string,
    end: string,
    legacy: Draft,
    cached: Preview;
  const actors: string[] = [];
  const invoke = async <T extends pg.QueryResultRow>(
    sql: string,
    values: unknown[] = [],
    actor = 0
  ) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: actors[actor]! },
      (c) => c.query<T>(sql, values)
    );
  const config = (extra: Partial<Config> = {}): Config => ({
    nameZhTw: 'Synthetic interval activity',
    nameZhCn: '',
    nameEn: 'Synthetic activity',
    description: 'No live rule change',
    effectiveDate: start,
    startDate: start,
    endDate: end,
    timezone: 'UTC',
    requiredDays: 3,
    ...extra
  });
  const save = async (
    value = config(),
    id: string | null = null,
    code: string | null = null,
    revision = 0,
    actor = 0
  ) =>
    (
      await invoke<{ data: Draft }>(
        "SELECT admin.save_achievement_config_draft($1,$2,'event',$3,NULL,$4,'Synthetic consecutive condition') data",
        [id, revision, code, value],
        actor
      )
    ).rows[0]!.data;
  const preview = async (value = config(), actor = 0) => {
    const d = await save(value, null, null, 0, actor);
    return withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: actors[actor]! },
      async (c) => {
        await c.query('SET TRANSACTION READ ONLY');
        return (
          await c.query<{ data: Preview }>(
            'SELECT admin.compute_achievement_config_preview($1,1) data',
            [d.id]
          )
        ).rows[0]!.data;
      }
    );
  };
  const hashes = async (businessOnly = false) => {
    const result: Record<string, string> = {};
    for (const { name } of (
      await root.query<{ name: string }>(
        "SELECT schemaname||'.'||tablename name FROM pg_tables WHERE schemaname IN('identity','core','platform','admin','audit','ops') ORDER BY 1"
      )
    ).rows) {
      if (
        businessOnly &&
        ['admin.achievement_config_drafts', 'admin.achievement_config_previews'].includes(name)
      )
        continue;
      const projection =
        name === 'core.platform_metadata'
          ? "to_jsonb(r)-'architecture_version'-'updated_at'"
          : 'to_jsonb(r)';
      result[name] = (
        await root.query<{ h: string }>(
          `SELECT md5(coalesce(jsonb_agg(${projection} ORDER BY (${projection})::text)::text,'')) h FROM ${name} r ${businessOnly && name === 'audit.events' ? "WHERE r.action NOT LIKE 'achievement.draft_%'" : ''}`
        )
      ).rows[0]!.h;
    }
    return result;
  };
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    oldDir = await mkdtemp(path.join(tmpdir(), 'event-streak41-'));
    for (const name of await readdir(dir))
      if (name.endsWith('.sql') && name < '0042_')
        await copyFile(path.join(dir, name), path.join(oldDir, name));
    await runMigrations(root, oldDir, 'event-streak-before41');
    login = 'event_streak_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime TO ${login}`);
    const url = new URL(db.databaseUrl);
    url.username = login;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    for (const role of ['super_admin', 'master_admin', 'global_viewer']) {
      const p = (
        await root.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://streak.example.invalid',$1,'Synthetic event manager') RETURNING id",
          [role]
        )
      ).rows[0]!.id;
      actors.push(p);
      await root.query(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic streak manager' FROM admin.roles WHERE code=$2",
        [p, role]
      );
    }
    const dates = (
      await root.query<{ start: string; end: string }>(
        'SELECT (CURRENT_DATE-20)::text start,(CURRENT_DATE-16)::text end'
      )
    ).rows[0]!;
    start = dates.start;
    end = dates.end;
    const region = (
      await root.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('streak-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'streak-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'streak-region','operational','區域','Region' FROM c RETURNING id"
      )
    ).rows[0]!.id;
    for (let n = 0; n < 2; n++) {
      const person = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic streak learner','UTC') RETURNING id"
        )
      ).rows[0]!.id;
      const identity = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at) VALUES($1,'telegram',$2,clock_timestamp()-INTERVAL '1 day') RETURNING id",
          [person, '543210000' + n]
        )
      ).rows[0]!.id;
      const assignment = (
        await root.query<{ id: string }>(
          "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-100) RETURNING id",
          [person, region]
        )
      ).rows[0]!.id;
      await root.query(
        "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,valid_from) VALUES($1,$2,'onboarding',clock_timestamp()-INTERVAL '1 day')",
        [person, identity]
      );
      for (const offset of n === 0 ? [-6, -5, -4, 0, 1, 2, 4, 6] : [-6, -5, -4, 0, 2, 4, 6]) {
        const checkin = (
          await root.query<{ id: string }>(
            "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) VALUES($1,$2,$3::date+$4::integer,'UTC','regular',$5) RETURNING id",
            [person, identity, start, offset, assignment]
          )
        ).rows[0]!.id;
        if (offset === 0) {
          await root.query(
            "INSERT INTO core.checkin_method_selections(checkin_id,practice_method_id) SELECT $1,id FROM core.practice_methods WHERE code IN('huichun_chu','huichun_zhong')",
            [checkin]
          );
          await root.query(
            "INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) VALUES($1,$2,'PRIVATE SYNTHETIC NOTE MUST NOT BE READ')",
            [checkin, person]
          );
        }
      }
      await root.query(
        "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',1)",
        [person]
      );
    }
    legacy = await save();
    cached = (
      await invoke<{ data: Preview }>(
        'SELECT admin.prepare_achievement_config_preview($1,1) data',
        [legacy.id]
      )
    ).rows[0]!.data;
    expect(cached.continuous).toBeUndefined();
    expect(cached.counts.qualifyingAsOf).toBe(2);
    expect(
      (
        await getMigrationStatus(
          root,
          '0042_activity_consecutive_drafts.sql',
          '0042_activity_consecutive_drafts.sql'
        )
      ).ready
    ).toBe(false);
    const security = async () =>
      (
        await root.query<{ data: unknown }>(
          `SELECT jsonb_build_object('tables',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner::regrole::text,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN('identity','core','platform','admin','audit','ops')),'functions',(SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_array(p.proowner::regrole::text,p.proacl::text,p.prosecdef,p.proconfig,p.provolatile,CASE WHEN p.proname IN('_achievement_config_validate','compute_achievement_config_preview') THEN NULL ELSE md5(pg_get_functiondef(p.oid)) END)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('core','platform','admin','ops') AND p.proname<>'achievement_event_streak_schema_ready')) data`
        )
      ).rows[0]!.data;
    const before = await hashes(),
      beforeSecurity = await security();
    expect(Object.keys(before)).toHaveLength(79);
    expect((await runMigrations(root, dir, 'event-streak42')).applied).toEqual([
      '0042_activity_consecutive_drafts.sql'
    ]);
    expect((await runMigrations(root, dir, 'event-streak42-repeat')).applied).toEqual([]);
    expect(await hashes()).toEqual(before);
    expect(await security()).toEqual(beforeSecurity);
  });
  afterAll(async () => {
    await runtime?.end();
    if (login) {
      await root.query(`DROP OWNED BY ${login}`);
      await root.query(`DROP ROLE ${login}`);
    }
    await dispose?.();
    if (oldDir) await rm(oldDir, { recursive: true, force: true });
  });
  it('keeps41 event JSON, source hashes, revision and cached preview byte-equivalent without a false backfill', async () => {
    const d = (
      await invoke<{ data: Draft }>('SELECT admin.achievement_config_draft($1) data', [legacy.id])
    ).rows[0]!.data;
    expect(d.config).toEqual(legacy.config);
    expect(Object.hasOwn(d.config, 'continuous')).toBe(false);
    expect(d.baseHash).toBe(legacy.baseHash);
    expect(d.revision).toBe(1);
    expect(d.latestPreview).toEqual(cached);
    expect(
      (
        await invoke<{ data: Preview }>(
          'SELECT admin.prepare_achievement_config_preview($1,1) data',
          [legacy.id]
        )
      ).rows[0]!.data
    ).toEqual(cached);
    expect(
      (
        await getMigrationStatus(
          root,
          '0042_activity_consecutive_drafts.sql',
          '0042_activity_consecutive_drafts.sql'
        )
      ).ready
    ).toBe(true);
    expect(
      (
        await getMigrationStatus(
          root,
          '0041_independent_activity_drafts.sql',
          '0041_independent_activity_drafts.sql'
        )
      ).ready
    ).toBe(false);
  });
  it.each([0, 1])(
    'counts cumulative2 and consecutive1 for role%d, without inherited history or double-crediting multiple methods',
    async (actor) => {
      const before = await hashes(true);
      expect((await preview(config(), actor)).counts.qualifyingAsOf).toBe(2);
      const cumulative = await preview(config({ continuous: false }), actor),
        consecutive = await preview(config({ continuous: true }), actor);
      expect(cumulative.continuous).toBe(false);
      expect(cumulative.counts.qualifyingAsOf).toBe(2);
      expect(consecutive.continuous).toBe(true);
      expect(consecutive.counts.qualifyingAsOf).toBe(1);
      expect(consecutive.counts).toMatchObject({ wouldRevoke: 0, currentlyAwarded: 0 });
      expect(consecutive.publicationEnabled).toBe(false);
      expect(
        Date.parse(consecutive.deadline.settlementAt) -
          Date.parse(consecutive.deadline.latestMakeupCutoff)
      ).toBe(86400000);
      expect(await hashes(true)).toEqual(before);
    }
  );
  it('uses a complete run inside both bounds rather than current streak or dates before/after the interval', async () => {
    expect(
      (await preview(config({ continuous: true, requiredDays: 4 }))).counts.qualifyingAsOf
    ).toBe(0);
    expect(
      (await preview(config({ continuous: false, requiredDays: 4 }))).counts.qualifyingAsOf
    ).toBe(1);
    const later = (await root.query<{ d: string }>('SELECT ($1::date+2)::text d', [start])).rows[0]!
      .d;
    expect(
      (await preview(config({ startDate: later, effectiveDate: later, continuous: true }))).counts
        .qualifyingAsOf
    ).toBe(0);
    const sooner = (await root.query<{ d: string }>('SELECT ($1::date+1)::text d', [start]))
      .rows[0]!.d;
    expect(
      (await preview(config({ endDate: sooner, requiredDays: 2, continuous: true }))).counts
        .qualifyingAsOf
    ).toBe(1);
  });
  it('treats leap-day and year boundaries as consecutive practice calendar dates', async () => {
    const seed = (
      await root.query<{
        person_id: string;
        submitted_via_identity_id: string;
        region_assignment_id: string;
      }>(
        'SELECT person_id,submitted_via_identity_id,region_assignment_id FROM core.checkins LIMIT 1'
      )
    ).rows[0]!;
    for (const dates of [
      ['2024-02-28', '2024-02-29', '2024-03-01'],
      ['2025-12-31', '2026-01-01', '2026-01-02']
    ]) {
      for (const date of dates)
        await root.query(
          "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) VALUES($1,$2,$3,'UTC','regular',$4)",
          [seed.person_id, seed.submitted_via_identity_id, date, seed.region_assignment_id]
        );
      const before = await hashes(true);
      expect(
        (
          await preview(
            config({
              effectiveDate: dates[0]!,
              startDate: dates[0]!,
              endDate: dates[2]!,
              continuous: true
            })
          )
        ).counts.qualifyingAsOf
      ).toBe(1);
      expect(await hashes(true)).toEqual(before);
    }
  });
  it('changes only an intentionally saved revision when toggled, invalidates the old cache and preserves identity', async () => {
    const d = await save(config({ continuous: true }), null, null, 0, 1),
      old = (
        await invoke<{ data: Preview }>(
          'SELECT admin.prepare_achievement_config_preview($1,1) data',
          [d.id],
          1
        )
      ).rows[0]!.data;
    expect(old.continuous).toBe(true);
    const updated = await save(config({ continuous: false }), d.id, d.code, 1, 1);
    expect(updated.revision).toBe(2);
    expect(updated.code).toBe(d.code);
    expect(updated.latestPreview).toBeNull();
    expect(updated.config.continuous).toBe(false);
    await expect(
      invoke('SELECT admin.compute_achievement_config_preview($1,1)', [d.id], 1)
    ).rejects.toMatchObject({ code: '40001' });
    const fresh = (
      await invoke<{ data: Preview }>(
        'SELECT admin.compute_achievement_config_preview($1,2) data',
        [d.id],
        1
      )
    ).rows[0]!.data;
    expect(fresh.continuous).toBe(false);
    expect(fresh.counts.qualifyingAsOf).toBe(2);
  });
  it('rejects non-booleans and seasonal overrides without adding draft rows', async () => {
    const before = (await root.query('SELECT count(*)::int n FROM admin.achievement_config_drafts'))
      .rows[0]!.n;
    for (const continuous of ['true', 1, null])
      await expect(
        invoke(
          "SELECT admin.save_achievement_config_draft(NULL,0,'event',NULL,NULL,$1,'Synthetic invalid flag')",
          [{ ...config(), continuous }]
        )
      ).rejects.toMatchObject({ code: '22023' });
    for (const code of ['seasonal_summer', 'seasonal_winter'])
      await expect(
        invoke(
          "SELECT admin.save_achievement_config_draft(NULL,0,'activity',$1,2199,$2,'No seasonal override')",
          [
            code,
            config({
              effectiveDate: '2199-01-01',
              startDate: '2199-01-01',
              endDate: '2199-01-31',
              continuous: true
            })
          ]
        )
      ).rejects.toMatchObject({ code: '22023' });
    expect(
      (await root.query('SELECT count(*)::int n FROM admin.achievement_config_drafts')).rows[0]!.n
    ).toBe(before);
  });
  it('keeps private/worker grants denied, viewer writes denied and only the new42 readiness true', async () => {
    await expect(save(config({ continuous: true }), null, null, 0, 2)).rejects.toMatchObject({
      code: '42501'
    });
    expect(
      (
        await root.query(
          "SELECT ops.achievement_event_streak_schema_ready() current,ops.achievement_event_drafts_schema_ready() previous,has_table_privilege('qigong_api_runtime','admin.achievement_config_drafts','SELECT') raw,has_function_privilege('qigong_worker_runtime','admin.prepare_achievement_config_preview(uuid,integer)','EXECUTE') worker"
        )
      ).rows[0]
    ).toEqual({ current: true, previous: false, raw: false, worker: false });
  });
});
