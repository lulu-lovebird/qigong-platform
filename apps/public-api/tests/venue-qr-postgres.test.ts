/** Real PostgreSQL tests ONLY via scripts/test-venue-qr-local-pg.sh. Never TEST_DATABASE_URL. */
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withRequestContext } from '@qigong/database';
import { runMigrations } from '../../../packages/database/src/migrations.js';
import { buildApp } from '../src/app.js';
import { venueQrMigrationVersion } from '../src/venue-qr.js';

const directory = process.env.VENUE_QR_ISOLATED_PG_DIR;
const subject = 'U' + 'a'.repeat(32),
  personId = '20000000-0000-4000-8000-000000000001';
const origin = 'https://synthetic.invalid';
const requestId = () => crypto.randomUUID();
let owner: Pool;
let runtime: Pool;
let regionId: string;
let otherRegionId: string;
const applications: ReturnType<typeof buildApp>[] = [];
const makeApp = () => {
  const app = buildApp({
    pool: runtime,
    logger: false,
    venueQr: { enabled: true, publicOrigin: origin },
    line: {
      channelSecret: 'synthetic-secret',
      channelAccessToken: 'synthetic-access-token',
      loginChannelId: '123',
      liffId: '123-synthetic',
      verifyIdentity: async (token) => {
        if (token !== 'synthetic-token') throw new Error('invalid mock LINE token');
        return { subject };
      }
    },
    adminAuth: {
      callbackUrl: origin + '/admin/auth/callback',
      begin: async () => new URL(origin),
      complete: async () => ({ iss: origin, sub: 'viewer' })
    }
  });
  applications.push(app);
  return app;
};
const checkin = (
  app: ReturnType<typeof buildApp>,
  venue = 'tw-test-one',
  latitude = 25,
  longitude = 121
) =>
  app.inject({
    method: 'POST',
    url: '/api/line/venue-checkin',
    headers: { origin, 'x-venue-checkin': '1' },
    payload: { idToken: 'synthetic-token', venue, latitude, longitude }
  });
const report = (
  app: ReturnType<typeof buildApp>,
  exporting = false,
  token = 'v'.repeat(43),
  region = regionId
) =>
  app.inject({
    method: 'POST',
    url: '/admin/venue-qr/api/' + (exporting ? 'export' : 'read'),
    headers: {
      origin,
      cookie: '__Host-qigong-admin=' + token + '; __Host-qigong-admin-csrf=' + 'c'.repeat(43),
      'x-csrf-token': 'c'.repeat(43)
    },
    payload: {
      operation: exporting ? 'attendance.export' : 'attendance.read',
      regionId: region,
      from: '2000-01-01',
      until: '2000-01-02',
      filters: { fieldId: null, method: null },
      ...(exporting ? {} : { page: 1, limit: 100 })
    }
  });
// Actual reports below use a bounded window around server date, never a client check-in date.
const currentReport = async (
  app: ReturnType<typeof buildApp>,
  exporting = false,
  token = 'v'.repeat(43),
  region = regionId
) => {
  const { rows } = await owner.query<{ from: string; until: string }>(
    'SELECT (CURRENT_DATE-2)::text AS from,(CURRENT_DATE+3)::text AS until'
  );
  return app.inject({
    method: 'POST',
    url: '/admin/venue-qr/api/' + (exporting ? 'export' : 'read'),
    headers: {
      origin,
      cookie: '__Host-qigong-admin=' + token + '; __Host-qigong-admin-csrf=' + 'c'.repeat(43),
      'x-csrf-token': 'c'.repeat(43)
    },
    payload: {
      operation: exporting ? 'attendance.export' : 'attendance.read',
      regionId: region,
      from: rows[0]!.from,
      until: rows[0]!.until,
      filters: { fieldId: null, method: null },
      ...(exporting ? {} : { page: 1, limit: 100 })
    }
  });
};

