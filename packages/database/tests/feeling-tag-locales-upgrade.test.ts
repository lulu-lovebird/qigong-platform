import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getMigrationStatus, runMigrations } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Feeling tag translations schema35 to36', () => {
  it('adds nullable translations without backfilling catalog, historical selections, publications, source hashes or permissions', async () => {
    const db = await createIsolatedTestDatabase(base!),
      old = await mkdtemp(path.join(tmpdir(), 'qigong-tags35-'));
    try {
      for (const name of await readdir(directory))
        if (name.endsWith('.sql') && name < '0036_')
          await copyFile(path.join(directory, name), path.join(old, name));
      await runMigrations(db.pool, old, 'tags-old');
      const tag = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO core.practice_feeling_tags(name_zh_tw,name_en,sort_order) VALUES('已儲存','Original saved tag',1) RETURNING id"
        )
      ).rows[0]!.id;
      const checkin = (
        await db.pool.query<{ id: string }>(
          "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('tag-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tag-country','country','國家','Country' FROM g RETURNING id),r AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tag-region','operational','地區','Region' FROM k RETURNING id),p AS(INSERT INTO identity.people(preferred_name) VALUES('姓名原文') RETURNING id),i AS(INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) SELECT id,'line','U11111111111111111111111111111111' FROM p RETURNING id,person_id),a AS(INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) SELECT p.id,r.id,'primary',CURRENT_DATE-1 FROM p,r RETURNING id) INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) SELECT i.person_id,i.id,CURRENT_DATE,'UTC','regular',a.id FROM i,a RETURNING id"
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) SELECT id,person_id,'舊心得：已儲存' FROM core.checkins WHERE id=$1",
        [checkin]
      );
      await db.pool.query(
        'INSERT INTO core.checkin_note_tags(checkin_id,person_id,tag_id,name_zh_tw,name_en,sort_order) SELECT c.id,c.person_id,t.id,t.name_zh_tw,t.name_en,t.sort_order FROM core.checkins c CROSS JOIN core.practice_feeling_tags t WHERE c.id=$1 AND t.id=$2',
        [checkin, tag]
      );
      const source = (await db.pool.query('SELECT platform.journal_source($1) value', [checkin]))
        .rows[0]!.value;
      await db.pool.query(
        "INSERT INTO core.journal_publications(checkin_id,person_id,identity_id,revision,active,external_enabled,share_note,share_feelings,alias,practice_date,note_snapshot,method_snapshot,tag_snapshot) SELECT id,person_id,submitted_via_identity_id,1,TRUE,FALSE,TRUE,TRUE,'匿名學員',practice_date,'舊心得：已儲存','[]'::jsonb,$2::jsonb FROM core.checkins WHERE id=$1",
        [checkin, JSON.stringify(source.tags)]
      );
      const tables = (
        await db.pool.query<{ schema: string; name: string }>(
          "SELECT schemaname schema,tablename name FROM pg_tables WHERE schemaname IN('core','identity','platform','admin','audit','ops') ORDER BY 1,2"
        )
      ).rows;
      const fingerprint = () =>
        Promise.all(
          tables.map(async (t) => {
            const name = t.schema + '.' + t.name,
              projection =
                name === 'core.platform_metadata'
                  ? "to_jsonb(r)-'architecture_version'-'updated_at'"
                  : ['core.practice_feeling_tags', 'core.checkin_note_tags'].includes(name)
                    ? "to_jsonb(r)-'name_zh_cn'"
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
      const metadata = () =>
        db.pool.query(
          "SELECT n.nspname,c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN('core','identity','platform','admin','audit','ops') ORDER BY 1,2"
        );
      const before = await fingerprint(),
        security = (await metadata()).rows;
      expect((await runMigrations(db.pool, directory, 'tags-new')).applied).toEqual([
        '0036_feeling_tag_simplified_labels.sql'
      ]);
      expect((await runMigrations(db.pool, directory, 'tags-repeat')).applied).toEqual([]);
      expect(await fingerprint()).toEqual(before);
      expect((await metadata()).rows).toEqual(security);
      expect(
        (await db.pool.query('SELECT name_zh_cn FROM core.practice_feeling_tags')).rows
      ).toEqual([{ name_zh_cn: null }]);
      expect((await db.pool.query('SELECT name_zh_cn FROM core.checkin_note_tags')).rows).toEqual([
        { name_zh_cn: null }
      ]);
      expect(
        (await db.pool.query('SELECT platform.journal_source($1) value', [checkin])).rows[0]!.value
      ).toEqual(source);
      expect(
        (
          await db.pool.query(
            'SELECT ops.feeling_tag_locales_schema_ready() current,ops.locale_schema_ready() previous'
          )
        ).rows[0]
      ).toEqual({ current: true, previous: false });
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0035_simplified_chinese_locale.sql',
            '0035_simplified_chinese_locale.sql'
          )
        ).ready
      ).toBe(false);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0036_feeling_tag_simplified_labels.sql',
            '0036_feeling_tag_simplified_labels.sql'
          )
        ).ready
      ).toBe(true);
    } finally {
      await db.dispose();
      await rm(old, { recursive: true, force: true });
    }
  });
});
