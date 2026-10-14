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
suite('LINE invitation migration compatibility', () => {
  it('upgrades28 idempotently with no existing row changes, invitations or automatic approvals', async () => {
    const db = await createIsolatedTestDatabase(url!),
      old = await mkdtemp(path.join(tmpdir(), 'qigong-invite28-'));
    const current = await mkdtemp(path.join(tmpdir(), 'qigong-invite29-chain-'));
    try {
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0030_')
          await copyFile(path.join(directory, file), path.join(current, file));
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0029_')
          await copyFile(path.join(directory, file), path.join(old, file));
      await runMigrations(db.pool, old, 'invite-old');
      const person = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Preserved learner','UTC') RETURNING id"
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'line',$2)",
        [person, 'U' + 'e'.repeat(32)]
      );
      await db.pool.query(
        "INSERT INTO platform.telegram_reminder_settings(person_id,enabled,hour,timezone) VALUES($1,true,21,'UTC')",
        [person]
      );
      await db.pool.query(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name,email) VALUES('https://upgrade.example.invalid','reviewer','Preserved reviewer','verified@example.invalid')"
      );
      const token = randomBytes(32).toString('base64url');
      await db.pool.query(
        "INSERT INTO platform.line_links(line_user_id,token_hash,expires_at) VALUES($1,public.digest($2,'sha256'),clock_timestamp()+INTERVAL '20 minutes')",
        ['U' + 'e'.repeat(32), token]
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
      expect((await runMigrations(db.pool, current, 'invite-new')).applied).toEqual([
        '0029_line_invites.sql'
      ]);
      expect((await runMigrations(db.pool, current, 'invite-repeat')).applied).toEqual([]);
      expect(await Promise.all(tables.map(hash))).toEqual(before);
      for (const table of ['platform.line_invites', 'platform.line_invite_redemptions'])
        expect((await db.pool.query('SELECT * FROM ' + table)).rowCount).toBe(0);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0028_telegram_reminders.sql',
            '0028_telegram_reminders.sql'
          )
        ).ready
      ).toBe(false);
      expect(
        (await getMigrationStatus(db.pool, '0029_line_invites.sql', '0029_line_invites.sql')).ready
      ).toBe(true);
      expect(
        (
          await db.pool.query(
            'SELECT ops.line_invite_schema_ready() current,ops.telegram_reminder_schema_ready() previous'
          )
        ).rows[0]
      ).toEqual({ current: true, previous: false });
    } finally {
      await db.dispose();
      await rm(old, { recursive: true, force: true });
      await rm(current, { recursive: true, force: true });
    }
  });
});
