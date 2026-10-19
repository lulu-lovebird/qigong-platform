import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
interface Challenge {
  nameZhTw: string;
  nameZhCn: string;
  nameEn: string;
  description: string;
  effectiveDate: string;
  threshold: number;
  continuous: boolean;
  methodCodes: string[];
  methodMatch: 'any' | 'all';
  startMode: 'effective' | 'date';
  startDate: string | null;
}
interface Draft {
  id: string;
  code: string;
  revision: number;
  subject: string;
  baseConfig: { definition: unknown; season: unknown };
  config: Challenge;
}
interface Preview {
  effectiveDate: string;
  progressStartDate: string;
  publicationEnabled: boolean;
  counts: {
    population: number;
    qualifyingAsOf: number;
    currentlyAwarded: number;
    existingAwardsPreserved: number;
    wouldRevoke: number;
  };
}
suite('New method badge draft progress, never inherited from old rules', () => {
  let root: Pool,
    runtime: Pool,
    dispose: () => Promise<void>,
    login: string,
    principal: string,
    effective: string,
    later: string;
  const invoke = async <T extends pg.QueryResultRow>(sql: string, values: unknown[] = []) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: principal },
      (c) => c.query<T>(sql, values)
    );
  const config = (extra: Partial<Challenge> = {}): Challenge => ({
    nameZhTw: '回春功30天',
    nameZhCn: '',
    nameEn: 'Huichun 30 days',
    description: 'Synthetic new rule',
    effectiveDate: effective,
    threshold: 30,
    continuous: false,
    methodCodes: ['huichun_chu', 'huichun_zhong'],
    methodMatch: 'any',
    startMode: 'effective',
    startDate: null,
    ...extra
  });
  const save = async (
    c = config(),
    id: string | null = null,
    code: string | null = null,
    revision = 0
  ) =>
    (
      await invoke<{ data: Draft }>(
        "SELECT admin.save_achievement_config_draft($1,$2,'challenge',$3,NULL,$4,'Synthetic new badge') data",
        [id, revision, code, JSON.stringify(c)]
      )
    ).rows[0]!.data;
  const preview = async (c = config()) => {
    const d = await save(c);
    return (
      await invoke<{ data: Preview }>(
        'SELECT admin.compute_achievement_config_preview($1,1) data',
        [d.id]
      )
    ).rows[0]!.data;
  };
  const snapshot = async () =>
    (
      await root.query<{ h: string }>(
        'SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(d) ORDER BY code) FROM core.practice_badge_definitions d),(SELECT jsonb_agg(to_jsonb(b) ORDER BY person_id,badge_code,period,rule_version) FROM core.person_practice_badges b),(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM core.checkins c),(SELECT jsonb_agg(to_jsonb(s) ORDER BY checkin_id,practice_method_id) FROM core.checkin_method_selections s),(SELECT jsonb_agg(to_jsonb(j) ORDER BY person_id) FROM ops.practice_badge_jobs j))::text) h'
      )
    ).rows[0]!.h;
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    await runMigrations(root, dir, 'method-challenge-test');
    login = 'method_challenge_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime TO ${login}`);
    const url = new URL(db.databaseUrl);
    url.username = login;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    principal = (
      await root.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://challenge.example.invalid','super','Synthetic challenge manager') RETURNING id"
      )
    ).rows[0]!.id;
    await root.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic challenge' FROM admin.roles WHERE code='super_admin'",
      [principal]
    );
    const dates = (
      await root.query<{ effective: string; later: string }>(
        "SELECT ((clock_timestamp() AT TIME ZONE 'UTC')::date-40)::text effective,((clock_timestamp() AT TIME ZONE 'UTC')::date-39)::text later"
      )
    ).rows[0]!;
    effective = dates.effective;
    later = dates.later;
    const region = (
      await root.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('challenge-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'challenge-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'challenge-region','operational','區域','Region' FROM c RETURNING id"
      )
    ).rows[0]!.id;
    for (let n = 0; n < 2; n++) {
      const p = (
          await root.query<{ id: string }>(
            "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic Huichun learner','UTC') RETURNING id"
          )
        ).rows[0]!.id,
        i = (
          await root.query<{ id: string }>(
            "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at) VALUES($1,'telegram',$2,clock_timestamp()-INTERVAL '1 day') RETURNING id",
            [p, '9876543000' + n]
          )
        ).rows[0]!.id,
        a = (
          await root.query<{ id: string }>(
            "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-100) RETURNING id",
            [p, region]
          )
        ).rows[0]!.id;
      await root.query(
        "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,valid_from) VALUES($1,$2,'onboarding',clock_timestamp()-INTERVAL '1 day')",
        [p, i]
      );
      for (const offset of [
        -10,
        -9,
        -8,
        -7,
        -6,
        ...Array.from({ length: 30 }, (_, k) => (n === 1 && k === 29 ? 30 : k))
      ]) {
        const checkin = (
          await root.query<{ id: string }>(
            "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) VALUES($1,$2,$3::date+$4::integer,'UTC','regular',$5) RETURNING id",
            [p, i, effective, offset, a]
          )
        ).rows[0]!.id;
        await root.query(
          'INSERT INTO core.checkin_method_selections(checkin_id,practice_method_id) SELECT $1,id FROM core.practice_methods WHERE code=$2',
          [checkin, offset % 2 === 0 ? 'huichun_chu' : 'huichun_zhong']
        );
        if (n === 0 && offset === 0)
          await root.query(
            "INSERT INTO core.checkin_method_selections(checkin_id,practice_method_id) SELECT $1,id FROM core.practice_methods WHERE code='huichun_zhong'",
            [checkin]
          );
      }
      if (n === 0)
        await root.query(
          "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'method_huichun_30','lifetime',1)",
          [p]
        );
    }
  });
  beforeEach(async () => {
    await root.query(
      'DELETE FROM admin.achievement_config_previews;DELETE FROM admin.achievement_config_drafts'
    );
  });
  afterAll(async () => {
    await runtime?.end();
    if (login) {
      await root.query(`DROP OWNED BY ${login}`);
      await root.query(`DROP ROLE ${login}`);
    }
    await dispose?.();
  });
  it('creates independent server-generated badge identities without adding or overwriting published definitions', async () => {
    const before = await snapshot(),
      one = await save(),
      two = await save();
    expect(one.code).toMatch(/^challenge_[a-f0-9]{32}$/);
    expect(two.code).not.toBe(one.code);
    expect(one.baseConfig).toEqual({ definition: null, season: null });
    expect(
      (await root.query('SELECT code FROM core.practice_badge_definitions')).rows
    ).toHaveLength(49);
    expect(await snapshot()).toBe(before);
  });
  it('counts 30 cumulative valid dates without requiring consecutive days or inheriting the old badge', async () => {
    const before = await snapshot(),
      p = await preview();
    expect(p.counts).toMatchObject({
      population: 2,
      qualifyingAsOf: 2,
      currentlyAwarded: 0,
      existingAwardsPreserved: 0,
      wouldRevoke: 0
    });
    expect(p.progressStartDate).toBe(effective);
    expect(p.publicationEnabled).toBe(false);
    expect(await snapshot()).toBe(before);
  });
  it('requires 30 consecutive valid calendar dates only when continuous is checked', async () => {
    const p = await preview(config({ continuous: true, nameZhTw: '回春功連續30天' }));
    expect(p.counts.qualifyingAsOf).toBe(1);
  });
  it('never carries earlier history, earlier streaks, or two selected methods on one date into a new rule', async () => {
    expect((await preview(config({ threshold: 31 }))).counts.qualifyingAsOf).toBe(0);
    expect((await preview(config({ threshold: 31, continuous: true }))).counts.qualifyingAsOf).toBe(
      0
    );
  });
  it('accepts a later explicit start date but rejects a date before the new rule effective day', async () => {
    const p = await preview(config({ startMode: 'date', startDate: later }));
    expect(p.effectiveDate).toBe(effective);
    expect(p.progressStartDate).toBe(later);
    expect(p.counts.qualifyingAsOf).toBe(0);
    await expect(
      save(config({ startMode: 'date', startDate: '2000-01-01' }))
    ).rejects.toMatchObject({ code: '22023' });
    await expect(
      save(config({ startMode: 'effective', startDate: effective }))
    ).rejects.toMatchObject({ code: '22023' });
  });
  it('supports one method, OR sets and same-day AND combinations with distinct-day counting', async () => {
    expect(
      (await preview(config({ methodCodes: ['huichun_chu'], threshold: 15 }))).counts.qualifyingAsOf
    ).toBe(2);
    expect(
      (await preview(config({ methodMatch: 'all', threshold: 1 }))).counts.qualifyingAsOf
    ).toBe(1);
    expect((await preview(config({ methodMatch: 'all' }))).counts.qualifyingAsOf).toBe(0);
  });
  it('rejects forged identities, empty/parent method selections and invalid mode values', async () => {
    await expect(save(config(), null, 'method_huichun_30')).rejects.toMatchObject({
      code: '22023'
    });
    await expect(save(config({ methodCodes: [] }))).rejects.toMatchObject({ code: '22023' });
    await expect(save(config({ methodCodes: ['huichun'] }))).rejects.toMatchObject({
      code: '22023'
    });
    await expect(
      invoke(
        "SELECT admin.save_achievement_config_draft(NULL,0,'challenge',NULL,NULL,$1,'Synthetic invalid')",
        [JSON.stringify({ ...config(), continuous: 'true' })]
      )
    ).rejects.toMatchObject({ code: '22023' });
  });
  it('preserves the generated code and source snapshot across draft revisions', async () => {
    const d = await save(),
      updated = await save(config({ continuous: true }), d.id, d.code, 1);
    expect(updated.code).toBe(d.code);
    expect(updated.revision).toBe(2);
    expect(updated.config.continuous).toBe(true);
    await expect(save(config(), d.id, 'challenge_' + 'a'.repeat(32), 2)).rejects.toMatchObject({
      code: '40001'
    });
  });
});
