import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const directory = new URL('../../../migrations/', import.meta.url);
const venueFiles = [
  '0048_practice_fields_and_nfc_attendance.sql',
  '0049_nfc_attendance_security_quarantine.sql',
  '0050_venue_attendance_security_contract.sql',
  '0051_venue_qr_attendance.sql'
];

describe('unpublished venue renumber integration (static, not deployment evidence)', () => {
  it('keeps one artifact per number, including the published invitation migration', () => {
    const files = readdirSync(directory).filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file));
    expect(files).toHaveLength(57);
    expect(new Set(files.map((file) => file.slice(0, 4))).size).toBe(files.length);
    expect(files.sort().slice(46, 51)).toEqual(['0047_channel_invitations.sql', ...venueFiles]);
    expect(files.slice(51)).toEqual([
      '0052_venue_personal_history.sql',
      '0053_venue_management.sql',
      '0054_venue_people_read.sql',
      '0055_venue_distance_debug.sql',
      '0056_venue_cks_distance_debug.sql',
      '0057_venue_test_scope.sql'
    ]);
  });

  it('preserves the published invitation SQL checksum from origin/main@156d7dc', () => {
    expect(
      createHash('sha256')
        .update(readFileSync(new URL('0047_channel_invitations.sql', directory)))
        .digest('hex')
    ).toBe('8afe46a82202557afcd58182a2c213b0ffc91720837ef5d1c28c49603ebf6a13');
  });

  it('does not retain obsolete venue filenames alongside their replacements', () => {
    for (const file of venueFiles) {
      const original = `${String(Number(file.slice(0, 4)) - 1).padStart(4, '0')}${file.slice(4)}`;
      expect(existsSync(new URL(original, directory))).toBe(false);
    }
  });
});
