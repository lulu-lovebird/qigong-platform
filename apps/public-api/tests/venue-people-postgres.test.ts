/** Real PG17 only through venue-people-local-pg.sh; NEVER TEST_DATABASE_URL. */
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { withRequestContext } from '@qigong/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../packages/database/src/migrations.js';
import {
  createVenuePeopleService,
  venuePeopleMigrationVersion
} from '../src/venue-people-service.js';
import {
  encodeVenuePeopleCsv,
  parseVenuePeopleQuery,
  type VenuePeopleQuery
} from '../src/venue-people-helpers.js';

const directory = process.env.VENUE_PEOPLE_ISOLATED_PG_DIR;
const regionId = '01000000-0000-4000-8000-000000000003';
const otherRegion = '01000000-0000-4000-8000-000000000004';
const personId = '20000000-0000-4000-8000-000000000001';
const fieldId = '30000000-0000-4000-8000-000000000001';
const otherField = '30000000-0000-4000-8000-000000000003';
const viewer = 'v'.repeat(43),
  exporter = 'e'.repeat(43),
  mixed = 'm'.repeat(43);
const query = (patch: Partial<VenuePeopleQuery> = {}): VenuePeopleQuery => ({
  ...parseVenuePeopleQuery({
    mode: 'people',
    regionId,
    fieldId: null,
    personId: null,
    period: { month: '2026-10' },
    search: '',
    sort: 'recent',
    direction: 'desc',
    page: 1,
    limit: 20
  }),
  ...patch
});
let owner: Pool, runtime: Pool;
const read = (q = query(), exporting = false, token = exporting ? exporter : viewer) =>
  createVenuePeopleService(runtime).read(crypto.randomUUID(), token, q, exporting);
const direct = (
  patch: Partial<VenuePeopleQuery> = {},
  token = viewer,
  personContext?: string,
  principalId?: string
) => {
  const q = query(patch);
  return withRequestContext(
    runtime,
    'qigong_api_runtime',
    {
      requestId: crypto.randomUUID(),
      ...(personContext ? { personId: personContext } : {}),
      ...(principalId ? { principalId } : {})
    },
    (client) =>
      client.query(
        'SELECT admin.venue_people_read($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE) data',
        [
          token,
          q.regionId,
          q.from,
          q.until,
          q.fieldId,
          q.personId,
          q.search,
          q.mode,
          q.sort,
          q.direction,
          q.page,
          q.limit
        ]
      )
  );
};

