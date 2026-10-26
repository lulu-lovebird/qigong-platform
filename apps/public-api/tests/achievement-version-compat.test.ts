import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, it, expect } from 'vitest';
import { runMigrations } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp, checkStartupReadiness } from '../src/app.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Same candidate42to47 readiness and explicit version export boundaries', () => {
  it.each([42, 43, 44, 45, 46, 47])(
    'supports schema%d without enabling publication or silently ignoring version requests',
    async (schema) => {
      const database = await createIsolatedTestDatabase(base!),
        old = await mkdtemp(path.join(tmpdir(), 'compat' + schema + '-'));
      let runtime: pg.Pool | undefined, app: ReturnType<typeof buildApp> | undefined;
      const login = 'compat_' + randomUUID().replaceAll('-', '');
      try {
        for (const f of await readdir(dir)) {
          if (f.endsWith('.sql') && Number(f.slice(0, 4)) <= schema)
            await copyFile(path.join(dir, f), path.join(old, f));
        }
        await runMigrations(database.pool, old, 'compat-readers');
        const password = randomBytes(24).toString('hex');
        await database.pool.query(
          `CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`
        );
        await database.pool.query(`GRANT qigong_api_runtime TO ${login}`);
        const url = new URL(database.databaseUrl);
        url.username = login;
        url.password = password;
        runtime = new pg.Pool({ connectionString: url.href });
        const principal = (
          await database.pool.query<{ id: string }>(
            "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://compat.example.invalid','super','Synthetic compat') RETURNING id"
          )
        ).rows[0]!.id;
        await database.pool.query(
          "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic compat' FROM admin.roles WHERE code='super_admin'",
          [principal]
        );
        const token = randomBytes(32).toString('base64url'),
          csrf = randomBytes(32).toString('base64url');
        await database.pool.query(
          "INSERT INTO admin.sessions(token_hash,principal_id,expires_at) VALUES(public.digest($1,'sha256'),$2,clock_timestamp()+INTERVAL '1 hour')",
          [token, principal]
        );
        const headers = {
          cookie: '__Host-qigong-admin=' + token + '; __Host-qigong-admin-csrf=' + csrf,
          origin: 'https://checkin.baiyinqigong.org',
          'x-csrf-token': csrf
        };
        const region = (
          await database.pool.query<{ id: string }>(
            "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('compat-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'compat-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'compat-region','operational','區域','Region' FROM c RETURNING id"
          )
        ).rows[0]!.id;
        const person = (
          await database.pool.query<{ id: string }>(
            "INSERT INTO identity.people(preferred_name) VALUES('Synthetic compat learner') RETURNING id"
          )
        ).rows[0]!.id;
        const identity = (
          await database.pool.query<{ id: string }>(
            "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at) VALUES($1,'telegram','765432100',clock_timestamp()-INTERVAL '1 day') RETURNING id",
            [person]
          )
        ).rows[0]!.id;
        await database.pool.query(
          "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-30)",
          [person, region]
        );
        await database.pool.query(
          "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source,valid_from) VALUES($1,$2,'onboarding',clock_timestamp()-INTERVAL '1 day')",
          [person, identity]
        );
        await database.pool.query(
          "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',1),($1,'streak_3','lifetime',7)",
          [person]
        );
        app = buildApp({
          pool: runtime,
          logger: false,
          adminAuth: {
            callbackUrl: 'https://compat.example.invalid/admin/auth/callback',
            begin: async () => new URL('https://compat.example.invalid/authorize'),
            complete: async () => ({ iss: 'https://compat.example.invalid', sub: 'unused' })
          }
        });
        expect((await checkStartupReadiness(runtime)).ready).toBe(true);
        expect((await app.inject('/health/ready')).statusCode).toBe(200);
        expect(
          (await app.inject({ url: '/admin/api/channel-invites/capabilities', headers })).json()
        ).toEqual({ canManage: schema >= 47 });
        expect(
          (await database.pool.query('SELECT ops.achievement_event_streak_schema_ready() ready'))
            .rows[0]!.ready
        ).toBe(true);
        const immutableState = async () => {
          const tables = [
            'core.practice_badge_definitions',
            'core.person_practice_badges',
            'ops.practice_badge_jobs',
            'audit.events',
            'audit.practice_badge_changes',
            ...(schema >= 43 ? ['core.achievement_rule_versions'] : [])
          ];
          const state: unknown[] = [];
          for (const table of tables)
            state.push(
              (
                await database.pool.query(
                  `SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text) hash FROM ${table} r`
                )
              ).rows
            );
          return state;
        };
        const beforeNames = await immutableState();
        const catalog = await app.inject({ url: '/admin/api/achievements', headers });
        expect(catalog.statusCode).toBe(200);
        const badge = catalog.json().badges.find((b: { code: string }) => b.code === 'streak_3');
        expect(Array.isArray(badge.versions)).toBe(schema >= 43);
        expect(badge.name).toBe('連續練功 3 天');
        expect(badge.displayName).toBe(schema >= 43 ? '入門' : undefined);
        expect(
          catalog.json<{ badges: { displayName?: string }[] }>().badges.filter((b) => b.displayName)
        ).toHaveLength(schema >= 43 ? 49 : 0);
        if (schema >= 43) {
          expect(
            badge.versions.find((v: { ruleVersion: number }) => v.ruleVersion === 7).displayName
          ).toBeUndefined();
          const originalPreview = await app.inject({
            method: 'POST',
            url: '/admin/api/achievements/streak_3/export/preview',
            headers,
            payload: { version: 1 }
          });
          expect(originalPreview.statusCode).toBe(200);
          expect(originalPreview.json()).toMatchObject({ name: '連續練功 3 天', ruleVersion: 1 });
          expect(originalPreview.json()).not.toHaveProperty('displayName');
        }
        expect(await immutableState()).toEqual(beforeNames);
        const selected = await app.inject({
          url: '/admin/api/achievements/streak_3/recipients?version=7',
          headers
        });
        expect(selected.statusCode).toBe(schema >= 43 ? 200 : 400);
        if (schema >= 43)
          expect(selected.json()).toMatchObject({
            ruleVersion: 7,
            total: 1,
            configurationKnown: false
          });
        const preview = await app.inject({
          method: 'POST',
          url: '/admin/api/achievements/streak_3/export/preview',
          headers,
          payload: { version: 7 }
        });
        expect(preview.statusCode).toBe(schema >= 43 ? 200 : 400);
        if (schema >= 43) {
          expect(preview.json()).toMatchObject({ ruleVersion: 7, count: 1, name: 'streak_3 · v7' });
          const exported = await app.inject({
            method: 'POST',
            url: '/admin/api/achievements/streak_3/export',
            headers,
            payload: { version: 7, purpose: 'internal_review', confirmed: true }
          });
          expect(exported.statusCode).toBe(200);
          expect(exported.body).toContain('"streak_3","streak_3 · v7","7","lifetime"');
          expect(exported.body).not.toContain('"streak_3 · v7","1"');
          expect(exported.headers['content-disposition']).toContain('v7');
          expect(
            (
              await database.pool.query(
                "SELECT metadata->>'ruleVersion' version FROM audit.events WHERE action='achievement.export_prepared'"
              )
            ).rows
          ).toEqual([{ version: '7' }]);
        }
        for (const version of [true, false, null, '', 1.5, 0, -1, '7.0', ' 7'])
          expect(
            (
              await app.inject({
                method: 'POST',
                url: '/admin/api/achievements/streak_3/export/preview',
                headers,
                payload: { version }
              })
            ).statusCode
          ).toBe(400);
        const capabilities = await app.inject({
          url: '/admin/api/achievement-management/capabilities',
          headers
        });
        expect(capabilities.json().canPublish).toBe(false);
        expect(capabilities.json().canPreparePublication).toBe(schema >= 44);
        for (const name of ['publish', 'activate', 'recalculate'])
          expect(
            (
              await app.inject({
                method: 'POST',
                url: '/admin/api/achievement-management/' + name,
                headers,
                payload: {}
              })
            ).statusCode
          ).toBe(404);
      } finally {
        await app?.close();
        await runtime?.end();
        await database.pool.query(`DROP OWNED BY ${login}`);
        await database.pool.query(`DROP ROLE ${login}`);
        await database.dispose();
        await rm(old, { recursive: true, force: true });
      }
    }
  );
});
