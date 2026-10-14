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
suite('LINE provider display metadata upgrade', () => {
  it('upgrades30 without copying self-reported names or changing existing private data, authorization or publications', async () => {
    const db = await createIsolatedTestDatabase(base!),
      old = await mkdtemp(path.join(tmpdir(), 'qigong-profile30-'));
    const current = await mkdtemp(path.join(tmpdir(), 'qigong-profile31-chain-'));
    try {
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0032_')
          await copyFile(path.join(directory, file), path.join(current, file));
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0031_')
          await copyFile(path.join(directory, file), path.join(old, file));
      await runMigrations(db.pool, old, 'profile-old');
      const person = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name) VALUES('Self-reported legal name') RETURNING id"
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,display_name) VALUES($1,'line',$2,'Self-reported name')",
        [person, 'U' + 'e'.repeat(32)]
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
      expect((await runMigrations(db.pool, current, 'profile-new')).applied).toEqual([
        '0031_line_verified_profile_names.sql'
      ]);
      expect((await runMigrations(db.pool, current, 'profile-repeat')).applied).toEqual([]);
      expect(await Promise.all(tables.map(hash))).toEqual(before);
      expect((await db.pool.query('SELECT * FROM platform.line_verified_profiles')).rowCount).toBe(
        0
      );
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0030_line_journal_stream.sql',
            '0030_line_journal_stream.sql'
          )
        ).ready
      ).toBe(false);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0031_line_verified_profile_names.sql',
            '0031_line_verified_profile_names.sql'
          )
        ).ready
      ).toBe(true);
      expect(
        (
          await db.pool.query(
            'SELECT ops.line_profile_schema_ready() current,ops.line_journal_stream_schema_ready() previous'
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
