/** Synthetic credentials ONLY. Never connects through TEST_DATABASE_URL. */
import { createHash, createHmac } from 'node:crypto';
import { readFile, realpath, stat, mkdtemp, readdir, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, checkStartupReadiness } from '../src/app.js';
import { ownLogValue } from '../src/log-privacy.js';
import { createVenuePeopleService } from '../src/venue-people-service.js';
import { parseVenuePeopleQuery, encodeVenuePeopleCsv } from '../src/venue-people-helpers.js';
import { readVenueQrAttendance } from '../src/venue-qr.js';
import { parseVenueReadRequest } from '../src/venue-admin-read-contract.js';
import { withRequestContext } from '@qigong/database';
import { runMigrations } from '../../../packages/database/src/migrations.js';

const directory = process.env.VENUE_DEBUG_ISOLATED_PG_DIR;
const subject = 'U' + 'a'.repeat(32);
const fixtureToken = 'synthetic-only-'.padEnd(43, 'x');
const hash = createHash('sha256').update(fixtureToken).digest('hex');
const venues = ['tw-location-test', 'tw-taipei-cks'] as const;
let owner: Pool;
let runtime: Pool;
let expiresAt: string;
const call = (sql: string, params: readonly unknown[] = []) =>
  withRequestContext(runtime, 'qigong_api_runtime', { requestId: crypto.randomUUID() }, (c) =>
    c.query(sql, [...params])
  );
