import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../../migrations/0050_venue_qr_attendance.sql', import.meta.url),
  'utf8'
);
describe('0050 QR forward SQL shape (not PostgreSQL execution)', () => {
  it('refuses legacy data and replaces only the quarantined policies', () => {
    expect(sql).toContain('0050 requires empty attendance');
    expect(sql).toContain('DROP POLICY practice_fields_security_quarantine');
    expect(sql).toContain('DROP POLICY field_attendance_security_quarantine');
    expect(sql).not.toMatch(/DISABLE ROW LEVEL|NO FORCE|BYPASSRLS;/);
    expect(sql).toContain('NOBYPASSRLS');
    expect(sql).not.toMatch(/OWNER TO qigong_(?:api|worker)|GRANT .+ TO qigong_api_runtime;/);
  });
  it('uses minimal nonmember function roles, existing view/export scope and audit', () => {
    expect(sql).toContain('NOLOGIN NOINHERIT NOSUPERUSER');
    expect(sql).toContain('admin.session_principal(input_session)');
    expect(sql).toContain("THEN 'stats.export' ELSE 'checkin.read'");
    expect(sql).not.toContain('person_region_assignments');
    expect(sql).not.toMatch(/venue_attendance\.attendance|name\.read|BYPASSRLS\s*;/);
    expect(sql).toContain("'venue.attendance_export'");
    expect(sql).toContain('aclexplode(p.proacl)');
    expect(sql).toContain('SET row_security = on');
    expect(sql).toContain('i.verified_at<=clock_timestamp()');
    expect(sql).toContain('c.valid_to>clock_timestamp()');
    expect(sql).toContain('AS RESTRICTIVE FOR UPDATE TO PUBLIC USING(FALSE)');
    expect(sql).toContain('AS RESTRICTIVE FOR DELETE TO PUBLIC USING(FALSE)');
    expect(sql).toContain('immutable after first attendance');
    expect(sql).toContain(
      "jsonb_typeof(NEW.active_time_rules->'start_time') IS DISTINCT FROM 'string'"
    );
    expect(sql).toContain(
      "jsonb_typeof(NEW.active_time_rules->'end_time') IS DISTINCT FROM 'string'"
    );
  });
  it('writes only independent local-date attendance without raw GPS', () => {
    expect(sql).toContain('ON core.field_attendance(person_id, field_id, attendance_date)');
    expect(sql).toContain('at_time AT TIME ZONE venue.timezone');
    expect(sql).toContain('platform.resolve_line_learner_identity(input_subject)');
    expect(sql).toContain("platform.privacy_usage('line',input_subject)");
    expect(sql).toContain('venue_outside_window');
    expect(sql).toContain('venue_outside_radius');
    expect(sql).toContain('ON CONFLICT(person_id,field_id,attendance_date) DO NOTHING');
    expect(sql).not.toMatch(/INSERT INTO core\.checkins|UPDATE core\.checkins/);
    const insert = sql.match(/INSERT INTO core\.field_attendance\(([^)]+)\)/)?.[1];
    expect(insert).not.toMatch(/user_latitude|user_longitude|checkin_id|student_note/);
    expect(sql).toContain('user_latitude IS NULL AND user_longitude IS NULL');
  });
});
