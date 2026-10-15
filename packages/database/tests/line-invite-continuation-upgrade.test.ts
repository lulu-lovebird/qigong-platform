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

suite('LINE invitation continuation schema32 to33 compatibility', () => {
  it('preserves all old rows, pending applications and preferences; does not backfill approvals or invitations', async () => {
    const db = await createIsolatedTestDatabase(base!);
    const old = await mkdtemp(path.join(tmpdir(), 'qigong-invite32-'));
    try {
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0033_')
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
        (await db.pool.query('SELECT ops.review_notification_schema_ready() ready')).rows[0]!.ready
      ).toBe(true);
      expect((await runMigrations(db.pool, directory, 'continuation-new')).applied).toEqual([
        '0033_line_invite_continuation.sql'
      ]);
      expect((await runMigrations(db.pool, directory, 'continuation-repeat')).applied).toEqual([]);
      expect(await fingerprints()).toEqual(before);
      expect(
        (await db.pool.query('SELECT * FROM platform.line_invite_continuations')).rowCount
      ).toBe(0);
      expect(
        (
          await db.pool.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='platform.line_invite_continuations'::regclass"
          )
        ).rows[0]
      ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0032_review_notifications.sql',
            '0032_review_notifications.sql'
          )
        ).ready
      ).toBe(false);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0033_line_invite_continuation.sql',
            '0033_line_invite_continuation.sql'
          )
        ).ready
      ).toBe(true);
      expect(
        (
          await db.pool.query(
            'SELECT ops.line_invite_continuation_schema_ready() current,ops.review_notification_schema_ready() previous'
          )
        ).rows[0]
      ).toEqual({ current: true, previous: false });
    } finally {
      await db.dispose();
      await rm(old, { recursive: true, force: true });
    }
  });
});
