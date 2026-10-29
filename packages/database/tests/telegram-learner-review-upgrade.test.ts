import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getMigrationStatus, runMigrations, withRequestContext } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Schema58→59 preservation and tested same-schema count-only fallback', () => {
  it('defaults old bound learner subscriptions OFF for personal data, preserves business functions, and safely returns to count-only', async () => {
    const db = await createIsolatedTestDatabase(base!);
    const old = await mkdtemp(path.join(tmpdir(), 'tgapply-schema58-'));
    try {
      for (const file of await readdir(directory))
        if (file.endsWith('.sql') && file < '0059_')
          await copyFile(path.join(directory, file), path.join(old, file));
      await runMigrations(db.pool, old, 'tgapply-old');
      const principal = (
        await db.pool.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://tgapply-upgrade.example.invalid','reviewer','Synthetic reviewer') RETURNING id"
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic' FROM admin.roles WHERE code='super_admin'",
        [principal]
      );
      const region = (
        await db.pool.query<{ id: string }>(
          "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('upgrade-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'upgrade-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'upgrade-region','operational','地區','Region' FROM c RETURNING id"
        )
      ).rows[0]!.id;
      await db.pool.query(
        "INSERT INTO admin.review_notification_preferences(principal_id,telegram_subject,admin_enabled,learner_enabled,locale) VALUES($1,'548000000059',true,true,'en')",
        [principal]
      );
      await db.pool.query(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164) VALUES('line',$1,'Synthetic nickname',$2,'Synthetic self-report','synthetic@example.invalid','+659900000059')",
        ['U' + randomBytes(16).toString('hex'), region]
      );
      const business = async () =>
        (
          await db.pool.query(
            "SELECT p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) definition,p.proowner,p.proacl::text FROM pg_proc p WHERE p.oid IN('identity.decide_application(uuid,text,text)'::regprocedure,'ops.capture_review_notification_event()'::regprocedure) ORDER BY 1"
          )
        ).rows;
      const before = await business();
      const grants = (await db.pool.query('SELECT * FROM admin.role_grants')).rows;
      expect((await runMigrations(db.pool, directory, 'tgapply-new')).applied).toEqual([
        '0059_telegram_learner_review.sql'
      ]);
      expect((await runMigrations(db.pool, directory, 'tgapply-repeat')).applied).toEqual([]);
      expect(await business()).toEqual(before);
      expect((await db.pool.query('SELECT * FROM admin.role_grants')).rows).toEqual(grants);
      expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(0);
      expect((await db.pool.query('SELECT * FROM ops.telegram_learner_reviews')).rowCount).toBe(0);
      expect(
        (
          await db.pool.query(
            'SELECT learner_enabled,learner_review_enabled,learner_review_disclosure,revision FROM admin.review_notification_preferences'
          )
        ).rows
      ).toEqual([
        {
          learner_enabled: true,
          learner_review_enabled: false,
          learner_review_disclosure: null,
          revision: 1
        }
      ]);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0058_venue_early_checkin_window.sql',
            '0058_venue_early_checkin_window.sql'
          )
        ).ready
      ).toBe(false);
      expect(
        (
          await getMigrationStatus(
            db.pool,
            '0058_venue_early_checkin_window.sql',
            '0059_telegram_learner_review.sql'
          )
        ).ready
      ).toBe(true);
      const api = (sql: string, values: unknown[] = []) =>
        withRequestContext(
          db.pool,
          'qigong_api_runtime',
          { requestId: randomUUID(), principalId: principal },
          (c) => c.query(sql, values)
        );
      await api(
        "SELECT admin.save_telegram_learner_review_preferences(1,true,true,'en',false,true,'telegram-learner-review-v1')"
      );
      const job = (
        await db.pool.query<{ id: string; lease_id: string }>(
          'SELECT * FROM ops.claim_telegram_learner_reviews(5)'
        )
      ).rows[0]!;
      const token = randomBytes(32).toString('base64url');
      await db.pool.query('SELECT ops.telegram_learner_review_payload($1,$2,$3)', [
        job.id,
        job.lease_id,
        token
      ]);
      await db.pool.query('SELECT ops.finish_telegram_learner_review($1,$2,590)', [
        job.id,
        job.lease_id
      ]);
      // Same schema, no down migration or business-data reversal. Old preference
      // signature invalidates every direct token and restores legacy routing.
      await api("SELECT admin.save_review_notification_preferences(2,true,true,'en',false)");
      expect(
        (
          await db.pool.query<{ data: { state: string } }>(
            'SELECT platform.telegram_learner_review_action($1,590,$2,$3,$4) data',
            ['548000000059', token, 'approve', randomBytes(32).toString('base64url')]
          )
        ).rows[0]!.data.state
      ).toBe('unavailable');
      expect(
        (await db.pool.query('SELECT * FROM ops.claim_telegram_learner_reviews(5)')).rows
      ).toEqual([]);
      await db.pool.query('SELECT ops.queue_review_notifications(200)');
      await db.pool.query(
        'UPDATE ops.review_notification_deliveries SET available_at=clock_timestamp()'
      );
      const count = (
        await db.pool.query<{ id: string; lease_id: string }>(
          'SELECT * FROM ops.claim_review_notifications(5)'
        )
      ).rows[0]!;
      const data = (
        await db.pool.query<{ data: Record<string, unknown> }>(
          'SELECT ops.review_notification_payload($1,$2) data',
          [count.id, count.lease_id]
        )
      ).rows[0]!.data;
      expect(data).toMatchObject({ kind: 'learner', count: 1, allowed: true });
      expect(data).not.toHaveProperty('name');
      expect(JSON.stringify(data)).not.toContain('synthetic@example.invalid');
    } finally {
      await db.dispose();
      await rm(old, { recursive: true, force: true });
    }
  });
});
