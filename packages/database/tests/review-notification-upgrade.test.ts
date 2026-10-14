import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runMigrations, getMigrationStatus } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Reviewer notification schema31 to32 compatibility', () => {
  it('preserves old rows and pending requests with no automatic routing, bindings or historical events', async () => {
    const db = await createIsolatedTestDatabase(base!),
      old = await mkdtemp(path.join(tmpdir(), 'qigong-review31-'));
    try {
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0032_')
          await copyFile(path.join(directory, file), path.join(old, file));
      await runMigrations(db.pool, old, 'review-old');
      const principal = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://upgrade.example.invalid','pending','Preserved applicant') RETURNING id"
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO admin.access_applications(principal_id,status,version,requested_role,scope_description,applicant_reason) VALUES($1,'pending',2,'coach_admin','Preserved scope','Private reason')",
        [principal]
      );
      const tables = (
        await db.pool.query<{ schema: string; name: string }>(
          "SELECT schemaname schema,tablename name FROM pg_tables WHERE schemaname IN('identity','core','platform','admin','audit','ops') AND NOT(schemaname='core' AND tablename='platform_metadata') ORDER BY 1,2"
        )
      ).rows;
      const hash = async (t: { schema: string; name: string }) =>
        (
          await db.pool.query<{ hash: string }>(
            "SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'')) hash FROM " +
              t.schema +
              '.' +
              t.name +
              ' r'
          )
        ).rows[0]!.hash;
      const before = await Promise.all(tables.map(hash));
      expect((await runMigrations(db.pool, directory, 'review-new')).applied).toEqual([
        '0032_review_notifications.sql'
      ]);
      expect((await runMigrations(db.pool, directory, 'review-repeat')).applied).toEqual([]);
      expect(await Promise.all(tables.map(hash))).toEqual(before);
      for (const name of [
        'admin.review_notification_preferences',
        'admin.review_notification_links',
        'ops.review_notification_events',
        'ops.review_notification_deliveries'
      ])
        expect((await db.pool.query('SELECT * FROM ' + name)).rowCount).toBe(0);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0031_line_verified_profile_names.sql',
            '0031_line_verified_profile_names.sql'
          )
        ).ready
      ).toBe(false);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0032_review_notifications.sql',
            '0032_review_notifications.sql'
          )
        ).ready
      ).toBe(true);
      expect(
        (
          await db.pool.query(
            'SELECT ops.review_notification_schema_ready() current,ops.line_profile_schema_ready() previous'
          )
        ).rows[0]
      ).toEqual({ current: true, previous: false });
    } finally {
      await db.dispose();
      await rm(old, { recursive: true, force: true });
    }
  });
});
