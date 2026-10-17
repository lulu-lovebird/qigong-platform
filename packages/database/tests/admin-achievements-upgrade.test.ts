import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getMigrationStatus, runMigrations } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Admin achievements schema37 to38 read-only expansion', () => {
  it('preserves all tables, stored award versions, private history, jobs and security metadata', async () => {
    const database = await createIsolatedTestDatabase(base!);
    const old = await mkdtemp(path.join(tmpdir(), 'achievements37-'));
    try {
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0038_')
          await copyFile(path.join(directory, file), path.join(old, file));
      await runMigrations(database.pool, old, 'achievements-before');
      expect(
        (
          await getMigrationStatus(
            database.pool,
            '0038_admin_achievements.sql',
            '0038_admin_achievements.sql'
          )
        ).ready
      ).toBe(false);
      const record = (
        await database.pool.query<{ person: string; identity: string; checkin: string }>(
          `WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('upgrade-global','global','全球','Global') RETURNING id),
        k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'upgrade-country','country','國家','Country' FROM g RETURNING id),
        r AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'upgrade-region','operational','地區','Region' FROM k RETURNING id),
        p AS(INSERT INTO identity.people(preferred_name) VALUES('Synthetic private learner') RETURNING id),
        i AS(INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) SELECT id,'line','U11111111111111111111111111111111' FROM p RETURNING id,person_id),
        a AS(INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) SELECT p.id,r.id,'primary',CURRENT_DATE-1 FROM p,r RETURNING id),
        c AS(INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) SELECT i.person_id,i.id,CURRENT_DATE,'UTC','regular',a.id FROM i,a RETURNING id,person_id,submitted_via_identity_id)
        SELECT person_id person,submitted_via_identity_id identity,id checkin FROM c`
        )
      ).rows[0]!;
      await database.pool.query(
        "INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) VALUES($1,$2,'PRIVATE NEVER SHARE')",
        [record.checkin, record.person]
      );
      await database.pool.query(
        "INSERT INTO platform.line_verified_profiles(identity_id,display_name) VALUES($1,'Preserved provider nickname')",
        [record.identity]
      );
      await database.pool.query(
        "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',1),($1,'seasonal_summer','2025',2)",
        [record.person]
      );
      await database.pool.query(
        "INSERT INTO audit.practice_badge_changes(person_id,badge_code,period,rule_version,action) VALUES($1,'streak_3','lifetime',1,'earned')",
        [record.person]
      );
      await database.pool.query(
        "UPDATE ops.practice_badge_jobs SET evaluated_at=clock_timestamp()-INTERVAL '1 day',due_at=clock_timestamp()+INTERVAL '1 day' WHERE person_id=$1",
        [record.person]
      );
      const tables = (
        await database.pool.query<{ schema: string; name: string }>(
          "SELECT schemaname schema,tablename name FROM pg_tables WHERE schemaname IN('identity','core','platform','admin','audit','ops') ORDER BY 1,2"
        )
      ).rows;
      const fingerprint = async () =>
        Promise.all(
          tables.map(async (table) => {
            const name = table.schema + '.' + table.name;
            const projection =
              name === 'core.platform_metadata'
                ? "to_jsonb(r)-'architecture_version'-'updated_at'"
                : 'to_jsonb(r)';
            return (
              await database.pool.query<{ hash: string }>(
                `SELECT md5(coalesce(jsonb_agg(${projection} ORDER BY (${projection})::text)::text,'')) hash FROM ${name} r`
              )
            ).rows[0]!.hash;
          })
        );
      const security = async () =>
        (
          await database.pool.query<{ data: unknown }>(`SELECT jsonb_build_object(
        'tables',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner::regrole::text,c.relacl::text) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN('identity','core','platform','admin','audit','ops')),
        'functions',(SELECT jsonb_object_agg(p.oid::regprocedure::text,jsonb_build_array(p.proowner::regrole::text,p.proacl::text,p.prosecdef,p.proconfig,p.provolatile)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('core','platform','admin','ops') AND p.proname NOT IN('_achievement_people','achievement_catalog','achievement_recipients','admin_achievements_schema_ready'))
      ) data`)
        ).rows[0]!.data;
      const before = await fingerprint(),
        beforeSecurity = await security();
      const source = (
        await database.pool.query<{ source: unknown }>(
          'SELECT platform.journal_source($1) source',
          [record.checkin]
        )
      ).rows[0]!.source;
      expect((await runMigrations(database.pool, directory, 'achievements-after')).applied).toEqual(
        ['0038_admin_achievements.sql']
      );
      expect(
        (await runMigrations(database.pool, directory, 'achievements-repeat')).applied
      ).toEqual([]);
      expect(await fingerprint()).toEqual(before);
      expect(await security()).toEqual(beforeSecurity);
      expect(
        (await database.pool.query('SELECT platform.journal_source($1) source', [record.checkin]))
          .rows[0]?.source
      ).toEqual(source);
      expect(
        (
          await database.pool.query(
            'SELECT ops.admin_achievements_schema_ready() current,ops.learner_author_names_schema_ready() previous'
          )
        ).rows[0]
      ).toEqual({ current: true, previous: false });
      expect(
        (
          await getMigrationStatus(
            database.pool,
            '0038_admin_achievements.sql',
            '0038_admin_achievements.sql'
          )
        ).ready
      ).toBe(true);
      expect(
        (
          await getMigrationStatus(
            database.pool,
            '0037_learner_author_names.sql',
            '0037_learner_author_names.sql'
          )
        ).ready
      ).toBe(false);
      expect(
        (
          await database.pool.query(
            "SELECT has_table_privilege('qigong_api_runtime','core.person_practice_badges','SELECT') raw_read"
          )
        ).rows[0]?.raw_read
      ).toBe(false);
    } finally {
      await database.dispose();
      await rm(old, { recursive: true, force: true });
    }
  });
});
