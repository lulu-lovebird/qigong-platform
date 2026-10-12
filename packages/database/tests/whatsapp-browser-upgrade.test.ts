import { randomBytes, randomUUID } from 'node:crypto';
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
suite('WhatsApp browser schema26 to27 compatibility', () => {
  it('preserves every old table except pending WA cancellation and metadata, creates no session, and keeps LINE receipts active', async () => {
    const db = await createIsolatedTestDatabase(url!),
      old = await mkdtemp(path.join(tmpdir(), 'qigong-browser-upgrade-'));
    const current = await mkdtemp(path.join(tmpdir(), 'qigong-browser27-chain-'));
    try {
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0028_')
          await copyFile(path.join(directory, file), path.join(current, file));
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0027_')
          await copyFile(path.join(directory, file), path.join(old, file));
      await runMigrations(db.pool, old, 'browser-old');
      const actor = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name,email) VALUES('https://upgrade.example.invalid','reviewer','Preserved reviewer','verified@example.invalid') RETURNING id"
        )
      ).rows[0]!.id;
      const region = (
        await db.pool.query<{ id: string }>(
          "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('browser-upgrade-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'browser-upgrade-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'browser-upgrade-region','operational','地區','Region' FROM k RETURNING id"
        )
      ).rows[0]!.id;
      const waToken = randomBytes(32).toString('base64url'),
        request = randomUUID();
      for (const platform of ['line', 'whatsapp'] as const) {
        const subject = platform === 'line' ? 'U' + 'a'.repeat(32) : '65920000001';
        const person = (
          await db.pool.query<{ id: string }>(
            "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Preserved learner','UTC') RETURNING id"
          )
        ).rows[0]!.id;
        const identity = (
          await db.pool.query<{ id: string }>(
            'INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,$2,$3) RETURNING id',
            [person, platform, subject]
          )
        ).rows[0]!.id;
        await db.pool.query(
          "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
          [person, identity]
        );
        await db.pool.query(
          "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-10)",
          [person, region]
        );
        await db.pool.query(
          "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES($1,$2,'Preserved','Preserved','demo@example.invalid','+65920000001',$3,'approved',$4,CURRENT_TIMESTAMP,$5)",
          [platform, subject, region, person, actor]
        );
        const credential = platform === 'line' ? subject : waToken;
        if (platform === 'whatsapp') {
          await db.pool.query("SELECT platform.begin_whatsapp_link($1,$2,'checkin')", [
            subject,
            credential
          ]);
          await db.pool.query(
            'SELECT platform.record_whatsapp_service_window($1,clock_timestamp())',
            [subject]
          );
        }
        await db.pool.query('SELECT platform.channel_workspace_timezone($1,$2,$3)', [
          platform,
          credential,
          'UTC'
        ]);
        const saved = await db.pool.query<{ data: { receiptQueued: boolean } }>(
          "SELECT platform.channel_workspace_save($1,$2,$3,CURRENT_DATE,0,ARRAY['dayan_chu'],NULL,NULL) data",
          [platform, credential, platform === 'whatsapp' ? request : randomUUID()]
        );
        expect(saved.rows[0]!.data.receiptQueued).toBe(true);
      }
      await db.pool.query(
        "UPDATE ops.channel_practice_receipts SET status='sending',lease_id=gen_random_uuid(),leased_until=clock_timestamp()+INTERVAL '10 minutes' WHERE platform='whatsapp'"
      );
      const tables = (
        await db.pool.query<{ schema: string; name: string }>(
          "SELECT schemaname schema,tablename name FROM pg_tables WHERE schemaname IN('identity','core','platform','admin','audit','ops') AND NOT(schemaname='core' AND tablename='platform_metadata') AND NOT(schemaname='ops' AND tablename='channel_practice_receipts') ORDER BY 1,2"
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
      const before = await Promise.all(tables.map(hash)),
        line = (
          await db.pool.query("SELECT * FROM ops.channel_practice_receipts WHERE platform='line'")
        ).rows;
      expect((await runMigrations(db.pool, current, 'browser-new')).applied).toEqual([
        '0027_whatsapp_browser_sessions.sql'
      ]);
      expect((await runMigrations(db.pool, current, 'browser-repeat')).applied).toEqual([]);
      expect(await Promise.all(tables.map(hash))).toEqual(before);
      expect(
        (await db.pool.query("SELECT * FROM ops.channel_practice_receipts WHERE platform='line'"))
          .rows
      ).toEqual(line);
      const cancelled = (
        await db.pool.query(
          "SELECT status,lease_id,leased_until FROM ops.channel_practice_receipts WHERE platform='whatsapp'"
        )
      ).rows;
      expect(cancelled).toEqual([{ status: 'cancelled', lease_id: null, leased_until: null }]);
      expect(
        (await db.pool.query('SELECT * FROM platform.whatsapp_browser_sessions')).rowCount
      ).toBe(0);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0026_admin_oidc_profile.sql',
            '0026_admin_oidc_profile.sql'
          )
        ).ready
      ).toBe(false);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0027_whatsapp_browser_sessions.sql',
            '0027_whatsapp_browser_sessions.sql'
          )
        ).ready
      ).toBe(true);
      expect(
        (
          await db.pool.query(
            'SELECT ops.whatsapp_browser_schema_ready() current,ops.admin_oidc_profile_schema_ready() previous'
          )
        ).rows[0]
      ).toEqual({ current: true, previous: false });
      const retry = (
        await db.pool.query<{ data: { receiptQueued: boolean } }>(
          "SELECT platform.channel_workspace_save('whatsapp',$1,$2,CURRENT_DATE,0,ARRAY['dayan_chu'],NULL,NULL) data",
          [waToken, request]
        )
      ).rows[0]!.data;
      expect(retry.receiptQueued).toBe(false);
      expect(
        (await db.pool.query("SELECT * FROM ops.claim_channel_practice_receipts('whatsapp',3)"))
          .rowCount
      ).toBe(0);
      expect(
        (await db.pool.query("SELECT * FROM ops.claim_channel_practice_receipts('line',3)"))
          .rowCount
      ).toBe(1);
    } finally {
      await db.dispose();
      await rm(old, { recursive: true, force: true });
      await rm(current, { recursive: true, force: true });
    }
  });
});
