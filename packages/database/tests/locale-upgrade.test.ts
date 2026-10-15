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
suite('Three-locale schema34 to35 compatibility', () => {
  it('preserves content, existing preferences, grants and legal records without assigning language from region', async () => {
    const db = await createIsolatedTestDatabase(base!),
      old = await mkdtemp(path.join(tmpdir(), 'qigong-locale34-'));
    try {
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0035_')
          await copyFile(path.join(directory, file), path.join(old, file));
      await runMigrations(db.pool, old, 'locale-old');
      const actor = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://locale.example.invalid','preserved','臺灣姓名保留原文') RETURNING id"
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO platform.identity_preferences(platform,external_subject_id,locale,last_telegram_update_id) VALUES('telegram','548000000035','en',300),('whatsapp','659900000035','zh_TW',NULL)"
      );
      await db.pool.query(
        "INSERT INTO admin.review_notification_preferences(principal_id,telegram_subject,locale,admin_enabled) VALUES($1,'548000000036','en',TRUE)",
        [actor]
      );
      await db.pool.query(
        "INSERT INTO admin.review_notification_links(principal_id,token_hash,expires_at) VALUES($1,public.digest('synthetic-old-link','sha256'),clock_timestamp()+INTERVAL '10 minutes')",
        [actor]
      );
      await db.pool.query(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('old-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'old-country','country','國家','Country' FROM g RETURNING id),r AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'sg-general','operational','新加坡','Singapore' FROM k RETURNING id),p AS(INSERT INTO identity.people(preferred_name) VALUES('練功打卡') RETURNING id),i AS(INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) SELECT id,'line','U11111111111111111111111111111111' FROM p RETURNING id,person_id),a AS(INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) SELECT p.id,r.id,'primary',CURRENT_DATE-30 FROM p,r RETURNING id,person_id),c AS(INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) SELECT i.person_id,i.id,CURRENT_DATE-1,'UTC','regular',a.id FROM i,a RETURNING id,person_id) INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) SELECT id,person_id,'臺灣學員的未分享心得，保留原文。' FROM c"
      );
      const tables = (
        await db.pool.query<{ schema: string; name: string }>(
          "SELECT schemaname schema,tablename name FROM pg_tables WHERE schemaname IN('identity','core','platform','admin','audit','ops') AND NOT(schemaname='core' AND tablename='platform_metadata') ORDER BY 1,2"
        )
      ).rows;
      const fingerprints = () =>
        Promise.all(
          tables.map(async (t) => {
            const projection =
              t.schema === 'admin' && t.name === 'review_notification_links'
                ? "to_jsonb(r)-'locale'"
                : 'to_jsonb(r)';
            return (
              await db.pool.query<{ hash: string }>(
                'SELECT md5(coalesce(jsonb_agg(' +
                  projection +
                  ' ORDER BY (' +
                  projection +
                  ")::text)::text,'')) hash FROM " +
                  t.schema +
                  '.' +
                  t.name +
                  ' r'
              )
            ).rows[0]!.hash;
          })
        );
      const before = await fingerprints();
      expect(
        (await db.pool.query('SELECT ops.community_notes_schema_ready() ready')).rows[0]!.ready
      ).toBe(true);
      await copyFile(
        path.join(directory, '0035_simplified_chinese_locale.sql'),
        path.join(old, '0035_simplified_chinese_locale.sql')
      );
      expect((await runMigrations(db.pool, old, 'locale-new')).applied).toEqual([
        '0035_simplified_chinese_locale.sql'
      ]);
      expect((await runMigrations(db.pool, old, 'locale-repeat')).applied).toEqual([]);
      expect(await fingerprints()).toEqual(before);
      expect(
        (await db.pool.query('SELECT locale FROM admin.review_notification_links')).rows[0]!.locale
      ).toBeNull();
      expect(
        (
          await db.pool.query(
            'SELECT locale,last_telegram_update_id FROM platform.identity_preferences WHERE platform=$1',
            ['telegram']
          )
        ).rows[0]
      ).toEqual({ locale: 'en', last_telegram_update_id: '300' });
      expect(
        (await db.pool.query('SELECT * FROM platform.learner_privacy_acceptances')).rowCount
      ).toBe(0);
      expect((await db.pool.query('SELECT * FROM core.journal_publications')).rowCount).toBe(0);
      expect(
        (
          await db.pool.query(
            'SELECT ops.locale_schema_ready() current,ops.community_notes_schema_ready() previous'
          )
        ).rows[0]
      ).toEqual({ current: true, previous: false });
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0034_community_note_sharing.sql',
            '0034_community_note_sharing.sql'
          )
        ).ready
      ).toBe(false);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0035_simplified_chinese_locale.sql',
            '0035_simplified_chinese_locale.sql'
          )
        ).ready
      ).toBe(true);
    } finally {
      await db.dispose();
      await rm(old, { recursive: true, force: true });
    }
  });
});
