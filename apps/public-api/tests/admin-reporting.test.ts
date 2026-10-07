import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { buildApp } from '../src/app.js';
import type { AdminAuthProvider } from '../src/admin-auth.js';
import { reportQuerySchema } from '../src/admin-reporting.js';
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const migrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);
const provider: AdminAuthProvider = {
  callbackUrl: 'https://test.example/admin/auth/callback',
  begin: async () => new URL('https://test.example/authorize'),
  complete: async () => ({ iss: 'https://test.example', sub: 'regional' })
};

describe('admin report input validation', () => {
  it.each([
    { date: '0000-01-01' },
    { date: '2025-02-29' },
    { date: '2026-02-30' },
    { page: '0' },
    { limit: '101' },
    { top: '11' },
    { period: 'all' },
    { region: 'not-uuid' },
    { personId: 'someone' },
    { q: 'a'.repeat(101) },
    { extra: 'ignored' }
  ])('rejects invalid parameters %j', (query) => {
    expect(reportQuerySchema.safeParse(query).success).toBe(false);
  });
});
describeDatabase('restricted administrator reports', () => {
  let pool: Pool;
  let runtime: Pool;
  let databaseName: string;
  let loginRole: string;
  let regionA: string;
  let regionB: string;
  let country: string;
  let cohort: string;
  let learner: string;
  let outsider: string;
  let recent: string;
  let today: string;
  let yesterday: string;
  const users = new Map<string, { principalId: string; cookie: string }>();
  const makePrincipal = async (name: string, role: string, scope: string, scopeId?: string) => {
    const id = (
      await pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://test.example',$1,$1) RETURNING id",
        [name]
      )
    ).rows[0]!.id;
    await pool.query(
      `INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,cohort_id,reason)
      SELECT $1,id,$3,CASE WHEN $3 IN ('region','country') THEN $4::uuid END,CASE WHEN $3='cohort' THEN $4::uuid END,'report tests' FROM admin.roles WHERE code=$2`,
      [id, role, scope, scopeId ?? null]
    );
    const token = randomBytes(32).toString('base64url');
    await withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (client) =>
      client.query("SELECT admin.create_session($1,'https://test.example',$2)", [token, name])
    );
    const user = { principalId: id, cookie: '__Host-qigong-admin=' + token };
    users.set(name, user);
    return user;
  };
  const makeLearner = async (
    name: string,
    region: string,
    platform: string,
    days: number[],
    newMember = false,
    suspended = false
  ) => {
    const person = (
      await pool.query<{ id: string }>(
        'INSERT INTO identity.people(legal_name,status) VALUES($1,$2) RETURNING id',
        [name, suspended ? 'suspended' : 'active']
      )
    ).rows[0]!.id;
    const identity = (
      await pool.query<{ id: string }>(
        'INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,display_name) VALUES($1,$2,$3,$4) RETURNING id',
        [person, platform, randomUUID(), name]
      )
    ).rows[0]!.id;
    const assignment = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CASE WHEN $4::boolean THEN CURRENT_DATE ELSE $3::date-100 END) RETURNING id",
        [person, region, today, newMember]
      )
    ).rows[0]!.id;
    for (const age of days) {
      const checkin = (
        await pool.query<{ id: string }>(
          "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) VALUES($1,$2,$3::date-$4::integer,'Asia/Taipei',$5,$6) RETURNING id",
          [person, identity, today, age, age === 1 ? 'makeup' : 'regular', assignment]
        )
      ).rows[0]!.id;
      const codes =
        age === 0 ? ['dayan_chu', 'dayan_gao'] : age === 3 ? ['dayan_gao'] : ['dayan_chu'];
      await pool.query(
        'INSERT INTO core.checkin_method_selections(checkin_id,practice_method_id) SELECT $1,id FROM core.practice_methods WHERE code=ANY($2::text[])',
        [checkin, codes]
      );
    }
    return person;
  };
  beforeAll(async () => {
    const source = new URL(databaseUrl!);
    if (!source.pathname.includes('test')) throw new Error('Expected test database');
    const maintenance = new pg.Client({ connectionString: databaseUrl });
    await maintenance.connect();
    databaseName = 'qigong_admin_report_test_' + randomUUID().replaceAll('-', '');
    await maintenance.query(`CREATE DATABASE ${databaseName}`);
    await maintenance.end();
    source.pathname = '/' + databaseName;
    pool = new pg.Pool({ connectionString: source.toString() });
    await runMigrations(pool, migrations, 'vitest');
    loginRole = 'qigong_reporting_' + randomUUID().replaceAll('-', '');
    const password = randomUUID();
    await pool.query(`CREATE ROLE ${loginRole} LOGIN PASSWORD '${password}' NOINHERIT NOBYPASSRLS`);
    await pool.query(`GRANT qigong_api_runtime TO ${loginRole}`);
    source.username = loginRole;
    source.password = password;
    runtime = new pg.Pool({ connectionString: source.toString() });
    const global = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('report-global','global','全球','Global') RETURNING id"
      )
    ).rows[0]!.id;
    country = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'report-country','country','國家','Country') RETURNING id",
        [global]
      )
    ).rows[0]!.id;
    const secondCountry = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'report-country-2','country','其他國家','Other Country') RETURNING id",
        [global]
      )
    ).rows[0]!.id;
    const regions = await pool.query<{ id: string }>(
      "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'report-a','operational','甲區','A'),($1,'report-b','operational','乙區','B'),($2,'report-c','operational','丙區','C') RETURNING id",
      [country, secondCountry]
    );
    regionA = regions.rows[0]!.id;
    regionB = regions.rows[1]!.id;
    cohort = (
      await pool.query<{ id: string }>(
        "INSERT INTO core.cohorts(region_id,code,name) VALUES($1,'report-cohort','Test Class') RETURNING id",
        [regionA]
      )
    ).rows[0]!.id;
    const dates = (
      await pool.query<{ today: string; yesterday: string }>(
        "SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date::text AS today,((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date-2)::text AS yesterday"
      )
    ).rows[0]!;
    today = dates.today;
    yesterday = dates.yesterday;
    learner = await makeLearner('<img src=x onerror=alert(1)>', regionA, 'telegram', [0, 1, 3, 40]);
    await makeLearner('Under_score% Learner', regionA, 'line', []);
    recent = await makeLearner('Recent learner', regionA, 'whatsapp', [], true);
    outsider = await makeLearner('Outside learner', regionB, 'telegram', [0, 1, 2]);
    await makeLearner('Other country learner', regions.rows[2]!.id, 'line', [0]);
    await makeLearner('Suspended learner', regionA, 'line', [1], false, true);
    await pool.query(
      'INSERT INTO core.cohort_memberships(cohort_id,person_id,valid_from) VALUES($1,$2,CURRENT_DATE-100)',
      [cohort, learner]
    );
    await makePrincipal('regional', 'regional_admin', 'region', regionA);
    await makePrincipal('country', 'country_admin', 'country', country);
    await makePrincipal('global', 'global_viewer', 'global');
    await makePrincipal('coach', 'coach', 'cohort', cohort);
    await makePrincipal('content', 'content_admin', 'content');
    await makePrincipal('expires', 'regional_viewer', 'region', regionA);
    await makePrincipal('suspend', 'regional_viewer', 'region', regionA);
    await pool.query(
      "INSERT INTO admin.roles(code,description) VALUES('reports_stats_only','Stats only test')"
    );
    await pool.query(
      "INSERT INTO admin.role_permissions(role_id,permission_id) SELECT role.id,permission.id FROM admin.roles role CROSS JOIN admin.permissions permission WHERE role.code='reports_stats_only' AND permission.code='stats.read'"
    );
    await makePrincipal('stats-only', 'reports_stats_only', 'region', regionA);
  });
  afterAll(async () => {
    if (runtime) await runtime.end();
    if (pool) {
      if (loginRole) {
        await pool.query(`DROP OWNED BY ${loginRole}`);
        await pool.query(`DROP ROLE ${loginRole}`);
      }
      await pool.end();
    }
    if (databaseName) {
      const maintenance = new pg.Client({ connectionString: databaseUrl });
      await maintenance.connect();
      await maintenance.query(`DROP DATABASE ${databaseName}`);
      await maintenance.end();
    }
  });
  const appFactory = () => buildApp({ pool: runtime, logger: false, adminAuth: provider });
  const cookie = (name = 'regional') => ({ cookie: users.get(name)!.cookie });
  it('requires authenticated reporting permissions and separates review navigation', async () => {
    const app = appFactory();
    try {
      for (const view of ['overview', 'status', 'leaderboard', 'methods', 'search', 'person']) {
        expect(
          (await app.inject({ method: 'GET', url: '/admin/api/reports/' + view })).statusCode
        ).toBe(401);
      }
      for (const page of [
        '/admin/',
        '/admin/leaderboard',
        '/admin/method-analysis',
        '/admin/applications'
      ]) {
        expect((await app.inject({ method: 'GET', url: page })).statusCode).toBe(302);
        const response = await app.inject({ method: 'GET', url: page, headers: cookie() });
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
        expect(response.body).not.toContain('cdn.jsdelivr');
      }
      const review = await app.inject({
        method: 'GET',
        url: '/admin/applications',
        headers: cookie()
      });
      expect(review.body).toContain('batch-approve');
      for (const name of ['content', 'stats-only']) {
        expect(
          (await app.inject({ method: 'GET', url: '/admin/', headers: cookie(name) })).statusCode
        ).toBe(403);
        expect(
          (
            await app.inject({
              method: 'GET',
              url: '/admin/api/reports/overview',
              headers: cookie(name)
            })
          ).statusCode
        ).toBe(403);
      }
    } finally {
      await app.close();
    }
  });
  it('localizes region/method/parent/history names without changing learner names, counts, codes or scopes', async () => {
    const app = appFactory();
    try {
      const get = (view: string, language: string, extra = '') =>
        app.inject({
          method: 'GET',
          url: '/admin/api/reports/' + view + '?period=90d&lang=' + language + extra,
          headers: cookie()
        });
      const [zh, en] = await Promise.all([get('overview', 'zh_TW'), get('overview', 'en')]);
      expect(en.statusCode, en.body).toBe(200);
      expect(en.json().kpis).toEqual(zh.json().kpis);
      expect(en.json().trend).toEqual(zh.json().trend);
      expect(en.json().regions).toEqual([{ id: regionA, name: 'A' }]);
      const names = (
        await pool.query<{ code: string; name_en: string; parent_name: string }>(
          "SELECT method.code,method.name_en,parent.name_en AS parent_name FROM core.practice_methods method LEFT JOIN core.practice_methods parent ON parent.id=method.parent_id WHERE method.code IN ('dayan_chu','dayan_gao')"
        )
      ).rows;
      const summary = await get('methods', 'en');
      for (const row of summary.json<{
        methods: Array<{ code: string; name: string; parent_name: string }>;
      }>().methods) {
        const expected = names.find((name) => name.code === row.code)!;
        expect(row.name).toBe(expected.name_en);
        expect(row.parent_name).toBe(expected.parent_name);
      }
      const person = await get('person', 'en', '&personId=' + learner);
      expect(person.json().person.display_name).toBe('<img src=x onerror=alert(1)>');
      expect(person.json().person.region_name).toBe('A');
      expect(person.json().history.rows[0].methods).toEqual(
        names.sort((a, b) => a.code.localeCompare(b.code)).map((row) => row.name_en)
      );
      const foreign = await get('person', 'en', '&personId=' + outsider);
      expect(foreign.statusCode).toBe(404);
      const list = await get('search', 'en');
      expect(list.json().total).toBe(3);
      expect(
        list.json().rows.every((row: { region_name: string }) => row.region_name === 'A')
      ).toBe(true);
    } finally {
      await app.close();
    }
  });
  it('remembers an English page preference through mock OIDC login and across all admin pages', async () => {
    const app = appFactory();
    try {
      const guest = await app.inject({ method: 'GET', url: '/admin/?lang=en' });
      expect(guest.statusCode).toBe(302);
      const preference = guest.headers['set-cookie'];
      if (typeof preference !== 'string') throw new Error('Expected preference cookie');
      expect(preference).toContain('__Host-qigong-admin-locale=en');
      expect(preference).toContain('Secure');
      expect(preference).toContain('SameSite=Lax');
      expect(preference).not.toContain('HttpOnly');
      const saved = preference.split(';')[0]!;
      const login = await app.inject({
        method: 'GET',
        url: '/admin/auth/login',
        headers: { cookie: saved }
      });
      const stateCookie = login.headers['set-cookie'];
      if (typeof stateCookie !== 'string') throw new Error('Expected state cookie');
      const state = stateCookie.split(';')[0]!.split('=')[1]!;
      const callback = await app.inject({
        method: 'GET',
        url: '/admin/auth/callback?state=' + state + '&code=mock-code',
        headers: { cookie: saved + '; ' + stateCookie.split(';')[0] }
      });
      expect(callback.statusCode).toBe(302);
      const issued = callback.headers['set-cookie'];
      if (!Array.isArray(issued)) throw new Error('Expected session cookies');
      const values = [saved, ...issued.map((header) => header.split(';')[0]!)].join('; ');
      for (const path of [
        '/admin/',
        '/admin/leaderboard',
        '/admin/method-analysis',
        '/admin/applications'
      ]) {
        const response = await app.inject({
          method: 'GET',
          url: path,
          headers: { cookie: values }
        });
        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('<html lang="en">');
        expect(response.headers['cache-control']).toBe('no-store');
      }
      const explicit = await app.inject({
        method: 'GET',
        url: '/admin/?lang=zh_TW',
        headers: { cookie: values }
      });
      expect(explicit.body).toContain('<html lang="zh-Hant">');
      expect(explicit.headers['set-cookie']).toContain('__Host-qigong-admin-locale=zh_TW');
      const alias = await app.inject({
        method: 'GET',
        url: '/admin?lang=en&period=month',
        headers: { cookie: values }
      });
      expect(alias.headers.location).toBe('/admin/?lang=en&period=month');
      const metadata = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/overview',
        headers: { cookie: values }
      });
      expect(metadata.json().regions).toEqual([{ id: regionA, name: 'A' }]);
    } finally {
      await app.close();
    }
  });
  it('localizes pending-application metadata and permission-denied pages without translating personal details', async () => {
    const application = (
      await pool.query<{ id: string }>(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164) VALUES('telegram','localization-application','申請者甲',$1,'申請者甲','bilingual-application@example.com','+886912345600') RETURNING id",
        [regionA]
      )
    ).rows[0]!.id;
    const app = appFactory();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/api/applications?lang=en',
        headers: cookie()
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(
        response.json().applications.find((row: { id: string }) => row.id === application)
      ).toMatchObject({
        region_name: 'A',
        learner_name: '申請者甲',
        website_email: 'bilingual-application@example.com'
      });
      const denied = await app.inject({
        method: 'GET',
        url: '/admin/?lang=en',
        headers: cookie('content')
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.body).toContain('You do not have reporting permissions.');
      expect(denied.body).toContain('<html lang="en">');
    } finally {
      await app.close();
    }
  });
  it('rejects unsupported API languages and safely falls back on invalid page preferences', async () => {
    const app = appFactory();
    try {
      for (const language of ['__proto__', 'fr', 'name_en;DROP TABLE identity.people']) {
        for (const path of ['/admin/api/reports/methods', '/admin/api/applications']) {
          expect(
            (
              await app.inject({
                method: 'GET',
                url: path + '?lang=' + encodeURIComponent(language),
                headers: cookie()
              })
            ).statusCode
          ).toBe(400);
        }
      }
      const invalid = await app.inject({
        method: 'GET',
        url: '/admin/?lang=' + encodeURIComponent('<script>'),
        headers: { cookie: cookie().cookie + '; __Host-qigong-admin-locale=garbage' }
      });
      expect(invalid.body).toContain('<html lang="zh-Hant">');
      expect(invalid.body).not.toContain('<script><script>');
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/admin/api/reports/overview?lang=en',
            headers: cookie('stats-only')
          })
        ).statusCode
      ).toBe(403);
    } finally {
      await app.close();
    }
  });

  it('counts person-days once, zero-fills elapsed dates and filters origin platform/current region', async () => {
    const app = appFactory();
    try {
      const report = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/overview?period=90d',
        headers: cookie()
      });
      expect(report.statusCode, report.body).toBe(200);
      expect(report.json().kpis).toEqual({
        active_users: 1,
        total_checkins: 4,
        learners: 3,
        average_daily: 0
      });
      expect(report.json().trend).toHaveLength(90);
      expect(
        report.json().trend.reduce((sum: number, row: { count: number }) => sum + row.count, 0)
      ).toBe(4);
      expect(report.json().regions).toEqual([{ id: regionA, name: '甲區' }]);
      const line = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/overview?period=90d&platform=line',
        headers: cookie()
      });
      expect(line.json().kpis.total_checkins).toBe(0);
      expect(line.json().kpis.learners).toBe(1);
      const foreign = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/overview?region=' + regionB,
        headers: cookie()
      });
      expect(foreign.json().kpis.learners).toBe(0);
      const national = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/overview?period=90d',
        headers: cookie('country')
      });
      expect(national.json().kpis.total_checkins).toBe(7);
      const global = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/overview?period=90d',
        headers: cookie('global')
      });
      expect(global.json().kpis.total_checkins).toBe(8);
    } finally {
      await app.close();
    }
  });
  it.each(['week', 'month', 'quarter', 'year'])(
    'uses elapsed calendar dates for %s KPIs and trend',
    async (period) => {
      const app = appFactory();
      try {
        const response = await app.inject({
          method: 'GET',
          url: '/admin/api/reports/overview?period=' + period,
          headers: cookie()
        });
        expect(response.statusCode, response.body).toBe(200);
        const data = response.json<{
          range: { start: string; today: string };
          trend: Array<{ date: string; count: number }>;
          kpis: { total_checkins: number; average_daily: number };
        }>();
        const end = new Date(data.range.today + 'T00:00:00Z');
        const start = new Date(end);
        if (period === 'week') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
        else {
          start.setUTCDate(1);
          if (period === 'quarter') start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3);
          if (period === 'year') start.setUTCMonth(0);
        }
        const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
        expect(data.range.start).toBe(start.toISOString().slice(0, 10));
        expect(data.trend).toHaveLength(days);
        expect(data.trend.at(-1)?.date).toBe(data.range.today);
        expect(data.trend.reduce((sum, row) => sum + row.count, 0)).toBe(data.kpis.total_checkins);
        expect(data.kpis.average_daily).toBe(Number((data.kpis.total_checkins / days).toFixed(1)));
      } finally {
        await app.close();
      }
    }
  );

  it('paginates historical checked/pending rosters without including not-yet-enrolled learners', async () => {
    const app = appFactory();
    try {
      const checked = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/status?state=checked&date=' + today,
        headers: cookie()
      });
      expect(checked.statusCode, checked.body).toBe(200);
      expect(checked.json().total).toBe(1);
      expect(checked.json().rows[0].id).toBe(learner);
      const pending = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/status?state=pending&limit=1&date=' + today,
        headers: cookie()
      });
      expect(pending.json().total).toBe(2);
      expect(pending.json().totalPages).toBe(2);
      expect(pending.json().rows).toHaveLength(1);
      const historical = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/status?state=pending&date=' + yesterday,
        headers: cookie()
      });
      expect(historical.json().total).toBe(2);
      expect(historical.json().rows.map((row: { id: string }) => row.id)).not.toContain(recent);
      const beyond = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/status?page=999',
        headers: cookie()
      });
      expect(beyond.json().rows).toEqual([]);
      expect(beyond.json().total).toBe(1);
    } finally {
      await app.close();
    }
  });
  it('computes lifetime/current/period streaks independently and never counts selected methods as extra days', async () => {
    const app = appFactory();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/leaderboard?period=30d&limit=1',
        headers: cookie()
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().rows[0]).toMatchObject({
        id: learner,
        total_days: 4,
        period_days: 3,
        current_streak: 2,
        max_streak: 2,
        last_checkin: today
      });
      expect(response.json().total).toBe(3);
      expect(response.json().top).toHaveLength(1);
      expect(response.json().streaks[0].max_streak).toBe(2);
      const data = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/methods?period=30d',
        headers: cookie()
      });
      expect(data.statusCode, data.body).toBe(200);
      expect(data.json().methods.map((row: { days: number }) => row.days)).toEqual([2, 2]);
      expect(data.json().methods.map((row: { share: number }) => row.share)).toEqual([50, 50]);
    } finally {
      await app.close();
    }
  });
  it('searches literal wildcards, supports cohort scopes and hides foreign person existence/details', async () => {
    const app = appFactory();
    try {
      const search = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/search?q=' + encodeURIComponent('%'),
        headers: cookie()
      });
      expect(search.statusCode, search.body).toBe(200);
      expect(search.json().total).toBe(1);
      const cohortSearch = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/search',
        headers: cookie('coach')
      });
      expect(cohortSearch.json().total).toBe(1);
      expect(cohortSearch.json().rows[0]).toMatchObject({ id: learner, region_name: '甲區' });
      for (const id of [outsider, randomUUID()]) {
        const hidden = await app.inject({
          method: 'GET',
          url: '/admin/api/reports/person?personId=' + id,
          headers: cookie()
        });
        expect(hidden.statusCode, hidden.body).toBe(404);
        expect(hidden.json()).toEqual({ error: 'learner_not_found' });
      }
      const personal = await app.inject({
        method: 'GET',
        url: '/admin/api/reports/person?personId=' + learner + '&limit=2',
        headers: cookie()
      });
      expect(personal.statusCode, personal.body).toBe(200);
      expect(personal.json().analyses.map((row: { totalDays: number }) => row.totalDays)).toEqual([
        3, 4
      ]);
      expect(personal.json().history.total).toBe(4);
      expect(personal.json().history.rows).toHaveLength(2);
      expect(personal.json().history.rows[1].entry_kind).toBe('makeup');
      expect(personal.body).not.toContain('practice_note');
    } finally {
      await app.close();
    }
  });
  it('rejects forged dates/zones/IDs and preserves RLS even for direct restricted SQL or self context', async () => {
    const app = appFactory();
    try {
      for (const query of [
        'date=2099-01-01',
        'timezone=Definitely/Invalid',
        'personId=abc',
        'page=-1',
        'limit=1000',
        'top=500',
        'date=2026-02-30'
      ]) {
        expect(
          (
            await app.inject({
              method: 'GET',
              url: '/admin/api/reports/status?' + query,
              headers: cookie()
            })
          ).statusCode
        ).toBe(400);
      }
      const context = { requestId: randomUUID(), principalId: users.get('regional')!.principalId };
      const rows = await withRequestContext(runtime, 'qigong_api_runtime', context, (client) =>
        client.query<{ person_id: string }>('SELECT person_id FROM core.checkins')
      );
      expect(rows.rows).toHaveLength(5);
      expect(rows.rows.map((row) => row.person_id)).not.toContain(outsider);
      const foreignIds = (
        await pool.query<{ id: string }>('SELECT id FROM core.checkins WHERE person_id=$1', [
          outsider
        ])
      ).rows.map((row) => row.id);
      const foreignSelections = await withRequestContext(
        runtime,
        'qigong_api_runtime',
        context,
        (client) =>
          client.query(
            'SELECT * FROM core.checkin_method_selections WHERE checkin_id=ANY($1::uuid[])',
            [foreignIds]
          )
      );
      expect(foreignSelections.rows).toEqual([]);
      const self = await withRequestContext(
        runtime,
        'qigong_api_runtime',
        { requestId: randomUUID(), personId: learner },
        (client) => client.query('SELECT * FROM core.checkins')
      );
      expect(self.rows).toEqual([]);
      await expect(
        withRequestContext(runtime, 'qigong_api_runtime', context, (client) =>
          client.query('DELETE FROM core.checkins')
        )
      ).rejects.toThrow('permission denied');
      await pool.query(
        'UPDATE admin.role_grants SET valid_to=CURRENT_TIMESTAMP WHERE principal_id=$1',
        [users.get('expires')!.principalId]
      );
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/admin/api/reports/overview',
            headers: cookie('expires')
          })
        ).statusCode
      ).toBe(401);
      await pool.query("UPDATE admin.principals SET status='suspended' WHERE id=$1", [
        users.get('suspend')!.principalId
      ]);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/admin/api/reports/overview',
            headers: cookie('suspend')
          })
        ).statusCode
      ).toBe(401);
    } finally {
      await app.close();
    }
  });
});
