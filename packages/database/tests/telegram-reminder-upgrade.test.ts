import { randomBytes } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runMigrations, getMigrationStatus } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const url = process.env.TEST_DATABASE_URL,
  suite = url ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Telegram reminder migration compatibility', () => {
  it('upgrades27 without changing existing records or enrolling anyone in reminders and rejects old API/worker contracts', async () => {
    const db = await createIsolatedTestDatabase(url!),
      old = await mkdtemp(path.join(tmpdir(), 'qigong-reminder27-'));
    try {
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0028_')
          await copyFile(path.join(directory, file), path.join(old, file));
      await runMigrations(db.pool, old, 'reminder-old');
      const person = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Preserved reminder learner','UTC') RETURNING id"
        )
      ).rows[0]!.id;
      const identity = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'whatsapp','65950000001') RETURNING id",
          [person]
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO platform.whatsapp_browser_sessions(person_id,identity_id,token_hash,csrf_hash,remembered,expires_at) VALUES($1,$2,public.digest($3,'sha256'),public.digest($4,'sha256'),true,clock_timestamp()+INTERVAL '1 day')",
        [
          person,
          identity,
          randomBytes(32).toString('base64url'),
          randomBytes(32).toString('base64url')
        ]
      );
      await db.pool.query(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name,email) VALUES('https://upgrade.example.invalid','reviewer','Preserved reviewer','verified@example.invalid')"
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
      expect((await runMigrations(db.pool, directory, 'reminder-new')).applied).toEqual([
        '0028_telegram_reminders.sql'
      ]);
      expect((await runMigrations(db.pool, directory, 'reminder-repeat')).applied).toEqual([]);
      expect(await Promise.all(tables.map(hash))).toEqual(before);
      for (const table of [
        'platform.telegram_reminder_settings',
        'platform.telegram_reminder_updates',
        'ops.telegram_reminders'
      ])
        expect((await db.pool.query('SELECT * FROM ' + table)).rowCount).toBe(0);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0027_whatsapp_browser_sessions.sql',
            '0027_whatsapp_browser_sessions.sql'
          )
        ).ready
      ).toBe(false);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0028_telegram_reminders.sql',
            '0028_telegram_reminders.sql'
          )
        ).ready
      ).toBe(true);
      expect(
        (
          await db.pool.query(
            'SELECT ops.telegram_reminder_schema_ready() current,ops.whatsapp_browser_schema_ready() previous'
          )
        ).rows[0]
      ).toEqual({ current: true, previous: false });
    } finally {
      await db.dispose();
      await rm(old, { recursive: true, force: true });
    }
  });
});
