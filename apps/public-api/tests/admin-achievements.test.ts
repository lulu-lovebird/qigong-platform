import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
import { adminContentSecurityPolicy } from '../src/admin-branding.js';
import {
  achievementCatalogSchema,
  achievementRecipientsSchema,
  achievementQuerySchema
} from '../src/admin-achievements.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const migrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);
suite('Authenticated read-only achievement HTTP boundaries', () => {
  let root: Pool, runtime: Pool, dispose: () => Promise<void>, login: string;
  let regionA: string, regionB: string, alice: string;
  const users = new Map<string, { principal: string; cookie: string }>();
  const factory = () =>
    buildApp({
      pool: runtime,
      logger: false,
      adminAuth: {
        callbackUrl: 'https://achievements.example.invalid/admin/auth/callback',
        begin: async () => new URL('https://achievements.example.invalid/authorize'),
        complete: async () => ({ iss: 'https://achievements.example.invalid', sub: 'global' })
      }
    });
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    await runMigrations(root, migrations, 'achievements-http');
    login = 'achievement_http_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime TO ${login}`);
    const url = new URL(db.databaseUrl);
    url.username = login;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    const global = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('http-ach-global','global','全球','Global') RETURNING id"
      )
    ).rows[0]!.id;
    const country = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'http-ach-country','country','國家','Country') RETURNING id",
        [global]
      )
    ).rows[0]!.id;
    const regions = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'http-ach-a','operational','甲區','A'),($1,'http-ach-b','operational','乙區','B') RETURNING id",
        [country]
      )
    ).rows;
    regionA = regions[0]!.id;
    regionB = regions[1]!.id;
    for (const [index, region] of [regionA, regionB].entries()) {
      const person = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name) VALUES('測試學員<img src=x>😀') RETURNING id"
        )
      ).rows[0]!.id;
      if (index === 0) alice = person;
      const identity = (
        await root.query<{ id: string }>(
          'INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,$2,$3) RETURNING id',
          [person, index === 0 ? 'telegram' : 'line', randomUUID()]
        )
      ).rows[0]!.id;
      await root.query(
        "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,valid_from) VALUES($1,$2,'onboarding',clock_timestamp()-INTERVAL '1 day')",
        [person, identity]
      );
      await root.query(
        "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-30)",
        [person, region]
      );
      await root.query(
        "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',1)",
        [person]
      );
    }
    for (const [name, role, scope, region] of [
      ['global', 'global_viewer', 'global', null],
      ['regional', 'regional_admin', 'region', regionA],
      ['content', 'content_admin', 'content', null],
      ['revocable', 'regional_viewer', 'region', regionA]
    ] as const) {
      const principal = (
        await root.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://achievements.example.invalid',$1,$1) RETURNING id",
          [name]
        )
      ).rows[0]!.id;
      await root.query(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,valid_from,reason) SELECT $1,id,$3,$4,clock_timestamp()-INTERVAL '1 day','Synthetic HTTP fixture' FROM admin.roles WHERE code=$2",
        [principal, role, scope, region]
      );
      const token = randomBytes(32).toString('base64url');
      await withRequestContext(
        runtime,
        'qigong_api_runtime',
        { requestId: randomUUID() },
        (client) =>
          client.query(
            "SELECT admin.create_session($1,'https://achievements.example.invalid',$2)",
            [token, name]
          )
      );
      users.set(name, { principal, cookie: '__Host-qigong-admin=' + token });
    }
  });
  afterAll(async () => {
    await runtime?.end();
    if (login) {
      await root.query(`DROP OWNED BY ${login}`);
      await root.query(`DROP ROLE ${login}`);
    }
    await dispose?.();
  });
  const headers = (name = 'regional') => ({ cookie: users.get(name)!.cookie });
  it('separates guests, content-only roles and authorized reporting sessions', async () => {
    const app = factory();
    try {
      expect((await app.inject('/admin/achievements')).statusCode).toBe(302);
      for (const route of [
        '/admin/api/achievements',
        '/admin/api/achievements/capabilities',
        '/admin/api/achievements/streak_3/recipients'
      ])
        expect((await app.inject(route)).statusCode).toBe(401);
      expect(
        (await app.inject({ url: '/admin/achievements', headers: headers('content') })).statusCode
      ).toBe(403);
      expect(
        (await app.inject({ url: '/admin/api/achievements', headers: headers('content') }))
          .statusCode
      ).toBe(403);
      expect(
        (
          await app.inject({
            url: '/admin/api/achievements/capabilities',
            headers: headers('content')
          })
        ).json()
      ).toEqual({ canReadAchievements: false, canExportAchievements: false });
      expect(
        (
          await app.inject({ url: '/admin/api/achievements/capabilities', headers: headers() })
        ).json()
      ).toEqual({ canReadAchievements: true, canExportAchievements: false });
    } finally {
      await app.close();
    }
  });
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'returns strict %s DTOs and an isolated branded page without translating learner names',
    async (lang) => {
      const app = factory();
      try {
        const page = await app.inject({
          url: '/admin/achievements?lang=' + lang,
          headers: headers()
        });
        expect(page.statusCode).toBe(200);
        expect(page.headers['cache-control']).toBe('no-store');
        expect(page.headers['content-security-policy']).toBe(adminContentSecurityPolicy);
        expect(page.body).toContain('id="achievements-filters"');
        expect(page.body).not.toContain('測試學員');
        const catalog = await app.inject({
          url: '/admin/api/achievements?lang=' + lang,
          headers: headers()
        });
        expect(catalog.statusCode, catalog.body).toBe(200);
        const data = achievementCatalogSchema.parse(catalog.json());
        expect(data.badges).toHaveLength(49);
        expect(data.badges.find((b) => b.code === 'streak_3')?.name).toBe(
          lang === 'en'
            ? '3-day practice streak'
            : lang === 'zh_CN'
              ? '连续练功 3 天'
              : '連續練功 3 天'
        );
        expect(data.badges.find((b) => b.code === 'streak_3')?.recipientCount).toBe(1);
        const response = await app.inject({
          url: '/admin/api/achievements/streak_3/recipients?lang=' + lang,
          headers: headers()
        });
        expect(response.statusCode, response.body).toBe(200);
        const recipients = achievementRecipientsSchema.parse(response.json());
        expect(recipients.total).toBe(1);
        expect(recipients.rows[0]?.personId).toBe(alice);
        expect(recipients.rows[0]?.displayName).toBe('測試學員<img src=x>😀');
        expect(response.body).not.toContain('external_subject_id');
      } finally {
        await app.close();
      }
    }
  );
  it('applies identical scoped counts, pagination, primary-channel and literal name filters', async () => {
    const app = factory();
    try {
      const get = (route: string, actor = 'global') =>
        app.inject({ url: route, headers: headers(actor) });
      const list = achievementRecipientsSchema.parse(
        (await get('/admin/api/achievements/streak_3/recipients?limit=1')).json()
      );
      expect(list.total).toBe(2);
      expect(list.rows).toHaveLength(1);
      expect(list.totalPages).toBe(2);
      const second = achievementRecipientsSchema.parse(
        (await get('/admin/api/achievements/streak_3/recipients?limit=1&page=2')).json()
      );
      expect(list.rows[0]?.personId === second.rows[0]?.personId).toBe(false);
      const forbidden = await get('/admin/api/achievements?region=' + regionB, 'regional');
      expect(forbidden.statusCode).toBe(403);
      const channel = achievementCatalogSchema.parse(
        (await get('/admin/api/achievements?platform=line', 'regional')).json()
      );
      expect(channel.badges.every((b) => b.recipientCount === 0)).toBe(true);
      const literal = achievementRecipientsSchema.parse(
        (await get('/admin/api/achievements/streak_3/recipients?q=%25')).json()
      );
      expect(literal.total).toBe(0);
    } finally {
      await app.close();
    }
  });
  it('rejects malformed inputs and absent actions, and never recalculates unqualified stored awards', async () => {
    const snapshot = async () =>
      (
        await root.query<{ value: string }>(`SELECT md5(jsonb_build_array(
      (SELECT jsonb_agg(to_jsonb(b) ORDER BY person_id,badge_code,period,rule_version) FROM core.person_practice_badges b),
      (SELECT coalesce(jsonb_agg(to_jsonb(j) ORDER BY person_id),'[]') FROM ops.practice_badge_jobs j),(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM audit.events e),(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM audit.practice_badge_changes c))::text) value`)
      ).rows[0]!.value;
    const before = await snapshot(),
      app = factory();
    try {
      for (const suffix of [
        '?page=0',
        '?limit=101',
        '?year=0',
        '?year=2026x',
        '?platform=forged',
        '?unexpected=1',
        '?q=%00'
      ])
        expect(
          (await app.inject({ url: '/admin/api/achievements' + suffix, headers: headers() }))
            .statusCode
        ).toBe(400);
      expect(
        (
          await app.inject({
            url: '/admin/api/achievements/unknown/recipients',
            headers: headers()
          })
        ).statusCode
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/admin/api/achievements',
            headers: headers(),
            payload: {}
          })
        ).statusCode
      ).toBe(404);
      await app.inject({ url: '/admin/api/achievements', headers: headers() });
      await app.inject({ url: '/admin/api/achievements/streak_3/recipients', headers: headers() });
      expect(await snapshot()).toBe(before);
      expect((await root.query('SELECT id FROM core.checkins')).rows).toEqual([]);
    } finally {
      await app.close();
    }
  });
  it('invalidates revoked sessions immediately without modifying award history', async () => {
    const app = factory();
    try {
      expect(
        (await app.inject({ url: '/admin/api/achievements', headers: headers('revocable') }))
          .statusCode
      ).toBe(200);
      await root.query(
        'UPDATE admin.role_grants SET valid_to=clock_timestamp() WHERE principal_id=$1',
        [users.get('revocable')!.principal]
      );
      expect(
        (await app.inject({ url: '/admin/api/achievements', headers: headers('revocable') }))
          .statusCode
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
});
describe('Achievement filter validation', () => {
  it.each([
    { year: '2026x' },
    { page: 0 },
    { limit: 101 },
    { q: 'x'.repeat(101) },
    { q: '\0' },
    { platform: 'forged' },
    { region: 'not-a-uuid' },
    { personId: randomUUID() }
  ])('rejects invalid filter %j', (value) =>
    expect(achievementQuerySchema.safeParse(value).success).toBe(false)
  );
});