describe.skipIf(!directory)('isolated real PG: full migrations + synthetic LINE/RLS/QR/CSV', () => {
  beforeAll(async () => {
    if (
      !directory ||
      !/^\/tmp\/(?:venue-qr-pg\.|venue-suite-qr-|venue-debug-(?:integration-)?)[A-Za-z0-9]+$/.test(
        directory
      )
    )
      throw new Error('isolated harness directory required');
    const actual = await realpath(directory);
    if (actual !== directory && actual !== '/private' + directory)
      throw new Error('unexpected isolated cluster path');
    const info = await stat(directory);
    if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
      throw new Error('unsafe isolated cluster directory');
    if (
      (await readFile(resolve(directory, 'isolated-venue-qr-marker'), 'utf8')).trim() !== directory
    )
      throw new Error('missing harness marker');
    const pid = (await readFile(resolve(directory, 'data/postmaster.pid'), 'utf8')).split('\n');
    if (
      ![directory + '/data', actual + '/data'].includes(pid[1] ?? '') ||
      pid[3] !== '55479' ||
      ![directory + '/socket', actual + '/socket'].includes(pid[4] ?? '')
    )
      throw new Error('cluster does not match disposable harness');
    const options = {
      host: directory + '/socket',
      port: 55479,
      database: 'postgres',
      ssl: false,
      max: 12
    };
    owner = new Pool({ ...options, user: 'venue_test_owner' });
    // Must be pristine before any repo migration; do not adopt an existing database.
    const existing = await owner.query(
      "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p')"
    );
    expect(existing.rowCount).toBe(0);
    const result = await runMigrations(
      owner,
      resolve(process.cwd(), '../../migrations'),
      'synthetic-local-qr'
    );
    expect(result.currentVersion).toBe('0057_venue_test_scope.sql');
    expect(result.applied).toContain(venueQrMigrationVersion);
    const migrationFiles = (await readdir(resolve(process.cwd(), '../../migrations')))
      .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
      .sort();
    expect(result.applied).toEqual(migrationFiles);
    expect(migrationFiles).toHaveLength(57);
    expect(
      (await runMigrations(owner, resolve(process.cwd(), '../../migrations'))).applied
    ).toEqual([]);
    // Assert fresh-chain properties BEFORE fixtures; migrations must not seed a deployment.
    expect((await owner.query('SELECT 1 FROM core.regions')).rowCount).toBe(0);
    expect((await owner.query('SELECT 1 FROM core.practice_fields')).rowCount).toBe(0);
    expect((await owner.query('SELECT 1 FROM platform.learner_privacy_acceptances')).rowCount).toBe(
      0
    );
    const invitations = await owner.query(
      "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('platform.channel_invites'::regclass,'platform.channel_invite_continuations'::regclass,'platform.channel_invite_redemptions'::regclass)"
    );
    expect(invitations.rows).toHaveLength(3);
    for (const table of invitations.rows) {
      expect(table.relrowsecurity).toBe(true);
      expect(table.relforcerowsecurity).toBe(true);
    }
    await owner.query(
      await readFile(new URL('./fixtures/venue-qr-synthetic.sql', import.meta.url), 'utf8')
    );
    runtime = new Pool({ ...options, user: 'venue_qr_test_login' });
    const regions = await owner.query<{ id: string; code: string }>(
      "SELECT id,code FROM core.regions WHERE code IN ('tw-general','sg-general')"
    );
    regionId = regions.rows.find((r) => r.code === 'tw-general')!.id;
    otherRegionId = regions.rows.find((r) => r.code === 'sg-general')!.id;
  }, 120000);
  beforeEach(async () => {
    await owner.query('TRUNCATE core.field_attendance');
    await owner.query(
      'UPDATE platform.learner_privacy_acceptances SET revoked_at=NULL; UPDATE admin.sessions SET revoked_at=NULL; UPDATE core.practice_fields SET is_active=TRUE; UPDATE identity.platform_identities SET revoked_at=NULL; UPDATE identity.person_interaction_channels SET valid_to=NULL'
    );
  });
  afterEach(async () => {
    await Promise.all(applications.splice(0).map((app) => app.close()));
  });
  afterAll(async () => {
    await runtime?.end();
    await owner?.end();
  });

  it('keeps FORCE RLS, nonowner/no membership roles and no direct session/runtime grants', async () => {
    const roles = await owner.query(
      "SELECT rolname,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname IN ('qigong_venue_qr_writer','qigong_venue_qr_reader')"
    );
    expect(roles.rows).toHaveLength(2);
    for (const role of roles.rows) {
      expect(role.rolsuper).toBe(false);
      expect(role.rolbypassrls).toBe(false);
      expect(role.rolcanlogin).toBe(false);
    }
    const memberships = await owner.query(
      "SELECT 1 FROM pg_auth_members WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname LIKE 'qigong_venue_qr_%') OR member IN (SELECT oid FROM pg_roles WHERE rolname LIKE 'qigong_venue_qr_%')"
    );
    expect(memberships.rowCount).toBe(0);
    const tables = await owner.query(
      "SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) owner FROM pg_class WHERE oid IN ('core.practice_fields'::regclass,'core.field_attendance'::regclass)"
    );
    for (const table of tables.rows) {
      expect(table.relrowsecurity).toBe(true);
      expect(table.relforcerowsecurity).toBe(true);
      expect(table.owner).not.toMatch(/qigong_venue/);
    }
    await expect(runtime.query('SELECT * FROM core.field_attendance')).rejects.toMatchObject({
      code: '42501'
    });
    await expect(
      withRequestContext(runtime, 'qigong_api_runtime', { requestId: requestId() }, (c) =>
        c.query('SELECT * FROM core.practice_fields')
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withRequestContext(runtime, 'qigong_api_runtime', { requestId: requestId() }, (c) =>
        c.query('SET LOCAL ROLE qigong_venue_qr_writer')
      )
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('records cross-country attendance, never writes raw GPS or daily practice, replays existing success', async () => {
    const app = makeApp();
    const first = await checkin(app);
    expect(first.statusCode).toBe(200);
    const replay = await checkin(app);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ ...first.json(), replayed: true });
    const stored = await owner.query(
      'SELECT user_latitude,user_longitude,checkin_id,student_note,attendance_date::text,attendance_timezone FROM core.field_attendance'
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({
      user_latitude: null,
      user_longitude: null,
      checkin_id: null,
      student_note: null,
      attendance_timezone: 'Asia/Taipei'
    });
    expect(
      (await owner.query('SELECT 1 FROM core.checkins WHERE person_id=$1', [personId])).rowCount
    ).toBe(0);
    const read = await currentReport(app);
    expect(read.statusCode).toBe(200);
    expect(read.json().totals).toEqual({ attendanceCount: 1, attendanceDays: 1, learnerCount: 1 });
    expect(read.json().rows[0].learnerName).toBe('=SYNTHETIC()');
  });
  it('serializes parallel same-venue attempts while counting other venues independently', async () => {
    const app = makeApp();
    const responses = await Promise.all(Array.from({ length: 8 }, () => checkin(app)));
    expect(responses.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
    expect(responses.filter((r) => !r.json().replayed)).toHaveLength(1);
    const others = await Promise.all([checkin(app, 'tw-test-two'), checkin(app, 'sg-test-one')]);
    for (const result of others) expect(result.statusCode).toBe(200);
    expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(3);
    expect((await currentReport(app)).json().totals).toEqual({
      attendanceCount: 2,
      attendanceDays: 1,
      learnerCount: 1
    });
  });
  it('uses venue timezone across the date line, with distinct local-day totals', async () => {
    const app = makeApp();
    const east = await checkin(app, 'tw-test-east'),
      west = await checkin(app, 'tw-test-west');
    expect(east.statusCode).toBe(200);
    expect(west.statusCode).toBe(200);
    expect(east.json().attendanceDate).not.toBe(west.json().attendanceDate);
    const dates = await owner.query(
      "SELECT (clock_timestamp() AT TIME ZONE 'Etc/GMT-14')::date::text east,(clock_timestamp() AT TIME ZONE 'Etc/GMT+12')::date::text west"
    );
    expect(east.json().attendanceDate).toBe(dates.rows[0].east);
    expect(west.json().attendanceDate).toBe(dates.rows[0].west);
    expect((await currentReport(app)).json().totals).toEqual({
      attendanceCount: 2,
      attendanceDays: 2,
      learnerCount: 1
    });
  });
  it('rejects radius/time/active failures without inserting; replay must revalidate radius', async () => {
    const app = makeApp();
    expect((await checkin(app, 'tw-test-one', 0, 0)).statusCode).toBe(409);
    expect((await checkin(app, 'tw-test-window')).statusCode).toBe(409);
    await owner.query("UPDATE core.practice_fields SET is_active=FALSE WHERE code='tw-test-one'");
    expect((await checkin(app)).statusCode).toBe(403);
    expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(0);
    await owner.query("UPDATE core.practice_fields SET is_active=TRUE WHERE code='tw-test-one'");
    expect((await checkin(app)).statusCode).toBe(200);
    expect((await checkin(app, 'tw-test-one', 0, 0)).statusCode).toBe(409);
  });
  it('rejects NULL schedule bypasses and moving an already-used venue timezone/region', async () => {
    await expect(
      owner.query(
        `UPDATE core.practice_fields SET active_time_rules='{"day_of_week":[0,1,2,3,4,5,6],"start_time":null,"end_time":"24:00"}'::jsonb WHERE code='tw-test-one'`
      )
    ).rejects.toMatchObject({ code: '22023' });
    const app = makeApp();
    expect((await checkin(app)).statusCode).toBe(200);
    await expect(
      owner.query("UPDATE core.practice_fields SET timezone='UTC' WHERE code='tw-test-one'")
    ).rejects.toMatchObject({ code: '40001', message: 'venue_region_timezone_frozen' });
    await expect(
      owner.query("UPDATE core.practice_fields SET region_id=$1 WHERE code='tw-test-one'", [
        otherRegionId
      ])
    ).rejects.toMatchObject({ code: '40001', message: 'venue_region_timezone_frozen' });
  });
  it('denies revoked consent and invalid LINE mock; no reflection consent is needed', async () => {
    const app = makeApp();
    await owner.query(
      'UPDATE platform.learner_privacy_acceptances SET revoked_at=clock_timestamp()'
    );
    expect((await checkin(app)).statusCode).toBe(403);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/line/venue-checkin',
      headers: { origin, 'x-venue-checkin': '1' },
      payload: { idToken: 'invalid', venue: 'tw-test-one', latitude: 25, longitude: 121 }
    });
    expect(bad.statusCode).toBe(401);
    expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(0);
  });
  it('rechecks identity in the writer transaction, not just the earlier adapter snapshot', async () => {
    const app = makeApp();
    expect((await checkin(app)).statusCode).toBe(200);
    await owner.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp(); UPDATE identity.platform_identities SET revoked_at=clock_timestamp()'
    );
    await expect(
      withRequestContext(runtime, 'qigong_api_runtime', { requestId: requestId() }, (c) =>
        c.query('SELECT platform.venue_qr_checkin($1,$2,25,121)', [subject, 'tw-test-two'])
      )
    ).rejects.toMatchObject({ code: '42501' });
    expect((await checkin(app, 'tw-test-two')).statusCode).toBe(403);
    expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(1);
  });
  it('rejects forged principal context without session and enforces field-region read/export separation', async () => {
    const app = makeApp();
    expect((await checkin(app)).statusCode).toBe(200);
    await expect(
      withRequestContext(
        runtime,
        'qigong_api_runtime',
        { requestId: requestId(), principalId: '10000000-0000-4000-8000-000000000001' },
        (c) =>
          c.query('SELECT admin.venue_qr_read($1,$2,$3,$4,1,100,FALSE,NULL,NULL)', [
            'forged',
            regionId,
            '2026-10-01',
            '2026-11-01'
          ])
      )
    ).rejects.toMatchObject({ code: '42501' });
    expect((await report(app, false, 'v'.repeat(43), otherRegionId)).statusCode).toBe(403);
    expect((await currentReport(app, true, 'v'.repeat(43))).statusCode).toBe(403);
    const csv = await currentReport(app, true, 'e'.repeat(43));
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain("'=SYNTHETIC()");
    await owner.query(
      "UPDATE admin.sessions SET revoked_at=clock_timestamp() WHERE token_hash=public.digest(repeat('e',43),'sha256')"
    );
    expect((await currentReport(app, true, 'e'.repeat(43))).statusCode).toBe(401);
    expect(
      (await owner.query("SELECT 1 FROM audit.events WHERE action='venue.attendance_export'"))
        .rowCount
    ).toBe(1);
  });
  it('ordinary table owner is still subject to FORCE; unprivileged/public/worker cannot execute writer', async () => {
    await owner.query(
      'CREATE ROLE venue_test_table_owner NOLOGIN NOBYPASSRLS; GRANT USAGE ON SCHEMA core TO venue_test_table_owner'
    );
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE core.field_attendance OWNER TO venue_test_table_owner');
      await client.query('SET LOCAL ROLE venue_test_table_owner');
      expect((await client.query('SELECT * FROM core.field_attendance')).rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const acl = await owner.query(
      "SELECT has_function_privilege('qigong_worker_runtime','platform.venue_qr_checkin(text,text,double precision,double precision)','EXECUTE') worker,has_function_privilege('venue_qr_test_login','platform.venue_qr_checkin(text,text,double precision,double precision)','EXECUTE') login"
    );
    expect(acl.rows[0]).toEqual({ worker: false, login: false });
  });
});
