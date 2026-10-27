/** Self-contained PG17 cluster; never reads .env/TEST_DATABASE_URL or contacts LINE.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { execFileSync } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../src/migrations.js';
import { withRequestContext } from '../src/request-context.js';
import {
  createVenueHistory,
  venueHistorySuccessSchema
} from '../../../apps/public-api/src/venue-history.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const pgBin = '/opt/homebrew/opt/postgresql@17/bin';
const subject = 'U' + 'a'.repeat(32);
const otherSubject = 'U' + 'b'.repeat(32);
const person = '20000000-0000-4000-8000-000000000001';
const otherPerson = '20000000-0000-4000-8000-000000000002';
const otherIdentity = '30000000-0000-4000-8000-000000000002';
const marker = 'isolated-venue-history-marker';
const port = 55483;
let root: string | undefined;
let started = false;
let owner: Pool | undefined;
let runtime: Pool | undefined;
const ownerPool = () => {
  if (!owner) throw new Error('isolated owner not initialized');
  return owner;
};
const runtimePool = () => {
  if (!runtime) throw new Error('isolated runtime not initialized');
  return runtime;
};
// Explicit local tool environment: no DB URLs/services, options, credentials or inherited preloads.
const toolEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', LC_ALL: 'C', LANG: 'C' };
const command = (name: string, args: string[]) =>
  execFileSync(resolve(pgBin, name), args, { env: toolEnv, stdio: 'pipe', timeout: 30000 });
const guardedRoot = async () => {
  if (!root || !/^\/tmp\/venue-history-[A-Za-z0-9]+$/.test(root))
    throw new Error('unsafe harness path');
  const actual = await realpath(root);
  if (actual !== root && actual !== '/private' + root)
    throw new Error('unexpected harness realpath');
  const info = await stat(root);
  if (
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o700 ||
    (await readFile(resolve(root, marker), 'utf8')) !== root
  )
    throw new Error('unsafe harness marker/mode/owner');
  return root;
};
const readHistory = (
  month: string | null = null,
  venue: string | null = null,
  page = 1,
  verifiedSubject = subject
) =>
  withRequestContext(
    runtimePool(),
    'qigong_api_runtime',
    { requestId: crypto.randomUUID() },
    async (client) => {
      const result = await client.query<{ data: unknown }>(
        'SELECT platform.venue_personal_history($1,$2,$3,$4,$5) AS data',
        ['line', verifiedSubject, month, venue, page]
      );
      return venueHistorySuccessSchema.parse(result.rows[0]?.data);
    }
  );
const sqlRuntime = (sql: string, values?: unknown[]) =>
  withRequestContext(
    runtimePool(),
    'qigong_api_runtime',
    { requestId: crypto.randomUUID() },
    (client) => client.query(sql, values)
  );

beforeAll(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('External APIs forbidden');
    })
  );
  expect(command('postgres', ['--version']).toString()).toMatch(/PostgreSQL\) 17\./);
  root = await mkdtemp('/tmp/venue-history-');
  await chmod(root, 0o700);
  await writeFile(resolve(root, marker), root, { mode: 0o600 });
  await guardedRoot();
  await mkdir(resolve(root, 'socket'), { mode: 0o700 });
  command('initdb', [
    '-D',
    resolve(root, 'data'),
    '--username=venue_history_owner',
    '--encoding=UTF8',
    '--no-locale',
    '--auth-local=trust',
    '--auth-host=reject'
  ]);
  command('pg_ctl', [
    '-D',
    resolve(root, 'data'),
    '-l',
    resolve(root, 'server.log'),
    '-o',
    `-F -k ${root}/socket -p ${port} -c listen_addresses='' -c unix_socket_permissions=0700`,
    '-w',
    'start'
  ]);
  started = true;
  const pid = (await readFile(resolve(root, 'data/postmaster.pid'), 'utf8')).split('\n');
  expect([resolve(root, 'data'), resolve(await realpath(root), 'data')]).toContain(pid[1]);
  expect(pid[3]).toBe(String(port));
  expect(pid[4]).toBe(resolve(root, 'socket'));
  const options = {
    host: resolve(root, 'socket'),
    port,
    user: 'venue_history_owner',
    database: 'postgres',
    password: '',
    ssl: false,
    max: 4
  };
  owner = new Pool(options);
  expect(
    (await owner.query("SELECT current_setting('listen_addresses') value")).rows[0]?.value
  ).toBe('');
  expect(
    (
      await owner.query(
        "SELECT 1 FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"
      )
    ).rowCount
  ).toBe(0);
  const migrations = resolve(repo, 'migrations');
  const files = (await readdir(migrations)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  expect(files).toHaveLength(54);
  const result = await runMigrations(owner, migrations, 'synthetic-history-only');
  expect(result.applied).toEqual(files);
  expect(result.currentVersion).toBe('0054_venue_people_read.sql');
  expect((await runMigrations(owner, migrations)).applied).toEqual([]);
  expect((await owner.query('SELECT 1 FROM core.field_attendance')).rowCount).toBe(0);
  expect((await owner.query('SELECT 1 FROM platform.venue_history_context')).rowCount).toBe(0);
  // Existing fixture is exclusively synthetic and only enters this fresh cluster.
  await owner.query(
    await readFile(resolve(repo, 'apps/public-api/tests/fixtures/venue-qr-synthetic.sql'), 'utf8')
  );
  await owner.query(`
    INSERT INTO identity.people(id,preferred_name) VALUES('${otherPerson}','Other synthetic learner');
    INSERT INTO identity.platform_identities(id,person_id,platform,external_subject_id)
      VALUES('${otherIdentity}','${otherPerson}','line','${otherSubject}');
    INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source)
      VALUES('${otherPerson}','${otherIdentity}','onboarding');
    INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,status,decided_by_principal_id,decided_at,person_id,learner_name,website_email,phone_e164)
      SELECT 'line','${otherSubject}','Other synthetic learner',requested_region_id,status,decided_by_principal_id,decided_at,
        '${otherPerson}','Other synthetic learner','other@example.invalid','+12025550124'
      FROM identity.onboarding_applications WHERE external_subject_id='${subject}';
    INSERT INTO platform.learner_privacy_acceptances(platform,subject_hash,policy_version,document_hash,locale,reflection_consent)
      SELECT 'line',platform.privacy_subject_hash('line','${otherSubject}'),version,document_hash,'zh_TW',FALSE
      FROM platform.learner_privacy_policies WHERE state='active';
  `);
  runtime = new Pool({ ...options, user: 'venue_qr_test_login' });
}, 120000);

beforeEach(async () => {
  await ownerPool().query(`
    UPDATE identity.people SET status='active' WHERE id='${person}';
    UPDATE identity.platform_identities SET revoked_at=NULL WHERE person_id='${person}';
    UPDATE identity.person_interaction_channels SET valid_to=NULL WHERE person_id='${person}';
    UPDATE identity.onboarding_applications SET status='approved',person_id='${person}',rejection_reason=NULL WHERE external_subject_id='${subject}';
    UPDATE platform.learner_privacy_acceptances SET revoked_at=NULL;
    TRUNCATE core.field_attendance;
    INSERT INTO core.field_attendance(id,person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone)
      SELECT ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${person}',f.id,'qr_gps',
        '2026-10-01T00:00:00Z'::timestamptz+(n-1)*interval '1 day','2026-10-01'::date+(n-1),'Asia/Taipei'
      FROM core.practice_fields f CROSS JOIN generate_series(1,23) n WHERE f.code='tw-test-one';
    INSERT INTO core.field_attendance(id,person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone)
      SELECT '40000000-0000-4000-8000-000000000024','${person}',id,'qr_gps','2026-10-01T00:00:00Z','2026-10-01','Asia/Singapore'
      FROM core.practice_fields WHERE code='sg-test-one';
    INSERT INTO core.field_attendance(id,person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone)
      SELECT '40000000-0000-4000-8000-000000000025','${person}',id,'qr_gps','2026-09-30T00:00:00Z','2026-09-30','Asia/Taipei'
      FROM core.practice_fields WHERE code='tw-test-one';
    INSERT INTO core.field_attendance(id,person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone,student_note,user_latitude,user_longitude)
      SELECT '50000000-0000-4000-8000-000000000001','${otherPerson}',id,'qr_gps','2026-10-26T00:00:00Z','2026-10-26','Asia/Taipei',
        'PRIVATE SYNTHETIC NOTE',25,121 FROM core.practice_fields WHERE code='tw-test-one';
  `);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await runtime?.end();
  await owner?.end();
  if (!root) return;
  const safe = await guardedRoot();
  if (started) {
    const pid = (await readFile(resolve(safe, 'data/postmaster.pid'), 'utf8')).split('\n');
    const actual = await realpath(safe);
    if (
      ![safe + '/data', actual + '/data'].includes(pid[1] ?? '') ||
      pid[3] !== String(port) ||
      ![safe + '/socket', actual + '/socket'].includes(pid[4] ?? '')
    )
      throw new Error('refusing cleanup of mismatched cluster');
    command('pg_ctl', ['-D', resolve(safe, 'data'), '-m', 'immediate', '-w', 'stop']);
  }
  await rm(safe, { recursive: true });
}, 30000);

describe('isolated PG17 personal history: 54 migrations + real nonowner RLS', () => {
  it('counts lifetime attendance/local days, month count independent of venue and no other learner', async () => {
    const result = await readHistory('2026-10');
    expect(result.totals).toEqual({ attendanceCount: 25, attendanceDays: 24, monthCount: 24 });
    expect(result.entries).toHaveLength(20);
    expect(result.hasMore).toBe(true);
    expect(result.entries.every((entry) => entry.id.startsWith('40000000'))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE|phone|student_note|latitude|personId|learnerName/
    );
  });
  it('pages by descending instant then descending id without overlap, filters retain lifetime totals', async () => {
    const first = await readHistory('2026-10');
    const second = await readHistory('2026-10', null, 2);
    expect(second.entries).toHaveLength(4);
    expect(second.hasMore).toBe(false);
    const all = [...first.entries, ...second.entries];
    expect(new Set(all.map((entry) => entry.id)).size).toBe(24);
    expect(all.slice(-2).map((entry) => entry.id.slice(-2))).toEqual(['24', '01']);
    const venue = await readHistory('2026-10', 'sg-test-one');
    expect(venue.totals).toEqual(first.totals);
    expect(venue.entries).toHaveLength(1);
    expect(venue.entries[0]?.venueTimezone).toBe('Asia/Singapore');
    expect((await readHistory(null, 'tw-test-one')).totals).toEqual({
      ...first.totals,
      monthCount: await currentMonthCount()
    });
    expect((await readHistory('2026-09')).entries).toHaveLength(1);
    expect((await readHistory('2026-10', null, Number.MAX_SAFE_INTEGER)).entries).toEqual([]);
  });
  it('omitting month returns lifetime entries, monthCount uses Taipei current month', async () => {
    const result = await readHistory(null, null, 2);
    expect(result.entries).toHaveLength(5);
    expect(result.entries.at(-1)?.venueLocalDate).toBe('2026-09-30');
    expect(result.totals.monthCount).toBe(await currentMonthCount());
  });
  it('retains own cross-country history regardless of home region or inactive venue', async () => {
    await ownerPool().query(
      "UPDATE core.practice_fields SET is_active=FALSE WHERE code='sg-test-one'"
    );
    try {
      expect((await readHistory(null, 'sg-test-one')).entries).toHaveLength(1);
    } finally {
      await ownerPool().query(
        "UPDATE core.practice_fields SET is_active=TRUE WHERE code='sg-test-one'"
      );
    }
  });
  it('uses saved venue-local dates across the date line, not a recomputed Taipei date', async () => {
    await ownerPool()
      .query(`INSERT INTO core.field_attendance(person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone)
      SELECT '${person}',id,'qr_gps','2026-10-31T12:00:00Z',('2026-10-31T12:00:00Z'::timestamptz AT TIME ZONE timezone)::date,timezone
      FROM core.practice_fields WHERE code IN ('tw-test-east','tw-test-west')`);
    const october = await readHistory('2026-10');
    const november = await readHistory('2026-11');
    expect(october.totals).toEqual({ attendanceCount: 27, attendanceDays: 26, monthCount: 25 });
    expect(november.totals.monthCount).toBe(1);
    expect(november.entries[0]?.venueLocalDate).toBe('2026-11-01');
    expect(november.entries[0]?.venueTimezone).toBe('Etc/GMT-14');
  });
  it('empty filtered pages retain lifetime totals; empty person returns zero', async () => {
    const unknown = await readHistory('2026-10', 'tw-missing-venue');
    expect(unknown.entries).toEqual([]);
    expect(unknown.hasMore).toBe(false);
    expect(unknown.totals.attendanceCount).toBe(25);
    await ownerPool().query('DELETE FROM core.field_attendance WHERE person_id=$1', [otherPerson]);
    expect(await readHistory(null, null, 1, otherSubject)).toMatchObject({
      totals: { attendanceCount: 0, attendanceDays: 0, monthCount: 0 },
      entries: [],
      hasMore: false
    });
  });
  it.each([
    ["UPDATE identity.people SET status='suspended' WHERE id=$1", person],
    [
      'UPDATE identity.platform_identities SET revoked_at=clock_timestamp() WHERE person_id=$1',
      person
    ],
    [
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
      person
    ],
    [
      "UPDATE identity.onboarding_applications SET status='rejected',person_id=NULL,rejection_reason='Synthetic rejection' WHERE person_id=$1",
      person
    ],
    [
      "UPDATE platform.learner_privacy_acceptances SET revoked_at=clock_timestamp() WHERE platform='line'",
      null
    ]
  ])(
    'revalidates identity/channel/active/application/withdrawn consent after successful resolver snapshot: %s',
    async (sql, value) => {
      const mapping = await sqlRuntime(
        'SELECT platform.resolve_line_learner_identity($1) AS data',
        [subject]
      );
      expect(mapping.rows[0]?.data.personId).toBe(person);
      if (
        sql.includes('UPDATE identity.people') ||
        sql.includes('UPDATE identity.platform_identities')
      ) {
        await ownerPool().query(
          'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
          [person]
        );
      }
      await ownerPool().query(sql, value ? [value] : []);
      await expect(readHistory()).rejects.toMatchObject({ code: '42501' });
      expect(
        (await ownerPool().query('SELECT 1 FROM platform.venue_history_context')).rowCount
      ).toBe(0);
    }
  );
  it('actual adapter resolves verified LINE subject with no real network; expired credential cannot read DB', async () => {
    const verifyIdentity = vi.fn(async (token: string, channel: string) => {
      if (token !== 'synthetic-valid' || channel !== '123')
        throw new Error('synthetic expired token');
      return { subject };
    });
    const history = createVenueHistory(runtimePool(), {
      publicOrigin: 'https://synthetic.invalid',
      loginChannelId: '123',
      verifyIdentity
    });
    expect((await history(crypto.randomUUID(), { idToken: 'synthetic-valid' })).status).toBe(200);
    expect(await history(crypto.randomUUID(), { idToken: 'expired' })).toEqual({
      status: 401,
      body: { ok: false, error: 'invalid_line_identity' }
    });
    expect(
      (await history(crypto.randomUUID(), { idToken: 'synthetic-valid', personId: otherPerson }))
        .status
    ).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('runtime cannot directly read tables, set reader role, invoke helper, or forge protected context', async () => {
    for (const sql of [
      'SELECT id FROM core.field_attendance',
      'SELECT code FROM core.practice_fields',
      'SELECT * FROM platform.venue_history_context',
      'SELECT platform.venue_history_person()',
      `INSERT INTO platform.venue_history_context VALUES(pg_backend_pid(),pg_current_xact_id(),'${otherPerson}')`,
      'SET LOCAL ROLE qigong_venue_history_reader'
    ])
      await expect(sqlRuntime(sql)).rejects.toMatchObject({ code: '42501' });
  });
  it('forged GUCs do not authorize reader RLS; inaccessible reader has no sensitive column grant', async () => {
    const client = await ownerPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE qigong_venue_history_reader');
      await client.query(
        "SELECT set_config('qigong.person_id',$1,TRUE),set_config('qigong.venue_subject',$2,TRUE),set_config('qigong.history_person_id',$1,TRUE)",
        [otherPerson, otherSubject]
      );
      expect((await client.query('SELECT id FROM core.field_attendance')).rows).toEqual([]);
      expect((await client.query('SELECT id FROM core.practice_fields')).rows).toEqual([]);
      await expect(
        client.query('SELECT student_note,user_latitude FROM core.field_attendance')
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
  it('ignores forged subject GUC, rejects person/principal contexts, never trusts guessed IDs', async () => {
    const result = await withRequestContext(
      runtimePool(),
      'qigong_api_runtime',
      { requestId: crypto.randomUUID() },
      async (client) => {
        await client.query("SELECT set_config('qigong.venue_subject',$1,TRUE)", [otherSubject]);
        return client.query('SELECT platform.venue_personal_history($1,$2) data', [
          'line',
          subject
        ]);
      }
    );
    expect(result.rows[0]?.data.totals.attendanceCount).toBe(25);
    for (const context of [{ personId: otherPerson }, { principalId: otherPerson }]) {
      await expect(
        withRequestContext(
          runtimePool(),
          'qigong_api_runtime',
          { requestId: crypto.randomUUID(), ...context },
          (client) =>
            client.query('SELECT platform.venue_personal_history($1,$2)', ['line', subject])
        )
      ).rejects.toMatchObject({ code: '22023' });
    }
    await expect(readHistory(null, null, 1, otherPerson)).rejects.toMatchObject({ code: '22023' });
    await expect(readHistory(null, null, 1, 'U' + 'f'.repeat(32))).rejects.toMatchObject({
      code: '42501'
    });
    await expect(
      sqlRuntime('SELECT platform.venue_personal_history($1,$2)', ['telegram', subject])
    ).rejects.toMatchObject({ code: '22023' });
  });
  it('context is empty after repeat calls, errors and pooled reuse', async () => {
    await readHistory();
    await readHistory(null, null, 1, otherSubject);
    await readHistory();
    expect((await ownerPool().query('SELECT 1 FROM platform.venue_history_context')).rowCount).toBe(
      0
    );
    expect(
      (await sqlRuntime("SELECT nullif(current_setting('qigong.person_id',true),'') person"))
        .rows[0]?.person
    ).toBeNull();
  });
  it('role/function ACLs, nonownership, FORCE RLS and fixed search_path are real catalog properties', async () => {
    const role = (
      await ownerPool().query("SELECT * FROM pg_roles WHERE rolname='qigong_venue_history_reader'")
    ).rows[0];
    for (const flag of [
      'rolcanlogin',
      'rolinherit',
      'rolsuper',
      'rolbypassrls',
      'rolcreatedb',
      'rolcreaterole',
      'rolreplication'
    ])
      expect(role[flag]).toBe(false);
    expect(
      (
        await ownerPool().query('SELECT 1 FROM pg_auth_members WHERE roleid=$1 OR member=$1', [
          role.oid
        ])
      ).rowCount
    ).toBe(0);
    expect(
      (await ownerPool().query('SELECT 1 FROM pg_class WHERE relowner=$1', [role.oid])).rowCount
    ).toBe(0);
    const tables = await ownerPool().query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('core.field_attendance'::regclass,'core.practice_fields'::regclass,'platform.venue_history_context'::regclass)"
    );
    for (const row of tables.rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
    const funcs = await ownerPool().query(
      "SELECT prosecdef,proconfig FROM pg_proc WHERE oid IN ('platform.venue_history_person()'::regprocedure,'platform.venue_personal_history(text,text,text,text,bigint)'::regprocedure)"
    );
    for (const row of funcs.rows) {
      expect(row.prosecdef).toBe(true);
      expect(row.proconfig).toEqual(['search_path=pg_catalog', 'row_security=on']);
    }
    for (const user of ['qigong_worker_runtime', 'venue_qr_test_login']) {
      expect(
        (
          await ownerPool().query(
            "SELECT has_function_privilege($1,'platform.venue_personal_history(text,text,text,text,bigint)','EXECUTE') allowed",
            [user]
          )
        ).rows[0]?.allowed
      ).toBe(false);
    }
  });
});
async function currentMonthCount(): Promise<number> {
  return Number(
    (
      await ownerPool().query(
        `SELECT count(*) n FROM core.field_attendance WHERE person_id=$1
    AND to_char(attendance_date,'YYYY-MM')=to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM')`,
        [person]
      )
    ).rows[0]?.n
  );
}
