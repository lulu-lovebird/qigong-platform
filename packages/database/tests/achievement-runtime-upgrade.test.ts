import { mkdtemp, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { runMigrations } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('C schema44 to46 preserves existing data with runtime OFF', () => {
  it('applies45/46 once without evaluating/backfilling awards or enabling any runtime control', async () => {
    const db = await createIsolatedTestDatabase(base!),
      old = await mkdtemp(path.join(tmpdir(), 'runtime44-'));
    try {
      for (const f of await readdir(dir))
        if (f.endsWith('.sql') && f < '0045_') await copyFile(path.join(dir, f), path.join(old, f));
      await runMigrations(db.pool, old, 'runtime-before44');
      const person = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name) VALUES('Synthetic preserved learner') RETURNING id"
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',1),($1,'streak_3','lifetime',999)",
        [person]
      );
      await db.pool.query('INSERT INTO ops.practice_badge_jobs(person_id) VALUES($1)', [person]);
      const tables = (
        await db.pool.query<{ name: string }>(
          "SELECT schemaname||'.'||tablename name FROM pg_tables WHERE schemaname IN('core','identity','admin','platform','audit','ops') ORDER BY 1"
        )
      ).rows;
      expect(tables).toHaveLength(81);
      const fingerprint = async (after: boolean) => {
        const result: Record<string, string> = {};
        for (const { name } of tables) {
          const projection =
              name === 'ops.practice_badge_jobs' && after
                ? "to_jsonb(r)-'dirty_generation'-'evaluated_generation'"
                : 'to_jsonb(r)',
            where =
              name === 'admin.permissions'
                ? "WHERE code<>'achievement.activate'"
                : name === 'admin.role_permissions'
                  ? "WHERE permission_id NOT IN(SELECT id FROM admin.permissions WHERE code='achievement.activate')"
                  : '';
          result[name] = (
            await db.pool.query<{ h: string }>(
              `SELECT md5(coalesce(jsonb_agg(${projection} ORDER BY (${projection})::text)::text,'')) h FROM ${name} r ${where}`
            )
          ).rows[0]!.h;
        }
        return result;
      };
      const before = await fingerprint(false),
        security = (
          await db.pool.query<{ s: unknown }>(
            "SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner::regrole::text,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname) s FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN('core','identity','admin','platform','audit','ops')"
          )
        ).rows[0]!.s;
      expect((await runMigrations(db.pool, dir, 'runtime-expand46')).applied).toEqual([
        '0045_versioned_achievement_runtime.sql',
        '0046_achievement_evaluation_and_readers.sql'
      ]);
      expect((await runMigrations(db.pool, dir, 'runtime-repeat46')).applied).toEqual([]);
      expect(await fingerprint(true)).toEqual(before);
      const names = tables.map((t) => t.name);
      expect(
        (
          await db.pool.query<{ s: unknown }>(
            "SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relowner::regrole::text,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname) s FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND (n.nspname||'.'||c.relname)=ANY($1)",
            [names]
          )
        ).rows[0]!.s
      ).toEqual(security);
      expect(
        (
          await db.pool.query(
            'SELECT enabled,ops.versioned_achievements_enabled() effective FROM ops.versioned_achievement_control'
          )
        ).rows
      ).toEqual([{ enabled: false, effective: false }]);
      expect(
        (await db.pool.query('SELECT count(*)::int n FROM core.achievement_runtime_versions'))
          .rows[0]!.n
      ).toBe(0);
      expect(
        (await db.pool.query('SELECT count(*)::int n FROM audit.achievement_transitions')).rows[0]!
          .n
      ).toBe(0);
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int n FROM core.achievement_badge_identities WHERE origin='legacy'"
          )
        ).rows[0]!.n
      ).toBe(49);
      expect(
        (
          await db.pool.query(
            "SELECT has_table_privilege('qigong_api_runtime','ops.versioned_achievement_control','UPDATE') api_control,has_function_privilege('qigong_worker_runtime','core._legacy_evaluate_practice_badges(uuid)','EXECUTE') worker_bypass"
          )
        ).rows[0]
      ).toEqual({ api_control: false, worker_bypass: false });
    } finally {
      await db.dispose();
      await rm(old, { recursive: true, force: true });
    }
  });
});
