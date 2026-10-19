import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
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
}
interface Draft {
  id: string;
  code: string;
  subject: string;
  year: null | number;
  revision: number;
  baseHash: string;
  sourceChanged: boolean;
  baseConfig: { definition: unknown; season: unknown };
  config: Config;
}
interface Preview {
  publicationEnabled: boolean;
  counts: { qualifyingAsOf: number; currentlyAwarded: number; wouldRevoke: number };
  deadline: { latestMakeupCutoff: string; settlementAt: string };
}
suite('Independent activity badges and lossless40→41 upgrade', () => {
  let root: Pool,
    runtime: Pool,
    dispose: () => Promise<void>,
    login: string,
    oldDir: string,
    start: string,
    end: string,
    oldDraft: Draft,
    oldPreview: unknown;
  const principals: string[] = [];
  const invoke = async <T extends pg.QueryResultRow>(
    sql: string,
    values: unknown[] = [],
    actor = 0
  ) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: principals[actor]! },
      (c) => c.query<T>(sql, values)
    );
  const config = (extra: Partial<Config> = {}): Config => ({
    nameZhTw: '獨立活動',
    nameZhCn: '',
    nameEn: 'Independent event',
    description: 'Synthetic activity',
    effectiveDate: start,
    startDate: start,
    endDate: end,
    timezone: 'UTC',
    requiredDays: 3,
    ...extra
  });
  const save = async (
    c = config(),
    id: string | null = null,
    code: string | null = null,
    revision = 0,
    actor = 0
  ) =>
    (
      await invoke<{ data: Draft }>(
        "SELECT admin.save_achievement_config_draft($1,$2,'event',$3,NULL,$4,'Synthetic independent activity') data",
        [id, revision, code, c],
        actor
      )
    ).rows[0]!.data;
  const tableHashes = async (excludeDrafts = false) => {
    const names = (
      await root.query<{ name: string }>(
        "SELECT schemaname||'.'||tablename name FROM pg_tables WHERE schemaname IN('identity','core','platform','admin','audit','ops') ORDER BY 1"
      )
    ).rows;
    const hashes: Record<string, string> = {};
    for (const { name } of names) {
      if (
        excludeDrafts &&
        ['admin.achievement_config_drafts', 'admin.achievement_config_previews'].includes(name)
      )
        continue;
      const projection =
        name === 'core.platform_metadata'
          ? "to_jsonb(r)-'architecture_version'-'updated_at'"
          : 'to_jsonb(r)';
      hashes[name] = (
        await root.query<{ h: string }>(
          `SELECT md5(coalesce(jsonb_agg(${projection} ORDER BY (${projection})::text)::text,'')) h FROM ${name} r ${excludeDrafts && name === 'audit.events' ? "WHERE r.action NOT LIKE 'achievement.draft_%'" : ''}`
        )
      ).rows[0]!.h;
    }
    return hashes;
  };
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    oldDir = await mkdtemp(path.join(tmpdir(), 'activity40-'));
    for (const name of await readdir(dir))
      if (name.endsWith('.sql') && name < '0041_')
        await copyFile(path.join(dir, name), path.join(oldDir, name));
    await runMigrations(root, oldDir, 'event-before40');
    login = 'event_' + randomUUID().replaceAll('-', '');
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
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://event.example.invalid',$1,'Synthetic activity manager') RETURNING id",
          [role]
        )
      ).rows[0]!.id;
      principals.push(p);
      await root.query(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic event' FROM admin.roles WHERE code=$2",
        [p, role]
      );
    }
    const dates = (
      await root.query<{ start: string; end: string }>(
        'SELECT (CURRENT_DATE-10)::text start,(CURRENT_DATE-6)::text end'
      )
    ).rows[0]!;
    start = dates.start;
    end = dates.end;
    const region = (
      await root.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('event-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'event-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'event-region','operational','區域','Region' FROM c RETURNING id"
      )
    ).rows[0]!.id;
    for (let n = 0; n < 2; n++) {
      const person = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic event learner','UTC') RETURNING id"
        )
      ).rows[0]!.id;
      const identity = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at) VALUES($1,'telegram',$2,clock_timestamp()-INTERVAL '1 day') RETURNING id",
          [person, '765432100' + n]
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
      for (const offset of n === 0 ? [-2, -1, 0, 1, 3, 6] : [-2, -1, 0, 6])
        await root.query(
          "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) VALUES($1,$2,$3::date+$4::integer,'UTC','regular',$5)",
          [person, identity, start, offset, assignment]
        );
    }
    oldDraft = (
      await invoke<{ data: Draft }>(
        "SELECT admin.save_achievement_config_draft(NULL,0,'activity','seasonal_summer',2199,$1,'Synthetic existing seasonal draft') data",
        [
          config({
            effectiveDate: '2199-01-01',
            startDate: '2199-01-01',
            endDate: '2199-01-31',
            requiredDays: 7
          })
        ]
      )
    ).rows[0]!.data;
    oldPreview = (
      await invoke<{ data: unknown }>(
        'SELECT admin.prepare_achievement_config_preview($1,1) data',
        [oldDraft.id]
      )
    ).rows[0]!.data;
    const security = async () =>
      (
        await root.query<{ data: unknown }>(`SELECT jsonb_build_object(
      'tables',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner::regrole::text,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN('identity','core','platform','admin','audit','ops')),
      'functions',(SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_array(p.proowner::regrole::text,p.proacl::text,p.prosecdef,p.proconfig,p.provolatile,CASE WHEN p.proname IN('_achievement_config_source','_achievement_config_validate','save_achievement_config_draft','compute_achievement_config_preview') THEN NULL ELSE md5(pg_get_functiondef(p.oid)) END)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('core','platform','admin','ops') AND p.proname<>'achievement_event_drafts_schema_ready')) data`)
      ).rows[0]!.data;
    const before = await tableHashes(),
      beforeSecurity = await security();
    expect(Object.keys(before)).toHaveLength(79);
    expect((await runMigrations(root, dir, 'event-upgrade41')).applied).toEqual([
      '0041_independent_activity_drafts.sql'
    ]);
    expect((await runMigrations(root, dir, 'event-repeat41')).applied).toEqual([]);
    expect(await tableHashes()).toEqual(before);
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
  it('preserves every old row including seasonal drafts, cached previews and source hashes through41', async () => {
    const detail = (
      await invoke<{ data: Draft }>('SELECT admin.achievement_config_draft($1) data', [oldDraft.id])
    ).rows[0]!.data;
    expect(detail.baseHash).toBe(oldDraft.baseHash);
    expect(detail.config).toEqual(oldDraft.config);
    expect(detail.sourceChanged).toBe(false);
    expect(
      (
        await invoke<{ data: unknown }>(
          'SELECT admin.prepare_achievement_config_preview($1,1) data',
          [oldDraft.id]
        )
      ).rows[0]!.data
    ).toEqual(oldPreview);
    expect(
      (
        await root.query(
          'SELECT ops.achievement_event_drafts_schema_ready() current,ops.achievement_management_schema_ready() previous'
        )
      ).rows[0]
    ).toEqual({ current: true, previous: false });
  });
  it.each([0, 1])(
    'gives role%d a separate generated identity even for identical activity names and dates',
    async (actor) => {
      const before = await tableHashes(true),
        one = await save(config(), null, null, 0, actor),
        two = await save(config(), null, null, 0, actor);
      expect(one.code).toMatch(/^event_[a-f0-9]{32}$/);
      expect(two.code).not.toBe(one.code);
      expect(one.baseConfig).toEqual({ definition: null, season: null });
      expect(one.year).toBeNull();
      expect(one.config).toEqual(config());
      expect(await tableHashes(true)).toEqual(before);
    }
  );
  it('counts only distinct dates within the independent interval regardless of method, supports read-only preview, and never changes awards', async () => {
    const d = await save(),
      before = await tableHashes(true);
    const result = await withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: principals[0]! },
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
    expect(result.counts).toMatchObject({ qualifyingAsOf: 1, currentlyAwarded: 0, wouldRevoke: 0 });
    expect(result.publicationEnabled).toBe(false);
    expect(
      Date.parse(result.deadline.settlementAt) - Date.parse(result.deadline.latestMakeupCutoff)
    ).toBe(86400000);
    expect(await tableHashes(true)).toEqual(before);
  });
  it('rejects seasonal/client identity forgery, invalid blank fields, dates and timezone without writes', async () => {
    for (const code of [
      'seasonal_summer',
      'event_' + 'a'.repeat(32),
      'challenge_' + 'a'.repeat(32)
    ])
      await expect(save(config(), null, code)).rejects.toMatchObject({ code: '22023' });
    for (const bad of [
      { nameZhTw: '' },
      { requiredDays: 0 },
      { requiredDays: 6 },
      { timezone: 'not/a_zone' },
      { endDate: '2000-01-01' },
      { effectiveDate: '2000-01-01' }
    ])
      await expect(save(config(bad))).rejects.toMatchObject({ code: '22023' });
  });
  it('retains server identities on update and rejects stale revisions or cross-subject conversion', async () => {
    const d = await save(),
      updated = await save(config({ nameZhTw: 'Edited independent activity' }), d.id, d.code, 1);
    expect(updated.code).toBe(d.code);
    expect(updated.revision).toBe(2);
    await expect(save(config(), d.id, d.code, 1)).rejects.toMatchObject({ code: '40001' });
    await expect(save(config(), d.id, 'event_' + 'b'.repeat(32), 2)).rejects.toMatchObject({
      code: '40001'
    });
    await expect(
      invoke(
        "SELECT admin.save_achievement_config_draft($1,2,'activity','seasonal_summer',2199,$2,'Synthetic conversion')",
        [d.id, oldDraft.config]
      )
    ).rejects.toMatchObject({ code: '40001' });
  });
  it('keeps raw tables/private helpers forbidden and denies viewer writes', async () => {
    await expect(save(config(), null, null, 0, 2)).rejects.toMatchObject({ code: '42501' });
    expect(
      (
        await root.query(
          "SELECT has_table_privilege('qigong_api_runtime','admin.achievement_config_drafts','SELECT') raw,has_function_privilege('qigong_worker_runtime','admin.save_achievement_config_draft(uuid,integer,text,text,integer,jsonb,text)','EXECUTE') worker"
        )
      ).rows[0]
    ).toEqual({ raw: false, worker: false });
  });
});
