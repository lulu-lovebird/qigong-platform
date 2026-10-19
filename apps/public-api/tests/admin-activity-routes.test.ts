import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Authenticated management drafts HTTP, no publication surface', () => {
  let root: Pool, runtime: Pool, dispose: () => Promise<void>, login: string;
  const users = new Map<string, { id: string; token: string; csrf: string; cookie: string }>();
  const api = '/admin/api/achievement-management';
  const factory = () =>
    buildApp({
      pool: runtime,
      logger: false,
      adminAuth: {
        callbackUrl: 'https://draft-http.example.invalid/admin/auth/callback',
        begin: async () => new URL('https://draft-http.example.invalid/authorize'),
        complete: async () => ({ iss: 'https://draft-http.example.invalid', sub: 'unused' })
      }
    });
  const headers = (actor = 'super') => ({
    cookie: users.get(actor)!.cookie,
    origin: 'https://checkin.baiyinqigong.org',
    'x-csrf-token': users.get(actor)!.csrf
  });
  const input = () => ({
    subject: 'rule',
    code: 'streak_3',
    year: null,
    config: {
      nameZhTw: '合成 <img src=x>',
      nameZhCn: '',
      nameEn: 'Synthetic HTTP draft',
      description: 'NO LIVE RULE CHANGE',
      effectiveDate: '2199-01-01',
      threshold: 5,
      methodCodes: []
    },
    reason: 'Synthetic internal draft',
    expectedRevision: 0
  });
  const business = async () =>
    (
      await root.query<{ h: string }>(
        'SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(d) ORDER BY code) FROM core.practice_badge_definitions d),(SELECT jsonb_agg(to_jsonb(s) ORDER BY kind,year) FROM core.practice_badge_seasons s),(SELECT jsonb_agg(to_jsonb(b) ORDER BY person_id,badge_code,period,rule_version) FROM core.person_practice_badges b),(SELECT jsonb_agg(to_jsonb(j) ORDER BY person_id) FROM ops.practice_badge_jobs j))::text) h'
      )
    ).rows[0]!.h;
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    await runMigrations(root, dir, 'management-http');
    login = 'draft_http_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime TO ${login}`);
    const url = new URL(db.databaseUrl);
    url.username = login;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    for (const [actor, role] of [
      ['super', 'super_admin'],
      ['master', 'master_admin'],
      ['viewer', 'global_viewer'],
      ['expiring', 'master_admin']
    ] as const) {
      const id = (
        await root.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://draft-http.example.invalid',$1,$1) RETURNING id",
          [actor]
        )
      ).rows[0]!.id;
      await root.query(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic HTTP draft' FROM admin.roles WHERE code=$2",
        [id, role]
      );
      const token = randomBytes(32).toString('base64url'),
        csrf = randomBytes(32).toString('base64url');
      await root.query(
        "INSERT INTO admin.sessions(token_hash,principal_id,expires_at) VALUES(public.digest($1,'sha256'),$2,clock_timestamp()+INTERVAL '1 hour')",
        [token, id]
      );
      users.set(actor, {
        id,
        token,
        csrf,
        cookie: '__Host-qigong-admin=' + token + '; __Host-qigong-admin-csrf=' + csrf
      });
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
  it('requires an actual session and independent management permission, with no publish, activate or recalculate endpoint', async () => {
    const app = factory();
    try {
      expect((await app.inject('/admin/achievement-management')).statusCode).toBe(302);
      for (const suffix of ['/catalog', '/drafts', '/capabilities'])
        expect((await app.inject(api + suffix)).statusCode).toBe(401);
      expect(
        (await app.inject({ method: 'POST', url: api + '/drafts', payload: input() })).statusCode
      ).toBe(401);
      const c = await app.inject({ url: api + '/capabilities', headers: headers('viewer') });
      expect(c.json()).toEqual({
        canManage: false,
        canPreview: false,
        canPublish: false,
        phase: 'draft_preview_only'
      });
      expect(
        (await app.inject({ url: api + '/catalog', headers: headers('viewer') })).statusCode
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: api + '/drafts',
            headers: headers('viewer'),
            payload: input()
          })
        ).statusCode
      ).toBe(403);
      for (const action of ['publish', 'activate', 'recalculate'])
        expect(
          (
            await app.inject({
              method: 'POST',
              url: api + '/' + action,
              headers: headers(),
              payload: {}
            })
          ).statusCode
        ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it('enforces exact Origin, CSRF, JSON strictness and initial revision without accepting a forged actor', async () => {
    const app = factory();
    try {
      for (const bad of [
        { ...headers(), origin: 'https://invalid.example.invalid' },
        { ...headers(), 'x-csrf-token': 'wrong' },
        { cookie: users.get('super')!.cookie, origin: 'https://checkin.baiyinqigong.org' }
      ])
        expect(
          (
            await app.inject({
              method: 'POST',
              url: api + '/drafts',
              headers: bad,
              payload: input()
            })
          ).statusCode
        ).toBe(403);
      for (const bad of [
        { ...input(), principalId: users.get('super')!.id },
        { ...input(), publish: true },
        { ...input(), expectedRevision: 1 },
        { ...input(), config: { ...input().config, sql: 'SELECT contacts' } }
      ])
        expect(
          (
            await app.inject({
              method: 'POST',
              url: api + '/drafts',
              headers: headers(),
              payload: bad
            })
          ).statusCode
        ).toBe(400);
      expect((await root.query('SELECT id FROM admin.achievement_config_drafts')).rows).toEqual([]);
    } finally {
      await app.close();
    }
  });
  it.each(['super', 'master'])(
    'allows %s to manage and preview drafts but cannot issue awards or enable publication',
    async (actor) => {
      const app = factory(),
        before = await business();
      try {
        const result = await app.inject({
          method: 'POST',
          url: api + '/drafts',
          headers: headers(actor),
          payload: input()
        });
        expect(result.statusCode, result.body).toBe(200);
        const d = result.json<{ id: string; revision: number }>();
        expect(d.revision).toBe(1);
        expect(result.headers['cache-control']).toBe('no-store');
        const preview = await app.inject({
          method: 'POST',
          url: api + '/drafts/' + d.id + '/preview',
          headers: headers(actor),
          payload: { expectedRevision: 1 }
        });
        expect(preview.statusCode, preview.body).toBe(200);
        expect(preview.json()).toMatchObject({
          publicationEnabled: false,
          counts: { population: 0, qualifyingAsOf: 0, wouldRevoke: 0 }
        });
        expect(preview.body).not.toContain('rows');
        expect(preview.body).not.toContain('phone');
        expect(preview.body).not.toContain('timezoneSnapshot');
        expect(
          (
            await app.inject({
              method: 'PATCH',
              url: api + '/drafts/' + d.id,
              headers: headers(actor),
              payload: { ...input(), expectedRevision: 99 }
            })
          ).statusCode
        ).toBe(409);
        const updated = await app.inject({
          method: 'PATCH',
          url: api + '/drafts/' + d.id,
          headers: headers(actor),
          payload: { ...input(), expectedRevision: 1, config: { ...input().config, threshold: 7 } }
        });
        expect(updated.statusCode, updated.body).toBe(200);
        expect(updated.json<{ revision: number }>().revision).toBe(2);
        expect(updated.json<{ latestPreview: unknown }>().latestPreview).toBeNull();
        const archived = await app.inject({
          method: 'POST',
          url: api + '/drafts/' + d.id + '/archive',
          headers: headers(actor),
          payload: { expectedRevision: 2, reason: 'Synthetic archive' }
        });
        expect(archived.statusCode).toBe(200);
        expect(archived.json()).toMatchObject({ state: 'archived', revision: 3 });
        expect(await business()).toBe(before);
        const audit = (
          await root.query<{ metadata: Record<string, unknown> }>(
            "SELECT metadata FROM audit.events WHERE action LIKE 'achievement.draft_%'"
          )
        ).rows;
        for (const row of audit)
          for (const key of [
            'config',
            'name',
            'description',
            'rows',
            'email',
            'phone',
            'methodCodes'
          ])
            expect(key in row.metadata).toBe(false);
      } finally {
        await app.close();
      }
    }
  );
  it.each(['super', 'master'])(
    'lets %s create an independent cumulative/consecutive method badge without changing published definitions',
    async (actor) => {
      const app = factory(),
        before = await business();
      try {
        const payload = {
          subject: 'challenge',
          code: null,
          year: null,
          config: {
            ...input().config,
            threshold: 30,
            methodCodes: ['huichun_chu', 'huichun_zhong'],
            continuous: false,
            methodMatch: 'any',
            startMode: 'effective',
            startDate: null
          },
          reason: 'Synthetic independent badge',
          expectedRevision: 0
        };
        const created = await app.inject({
          method: 'POST',
          url: api + '/drafts',
          headers: headers(actor),
          payload
        });
        expect(created.statusCode, created.body).toBe(200);
        const d = created.json<{ id: string; code: string; revision: number }>();
        expect(d.code).toMatch(/^challenge_[a-f0-9]{32}$/);
        expect(created.json()).toMatchObject({
          subject: 'challenge',
          baseConfig: { definition: null, season: null },
          config: { continuous: false, startMode: 'effective', startDate: null }
        });
        const changed = await app.inject({
          method: 'PATCH',
          url: api + '/drafts/' + d.id,
          headers: headers(actor),
          payload: {
            ...payload,
            code: d.code,
            expectedRevision: 1,
            config: { ...payload.config, continuous: true }
          }
        });
        expect(changed.statusCode, changed.body).toBe(200);
        const p = await app.inject({
          method: 'POST',
          url: api + '/drafts/' + d.id + '/preview',
          headers: headers(actor),
          payload: { expectedRevision: 2 }
        });
        expect(p.statusCode, p.body).toBe(200);
        expect(p.json()).toMatchObject({
          publicationEnabled: false,
          effectiveDate: '2199-01-01',
          progressStartDate: '2199-01-01',
          counts: { qualifyingAsOf: 0, currentlyAwarded: 0, wouldRevoke: 0 }
        });
        expect(await business()).toBe(before);
      } finally {
        await app.close();
      }
    }
  );
  it('rejects historical start modes, malformed checkbox types, missing methods and client-supplied new badge identifiers', async () => {
    const app = factory();
    try {
      const body = {
        subject: 'challenge',
        code: null,
        year: null,
        config: {
          ...input().config,
          threshold: 30,
          methodCodes: ['huichun_chu'],
          continuous: false,
          methodMatch: 'any',
          startMode: 'effective',
          startDate: null
        },
        reason: 'Synthetic invalid',
        expectedRevision: 0
      };
      for (const payload of [
        { ...body, code: 'method_huichun_30' },
        { ...body, code: 'challenge_' + 'a'.repeat(32) },
        { ...body, config: { ...body.config, continuous: 'true' } },
        { ...body, config: { ...body.config, startMode: 'all_history' } },
        { ...body, config: { ...body.config, startMode: 'date', startDate: '2000-01-01' } },
        { ...body, config: { ...body.config, methodCodes: [] } },
        { ...body, config: { ...body.config, methodCodes: ['huichun'] } }
      ])
        expect(
          (await app.inject({ method: 'POST', url: api + '/drafts', headers: headers(), payload }))
            .statusCode
        ).toBe(400);
    } finally {
      await app.close();
    }
  });
  it.each(['zh_TW', 'zh_CN', 'en'])(
    'serves the genuine management shell in %s with immutable live metadata and disabled publication',
    async (lang) => {
      const app = factory();
      try {
        const response = await app.inject({
          url: '/admin/achievement-management?lang=' + lang,
          headers: headers('master')
        });
        expect(response.statusCode).toBe(200);
        expect(response.body).toContain(
          '<html lang="' + (lang === 'en' ? 'en' : lang === 'zh_CN' ? 'zh-Hans' : 'zh-Hant') + '"'
        );
        expect(response.body).toContain('id="management-publish" type="button" disabled');
        expect(response.body).toContain('aria-controls="management-activities"');
        expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
        const catalog = await app.inject({
          url: api + '/catalog?lang=' + lang,
          headers: headers('master')
        });
        expect(catalog.statusCode, catalog.body).toBe(200);
        expect(catalog.json<{ definitions: unknown[] }>().definitions).toHaveLength(49);
        expect(catalog.json()).toMatchObject({ canPublish: false, phase: 'draft_preview_only' });
        expect(response.body).toContain(
          lang === 'zh_CN'
            ? '活动与成就管理'
            : lang === 'zh_TW'
              ? '活動與成就管理'
              : 'Activity and achievement management'
        );
      } finally {
        await app.close();
      }
    }
  );
  it('returns a bound aggregate deadline for a cross-year draft without creating a live calendar', async () => {
    const app = factory(),
      before = await business();
    try {
      const payload = {
        subject: 'activity',
        code: 'seasonal_winter',
        year: 2199,
        config: {
          nameZhTw: 'Synthetic activity',
          nameZhCn: '',
          nameEn: '',
          description: 'No official calendar date',
          effectiveDate: '2199-12-01',
          startDate: '2199-12-01',
          endDate: '2200-01-15',
          timezone: 'Asia/Taipei',
          requiredDays: 27
        },
        reason: 'Synthetic timezone test',
        expectedRevision: 0
      };
      const saved = await app.inject({
        method: 'POST',
        url: api + '/drafts',
        headers: headers(),
        payload
      });
      expect(saved.statusCode, saved.body).toBe(200);
      const id = saved.json<{ id: string }>().id,
        preview = await app.inject({
          method: 'POST',
          url: api + '/drafts/' + id + '/preview',
          headers: headers(),
          payload: { expectedRevision: 1 }
        });
      expect(preview.statusCode, preview.body).toBe(200);
      const p = preview.json<{
        deadline: { latestMakeupCutoff: string; settlementAt: string };
        awardableNow: number;
      }>();
      expect(Date.parse(p.deadline.settlementAt) - Date.parse(p.deadline.latestMakeupCutoff)).toBe(
        86400000
      );
      expect(p.awardableNow).toBe(0);
      expect(await business()).toBe(before);
    } finally {
      await app.close();
    }
  });
  it('rolls the save and its audit back if the actual session is revoked inside audit insertion before the final response check', async () => {
    await root.query(
      "CREATE FUNCTION audit.expire_synthetic_draft_session() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='achievement.draft_created' THEN UPDATE admin.sessions SET revoked_at=clock_timestamp() WHERE principal_id=NEW.actor_principal_id;END IF;RETURN NEW;END$$;CREATE TRIGGER expire_synthetic_draft_session BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.expire_synthetic_draft_session()"
    );
    const app = factory();
    try {
      const response = await app.inject({
        method: 'POST',
        url: api + '/drafts',
        headers: headers(),
        payload: input()
      });
      expect(response.statusCode).toBe(403);
      expect((await root.query('SELECT id FROM admin.achievement_config_drafts')).rows).toEqual([]);
      expect(
        (await root.query("SELECT id FROM audit.events WHERE action='achievement.draft_created'"))
          .rows
      ).toEqual([]);
      expect(
        (
          await root.query<{ revoked_at: null }>(
            "SELECT revoked_at FROM admin.sessions WHERE token_hash=public.digest($1,'sha256')",
            [users.get('super')!.token]
          )
        ).rows[0]?.revoked_at
      ).toBeNull();
    } finally {
      await app.close();
      await root.query(
        'DROP TRIGGER expire_synthetic_draft_session ON audit.events;DROP FUNCTION audit.expire_synthetic_draft_session()'
      );
    }
  });
  it('hides internal audit failures and returns no successful draft', async () => {
    await root.query(
      "CREATE FUNCTION audit.refuse_http_draft() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='achievement.draft_created' THEN RAISE EXCEPTION 'PRIVATE DATABASE DIAGNOSTIC';END IF;RETURN NEW;END$$;CREATE TRIGGER refuse_http_draft BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.refuse_http_draft()"
    );
    const app = factory();
    try {
      const response = await app.inject({
        method: 'POST',
        url: api + '/drafts',
        headers: headers(),
        payload: input()
      });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain('PRIVATE');
      expect((await root.query('SELECT id FROM admin.achievement_config_drafts')).rows).toEqual([]);
    } finally {
      await app.close();
      await root.query(
        'DROP TRIGGER refuse_http_draft ON audit.events;DROP FUNCTION audit.refuse_http_draft()'
      );
    }
  });
  it('rechecks natural session expiry after a lock wait before committing a new draft', async () => {
    const app = factory(),
      hold = await root.connect();
    await hold.query('BEGIN');
    await hold.query('SELECT pg_advisory_xact_lock(1919,1)');
    const pending = app.inject({
      method: 'POST',
      url: api + '/drafts',
      headers: headers('expiring'),
      payload: input()
    });
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
        "UPDATE admin.sessions SET expires_at=clock_timestamp()+INTERVAL '100 milliseconds' WHERE token_hash=public.digest($1,'sha256')",
        [users.get('expiring')!.token]
      );
      await delay(200);
    } finally {
      await hold.query('COMMIT');
      hold.release();
    }
    try {
      expect((await pending).statusCode).toBe(403);
      expect((await root.query('SELECT id FROM admin.achievement_config_drafts')).rows).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
