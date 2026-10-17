import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getMigrationStatus, runMigrations } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Learner-only author names schema36 to37 preservation', () => {
  it('preserves all old data, aliases, hashes, grants and cache without copying registration names into the new profile table', async () => {
    const db = await createIsolatedTestDatabase(base!),
      old = await mkdtemp(path.join(tmpdir(), 'qigong-authors36-')),
      current = await mkdtemp(path.join(tmpdir(), 'qigong-authors37-'));
    try {
      for (const file of await readdir(directory)) {
        if (file.endsWith('.sql') && file < '0037_')
          await copyFile(path.join(directory, file), path.join(old, file));
        if (file.endsWith('.sql') && file < '0038_')
          await copyFile(path.join(directory, file), path.join(current, file));
      }
      await runMigrations(db.pool, old, 'authors-old');
      const row = (
        await db.pool.query<{ checkin: string; identity: string }>(
          "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('authors-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'authors-country','country','國家','Country' FROM g RETURNING id),r AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'authors-region','operational','地區','Region' FROM k RETURNING id),p AS(INSERT INTO identity.people(preferred_name) VALUES('不可作公開暱稱的報名姓名') RETURNING id),i AS(INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) SELECT id,'line','U11111111111111111111111111111111' FROM p RETURNING id,person_id),a AS(INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) SELECT p.id,r.id,'primary',CURRENT_DATE-1 FROM p,r RETURNING id),c AS(INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) SELECT i.person_id,i.id,CURRENT_DATE,'UTC','regular',a.id FROM i,a RETURNING id,submitted_via_identity_id) SELECT id checkin,submitted_via_identity_id identity FROM c"
        )
      ).rows[0]!;
      await db.pool.query(
        "INSERT INTO platform.line_verified_profiles(identity_id,display_name) VALUES($1,'既有已驗證LINE暱稱')",
        [row.identity]
      );
      await db.pool.query(
        "INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) SELECT id,person_id,'私人原文' FROM core.checkins WHERE id=$1",
        [row.checkin]
      );
      await db.pool.query(
        "INSERT INTO core.journal_publications(checkin_id,person_id,identity_id,revision,active,external_enabled,share_note,share_feelings,alias,practice_date,note_snapshot,method_snapshot,tag_snapshot) SELECT id,person_id,submitted_via_identity_id,1,TRUE,TRUE,TRUE,FALSE,'Learner old1234',practice_date,'既有分享快照','[]','[]' FROM core.checkins WHERE id=$1",
        [row.checkin]
      );
      const tables = (
        await db.pool.query<{ schema: string; name: string }>(
          "SELECT schemaname schema,tablename name FROM pg_tables WHERE schemaname IN('identity','core','platform','admin','audit','ops') ORDER BY 1,2"
        )
      ).rows;
      const fingerprint = () =>
        Promise.all(
          tables.map(async (t) => {
            const name = t.schema + '.' + t.name,
              projection =
                name === 'core.platform_metadata'
                  ? "to_jsonb(r)-'architecture_version'-'updated_at'"
                  : 'to_jsonb(r)';
            return (
              await db.pool.query<{ value: string }>(
                'SELECT md5(coalesce(jsonb_agg(' +
                  projection +
                  ' ORDER BY (' +
                  projection +
                  ")::text)::text,'')) value FROM " +
                  name +
                  ' r'
              )
            ).rows[0]!.value;
          })
        );
      const functions = () =>
        db.pool.query<{
          signature: string;
          owner: string;
          acl: string | null;
          prosecdef: boolean;
          proconfig: string[] | null;
          provolatile: string;
        }>(
          "SELECT p.oid::regprocedure::text signature,p.proowner::regrole::text owner,p.proacl::text acl,p.prosecdef,p.proconfig,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('core','platform','admin','ops') ORDER BY 1"
        );
      const before = await fingerprint(),
        beforeFunctions = (await functions()).rows,
        source = (await db.pool.query('SELECT platform.journal_source($1) source', [row.checkin]))
          .rows[0];
      expect((await runMigrations(db.pool, current, 'authors-new')).applied).toEqual([
        '0037_learner_author_names.sql'
      ]);
      expect((await runMigrations(db.pool, current, 'authors-repeat')).applied).toEqual([]);
      expect(await fingerprint()).toEqual(before);
      expect(
        (await db.pool.query('SELECT platform.journal_source($1) source', [row.checkin])).rows[0]
      ).toEqual(source);
      const afterFunctions = (await functions()).rows;
      for (const previous of beforeFunctions)
        expect(afterFunctions.find((f) => f.signature === previous.signature)).toEqual(previous);
      expect(afterFunctions.length).toBe(beforeFunctions.length + 4);
      expect(
        (await db.pool.query('SELECT * FROM platform.telegram_verified_profiles')).rowCount
      ).toBe(0);
      expect(
        (
          await db.pool.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='platform.telegram_verified_profiles'::regclass"
          )
        ).rows[0]
      ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      expect(
        (
          await db.pool.query(
            'SELECT ops.learner_author_names_schema_ready() current,ops.feeling_tag_locales_schema_ready() previous'
          )
        ).rows[0]
      ).toEqual({ current: true, previous: false });
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0036_feeling_tag_simplified_labels.sql',
            '0036_feeling_tag_simplified_labels.sql'
          )
        ).ready
      ).toBe(false);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0037_learner_author_names.sql',
            '0037_learner_author_names.sql'
          )
        ).ready
      ).toBe(true);
    } finally {
      await db.dispose();
      await rm(old, { recursive: true, force: true });
      await rm(current, { recursive: true, force: true });
    }
  });
});
