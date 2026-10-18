import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const migrations = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);
suite('Personal CSV HTTP boundary and transactional audit', () => {
  let root: Pool, runtime: Pool, dispose: () => Promise<void>, login: string, region: string;
  const users = new Map<string, { id: string; token: string; csrf: string; cookie: string }>();
  const factory = () =>
    buildApp({
      pool: runtime,
      logger: false,
      adminAuth: {
        callbackUrl: 'https://csv.example.invalid/admin/auth/callback',
        begin: async () => new URL('https://csv.example.invalid/authorize'),
        complete: async () => ({ iss: 'https://csv.example.invalid', sub: 'super' })
      }
    });
  const headers = (actor = 'super') => ({
    cookie: users.get(actor)!.cookie,
    origin: 'https://checkin.baiyinqigong.org',
    'x-csrf-token': users.get(actor)!.csrf
  });
  const route = '/admin/api/achievements/streak_3/export';
  const payload = { confirmed: true, purpose: 'award_contact', lang: 'zh_TW' };
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    await runMigrations(root, migrations, 'csv-http');
    login = 'csv_http_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime TO ${login}`);
    const url = new URL(db.databaseUrl);
    url.username = login;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    region = (
      await root.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('csv-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'csv-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'csv-region','operational','區域','Region' FROM c RETURNING id"
      )
    ).rows[0]!.id;
    for (const [name, role] of [
      ['super', 'super_admin'],
      ['master', 'master_admin'],
      ['viewer', 'global_viewer'],
      ['expiry', 'master_admin']
    ] as const) {
      const id = (
        await root.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://csv.example.invalid',$1,$1) RETURNING id",
          [name]
        )
      ).rows[0]!.id;
      await root.query(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic CSV fixture' FROM admin.roles WHERE code=$2",
        [id, role]
      );
      const token = randomBytes(32).toString('base64url'),
        csrf = randomBytes(32).toString('base64url');
      await withRequestContext(
        runtime,
        'qigong_api_runtime',
        { requestId: randomUUID() },
        (client) =>
          client.query("SELECT admin.create_session($1,'https://csv.example.invalid',$2)", [
            token,
            name
          ])
      );
      users.set(name, {
        id,
        token,
        csrf,
        cookie: '__Host-qigong-admin=' + token + '; __Host-qigong-admin-csrf=' + csrf
      });
    }
    for (let n = 0; n < 25; n++) {
      const p = (
        await root.query<{ id: string }>(
          'INSERT INTO identity.people(legal_name,preferred_name) VALUES($1,$2) RETURNING id',
          [n === 0 ? '=SYNTHETIC_FORMULA()' : 'Basic CSV ' + n, 'Basic CSV ' + n]
        )
      ).rows[0]!.id;
      const subject = (12345678901234567000n + BigInt(n)).toString();
      const i = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at) VALUES($1,'telegram',$2,clock_timestamp()-INTERVAL '1 day') RETURNING id",
          [p, subject]
        )
      ).rows[0]!.id;
      await root.query(
        "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,valid_from) VALUES($1,$2,'onboarding',clock_timestamp()-INTERVAL '1 day')",
        [p, i]
      );
      await root.query(
        "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-30)",
        [p, region]
      );
      if (n < 24)
        await root.query(
          "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_by_principal_id,decided_at) VALUES('telegram',$1,'BASIC','Registered CSV','csv'||$2::text||'@example.invalid','+659900000001',$3,'approved',$4,$5,clock_timestamp())",
          [subject, n, region, p, users.get('super')!.id]
        );
      await root.query(
        "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',1)",
        [p]
      );
    }
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
  const auditCount = async () =>
    (
      await root.query<{ n: number }>(
        "SELECT count(*)::int n FROM audit.events WHERE action='achievement.export_prepared'"
      )
    ).rows[0]!.n;
  it('requires a real session, exact Origin/CSRF and an explicit confirmation/purpose', async () => {
    const app = factory();
    try {
      expect((await app.inject({ method: 'POST', url: route, payload })).statusCode).toBe(401);
      for (const bad of [
        { ...headers(), origin: 'https://attacker.invalid' },
        { ...headers(), 'x-csrf-token': 'wrong' },
        { cookie: users.get('super')!.cookie, origin: 'https://checkin.baiyinqigong.org' }
      ])
        expect(
          (await app.inject({ method: 'POST', url: route, headers: bad, payload })).statusCode
        ).toBe(403);
      for (const bad of [
        { purpose: 'award_contact' },
        { ...payload, confirmed: false },
        { ...payload, purpose: 'broadcast' },
        { ...payload, page: 1 },
        { ...payload, token: 'untrusted' }
      ])
        expect(
          (await app.inject({ method: 'POST', url: route, headers: headers(), payload: bad }))
            .statusCode
        ).toBe(400);
      expect((await app.inject({ url: route, headers: headers() })).statusCode).toBe(404);
      expect(await auditCount()).toBe(0);
    } finally {
      await app.close();
    }
  });
  it('keeps read-only viewers away from preview and PII, while exposing only boolean capabilities', async () => {
    const app = factory();
    try {
      expect(
        (
          await app.inject({
            url: '/admin/api/achievements/capabilities',
            headers: headers('viewer')
          })
        ).json()
      ).toEqual({ canReadAchievements: true, canExportAchievements: false });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: route + '/preview',
            headers: headers('viewer'),
            payload: {}
          })
        ).statusCode
      ).toBe(403);
      expect(
        (await app.inject({ method: 'POST', url: route, headers: headers('viewer'), payload }))
          .statusCode
      ).toBe(403);
      const normal = await app.inject({
        url: '/admin/api/achievements/streak_3/recipients?page=2',
        headers: headers('viewer')
      });
      expect(normal.statusCode).toBe(200);
      expect(normal.json<{ rows: unknown[] }>().rows).toHaveLength(5);
      for (const forbidden of ['csv0@example.invalid', '+659900000001', '12345678901234567000'])
        expect(normal.body.includes(forbidden)).toBe(false);
      expect(await auditCount()).toBe(0);
    } finally {
      await app.close();
    }
  });
  it.each(['super', 'master'])(
    'downloads all25 authorized winners for %s, with safe CSV headers and one metadata-only audit',
    async (actor) => {
      const app = factory();
      try {
        const preview = await app.inject({
          method: 'POST',
          url: route + '/preview',
          headers: headers(actor),
          payload: { lang: 'zh_CN' }
        });
        expect(preview.statusCode, preview.body).toBe(200);
        expect(preview.json()).toMatchObject({ count: 25, overLimit: false, limit: 5000 });
        for (const key of ['rows', 'phone', 'email', 'telegramId'])
          expect(key in preview.json<Record<string, unknown>>()).toBe(false);
        expect(await auditCount()).toBe(0);
        const result = await app.inject({
          method: 'POST',
          url: route,
          headers: headers(actor),
          payload
        });
        expect(result.statusCode).toBe(200);
        expect(result.headers['content-type']).toContain('text/csv');
        expect(result.headers['content-disposition']).toContain('streak_3');
        expect(result.headers['content-disposition']).toContain("filename*=UTF-8''");
        expect(result.headers['cache-control']).toBe('no-store');
        expect(result.headers['x-content-type-options']).toBe('nosniff');
        expect([...result.rawPayload.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        expect(result.body).toContain('"\'12345678901234567000"');
        expect(result.body).toContain('"\'=SYNTHETIC_FORMULA()"');
        expect(result.body).toContain('csv23@example.invalid');
        expect(result.body).toContain('missing_current_application');
        expect(result.body.split('\r\n').filter(Boolean)).toHaveLength(26);
        expect(await auditCount()).toBe(1);
        const audit = (
          await root.query<{ data: unknown }>(
            "SELECT metadata data FROM audit.events WHERE action='achievement.export_prepared'"
          )
        ).rows[0]!.data;
        expect(audit).toMatchObject({
          rowCount: 25,
          delivery: 'prepared_not_confirmed_saved',
          queryApplied: false
        });
        const text = JSON.stringify(audit);
        for (const forbidden of ['csv0@example.invalid', '+659900000001', '12345678901234567000'])
          expect(text.includes(forbidden)).toBe(false);
        const second = await app.inject({
          method: 'POST',
          url: route,
          headers: headers(actor),
          payload
        });
        expect(second.statusCode).toBe(429);
        expect(second.headers['retry-after']).toBe('30');
        expect(await auditCount()).toBe(1);
      } finally {
        await app.close();
      }
    }
  );
  it('does not commit audit/cooldown or send CSV bytes if the final role/session check fails', async () => {
    await root.query(
      "CREATE FUNCTION audit.disable_csv_actor() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='achievement.export_prepared' AND NEW.reason='internal_review' THEN UPDATE admin.principals SET status='disabled' WHERE id=NEW.actor_principal_id;END IF;RETURN NEW;END$$;CREATE TRIGGER disable_csv_actor BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.disable_csv_actor()"
    );
    const app = factory();
    try {
      const result = await app.inject({
        method: 'POST',
        url: route,
        headers: headers('master'),
        payload: { ...payload, purpose: 'internal_review' }
      });
      expect(result.statusCode).toBe(403);
      expect(result.headers['content-disposition']).toBeUndefined();
      expect(result.body.includes('csv0@example.invalid')).toBe(false);
      expect(await auditCount()).toBe(0);
      expect((await root.query('SELECT * FROM admin.achievement_export_limits')).rows).toEqual([]);
      expect(
        (
          await root.query<{ status: string }>('SELECT status FROM admin.principals WHERE id=$1', [
            users.get('master')!.id
          ])
        ).rows[0]?.status
      ).toBe('active');
    } finally {
      await app.close();
      await root.query(
        'DROP TRIGGER disable_csv_actor ON audit.events;DROP FUNCTION audit.disable_csv_actor()'
      );
    }
  });
  it('fails closed when audit storage refuses an entry, without exposing internal diagnostics', async () => {
    await root.query(
      "CREATE FUNCTION audit.refuse_csv_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='achievement.export_prepared' THEN RAISE EXCEPTION 'PRIVATE AUDIT DIAGNOSTIC';END IF;RETURN NEW;END$$;CREATE TRIGGER refuse_csv_audit BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.refuse_csv_audit()"
    );
    const app = factory();
    try {
      const result = await app.inject({ method: 'POST', url: route, headers: headers(), payload });
      expect(result.statusCode).toBe(503);
      expect(result.body).not.toContain('PRIVATE');
      expect(result.headers['content-disposition']).toBeUndefined();
      expect(await auditCount()).toBe(0);
      expect((await root.query('SELECT * FROM admin.achievement_export_limits')).rows).toEqual([]);
    } finally {
      await app.close();
      await root.query(
        'DROP TRIGGER refuse_csv_audit ON audit.events;DROP FUNCTION audit.refuse_csv_audit()'
      );
    }
  });
  it('rechecks natural session expiry after a lock wait using wall time, not the old request transaction', async () => {
    const app = factory(),
      hold = await root.connect();
    await hold.query('BEGIN');
    await hold.query('SELECT pg_advisory_xact_lock(1919,1)');
    const pending = app.inject({ method: 'POST', url: route, headers: headers('expiry'), payload });
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
        "UPDATE admin.sessions SET expires_at=clock_timestamp()+INTERVAL '100 milliseconds' WHERE token_hash=public.digest($1,'sha256')",
        [users.get('expiry')!.token]
      );
      await delay(200);
    } finally {
      await hold.query('COMMIT');
      hold.release();
    }
    try {
      const result = await pending;
      expect(result.statusCode).toBe(403);
      expect(result.headers['content-disposition']).toBeUndefined();
      expect(await auditCount()).toBe(0);
      expect((await root.query('SELECT * FROM admin.achievement_export_limits')).rows).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