const checkin = (test = true, venue = 'tw-taipei-cks', lat = -25, issuedOffset = 0) => {
  const requestId = crypto.randomUUID();
  const issued = Math.floor(Date.now() / 1000) + issuedOffset;
  const proof = createHmac('sha256', Buffer.from(hash, 'hex'))
    .update([requestId, subject, venue, issued, Date.parse(expiresAt)].join('|'))
    .digest('hex');
  return withRequestContext(runtime, 'qigong_api_runtime', { requestId }, (c) =>
    c.query<{ data: { replayed: boolean; isTest?: boolean } }>(
      test
        ? 'SELECT platform.venue_debug_checkin($1,$2,$3,$4,$5,$6,$7) AS data'
        : 'SELECT platform.venue_qr_checkin($1,$2,$3,$4) AS data',
      test
        ? [subject, venue, lat, 121, issued, Date.parse(expiresAt), proof]
        : [subject, venue, lat, 121]
    )
  );
};
describe.skipIf(!directory)('debug: owned socket-only PG17 57→58 chain', () => {
  beforeAll(async () => {
    if (!directory || !/^\/tmp\/venue-debug-(?:integration-)?[A-Za-z0-9]+$/.test(directory))
      throw new Error('owned debug harness required');
    const actual = await realpath(directory);
    const info = await stat(directory);
    expect([directory, '/private' + directory]).toContain(actual);
    expect(info.uid).toBe(process.getuid?.());
    expect(info.mode & 0o777).toBe(0o700);
    expect((await readFile(directory + '/venue-debug-owner-marker', 'utf8')).trim()).toBe(
      directory
    );
    const pid = (await readFile(directory + '/data/postmaster.pid', 'utf8')).split('\n');
    expect(await realpath(pid[1]!)).toBe(actual + '/data');
    expect(pid[3]).toBe('55485');
    expect(await realpath(pid[4]!)).toBe(actual + '/socket');
    const options = { host: directory + '/socket', port: 55485, database: 'postgres', ssl: false };
    owner = new Pool({ ...options, user: 'venue_debug_owner' });
    expect((await owner.query('SHOW listen_addresses')).rows[0]?.listen_addresses).toBe('');
    expect(
      (await owner.query("SELECT 1 FROM pg_namespace WHERE nspname IN ('core','platform')"))
        .rowCount
    ).toBe(0);
    const staging = await mkdtemp('/tmp/venue-debug-migrations-');
    try {
      for (const name of await readdir(resolve('../../migrations')))
        if (name.endsWith('.sql') && name < '0058_')
          await copyFile(resolve('../../migrations', name), resolve(staging, name));
      expect((await runMigrations(owner, staging)).applied).toHaveLength(57);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    await owner.query(
      "INSERT INTO platform.venue_debug_config(enabled,expires_at,token_hash,venue_code) VALUES(TRUE,date_trunc('milliseconds',clock_timestamp()+interval '59 minutes'),$1,'tw-taipei-cks')",
      [hash]
    );
    await owner.query(
      (
        await readFile(new URL('./fixtures/venue-qr-synthetic.sql', import.meta.url), 'utf8')
      ).replaceAll('tw-test-one', 'tw-location-test')
    );
    await owner.query(`INSERT INTO core.practice_fields(region_id,code,name_zh_tw,latitude,longitude,radius_meters,timezone,active_time_rules)
      SELECT region_id,'tw-taipei-cks',name_zh_tw,latitude,longitude,radius_meters,timezone,active_time_rules FROM core.practice_fields WHERE code='tw-location-test';
      INSERT INTO core.field_attendance(person_id,field_id,checkin_method,distance_meters,checkin_at,attendance_date,attendance_timezone,is_test,verification_mode)
      SELECT '20000000-0000-4000-8000-000000000001',id,'qr_gps',100000,clock_timestamp(),(clock_timestamp() AT TIME ZONE timezone)::date,timezone,TRUE,'distance_debug' FROM core.practice_fields WHERE code='tw-location-test';`);
    // Existing formal attendance at the test site is preserved, never replayed by normal entry.
    await withRequestContext(
      owner,
      'qigong_api_runtime',
      { requestId: crypto.randomUUID() },
      (client) =>
        client.query('SELECT platform.venue_qr_checkin($1,$2,25,121)', [subject, 'tw-taipei-cks'])
    );
    await owner.query(`UPDATE core.field_attendance SET field_id=(SELECT id FROM core.practice_fields WHERE code='tw-location-test') WHERE NOT is_test;
      ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT EXECUTE ON FUNCTIONS TO qigong_api_runtime,qigong_worker_runtime;`);
    const functionMetadata = () =>
      owner.query(`SELECT p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('platform','admin','core','identity','audit') ORDER BY p.oid`);
    const functionBodies = () =>
      owner.query(`SELECT p.oid,p.oid::regprocedure::text AS signature,p.prosrc
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('platform','admin','core','identity','audit') ORDER BY p.oid`);
    const policies = () =>
      owner.query(
        `SELECT polname,polrelid,polroles,polqual::text,polwithcheck::text FROM pg_policy ORDER BY oid`
      );
    const securityMetadata = () =>
      owner.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_roles r) AS roles,
      (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.oid) FROM pg_auth_members m) AS members,
      (SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('core','platform','admin','identity','audit')) AS tables,
      (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d) AS defaults`);
    const oldSecurity = (await securityMetadata()).rows;
    const oldMetadata = (await functionMetadata()).rows;
    const oldBodies = (await functionBodies()).rows;
    const oldPolicies = (await policies()).rows;
    const oldAudit = (await owner.query('SELECT * FROM audit.events ORDER BY id')).rows;
    expect(oldAudit.length).toBeGreaterThan(0);
    const oldLedger = (
      await owner.query('SELECT version,checksum FROM schema_migrations ORDER BY version')
    ).rows;
    const oldRows = (await owner.query('SELECT * FROM core.field_attendance ORDER BY id')).rows;
    const oldVenues = (await owner.query('SELECT * FROM core.practice_fields ORDER BY id')).rows;
    // Keep this 57→58 security-metadata preservation test pinned to its exact
    // feature migration. The 58→59 notification upgrade has its own isolated proof.
    const migrate58 = async () => {
      const exact58 = await mkdtemp('/tmp/venue-debug-migrations-');
      try {
        for (const name of await readdir(resolve('../../migrations')))
          if (name.endsWith('.sql') && name < '0059_')
            await copyFile(resolve('../../migrations', name), resolve(exact58, name));
        return await runMigrations(owner, exact58);
      } finally {
        await rm(exact58, { recursive: true, force: true });
      }
    };
    const result = await migrate58();
    expect(result.applied).toEqual(['0058_venue_early_checkin_window.sql']);
    expect(result.currentVersion).toBe('0058_venue_early_checkin_window.sql');
    expect(
      (
        await owner.query(
          "SELECT version,checksum FROM schema_migrations WHERE version<'0058_' ORDER BY version"
        )
      ).rows
    ).toEqual(oldLedger);
    expect(
      (
        await owner.query(
          "SELECT to_regprocedure('platform.venue_debug_checkin(text,text,double precision,double precision,bigint,text)') AS old"
        )
      ).rows[0]?.old
    ).toBeNull();
    expect((await owner.query('SELECT 1 FROM platform.venue_debug_config')).rowCount).toBe(0);
    expect((await migrate58()).applied).toEqual([]);
    expect((await owner.query('SELECT * FROM core.field_attendance ORDER BY id')).rows).toEqual(
      oldRows
    );
    expect((await owner.query('SELECT * FROM core.practice_fields ORDER BY id')).rows).toEqual(
      oldVenues
    );
    expect((await owner.query('SELECT * FROM audit.events ORDER BY id')).rows).toEqual(oldAudit);
    expect((await securityMetadata()).rows).toEqual(oldSecurity);
    expect(
      (await functionMetadata()).rows.filter((row) =>
        oldMetadata.some((old) => old.oid === row.oid)
      )
    ).toEqual(oldMetadata);
    const newBodies = (await functionBodies()).rows.filter((row) =>
      oldBodies.some((old) => old.oid === row.oid)
    );
    expect(
      newBodies
        .filter((row, i) => row.prosrc !== oldBodies[i]?.prosrc)
        .map((row) => row.signature)
        .sort()
    ).toEqual([
      'platform.venue_debug_checkin(text,text,double precision,double precision,bigint,bigint,text)',
      'platform.venue_qr_checkin(text,text,double precision,double precision)'
    ]);
    const newPolicies = (await policies()).rows;
    expect(newPolicies).toHaveLength(oldPolicies.length);
    expect(
      newPolicies
        .filter((row, i) => JSON.stringify(row) !== JSON.stringify(oldPolicies[i]))
        .map((row) => row.polname)
    ).toEqual([]);
    runtime = new Pool({ ...options, user: 'venue_qr_test_login', max: 12 });
    await expect(checkin(false, 'tw-location-test', 25)).rejects.toMatchObject({
      code: '42501',
      message: 'venue_test_code_required'
    });
    const legacyHistory = (
      await call("SELECT platform.venue_debug_history('line',$1) AS data", [subject])
    ).rows[0]?.data;
    expect(legacyHistory.entries).toHaveLength(1);
    expect(legacyHistory.entries[0]).toMatchObject({ venueCode: 'tw-location-test', isTest: true });
    expiresAt = new Date(Date.now() + 3500000).toISOString();
    await expect(checkin()).rejects.toMatchObject({ code: '42501', message: 'venue_debug_denied' });
  }, 120000);
  beforeEach(async () => {
    expect((await owner.query('SELECT 1 FROM platform.venue_debug_context')).rowCount).toBe(0);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('External APIs prohibited');
      })
    );
    await owner.query(`TRUNCATE core.field_attendance,platform.venue_debug_config;
      UPDATE identity.people SET status='active';
      UPDATE identity.onboarding_applications SET status='approved';
      UPDATE platform.learner_privacy_acceptances SET revoked_at=NULL;
      UPDATE identity.platform_identities SET revoked_at=NULL;
      UPDATE identity.person_interaction_channels SET valid_to=NULL;
      UPDATE core.practice_fields SET timezone='Asia/Taipei',is_active=TRUE,active_time_rules='{"day_of_week":[0,1,2,3,4,5,6],"start_time":"00:00","end_time":"24:00"}';`);
    expiresAt = new Date(Date.now() + 3500000).toISOString();
    await owner.query(
      "INSERT INTO platform.venue_debug_config(enabled,expires_at,token_hash,venue_code) VALUES(TRUE,$1,$2,'tw-taipei-cks')",
      [expiresAt, hash]
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    try {
      if (directory && runtime) {
        const pgLog = await readFile(directory + '/server.log', 'utf8');
        expect(pgLog).toContain('venue_debug_denied');
        for (const value of [
          hash,
          fixtureToken,
          'synthetic-identity-private',
          '-25.1234567',
          '121.9876543'
        ])
          expect(pgLog).not.toContain(value);
      }
    } finally {
      await runtime?.end();
      await owner?.end();
    }
  });
  it('calculates precise boundaries, next-day weekdays, end24 and PostgreSQL DST instants fail closed', async () => {
    const cases: readonly [string, string, string, string, readonly number[], boolean][] = [
      ['2026-10-31T00:29:59.999Z', 'Asia/Taipei', '09:00', '11:00', [6], false],
      ['2026-10-31T00:30:00Z', 'Asia/Taipei', '09:00', '11:00', [6], true],
      ['2026-10-31T01:00:00Z', 'Asia/Taipei', '09:00', '11:00', [6], true],
      ['2026-10-31T02:59:59.999Z', 'Asia/Taipei', '09:00', '11:00', [6], true],
      ['2026-10-31T03:00:00Z', 'Asia/Taipei', '09:00', '11:00', [6], false],
      ['2026-10-31T00:29:00Z', 'Asia/Taipei', '09:00', '11:00', [6], false],
      ['2026-10-30T00:30:00Z', 'Asia/Taipei', '09:00', '11:00', [6], false],
      ['2026-10-30T15:44:59.999Z', 'Asia/Taipei', '00:15', '01:00', [6], false],
      ['2026-10-30T15:45:00Z', 'Asia/Taipei', '00:15', '01:00', [6], true],
      ['2026-10-30T15:45:00Z', 'Asia/Taipei', '00:15', '01:00', [5], false],
      ['2026-10-31T15:45:00Z', 'Asia/Taipei', '00:15', '01:00', [0, 3], true],
      ['2026-10-31T15:59:59.999Z', 'Asia/Taipei', '23:00', '24:00', [6], true],
      ['2026-10-31T16:00:00Z', 'Asia/Taipei', '23:00', '24:00', [6], false],
      // PG maps nonexistent 02:15 to 07:15Z; subtract elapsed time, not wall time.
      ['2026-03-08T06:44:59.999Z', 'America/New_York', '02:15', '04:00', [0], false],
      ['2026-03-08T06:45:00Z', 'America/New_York', '02:15', '04:00', [0], true],
      ['2026-03-08T08:00:00Z', 'America/New_York', '02:15', '04:00', [0], false],
      // Ambiguous 01:15 uses PG standard-time occurrence (06:15Z).
      ['2026-11-01T05:44:59.999Z', 'America/New_York', '01:15', '02:00', [0], false],
      ['2026-11-01T05:45:00Z', 'America/New_York', '01:15', '02:00', [0], true],
      ['2026-11-01T07:00:00Z', 'America/New_York', '01:15', '02:00', [0], false]
    ];
    for (const [at, zone, start, end, days, expected] of cases) {
      const result = await owner.query('SELECT platform.venue_checkin_window($1,$2,$3) AS open', [
        JSON.stringify({ day_of_week: days, start_time: start, end_time: end }),
        zone,
        at
      ]);
      expect(result.rows[0]?.open, JSON.stringify([at, zone, start, end, days])).toBe(expected);
    }
    for (const [rules, zone, at] of [
      [null, 'UTC', '2026-10-31T00:30:00Z'],
      [{ day_of_week: [6], start_time: '09:00', end_time: '11:00' }, null, '2026-10-31T00:30:00Z'],
      [
        { day_of_week: [6], start_time: '09:00', end_time: '11:00' },
        'invalid/zone',
        '2026-10-31T00:30:00Z'
      ],
      [{ day_of_week: [6], start_time: '09:00', end_time: '11:00' }, 'UTC', null],
      [{ day_of_week: [6], start_time: null, end_time: '24:00' }, 'UTC', '2026-10-31T00:30:00Z'],
      [
        { day_of_week: [6, 6], start_time: '00:00', end_time: '24:00' },
        'UTC',
        '2026-10-31T00:30:00Z'
      ],
      [{ day_of_week: [6], start_time: '23:00', end_time: '01:00' }, 'UTC', '2026-10-31T00:30:00Z'],
      [{ day_of_week: [6], start_time: '24:00', end_time: '24:00' }, 'UTC', '2026-10-31T00:30:00Z']
    ]) {
      expect(
        (
          await owner.query('SELECT platform.venue_checkin_window($1,$2,$3) AS open', [
            rules === null ? null : JSON.stringify(rules),
            zone,
            at
          ])
        ).rows[0]?.open
      ).toBe(false);
    }
  });
  it('removes helper default-ACL residue and grants execution only to the two writers', async () => {
    const result =
      await owner.query(`SELECT p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) AS owner,
      ARRAY(SELECT r.rolname::text FROM aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE a.grantee<>p.proowner ORDER BY r.rolname) AS grantees,
      EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0) AS public
      FROM pg_proc p WHERE p.oid='platform.venue_checkin_window(jsonb,text,timestamptz)'::regprocedure`);
    expect(result.rows[0]).toMatchObject({
      prosecdef: false,
      proconfig: ['search_path=pg_catalog'],
      owner: 'venue_debug_owner',
      grantees: ['qigong_venue_debug', 'qigong_venue_qr_writer'],
      public: false
    });
    await expect(
      call("SELECT platform.venue_checkin_window(NULL,'UTC',clock_timestamp())")
    ).rejects.toMatchObject({ code: '42501' });
    expect(await checkStartupReadiness(runtime, true)).toMatchObject({ ready: true });
    expect(
      await checkStartupReadiness(
        runtime,
        true,
        { management: { enabled: true, publicOrigin: 'https://synthetic.invalid' } },
        true
      )
    ).toMatchObject({ ready: true });
    await owner.query(
      'GRANT EXECUTE ON FUNCTION platform.venue_checkin_window(jsonb,text,timestamptz) TO qigong_api_runtime'
    );
    try {
      expect(await checkStartupReadiness(runtime, true)).toMatchObject({
        ready: false,
        reason: 'venue_feature_not_ready',
        capability: { feature: 'window', ready: false }
      });
      expect(
        await checkStartupReadiness(
          runtime,
          true,
          { management: { enabled: true, publicOrigin: 'https://synthetic.invalid' } },
          true
        )
      ).toMatchObject({ ready: false, reason: 'venue_feature_not_ready' });
    } finally {
      await owner.query(
        'REVOKE ALL ON FUNCTION platform.venue_checkin_window(jsonb,text,timestamptz) FROM qigong_api_runtime'
      );
    }
  });
  it('uses the same early gate for normal/debug real-clock writes and replay while keeping actual local dates', async () => {
    // Pick a real IANA fixed-offset zone where local now is near noon, far from date rollover.
    const hour = new Date().getUTCHours();
    const offset = 12 - hour;
    const zone = offset === 0 ? 'Etc/GMT' : 'Etc/GMT' + (offset > 0 ? '-' : '+') + Math.abs(offset);
    const schedule = async (minutes: number) =>
      owner.query(
        `UPDATE core.practice_fields SET timezone=$1,
      active_time_rules=jsonb_build_object('day_of_week',jsonb_build_array(extract(dow FROM clock_timestamp() AT TIME ZONE $1)::int),
      'start_time',to_char((clock_timestamp() AT TIME ZONE $1)+make_interval(mins=>$2),'HH24:MI'),'end_time','24:00') WHERE code='tw-taipei-cks'`,
        [zone, minutes]
      );
    await schedule(31);
    for (const debug of [false, true])
      await expect(checkin(debug, 'tw-taipei-cks', 25)).rejects.toMatchObject({
        message: 'venue_outside_window'
      });
    await schedule(30);
    await expect(checkin(true, 'tw-taipei-cks', 25, -60)).rejects.toMatchObject({
      message: 'venue_debug_denied'
    });
    await expect(
      call('SELECT platform.venue_qr_checkin($1,$2,NULL,121)', [subject, 'tw-taipei-cks'])
    ).rejects.toMatchObject({ message: 'venue_invalid' });
    await owner.query(
      'UPDATE platform.learner_privacy_acceptances SET revoked_at=clock_timestamp()'
    );
    for (const debug of [false, true])
      await expect(checkin(debug, 'tw-taipei-cks', 25)).rejects.toMatchObject({
        code: '42501',
        message: 'privacy acceptance required'
      });
    await owner.query(
      "UPDATE platform.learner_privacy_acceptances SET revoked_at=NULL; UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp(); UPDATE identity.people SET status='suspended'"
    );
    for (const debug of [false, true])
      await expect(checkin(debug, 'tw-taipei-cks', 25)).rejects.toMatchObject({
        message: 'venue_identity_denied'
      });
    await owner.query(
      "UPDATE identity.people SET status='active'; UPDATE identity.person_interaction_channels SET valid_to=NULL"
    );
    for (const debug of [false, true]) {
      expect((await checkin(debug, 'tw-taipei-cks', 25)).rows[0]?.data).toMatchObject({
        replayed: false
      });
      expect((await checkin(debug, 'tw-taipei-cks', 25)).rows[0]?.data).toMatchObject({
        replayed: true
      });
    }
    expect(
      (
        await owner.query(
          'SELECT bool_and(attendance_date=(checkin_at AT TIME ZONE attendance_timezone)::date) AS ok,count(*)::int AS n FROM core.field_attendance'
        )
      ).rows[0]
    ).toEqual({ ok: true, n: 2 });
    await schedule(31);
    for (const debug of [false, true])
      await expect(checkin(debug, 'tw-taipei-cks', 25)).rejects.toMatchObject({
        message: 'venue_outside_window'
      });
    await owner.query(
      "TRUNCATE core.field_attendance; UPDATE core.practice_fields SET timezone='Asia/Taipei'"
    );
  });
  it('keeps actual previous-day dates and existing per-person/venue/date/test uniqueness in a synthetic midnight fixture', async () => {
    const insert = `INSERT INTO core.field_attendance(person_id,field_id,checkin_method,distance_meters,checkin_at,attendance_date,attendance_timezone,is_test,verification_mode)
      SELECT '20000000-0000-4000-8000-000000000001',id,'qr_gps',0,$1::timestamptz,($1::timestamptz AT TIME ZONE timezone)::date,timezone,$2,CASE WHEN $2 THEN 'distance_debug' ELSE 'standard' END
      FROM core.practice_fields WHERE code='tw-taipei-cks' AND platform.venue_checkin_window('{"day_of_week":[6],"start_time":"00:15","end_time":"01:00"}',timezone,$1)
      ON CONFLICT(person_id,field_id,attendance_date,is_test) DO NOTHING RETURNING attendance_date::text`;
    for (const debug of [false, true]) {
      expect((await owner.query(insert, ['2026-10-30T15:45:00Z', debug])).rows).toEqual([
        { attendance_date: '2026-10-30' }
      ]);
      expect((await owner.query(insert, ['2026-10-30T15:50:00Z', debug])).rowCount).toBe(0);
      expect((await owner.query(insert, ['2026-10-30T16:15:00Z', debug])).rows).toEqual([
        { attendance_date: '2026-10-31' }
      ]);
    }
  });
  it('migration keeps configuration operator-only and constrains finite single-venue authority', async () => {
    for (const sql of [
      'SELECT * FROM platform.venue_debug_config',
      'UPDATE platform.venue_debug_config SET enabled=TRUE',
      "SELECT platform.venue_debug_region_active('10000000-0000-4000-8000-000000000003')"
    ])
      await expect(call(sql)).rejects.toMatchObject({ code: '42501' });
    for (const patch of [
      "venue_code='tw-location-test,tw-taipei-cks'",
      "venue_code='*'",
      "venue_code=''",
      "venue_code='tw-test-two'",
      "expires_at=configured_at+interval '61 minutes'",
      'expires_at=configured_at',
      "configured_at='-infinity'",
      "expires_at='infinity'"
    ])
      await expect(
        owner.query('UPDATE platform.venue_debug_config SET ' + patch)
      ).rejects.toMatchObject({ code: '23514' });
    expect(
      (
        await owner.query(
          "SELECT rolcanlogin,rolinherit,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='qigong_venue_debug_region_guard'"
        )
      ).rows
    ).toEqual([{ rolcanlogin: false, rolinherit: false, rolsuper: false, rolbypassrls: false }]);
  });
  it.each(venues)(
    'DB authority independently rejects cross-scope, wrong key, expiry and stale proof (%s)',
    async (venueCode) => {
      const other = venues.find((code) => code !== venueCode)!;
      await owner.query('UPDATE platform.venue_debug_config SET venue_code=$1', [other]);
      await expect(checkin(true, venueCode)).rejects.toMatchObject({
        code: '42501',
        message: 'venue_debug_denied'
      });
      await owner.query('UPDATE platform.venue_debug_config SET venue_code=$1,token_hash=$2', [
        venueCode,
        'f'.repeat(64)
      ]);
      await expect(checkin(true, venueCode)).rejects.toMatchObject({
        code: '42501',
        message: 'venue_debug_denied'
      });
      await owner.query(
        "UPDATE platform.venue_debug_config SET token_hash=$1,expires_at=expires_at-interval '1 millisecond'",
        [hash]
      );
      await expect(checkin(true, venueCode)).rejects.toMatchObject({
        code: '42501',
        message: 'venue_debug_denied'
      });
      await owner.query('UPDATE platform.venue_debug_config SET expires_at=$1', [expiresAt]);
      for (const offset of [-40, 40])
        await expect(checkin(true, venueCode, -25, offset)).rejects.toMatchObject({
          code: '42501'
        });
      expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(0);
      expect((await checkin(true, venueCode)).rows[0]?.data).toMatchObject({
        isTest: true,
        replayed: false
      });
      expect((await checkin(true, venueCode)).rows[0]?.data).toMatchObject({
        isTest: true,
        replayed: true
      });
      await owner.query('UPDATE platform.venue_debug_config SET enabled=FALSE');
      await expect(checkin(true, venueCode)).rejects.toMatchObject({ code: '42501' });
      expect(
        (await owner.query('SELECT 1 FROM core.field_attendance WHERE is_test')).rowCount
      ).toBe(1);
    }
  );
  it('test-site normal HTTP and direct SQL deny with no header, regardless of API configuration, and never create formal rows', async () => {
    for (const selected of [undefined, ...venues]) {
      const app = buildApp({
        pool: runtime,
        logger: false,
        line: {
          channelSecret: 'synthetic-secret',
          channelAccessToken: 'synthetic-access',
          loginChannelId: '123',
          liffId: '123-test',
          verifyIdentity: async () => ({ subject })
        },
        venueQr: {
          enabled: true,
          publicOrigin: 'https://synthetic.invalid',
          ...(selected
            ? { debug: { enabled: true, venueCode: selected, expiresAt, tokenHash: hash } }
            : {})
        }
      });
      try {
        const send = (candidate?: string) =>
          app.inject({
            method: 'POST',
            url: '/api/line/venue-checkin',
            headers: {
              origin: 'https://synthetic.invalid',
              'x-venue-checkin': '1',
              ...(candidate === undefined ? {} : { 'x-venue-debug-token': candidate })
            },
            payload: {
              idToken: 'synthetic-private',
              venue: 'tw-location-test',
              latitude: 25,
              longitude: 121
            }
          });
        expect((await send()).json()).toMatchObject({
          ok: false,
          error: 'venue_test_code_required'
        });
        expect((await send('wrong'.repeat(8))).json()).toMatchObject({
          ok: false,
          error: 'venue_debug_denied'
        });
        if (selected !== 'tw-location-test')
          expect((await send(fixtureToken)).json()).toMatchObject({
            ok: false,
            error: 'venue_debug_denied'
          });
        await expect(checkin(false, 'tw-location-test', 25)).rejects.toMatchObject({
          code: '42501',
          message: 'venue_test_code_required'
        });
      } finally {
        await app.close();
      }
    }
    expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(0);
  });
  it('retains radius for formal, records original distance but no raw GPS for debug', async () => {
    await expect(checkin(false)).rejects.toMatchObject({
      code: 'P0001',
      message: 'venue_outside_radius'
    });
    expect((await checkin()).rows[0]?.data).toMatchObject({ isTest: true, replayed: false });
    const row = (
      await owner.query<{
        is_test: boolean;
        verification_mode: string;
        user_latitude: null;
        user_longitude: null;
        distance_meters: string;
      }>('SELECT * FROM core.field_attendance')
    ).rows[0]!;
    expect(row).toMatchObject({
      is_test: true,
      verification_mode: 'distance_debug',
      user_latitude: null,
      user_longitude: null
    });
    // pg deliberately returns NUMERIC as text; validate before converting, without
    // changing the global driver parser (which would lose numeric precision).
    expect(row.distance_meters).toMatch(/^[0-9]+\.[0-9]{2}$/);
    const distance = Number(row.distance_meters);
    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeCloseTo((6371000 * 50 * Math.PI) / 180, 2);
    expect(distance).toBeGreaterThan(100000);
    expect((await owner.query('SELECT 1 FROM platform.venue_debug_context')).rowCount).toBe(0);
  });
  it('serializes replay and test/real races without replacing or misreporting formal', async () => {
    const results = await Promise.allSettled([
      checkin(),
      checkin(),
      checkin(false, 'tw-taipei-cks', 25)
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    expect(rows.map((r) => r.rows[0]?.data.replayed).sort()).toEqual([false, false, true]);
    expect(
      (await owner.query('SELECT is_test FROM core.field_attendance ORDER BY is_test')).rows
    ).toEqual([{ is_test: false }, { is_test: true }]);
    expect((await checkin(false, 'tw-taipei-cks', 25)).rows[0]?.data).toMatchObject({
      replayed: true
    });
  });
  it('rejects disabled, expired, wrong venue, stale or forged proof without writing', async () => {
    await expect(checkin(true, 'tw-test-two')).rejects.toMatchObject({ code: '42501' });
    await expect(checkin(true, 'tw-taipei-cks', -25, -40)).rejects.toMatchObject({
      code: '42501'
    });
    await expect(checkin(true, 'tw-taipei-cks', -25, 40)).rejects.toMatchObject({
      code: '42501'
    });
    const otherRequest = crypto.randomUUID();
    const issued = Math.floor(Date.now() / 1000);
    const proof = createHmac('sha256', Buffer.from(hash, 'hex'))
      .update([otherRequest, subject, 'tw-taipei-cks', issued, Date.parse(expiresAt)].join('|'))
      .digest('hex');
    // Even a valid proof for a different transaction nonce cannot authorize this one.
    await expect(
      call('SELECT platform.venue_debug_checkin($1,$2,-25,121,$3,$4,$5)', [
        subject,
        'tw-taipei-cks',
        issued,
        Date.parse(expiresAt),
        proof
      ])
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      call('SELECT platform.venue_debug_checkin($1,$2,25,121,$3,$4,$5)', [
        subject,
        'tw-taipei-cks',
        Math.floor(Date.now() / 1000),
        Date.parse(expiresAt),
        '0'.repeat(64)
      ])
    ).rejects.toMatchObject({ code: '42501' });
    await owner.query('UPDATE platform.venue_debug_config SET enabled=FALSE');
    await expect(checkin()).rejects.toMatchObject({ code: '42501' });
    await owner.query(
      "UPDATE platform.venue_debug_config SET enabled=TRUE,configured_at=clock_timestamp()-interval '1 hour',expires_at=date_trunc('milliseconds',clock_timestamp()-interval '1 second')"
    );
    await expect(checkin()).rejects.toMatchObject({ code: '42501' });
    await owner.query('TRUNCATE platform.venue_debug_config');
    await expect(checkin()).rejects.toMatchObject({ code: '42501' });
    expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(0);
  });
  it.each(venues)('revalidates identity, consent and time window (%s)', async (venueCode) => {
    await owner.query('UPDATE platform.venue_debug_config SET venue_code=$1', [venueCode]);
    await owner.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp(); UPDATE identity.platform_identities SET revoked_at=clock_timestamp()'
    );
    await expect(checkin(true, venueCode)).rejects.toMatchObject({ code: '42501' });
    await owner.query(
      'UPDATE identity.platform_identities SET revoked_at=NULL; UPDATE identity.person_interaction_channels SET valid_to=NULL; UPDATE platform.learner_privacy_acceptances SET revoked_at=clock_timestamp()'
    );
    await expect(checkin(true, venueCode)).rejects.toMatchObject({ code: '42501' });
    await owner.query(`UPDATE platform.learner_privacy_acceptances SET revoked_at=NULL;
      UPDATE core.practice_fields SET active_time_rules=jsonb_build_object('day_of_week',jsonb_build_array((extract(dow FROM clock_timestamp() AT TIME ZONE timezone)::int+2)%7),'start_time','00:00','end_time','24:00');`);
    await expect(checkin(true, venueCode)).rejects.toMatchObject({
      code: 'P0001',
      message: 'venue_outside_window'
    });
    expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(0);
  });
  it.each(venues)(
    'enforces active operational/country/global hierarchy without a home-region requirement (%s)',
    async (venueCode) => {
      await owner.query('UPDATE platform.venue_debug_config SET venue_code=$1', [venueCode]);
      // Owner-only adversarial fixture: existing hierarchy triggers normally prohibit
      // active children under an inactive parent. Independently exercise the guard.
      await owner.query('ALTER TABLE core.regions DISABLE TRIGGER USER');
      try {
        for (const code of ['tw-general', 'venue-test-tw', 'venue-test-global']) {
          await owner.query('UPDATE core.regions SET active=FALSE WHERE code=$1', [code]);
          await expect(checkin(true, venueCode)).rejects.toMatchObject({
            code: '42501',
            message: 'venue_unavailable'
          });
          await owner.query('UPDATE core.regions SET active=TRUE WHERE code=$1', [code]);
        }
      } finally {
        await owner.query(
          'UPDATE core.regions SET active=TRUE; ALTER TABLE core.regions ENABLE TRIGGER USER'
        );
      }
      expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(0);
      expect((await checkin(true, venueCode)).rows[0]?.data).toMatchObject({ isTest: true });
      await owner.query("UPDATE core.regions SET active=FALSE WHERE code='tw-general'");
      await expect(checkin(true, venueCode)).rejects.toMatchObject({ code: '42501' });
      await owner.query("UPDATE core.regions SET active=TRUE WHERE code='tw-general'");
    }
  );
  it.each(venues)(
    'denies past cutoff in the venue timezone, even with a valid code (%s)',
    async (venueCode) => {
      await owner.query('UPDATE platform.venue_debug_config SET venue_code=$1', [venueCode]);
      const timezone = (
        await owner.query<{ timezone: string }>(
          "SELECT CASE WHEN extract(hour FROM clock_timestamp() AT TIME ZONE 'UTC')>=1 THEN 'UTC' ELSE 'Etc/GMT-12' END AS timezone"
        )
      ).rows[0]!.timezone;
      await owner.query(
        `UPDATE core.practice_fields SET timezone=$1,active_time_rules='{"day_of_week":[0,1,2,3,4,5,6],"start_time":"00:00","end_time":"01:00"}' WHERE code=$2`,
        [timezone, venueCode]
      );
      try {
        await expect(checkin(true, venueCode)).rejects.toMatchObject({
          code: 'P0001',
          message: 'venue_outside_window'
        });
        expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(0);
      } finally {
        await owner.query("UPDATE core.practice_fields SET timezone='Asia/Taipei' WHERE code=$1", [
          venueCode
        ]);
      }
    }
  );
  it('exact API/DB expiry binding fails closed even when both expiries are individually valid', async () => {
    await owner.query(
      "UPDATE platform.venue_debug_config SET expires_at=expires_at-interval '1 millisecond'"
    );
    await expect(checkin()).rejects.toMatchObject({ code: '42501', message: 'venue_debug_denied' });
    await owner.query('UPDATE platform.venue_debug_config SET expires_at=$1', [expiresAt]);
    await expect(checkin(true, 'tw-location-test')).rejects.toMatchObject({ code: '42501' });
    expect((await checkin()).rows[0]?.data).toMatchObject({ isTest: true });
  });
  it('excludes tests from normal history and exposes only labeled own test history', async () => {
    await checkin();
    const formal = (
      await call("SELECT platform.venue_personal_history('line',$1) AS data", [subject])
    ).rows[0]?.data;
    expect(formal.totals).toEqual({ attendanceCount: 0, attendanceDays: 0, monthCount: 0 });
    expect(formal.entries).toEqual([]);
    const test = (await call("SELECT platform.venue_debug_history('line',$1) AS data", [subject]))
      .rows[0]?.data;
    expect(test.entries).toHaveLength(1);
    expect(test.entries[0]).toMatchObject({ isTest: true, verificationMode: 'distance_debug' });
    expect(JSON.stringify(test)).not.toMatch(/personId|latitude|longitude|synthetic-only/);
    expect(test.totals).toEqual(formal.totals);
  });
  it.each(venues)(
    'full HTTP %s uses actual GPS, preserves all identity claims and redacts headers/proofs/GPS',
    async (venueCode) => {
      await owner.query('UPDATE platform.venue_debug_config SET venue_code=$1', [venueCode]);
      let logs = '';
      const origin = 'https://synthetic.invalid';
      const config = {
        enabled: true as const,
        expiresAt,
        venueCode,
        tokenHash: hash
      };
      const app = buildApp({
        pool: runtime,
        logStream: {
          write: (chunk: string) => {
            logs += chunk;
          }
        },
        venueQr: { enabled: true, publicOrigin: origin, debug: config },
        venueSuite: { history: { enabled: true, publicOrigin: origin } },
        line: {
          channelSecret: 'synthetic-secret',
          channelAccessToken: 'synthetic-access',
          loginChannelId: '123',
          liffId: '123-test'
        }
      });
      const claims = {
        sub: subject,
        aud: '123',
        iss: 'https://access.line.me',
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      const verified = vi.fn(async () => new Response(JSON.stringify(claims)));
      vi.stubGlobal('fetch', verified);
      // Reusing a client correlation header must never reuse the DB proof nonce.
      const priorAudits = await owner.query<{ request_id: string }>(
        'SELECT request_id FROM audit.events'
      );
      const httpRequestId = crypto.randomUUID();
      const send = (debugToken: string | undefined = fixtureToken, venue: string = venueCode) =>
        app.inject({
          method: 'POST',
          url: '/api/line/venue-checkin',
          headers: {
            origin,
            'x-venue-checkin': '1',
            'x-request-id': httpRequestId,
            ...(debugToken === undefined ? {} : { 'x-venue-debug-token': debugToken })
          },
          payload: {
            idToken: 'synthetic-identity-private',
            venue,
            latitude: -25.1234567,
            longitude: 121.9876543
          }
        });
      try {
        const page = await app.inject('/line/venue-checkin?venue=' + venueCode + '&lang=zh_TW');
        expect(page.body).toContain('id="preview-debug-token"');
        if (venueCode === 'tw-location-test') expect(page.body).toContain('僅供測試，不計正式出席');
        const otherPage = await app.inject(
          '/line/venue-checkin?venue=' + venues.find((code) => code !== venueCode)!
        );
        expect(otherPage.body).not.toContain('id="preview-debug-token"');
        for (const value of [fixtureToken, hash, expiresAt]) expect(page.body).not.toContain(value);
        expect(
          await checkStartupReadiness(
            runtime,
            true,
            { history: { enabled: true, publicOrigin: origin } },
            true
          )
        ).toMatchObject({ ready: true });
        for (const patch of [
          { aud: 'wrong-channel' },
          { iss: 'https://wrong-issuer.invalid' },
          { exp: 0 }
        ]) {
          verified.mockImplementationOnce(
            async () => new Response(JSON.stringify({ ...claims, ...patch }))
          );
          expect((await send()).statusCode).toBe(401);
        }
        expect((await send('wrong'.repeat(8))).json()).toMatchObject({
          error: 'venue_debug_denied'
        });
        for (const venue of ['tw-test-two', ...venues.filter((code) => code !== venueCode)])
          expect((await send(fixtureToken, venue)).statusCode).toBe(403);
        for (const payload of [
          { idToken: 'synthetic-identity-private', venue: venueCode },
          {
            idToken: 'synthetic-identity-private',
            venue: venueCode,
            latitude: null,
            longitude: 121
          }
        ])
          expect(
            (
              await app.inject({
                method: 'POST',
                url: '/api/line/venue-checkin',
                headers: { origin, 'x-venue-checkin': '1', 'x-venue-debug-token': fixtureToken },
                payload
              })
            ).statusCode
          ).toBe(400);
        const success = await send();
        expect(success.statusCode).toBe(200);
        expect(success.json()).toMatchObject({
          ok: true,
          isTest: true,
          verificationMode: 'distance_debug',
          replayed: false
        });
        expect(success.headers['cache-control']).toBe('no-store');
        const replay = await send();
        expect(replay.json()).toMatchObject({ isTest: true, replayed: true });
        expect(success.headers['x-request-id']).toBe(httpRequestId);
        expect(replay.headers['x-request-id']).toBe(httpRequestId);
        const audits = await owner.query<{ request_id: string; metadata: { replayed: boolean } }>(
          "SELECT request_id,metadata FROM audit.events WHERE action='venue.qr_checkin' AND metadata->>'isTest'='true' AND NOT(request_id=ANY($1::uuid[])) ORDER BY occurred_at,id",
          [priorAudits.rows.map((row) => row.request_id)]
        );
        expect(audits.rows).toHaveLength(2);
        expect(audits.rows.map((row) => row.metadata.replayed)).toEqual([false, true]);
        const auditIds = audits.rows.map((row) => row.request_id);
        expect(new Set(auditIds).size).toBe(2);
        expect(auditIds).not.toContain(httpRequestId);
        const mappings = logs
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as unknown)
          .filter((record) => ownLogValue(record, 'event') === 'venue_debug_audit_attempt');
        expect(mappings).toHaveLength(2);
        for (const auditRequestId of auditIds) {
          expect(mappings).toContainEqual(
            expect.objectContaining({
              reqId: httpRequestId,
              auditRequestId,
              method: 'POST',
              route: '/api/line/venue-checkin'
            })
          );
        }
        expect(logs).not.toContain(hash);
        const identityCalls = verified.mock.calls.length;
        const expiredApiClock = vi
          .spyOn(Date, 'now')
          .mockReturnValue(Date.parse(config.expiresAt) + 1);
        try {
          expect((await send()).json()).toMatchObject({ error: 'venue_debug_denied' });
          expect(verified).toHaveBeenCalledTimes(identityCalls);
          const expiredPage = await app.inject('/line/venue-checkin?venue=' + venueCode);
          expect(expiredPage.body).not.toContain('id="preview-debug-token"');
          if (venueCode === 'tw-location-test') expect(expiredPage.body).toContain('尚未開放');
        } finally {
          expiredApiClock.mockRestore();
        }
        // API validation cannot replace independent DB enablement/scope/hash/expiry checks.
        for (const [sql, params] of [
          ['UPDATE platform.venue_debug_config SET enabled=FALSE', []],
          [
            'UPDATE platform.venue_debug_config SET venue_code=$1',
            [venues.find((code) => code !== venueCode)!]
          ],
          ['UPDATE platform.venue_debug_config SET token_hash=$1', ['f'.repeat(64)]],
          [
            "UPDATE platform.venue_debug_config SET expires_at=expires_at-interval '1 millisecond'",
            []
          ]
        ] as const) {
          await owner.query(sql, [...params]);
          expect((await send()).json()).toMatchObject({ ok: false, error: 'venue_debug_denied' });
          await owner.query(
            'UPDATE platform.venue_debug_config SET enabled=TRUE,venue_code=$1,token_hash=$2,expires_at=$3',
            [venueCode, hash, expiresAt]
          );
        }
        // Exercise actual HTTP→identity adapter→DB with current membership/consent,
        // not just a direct SQL denial. Every replay must revalidate live state.
        for (const [disable, restore, status] of [
          [
            'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp(); UPDATE identity.platform_identities SET revoked_at=clock_timestamp()',
            'UPDATE identity.platform_identities SET revoked_at=NULL; UPDATE identity.person_interaction_channels SET valid_to=NULL',
            403
          ],
          [
            'UPDATE platform.learner_privacy_acceptances SET revoked_at=clock_timestamp()',
            'UPDATE platform.learner_privacy_acceptances SET revoked_at=NULL',
            403
          ],
          [
            "UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp(); UPDATE identity.people SET status='suspended'",
            "UPDATE identity.people SET status='active'; UPDATE identity.person_interaction_channels SET valid_to=NULL",
            403
          ],
          [
            "UPDATE identity.onboarding_applications SET status='rejected',person_id=NULL,rejection_reason='Synthetic rejection'",
            "UPDATE identity.onboarding_applications SET status='approved',person_id='20000000-0000-4000-8000-000000000001',rejection_reason=NULL",
            403
          ],
          [
            'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp()',
            'UPDATE identity.person_interaction_channels SET valid_to=NULL',
            403
          ],
          [
            'UPDATE core.practice_fields SET is_active=FALSE',
            'UPDATE core.practice_fields SET is_active=TRUE',
            403
          ],
          [
            "UPDATE core.practice_fields SET active_time_rules=jsonb_build_object('day_of_week',jsonb_build_array((extract(dow FROM clock_timestamp() AT TIME ZONE timezone)::int+2)%7),'start_time','00:00','end_time','24:00')",
            `UPDATE core.practice_fields SET active_time_rules='{"day_of_week":[0,1,2,3,4,5,6],"start_time":"00:00","end_time":"24:00"}'`,
            409
          ]
        ] as const) {
          await owner.query(disable);
          try {
            expect((await send()).statusCode).toBe(status);
            expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(1);
          } finally {
            await owner.query(restore);
          }
        }
        expect(
          (
            await owner.query(
              "SELECT 1 FROM audit.events WHERE action='venue.qr_checkin' AND NOT(request_id=ANY($1::uuid[]))",
              [priorAudits.rows.map((row) => row.request_id)]
            )
          ).rowCount
        ).toBe(2);
        const history = (view?: string) =>
          app.inject({
            method: 'POST',
            url: '/api/line/venue-history',
            headers: { origin, 'x-venue-history': '1' },
            payload: { idToken: 'synthetic-identity-private', ...(view ? { view } : {}) }
          });
        expect((await history()).json()).toMatchObject({
          totals: { attendanceCount: 0, attendanceDays: 0, monthCount: 0 },
          entries: []
        });
        expect((await history('test')).json().entries).toEqual([
          expect.objectContaining({ isTest: true, verificationMode: 'distance_debug' })
        ]);
        // The token-free path is still a real radius check, never an inferred test replay.
        const normal = await app.inject({
          method: 'POST',
          url: '/api/line/venue-checkin',
          headers: { origin, 'x-venue-checkin': '1' },
          payload: {
            idToken: 'synthetic-identity-private',
            venue: 'tw-taipei-cks',
            latitude: -25.1234567,
            longitude: 121.9876543
          }
        });
        expect(normal.json()).toMatchObject({ error: 'outside_radius' });
        await owner.query(
          "UPDATE platform.venue_debug_config SET configured_at=clock_timestamp()-interval '1 hour',expires_at=date_trunc('milliseconds',clock_timestamp()-interval '1 second')"
        );
        expect((await send()).json()).toMatchObject({ error: 'venue_debug_denied' });
        const audit = await owner.query<{ data: unknown }>(
          'SELECT metadata AS data FROM audit.events'
        );
        expect(JSON.stringify(audit.rows)).not.toMatch(
          /synthetic-only|synthetic-identity-private|proof|token|latitude|longitude|-25\.1234567|121\.9876543/
        );
        expect(logs).not.toMatch(
          /synthetic-only|synthetic-identity-private|proof|tokenHash|latitude|longitude|-25\.1234567|121\.9876543/
        );
        expect(await readFile(directory! + '/server.log', 'utf8')).not.toMatch(
          /synthetic-only|synthetic-identity-private|-25\.1234567|121\.9876543/
        );
      } finally {
        await app.close();
      }
    }
  );
  it('excludes tests from all venue admin read/export/people/detail totals and leaves daily rewards unchanged', async () => {
    const daily = () =>
      owner.query<{ data: unknown }>(
        `SELECT jsonb_build_object('metrics',core.practice_metrics('20000000-0000-4000-8000-000000000001',CURRENT_DATE),'checkins',(SELECT count(*) FROM core.checkins),'badges',(SELECT count(*) FROM core.person_practice_badges),'jobs',(SELECT count(*) FROM ops.practice_badge_jobs),'transitions',(SELECT count(*) FROM audit.achievement_transitions)) AS data`
      );
    const before = (await daily()).rows;
    const scope = (
      await owner.query<{ id: string }>("SELECT id FROM core.regions WHERE code='tw-general'")
    ).rows[0]!.id;
    const dates = (
      await owner.query<{ from: string; until: string }>(
        'SELECT (CURRENT_DATE-2)::text AS from,(CURRENT_DATE+3)::text AS until'
      )
    ).rows[0]!;
    const read = (exporting: boolean) =>
      readVenueQrAttendance(
        runtime,
        crypto.randomUUID(),
        (exporting ? 'e' : 'v').repeat(43),
        parseVenueReadRequest({
          operation: exporting ? 'attendance.export' : 'attendance.read',
          regionId: scope,
          ...dates,
          filters: { fieldId: null, method: null },
          ...(exporting ? {} : { page: 1, limit: 100 })
        })
      );
    const people = (mode: 'people' | 'detail', exporting: boolean) => {
      const query = parseVenuePeopleQuery({
        mode,
        regionId: scope,
        fieldId: null,
        personId: mode === 'detail' ? '20000000-0000-4000-8000-000000000001' : null,
        period: dates,
        search: '',
        sort: 'recent',
        direction: 'desc',
        page: 1,
        limit: 20
      });
      return createVenuePeopleService(runtime).read(
        crypto.randomUUID(),
        (exporting ? 'e' : 'v').repeat(43),
        query,
        exporting
      );
    };
    await checkin();
    await owner.query("UPDATE platform.venue_debug_config SET venue_code='tw-location-test'");
    await checkin(true, 'tw-location-test');
    for (const exporting of [false, true]) {
      expect(await read(exporting)).toMatchObject({
        totals: { attendanceCount: 0, attendanceDays: 0, learnerCount: 0 },
        rows: []
      });
      for (const mode of ['people', 'detail'] as const) {
        const result = await people(mode, exporting);
        expect(result).toMatchObject({
          total: 0,
          totals: { attendanceCount: 0, attendanceDays: 0, learnerCount: 0 },
          rows: []
        });
        if (exporting) expect(encodeVenuePeopleCsv(result)).not.toContain('SYNTHETIC');
      }
    }
    await checkin(false, 'tw-taipei-cks', 25);
    for (const exporting of [false, true]) {
      expect(await read(exporting)).toMatchObject({
        totals: { attendanceCount: 1, attendanceDays: 1, learnerCount: 1 }
      });
      for (const mode of ['people', 'detail'] as const) {
        const result = await people(mode, exporting);
        expect(result).toMatchObject({
          total: 1,
          totals: { attendanceCount: 1, attendanceDays: 1, learnerCount: 1 }
        });
        expect(result.rows).toHaveLength(1);
      }
    }
    const formal = (
      await call("SELECT platform.venue_personal_history('line',$1) AS data", [subject])
    ).rows[0]?.data;
    expect(formal.totals).toEqual({ attendanceCount: 1, attendanceDays: 1, monthCount: 1 });
    expect(formal.entries).toHaveLength(1);
    expect((await daily()).rows).toEqual(before);
  });
  it.each(venues)(
    'revalidates active and approved people, channel, venue status and DB expiry on every replay (%s)',
    async (venueCode) => {
      await owner.query('UPDATE platform.venue_debug_config SET venue_code=$1', [venueCode]);
      await checkin(true, venueCode);
      for (const [disable, restore] of [
        [
          "UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp(); UPDATE identity.people SET status='suspended'",
          "UPDATE identity.people SET status='active'; UPDATE identity.person_interaction_channels SET valid_to=NULL"
        ],
        [
          "UPDATE identity.onboarding_applications SET status='rejected',person_id=NULL,rejection_reason='Synthetic rejection'",
          "UPDATE identity.onboarding_applications SET status='approved',person_id='20000000-0000-4000-8000-000000000001',rejection_reason=NULL"
        ],
        [
          'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp()',
          'UPDATE identity.person_interaction_channels SET valid_to=NULL'
        ],
        [
          'UPDATE core.practice_fields SET is_active=FALSE',
          'UPDATE core.practice_fields SET is_active=TRUE'
        ]
      ]) {
        await owner.query(disable!);
        await expect(checkin(true, venueCode)).rejects.toMatchObject({ code: '42501' });
        await owner.query(restore!);
      }
      expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(1);
    }
  );
  it('denies direct table/context/key/role access and forged GUC authorization', async () => {
    for (const sql of [
      'SELECT * FROM platform.venue_debug_config',
      'SELECT * FROM platform.venue_debug_context',
      'SELECT platform.venue_debug_person()',
      'SET LOCAL ROLE qigong_venue_debug',
      "INSERT INTO platform.venue_debug_context VALUES(pg_backend_pid(),pg_current_xact_id(),'20000000-0000-4000-8000-000000000001')"
    ])
      await expect(call(sql)).rejects.toMatchObject({ code: '42501' });
    await call("SELECT set_config('qigong.venue_debug','true',TRUE)");
    await expect(
      call('SELECT platform.venue_debug_checkin($1,$2,25,121,$3,$4,$5)', [
        subject,
        'tw-taipei-cks',
        Math.floor(Date.now() / 1000),
        Date.parse(expiresAt),
        '0'.repeat(64)
      ])
    ).rejects.toMatchObject({ code: '42501' });
    const roles = (
      await owner.query(
        "SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='qigong_venue_debug'"
      )
    ).rows;
    expect(roles).toEqual([{ rolcanlogin: false, rolsuper: false, rolbypassrls: false }]);
    expect(
      (await owner.query("SELECT 1 FROM pg_class WHERE relowner='qigong_venue_debug'::regrole"))
        .rowCount
    ).toBe(0);
    expect(
      (
        await owner.query(
          "SELECT 1 FROM pg_class WHERE oid IN ('core.field_attendance'::regclass,'core.practice_fields'::regclass,'platform.venue_debug_context'::regclass,'platform.venue_debug_config'::regclass,'audit.events'::regclass) AND (NOT relrowsecurity OR NOT relforcerowsecurity)"
        )
      ).rowCount
    ).toBe(0);
    const execution = await owner.query<{
      signature: string;
      api: boolean;
      worker: boolean;
      public_access: boolean;
    }>(
      `SELECT p.oid::regprocedure::text signature,has_function_privilege('qigong_api_runtime',p.oid,'EXECUTE') api,has_function_privilege('qigong_worker_runtime',p.oid,'EXECUTE') worker,EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_access FROM pg_proc p WHERE p.oid IN ('platform.venue_debug_checkin(text,text,double precision,double precision,bigint,bigint,text)'::regprocedure,'platform.venue_debug_history(text,text,text,text,bigint)'::regprocedure)`
    );
    expect(
      (
        await owner.query(`SELECT
      has_column_privilege('qigong_venue_qr_writer','core.field_attendance','is_test','INSERT') AS test_insert,
      has_column_privilege('qigong_venue_qr_writer','core.field_attendance','verification_mode','INSERT') AS mode_insert,
      has_table_privilege('qigong_api_runtime','core.field_attendance','INSERT') AS runtime_insert`)
      ).rows
    ).toEqual([{ test_insert: false, mode_insert: false, runtime_insert: false }]);
    expect(execution.rows).toHaveLength(2);
    for (const row of execution.rows)
      expect(row).toMatchObject({ api: true, worker: false, public_access: false });
    expect(
      (
        await owner.query(
          "SELECT 1 FROM pg_auth_members WHERE roleid='qigong_venue_debug'::regrole OR member='qigong_venue_debug'::regrole"
        )
      ).rowCount
    ).toBe(0);
  });
});
