/** Static delta only; isolated PG17 proves execution.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const migration = (name: string) =>
  readFileSync(new URL('../../../migrations/' + name, import.meta.url), 'utf8');
const old = migration('0057_venue_test_scope.sql');
const sql = migration('0058_venue_early_checkin_window.sql');
const gate = `IF NOT (venue.active_time_rules->'day_of_week' @> pg_catalog.jsonb_build_array(EXTRACT(DOW FROM local_time)::int))
      OR local_time::time < (venue.active_time_rules->>'start_time')::time
      OR local_time::time >= (venue.active_time_rules->>'end_time')::time THEN`;
const tail = (source: string) =>
  source.slice(source.indexOf('CREATE OR REPLACE FUNCTION platform.venue_qr_checkin'));
describe('schema58 bounded change', () => {
  it('changes both complete entry DDLs only at the shared fail-closed time gate', () => {
    expect(tail(old).split(gate)).toHaveLength(3);
    expect(tail(sql)).toBe(
      tail(old)
        .split(gate)
        .join(
          'IF platform.venue_checkin_window(venue.active_time_rules,venue.timezone,at_time) IS DISTINCT FROM TRUE THEN'
        )
    );
  });
  it('revokes configuration, creates no authority or schedule mutation, keeps helper invoker-only', () => {
    const helper = sql.slice(0, sql.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(helper).toContain('DELETE FROM platform.venue_debug_config;');
    expect(helper).toContain('STABLE SECURITY INVOKER');
    expect(helper).toContain('SET search_path = pg_catalog');
    expect(helper).toContain("session_start - INTERVAL '30 minutes'");
    expect(helper).toContain('TO qigong_venue_qr_writer,qigong_venue_debug;');
    expect(helper).toContain('aclexplode(p.proacl)');
    expect(helper).not.toMatch(
      /SECURITY DEFINER|CREATE ROLE|ALTER ROLE|ALTER POLICY|UPDATE core\.|INSERT INTO|GRANT SELECT|ALTER DEFAULT PRIVILEGES/
    );
  });
});
