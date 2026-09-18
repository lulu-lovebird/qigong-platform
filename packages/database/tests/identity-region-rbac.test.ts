import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from '../src/index.js';
import { runMigrations } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../migrations'
);

describeWithDatabase('identity, region, and RBAC constraints', () => {
  let pool: Pool;
  let dispose: () => Promise<void>;
  let globalRegionId: string;
  let countryRegionId: string;
  let operationalRegionId: string;

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase(databaseUrl!);
    pool = database.pool;
    dispose = () => database.dispose();
    await runMigrations(pool, migrationsDirectory, 'vitest');
    const global = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (code, region_type, name_zh_tw, name_en)
       VALUES ('global', 'global', '全球', 'Global') RETURNING id`
    );
    globalRegionId = global.rows[0]!.id;
    const country = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'tw', 'country', '台灣', 'Taiwan') RETURNING id`,
      [globalRegionId]
    );
    countryRegionId = country.rows[0]!.id;
    const operational = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'tw-taipei', 'operational', '台北', 'Taipei') RETURNING id`,
      [countryRegionId]
    );
    operationalRegionId = operational.rows[0]!.id;
  });

  afterAll(async () => dispose());

  it('enforces identity ownership, active identity, and non-overlapping primary channels', async () => {
    const people = await pool.query<{ id: string }>(
      `INSERT INTO identity.people (website_issuer, website_subject, legal_name)
       VALUES ('https://members.example.com', 'member-a', 'Member A'),
              ('https://members.example.com', 'member-b', 'Member B') RETURNING id`
    );
    const [personA, personB] = people.rows;
    const identity = await pool.query<{ id: string }>(
      `INSERT INTO identity.platform_identities (person_id, platform, external_subject_id)
       VALUES ($1, 'telegram', 'telegram-a') RETURNING id`,
      [personA!.id]
    );
    await expect(
      pool.query(
        `INSERT INTO identity.person_interaction_channels
           (person_id, platform_identity_id, activation_source)
         VALUES ($1, $2, 'onboarding')`,
        [personB!.id, identity.rows[0]!.id]
      )
    ).rejects.toThrow();
    await pool.query(
      `INSERT INTO identity.person_interaction_channels
         (person_id, platform_identity_id, activation_source)
       VALUES ($1, $2, 'onboarding')`,
      [personA!.id, identity.rows[0]!.id]
    );
    await expect(
      pool.query(
        `UPDATE identity.platform_identities SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [identity.rows[0]!.id]
      )
    ).rejects.toThrow('close the active interaction channel');
    await expect(
      pool.query(
        `INSERT INTO identity.person_interaction_channels
           (person_id, platform_identity_id, valid_from, activation_source)
         VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 hour', 'website_self_service')`,
        [personA!.id, identity.rows[0]!.id]
      )
    ).rejects.toThrow();
    await pool.query(
      `UPDATE identity.person_interaction_channels SET valid_to = CURRENT_TIMESTAMP
       WHERE person_id = $1`,
      [personA!.id]
    );
    await pool.query(
      `UPDATE identity.platform_identities SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [identity.rows[0]!.id]
    );
    await expect(
      pool.query(
        `INSERT INTO identity.person_interaction_channels
           (person_id, platform_identity_id, valid_from, activation_source)
         VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 second', 'recovery')`,
        [personA!.id, identity.rows[0]!.id]
      )
    ).rejects.toThrow('revoked identity');
  });

  it('enforces region hierarchy, operational assignment, and transfer ownership', async () => {
    await expect(
      pool.query(
        `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
         VALUES ($1, 'invalid-country', 'country', '錯誤國家', 'Invalid Country')`,
        [countryRegionId]
      )
    ).rejects.toThrow('country parent must be global');

    const people = await pool.query<{ id: string }>(
      `INSERT INTO identity.people (website_issuer, website_subject, legal_name)
       VALUES ('https://members.example.com', 'region-a', 'Region A'),
              ('https://members.example.com', 'region-b', 'Region B') RETURNING id`
    );
    await expect(
      pool.query(
        `INSERT INTO core.person_region_assignments
           (person_id, region_id, assignment_type, valid_from)
         VALUES ($1, $2, 'primary', DATE '2026-01-01')`,
        [people.rows[0]!.id, countryRegionId]
      )
    ).rejects.toThrow('active operational region');

    const secondOperational = await pool.query<{ id: string }>(
      `INSERT INTO core.regions (parent_region_id, code, region_type, name_zh_tw, name_en)
       VALUES ($1, 'tw-kaohsiung', 'operational', '高雄', 'Kaohsiung') RETURNING id`,
      [countryRegionId]
    );
    const transfer = await pool.query<{ id: string }>(
      `INSERT INTO core.region_transfer_requests
         (person_id, source_region_id, destination_region_id, effective_date)
       VALUES ($1, $2, $3, DATE '2026-07-01') RETURNING id`,
      [people.rows[0]!.id, operationalRegionId, secondOperational.rows[0]!.id]
    );
    await expect(
      pool.query(
        `INSERT INTO core.person_region_assignments
           (person_id, region_id, assignment_type, valid_from, transfer_request_id)
         VALUES ($1, $2, 'primary', DATE '2026-07-01', $3)`,
        [people.rows[1]!.id, secondOperational.rows[0]!.id, transfer.rows[0]!.id]
      )
    ).rejects.toThrow('accepted or overridden');
    await pool.query(
      `INSERT INTO core.person_region_assignments
         (person_id, region_id, assignment_type, valid_from, valid_to)
       VALUES ($1, $2, 'primary', DATE '2026-01-01', DATE '2026-07-01')`,
      [people.rows[0]!.id, operationalRegionId]
    );
    await pool.query(
      `UPDATE core.region_transfer_requests
       SET status = 'accepted', decided_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [transfer.rows[0]!.id]
    );
    await pool.query(
      `INSERT INTO core.person_region_assignments
         (person_id, region_id, assignment_type, valid_from, transfer_request_id)
       VALUES ($1, $2, 'primary', DATE '2026-07-01', $3)`,
      [people.rows[0]!.id, secondOperational.rows[0]!.id, transfer.rows[0]!.id]
    );
    await expect(
      pool.query(
        `UPDATE core.region_transfer_requests
         SET status = 'cancelled', decided_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [transfer.rows[0]!.id]
      )
    ).rejects.toThrow('must remain accepted or overridden');
    await expect(
      pool.query(
        `UPDATE core.person_region_assignments
         SET valid_to = DATE '2026-06-30'
         WHERE person_id = $1 AND region_id = $2`,
        [people.rows[0]!.id, operationalRegionId]
      )
    ).rejects.toThrow('cannot invalidate the source assignment');
  });

  it('seeds permission mappings and validates typed role scopes', async () => {
    const counts = await pool.query<{ roles: string; permissions: string; mappings: string }>(
      `SELECT (SELECT COUNT(*) FROM admin.roles)::text AS roles,
              (SELECT COUNT(*) FROM admin.permissions)::text AS permissions,
              (SELECT COUNT(*) FROM admin.role_permissions)::text AS mappings`
    );
    expect(Number(counts.rows[0]!.roles)).toBe(10);
    expect(Number(counts.rows[0]!.permissions)).toBe(23);
    expect(Number(counts.rows[0]!.mappings)).toBeGreaterThan(23);

    const principal = await pool.query<{ id: string }>(
      `INSERT INTO admin.principals (oidc_issuer, oidc_subject, display_name)
       VALUES ('https://members.example.com', 'admin-1', 'Admin') RETURNING id`
    );
    const role = await pool.query<{ id: string }>(
      `SELECT id FROM admin.roles WHERE code = 'regional_admin'`
    );
    await expect(
      pool.query(
        `INSERT INTO admin.role_grants (principal_id, role_id, scope_type, reason)
         VALUES ($1, $2, 'global', 'wrong scope for role')`,
        [principal.rows[0]!.id, role.rows[0]!.id]
      )
    ).rejects.toThrow('regional_admin requires region scope');
    await expect(
      pool.query(
        `INSERT INTO admin.role_grants (principal_id, role_id, scope_type, region_id, reason)
         VALUES ($1, $2, 'region', $3, 'country used as region')`,
        [principal.rows[0]!.id, role.rows[0]!.id, countryRegionId]
      )
    ).rejects.toThrow('active operational region');
    await pool.query(
      `INSERT INTO admin.role_grants (principal_id, role_id, scope_type, region_id, reason)
       VALUES ($1, $2, 'region', $3, 'approved regional administration')`,
      [principal.rows[0]!.id, role.rows[0]!.id, operationalRegionId]
    );
  });

  it('denies sensitive table access to a non-bypass runtime role without policies', async () => {
    const roleName = `qigong_runtime_${crypto.randomUUID().replaceAll('-', '')}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE ROLE ${roleName} NOLOGIN`);
      await client.query(`GRANT USAGE ON SCHEMA identity, core, admin, audit TO ${roleName}`);
      await client.query(
        `GRANT SELECT, INSERT, UPDATE ON identity.people, core.region_transfer_requests,
         admin.privacy_cases, audit.events, admin.principals, admin.roles, admin.permissions,
         admin.role_permissions, admin.role_grants TO ${roleName}`
      );
      await client.query(`SET ROLE ${roleName}`);
      const people = await client.query(`SELECT id FROM identity.people`);
      expect(people.rows).toEqual([]);
      await expect(
        client.query(
          `INSERT INTO identity.people (website_issuer, website_subject, legal_name)
           VALUES ('https://members.example.com', 'rls-denied', 'Denied')`
        )
      ).rejects.toThrow('row-level security policy');
    } finally {
      try {
        await client.query('RESET ROLE');
        await client.query(`DROP OWNED BY ${roleName}`);
        await client.query(`DROP ROLE IF EXISTS ${roleName}`);
      } finally {
        client.release();
      }
    }
  });
});
