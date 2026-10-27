/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { randomUUID } from 'node:crypto';
import type { Pool } from '@qigong/database';
import { describe, expect, it, vi } from 'vitest';
import { readVenueManagementRegions } from '../src/venue-admin-capabilities.js';

const session = 's'.repeat(43);
const id = '10000000-0000-4000-8000-000000000001';
const region = {
  id,
  displayName: '<Synthetic region>',
  countryName: 'Synthetic country',
  code: 'synthetic-one',
  canRead: true,
  canManage: false
};
const fixture = (principal: string | null = id, rows: unknown[] = [region]) => {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes('session_principal')
      ? [{ principal_id: principal }]
      : sql.includes('WITH eligible')
        ? rows
        : []
  }));
  const release = vi.fn();
  const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
  return { pool, query, release };
};
describe('private management region directory', () => {
  it('resolves session before querying names, sets transaction identity, uses action authorizers and server eligibility filter', async () => {
    const f = fixture();
    expect(await readVenueManagementRegions(f.pool, randomUUID(), session, 'zh_CN')).toEqual({
      regions: [region]
    });
    const sql = f.query.mock.calls.map(([sql]) => sql);
    expect(sql.indexOf('SELECT admin.session_principal($1) AS principal_id')).toBeLessThan(
      sql.findIndex((s) => s.includes('WITH eligible'))
    );
    const directory = sql.find((s) => s.includes('WITH eligible'))!;
    expect(directory).toContain('WHERE "canRead" OR "canManage"');
    expect(directory).toContain("country.active AND country.region_type='country'");
    expect(directory).toContain("global_region.active AND global_region.region_type='global'");
    expect(directory).toContain("region.active AND region.region_type='operational'");
    expect(directory).toContain("admin.venue_attendance_authorized($1,region.id,'field.write')");
    expect(directory).not.toMatch(/super_admin|master_admin|regional_admin/);
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining('WITH eligible'), [
      session,
      'zh_CN'
    ]);
    expect(f.release).toHaveBeenCalledOnce();
    expect(sql).toContain('COMMIT');
  });
  it('empty eligible directory is distinct from unavailable or unauthenticated', async () => {
    const f = fixture(id, []);
    expect(await readVenueManagementRegions(f.pool, randomUUID(), session, 'en')).toEqual({
      regions: []
    });
    const expired = fixture(null);
    await expect(
      readVenueManagementRegions(expired.pool, randomUUID(), session, 'en')
    ).rejects.toThrow('unauthenticated');
    expect(expired.query.mock.calls.some(([sql]) => sql.includes('WITH eligible'))).toBe(false);
    expect(expired.query).toHaveBeenCalledWith('ROLLBACK');
    await expect(
      readVenueManagementRegions(f.pool, randomUUID(), 'self-filled-uuid', 'en')
    ).rejects.toThrow('unauthenticated');
    const malformed = fixture(id, [{ ...region, canManage: 'yes' }]);
    await expect(
      readVenueManagementRegions(malformed.pool, randomUUID(), session, 'en')
    ).rejects.toThrow();
  });
});
