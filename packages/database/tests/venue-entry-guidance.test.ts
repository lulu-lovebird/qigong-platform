/** Source contracts run without PostgreSQL. The separately gated DB suite is NOT
 * execution evidence until reviewed and run with TEST_DATABASE_URL explicitly set.
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool, type PoolClient } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';

// Canonical DTO contract for the next API phase. No learner IDs or source marker.
export type VenueEntryAvailability =
  'open' | 'not_activity_day' | 'before_open' | 'ended' | 'disabled' | 'not_found' | 'unavailable';
export interface VenueEntrySession {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly opensAt: string;
}
export interface VenueEntryAvailabilityDto {
  readonly version: 1;
  readonly availability: VenueEntryAvailability;
  readonly venue: {
    readonly code: string;
    readonly name: string;
    readonly timezone: string;
  } | null;
  readonly observedAt: string;
  readonly relevantSession: VenueEntrySession | null;
  readonly nextSession: VenueEntrySession | null;
}
export type VenueEntryLearnerStatus = 'needs_application' | 'pending' | 'approved' | 'blocked';
export interface VenueEntryLearnerStatusDto {
  readonly version: 1;
  readonly status: VenueEntryLearnerStatus;
}
interface ScheduleContext {
  readonly availability: VenueEntryAvailability;
  readonly relevantSession: VenueEntrySession | null;
  readonly nextSession: VenueEntrySession | null;
}
const migrations = fileURLToPath(new URL('../../../migrations/', import.meta.url));
const migrationName = '0060_venue_entry_guidance.sql';
const sql = readFileSync(path.join(migrations, migrationName), 'utf8');
const ownSource = readFileSync(fileURLToPath(import.meta.url), 'utf8');
const fixtureSource = readFileSync(
  new URL('./isolated-venue-roles.setup.ts', import.meta.url),
  'utf8'
);
const publicOwner = 'qigong_venue_entry_reader';
const privateOwner = 'qigong_venue_entry_identity_reader';
const functionBody = (name: string) => {
  const section = sql.split(`CREATE FUNCTION platform.${name}(`)[1];
  if (!section) throw new Error('missing new function');
  return section.split('END $$;')[0]!;
};

describe('schema60 STATIC source contracts (not SQL execution or RLS proof)', () => {
  it('adds exactly three functions, six SELECT policies and two isolated owners', () => {
    expect(sql.match(/CREATE FUNCTION /g)).toHaveLength(3);
    expect(sql.match(/CREATE POLICY /g)).toHaveLength(6);
    expect(sql.match(/FOR SELECT TO /g)).toHaveLength(6);
    expect(sql).toContain(`ARRAY['${publicOwner}','${privateOwner}']`);
    expect(sql).toContain('venue entry roles must be new isolated roles');
    expect(sql).toContain('WHERE roleid=role_oid OR member=role_oid');
    expect(sql).toContain(
      'NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
    );
  });
  it('never mutates existing DDL, business rows, runtime membership or default privileges', () => {
    expect(sql).not.toMatch(
      /CREATE OR REPLACE|ALTER TABLE|ALTER POLICY|DROP (TABLE|POLICY|FUNCTION)|ALTER ROLE|ALTER DEFAULT PRIVILEGES/
    );
    expect(sql).not.toMatch(/\b(INSERT INTO|DELETE FROM|TRUNCATE|UPDATE core\.|UPDATE identity\.)/);
    expect(sql).not.toMatch(/GRANT (qigong_|SELECT[^;]*TO qigong_(api|worker)_runtime)/s);
    expect(sql).not.toContain('qigong.venue_subject');
    expect(sql).not.toMatch(/venue_debug_config|nfc_gps|qr_gps|accept_privacy|decide_application/);
  });
  it('public owner gets only minimum venue/hierarchy columns, not contacts or location', () => {
    expect(sql).toContain(
      'GRANT SELECT(code,name_zh_tw,name_en,is_active,timezone,active_time_rules,region_id)\n  ON core.practice_fields TO qigong_venue_entry_reader;'
    );
    expect(sql).toContain(
      'GRANT SELECT(id,parent_region_id,region_type,active)\n  ON core.regions TO qigong_venue_entry_reader;'
    );
    expect(sql).toContain(
      'CREATE POLICY venue_entry_public_regions ON core.regions\n  FOR SELECT TO qigong_venue_entry_reader USING(TRUE);'
    );
    expect(sql).not.toMatch(/GRANT SELECT[^;]*ON identity\.[^;]*TO qigong_venue_entry_reader;/s);
    expect(sql).not.toMatch(
      /GRANT SELECT[^;]*ON core\.[^;]*TO qigong_venue_entry_identity_reader;/s
    );
    expect(sql).not.toMatch(
      /GRANT SELECT[^;]*(legal_name|preferred_name|website_email|phone|address|latitude|longitude|radius_meters|practice_note)/s
    );
  });
  it('all functions pin search_path and row security, only facades are definers', () => {
    for (const name of [
      'venue_entry_schedule_context',
      'venue_entry_availability',
      'venue_entry_learner_status'
    ]) {
      expect(functionBody(name)).toContain('SET search_path = pg_catalog SET row_security = on');
    }
    expect(functionBody('venue_entry_schedule_context')).toContain('STABLE SECURITY INVOKER');
    expect(functionBody('venue_entry_availability')).toContain('VOLATILE SECURITY DEFINER');
    expect(functionBody('venue_entry_learner_status')).toContain('VOLATILE SECURITY DEFINER');
    expect(sql).not.toMatch(/EXECUTE[^;]*(input_|rules|zone|at_time)/s);
  });
  it('strips PUBLIC and arbitrary default ACL residue before API-only facade grants', () => {
    expect(sql).toContain('aclexplode(p.proacl)');
    expect(sql).toContain('a.grantee<>f.proowner');
    expect(sql).toContain('FROM PUBLIC CASCADE');
    expect(sql).toContain("FROM %I CASCADE'");
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION platform.venue_entry_availability(TEXT),platform.venue_entry_learner_status(TEXT)\n  TO qigong_api_runtime;'
    );
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*venue_entry_schedule_context/s);
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION platform.venue_checkin_window(JSONB,TEXT,TIMESTAMPTZ) TO qigong_venue_entry_reader;'
    );
  });
  it('captures the public wall clock once and accepts no caller clock or auth context', () => {
    const body = functionBody('venue_entry_availability');
    expect(body.match(/clock_timestamp\(\)/g)).toHaveLength(1);
    expect(body).toContain('input_code TEXT)');
    expect(body).toContain('length(input_code)>64');
    expect(body).toContain("'^[a-z][a-z0-9]*(-[a-z0-9]+)+$'");
    expect(body).not.toMatch(
      /request_person|request_principal|current_setting|input_subject|source|at_time TIMESTAMPTZ/
    );
    expect(body).toContain("'availability','unavailable'");
    expect(body).toContain("'availability','not_found'");
  });
  it('requires 0058 TRUE for usable open intervals and scans only 0..15 local dates', () => {
    const body = functionBody('venue_entry_schedule_context');
    expect(body).toContain('is_open:=platform.venue_checkin_window(rules,zone,at_time)');
    expect(body).toContain('FOR offset_day IN 0..15 LOOP');
    expect(body).toContain('(session_day+start_text::time) AT TIME ZONE zone');
    expect(body).toContain('(session_day+end_text::time) AT TIME ZONE zone');
    expect(body).toContain("opens_at:=starts_at-INTERVAL '30 minutes'");
    expect(body).toContain('at_time>=opens_at AND at_time<ends_at AND offset_day<=1');
    expect(body).toContain("WHEN today_session IS NULL THEN 'not_activity_day'");
    expect(body).toContain("'unavailable'");
    expect(body).not.toMatch(/INTERVAL '(90|120) minutes'|05:00|07:00|09:00/);
  });
  it('standard entry disables the public test code and incomplete/inactive three-tier chains', () => {
    const body = functionBody('venue_entry_availability');
    expect(body).toContain(
      "IF NOT venue.is_active OR venue.code='tw-location-test' OR NOT EXISTS("
    );
    expect(body).toContain(
      'SELECT code,name_zh_tw,is_active,timezone,active_time_rules,region_id INTO venue'
    );
    expect(body).toContain('country.id=operational.parent_region_id');
    expect(body).toContain('global_region.id=country.parent_region_id');
    expect(body).toContain(
      "operational.id=venue.region_id AND operational.region_type='operational' AND operational.active"
    );
    expect(body).toContain("country.region_type='country' AND country.active");
    expect(body).toContain(
      "global_region.region_type='global' AND global_region.active AND global_region.parent_region_id IS NULL"
    );
    expect(body.indexOf("jsonb_build_object('availability','disabled')")).toBeLessThan(
      body.indexOf('context:=platform.venue_entry_schedule_context')
    );
    expect(body).not.toMatch(/venue_debug|input_source|debug_proof/);
  });
  it('skips unusable occurrences without inventing timestamps, but fails an unusable current context closed', () => {
    const body = functionBody('venue_entry_schedule_context');
    expect(body).toContain('today_invalid BOOLEAN:=FALSE');
    expect(body).toContain(
      'IF ends_at<=starts_at THEN\n        IF offset_day=0 THEN today_invalid:=TRUE; END IF;\n        CONTINUE;\n      END IF;'
    );
    expect(body.indexOf('CONTINUE;')).toBeLessThan(
      body.indexOf("candidate:=jsonb_build_object('startsAt'")
    );
    expect(body).toContain(
      "IF relevant IS NULL THEN\n      RETURN jsonb_build_object('availability','unavailable'"
    );
    expect(body).toContain(
      "IF today_invalid THEN\n      RETURN jsonb_build_object('availability','unavailable'"
    );
  });
  it('private facade overwrites and restores a dedicated scope, never trusts person/principal GUCs', () => {
    const body = functionBody('venue_entry_learner_status');
    expect(body).toContain("SET qigong.venue_entry_subject = ''");
    expect(body).toContain("set_config('qigong.venue_entry_subject',input_subject,TRUE)");
    expect(body).toContain("'^U[0-9a-f]{32}$'");
    expect(body).toContain("ERRCODE='22023'");
    expect(body).toContain('linked.revoked_at IS NOT NULL OR linked.verified_at>observed_at');
    expect(body).toContain('c.platform_identity_id=linked.id');
    expect(body).toContain('application.person_id=linked.person_id');
    expect(body).not.toMatch(
      /request_person|request_principal|identityId|personId|website_email|phone|display_name|resolve_line_learner_identity/
    );
    expect(body).toContain("jsonb_build_object('version',1,'status',result)");
  });
  it('only extends the fixed fixture role allowlist, retaining teardown safeguards', () => {
    expect(fixtureSource).toContain(`'${publicOwner}'`);
    expect(fixtureSource).toContain(`'${privateOwner}'`);
    expect(fixtureSource).toContain('preexistingOids.has(role.oid) || role.referenced');
    expect(fixtureSource).toContain('isAuthorizedIsolationCluster(url)');
    expect(fixtureSource).toContain('if (!role.safe) throw');
    expect(fixtureSource).not.toMatch(/client.query\([^\n]*(DROP OWNED|CASCADE)/);
  });
  it('gates every database fixture and migration behind explicit TEST_DATABASE_URL', () => {
    expect(ownSource).toContain('const databaseUrl = process.env.TEST_DATABASE_URL;');
    expect(ownSource).toContain(
      'const describeWithDatabase = databaseUrl ? describe : describe.skip;'
    );
    const dbSuite = ownSource.lastIndexOf('describeWithDatabase(');
    expect(dbSuite).toBeGreaterThan(0);
    const fixtureBody = ownSource.slice(dbSuite);
    expect(fixtureBody).toContain('beforeAll(async () => {');
    expect(fixtureBody).toContain('await createIsolatedTestDatabase(');
    expect(fixtureBody).toContain('await runMigrations(');
    expect(fixtureBody).not.toMatch(/initdb|pg_ctl|execFileSync|discoverLocalPgTools/);
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const weekly = { day_of_week: [1, 3], start_time: '09:00', end_time: '11:00' };
const monday = { ...weekly, day_of_week: [1] };
const subjectFor = (n: number) => 'U' + n.toString(16).padStart(32, '0');
const statusCases = [
  ['unknown', 'needs_application'],
  ['pending', 'pending'],
  ['approved', 'approved'],
  ['rejected', 'blocked'],
  ['revoked', 'blocked'],
  ['suspended', 'blocked'],
  ['expired_channel', 'blocked'],
  ['future_channel', 'blocked'],
  ['different_primary', 'blocked'],
  ['bad_binding', 'blocked'],
  ['missing_identity', 'blocked'],
  ['known_without_application', 'blocked'],
  ['future_identity', 'blocked'],
  ['pending_blocked_identity', 'blocked'],
  ['pending_valid_identity', 'pending']
] as const satisfies readonly (readonly [string, VenueEntryLearnerStatus])[];

// No local PostgreSQL discovery, fallback URL, Docker or provider operations.
// Review source + ACLs across model families BEFORE enabling this suite.
describeWithDatabase(
  'schema60 PostgreSQL (REVIEW REQUIRED; skipped without TEST_DATABASE_URL)',
  () => {
    let pool: Pool;
    let dispose: (() => Promise<void>) | undefined;
    let previousDirectory = '';
    let targetDirectory = '';
    let region: string;
    let principal: string;
    const subjects = new Map<string, string>();
    const people = new Map<string, string>();
    let upgradeBefore: unknown;
    let upgradeAfter: unknown;
    let oldAclBefore: unknown;
    let oldAclAfter: unknown;
    let rawAclBefore: unknown;
    let rawAclAfter: unknown;
    let applied: readonly string[];
    let regionSecurityBefore: { relrowsecurity: boolean; relforcerowsecurity: boolean };

    const fingerprint = async () => {
      const tables = (
        await pool.query<{ schema: string; name: string }>(
          "SELECT schemaname schema,tablename name FROM pg_tables WHERE schemaname IN ('identity','core','platform','admin','audit','ops','reporting') AND NOT(schemaname='core' AND tablename='platform_metadata') ORDER BY 1,2"
        )
      ).rows;
      return Promise.all(
        tables.map(async ({ schema, name }) => ({
          schema,
          name,
          // Identifiers come exclusively from pg_tables; quote them, never fixture input.
          hash: (
            await pool.query<{ hash: string }>(
              `SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'')) hash FROM "${schema.replaceAll('"', '""')}"."${name.replaceAll('"', '""')}" r`
            )
          ).rows[0]!.hash
        }))
      );
    };
    const oldContracts = async () =>
      (
        await pool.query<{ contract: unknown }>(
          "SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'source',p.prosrc,'config',p.proconfig,'acl',CASE WHEN p.proname='venue_checkin_window' THEN NULL ELSE p.proacl::text END) ORDER BY p.oid) contract FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('platform','admin','core') AND p.proname IN ('venue_checkin_window','resolve_line_learner_identity','venue_qr_checkin','venue_debug_checkin','venue_management','privacy_usage')"
        )
      ).rows[0]!.contract;
    const rawContracts = async () =>
      (
        await pool.query(
          "SELECT c.oid,a.attnum,coalesce((SELECT jsonb_agg(x ORDER BY x.grantee,x.privilege_type) FROM aclexplode(c.relacl) x WHERE x.grantee=0 OR x.grantee IN(SELECT oid FROM pg_roles WHERE rolname IN ('qigong_api_runtime','qigong_worker_runtime'))),'[]'::jsonb) table_acl,coalesce((SELECT jsonb_agg(x ORDER BY x.grantee,x.privilege_type) FROM aclexplode(a.attacl) x WHERE x.grantee=0 OR x.grantee IN(SELECT oid FROM pg_roles WHERE rolname IN ('qigong_api_runtime','qigong_worker_runtime'))),'[]'::jsonb) column_acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 WHERE n.nspname IN ('identity','core','platform') ORDER BY c.oid,a.attnum"
        )
      ).rows;
    const asOwner = async <T>(
      role: typeof publicOwner | typeof privateOwner,
      run: (client: PoolClient) => Promise<T>
    ): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${role}`); // Fixed two-element role allowlist.
        return await run(client);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    };
    const runtime = <T>(
      run: (client: PoolClient) => Promise<T>,
      role: 'qigong_api_runtime' | 'qigong_worker_runtime' = 'qigong_api_runtime'
    ) => withRequestContext(pool, role, { requestId: randomUUID() }, run);
    // SET ROLE alone cannot test escalation when SESSION_USER is a superuser.
    // A transaction-local session authorization makes membership denial genuine.
    const asRuntimeSession = async <T>(
      role: 'qigong_api_runtime' | 'qigong_worker_runtime',
      run: (client: PoolClient) => Promise<T>
    ): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL SESSION AUTHORIZATION ${role}`);
        return await run(client);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    };
    const availability = async (code: string) =>
      runtime(
        async (client) =>
          (
            await client.query<{ data: VenueEntryAvailabilityDto }>(
              'SELECT platform.venue_entry_availability($1) data',
              [code]
            )
          ).rows[0]!.data
      );
    const learnerStatus = async (subject: string) =>
      runtime(
        async (client) =>
          (
            await client.query<{ data: VenueEntryLearnerStatusDto }>(
              'SELECT platform.venue_entry_learner_status($1) data',
              [subject]
            )
          ).rows[0]!.data
      );
    const schedule = async (rules: unknown, zone: string | null, at: string | null) =>
      asOwner(
        publicOwner,
        async (client) =>
          (
            await client.query<{ data: ScheduleContext; open: boolean }>(
              'SELECT platform.venue_entry_schedule_context($1::jsonb,$2,$3::timestamptz) data,platform.venue_checkin_window($1::jsonb,$2,$3::timestamptz) open',
              [JSON.stringify(rules), zone, at]
            )
          ).rows[0]!
      );
    const newPerson = async () =>
      (
        await pool.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic private learner','UTC') RETURNING id"
        )
      ).rows[0]!.id;
    const newApplication = async (
      subject: string,
      status: 'pending' | 'approved' | 'rejected',
      person: string | null
    ) => {
      await pool.query(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,status,person_id,decided_at,decided_by_principal_id,rejection_reason,learner_name,website_email,phone_e164) VALUES('line',$1,'Synthetic learner',$2,$3,$4,CASE WHEN $3='pending' THEN NULL ELSE clock_timestamp() END,CASE WHEN $3='pending' THEN NULL ELSE $5::uuid END,CASE WHEN $3='rejected' THEN 'Synthetic rejection' ELSE NULL END,'Private learner','synthetic@example.invalid','+886900000000')",
        [subject, region, status, person, principal]
      );
    };

    beforeAll(async () => {
      // Nothing in this callback executes while the suite is skipped.
      const database = await createIsolatedTestDatabase(databaseUrl!);
      pool = database.pool;
      dispose = () => database.dispose();
      previousDirectory = await mkdtemp(path.join(tmpdir(), 'qigong-venue-guidance-db-'));
      targetDirectory = await mkdtemp(path.join(tmpdir(), 'qigong-venue-guidance-target-'));
      for (const name of await readdir(migrations)) {
        if (/^\d{4}_.+\.sql$/.test(name)) {
          if (name < '0060_') {
            await copyFile(path.join(migrations, name), path.join(previousDirectory, name));
          }
          if (name <= migrationName) {
            await copyFile(path.join(migrations, name), path.join(targetDirectory, name));
          }
        }
      }
      await runMigrations(pool, previousDirectory, 'venue-entry-before');
      region = (
        await pool.query<{ id: string }>(
          "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('entry-global','global','測試','Test') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'entry-country','country','測試','Test' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'entry-region','operational','測試','Test' FROM c RETURNING id"
        )
      ).rows[0]!.id;
      principal = (
        await pool.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://entry.example.invalid','synthetic-reviewer','Synthetic reviewer') RETURNING id"
        )
      ).rows[0]!.id;
      await pool.query(
        "INSERT INTO core.practice_fields(region_id,code,name_zh_tw,name_en,latitude,longitude,radius_meters,timezone,active_time_rules,is_active) VALUES($1,'entry-active','測試場地','Synthetic venue',25,121,100,'Asia/Taipei',$2,TRUE),($1,'entry-disabled','停用場地','Disabled venue',25,121,100,'Asia/Taipei',$2,FALSE)",
        [region, JSON.stringify(weekly)]
      );
      // All-day synthetic schedules give the region/test-code guards a normal
      // open control using the real clock, without faking server time.
      await pool.query(
        "INSERT INTO core.practice_fields(region_id,code,name_zh_tw,name_en,latitude,longitude,radius_meters,timezone,active_time_rules,is_active) VALUES($1,'entry-all-day','全天測試場地','All-day synthetic venue',25,121,100,'Asia/Taipei',$2,TRUE),($1,'tw-location-test','測試專用場地','Test-only venue',25,121,100,'Asia/Taipei',$2,TRUE)",
        [
          region,
          JSON.stringify({
            day_of_week: [0, 1, 2, 3, 4, 5, 6],
            start_time: '00:00',
            end_time: '24:00'
          })
        ]
      );
      for (const [index, [kind]] of statusCases.entries()) {
        const subject = subjectFor(index + 1);
        subjects.set(kind, subject);
        if (kind === 'unknown') continue;
        if (kind === 'pending' || kind === 'rejected') {
          await newApplication(subject, kind, null);
          continue;
        }
        const person = await newPerson();
        people.set(kind, person);
        if (kind !== 'missing_identity') {
          const identity = (
            await pool.query<{ id: string }>(
              "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at,revoked_at) VALUES($1,'line',$2,clock_timestamp()-INTERVAL '3 days',CASE WHEN $3 THEN clock_timestamp()-INTERVAL '1 day' ELSE NULL END) RETURNING id",
              [person, subject, kind === 'revoked' || kind === 'pending_blocked_identity']
            )
          ).rows[0]!.id;
          if (!['revoked', 'pending_blocked_identity', 'suspended'].includes(kind)) {
            let channelIdentity = identity;
            if (kind === 'different_primary')
              channelIdentity = (
                await pool.query<{ id: string }>(
                  "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'telegram','synthetic-other-primary') RETURNING id",
                  [person]
                )
              ).rows[0]!.id;
            const future = kind === 'future_channel' || kind === 'future_identity';
            await pool.query(
              "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,valid_from,valid_to,activation_source) VALUES($1,$2,CASE WHEN $3 THEN clock_timestamp()+INTERVAL '1 day' ELSE clock_timestamp()-INTERVAL '2 days' END,CASE WHEN $4 THEN clock_timestamp()-INTERVAL '1 day' ELSE NULL END,'onboarding')",
              [person, channelIdentity, future, kind === 'expired_channel']
            );
            if (kind === 'future_identity')
              await pool.query(
                "UPDATE identity.platform_identities SET verified_at=clock_timestamp()+INTERVAL '1 day' WHERE id=$1",
                [identity]
              );
          }
          if (kind === 'suspended')
            await pool.query("UPDATE identity.people SET status='suspended' WHERE id=$1", [person]);
        }
        if (kind !== 'known_without_application')
          await newApplication(
            subject,
            kind.startsWith('pending_') ? 'pending' : 'approved',
            kind.startsWith('pending_') ? null : kind === 'bad_binding' ? await newPerson() : person
          );
      }
      // A real synthetic attendance row makes preservation more than empty-table hashing.
      await pool.query(
        "INSERT INTO core.field_attendance(person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone,distance_meters) SELECT $1,id,'qr_gps',clock_timestamp(),(clock_timestamp() AT TIME ZONE timezone)::date,timezone,1 FROM core.practice_fields WHERE code='entry-active'",
        [people.get('approved')]
      );
      upgradeBefore = await fingerprint();
      oldAclBefore = await oldContracts();
      rawAclBefore = await rawContracts();
      regionSecurityBefore = (
        await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='core.regions'::regclass"
        )
      ).rows[0]!;
      // Deliberate default-ACL residue must not survive on any new function.
      await pool.query(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA platform GRANT EXECUTE ON FUNCTIONS TO qigong_worker_runtime'
      );
      applied = (await runMigrations(pool, targetDirectory, 'venue-entry-after')).applied;
      await pool.query(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA platform REVOKE EXECUTE ON FUNCTIONS FROM qigong_worker_runtime'
      );
      upgradeAfter = await fingerprint();
      oldAclAfter = await oldContracts();
      rawAclAfter = await rawContracts();
    }, 60000);
    afterAll(async () => {
      if (dispose) await dispose();
      if (previousDirectory) await rm(previousDirectory, { recursive: true, force: true });
      if (targetDirectory) await rm(targetDirectory, { recursive: true, force: true });
    });

    it('upgrades 59 -> 60 idempotently without changing business rows, old functions or raw ACLs', async () => {
      expect(applied).toEqual([migrationName]);
      expect(upgradeAfter).toEqual(upgradeBefore);
      expect(oldAclAfter).toEqual(oldAclBefore);
      expect(rawAclAfter).toEqual(rawAclBefore);
      expect((await runMigrations(pool, targetDirectory, 'venue-entry-repeat')).applied).toEqual(
        []
      );
    });
    it.each([
      ['2026-10-26T08:29:59.999+08:00', 'before_open'],
      ['2026-10-26T08:30:00+08:00', 'open'],
      ['2026-10-26T09:00:00+08:00', 'open'],
      ['2026-10-26T10:59:59.999+08:00', 'open'],
      ['2026-10-26T11:00:00+08:00', 'ended'],
      ['2026-10-27T09:00:00+08:00', 'not_activity_day'],
      ['2026-10-28T09:00:00+08:00', 'open'],
      ['2026-10-25T23:00:00+08:00', 'not_activity_day']
    ] as const)('weekly boundaries %s -> %s, matching authoritative 0058', async (at, expected) => {
      const result = await schedule(weekly, 'Asia/Taipei', at);
      expect(result.data.availability).toBe(expected);
      expect(result.open).toBe(expected === 'open');
    });
    it('reports dated session instants and first future opening, without hardcoded duration', async () => {
      const { data } = await schedule(monday, 'Asia/Taipei', '2026-10-26T08:29:59.999+08:00');
      const session = data.relevantSession!;
      expect(Date.parse(session.startsAt)).toBe(Date.parse('2026-10-26T09:00+08:00'));
      expect(Date.parse(session.endsAt)).toBe(Date.parse('2026-10-26T11:00+08:00'));
      expect(Date.parse(session.opensAt)).toBe(Date.parse('2026-10-26T08:30+08:00'));
      expect(data.nextSession).toEqual(session);
      const ended = (await schedule(monday, 'Asia/Taipei', '2026-10-26T11:00+08:00')).data;
      expect(Date.parse(ended.nextSession!.startsAt)).toBe(Date.parse('2026-11-02T09:00+08:00'));
      const short = { ...monday, start_time: '05:17', end_time: '05:19' };
      expect(
        (await schedule(short, 'Asia/Taipei', '2026-10-26T04:47+08:00')).data.availability
      ).toBe('open');
    });
    it('distinguishes local weekdays from UTC dates', async () => {
      const at = '2026-10-26T00:45:00+08:00';
      const early = { ...monday, start_time: '01:00', end_time: '02:00' };
      expect((await schedule(early, 'Asia/Taipei', at)).data.availability).toBe('open');
      expect((await schedule(early, 'UTC', at)).data.availability).toBe('not_activity_day');
    });
    it('retains previous-day opening and end 24:00 semantics from 0058', async () => {
      const early = { ...monday, start_time: '00:15', end_time: '01:00' };
      const previous = await schedule(early, 'Asia/Taipei', '2026-10-25T23:45+08:00');
      expect(previous.open).toBe(true);
      expect(previous.data.availability).toBe('open');
      expect(Date.parse(previous.data.relevantSession!.startsAt)).toBe(
        Date.parse('2026-10-26T00:15+08:00')
      );
      const late = { ...monday, start_time: '23:00', end_time: '24:00' };
      expect(
        (await schedule(late, 'Asia/Taipei', '2026-10-26T23:59:59.999+08:00')).data.availability
      ).toBe('open');
      const midnight = await schedule(late, 'Asia/Taipei', '2026-10-27T00:00+08:00');
      expect(midnight.open).toBe(false);
      expect(midnight.data.availability).toBe('not_activity_day');
    });
    it('finds the next weekly opening at offset 8 while a next-day session is already open', async () => {
      const at = '2026-10-26T23:50:00+08:00';
      const rules = { day_of_week: [2], start_time: '00:15', end_time: '01:00' };
      const result = await schedule(rules, 'Asia/Taipei', at);
      expect(result.open).toBe(true);
      expect(result.data.availability).toBe('open');
      expect(Date.parse(result.data.relevantSession!.startsAt)).toBe(
        Date.parse('2026-10-27T00:15:00+08:00')
      );
      expect(Date.parse(result.data.nextSession!.startsAt)).toBe(
        Date.parse('2026-11-03T00:15:00+08:00')
      );
      expect(Date.parse(result.data.nextSession!.opensAt)).toBe(
        Date.parse('2026-11-02T23:45:00+08:00')
      );
      expect(Date.parse(result.data.nextSession!.opensAt)).toBeGreaterThan(Date.parse(at));
    });
    it('finds offset-15 nextSession after a previous-day opening and one midnight-DST-invalid week', async () => {
      const at = '2026-02-28T23:50:00-05:00';
      const rules = { day_of_week: [0], start_time: '00:15', end_time: '01:00' };
      const result = await schedule(rules, 'America/Havana', at);
      // Havana's 2026-03-08 midnight gap inverts that weekly occurrence:
      // 00:15 resolves after 01:00. The following usable Sunday is offset 15.
      expect(result.open).toBe(true);
      expect(result.data.availability).toBe('open');
      expect(Date.parse(result.data.relevantSession!.startsAt)).toBe(
        Date.parse('2026-03-01T00:15:00-05:00')
      );
      const next = result.data.nextSession!;
      expect(Date.parse(next.startsAt)).toBe(Date.parse('2026-03-15T00:15:00-04:00'));
      expect(Date.parse(next.endsAt)).toBe(Date.parse('2026-03-15T01:00:00-04:00'));
      expect(Date.parse(next.opensAt)).toBe(Date.parse('2026-03-14T23:45:00-04:00'));
      expect(Date.parse(next.opensAt)).toBeGreaterThan(Date.parse(at));
    });
    it.each([
      ['2026-03-01T07:00:00Z', 'before_open', '2026-03-01T07:45:00Z'],
      ['2026-03-01T07:50:00Z', 'open', '2026-03-15T06:45:00Z'],
      ['2026-03-01T08:00:00Z', 'ended', '2026-03-15T06:45:00Z']
    ] as const)(
      'skips an inverted future DST occurrence at offset 7 without masking %s',
      async (at, state, nextStartsAt) => {
        const rules = { day_of_week: [0], start_time: '02:45', end_time: '03:00' };
        const result = await schedule(rules, 'America/New_York', at);
        expect(result.open).toBe(state === 'open');
        expect(result.data.availability).toBe(state);
        expect(Date.parse(result.data.relevantSession!.startsAt)).toBe(
          Date.parse('2026-03-01T07:45:00Z')
        );
        const next = result.data.nextSession!;
        expect(Date.parse(next.startsAt)).toBe(Date.parse(nextStartsAt));
        expect(Date.parse(next.endsAt)).toBeGreaterThan(Date.parse(next.startsAt));
        expect(Date.parse(next.opensAt)).toBeGreaterThan(Date.parse(at));
      }
    );
    it('keeps a valid current opening when an offset-6 occurrence is DST-inverted', async () => {
      const result = await schedule(
        { day_of_week: [0, 1], start_time: '02:45', end_time: '03:00' },
        'America/New_York',
        '2026-03-02T07:50:00Z'
      );
      expect(result.open).toBe(true);
      expect(result.data.availability).toBe('open');
      expect(Date.parse(result.data.nextSession!.startsAt)).toBe(
        Date.parse('2026-03-09T06:45:00Z')
      );
      expect(Date.parse(result.data.nextSession!.endsAt)).toBe(Date.parse('2026-03-09T07:00:00Z'));
    });
    it.each([
      ['02:00', '03:00', '2026-03-08T06:45:00Z', true],
      ['02:15', '03:00', '2026-03-08T06:50:00Z', true],
      ['02:45', '03:00', '2026-03-08T07:35:00Z', false]
    ] as const)(
      'fails an unusable current occurrence %s..%s closed, even if legacy early-window logic returns TRUE',
      async (start_time, end_time, at, legacyOpen) => {
        const result = await schedule(
          { day_of_week: [0], start_time, end_time },
          'America/New_York',
          at
        );
        // 0058 is unchanged. Its peculiar early window for collapsed/inverted
        // converted intervals is not permission to display an unusable session.
        expect(result.open).toBe(legacyOpen);
        expect(result.data).toEqual({
          availability: 'unavailable',
          relevantSession: null,
          nextSession: null
        });
      }
    );
    it.each([
      ['2026-03-08T06:44:59.999Z', 'before_open', '03:15', '04:00'],
      ['2026-03-08T06:45:00Z', 'open', '03:15', '04:00'],
      ['2026-03-08T08:00:00Z', 'ended', '03:15', '04:00'],
      ['2026-11-01T05:59:59.999Z', 'before_open', '01:30', '02:30'],
      ['2026-11-01T06:00:00Z', 'open', '01:30', '02:30'],
      ['2026-11-01T07:30:00Z', 'ended', '01:30', '02:30']
    ] as const)(
      'uses PostgreSQL DST gap/fold semantics at %s',
      async (at, state, start_time, end_time) => {
        const result = await schedule(
          { day_of_week: [0], start_time, end_time },
          'America/New_York',
          at
        );
        expect(result.data.availability).toBe(state);
        expect(result.open).toBe(state === 'open');
      }
    );
    it.each([
      null,
      [],
      {},
      { ...monday, day_of_week: [] },
      { ...monday, day_of_week: [1, 1] },
      { ...monday, day_of_week: [7] },
      { ...monday, day_of_week: ['1'] },
      { ...monday, day_of_week: [1.5] },
      { ...monday, day_of_week: null },
      { ...monday, start_time: '9:00' },
      { ...monday, start_time: '24:00' },
      { ...monday, end_time: '24:01' },
      { ...monday, end_time: '08:00' },
      { ...monday, start_time: null },
      { ...monday, end_time: 11 }
    ])('fails corrupt rules closed as unavailable, never not_activity_day: %j', async (rules) => {
      const result = await schedule(rules, 'Asia/Taipei', '2026-10-27T09:00+08:00');
      expect(result.data).toEqual({
        availability: 'unavailable',
        relevantSession: null,
        nextSession: null
      });
      expect(result.open).toBe(false);
    });
    it.each([
      ['Bad/Timezone', '2026-10-26T09:00Z'],
      [null, '2026-10-26T09:00Z'],
      ['Asia/Taipei', null],
      ['Asia/Taipei', 'infinity']
    ])('fails closed on invalid zone/clock %s %s', async (zone, at) => {
      expect((await schedule(monday, zone, at)).data.availability).toBe('unavailable');
    });
    it('returns only the canonical public DTO and server-observed clock', async () => {
      const before = (
        await pool.query<{ at: Date }>('SELECT clock_timestamp() at')
      ).rows[0]!.at.getTime();
      const result = await availability('entry-active');
      const after = (
        await pool.query<{ at: Date }>('SELECT clock_timestamp() at')
      ).rows[0]!.at.getTime();
      expect(Object.keys(result).sort()).toEqual([
        'availability',
        'nextSession',
        'observedAt',
        'relevantSession',
        'venue',
        'version'
      ]);
      expect(result.venue).toEqual({
        code: 'entry-active',
        name: '測試場地',
        timezone: 'Asia/Taipei'
      });
      expect(Date.parse(result.observedAt)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(result.observedAt)).toBeLessThanOrEqual(after);
      expect(['open', 'before_open', 'ended', 'not_activity_day']).toContain(result.availability);
      expect(result.version).toBe(1);
    });
    it('lookup permission failure is unavailable, not not_found or not_activity_day', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `REVOKE SELECT(code,name_zh_tw,name_en,is_active,timezone,active_time_rules,region_id) ON core.practice_fields FROM ${publicOwner}`
        );
        await client.query('SET LOCAL ROLE qigong_api_runtime');
        const result = await client.query<{ data: VenueEntryAvailabilityDto }>(
          "SELECT platform.venue_entry_availability('entry-active') data"
        );
        expect(result.rows[0]!.data).toMatchObject({
          availability: 'unavailable',
          venue: null,
          relevantSession: null,
          nextSession: null
        });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
    it('a real-clock all-day venue under a complete active chain is open', async () => {
      const result = await availability('entry-all-day');
      expect(result.availability).toBe('open');
      expect(result.venue).toEqual({
        code: 'entry-all-day',
        name: '全天測試場地',
        timezone: 'Asia/Taipei'
      });
      expect(result.relevantSession).not.toBeNull();
    });
    it('the public test code never supplies standard entry authority or session data', async () => {
      expect(await availability('tw-location-test')).toMatchObject({
        availability: 'disabled',
        venue: { code: 'tw-location-test', name: '測試專用場地', timezone: 'Asia/Taipei' },
        relevantSession: null,
        nextSession: null
      });
    });
    it.each([
      ['inactive operational', "UPDATE core.regions SET active=FALSE WHERE code='entry-region'"],
      ['inactive country', "UPDATE core.regions SET active=FALSE WHERE code='entry-country'"],
      ['inactive global', "UPDATE core.regions SET active=FALSE WHERE code='entry-global'"],
      [
        'wrong operational type',
        "UPDATE core.regions SET region_type='country' WHERE code='entry-region'"
      ],
      [
        'wrong country type',
        "UPDATE core.regions SET region_type='operational' WHERE code='entry-country'"
      ],
      [
        'wrong global type',
        "UPDATE core.regions SET region_type='operational' WHERE code='entry-global'"
      ],
      [
        'missing country',
        "UPDATE core.regions SET parent_region_id=NULL WHERE code='entry-region'"
      ],
      [
        'wrong country parent',
        "UPDATE core.regions SET parent_region_id=(SELECT id FROM core.regions WHERE code='entry-global') WHERE code='entry-region'"
      ],
      [
        'non-root global',
        "UPDATE core.regions SET parent_region_id=(SELECT id FROM core.regions WHERE code='entry-country') WHERE code='entry-global'"
      ]
    ] as const)(
      'disables standard entry for %s without leaking region IDs',
      async (_kind, mutation) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          // Future REVIEWED DB suite only: two named triggers are disabled inside
          // this rollback-only transaction to simulate otherwise-forbidden damage.
          await client.query('ALTER TABLE core.regions DISABLE TRIGGER validate_region_hierarchy');
          await client.query(
            'ALTER TABLE core.regions DISABLE TRIGGER prevent_active_parent_deactivation'
          );
          await client.query(mutation);
          await client.query('SET LOCAL ROLE qigong_api_runtime');
          const result = (
            await client.query<{ data: VenueEntryAvailabilityDto }>(
              "SELECT platform.venue_entry_availability('entry-all-day') data"
            )
          ).rows[0]!.data;
          expect(result).toMatchObject({
            availability: 'disabled',
            relevantSession: null,
            nextSession: null
          });
          expect(result.venue).toEqual({
            code: 'entry-all-day',
            name: '全天測試場地',
            timezone: 'Asia/Taipei'
          });
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      }
    );
    it('region lookup permission failure is unavailable rather than a disabled/not-found claim', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `REVOKE SELECT(id,parent_region_id,region_type,active) ON core.regions FROM ${publicOwner}`
        );
        await client.query('SET LOCAL ROLE qigong_api_runtime');
        const result = (
          await client.query<{ data: VenueEntryAvailabilityDto }>(
            "SELECT platform.venue_entry_availability('entry-all-day') data"
          )
        ).rows[0]!.data;
        expect(result).toMatchObject({
          availability: 'unavailable',
          venue: null,
          relevantSession: null,
          nextSession: null
        });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
    it('unknown and disabled codes expose no identity, location, schedule rules or IDs', async () => {
      const missing = await availability('entry-missing');
      expect(missing).toMatchObject({
        availability: 'not_found',
        venue: null,
        relevantSession: null,
        nextSession: null
      });
      const disabled = await availability('entry-disabled');
      expect(disabled).toMatchObject({
        availability: 'disabled',
        relevantSession: null,
        nextSession: null
      });
      expect(Object.keys(disabled.venue!).sort()).toEqual(['code', 'name', 'timezone']);
    });
    it.each(['', 'UPPER-case', 'nohyphen', 'a-'.repeat(33), '../entry', 'entry-valid\n'])(
      'rejects malformed venue selector %j',
      async (code) => {
        await expect(availability(code)).rejects.toMatchObject({ code: '22023' });
      }
    );
    it.each(statusCases)(
      'own LINE status %s -> %s, with no identifiers or profile',
      async (kind, status) => {
        expect(await learnerStatus(subjects.get(kind)!)).toEqual({ version: 1, status });
      }
    );
    it.each(['', 'u' + '1'.repeat(32), 'U' + 'A'.repeat(32), 'U123', subjectFor(1) + '\n'])(
      'rejects malformed LINE subjects %j',
      async (subject) => {
        await expect(learnerStatus(subject)).rejects.toMatchObject({ code: '22023' });
      }
    );
    it('ignores forged incoming subject/person/principal context and restores subject scope', async () => {
      await runtime(async (client) => {
        const approved = subjects.get('approved')!;
        await client.query(
          "SELECT set_config('qigong.venue_entry_subject',$1,TRUE),set_config('qigong.person_id',$2,TRUE),set_config('qigong.principal_id',$3,TRUE)",
          [approved, people.get('approved'), principal]
        );
        const result = await client.query<{ data: VenueEntryLearnerStatusDto }>(
          'SELECT platform.venue_entry_learner_status($1) data',
          [subjects.get('pending')]
        );
        expect(result.rows[0]!.data).toEqual({ version: 1, status: 'pending' });
        expect(
          (
            await client.query<{ subject: string }>(
              "SELECT current_setting('qigong.venue_entry_subject') subject"
            )
          ).rows[0]!.subject
        ).toBe(approved);
      });
    });
    it('unknown/pending status does not loosen the existing strict approved resolver', async () => {
      await runtime(async (client) => {
        for (const kind of ['unknown', 'pending', 'rejected', 'revoked']) {
          const result = await client.query<{ data: unknown }>(
            'SELECT platform.resolve_line_learner_identity($1) data',
            [subjects.get(kind)]
          );
          expect(result.rows[0]!.data).toBeNull();
        }
      });
    });
    it('all reads preserve every business row, including application, consent and attendance', async () => {
      const before = await fingerprint();
      await availability('entry-active');
      await availability('entry-disabled');
      await availability('entry-missing');
      for (const [kind] of statusCases) await learnerStatus(subjects.get(kind)!);
      expect(await fingerprint()).toEqual(before);
    });
    it('new owners are safe, membership-free, own no tables and have no schema CREATE', async () => {
      const roles = (
        await pool.query<{
          rolname: string;
          safe: boolean;
          membership: boolean;
          owns_table: boolean;
          creates: boolean;
        }>(
          "SELECT r.rolname,NOT(r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) safe,EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid=r.oid OR m.member=r.oid) membership,EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid) owns_table,EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('identity','core','platform','admin','audit','ops','public') AND has_schema_privilege(r.oid,n.oid,'CREATE')) creates FROM pg_roles r WHERE r.rolname=ANY($1::text[]) ORDER BY r.rolname",
          [[publicOwner, privateOwner]]
        )
      ).rows;
      expect(roles).toHaveLength(2);
      for (const role of roles)
        expect(role).toMatchObject({
          safe: true,
          membership: false,
          owns_table: false,
          creates: false
        });
    });
    it('five input tables retain FORCE RLS; the added region policy preserves preexisting enforcement settings', async () => {
      const tables = (
        await pool.query<{ safe: boolean }>(
          "SELECT c.relrowsecurity AND c.relforcerowsecurity AND c.relowner NOT IN(SELECT oid FROM pg_roles WHERE rolname=ANY($1::text[])) safe FROM pg_class c WHERE c.oid=ANY(ARRAY['core.practice_fields'::regclass,'identity.people'::regclass,'identity.platform_identities'::regclass,'identity.onboarding_applications'::regclass,'identity.person_interaction_channels'::regclass])",
          [[publicOwner, privateOwner]]
        )
      ).rows;
      expect(tables).toHaveLength(5);
      expect(tables.every((table) => table.safe)).toBe(true);
      const regionSecurity = (
        await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='core.regions'::regclass"
        )
      ).rows[0]!;
      expect(regionSecurity).toEqual(regionSecurityBefore);
      const regionPolicy = (
        await pool.query<{ roles: string[]; cmd: string }>(
          "SELECT roles::text[] AS roles,cmd FROM pg_policies WHERE schemaname='core' AND tablename='regions' AND policyname='venue_entry_public_regions'"
        )
      ).rows;
      expect(regionPolicy).toEqual([{ roles: [publicOwner], cmd: 'SELECT' }]);
    });
    it('public reader is denied identity access, while private reader is denied venue/contact/reflection columns', async () => {
      for (const query of [
        'SELECT id FROM identity.people',
        'SELECT external_subject_id FROM identity.platform_identities'
      ])
        await expect(asOwner(publicOwner, (client) => client.query(query))).rejects.toMatchObject({
          code: '42501'
        });
      for (const query of [
        'SELECT code FROM core.practice_fields',
        'SELECT id FROM core.regions',
        'SELECT legal_name FROM identity.people',
        'SELECT website_email,phone_e164 FROM identity.onboarding_applications',
        'SELECT practice_note FROM core.checkin_notes'
      ])
        await expect(asOwner(privateOwner, (client) => client.query(query))).rejects.toMatchObject({
          code: '42501'
        });
      for (const query of [
        'SELECT latitude,longitude,address,radius_meters FROM core.practice_fields',
        'SELECT code,name_zh_tw,name_en FROM core.regions',
        'SELECT id FROM core.field_attendance'
      ])
        await expect(asOwner(publicOwner, (client) => client.query(query))).rejects.toMatchObject({
          code: '42501'
        });
    });
    it('both readers have exactly the minimum project column privileges and no table DML', async () => {
      const columns = (
        await pool.query<{ role: string; relation: string; columns: string[] }>(
          "SELECT r.rolname role,n.nspname||'.'||c.relname relation,array_agg(a.attname::text ORDER BY a.attname) columns FROM pg_roles r CROSS JOIN pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolname=ANY($1::text[]) AND n.nspname IN ('identity','core','platform','admin','audit','ops','reporting') AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(r.oid,c.oid,a.attnum,'SELECT') GROUP BY r.rolname,n.nspname,c.relname ORDER BY r.rolname,relation",
          [[publicOwner, privateOwner]]
        )
      ).rows;
      expect(columns).toEqual([
        {
          role: privateOwner,
          relation: 'identity.onboarding_applications',
          columns: ['external_subject_id', 'person_id', 'platform', 'status']
        },
        { role: privateOwner, relation: 'identity.people', columns: ['id', 'status'] },
        {
          role: privateOwner,
          relation: 'identity.person_interaction_channels',
          columns: ['person_id', 'platform_identity_id', 'valid_from', 'valid_to']
        },
        {
          role: privateOwner,
          relation: 'identity.platform_identities',
          columns: [
            'external_subject_id',
            'id',
            'person_id',
            'platform',
            'revoked_at',
            'verified_at'
          ]
        },
        {
          role: publicOwner,
          relation: 'core.practice_fields',
          columns: [
            'active_time_rules',
            'code',
            'is_active',
            'name_en',
            'name_zh_tw',
            'region_id',
            'timezone'
          ]
        },
        {
          role: publicOwner,
          relation: 'core.regions',
          columns: ['active', 'id', 'parent_region_id', 'region_type']
        }
      ]);
      const dml = await pool.query(
        "SELECT r.rolname,c.oid FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolname=ANY($1::text[]) AND n.nspname IN ('identity','core','platform','admin','audit','ops','reporting') AND c.relkind IN ('r','p') AND (has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE'))",
        [[publicOwner, privateOwner]]
      );
      expect(dml.rows).toEqual([]);
    });
    it('private owner RLS defaults closed, then sees only the scoped subject and its related person/channels', async () => {
      await asOwner(privateOwner, async (client) => {
        expect(
          (await client.query('SELECT external_subject_id FROM identity.platform_identities')).rows
        ).toEqual([]);
        const subject = subjects.get('approved')!;
        await client.query("SELECT set_config('qigong.venue_entry_subject',$1,TRUE)", [subject]);
        expect(
          (await client.query('SELECT external_subject_id FROM identity.platform_identities')).rows
        ).toEqual([{ external_subject_id: subject }]);
        expect((await client.query('SELECT id FROM identity.people')).rows).toEqual([
          { id: people.get('approved') }
        ]);
        expect(
          (await client.query('SELECT person_id FROM identity.person_interaction_channels')).rows
        ).toEqual([{ person_id: people.get('approved') }]);
      });
    });
    it('new function ACLs have no PUBLIC, worker, grant-option or default-ACL residue', async () => {
      const grants = (
        await pool.query<{ proname: string; grantee: string; is_grantable: boolean }>(
          "SELECT p.proname,coalesce(r.rolname,'PUBLIC') grantee,a.is_grantable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a LEFT JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='platform' AND p.proname IN ('venue_entry_schedule_context','venue_entry_availability','venue_entry_learner_status') AND a.grantee<>p.proowner ORDER BY p.proname,grantee"
        )
      ).rows;
      expect(grants).toEqual([
        { proname: 'venue_entry_availability', grantee: 'qigong_api_runtime', is_grantable: false },
        {
          proname: 'venue_entry_learner_status',
          grantee: 'qigong_api_runtime',
          is_grantable: false
        }
      ]);
      const owners = (
        await pool.query<{
          proname: string;
          owner: string;
          prosecdef: boolean;
          proconfig: string[];
        }>(
          "SELECT p.proname,r.rolname owner,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='platform' AND p.proname LIKE 'venue_entry_%' ORDER BY p.proname"
        )
      ).rows;
      expect(owners).toHaveLength(3);
      for (const routine of owners) {
        expect(routine.proconfig).toContain('search_path=pg_catalog');
        expect(routine.proconfig).toContain('row_security=on');
        expect(routine.owner).toBe(
          routine.proname === 'venue_entry_learner_status' ? privateOwner : publicOwner
        );
        expect(routine.prosecdef).toBe(routine.proname !== 'venue_entry_schedule_context');
      }
    });
    it('old pure helper adds exactly one legitimate owner while API/worker remain denied', async () => {
      const grants = (
        await pool.query<{ rolname: string }>(
          "SELECT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid='platform.venue_checkin_window(jsonb,text,timestamptz)'::regprocedure AND a.grantee<>p.proowner ORDER BY r.rolname"
        )
      ).rows.map((row) => row.rolname);
      expect(grants).toEqual(['qigong_venue_debug', publicOwner, 'qigong_venue_qr_writer']);
    });
    for (const role of ['qigong_api_runtime', 'qigong_worker_runtime'] as const) {
      it(`${role} still has no raw venue SELECT grant`, async () => {
        await expect(
          runtime((client) => client.query('SELECT code FROM core.practice_fields'), role)
        ).rejects.toMatchObject({ code: '42501' });
      });
      it(`${role} cannot execute either clock-injectable helper`, async () => {
        for (const name of ['venue_checkin_window', 'venue_entry_schedule_context'])
          await expect(
            runtime(
              (client) =>
                client.query(`SELECT platform.${name}($1::jsonb,'Asia/Taipei',clock_timestamp())`, [
                  JSON.stringify(monday)
                ]),
              role
            )
          ).rejects.toMatchObject({ code: '42501' });
      });
      it(`${role} cannot acquire new reader memberships`, async () => {
        for (const owner of [publicOwner, privateOwner])
          await expect(
            asRuntimeSession(role, (client) => client.query(`SET LOCAL ROLE ${owner}`))
          ).rejects.toMatchObject({ code: '42501' });
      });
    }
    it('worker cannot execute either new facade', async () => {
      await expect(
        runtime(
          (client) => client.query("SELECT platform.venue_entry_availability('entry-active')"),
          'qigong_worker_runtime'
        )
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtime(
          (client) =>
            client.query('SELECT platform.venue_entry_learner_status($1)', [
              subjects.get('approved')
            ]),
          'qigong_worker_runtime'
        )
      ).rejects.toMatchObject({ code: '42501' });
    });
  }
);
