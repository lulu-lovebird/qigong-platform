import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
import {
  buildApp,
  checkStartupReadiness,
  createVenueEntryModeResolver
} from '../../../apps/public-api/src/app.js';
import { registerWhatsAppVenueRoutes } from '../../../apps/public-api/src/whatsapp-venue-routes.js';
import { whatsappVenueHistorySchema } from '../../../apps/public-api/src/whatsapp-venue-contract.js';
import {
  whatsappCsrfCookie,
  whatsappSessionCookie
} from '../../../apps/public-api/src/whatsapp-browser-session.js';
const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const writerSql = 'SELECT platform.whatsapp_venue_checkin($1,$2,$3,$4,$5) data';
const rules = { day_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '00:00', end_time: '24:00' };
interface Receipt {
  ok: true;
  venue: { code: string; name: string; timezone: string };
  checkedInAt: string;
  attendanceDate: string;
  replayed: boolean;
}
suite('migrated WhatsApp venue writer (real isolated PostgreSQL)', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>> | undefined;
  let runtimePool: pg.Pool | undefined;
  let api: ReturnType<typeof buildApp> | undefined;
  const publicOrigin = 'https://checkin.baiyinqigong.org';
  const loginRole = 'wa_writer_test_' + randomUUID().replaceAll('-', '');
  let loginCreated = false;
  let person: string;
  let identity: string;
  const session = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  const subject = '60110000123';
  const owner = () => {
    if (!db) throw Error('Missing test DB');
    return db.pool;
  };
  const runtime = <T>(run: Parameters<typeof withRequestContext<T>>[3]) => {
    if (!runtimePool) throw Error('Missing runtime pool');
    return withRequestContext(runtimePool, 'qigong_api_runtime', { requestId: randomUUID() }, run);
  };
  const args = (venue = 'my-writer-hall', lat = 3, lon = 101) => [session, csrf, venue, lat, lon];
  const write = (venue?: string, lat?: number, lon?: number) =>
    runtime(
      async (c) =>
        (await c.query<{ data: Receipt }>(writerSql, args(venue, lat, lon))).rows[0]!.data
    );
  const history = (month: string | null = null, venue: string | null = null, page = 1) =>
    runtime(async (c) => {
      const result = await c.query<{ data: unknown }>(
        'SELECT platform.whatsapp_venue_history($1,$2,$3,$4,$5) data',
        [session, csrf, month, venue, page]
      );
      return whatsappVenueHistorySchema.parse(result.rows[0]!.data);
    });
  const beginRuntime = async () => {
    if (!runtimePool) throw Error('Missing runtime pool');
    const c = await runtimePool.connect();
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE qigong_api_runtime');
    await c.query(
      "SELECT set_config('qigong.request_id',$1,TRUE),set_config('qigong.person_id','',TRUE),set_config('qigong.principal_id','',TRUE)",
      [randomUUID()]
    );
    return c;
  };
  const waitForLock = async (pid: number) => {
    for (let i = 0; i < 100; i++) {
      const r = await owner().query<{ waiting: boolean }>(
        "SELECT wait_event_type='Lock' waiting FROM pg_stat_activity WHERE pid=$1",
        [pid]
      );
      if (r.rows[0]?.waiting) return;
      await delay(10);
    }
    throw Error('Expected isolated backend to wait for a lock');
  };
  beforeAll(async () => {
    db = await createIsolatedTestDatabase(base!);
    const migration = await runMigrations(
      owner(),
      path.join(root, 'migrations'),
      'vitest-wa-writer'
    );
    expect(migration.currentVersion).toBe('0065_whatsapp_venue_authority.sql');
    expect((await runMigrations(owner(), path.join(root, 'migrations'))).applied).toEqual([]);
    const password = randomBytes(24).toString('hex');
    await owner().query(
      `CREATE ROLE ${loginRole} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`
    );
    loginCreated = true;
    await owner().query(`GRANT qigong_api_runtime TO ${loginRole}`);
    const url = new URL(db.databaseUrl);
    url.username = loginRole;
    url.password = password;
    runtimePool = new pg.Pool({ connectionString: url.href, max: 5 });
    api = buildApp({ pool: runtimePool, logger: false });
    registerWhatsAppVenueRoutes(api, runtimePool, { enabled: true, publicOrigin });
    const principal = (
      await owner().query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://wa-writer.invalid','reviewer','Synthetic') RETURNING id"
      )
    ).rows[0]!.id;
    const region = (
      await owner().query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('ww-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'ww-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'ww-operation','operational','地區','Region' FROM k RETURNING id"
      )
    ).rows[0]!.id;
    person = (
      await owner().query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic writer learner','Asia/Kuala_Lumpur') RETURNING id"
      )
    ).rows[0]!.id;
    identity = (
      await owner().query<{ id: string }>(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'whatsapp',$2) RETURNING id",
        [person, subject]
      )
    ).rows[0]!.id;
    await owner().query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
      [person, identity]
    );
    await owner().query(
      "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-1)",
      [person, region]
    );
    await owner().query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('whatsapp',$1,'Synthetic','Synthetic','synthetic@example.invalid',$2,$3,'approved',$4,CURRENT_TIMESTAMP,$5)",
      [subject, '+' + subject, region, person, principal]
    );
    await owner().query(
      "INSERT INTO platform.whatsapp_browser_sessions(token_hash,csrf_hash,identity_id,person_id,remembered,expires_at) VALUES(public.digest($1,'sha256'),public.digest($2,'sha256'),$3,$4,TRUE,clock_timestamp()+INTERVAL '1 day')",
      [session, csrf, identity, person]
    );
    for (const [code, zone] of [
      ['my-writer-hall', 'Asia/Kuala_Lumpur'],
      ['sg-writer-hall', 'Asia/Singapore'],
      ['hk-writer-hall', 'Asia/Hong_Kong']
    ])
      await owner().query(
        'INSERT INTO core.practice_fields(region_id,code,name_zh_tw,latitude,longitude,radius_meters,timezone,active_time_rules) VALUES($1,$2,$3,3,101,100,$4,$5)',
        [region, code, 'Synthetic venue', zone, rules]
      );
  }, 60000);
  beforeEach(async () => {
    if (!person) return;
    await owner().query('TRUNCATE core.field_attendance');
    await owner().query("UPDATE identity.people SET status='active' WHERE id=$1", [person]);
    await owner().query('UPDATE identity.platform_identities SET revoked_at=NULL WHERE id=$1', [
      identity
    ]);
    await owner().query(
      'UPDATE identity.person_interaction_channels SET valid_to=NULL WHERE platform_identity_id=$1',
      [identity]
    );
    await owner().query(
      "UPDATE identity.onboarding_applications SET status='approved' WHERE person_id=$1",
      [person]
    );
    await owner().query(
      "UPDATE platform.whatsapp_browser_sessions SET created_at=clock_timestamp()-INTERVAL '1 day',expires_at=clock_timestamp()+INTERVAL '1 day',revoked_at=NULL"
    );
    await owner().query('UPDATE core.practice_fields SET is_active=TRUE,active_time_rules=$1', [
      rules
    ]);
    await owner().query('DELETE FROM platform.learner_privacy_acceptances');
    await owner().query(
      "UPDATE platform.learner_privacy_policies SET state='draft',published_at=NULL"
    );
  });
  afterAll(async () => {
    if (api) await api.close();
    if (runtimePool) await runtimePool.end();
    if (loginCreated) await owner().query(`DROP ROLE ${loginRole}`);
    // Shared fixture cleanup removes only newly-created orphaned migration roles.
    if (db) await db.dispose();
  });
  it('preserves real schema65 health, LINE capability checks and the default-off WhatsApp boundary', async () => {
    if (!runtimePool) throw Error('Missing runtime pool');
    expect(await checkStartupReadiness(runtimePool, true)).toMatchObject({ ready: true });
    expect(await createVenueEntryModeResolver(runtimePool)(randomUUID())).toBe('guided');
    const plain = buildApp({ pool: runtimePool, logger: false });
    try {
      const health = await plain.inject('/health/ready');
      expect(health.statusCode, health.body).toBe(200);
      expect(health.json()).toMatchObject({
        ready: true,
        migration: { currentVersion: '0065_whatsapp_venue_authority.sql' }
      });
      expect(
        (await plain.inject({ method: 'POST', url: '/api/whatsapp/venue-checkin', payload: {} }))
          .statusCode
      ).toBe(404);
    } finally {
      await plain.close();
    }
  });
  it('gates WhatsApp enablement on real facade ACLs, isolated roles and restrictive row-lock policies', async () => {
    if (!runtimePool) throw Error('Missing runtime pool');
    expect(await checkStartupReadiness(runtimePool, false, {}, false, true)).toMatchObject({
      ready: true
    });
    const changes = [
      [
        'REVOKE EXECUTE ON FUNCTION platform.whatsapp_venue_history(text,text,text,text,integer) FROM qigong_api_runtime',
        'GRANT EXECUTE ON FUNCTION platform.whatsapp_venue_history(text,text,text,text,integer) TO qigong_api_runtime'
      ],
      [
        'ALTER ROLE qigong_whatsapp_venue_history_reader LOGIN',
        'ALTER ROLE qigong_whatsapp_venue_history_reader NOLOGIN'
      ],
      [
        'ALTER POLICY wa_venue_never_update ON identity.people WITH CHECK(TRUE)',
        'ALTER POLICY wa_venue_never_update ON identity.people WITH CHECK(FALSE)'
      ],
      [
        'ALTER TABLE platform.whatsapp_browser_sessions NO FORCE ROW LEVEL SECURITY',
        'ALTER TABLE platform.whatsapp_browser_sessions FORCE ROW LEVEL SECURITY'
      ]
    ];
    for (const [change, restore] of changes) {
      try {
        await owner().query(change!);
        expect(await checkStartupReadiness(runtimePool, false, {}, false, true)).toMatchObject({
          ready: false,
          reason: 'venue_feature_not_ready',
          capability: { feature: 'whatsappVenue', ready: false }
        });
      } finally {
        await owner().query(restore!);
      }
    }
    expect(await checkStartupReadiness(runtimePool, false, {}, false, true)).toMatchObject({
      ready: true
    });
  });
  it('commits a real HTTP write only through the explicitly registered dedicated facade', async () => {
    if (!api) throw Error('Missing isolated test API');
    const response = await api.inject({
      method: 'POST',
      url: '/api/whatsapp/venue-checkin',
      headers: {
        origin: publicOrigin,
        cookie: `${whatsappSessionCookie}=${session}; ${whatsappCsrfCookie}=${csrf}`,
        'x-whatsapp-csrf-token': csrf
      },
      payload: { venue: 'my-writer-hall', latitude: 3, longitude: 101 }
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      replayed: false,
      venue: { code: 'my-writer-hall' }
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain(session);
    expect(response.body).not.toContain(person);
    expect(
      (await owner().query('SELECT count(*)::int count FROM core.field_attendance')).rows[0]
    ).toEqual({ count: 1 });
  });
  it('rejects invalid real HTTP credentials and body authority without writing', async () => {
    if (!api) throw Error('Missing isolated test API');
    const headers = {
      origin: publicOrigin,
      cookie: `${whatsappSessionCookie}=${session}; ${whatsappCsrfCookie}=${csrf}`,
      'x-whatsapp-csrf-token': csrf
    };
    const payload = { venue: 'my-writer-hall', latitude: 3, longitude: 101 };
    expect(
      (
        await api.inject({
          method: 'POST',
          url: '/api/whatsapp/venue-checkin',
          headers,
          payload: { ...payload, personId: person }
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await api.inject({
          method: 'POST',
          url: '/api/whatsapp/venue-checkin',
          headers: { ...headers, 'x-whatsapp-csrf-token': 'x'.repeat(43) },
          payload
        })
      ).statusCode
    ).toBe(403);
    await owner().query(
      'UPDATE platform.whatsapp_browser_sessions SET revoked_at=clock_timestamp()'
    );
    expect(
      (await api.inject({ method: 'POST', url: '/api/whatsapp/venue-checkin', headers, payload }))
        .statusCode
    ).toBe(401);
    expect(
      (await owner().query('SELECT count(*)::int count FROM core.field_attendance')).rows[0]
    ).toEqual({ count: 0 });
  });
  it('writes one formal attendance without storing raw GPS or sending chat receipts', async () => {
    const before = (await owner().query('SELECT count(*) count FROM ops.channel_practice_receipts'))
      .rows[0];
    const result = await write();
    expect(result).toMatchObject({
      ok: true,
      venue: { code: 'my-writer-hall', timezone: 'Asia/Kuala_Lumpur' },
      replayed: false
    });
    const saved = (
      await owner().query(
        'SELECT person_id,user_latitude,user_longitude,is_test,verification_mode FROM core.field_attendance'
      )
    ).rows;
    expect(saved).toEqual([
      {
        person_id: person,
        user_latitude: null,
        user_longitude: null,
        is_test: false,
        verification_mode: 'standard'
      }
    ]);
    expect(
      (await owner().query('SELECT count(*) count FROM ops.channel_practice_receipts')).rows[0]
    ).toEqual(before);
  });
  it('returns the original stored timestamp on a valid same-day replay', async () => {
    const first = await write();
    const second = await write();
    expect(second.replayed).toBe(true);
    expect(second.checkedInAt).toBe(first.checkedInAt);
    expect(
      (await owner().query('SELECT count(*)::int count FROM core.field_attendance')).rows[0]
    ).toEqual({ count: 1 });
  });
  it('serializes concurrent duplicate saves into one formal attendance', async () => {
    const results = await Promise.all([write(), write()]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(
      (await owner().query('SELECT count(*)::int count FROM core.field_attendance')).rows[0]
    ).toEqual({ count: 1 });
  });
  it.each(['my-writer-hall', 'sg-writer-hall', 'hk-writer-hall'])(
    'stores the venue-local date for %s',
    async (venue) => {
      const result = await write(venue);
      const day = (
        await owner().query<{ local_date: string }>(
          'SELECT ($1::timestamptz AT TIME ZONE $2)::date::text AS local_date',
          [result.checkedInAt, result.venue.timezone]
        )
      ).rows[0]!.local_date;
      expect(result.attendanceDate).toBe(day);
    }
  );
  it('counts different venues independently', async () => {
    await write();
    await write('sg-writer-hall');
    expect(
      (await owner().query('SELECT count(*)::int count FROM core.field_attendance')).rows[0]
    ).toEqual({ count: 2 });
  });
  it.each(['tw-location-test', 'my-unknown-hall'])(
    'rejects unavailable/test venue %s without a write',
    async (code) => {
      await expect(write(code)).rejects.toMatchObject({ code: '42501' });
      expect(
        (await owner().query('SELECT count(*)::int count FROM core.field_attendance')).rows[0]
      ).toEqual({ count: 0 });
    }
  );
  it('rechecks radius even for replay', async () => {
    await write();
    await expect(write(undefined, 4, 102)).rejects.toMatchObject({
      message: 'venue_outside_radius'
    });
    expect(
      (await owner().query('SELECT count(*)::int count FROM core.field_attendance')).rows[0]
    ).toEqual({ count: 1 });
  });
  it('rechecks the current schedule even for an existing attendance', async () => {
    await write();
    await owner().query(
      "UPDATE core.practice_fields SET active_time_rules=jsonb_build_object('day_of_week',jsonb_build_array((extract(dow FROM clock_timestamp() AT TIME ZONE timezone)::int+3)%7),'start_time','00:00','end_time','24:00') WHERE code='my-writer-hall'"
    );
    await expect(write()).rejects.toMatchObject({ message: 'venue_outside_window' });
    expect(
      (await owner().query('SELECT count(*)::int count FROM core.field_attendance')).rows[0]
    ).toEqual({ count: 1 });
  });
  it.each([NaN, Infinity, -Infinity, 91])('rejects invalid SQL latitude %s', async (latitude) => {
    await expect(write(undefined, latitude, 101)).rejects.toMatchObject({ code: '42501' });
    expect(
      (await owner().query('SELECT count(*)::int count FROM core.field_attendance')).rows[0]
    ).toEqual({ count: 0 });
  });
  it('rechecks the approved application and rejects a closed primary channel', async () => {
    await owner().query(
      "UPDATE identity.onboarding_applications SET status='rejected',person_id=NULL WHERE external_subject_id=$1 AND platform='whatsapp'",
      [subject]
    );
    try {
      await expect(write()).rejects.toMatchObject({ code: '42501' });
    } finally {
      await owner().query(
        "UPDATE identity.onboarding_applications SET status='approved',person_id=$1 WHERE external_subject_id=$2 AND platform='whatsapp'",
        [person, subject]
      );
    }
    await owner().query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE platform_identity_id=$1',
      [identity]
    );
    await owner().query('UPDATE platform.whatsapp_browser_sessions SET revoked_at=NULL');
    await expect(write()).rejects.toMatchObject({ code: '42501' });
  });
  it('does not authorize an expired Session after waiting for the policy lock', async () => {
    const blocker = await owner().connect();
    const c = await beginRuntime();
    let pending: Promise<pg.QueryResult | Error> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(1919,1)');
      const pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!.pid;
      pending = c.query(writerSql, args()).catch((error: Error) => error);
      await waitForLock(pid);
      await blocker.query(
        "UPDATE platform.whatsapp_browser_sessions SET expires_at=clock_timestamp()-INTERVAL '1 second'"
      );
      await blocker.query('COMMIT');
      expect(await pending).toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
      expect(
        (await owner().query('SELECT count(*)::int count FROM core.field_attendance')).rows[0]
      ).toEqual({ count: 0 });
    } finally {
      await blocker.query('ROLLBACK');
      await c.query('ROLLBACK');
      if (pending) await pending;
      blocker.release();
      c.release();
    }
  });
  it('rejects a disabled venue without writing', async () => {
    await owner().query(
      "UPDATE core.practice_fields SET is_active=FALSE WHERE code='my-writer-hall'"
    );
    await expect(write()).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects revoked Sessions and wrong CSRF', async () => {
    await expect(
      runtime((c) => c.query(writerSql, [session, 'x'.repeat(43), 'my-writer-hall', 3, 101]))
    ).rejects.toMatchObject({ code: '42501' });
    await owner().query(
      'UPDATE platform.whatsapp_browser_sessions SET revoked_at=clock_timestamp()'
    );
    await expect(write()).rejects.toMatchObject({ code: '42501' });
  });
  it('requires consent and does not require optional reflection consent for attendance', async () => {
    await owner().query(
      "UPDATE platform.learner_privacy_policies SET state='active',published_at=clock_timestamp()"
    );
    await expect(write()).rejects.toMatchObject({ code: '42501' });
    await owner().query(
      "INSERT INTO platform.learner_privacy_acceptances(platform,subject_hash,policy_version,document_hash,locale,reflection_consent) SELECT 'whatsapp',platform.privacy_subject_hash('whatsapp',$1),version,document_hash,'en',FALSE FROM platform.learner_privacy_policies WHERE state='active'",
      [subject]
    );
    expect((await write()).ok).toBe(true);
  });
  it('prevents actual identity updates despite narrowly granted row-lock privileges', async () => {
    const c = await owner().connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE qigong_whatsapp_venue_writer');
      await c.query(
        "SELECT set_config('qigong.wa_venue_session_hash',encode(public.digest($1,'sha256'),'hex'),TRUE),set_config('qigong.wa_venue_csrf_hash',encode(public.digest($2,'sha256'),'hex'),TRUE)",
        [session, csrf]
      );
      await c.query('SELECT id FROM identity.people FOR UPDATE');
      await expect(c.query('UPDATE identity.people SET id=id')).rejects.toMatchObject({
        code: '42501'
      });
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
  it('does not let runtime switch to the writer or insert attendance directly', async () => {
    await expect(
      runtime((c) => c.query('SET ROLE qigong_whatsapp_venue_writer'))
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime((c) =>
        c.query(
          "INSERT INTO core.field_attendance(person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone) SELECT $1,id,'qr_gps',clock_timestamp(),CURRENT_DATE,'UTC' FROM core.practice_fields",
          [person]
        )
      )
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('reads only own formal attendance, never another person or debug rows', async () => {
    await write();
    const other = (
      await owner().query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name) VALUES('Other synthetic learner') RETURNING id"
      )
    ).rows[0]!.id;
    await owner().query(
      "INSERT INTO core.field_attendance(person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone) SELECT $1,id,'qr_gps',clock_timestamp(),(clock_timestamp() AT TIME ZONE timezone)::date,timezone FROM core.practice_fields WHERE code='my-writer-hall'",
      [other]
    );
    await owner().query(
      "INSERT INTO core.field_attendance(person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone,is_test,verification_mode) SELECT $1,id,'qr_gps',clock_timestamp(),(clock_timestamp() AT TIME ZONE timezone)::date,timezone,TRUE,'distance_debug' FROM core.practice_fields WHERE code='my-writer-hall'",
      [person]
    );
    const result = await history();
    expect(result.totals.attendanceCount).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.venueCode).toBe('my-writer-hall');
    expect(JSON.stringify(result)).not.toContain(other);
    expect(JSON.stringify(result)).not.toContain('isTest');
  });
  it('keeps own history visible for inactive venues and filters by venue code', async () => {
    await write();
    await write('sg-writer-hall');
    await owner().query(
      "UPDATE core.practice_fields SET is_active=FALSE WHERE code='my-writer-hall'"
    );
    const all = await history();
    expect(all.entries).toHaveLength(2);
    const filtered = await history(null, 'my-writer-hall');
    expect(filtered.totals.attendanceCount).toBe(1);
    expect(filtered.entries.map((entry) => entry.venueCode)).toEqual(['my-writer-hall']);
  });
  it('paginates 20 rows and filters by stored venue-local month', async () => {
    await owner().query(
      "INSERT INTO core.field_attendance(person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone) SELECT $1,f.id,'qr_gps',((DATE '2025-01-01'+n)+TIME '08:00') AT TIME ZONE f.timezone,DATE '2025-01-01'+n,f.timezone FROM core.practice_fields f CROSS JOIN generate_series(0,20) n WHERE f.code='my-writer-hall'",
      [person]
    );
    const first = await history('2025-01');
    const second = await history('2025-01', null, 2);
    expect(first).toMatchObject({
      dateBasis: 'venue_local_date',
      page: 1,
      pageSize: 20,
      hasMore: true,
      totals: { attendanceCount: 21, attendanceDays: 21, monthCount: 21 }
    });
    expect(first.entries).toHaveLength(20);
    expect(second.entries).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size).toBe(21);
    expect((await history('2025-02')).entries).toEqual([]);
  });
  it('serves real history HTTP without accepting an identity override', async () => {
    if (!api) throw Error('Missing isolated API');
    const saved = await write();
    const headers = {
      origin: publicOrigin,
      cookie: `${whatsappSessionCookie}=${session}; ${whatsappCsrfCookie}=${csrf}`,
      'x-whatsapp-csrf-token': csrf
    };
    const response = await api.inject({
      method: 'POST',
      url: '/api/whatsapp/venue-history',
      headers,
      payload: { month: saved.attendanceDate.slice(0, 7), venue: 'my-writer-hall' }
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, dateBasis: 'venue_local_date', page: 1 });
    expect(response.json().entries).toHaveLength(1);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(
      (
        await api.inject({
          method: 'POST',
          url: '/api/whatsapp/venue-history',
          headers,
          payload: { personId: person }
        })
      ).statusCode
    ).toBe(400);
    expect(response.body).not.toContain(session);
  });
  it('requires an active Session and consent for own history too', async () => {
    await write();
    await owner().query(
      'UPDATE platform.whatsapp_browser_sessions SET revoked_at=clock_timestamp()'
    );
    await expect(history()).rejects.toMatchObject({ code: '42501' });
    await owner().query('UPDATE platform.whatsapp_browser_sessions SET revoked_at=NULL');
    await owner().query(
      "UPDATE platform.learner_privacy_policies SET state='active',published_at=clock_timestamp()"
    );
    await expect(history()).rejects.toMatchObject({ code: '42501' });
  });
  it.each(['2026-11\n', '0000-01', '2026-13'])(
    'rejects invalid direct-SQL month %j',
    async (month) => {
      await expect(history(month)).rejects.toMatchObject({ code: '22023' });
    }
  );
  it('keeps the history owner nonmember, read-only and inaccessible to worker/runtime', async () => {
    const result = await owner().query<{ write: boolean; worker: boolean; member: boolean }>(
      "SELECT has_table_privilege('qigong_whatsapp_venue_history_reader','core.field_attendance','INSERT') write,has_function_privilege('qigong_worker_runtime','platform.whatsapp_venue_history(text,text,text,text,integer)','EXECUTE') worker,EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='qigong_whatsapp_venue_history_reader'::regrole OR member='qigong_whatsapp_venue_history_reader'::regrole) member"
    );
    expect(result.rows[0]).toEqual({ write: false, worker: false, member: false });
    await expect(
      runtime((c) => c.query('SET ROLE qigong_whatsapp_venue_history_reader'))
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('makes logout wait for an already-authorized write to commit, then rejects reuse', async () => {
    const c = await beginRuntime();
    const revoker = await owner().connect();
    let pending: Promise<pg.QueryResult> | undefined;
    try {
      await c.query(writerSql, args());
      const pid = (await revoker.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!
        .pid;
      pending = revoker.query(
        'UPDATE platform.whatsapp_browser_sessions SET revoked_at=clock_timestamp()'
      );
      await waitForLock(pid);
      await c.query('COMMIT');
      await pending;
      await expect(write()).rejects.toMatchObject({ code: '42501' });
      expect(
        (await owner().query('SELECT count(*)::int count FROM core.field_attendance')).rows[0]
      ).toEqual({ count: 1 });
    } finally {
      await c.query('ROLLBACK');
      c.release();
      if (pending) await pending.catch(() => undefined);
      revoker.release();
    }
  });
  it('rejects a write when logout wins the Session lock before authorization completes', async () => {
    const revoker = await owner().connect();
    const c = await beginRuntime();
    let pending: Promise<pg.QueryResult | Error> | undefined;
    try {
      await revoker.query('BEGIN');
      await revoker.query(
        'UPDATE platform.whatsapp_browser_sessions SET revoked_at=clock_timestamp()'
      );
      const pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!.pid;
      pending = c.query(writerSql, args()).catch((e: Error) => e);
      await waitForLock(pid);
      await revoker.query('COMMIT');
      expect(await pending).toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
      expect(
        (await owner().query('SELECT count(*)::int count FROM core.field_attendance')).rows[0]
      ).toEqual({ count: 0 });
    } finally {
      await revoker.query('ROLLBACK');
      await c.query('ROLLBACK');
      if (pending) await pending;
      revoker.release();
      c.release();
    }
  });
});
