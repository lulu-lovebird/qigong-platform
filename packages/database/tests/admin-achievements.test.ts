import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
interface Badge {
  code: string;
  kind: string;
  name: string;
  recipientCount: number;
  configured: boolean;
  periods: Array<{ period: string; recipientCount: number }>;
}
interface Catalog {
  badges: Badge[];
  regions: Array<{ id: string; name: string }>;
  readOnly: boolean;
}
interface Recipients {
  code: string;
  total: number;
  totalPages: number;
  page: number;
  rows: Array<{
    personId: string;
    displayName: string;
    platform: string | null;
    regionName: string | null;
    awards: Array<{ period: string; ruleVersion: number; earnedAt: string }>;
  }>;
}
suite('Scoped read-only administrator achievement facades', () => {
  let root: Pool, runtime: Pool, dispose: () => Promise<void>, login: string;
  let regionA: string, regionB: string, country: string, cohort: string;
  let alice: string, bob: string;
  const principals = new Map<string, string>();
  const makePrincipal = async (
    name: string,
    role: string,
    scope: string,
    scopeId: string | null = null
  ) => {
    const id = (
      await root.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://achievements.example.invalid',$1,$1) RETURNING id",
        [name]
      )
    ).rows[0]!.id;
    await root.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,cohort_id,valid_from,reason) SELECT $1,id,$3,CASE WHEN $3 IN('country','region') THEN $4::uuid END,CASE WHEN $3='cohort' THEN $4::uuid END,clock_timestamp()-INTERVAL '1 day','Synthetic achievement fixture' FROM admin.roles WHERE code=$2",
      [id, role, scope, scopeId]
    );
    principals.set(name, id);
  };
  const makePerson = async (name: string, region: string, platform: string, suspended = false) => {
    const person = (
      await root.query<{ id: string }>(
        'INSERT INTO identity.people(preferred_name,status) VALUES($1,$2) RETURNING id',
        [name, suspended ? 'suspended' : 'active']
      )
    ).rows[0]!.id;
    const identity = (
      await root.query<{ id: string }>(
        'INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,$2,$3) RETURNING id',
        [person, platform, randomUUID()]
      )
    ).rows[0]!.id;
    await root.query(
      "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-30)",
      [person, region]
    );
    if (!suspended)
      await root.query(
        "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,valid_from) VALUES($1,$2,'onboarding',clock_timestamp()-INTERVAL '1 day')",
        [person, identity]
      );
    await root.query(
      "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',1)",
      [person]
    );
    return person;
  };
  const invoke = async <T extends pg.QueryResultRow>(
    actor: string | null,
    sql: string,
    params: unknown[] = []
  ) => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query('SET LOCAL ROLE qigong_api_runtime');
      await client.query(
        "SELECT set_config('qigong.principal_id',$1,TRUE),set_config('qigong.request_id',$2,TRUE)",
        [actor ? principals.get(actor) : '', randomUUID()]
      );
      return await client.query<T>(sql, params);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };
  const catalog = async (
    actor: string | null = 'regional',
    region: string | null = null,
    platform: string | null = null,
    q = '',
    year: number | null = null,
    locale = 'zh_TW'
  ) =>
    (
      await invoke<{ data: Catalog }>(
        actor,
        'SELECT admin.achievement_catalog($1,$2,$3,$4,$5) data',
        [locale, region, platform, q, year]
      )
    ).rows[0]!.data;
  const recipients = async (
    actor = 'regional',
    code = 'streak_3',
    page = 1,
    limit = 20,
    year: number | null = null,
    q = ''
  ) =>
    (
      await invoke<{ data: Recipients }>(
        actor,
        'SELECT admin.achievement_recipients($1,$2,$3,$4,$5,$6,$7,$8) data',
        [code, 'zh_TW', null, null, q, year, page, limit]
      )
    ).rows[0]!.data;
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    await runMigrations(root, directory, 'admin-achievements');
    login = 'achievements_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime TO ${login}`);
    const url = new URL(db.databaseUrl);
    url.username = login;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    const global = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('ach-global','global','全球','Global') RETURNING id"
      )
    ).rows[0]!.id;
    country = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'ach-country','country','國家','Country') RETURNING id",
        [global]
      )
    ).rows[0]!.id;
    const other = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'ach-other-country','country','他國','Other country') RETURNING id",
        [global]
      )
    ).rows[0]!.id;
    const regions = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'ach-a','operational','甲區','A'),($1,'ach-b','operational','乙區','B'),($2,'ach-c','operational','丙區','C') RETURNING id",
        [country, other]
      )
    ).rows;
    regionA = regions[0]!.id;
    regionB = regions[1]!.id;
    cohort = (
      await root.query<{ id: string }>(
        "INSERT INTO core.cohorts(region_id,code,name) VALUES($1,'ach-cohort','Synthetic cohort') RETURNING id",
        [regionA]
      )
    ).rows[0]!.id;
    alice = await makePerson('<img src=x> Learner_%', regionA, 'telegram');
    bob = await makePerson('<img src=x> Learner_%', regionB, 'line');
    await makePerson('Other country', regions[2]!.id, 'whatsapp');
    await makePerson('Suspended', regionA, 'line', true);
    await root.query(
      "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'line',$2)",
      [alice, randomUUID()]
    );
    await root.query(
      'INSERT INTO core.cohort_memberships(cohort_id,person_id,valid_from) VALUES($1,$2,CURRENT_DATE-30)',
      [cohort, alice]
    );
    await root.query(
      "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'seasonal_summer','2025',1),($1,'seasonal_summer','2026',1),($2,'seasonal_summer','2026',1),($1,'streak_21','lifetime',2)",
      [alice, bob]
    );
    await root.query(
      "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version,revoked_at) VALUES($1,'streak_7','lifetime',1,clock_timestamp())",
      [alice]
    );
    await root.query(
      "INSERT INTO core.practice_badge_seasons(kind,year,start_date,end_date,timezone,required_days) VALUES('summer',2025,'2025-06-01','2025-06-27','Asia/Taipei',27),('summer',2026,'2026-06-01','2026-06-27','Asia/Taipei',27)"
    );
    await makePrincipal('regional', 'regional_admin', 'region', regionA);
    await makePrincipal('country', 'country_admin', 'country', country);
    await makePrincipal('global', 'global_viewer', 'global');
    await makePrincipal('coach', 'coach', 'cohort', cohort);
    await makePrincipal('content', 'content_admin', 'content');
    await makePrincipal('revocable', 'regional_viewer', 'region', regionA);
    await root.query(
      "INSERT INTO admin.roles(code,description) VALUES('ach_stats_only','Synthetic stats-only')"
    );
    await root.query(
      "INSERT INTO admin.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM admin.roles r,admin.permissions p WHERE r.code='ach_stats_only' AND p.code='stats.read'"
    );
    await makePrincipal('stats', 'ach_stats_only', 'region', regionA);
  });
  afterAll(async () => {
    await runtime?.end();
    if (login) {
      await root.query(`DROP OWNED BY ${login}`);
      await root.query(`DROP ROLE ${login}`);
    }
    await dispose?.();
  });
  it('requires all reporting permissions and denies direct tables/private helper access', async () => {
    for (const actor of [null, 'content', 'stats'])
      await expect(catalog(actor)).rejects.toMatchObject({ code: '42501' });
    for (const table of [
      'core.practice_badge_definitions',
      'core.practice_badge_seasons',
      'core.person_practice_badges',
      'ops.practice_badge_jobs',
      'audit.practice_badge_changes'
    ])
      await expect(invoke('global', 'SELECT * FROM ' + table)).rejects.toMatchObject({
        code: '42501'
      });
    await expect(
      invoke('global', "SELECT * FROM admin._achievement_people(NULL,NULL,'')")
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('scopes names and distinct recipient counts identically for region, country, global and cohort', async () => {
    for (const [actor, count] of [
      ['regional', 1],
      ['country', 2],
      ['global', 3],
      ['coach', 1]
    ] as const) {
      const data = await catalog(actor);
      expect(data.badges).toHaveLength(49);
      expect(data.readOnly).toBe(true);
      expect(data.badges.find((b) => b.code === 'streak_3')?.recipientCount).toBe(count);
      const people = await recipients(actor);
      expect(people.total).toBe(count);
      expect(people.rows).toHaveLength(count);
    }
    expect((await recipients()).rows[0]?.personId).toBe(alice);
    expect((await catalog('coach')).regions).toEqual([{ id: regionA, name: '甲區' }]);
    await expect(catalog('regional', regionB)).rejects.toMatchObject({ code: '42501' });
    await expect(catalog('regional', randomUUID())).rejects.toMatchObject({ code: '42501' });
  });
  it('uses the current interaction channel, literal name search, and never merges equal names', async () => {
    expect(
      (await catalog('regional', null, 'line')).badges.every((b) => b.recipientCount === 0)
    ).toBe(true);
    expect(
      (await catalog('regional', null, 'telegram')).badges.find((b) => b.code === 'streak_3')
        ?.recipientCount
    ).toBe(1);
    expect((await recipients('global', 'streak_3', 1, 20, null, '_%')).total).toBe(2);
    expect((await recipients()).rows[0]?.displayName).toBe('<img src=x> Learner_%');
  });
  it('preserves years, deduplicates people, ignores revoked/other-version awards and shows unconfigured seasons', async () => {
    const data = await catalog('global');
    expect(data.badges.find((b) => b.code === 'seasonal_summer')).toMatchObject({
      recipientCount: 2,
      configured: true,
      periods: [
        { period: '2025', recipientCount: 1 },
        { period: '2026', recipientCount: 2 }
      ]
    });
    expect(data.badges.find((b) => b.code === 'seasonal_winter')).toMatchObject({
      recipientCount: 0,
      configured: false
    });
    expect(data.badges.find((b) => b.code === 'streak_7')?.recipientCount).toBe(0);
    expect(data.badges.find((b) => b.code === 'streak_21')?.recipientCount).toBe(0);
    const people = await recipients('global', 'seasonal_summer');
    expect(people.rows.find((p) => p.personId === alice)?.awards.map((a) => a.period)).toEqual([
      '2025',
      '2026'
    ]);
    expect((await recipients('global', 'seasonal_summer', 1, 20, 2025)).total).toBe(1);
    expect((await recipients('global', 'seasonal_summer', 1, 20, 2026)).total).toBe(2);
    expect((await recipients('global', 'streak_3', 1, 20, 2025)).total).toBe(3);
  });
  it('paginates deterministically with identical counts and localizes system labels without converting names', async () => {
    const first = await recipients('global', 'streak_3', 1, 1),
      second = await recipients('global', 'streak_3', 2, 1);
    expect(first.total).toBe(3);
    expect(first.totalPages).toBe(3);
    expect(second.total).toBe(3);
    expect(first.rows[0]?.personId === second.rows[0]?.personId).toBe(false);
    expect((await recipients('global', 'streak_3', 99, 1)).rows).toEqual([]);
    expect((await catalog('regional', null, null, '', null, 'en')).regions).toEqual([
      { id: regionA, name: 'A' }
    ]);
  });
  it('validates all SQL entry parameters and never changes awards, jobs or audit during reads', async () => {
    const snapshot = async () =>
      (
        await root.query<{ value: string }>(`SELECT md5(jsonb_build_array(
      (SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY person_id,badge_code,period,rule_version),'[]') FROM core.person_practice_badges b),
      (SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY person_id),'[]') FROM ops.practice_badge_jobs j),
      (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM audit.events e),(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM audit.practice_badge_changes c))::text) value`)
      ).rows[0]!.value;
    const before = await snapshot();
    await catalog();
    await recipients();
    expect(await snapshot()).toBe(before);
    for (const year of [0, 2201])
      await expect(catalog('global', null, null, '', year)).rejects.toMatchObject({
        code: '22023'
      });
    await expect(catalog('global', null, 'forged')).rejects.toMatchObject({ code: '22023' });
    await expect(recipients('global', 'unknown')).rejects.toMatchObject({ code: 'P0002' });
    await expect(recipients('global', 'streak_3', 0)).rejects.toMatchObject({ code: '22023' });
    await expect(recipients('global', 'streak_3', 1, 101)).rejects.toMatchObject({ code: '22023' });
    const publicFunctions = await root.query<{ n: number }>(
      "SELECT count(*)::integer n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname IN('_achievement_people','achievement_catalog','achievement_recipients','admin_achievements_schema_ready') AND EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')"
    );
    expect(publicFunctions.rows[0]?.n).toBe(0);
  });
  it('honors a revoked grant and disabled principal on the next read without touching badges', async () => {
    expect((await recipients('revocable')).total).toBe(1);
    await root.query(
      'UPDATE admin.role_grants SET valid_to=clock_timestamp() WHERE principal_id=$1',
      [principals.get('revocable')]
    );
    await expect(catalog('revocable')).rejects.toMatchObject({ code: '42501' });
    await root.query("UPDATE admin.principals SET status='disabled' WHERE id=$1", [
      principals.get('regional')
    ]);
    await expect(catalog()).rejects.toMatchObject({ code: '42501' });
  });
});