describe.skipIf(!directory)('venue people: isolated PG17 base51 + standalone0054', () => {
  beforeAll(async () => {
    if (!directory || !/^\/tmp\/venue-people-pg\.[A-Za-z0-9]+$/.test(directory))
      throw new Error('isolated harness required');
    const actual = await realpath(directory);
    if (actual !== directory && actual !== '/private' + directory)
      throw new Error('unexpected cluster path');
    const info = await stat(directory);
    expect(info.mode & 0o077).toBe(0);
    expect(info.uid).toBe(process.getuid?.());
    expect(
      (await readFile(resolve(directory, 'isolated-venue-people-marker'), 'utf8')).trim()
    ).toBe(directory);
    const pid = (await readFile(resolve(directory, 'data/postmaster.pid'), 'utf8')).split('\n');
    expect([directory + '/data', actual + '/data']).toContain(pid[1]);
    expect(pid[3]).toBe('55483');
    expect([directory + '/socket', actual + '/socket']).toContain(pid[4]);
    const options = {
      host: directory + '/socket',
      port: 55483,
      database: 'postgres',
      ssl: false,
      max: 4
    };
    owner = new Pool({ ...options, user: 'venue_people_owner' });
    const settings = await owner.query(
      "SELECT current_setting('server_version_num')::int version,current_setting('listen_addresses') listeners"
    );
    expect(settings.rows[0].version).toBeGreaterThanOrEqual(170000);
    expect(settings.rows[0].version).toBeLessThan(180000);
    expect(settings.rows[0].listeners).toBe('');
    const pristine = await owner.query(
      "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p')"
    );
    expect(pristine.rowCount).toBe(0);
    const migrations = resolve(process.cwd(), '../../migrations');
    const files = (await readdir(migrations)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
    expect(files.filter((f) => Number(f.slice(0, 4)) <= 51)).toHaveLength(51);
    expect(files.filter((f) => Number(f.slice(0, 4)) > 51)).toEqual([venuePeopleMigrationVersion]);
    const result = await runMigrations(owner, migrations, 'synthetic-venue-people-only');
    expect(result.applied).toEqual(files);
    expect(result.currentVersion).toBe(venuePeopleMigrationVersion);
    expect((await runMigrations(owner, migrations)).applied).toEqual([]);
    expect((await owner.query('SELECT 1 FROM core.practice_fields')).rowCount).toBe(0);
    await owner.query(
      await readFile(new URL('./fixtures/venue-people-synthetic.sql', import.meta.url), 'utf8')
    );
    runtime = new Pool({ ...options, user: 'venue_people_test_login' });
  }, 120000);
  afterAll(async () => {
    await runtime?.end();
    await owner?.end();
  });

  it('uses isolated nonowner NOLOGIN NOBYPASSRLS role, FORCE and no memberships or runtime table grants', async () => {
    const roles = await owner.query(
      "SELECT rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname='qigong_venue_people_reader'"
    );
    expect(roles.rows).toEqual([{ rolsuper: false, rolbypassrls: false, rolcanlogin: false }]);
    expect(
      (
        await owner.query(
          "SELECT 1 FROM pg_auth_members WHERE roleid=(SELECT oid FROM pg_roles WHERE rolname='qigong_venue_people_reader') OR member=(SELECT oid FROM pg_roles WHERE rolname='qigong_venue_people_reader')"
        )
      ).rowCount
    ).toBe(0);
    const tables = await owner.query(
      "SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) owner FROM pg_class WHERE oid IN ('core.practice_fields'::regclass,'core.field_attendance'::regclass,'identity.people'::regclass)"
    );
    for (const table of tables.rows) {
      expect(table.relrowsecurity).toBe(true);
      expect(table.relforcerowsecurity).toBe(true);
      expect(table.owner).not.toBe('qigong_venue_people_reader');
    }
    await expect(
      withRequestContext(runtime, 'qigong_api_runtime', { requestId: crypto.randomUUID() }, (c) =>
        c.query('SELECT * FROM core.field_attendance')
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withRequestContext(runtime, 'qigong_api_runtime', { requestId: crypto.randomUUID() }, (c) =>
        c.query('SET LOCAL ROLE qigong_venue_people_reader')
      )
    ).rejects.toMatchObject({ code: '42501' });
    const acl = await owner.query(
      "SELECT has_function_privilege('qigong_worker_runtime','admin.venue_people_read(text,uuid,date,date,uuid,uuid,text,text,text,text,integer,integer,boolean)','EXECUTE') worker,has_function_privilege('venue_people_test_login','admin.venue_people_read(text,uuid,date,date,uuid,uuid,text,text,text,text,integer,integer,boolean)','EXECUTE') login"
    );
    expect(acl.rows[0]).toEqual({ worker: false, login: false });
  });
  it('view includes names without learner.read or k5; totals span all pages and exclude learner home/channel joins', async () => {
    const result = await read(query({ limit: 1, sort: 'count' }));
    expect(result.total).toBe(3);
    expect(result.totals).toEqual({ attendanceCount: 5, attendanceDays: 4, learnerCount: 3 });
    expect(result.rows).toEqual([
      {
        personId,
        name: '=SYNTHETIC()',
        attendanceCount: 3,
        attendanceDays: 2,
        latestDate: '2026-10-02'
      }
    ]);
    const page2 = await read(query({ page: 2, limit: 1, sort: 'count' }));
    expect(page2.total).toBe(3);
    expect(page2.rows).toHaveLength(1);
    expect(page2.rows[0]?.personId).not.toBe(personId);
    expect((await read(query({ page: 4, limit: 1 }))).rows).toEqual([]);
  });
  it('supports stable ordering, literal name search, venue/month/date filters and half-open local day', async () => {
    const asc = await read(query({ sort: 'name', direction: 'asc' }));
    expect(asc.rows.map((r) => r.name)).toEqual(['=SYNTHETIC()', 'Beta', 'Gamma']);
    expect((await read(query({ sort: 'recent' }))).rows.map((r) => r.name)).toEqual([
      'Gamma',
      'Beta',
      '=SYNTHETIC()'
    ]);
    const filtered = await read(query({ fieldId, search: 'synthetic' }));
    expect(filtered.totals).toEqual({ attendanceCount: 2, attendanceDays: 2, learnerCount: 1 });
    expect((await read(query({ search: "%' OR true --" }))).total).toBe(0);
    expect((await read(query({ from: '2026-10-01', until: '2026-10-02' }))).totals).toEqual({
      attendanceCount: 2,
      attendanceDays: 1,
      learnerCount: 1
    });
    expect(
      (await read(query({ from: '2026-09-01', until: '2026-10-01' }))).totals.attendanceCount
    ).toBe(1);
  });
  it('same-person detail returns authorized venue subset only; no identity channel, contacts, GPS or notes', async () => {
    const result = await read(query({ mode: 'detail', personId }));
    expect(result.total).toBe(3);
    if (result.mode !== 'detail') throw new Error('wrong mode');
    expect(new Set(result.rows.map((r) => r.fieldId))).toEqual(
      new Set([fieldId, '30000000-0000-4000-8000-000000000002'])
    );
    expect(result.rows.every((r) => r.timezone === 'Asia/Taipei')).toBe(true);
    expect(result.rows.some((r) => r.checkedInAt === '2026-09-30T16:00:00.000000Z')).toBe(true);
    expect(
      result.rows.every(
        (r) =>
          !('channel' in r) && !('distanceMeters' in r) && !('phone' in r) && !('studentNote' in r)
      )
    ).toBe(true);
    expect((await read(query({ mode: 'detail', personId, fieldId }))).total).toBe(2);
    expect(
      (await read(query({ mode: 'detail', personId: '20000000-0000-4000-8000-000000000099' })))
        .total
    ).toBe(0);
  });
  it('separates view and export permissions and their region scopes in both directions', async () => {
    await expect(read(query(), true, viewer)).rejects.toMatchObject({ code: '42501' });
    await expect(read(query(), false, exporter)).rejects.toMatchObject({ code: '42501' });
    expect((await read(query(), true, exporter)).total).toBe(3);
    expect((await read(query(), false, mixed)).total).toBe(3);
    await expect(read(query(), true, mixed)).rejects.toMatchObject({ code: '42501' });
    await expect(read(query({ regionId: otherRegion }), false, mixed)).rejects.toMatchObject({
      code: '42501'
    });
    expect((await read(query({ regionId: otherRegion }), true, mixed)).total).toBe(1);
    await expect(read(query({ regionId: otherRegion }))).rejects.toMatchObject({ code: '42501' });
    await expect(read(query({ fieldId: otherField }))).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects forged/absent sessions, person context, conflicting principal and illegal SQL selectors', async () => {
    await expect(
      direct({}, 'forged', undefined, '10000000-0000-4000-8000-000000000001')
    ).rejects.toMatchObject({ code: '28000' });
    await expect(direct({}, viewer, personId)).rejects.toMatchObject({ code: '42501' });
    await expect(
      direct({}, viewer, undefined, '10000000-0000-4000-8000-000000000002')
    ).rejects.toMatchObject({ code: '42501' });
    for (const patch of [
      { page: 0 },
      { until: '2028-01-01' },
      { search: '\nx' },
      { from: 'infinity' },
      { personId }
    ])
      await expect(direct(patch)).rejects.toMatchObject({ code: '22023' });
  });
  it('revalidates revoked permission/session every call instead of trusting a cached principal', async () => {
    await owner.query(
      "UPDATE admin.role_grants SET valid_to=clock_timestamp() WHERE principal_id='10000000-0000-4000-8000-000000000001'"
    );
    try {
      await expect(read()).rejects.toMatchObject({ code: '28000' });
    } finally {
      await owner.query(
        "UPDATE admin.role_grants SET valid_to=NULL WHERE principal_id='10000000-0000-4000-8000-000000000001'"
      );
    }
    await owner.query(
      "DELETE FROM admin.role_permissions WHERE role_id=(SELECT id FROM admin.roles WHERE code='vp_view')"
    );
    try {
      await expect(read()).rejects.toMatchObject({ code: '42501' });
    } finally {
      await owner.query(
        "INSERT INTO admin.role_permissions SELECT r.id,p.id FROM admin.roles r CROSS JOIN admin.permissions p WHERE r.code='vp_view' AND p.code='checkin.read'"
      );
    }
    await owner.query(
      "UPDATE admin.sessions SET revoked_at=clock_timestamp() WHERE token_hash=public.digest(repeat('v',43),'sha256')"
    );
    try {
      await expect(read()).rejects.toMatchObject({ code: '28000' });
    } finally {
      await owner.query('UPDATE admin.sessions SET revoked_at=NULL');
    }
  });
  it('CSV ignores pagination, guards formula names, and audit contains only counts/mode/region', async () => {
    const result = await read(query({ page: 9999, limit: 1 }), true);
    expect(result.rows).toHaveLength(3);
    expect(encodeVenuePeopleCsv(result)).toContain("'=SYNTHETIC()");
    const audit = await owner.query<{
      metadata: Record<string, unknown>;
      target_id: string | null;
      before_data: unknown;
      after_data: unknown;
    }>(
      "SELECT metadata,target_id,before_data,after_data FROM audit.events WHERE action IN ('venue.people_read','venue.people_export')"
    );
    expect(audit.rowCount).toBeGreaterThan(0);
    for (const row of audit.rows) {
      expect(Object.keys(row.metadata).sort()).toEqual(['mode', 'rowCount']);
      expect(row.target_id).toBeNull();
      expect(row.before_data).toBeNull();
      expect(row.after_data).toBeNull();
    }
  });
  it('exports exactly 1000 but refuses 1001 explicitly, no silently truncated success', async () => {
    await owner.query(
      "INSERT INTO identity.people(id,preferred_name) SELECT ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic bulk '||n FROM generate_series(1,998) n"
    );
    await owner.query(
      "INSERT INTO core.field_attendance(person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone) SELECT id,$1,'qr_gps','2026-10-10T00:00:00Z','2026-10-10','Asia/Taipei' FROM identity.people WHERE preferred_name LIKE 'Synthetic bulk %'",
      [fieldId]
    );
    try {
      const hundred = await read(query({ search: 'Synthetic bulk' }), true);
      expect(hundred.total).toBe(998);
      // Three original learners plus 997 bulk learners => exactly 1000.
      await owner.query(
        "DELETE FROM core.field_attendance WHERE person_id='40000000-0000-4000-8000-000000000998'"
      );
      expect((await read(query(), true)).total).toBe(1000);
      await owner.query(
        "INSERT INTO core.field_attendance(person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone) VALUES ('40000000-0000-4000-8000-000000000998',$1,'qr_gps','2026-10-10T00:00:00Z','2026-10-10','Asia/Taipei')",
        [fieldId]
      );
      await expect(read(query(), true)).rejects.toMatchObject({ code: '54000' });
      expect((await read()).total).toBe(1001);
    } finally {
      await owner.query(
        "DELETE FROM core.field_attendance WHERE person_id IN (SELECT id FROM identity.people WHERE preferred_name LIKE 'Synthetic bulk %'); DELETE FROM identity.people WHERE preferred_name LIKE 'Synthetic bulk %'"
      );
    }
  });
});
