import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '../src/index.js';
import { getMigrationStatus, runMigrations, withRequestContext } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);

describeWithDatabase('repository migrations', () => {
  let pool: Pool;
  let dispose: () => Promise<void>;

  // Controlled roles are cluster-wide; dispose each migrated DB before replaying the chain.
  beforeEach(async () => {
    const database = await createIsolatedTestDatabase(databaseUrl!);
    pool = database.pool;
    dispose = () => database.dispose();
  });

  afterEach(async () => {
    await dispose();
  });

  it('applies the checked-in chain idempotently and satisfies readiness', async () => {
    const first = await runMigrations(pool, migrationsDirectory, 'vitest');
    const second = await runMigrations(pool, migrationsDirectory, 'vitest');
    const status = await getMigrationStatus(
      pool,
      '0001_platform_baseline.sql',
      '0019_admin_access_approval.sql'
    );

    expect(first.applied).toEqual([
      '0001_platform_baseline.sql',
      '0002_identity_region_rbac.sql',
      '0003_runtime_roles_and_rls.sql',
      '0004_messaging_onboarding.sql',
      '0005_admin_sessions.sql',
      '0006_runtime_migration_visibility.sql',
      '0007_telegram_onboarding.sql',
      '0008_verified_onboarding_details.sql',
      '0009_onboarding_notifications.sql',
      '0010_telegram_checkins.sql',
      '0011_telegram_checkin_history.sql',
      '0012_telegram_method_hierarchy.sql',
      '0013_line_onboarding.sql',
      '0014_no_implicit_identity_linking.sql',
      '0015_channel_locales.sql',
      '0016_whatsapp_onboarding.sql',
      '0017_admin_reporting.sql',
      '0018_private_practice_notes_and_tags.sql',
      '0019_admin_access_approval.sql'
    ]);
    expect(second.applied).toEqual([]);
    expect(status).toEqual({
      currentVersion: '0019_admin_access_approval.sql',
      minimumVersion: '0001_platform_baseline.sql',
      maximumVersion: '0019_admin_access_approval.sql',
      ready: true
    });
  });

  it('upgrades 0013 to policy A without splitting existing linked people or rewriting history', async () => {
    const database = await createIsolatedTestDatabase(databaseUrl!);
    const legacyDirectory = await mkdtemp(path.join(tmpdir(), 'qigong-legacy-migrations-'));
    try {
      const files = (await readdir(migrationsDirectory)).filter(
        (file) => /^\d{4}_.+\.sql$/.test(file) && file < '0014_'
      );
      await Promise.all(
        files.map((file) =>
          copyFile(path.join(migrationsDirectory, file), path.join(legacyDirectory, file))
        )
      );
      await runMigrations(database.pool, legacyDirectory, 'vitest-legacy');
      const oldStatus = await getMigrationStatus(
        database.pool,
        '0014_no_implicit_identity_linking.sql',
        '0014_no_implicit_identity_linking.sql'
      );
      expect(oldStatus).toMatchObject({ currentVersion: '0013_line_onboarding.sql', ready: false });
      const region = await database.pool.query<{ id: string }>(
        `WITH global AS (INSERT INTO core.regions (code,region_type,name_zh_tw,name_en) VALUES ('upgrade-global','global','全球','Global') RETURNING id),
         country AS (INSERT INTO core.regions (parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'upgrade-country','country','台灣','Taiwan' FROM global RETURNING id)
         INSERT INTO core.regions (parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'upgrade-region','operational','地區','Region' FROM country RETURNING id`
      );
      const principal = await database.pool.query<{ id: string }>(
        `INSERT INTO admin.principals (oidc_issuer,oidc_subject,display_name) VALUES ('https://admin.example.com','upgrade-admin','Upgrade Admin') RETURNING id`
      );
      const principalId = principal.rows[0]!.id;
      await database.pool.query(
        `INSERT INTO admin.role_grants (principal_id,role_id,scope_type,region_id,reason) SELECT $1,id,'region',$2,'upgrade test' FROM admin.roles WHERE code='regional_admin'`,
        [principalId, region.rows[0]!.id]
      );
      const application = async (platform: 'telegram' | 'line', subject: string) => {
        const result = await database.pool.query<{ id: string }>(
          `INSERT INTO identity.onboarding_applications (platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164)
           VALUES ($1,$2,'Upgrade Learner',$3,'Upgrade Learner','upgrade@example.com','+886912345699') RETURNING id`,
          [platform, subject, region.rows[0]!.id]
        );
        return result.rows[0]!.id;
      };
      const approve = async (id: string) => {
        const result = await withRequestContext(
          database.pool,
          'qigong_api_runtime',
          { requestId: randomUUID(), principalId },
          (client) =>
            client.query<{ person_id: string }>(
              'SELECT identity.decide_application($1,$2,$3) AS person_id',
              [id, 'approved', null]
            )
        );
        return result.rows[0]!.person_id;
      };
      const telegram = await application('telegram', 'legacy-telegram');
      const line = await application('line', 'U' + '1'.repeat(32));
      const originalPerson = await approve(telegram);
      expect(await approve(line)).toBe(originalPerson);
      const before = await database.pool.query(
        'SELECT version,checksum FROM schema_migrations ORDER BY version'
      );
      const identitiesBefore = await database.pool.query(
        'SELECT * FROM identity.platform_identities ORDER BY id'
      );
      const channelsBefore = await database.pool.query(
        'SELECT * FROM identity.person_interaction_channels ORDER BY id'
      );
      const result = await runMigrations(database.pool, migrationsDirectory, 'vitest-policy-a');
      expect(result.applied).toEqual([
        '0014_no_implicit_identity_linking.sql',
        '0015_channel_locales.sql',
        '0016_whatsapp_onboarding.sql',
        '0017_admin_reporting.sql',
        '0018_private_practice_notes_and_tags.sql',
        '0019_admin_access_approval.sql'
      ]);
      expect(
        (
          await database.pool.query(
            'SELECT version,checksum FROM schema_migrations WHERE version<$1 ORDER BY version',
            ['0014_']
          )
        ).rows
      ).toEqual(before.rows);
      expect(
        (await database.pool.query('SELECT * FROM identity.platform_identities ORDER BY id')).rows
      ).toEqual(identitiesBefore.rows);
      expect(
        (
          await database.pool.query(
            'SELECT * FROM identity.person_interaction_channels ORDER BY id'
          )
        ).rows
      ).toEqual(channelsBefore.rows);
      expect(
        (
          await database.pool.query<{ person_id: string }>(
            'SELECT person_id FROM identity.onboarding_applications WHERE id=ANY($1::uuid[])',
            [[telegram, line]]
          )
        ).rows
      ).toEqual([{ person_id: originalPerson }, { person_id: originalPerson }]);
      const freshLine = await application('line', 'U' + '2'.repeat(32));
      expect(await approve(freshLine)).not.toBe(originalPerson);
      expect(
        (
          await getMigrationStatus(
            database.pool,
            '0019_admin_access_approval.sql',
            '0019_admin_access_approval.sql'
          )
        ).ready
      ).toBe(true);
    } finally {
      await database.dispose();
      await rm(legacyDirectory, { recursive: true, force: true });
    }
  });
});
