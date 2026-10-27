/** Synthetic credentials ONLY. Never connects through TEST_DATABASE_URL. */
import { createHash, createHmac } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
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
      UPDATE core.practice_fields SET is_active=TRUE,active_time_rules='{"day_of_week":[0,1,2,3,4,5,6],"start_time":"00:00","end_time":"24:00"}';`);
    await owner.query(
      "INSERT INTO platform.venue_debug_config(enabled,expires_at,token_hash) VALUES(TRUE,clock_timestamp()+interval '1 hour',$1)",
      [hash]
    );
  });
  afterEach(() => vi.unstubAllGlobals());
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
    await expect(checkin(true, 'tw-location-test', -25, 40)).rejects.toMatchObject({
      code: '42501'
    });
    const otherRequest = crypto.randomUUID();
    const issued = Math.floor(Date.now() / 1000);
    const proof = createHmac('sha256', Buffer.from(hash, 'hex'))
      .update([otherRequest, subject, 'tw-location-test', issued].join('|'))
      .digest('hex');
    // Even a valid proof for a different transaction nonce cannot authorize this one.
    await expect(
      call('SELECT platform.venue_debug_checkin($1,$2,-25,121,$3,$4)', [
        subject,
        'tw-location-test',
        issued,
        proof
      ])
    ).rejects.toMatchObject({ code: '42501' });
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
    await owner.query('TRUNCATE platform.venue_debug_config');
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
  it('full HTTP success uses actual GPS, preserves all identity claims and redacts headers/proofs/GPS', async () => {
    let logs = '';
    const origin = 'https://synthetic.invalid';
    const config = {
      enabled: true as const,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
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
    const send = (debugToken: string | undefined = fixtureToken, venue = 'tw-location-test') =>
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
      expect((await send('wrong'.repeat(8))).json()).toMatchObject({ error: 'venue_debug_denied' });
      expect((await send(fixtureToken, 'tw-test-two')).statusCode).toBe(403);
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
      } finally {
        expiredApiClock.mockRestore();
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
          "UPDATE core.practice_fields SET active_time_rules=jsonb_build_object('day_of_week',jsonb_build_array((extract(dow FROM clock_timestamp() AT TIME ZONE timezone)::int+1)%7),'start_time','00:00','end_time','24:00')",
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
          venue: 'tw-location-test',
          latitude: -25.1234567,
          longitude: 121.9876543
        }
      });
      expect(normal.json()).toMatchObject({ error: 'outside_radius' });
      await owner.query(
        "UPDATE platform.venue_debug_config SET expires_at=clock_timestamp()-interval '1 second'"
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
  });
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
    await checkin(false, 'tw-location-test', 25);
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
  it('revalidates active and approved people, channel, venue status and DB expiry on every replay', async () => {
    await checkin();
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
      await expect(checkin()).rejects.toMatchObject({ code: '42501' });
      await owner.query(restore!);
    }
    expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(1);
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
      `SELECT p.oid::regprocedure::text signature,has_function_privilege('qigong_api_runtime',p.oid,'EXECUTE') api,has_function_privilege('qigong_worker_runtime',p.oid,'EXECUTE') worker,EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_access FROM pg_proc p WHERE p.oid IN ('platform.venue_debug_checkin(text,text,double precision,double precision,bigint,text)'::regprocedure,'platform.venue_debug_history(text,text,text,text,bigint)'::regprocedure)`
    );
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
