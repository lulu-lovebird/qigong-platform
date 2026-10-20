import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getMigrationStatus, runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
interface Version {
  ruleVersion: number;
  configurationKnown: boolean;
  name: string;
  threshold: number | null;
  recipientCount: number;
}
interface Catalog {
  badges: Array<{ code: string; versions: Version[] }>;
}
interface Recipients {
  ruleVersion: number;
  total: number;
  configurationKnown: boolean;
  rows: Array<{ personId: string; awards: Array<{ ruleVersion: number }> }>;
}
suite('Additive immutable achievement versions and scoped historical readers', () => {
  let root: Pool,
    runtime: Pool,
    dispose: () => Promise<void>,
    login: string,
    oldDir: string,
    target43: string,
    regionA: string,
    regionB: string,
    alice: string,
    bob: string;
  const actors: Record<string, string> = {};
  const invoke = async <T extends pg.QueryResultRow>(
    actor: string,
    sql: string,
    values: unknown[] = [],
    readonly = true
  ) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: actors[actor]! },
      async (c) => {
        if (readonly) await c.query('SET TRANSACTION READ ONLY');
        return c.query<T>(sql, values);
      }
    );
  const catalog = async (actor = 'region') =>
    (
      await invoke<{ data: Catalog }>(
        actor,
        "SELECT admin.achievement_version_catalog('zh_TW',NULL,NULL,'',NULL) data"
      )
    ).rows[0]!.data;
  const recipients = async (version: number, actor = 'region') =>
    (
      await invoke<{ data: Recipients }>(
        actor,
        "SELECT admin.achievement_version_recipients('streak_3','zh_TW',NULL,NULL,'',NULL,1,20,$1) data",
        [version]
      )
    ).rows[0]!.data;
  const hashes = async () => {
    const result: Record<string, string> = {};
    for (const { name } of (
      await root.query<{ name: string }>(
        "SELECT schemaname||'.'||tablename name FROM pg_tables WHERE schemaname IN('core','identity','admin','platform','audit','ops') AND tablename<>'achievement_rule_versions' ORDER BY 1"
      )
    ).rows)
      result[name] = (
        await root.query<{ h: string }>(
          `SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'')) h FROM ${name} r`
        )
      ).rows[0]!.h;
    return result;
  };
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    oldDir = await mkdtemp(path.join(tmpdir(), 'versions42-'));
    target43 = await mkdtemp(path.join(tmpdir(), 'versions43-'));
    for (const f of await readdir(dir)) {
      if (f.endsWith('.sql') && f < '0043_')
        await copyFile(path.join(dir, f), path.join(oldDir, f));
      if (f.endsWith('.sql') && f < '0044_')
        await copyFile(path.join(dir, f), path.join(target43, f));
    }
    await runMigrations(root, oldDir, 'versions-before42');
    login = 'versions_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime TO ${login}`);
    const url = new URL(db.databaseUrl);
    url.username = login;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    const parent = (
      await root.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('versions-global','global','全球','Global') RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'versions-country','country','國家','Country' FROM g RETURNING id"
      )
    ).rows[0]!.id;
    const regions = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'versions-a','operational','甲區','A'),($1,'versions-b','operational','乙區','B') RETURNING id",
        [parent]
      )
    ).rows;
    regionA = regions[0]!.id;
    regionB = regions[1]!.id;
    for (const [actor, role] of [
      ['super', 'super_admin'],
      ['master', 'master_admin'],
      ['region', 'regional_admin'],
      ['viewer', 'global_viewer']
    ] as const) {
      const id = (
        await root.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://versions.example.invalid',$1,$1) RETURNING id",
          [actor]
        )
      ).rows[0]!.id;
      actors[actor] = id;
      await root.query(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,valid_from,reason) SELECT $1,id,$3,$4,clock_timestamp()-INTERVAL '1 day','Synthetic version scope' FROM admin.roles WHERE code=$2",
        [id, role, actor === 'region' ? 'region' : 'global', actor === 'region' ? regionA : null]
      );
    }
    for (const [name, region] of [
      ['Synthetic A', regionA],
      ['Synthetic B', regionB]
    ]) {
      const person = (
        await root.query<{ id: string }>(
          'INSERT INTO identity.people(preferred_name) VALUES($1) RETURNING id',
          [name]
        )
      ).rows[0]!.id;
      if (region === regionA) alice = person;
      else bob = person;
      const identity = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at) VALUES($1,'telegram',$2,clock_timestamp()-INTERVAL '1 day') RETURNING id",
          [person, randomUUID()]
        )
      ).rows[0]!.id;
      await root.query(
        "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-30)",
        [person, region]
      );
      await root.query(
        "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,valid_from) VALUES($1,$2,'onboarding',clock_timestamp()-INTERVAL '1 day')",
        [person, identity]
      );
      await root.query(
        "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',1),($1,'streak_3','lifetime',$2)",
        [person, region === regionA ? 7 : 9]
      );
    }
    const before = await hashes();
    expect(Object.keys(before)).toHaveLength(79);
    const oldFunctions = (
      await root.query<{ signature: string; definition: string }>(
        "SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('core','admin','platform','ops')"
      )
    ).rows;
    expect((await runMigrations(root, target43, 'versions43')).applied).toEqual([
      '0043_achievement_rule_versions.sql'
    ]);
    expect((await runMigrations(root, target43, 'versions43-repeat')).applied).toEqual([]);
    expect(await hashes()).toEqual(before);
    for (const f of oldFunctions)
      expect(
        (
          await root.query<{ definition: string }>(
            'SELECT pg_get_functiondef($1::regprocedure) definition',
            [f.signature]
          )
        ).rows[0]!.definition
      ).toBe(f.definition);
    await root.query(
      "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version,revoked_at) VALUES($1,'streak_3','lifetime',8,clock_timestamp())",
      [alice]
    );
  });
  beforeEach(async () => {
    await root.query('DELETE FROM admin.achievement_export_limits');
  });
  afterAll(async () => {
    await runtime?.end();
    if (login) {
      await root.query(`DROP OWNED BY ${login}`);
      await root.query(`DROP ROLE ${login}`);
    }
    await dispose?.();
    if (oldDir) await rm(oldDir, { recursive: true, force: true });
    if (target43) await rm(target43, { recursive: true, force: true });
  });
  it('keeps42/43 compatibility, worker phase27 and all49 original snapshots without publishing', async () => {
    expect(
      (
        await getMigrationStatus(
          root,
          '0042_activity_consecutive_drafts.sql',
          '0043_achievement_rule_versions.sql'
        )
      ).ready
    ).toBe(true);
    expect(
      (
        await root.query(
          'SELECT ops.achievement_event_streak_schema_ready() old_gate,ops.achievement_rule_versions_schema_ready() versions'
        )
      ).rows[0]
    ).toEqual({ old_gate: true, versions: true });
    expect(
      (
        await root.query(
          "SELECT count(*)::int n FROM core.achievement_rule_versions WHERE provenance='legacy_snapshot'"
        )
      ).rows[0]!.n
    ).toBe(49);
  });
  it('does not invent unknown historical conditions and scopes version metadata/recipients', async () => {
    const before = await hashes(),
      regional = await catalog(),
      badge = regional.badges.find((b) => b.code === 'streak_3')!;
    expect(regional.badges).toHaveLength(49);
    expect(badge.versions.map((v) => v.ruleVersion)).toEqual([8, 7, 1]);
    expect(badge.versions.find((v) => v.ruleVersion === 7)).toMatchObject({
      configurationKnown: false,
      threshold: null,
      name: 'streak_3 · v7',
      recipientCount: 1
    });
    expect((await recipients(7)).rows[0]!.personId).toBe(alice);
    await expect(recipients(9)).rejects.toMatchObject({ code: 'P0002' });
    expect((await recipients(9, 'super')).rows[0]!.personId).toBe(bob);
    expect(await hashes()).toEqual(before);
  });
  it('shows stored revoked history only to its learner reader and leaves historical rows untouched', async () => {
    const before = await hashes();
    const badges = (
      await root.query<{
        data: Array<{
          code: string;
          ruleVersion: number;
          configurationKnown: boolean;
          awards: Array<{ revoked: boolean }>;
        }>;
      }>("SELECT platform._achievement_version_badges($1,'en') data", [alice])
    ).rows[0]!.data;
    expect(badges.find((b) => b.code === 'streak_3' && b.ruleVersion === 8)).toMatchObject({
      configurationKnown: false,
      awards: [{ revoked: true }]
    });
    expect(badges.some((b) => b.ruleVersion === 9)).toBe(false);
    expect(await hashes()).toEqual(before);
  });
  it('rejects UPDATE/DELETE/TRUNCATE of snapshots, raw runtime reads and private helper calls', async () => {
    await expect(
      root.query(
        "UPDATE core.achievement_rule_versions SET provenance=provenance WHERE badge_code='streak_3'"
      )
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      root.query("DELETE FROM core.achievement_rule_versions WHERE badge_code='streak_3'")
    ).rejects.toMatchObject({ code: '55000' });
    await expect(root.query('TRUNCATE core.achievement_rule_versions')).rejects.toMatchObject({
      code: '55000'
    });
    await expect(
      invoke('super', 'SELECT * FROM core.achievement_rule_versions')
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      invoke('super', "SELECT admin._achievement_version_definition('streak_3',1,'en')")
    ).rejects.toMatchObject({ code: '42501' });
  });
  it.each(['super', 'master'])(
    'exports exactly one historical version for %s with existing audit/cooldown/contacts boundaries',
    async (actor) => {
      const before = (await root.query('SELECT count(*)::int n FROM audit.events')).rows[0]!.n;
      const preview = (
        await invoke<{ data: { ruleVersion: number; count: number } }>(
          actor,
          "SELECT admin.achievement_version_export_preview('streak_3','en',NULL,NULL,'',NULL,7) data",
          [],
          false
        )
      ).rows[0]!.data;
      expect(preview).toMatchObject({ ruleVersion: 7, count: 1 });
      const data = (
        await invoke<{
          data: {
            ruleVersion: number;
            count: number;
            rows: Array<{ name: string; phone: string; email: string }>;
          };
        }>(
          actor,
          "SELECT admin.prepare_achievement_version_export('streak_3','en',NULL,NULL,'',NULL,'internal_review',7) data",
          [],
          false
        )
      ).rows[0]!.data;
      expect(data.ruleVersion).toBe(7);
      expect(data.count).toBe(1);
      expect(data.rows[0]).toMatchObject({ name: 'Synthetic A', phone: '', email: '' });
      expect((await root.query('SELECT count(*)::int n FROM audit.events')).rows[0]!.n).toBe(
        before + 1
      );
      await expect(
        invoke(
          actor,
          "SELECT admin.prepare_achievement_version_export('streak_3','en',NULL,NULL,'',NULL,'internal_review',7)",
          [],
          false
        )
      ).rejects.toMatchObject({ code: 'P0001' });
    }
  );
  it('keeps a verified historical snapshot independent from later current-definition edits', async () => {
    const snapshot = (
      await root.query<{ snapshot: unknown }>(
        "SELECT snapshot FROM core.achievement_rule_versions WHERE badge_code='streak_3' AND rule_version=1"
      )
    ).rows[0]!.snapshot;
    const copied = (
      await root.query<{ data: unknown }>(
        "SELECT jsonb_set(jsonb_set(jsonb_set($1::jsonb,'{definition,rule_version}','2'),'{definition,name_zh_tw}',to_jsonb('Verified historical rule'::text)),'{definition,threshold}','4') data",
        [snapshot]
      )
    ).rows[0]!.data;
    await root.query(
      "INSERT INTO core.achievement_rule_versions(badge_code,rule_version,provenance,snapshot,source_hash) VALUES('streak_3',2,'legacy_snapshot',$1,encode(public.digest($1::jsonb::text,'sha256'),'hex'))",
      [copied]
    );
    await root.query(
      "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',2)",
      [alice]
    );
    const current = (
      await root.query<{ name_zh_tw: string; threshold: number }>(
        "SELECT name_zh_tw,threshold FROM core.practice_badge_definitions WHERE code='streak_3'"
      )
    ).rows[0]!;
    try {
      await root.query(
        "UPDATE core.practice_badge_definitions SET name_zh_tw='Do not substitute current name',threshold=999 WHERE code='streak_3'"
      );
      const options = (await catalog()).badges.find((b) => b.code === 'streak_3')!.versions;
      expect(options.find((v) => v.ruleVersion === 2)).toMatchObject({
        name: 'Verified historical rule',
        threshold: 4,
        configurationKnown: true,
        recipientCount: 1
      });
      const historic = await recipients(2);
      expect(historic.total).toBe(1);
      expect(historic.configurationKnown).toBe(true);
      const exported = (
        await invoke<{ data: { name: string; ruleVersion: number; count: number } }>(
          'super',
          "SELECT admin.prepare_achievement_version_export('streak_3','zh_TW',NULL,NULL,'',NULL,'internal_review',2) data",
          [],
          false
        )
      ).rows[0]!.data;
      expect(exported).toMatchObject({
        name: 'Verified historical rule',
        ruleVersion: 2,
        count: 1
      });
    } finally {
      await root.query(
        "UPDATE core.practice_badge_definitions SET name_zh_tw=$1,threshold=$2 WHERE code='streak_3'",
        [current.name_zh_tw, current.threshold]
      );
    }
  });
  it('denies viewer exports and rejects invalid/nonexistent versions without preparing anything', async () => {
    await expect(
      invoke(
        'viewer',
        "SELECT admin.achievement_version_export_preview('streak_3','en',NULL,NULL,'',NULL,7)",
        [],
        false
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(recipients(0)).rejects.toMatchObject({ code: '22023' });
    await expect(recipients(999)).rejects.toMatchObject({ code: 'P0002' });
    expect(
      (
        await root.query(
          "SELECT has_function_privilege('qigong_worker_runtime','admin.achievement_version_catalog(text,uuid,text,text,integer)','EXECUTE') allowed,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='core.achievement_rule_versions'::regclass"
        )
      ).rows[0]
    ).toEqual({ allowed: false, relrowsecurity: true, relforcerowsecurity: true });
  });
});
