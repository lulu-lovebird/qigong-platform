import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static contracts only: no pool, environment loading, migration execution or network.
// These checks intentionally do NOT claim to prove PostgreSQL authorization behavior.
const migration = readFileSync(
  new URL('../../../migrations/0049_nfc_attendance_security_quarantine.sql', import.meta.url),
  'utf8'
);
const normalize = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const tables = ['practice_fields', 'field_attendance'] as const;

const assertQuarantine = (source: string) => {
  const sql = normalize(source);
  assert.ok(sql.startsWith('SET LOCAL search_path = pg_catalog;'));
  for (const table of tables) {
    assert.ok(sql.includes(`ALTER TABLE core.${table} ENABLE ROW LEVEL SECURITY;`));
    assert.ok(sql.includes(`ALTER TABLE core.${table} FORCE ROW LEVEL SECURITY;`));
    assert.ok(
      sql.includes(
        `CREATE POLICY ${table}_security_quarantine ON core.${table} AS RESTRICTIVE FOR ALL TO PUBLIC USING (FALSE) WITH CHECK (FALSE);`
      )
    );
  }
  assert.equal((sql.match(/CREATE POLICY/g) ?? []).length, 2);
  assert.ok(
    sql.includes(
      'REVOKE ALL PRIVILEGES ON TABLE core.practice_fields, core.field_attendance FROM PUBLIC, qigong_api_runtime, qigong_worker_runtime, qigong_authorizer CASCADE;'
    )
  );
  assert.ok(sql.includes("WHERE namespace.nspname = 'core'"));
  assert.ok(sql.includes("AND relation.relname IN ('practice_fields', 'field_attendance')"));
  assert.ok(sql.includes('role.oid = target.relowner'));
  assert.ok(
    sql.includes(
      "role.rolname IN ('qigong_api_runtime', 'qigong_worker_runtime', 'qigong_authorizer')"
    )
  );
  assert.ok(
    sql.includes("RAISE EXCEPTION 'NFC tables must not be owned by controlled runtime roles'")
  );
  assert.ok(sql.includes('pg_catalog.aclexplode(relation.relacl)'));
  assert.ok(sql.includes('pg_catalog.aclexplode(attribute.attacl)'));
  assert.ok(sql.includes('acl.grantee <> target.relowner'));
  assert.ok(sql.includes('attribute.attnum > 0 AND NOT attribute.attisdropped'));
  assert.ok(sql.includes("'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM %I CASCADE'"));
  assert.ok(sql.includes("'REVOKE ALL PRIVILEGES (%I) ON TABLE %I.%I FROM %s CASCADE'"));
  assert.ok(sql.includes("CASE WHEN privilege_grant.grantee = 0 THEN 'PUBLIC'"));
  assert.ok(sql.includes('pg_catalog.quote_ident(privilege_grant.rolname)'));
  assert.doesNotMatch(
    sql,
    /\b(GRANT|SECURITY DEFINER|CREATE FUNCTION|CREATE PROCEDURE|SET ROLE|OWNER TO|DISABLE ROW LEVEL SECURITY|NO FORCE ROW LEVEL SECURITY|INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\b/i
  );
  // A forged request GUC, self/volunteer ID, region grant or checkin link cannot
  // become an exception to quarantine. Fine-grained positive access is deferred.
  assert.doesNotMatch(sql, /current_setting|set_config|request_person_id|request_principal_id/i);
  assert.doesNotMatch(
    sql,
    /admin\.can_access|admin\.has_permission|core\.checkins|identity\.people/i
  );
};

describe('NFC security quarantine static contract (not a database authorization test)', () => {
  it('denies every read and write regardless of identity, region or linked checkin', () => {
    assertQuarantine(migration);
  });

  it('keeps the renumbered baseline SQL byte-identical', () => {
    const baseline = readFileSync(
      new URL('../../../migrations/0048_practice_fields_and_nfc_attendance.sql', import.meta.url)
    );
    expect(createHash('sha256').update(baseline).digest('hex')).toBe(
      'dc76f54c1815dd0fce115c0bf8f9ab2126ca18044cc35a26d237a1afee2974b4'
    );
  });

  it('leaves the NFC opt-in gate and 0048 baseline-version deployment interlock unchanged', () => {
    const source = readFileSync(
      new URL('../../../apps/public-api/src/admin-auth.ts', import.meta.url),
      'utf8'
    );
    expect(source).toContain("process.env.NFC_FIELD_CHECKIN_ENABLED === 'true'");
    expect(source).toContain('if (!isNfcEnabled()) return;');
    expect(source).toContain(
      "export const nfcMigrationVersion = '0048_practice_fields_and_nfc_attendance.sql';"
    );
  });

  it.each(tables)('detects loss of FORCE RLS on %s (ordinary owner protection)', (table) => {
    expect(() =>
      assertQuarantine(migration.replace(`ALTER TABLE core.${table} FORCE ROW LEVEL SECURITY;`, ''))
    ).toThrow();
  });

  it.each(tables)('detects loss of ENABLE RLS on %s', (table) => {
    expect(() =>
      assertQuarantine(
        migration.replace(`ALTER TABLE core.${table} ENABLE ROW LEVEL SECURITY;`, '')
      )
    ).toThrow();
  });

  it.each([
    ['forged self identity', 'person_id = admin.request_person_id()'],
    ['forged volunteer identity', 'volunteer_person_id = admin.request_person_id()'],
    [
      'region-based exception before scoped operations exist',
      "admin.can_access_region(region_id, 'checkin.read')"
    ],
    ['unverified checkin ownership', 'checkin_id IS NOT NULL']
  ])('detects a quarantine exception for %s', (_name, predicate) => {
    expect(() =>
      assertQuarantine(migration.replace('USING (FALSE)', `USING (${predicate})`))
    ).toThrow();
  });

  it.each([
    ['runtime table grant', 'GRANT SELECT ON core.field_attendance TO qigong_api_runtime;'],
    ['session column grant', 'GRANT SELECT (person_id) ON core.field_attendance TO session_login;'],
    ['owner bypass', 'ALTER TABLE core.field_attendance NO FORCE ROW LEVEL SECURITY;'],
    [
      'unreviewed definer',
      'CREATE FUNCTION core.unsafe() RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL $$;'
    ],
    ['daily-practice mutation', 'UPDATE core.checkins SET person_id = NULL;']
  ])('detects an appended %s', (_name, addition) => {
    expect(() => assertQuarantine(migration + '\n' + addition)).toThrow();
  });

  it.each(['relation.relacl', 'attribute.attacl'])('detects missing %s cleanup', (acl) => {
    expect(() =>
      assertQuarantine(migration.replace(`pg_catalog.aclexplode(${acl})`, 'NULL'))
    ).toThrow();
  });

  it('detects removal of the runtime-owner rejection', () => {
    expect(() =>
      assertQuarantine(
        migration.replace(
          "RAISE EXCEPTION 'NFC tables must not be owned by controlled runtime roles'",
          'NULL'
        )
      )
    ).toThrow();
  });
});
