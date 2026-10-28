/** Static contract only; real SQL execution is covered by the isolated PG suite.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = (name: string) =>
  readFileSync(new URL('../../../migrations/' + name, import.meta.url), 'utf8');
const sql = migration('0057_venue_test_scope.sql');
const ddl = (source: string, name: string) => {
  const match = source.match(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION platform\\.${name}\\([\\s\\S]*?END \\$\\$;`)
  );
  if (!match) throw new Error('missing fixed DDL: ' + name);
  return match[0];
};
describe('0057 precise forward SQL delta (not deployment evidence)', () => {
  it('changes normal entry only by rejecting the public test code before validation, writing or replay', () => {
    const old = ddl(migration('0055_venue_distance_debug.sql'), 'venue_qr_checkin');
    const denial = `  -- Public test-site code is not a credential. Never write OR replay formal attendance.
  IF input_code='tw-location-test' THEN
    RAISE EXCEPTION 'venue_test_code_required' USING ERRCODE='42501';
  END IF;
`;
    expect(ddl(sql, 'venue_qr_checkin')).toBe(old.replace('BEGIN\n', 'BEGIN\n' + denial));
  });
  it('changes debug entry only by admitting the two exact codes, preserving independent configured equality and proof', () => {
    const old = ddl(migration('0056_venue_cks_distance_debug.sql'), 'venue_debug_checkin');
    expect(ddl(sql, 'venue_debug_checkin')).toBe(
      old
        .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
        .replace(
          "input_code IS DISTINCT FROM 'tw-taipei-cks'",
          "input_code NOT IN ('tw-location-test','tw-taipei-cks')"
        )
    );
    expect(sql).toContain('c.venue_code=input_code');
    expect(sql).toContain('input_expires_ms=(extract(epoch FROM c.expires_at)*1000)::bigint');
  });
  it('revokes existing configuration without provisioning or changing history/data/normal insert authority', () => {
    expect(sql).toContain('DELETE FROM platform.venue_debug_config;');
    expect(sql).toContain("CHECK(venue_code IN ('tw-location-test','tw-taipei-cks'))");
    expect(sql).toContain('JOIN platform.venue_debug_config c ON c.venue_code=f.code');
    expect(sql).toContain('ALTER POLICY venue_debug_insert ON core.field_attendance');
    expect(sql).not.toMatch(
      /INSERT INTO platform\.venue_debug_config|UPDATE core\.|DELETE FROM (?:core\.|audit\.)|CREATE ROLE|ALTER ROLE|ALTER POLICY venue_qr|DISABLE ROW LEVEL|NO FORCE|GRANT INSERT|EXECUTE format/
    );
    expect(sql).not.toMatch(/venue_debug_fields|venue_formal_only|venue_debug_insert_only/);
  });
});
