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

suite('Community note schema33 to34 compatibility', () => {
  it('preserves all old rows, pending applications and preferences; does not backfill approvals or invitations', async () => {
    const db = await createIsolatedTestDatabase(base!);
    const old = await mkdtemp(path.join(tmpdir(), 'qigong-community33-'));
    try {
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0034_')
          await copyFile(path.join(directory, file), path.join(old, file));
      await runMigrations(db.pool, old, 'continuation-old');
      const principal = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://upgrade.example.invalid','preserved','Synthetic administrator') RETURNING id"
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO admin.review_notification_preferences(principal_id,telegram_subject,admin_enabled,learner_enabled) VALUES($1,'548000000033',TRUE,TRUE)",
        [principal]
      );
      await db.pool.query(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164) VALUES('line',$1,'Synthetic pending','Synthetic pending','draft@example.invalid','+65960000003')",
        ['U' + 'd'.repeat(32)]
      );
      await db.pool.query(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('old-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'old-country','country','國家','Country' FROM g RETURNING id),r AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'old-region','operational','地區','Region' FROM k RETURNING id),p AS(INSERT INTO identity.people(preferred_name) VALUES('Synthetic old author') RETURNING id),i AS(INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) SELECT id,'line','U11111111111111111111111111111111' FROM p RETURNING id,person_id),a AS(INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) SELECT p.id,r.id,'primary',CURRENT_DATE-30 FROM p,r RETURNING id,person_id),c AS(INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) SELECT i.person_id,i.id,CURRENT_DATE-1,'UTC','regular',a.id FROM i,a RETURNING id,person_id) INSERT INTO core.checkin_notes(checkin_id,person_id,practice_note) SELECT id,person_id,'Synthetic old PRIVATE reflection' FROM c"
      );
      const tables = (
        await db.pool.query<{ schema: string; name: string }>(
          "SELECT schemaname schema,tablename name FROM pg_tables WHERE schemaname IN('identity','core','platform','admin','audit','ops') AND NOT(schemaname='core' AND tablename='platform_metadata') ORDER BY 1,2"
        )
      ).rows;
      const fingerprints = () =>
        Promise.all(
          tables.map(
            async (t) =>
              (
                await db.pool.query<{ hash: string }>(
                  "SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'')) hash FROM " +
                    t.schema +
                    '.' +
                    t.name +
                    ' r'
                )
              ).rows[0]!.hash
          )
        );
      const before = await fingerprints();
      expect(
        (await db.pool.query('SELECT ops.line_invite_continuation_schema_ready() ready')).rows[0]!
          .ready
      ).toBe(true);
      await copyFile(
        path.join(directory, '0034_community_note_sharing.sql'),
        path.join(old, '0034_community_note_sharing.sql')
      );
      expect((await runMigrations(db.pool, old, 'continuation-new')).applied).toEqual([
        '0034_community_note_sharing.sql'
      ]);
      expect((await runMigrations(db.pool, old, 'continuation-repeat')).applied).toEqual([]);
      expect(await fingerprints()).toEqual(before);
      expect((await db.pool.query('SELECT * FROM core.community_note_origins')).rowCount).toBe(0);
      expect(
        (
          await db.pool.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='core.community_note_origins'::regclass"
          )
        ).rows[0]
      ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0033_line_invite_continuation.sql',
            '0033_line_invite_continuation.sql'
          )
        ).ready
      ).toBe(false);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0034_community_note_sharing.sql',
            '0034_community_note_sharing.sql'
          )
        ).ready
      ).toBe(true);
      expect(
        (
          await db.pool.query(
            'SELECT ops.community_notes_schema_ready() current,ops.line_invite_continuation_schema_ready() previous'
          )
        ).rows[0]
      ).toEqual({ current: true, previous: false });
    } finally {
      await db.dispose();
      await rm(old, { recursive: true, force: true });
    }
  });
});
