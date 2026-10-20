import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
interface RuleConfig {
  nameZhTw: string;
  nameZhCn: string;
  nameEn: string;
  description: string;
  effectiveDate: string;
  threshold: number;
  continuous: boolean;
  methodCodes: string[];
  methodMatch: 'any' | 'all';
  startMode: 'effective' | 'date';
  startDate: string | null;
}
interface Draft {
  id: string;
  code: string;
  revision: number;
  baseHash: string;
  baseConfig: unknown;
}
interface Person {
  id: string;
  identity: string;
  assignment: string;
}
suite('Versioned committed-mutation awarding, withdrawal/restoration and scheduled gates', () => {
  let root: Pool,
    runtime: Pool,
    dispose: () => Promise<void>,
    login: string,
    principal: string,
    person: Person,
    start: string;
  const invoke = async <T extends pg.QueryResultRow>(sql: string, values: unknown[] = []) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: principal },
      (c) => c.query<T>(sql, values)
    );
  const config = (extra: Partial<RuleConfig> = {}): RuleConfig => ({
    nameZhTw: 'Synthetic runtime badge',
    nameZhCn: '',
    nameEn: 'Synthetic runtime',
    description: 'Synthetic historical fixture only',
    effectiveDate: start,
    threshold: 2,
    continuous: false,
    methodCodes: ['huichun_chu'],
    methodMatch: 'any',
    startMode: 'effective',
    startDate: null,
    ...extra
  });
  const date = async (offset: number) =>
    (await root.query<{ d: string }>('SELECT ($1::date+$2::integer)::text d', [start, offset]))
      .rows[0]!.d;
  const historicalVersion = async (cfg = config(), previous?: Draft, version = 1) => {
    const d = (
      await invoke<{ data: Draft }>(
        "SELECT admin.save_achievement_config_draft($1,$2,'challenge',$3,NULL,$4,'Synthetic historical runtime') data",
        [previous?.id ?? null, previous?.revision ?? 0, previous?.code ?? null, cfg]
      )
    ).rows[0]!.data;
    const zones = (
      await root.query<{ zones: string[] }>(
        "SELECT ARRAY['UTC','Pacific/Kiritimati','Etc/GMT+12'] zones"
      )
    ).rows[0]!.zones;
    const snap = {
      formatVersion: 1,
      draftId: d.id,
      draftRevision: d.revision,
      code: d.code,
      candidateVersion: version,
      subject: 'challenge',
      year: null,
      config: cfg,
      baseConfig: d.baseConfig,
      baseHash: d.baseHash,
      sourceHash: d.baseHash,
      configHash: (
        await root.query<{ h: string }>(
          "SELECT encode(public.digest($1::jsonb::text,'sha256'),'hex') h",
          [cfg]
        )
      ).rows[0]!.h,
      timezoneSnapshot: zones,
      deadline: null,
      effectiveDate: cfg.effectiveDate,
      state: 'awaiting_activation',
      activationEnabled: false,
      awardingEnabled: false
    };
    const candidate = (
      await root.query<{ id: string }>(
        "INSERT INTO admin.achievement_publication_candidates(draft_id,draft_revision,code,candidate_version,subject,config_hash,base_hash,source_hash,snapshot,snapshot_hash,effective_date,prepared_by,reason) VALUES($1,$2,$3,$4,'challenge',$5,$6,$6,$7,encode(public.digest($7::jsonb::text,'sha256'),'hex'),$8,$9,'Synthetic past fixture, not API backdating') RETURNING id",
        [
          d.id,
          d.revision,
          d.code,
          version,
          snap.configHash,
          d.baseHash,
          snap,
          cfg.effectiveDate,
          principal
        ]
      )
    ).rows[0]!.id;
    await root.query(
      "INSERT INTO core.achievement_badge_identities(code,origin) VALUES($1,'versioned') ON CONFLICT DO NOTHING",
      [d.code]
    );
    await root.query(
      "INSERT INTO core.achievement_runtime_versions(code,rule_version,candidate_id,subject,snapshot,snapshot_hash,effective_date,earliest_start_at,published_by,published_at) SELECT code,candidate_version,id,subject,snapshot,snapshot_hash,effective_date,effective_date::timestamp AT TIME ZONE 'Pacific/Kiritimati',prepared_by,(effective_date-1)::timestamp AT TIME ZONE 'UTC' FROM admin.achievement_publication_candidates WHERE id=$1",
      [candidate]
    );
    return { draft: d, code: d.code, candidate };
  };
  const historicalEvent = async (startDate: string, endDate: string, requiredDays = 1) => {
    const cfg = {
      nameZhTw: 'Synthetic finite event',
      nameZhCn: '',
      nameEn: 'Synthetic event',
      description: 'Historical fixture, not an activation bypass',
      effectiveDate: startDate,
      startDate,
      endDate,
      timezone: 'UTC',
      requiredDays,
      continuous: false
    };
    const d = (
      await invoke<{ data: Draft }>(
        "SELECT admin.save_achievement_config_draft(NULL,0,'event',NULL,NULL,$1,'Synthetic finite fixture') data",
        [cfg]
      )
    ).rows[0]!.data;
    const zones = (
      await root.query<{ zones: string[] }>(
        "SELECT array_agg(name ORDER BY name) zones FROM pg_timezone_names WHERE name='UTC' OR(position('/' IN name)>0 AND name !~ '^(posix|right)/')"
      )
    ).rows[0]!.zones;
    const deadline = (
      await root.query<{ data: { latestMakeupCutoff: string; settlementAt: string } }>(
        'SELECT admin._achievement_activity_deadline($1,$2) data',
        [endDate, zones]
      )
    ).rows[0]!.data;
    const h = (
        await root.query<{ h: string }>(
          "SELECT encode(public.digest($1::jsonb::text,'sha256'),'hex') h",
          [cfg]
        )
      ).rows[0]!.h,
      snapshot = {
        formatVersion: 1,
        draftId: d.id,
        draftRevision: 1,
        code: d.code,
        candidateVersion: 1,
        subject: 'event',
        year: null,
        config: cfg,
        baseConfig: d.baseConfig,
        baseHash: d.baseHash,
        sourceHash: d.baseHash,
        configHash: h,
        timezoneSnapshot: zones,
        deadline,
        effectiveDate: startDate,
        state: 'awaiting_activation',
        activationEnabled: false,
        awardingEnabled: false
      };
    const c = (
      await root.query<{ id: string }>(
        "INSERT INTO admin.achievement_publication_candidates(draft_id,draft_revision,code,candidate_version,subject,config_hash,base_hash,source_hash,snapshot,snapshot_hash,effective_date,prepared_by,reason) VALUES($1,1,$2,1,'event',$3,$4,$4,$5,encode(public.digest($5::jsonb::text,'sha256'),'hex'),$6,$7,'Synthetic past fixture') RETURNING id",
        [d.id, d.code, h, d.baseHash, snapshot, startDate, principal]
      )
    ).rows[0]!.id;
    await root.query(
      "INSERT INTO core.achievement_badge_identities(code,origin) VALUES($1,'versioned')",
      [d.code]
    );
    await root.query(
      "INSERT INTO core.achievement_runtime_versions(code,rule_version,candidate_id,subject,snapshot,snapshot_hash,effective_date,earliest_start_at,published_by) SELECT code,1,id,subject,snapshot,snapshot_hash,effective_date,effective_date::timestamp AT TIME ZONE 'Pacific/Kiritimati',prepared_by FROM admin.achievement_publication_candidates WHERE id=$1",
      [c]
    );
    return { code: d.code, deadline };
  };
  const write = async (day: string, methods: string[]) => {
    const c = await root.connect();
    try {
      await c.query('BEGIN');
      let row = (
        await c.query<{ id: string }>(
          'SELECT id FROM core.checkins WHERE person_id=$1 AND practice_date=$2',
          [person.id, day]
        )
      ).rows[0];
      if (!row)
        row = (
          await c.query<{ id: string }>(
            "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) VALUES($1,$2,$3,'UTC','regular',$4) RETURNING id",
            [person.id, person.identity, day, person.assignment]
          )
        ).rows[0]!;
      await c.query('DELETE FROM core.checkin_method_selections WHERE checkin_id=$1', [row.id]);
      await c.query(
        'INSERT INTO core.checkin_method_selections(checkin_id,practice_method_id) SELECT $1,id FROM core.practice_methods WHERE code=ANY($2::text[])',
        [row.id, methods]
      );
      await c.query('COMMIT');
      return row.id;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  };
  const awards = async (code: string) =>
    (
      await root.query<{ rule_version: number; earned_at: Date; revoked_at: Date | null }>(
        'SELECT rule_version,earned_at,revoked_at FROM core.person_practice_badges WHERE person_id=$1 AND badge_code=$2 ORDER BY rule_version',
        [person.id, code]
      )
    ).rows;
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    await runMigrations(root, dir, 'versioned-runtime-test');
    login = 'runtime_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime TO ${login}`);
    const url = new URL(db.databaseUrl);
    url.username = login;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    principal = (
      await root.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://runtime.example.invalid','super','Synthetic runtime manager') RETURNING id"
      )
    ).rows[0]!.id;
    await root.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic runtime role' FROM admin.roles WHERE code='super_admin'",
      [principal]
    );
    start = (await root.query<{ d: string }>('SELECT (CURRENT_DATE-20)::text d')).rows[0]!.d;
    const region = (
      await root.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('runtime-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'runtime-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'runtime-region','operational','區域','Region' FROM c RETURNING id"
      )
    ).rows[0]!.id;
    const id = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic runtime learner','UTC') RETURNING id"
        )
      ).rows[0]!.id,
      identity = (
        await root.query<{ id: string }>(
          "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id,verified_at) VALUES($1,'telegram','678900001',clock_timestamp()-INTERVAL '1 day') RETURNING id",
          [id]
        )
      ).rows[0]!.id,
      assignment = (
        await root.query<{ id: string }>(
          "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-60) RETURNING id",
          [id, region]
        )
      ).rows[0]!.id;
    person = { id, identity, assignment };
  });
  afterAll(async () => {
    await runtime?.end();
    if (login) {
      await root.query(`DROP OWNED BY ${login}`);
      await root.query(`DROP ROLE ${login}`);
    }
    await dispose?.();
  });
  it('defaults the operator control OFF and denies activation/raw control mutation even to runtime super', async () => {
    expect(
      (await root.query('SELECT ops.versioned_achievements_enabled() enabled')).rows[0]!.enabled
    ).toBe(false);
    expect(
      (await invoke<{ allowed: boolean }>('SELECT admin.can_activate_achievement_now() allowed'))
        .rows[0]!.allowed
    ).toBe(false);
    await expect(
      invoke('UPDATE ops.versioned_achievement_control SET enabled=TRUE')
    ).rejects.toMatchObject({ code: '42501' });
    await root.query('UPDATE ops.versioned_achievement_control SET enabled=TRUE');
  });
  it('earns at successful commit, withdraws on correction and restores the same original record without duplicate audit', async () => {
    const v = await historicalVersion();
    await write(start, ['huichun_chu']);
    expect(await awards(v.code)).toEqual([]);
    await write(await date(1), ['huichun_chu']);
    const original = (await awards(v.code))[0]!;
    expect(original.revoked_at).toBeNull();
    await write(await date(1), ['dayan_chu']);
    expect((await awards(v.code))[0]!.revoked_at).not.toBeNull();
    await write(await date(1), ['dayan_chu']);
    await write(await date(1), ['huichun_chu']);
    const restored = (await awards(v.code))[0]!;
    expect(restored.earned_at).toEqual(original.earned_at);
    expect(restored.revoked_at).toBeNull();
    expect(
      (
        await root.query(
          'SELECT action,cause FROM audit.achievement_transitions WHERE badge_code=$1 ORDER BY created_at,id',
          [v.code]
        )
      ).rows
    ).toEqual([
      { action: 'earned', cause: 'committed_practice_change' },
      { action: 'revoked', cause: 'committed_practice_change' },
      { action: 'restored', cause: 'committed_practice_change' }
    ]);
    expect(
      (
        await root.query(
          'SELECT dirty_generation=evaluated_generation clean FROM ops.practice_badge_jobs WHERE person_id=$1',
          [person.id]
        )
      ).rows[0]!.clean
    ).toBe(true);
  });
  it('does not use a newer version to revoke an old award or carry earlier history into the new version', async () => {
    const v1 = await historicalVersion(config({ threshold: 2 }));
    await root.query('SELECT core.evaluate_practice_badges($1)', [person.id]);
    expect((await awards(v1.code)).map((a) => a.rule_version)).toEqual([1]);
    const effective = await date(10),
      v2 = await historicalVersion(
        config({ effectiveDate: effective, threshold: 3, continuous: true }),
        v1.draft,
        2
      );
    await root.query('SELECT core.evaluate_practice_badges($1)', [person.id]);
    expect((await awards(v1.code)).map((a) => a.rule_version)).toEqual([1]);
    for (const offset of [10, 11, 12]) await write(await date(offset), ['huichun_chu']);
    expect((await awards(v2.code)).map((a) => a.rule_version)).toEqual([1, 2]);
    expect((await awards(v2.code)).every((a) => a.revoked_at === null)).toBe(true);
  });
  it('keeps unprovable old award versions unchanged rather than guessing current conditions', async () => {
    await root.query(
      "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',999)",
      [person.id]
    );
    const before = (
      await root.query(
        'SELECT to_jsonb(b) data FROM core.person_practice_badges b WHERE person_id=$1 AND rule_version=999',
        [person.id]
      )
    ).rows[0]!.data;
    await write(await date(15), ['dayan_chu']);
    expect(
      (
        await root.query(
          'SELECT to_jsonb(b) data FROM core.person_practice_badges b WHERE person_id=$1 AND rule_version=999',
          [person.id]
        )
      ).rows[0]!.data
    ).toEqual(before);
  });
  it('publishes a genuinely future sealed candidate exactly once and permits only a pre-start cancellation', async () => {
    const cfg = config({ effectiveDate: '2199-01-01' }),
      d = (
        await invoke<{ data: Draft }>(
          "SELECT admin.save_achievement_config_draft(NULL,0,'challenge',NULL,NULL,$1,'Synthetic future release') data",
          [cfg]
        )
      ).rows[0]!.data,
      r = (
        await invoke<{
          data: { revision: number; configHash: string; baseHash: string; sourceHash: string };
        }>('SELECT admin.achievement_publication_review($1) data', [d.id])
      ).rows[0]!.data,
      c = (
        await invoke<{ data: { id: string; snapshotHash: string } }>(
          "SELECT admin.prepare_achievement_publication($1,$2,$3,$4,$5,'Synthetic future',TRUE) data",
          [d.id, r.revision, r.configHash, r.baseHash, r.sourceHash]
        )
      ).rows[0]!.data;
    const a = (
      await invoke<{ data: { registered: boolean; cancelled: boolean } }>(
        "SELECT admin.activate_achievement_version($1,$2,'Synthetic schedule',TRUE) data",
        [c.id, c.snapshotHash]
      )
    ).rows[0]!.data;
    expect(a).toMatchObject({ registered: true, cancelled: false });
    expect(await awards(d.code)).toEqual([]);
    await invoke("SELECT admin.activate_achievement_version($1,$2,'Synthetic retry',TRUE)", [
      c.id,
      c.snapshotHash
    ]);
    expect(
      (
        await root.query(
          "SELECT count(*)::int n FROM audit.events WHERE action='achievement.version_scheduled' AND target_id=$1",
          [c.id]
        )
      ).rows[0]!.n
    ).toBe(1);
    expect(
      (
        await invoke<{ data: { cancelled: boolean } }>(
          "SELECT admin.cancel_achievement_activation($1,$2,'Synthetic cancel',TRUE) data",
          [c.id, c.snapshotHash]
        )
      ).rows[0]!.data.cancelled
    ).toBe(true);
    await expect(
      invoke("SELECT admin.activate_achievement_version($1,$2,'No resurrection',TRUE)", [
        c.id,
        c.snapshotHash
      ])
    ).rejects.toMatchObject({ code: '55000' });
    expect(
      (
        await root.query(
          'SELECT activation_enabled FROM admin.achievement_publication_candidates WHERE id=$1',
          [c.id]
        )
      ).rows[0]!.activation_enabled
    ).toBe(false);
  });
  it('enforces the full global makeup cutoff plus24hours in the pure qualifier and all real-time/read paths', async () => {
    const dates = (
        await root.query<{ start: string; end: string }>(
          'SELECT (CURRENT_DATE-1)::text start,CURRENT_DATE::text end'
        )
      ).rows[0]!,
      v = await historicalEvent(dates.start, dates.end);
    await write(dates.start, ['dayan_chu']);
    expect(await awards(v.code)).toEqual([]);
    const before = (
      await root.query<{ data: { qualifies: boolean; grant_ready: boolean } }>(
        "SELECT to_jsonb(q) data FROM core.achievement_qualifying_periods($1,$2,1,$3::timestamptz-INTERVAL '1 millisecond') q",
        [person.id, v.code, v.deadline.settlementAt]
      )
    ).rows[0]!.data;
    expect(before).toMatchObject({ qualifies: true, grant_ready: false });
    expect(
      (
        await root.query<{ grant_ready: boolean }>(
          'SELECT grant_ready FROM core.achievement_qualifying_periods($1,$2,1,$3)',
          [person.id, v.code, v.deadline.settlementAt]
        )
      ).rows[0]!.grant_ready
    ).toBe(true);
    await root.query('SELECT core.evaluate_practice_badges($1)', [person.id]);
    expect(await awards(v.code)).toEqual([]);
    const client = await root.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const own = (
        await client.query<{ data: Array<{ code: string; awards: unknown[] }> }>(
          "SELECT platform._achievement_version_badges($1,'en') data",
          [person.id]
        )
      ).rows[0]!.data;
      expect(own.find((b) => b.code === v.code)!.awards).toEqual([]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
  it('locks conditions of already-started event versions without rewriting the draft or snapshot', async () => {
    const startDate = await date(2),
      endDate = await date(5),
      v = await historicalEvent(startDate, endDate),
      draft = (
        await root.query<{ id: string; revision: number; config: unknown }>(
          'SELECT id,revision,config FROM admin.achievement_config_drafts WHERE code=$1',
          [v.code]
        )
      ).rows[0]!;
    await expect(
      invoke(
        "SELECT admin.save_achievement_config_draft($1,$2,'event',$3,NULL,$4,'Forbidden started change')",
        [draft.id, draft.revision, v.code, draft.config]
      )
    ).rejects.toMatchObject({ code: '55000' });
    expect(
      (
        await invoke<{ data: { locked: boolean } }>(
          'SELECT admin.achievement_config_draft($1) data',
          [draft.id]
        )
      ).rows[0]!.data.locked
    ).toBe(true);
  });
  it('keeps read reports pure and uses background reconciliation only as a durable catch-up path', async () => {
    const v = await historicalVersion(config({ threshold: 1 }));
    expect(await awards(v.code)).toEqual([]);
    expect(
      (
        await root.query(
          "SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='platform' AND p.proname LIKE '%workspace%report%' AND p.prokind='f' AND position('PERFORM core.evaluate_practice_badges(target);' IN pg_get_functiondef(p.oid))>0"
        )
      ).rows[0]!.n
    ).toBe(0);
    await root.query(
      'UPDATE ops.practice_badge_jobs SET due_at=clock_timestamp() WHERE person_id=$1',
      [person.id]
    );
    await withRequestContext(root, 'qigong_worker_runtime', { requestId: randomUUID() }, (c) =>
      c.query('SELECT ops.reconcile_practice_badges(20)')
    );
    expect((await awards(v.code))[0]!.revoked_at).toBeNull();
    const count = (
      await root.query(
        'SELECT count(*)::int n FROM audit.achievement_transitions WHERE badge_code=$1',
        [v.code]
      )
    ).rows[0]!.n;
    await root.query('SELECT core.evaluate_practice_badges($1)', [person.id]);
    expect(
      (
        await root.query(
          'SELECT count(*)::int n FROM audit.achievement_transitions WHERE badge_code=$1',
          [v.code]
        )
      ).rows[0]!.n
    ).toBe(count);
  });
  it('evaluates same-day ALL methods once per committed date, never intermediate selection states', async () => {
    const v = await historicalVersion(
      config({ threshold: 2, methodCodes: ['huichun_chu', 'huichun_zhong'], methodMatch: 'all' })
    );
    await write(await date(16), ['huichun_chu', 'huichun_zhong']);
    expect(await awards(v.code)).toEqual([]);
    await write(await date(17), ['huichun_chu', 'huichun_zhong']);
    expect((await awards(v.code))[0]!.revoked_at).toBeNull();
    await write(await date(17), ['huichun_chu']);
    expect((await awards(v.code))[0]!.revoked_at).not.toBeNull();
    await write(await date(17), ['huichun_chu', 'huichun_zhong']);
    expect((await awards(v.code))[0]!.revoked_at).toBeNull();
    expect(
      (
        await root.query(
          'SELECT action FROM audit.achievement_transitions WHERE badge_code=$1 ORDER BY created_at,id',
          [v.code]
        )
      ).rows.map((r) => r.action)
    ).toEqual(['earned', 'revoked', 'restored']);
  });
  it('rolls back the entire committed practice change if transition audit fails', async () => {
    const v = await historicalVersion(config({ threshold: 1 })),
      day = await date(18);
    await root.query(
      "CREATE FUNCTION audit.reject_runtime_fixture() RETURNS TRIGGER LANGUAGE plpgsql AS $$BEGIN IF NEW.cause='committed_practice_change' THEN RAISE EXCEPTION 'Synthetic audit rejected';END IF;RETURN NEW;END$$;CREATE TRIGGER reject_runtime_fixture BEFORE INSERT ON audit.achievement_transitions FOR EACH ROW EXECUTE FUNCTION audit.reject_runtime_fixture()"
    );
    try {
      await expect(write(day, ['huichun_chu'])).rejects.toMatchObject({ code: 'P0001' });
      expect(
        (
          await root.query(
            'SELECT count(*)::int n FROM core.checkins WHERE person_id=$1 AND practice_date=$2',
            [person.id, day]
          )
        ).rows[0]!.n
      ).toBe(0);
      expect(await awards(v.code)).toEqual([]);
    } finally {
      await root.query(
        'DROP TRIGGER reject_runtime_fixture ON audit.achievement_transitions;DROP FUNCTION audit.reject_runtime_fixture()'
      );
    }
  });
  it('does not lose a committed wake-up when a background worker skips the writer-held person lock', async () => {
    const v = await historicalVersion(config({ threshold: 1, methodCodes: ['lotus'] })),
      day = await date(18),
      c = await root.connect();
    await root.query(
      'UPDATE ops.practice_badge_jobs SET due_at=clock_timestamp() WHERE person_id=$1',
      [person.id]
    );
    try {
      await c.query('BEGIN');
      const checkin = (
        await c.query<{ id: string }>(
          "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id) VALUES($1,$2,$3,'UTC','regular',$4) RETURNING id",
          [person.id, person.identity, day, person.assignment]
        )
      ).rows[0]!.id;
      await c.query(
        "INSERT INTO core.checkin_method_selections(checkin_id,practice_method_id) SELECT $1,id FROM core.practice_methods WHERE code='lotus'",
        [checkin]
      );
      const worker = await withRequestContext(
        root,
        'qigong_worker_runtime',
        { requestId: randomUUID() },
        (q) => q.query<{ processed: number }>('SELECT ops.reconcile_practice_badges(20) processed')
      );
      expect(worker.rows[0]!.processed).toBe(0);
      await c.query('COMMIT');
      expect((await awards(v.code))[0]!.revoked_at).toBeNull();
      expect(
        (
          await root.query(
            'SELECT dirty_generation=evaluated_generation clean FROM ops.practice_badge_jobs WHERE person_id=$1',
            [person.id]
          )
        ).rows[0]!.clean
      ).toBe(true);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
  it('keeps all legacy qualification families and the new ANY/ALL/streak combinations explicit', async () => {
    const first = await date(2),
      last = await date(6),
      c = await root.connect();
    try {
      await c.query('BEGIN');
      for (let offset = 2; offset <= 6; offset++) {
        const day = await date(offset),
          id = (
            await c.query<{ id: string }>(
              "INSERT INTO core.checkins(person_id,submitted_via_identity_id,practice_date,practice_timezone,entry_kind,region_assignment_id,created_at) VALUES($1,$2,$3,'UTC','regular',$4,($3::date+TIME '06:00') AT TIME ZONE 'UTC') RETURNING id",
              [person.id, person.identity, day, person.assignment]
            )
          ).rows[0]!.id;
        await c.query(
          "INSERT INTO core.checkin_method_selections(checkin_id,practice_method_id) SELECT $1,id FROM core.practice_methods WHERE code IN('dayan_chu','dayan_gao')",
          [id]
        );
      }
      await c.query('COMMIT');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    const cases: ReadonlyArray<readonly [string, string[], boolean, boolean, number, boolean]> = [
      ['streak', [], false, false, 5, true],
      ['total', [], false, false, 5, true],
      ['method', ['dayan_chu'], false, false, 5, true],
      ['combo', ['dayan_chu', 'dayan_gao'], true, false, 1, true],
      ['morning', [], false, false, 5, true],
      ['night', [], false, false, 5, false],
      ['summer', [], false, false, 5, true],
      ['winter', ['guishou_bagua'], false, false, 1, false],
      ['event', [], false, true, 5, true],
      ['challenge', ['dayan_chu', 'dayan_gao'], true, true, 5, true]
    ];
    for (const [kind, methods, all, continuous, threshold, expected] of cases)
      expect(
        (
          await root.query<{ q: boolean }>(
            'SELECT core._achievement_period_qualifies($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()) q',
            [
              person.id,
              kind,
              methods,
              all,
              continuous,
              threshold,
              first,
              last,
              kind === 'combo' ? first.slice(0, 4) : 'lifetime'
            ]
          )
        ).rows[0]!.q,
        kind
      ).toBe(expected);
  });
  it('makes new historical metadata explicit and keeps private helper/worker privileges closed', async () => {
    const v = await historicalVersion(
      config({ nameZhTw: 'Human literal 練功', nameZhCn: 'Manual 简中', threshold: 1 })
    );
    const meta = (
      await root.query<{ data: { name: string; kind: string; provenance: string } }>(
        "SELECT admin._achievement_version_definition($1,1,'zh_CN') data",
        [v.code]
      )
    ).rows[0]!.data;
    expect(meta).toMatchObject({
      name: 'Manual 简中',
      kind: 'challenge',
      provenance: 'published_snapshot'
    });
    await expect(
      invoke('SELECT core.achievement_qualifying_periods($1,$2,1,clock_timestamp())', [
        person.id,
        v.code
      ])
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      (
        await root.query(
          "SELECT has_function_privilege('qigong_worker_runtime','admin.activate_achievement_version(uuid,text,text,boolean)','EXECUTE') allowed"
        )
      ).rows[0]!.allowed
    ).toBe(false);
  });
});
