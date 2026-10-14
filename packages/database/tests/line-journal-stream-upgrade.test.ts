import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runMigrations, getMigrationStatus } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('LINE journal stream schema29 to30', () => {
  it('changes no old rows or tables and rejects old API/worker while preserving existing share facades', async () => {
    const db = await createIsolatedTestDatabase(base!),
      old = await mkdtemp(path.join(tmpdir(), 'qigong-stream29-'));
    try {
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0030_')
          await copyFile(path.join(directory, file), path.join(old, file));
      await runMigrations(db.pool, old, 'stream-old');
      await db.pool.query(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Preserved learner','UTC')"
      );
      await db.pool.query(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name,email) VALUES('https://stream-upgrade.example.invalid','reviewer','Preserved reviewer','verified@example.invalid')"
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
      const definitions = (
        await db.pool.query<{ name: string; definition: string }>(
          "SELECT p.proname name,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='core' AND p.proname='journal_audience_feed') OR (n.nspname='platform' AND p.proname IN('community_feed','external_journal_feed','channel_journal_own','channel_journal_publish')) ORDER BY 1"
        )
      ).rows;
      expect((await runMigrations(db.pool, directory, 'stream-new')).applied).toEqual([
        '0030_line_journal_stream.sql'
      ]);
      expect((await runMigrations(db.pool, directory, 'stream-repeat')).applied).toEqual([]);
      expect(await Promise.all(tables.map(hash))).toEqual(before);
      expect(
        (
          await db.pool.query(
            "SELECT p.proname name,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='core' AND p.proname='journal_audience_feed') OR (n.nspname='platform' AND p.proname IN('community_feed','external_journal_feed','channel_journal_own','channel_journal_publish')) ORDER BY 1"
          )
        ).rows
      ).toEqual(definitions);
      expect(
        (await getMigrationStatus(db.pool, '0029_line_invites.sql', '0029_line_invites.sql')).ready
      ).toBe(false);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0030_line_journal_stream.sql',
            '0030_line_journal_stream.sql'
          )
        ).ready
      ).toBe(true);
      expect(
        (
          await db.pool.query(
            'SELECT ops.line_journal_stream_schema_ready() current,ops.line_invite_schema_ready() previous'
          )
        ).rows[0]
      ).toEqual({ current: true, previous: false });
    } finally {
      await db.dispose();
      await rm(old, { recursive: true, force: true });
    }
  });
});
