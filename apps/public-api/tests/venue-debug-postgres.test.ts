/** Synthetic credentials ONLY. Never connects through TEST_DATABASE_URL. */
import { createHash, createHmac } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withRequestContext } from '@qigong/database';
import { runMigrations } from '../../../packages/database/src/migrations.js';

const directory = process.env.VENUE_DEBUG_ISOLATED_PG_DIR;
const subject = 'U' + 'a'.repeat(32);
const fixtureToken = 'synthetic-only-'.padEnd(43, 'x');
const hash = createHash('sha256').update(fixtureToken).digest('hex');
let owner: Pool;
let runtime: Pool;
const call = (sql: string, params: readonly unknown[] = []) =>
  withRequestContext(runtime, 'qigong_api_runtime', { requestId: crypto.randomUUID() }, (c) =>
    c.query(sql, [...params])
  );
const checkin = (test = true, venue = 'tw-location-test', lat = -25, issuedOffset = 0) => {
  const requestId = crypto.randomUUID();
  const issued = Math.floor(Date.now() / 1000) + issuedOffset;
  const proof = createHmac('sha256', Buffer.from(hash, 'hex'))
    .update([requestId, subject, venue, issued].join('|'))
    .digest('hex');
  return withRequestContext(runtime, 'qigong_api_runtime', { requestId }, (c) =>
    c.query<{ data: { replayed: boolean; isTest?: boolean } }>(
      test
        ? 'SELECT platform.venue_debug_checkin($1,$2,$3,$4,$5,$6) AS data'
        : 'SELECT platform.venue_qr_checkin($1,$2,$3,$4) AS data',
      test ? [subject, venue, lat, 121, issued, proof] : [subject, venue, lat, 121]
    )
  );
};
describe.skipIf(!directory)('debug: owned socket-only PG17 full 55-chain', () => {
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
    const result = await runMigrations(owner, resolve('../../migrations'));
    expect(result.applied).toHaveLength(55);
    expect(result.currentVersion).toBe('0055_venue_distance_debug.sql');
    expect((await owner.query('SELECT 1 FROM platform.venue_debug_config')).rowCount).toBe(0);
    expect((await runMigrations(owner, resolve('../../migrations'))).applied).toEqual([]);
    await owner.query(
      (
        await readFile(new URL('./fixtures/venue-qr-synthetic.sql', import.meta.url), 'utf8')
      ).replaceAll('tw-test-one', 'tw-location-test')
    );
    runtime = new Pool({ ...options, user: 'venue_qr_test_login', max: 12 });
  }, 120000);
  beforeEach(async () => {
    await owner.query(`TRUNCATE core.field_attendance,platform.venue_debug_config;
      UPDATE platform.learner_privacy_acceptances SET revoked_at=NULL;
      UPDATE identity.platform_identities SET revoked_at=NULL;
      UPDATE identity.person_interaction_channels SET valid_to=NULL;
      UPDATE core.practice_fields SET is_active=TRUE,active_time_rules='{"day_of_week":[0,1,2,3,4,5,6],"start_time":"00:00","end_time":"24:00"}';`);
    await owner.query(
      "INSERT INTO platform.venue_debug_config(enabled,expires_at,token_hash) VALUES(TRUE,clock_timestamp()+interval '1 hour',$1)",
      [hash]
    );
  });
  afterAll(async () => {
    await runtime?.end();
    await owner?.end();
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
      checkin(false, 'tw-location-test', 25)
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    expect(rows.map((r) => r.rows[0]?.data.replayed).sort()).toEqual([false, false, true]);
    expect(
      (await owner.query('SELECT is_test FROM core.field_attendance ORDER BY is_test')).rows
    ).toEqual([{ is_test: false }, { is_test: true }]);
    expect((await checkin(false, 'tw-location-test', 25)).rows[0]?.data).toMatchObject({
      replayed: true
    });
  });
  it('rejects disabled, expired, wrong venue, stale or forged proof without writing', async () => {
    await expect(checkin(true, 'tw-test-two')).rejects.toMatchObject({ code: '42501' });
    await expect(checkin(true, 'tw-location-test', -25, -40)).rejects.toMatchObject({
      code: '42501'
    });
    await expect(
      call('SELECT platform.venue_debug_checkin($1,$2,25,121,$3,$4)', [
        subject,
        'tw-location-test',
        Math.floor(Date.now() / 1000),
        '0'.repeat(64)
      ])
    ).rejects.toMatchObject({ code: '42501' });
    await owner.query('UPDATE platform.venue_debug_config SET enabled=FALSE');
    await expect(checkin()).rejects.toMatchObject({ code: '42501' });
    await owner.query(
      "UPDATE platform.venue_debug_config SET enabled=TRUE,expires_at=clock_timestamp()-interval '1 second'"
    );
    await expect(checkin()).rejects.toMatchObject({ code: '42501' });
    expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(0);
  });
  it('revalidates identity, consent and time window', async () => {
    await owner.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp(); UPDATE identity.platform_identities SET revoked_at=clock_timestamp()'
    );
    await expect(checkin()).rejects.toMatchObject({ code: '42501' });
    await owner.query(
      'UPDATE identity.platform_identities SET revoked_at=NULL; UPDATE identity.person_interaction_channels SET valid_to=NULL; UPDATE platform.learner_privacy_acceptances SET revoked_at=clock_timestamp()'
    );
    await expect(checkin()).rejects.toMatchObject({ code: '42501' });
    await owner.query(`UPDATE platform.learner_privacy_acceptances SET revoked_at=NULL;
      UPDATE core.practice_fields SET active_time_rules=jsonb_build_object('day_of_week',jsonb_build_array((extract(dow FROM clock_timestamp() AT TIME ZONE timezone)::int+1)%7),'start_time','00:00','end_time','24:00');`);
    await expect(checkin()).rejects.toMatchObject({
      code: 'P0001',
      message: 'venue_outside_window'
    });
    expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(0);
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
      call('SELECT platform.venue_debug_checkin($1,$2,25,121,$3,$4)', [
        subject,
        'tw-location-test',
        Math.floor(Date.now() / 1000),
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
      (
        await owner.query(
          "SELECT 1 FROM pg_auth_members WHERE roleid='qigong_venue_debug'::regrole OR member='qigong_venue_debug'::regrole"
        )
      ).rowCount
    ).toBe(0);
  });
});
