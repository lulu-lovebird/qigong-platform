import { randomBytes, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '../src/index.js';
import { createIsolatedTestDatabase } from './test-database.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
interface Config {
  nameZhTw: string;
  nameZhCn: string;
  nameEn: string;
  description: string;
  effectiveDate: string;
  startDate: string;
  endDate: string;
  timezone: string;
  requiredDays: number;
  continuous: boolean;
}
interface Draft {
  id: string;
  code: string;
  revision: number;
}
interface Review {
  draftId: string;
  revision: number;
  configHash: string;
  baseHash: string;
  sourceHash: string;
  eligible: boolean;
  blockedReason: string | null;
}
interface Candidate {
  id: string;
  draftId: string;
  draftRevision: number;
  code: string;
  candidateVersion: number;
  preparedAt: string;
  snapshotHash: string;
  state: string;
  activationEnabled: boolean;
  awardingEnabled: boolean;
  stale: boolean;
  snapshot: {
    config: Config;
    timezoneSnapshot: string[];
    deadline: { latestMakeupCutoff: string; settlementAt: string };
  };
}
suite('Pending-only immutable publication preparation, never live evaluation', () => {
  let root: Pool,
    runtime: Pool,
    dispose: () => Promise<void>,
    login: string,
    old: string,
    target44: string;
  const actors: Record<string, string> = {};
  const invoke = async <T extends pg.QueryResultRow>(
    actor: string,
    sql: string,
    values: unknown[] = [],
    readonly = false
  ) =>
    withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID(), principalId: actors[actor]! },
      async (c) => {
        if (readonly) await c.query('SET TRANSACTION READ ONLY');
        return c.query<T>(sql, values);
      }
    );
  const config = (extra: Partial<Config> = {}): Config => ({
    nameZhTw: 'Synthetic pending activity',
    nameZhCn: '',
    nameEn: 'Synthetic pending',
    description: 'No activation',
    effectiveDate: '2199-01-01',
    startDate: '2199-01-01',
    endDate: '2199-01-31',
    timezone: 'UTC',
    requiredDays: 3,
    continuous: true,
    ...extra
  });
  const save = async (
    actor = 'super',
    value = config(),
    id: string | null = null,
    code: string | null = null,
    revision = 0
  ) =>
    (
      await invoke<{ data: Draft }>(
        actor,
        "SELECT admin.save_achievement_config_draft($1,$2,'event',$3,NULL,$4,'Synthetic pending draft') data",
        [id, revision, code, value]
      )
    ).rows[0]!.data;
  const review = async (id: string, actor = 'super') =>
    (
      await invoke<{ data: Review }>(
        actor,
        'SELECT admin.achievement_publication_review($1) data',
        [id],
        true
      )
    ).rows[0]!.data;
  const prepare = async (d: Draft, actor = 'super', r?: Review) => {
    const observed = r ?? (await review(d.id, actor));
    return (
      await invoke<{ data: Candidate }>(
        actor,
        'SELECT admin.prepare_achievement_publication($1,$2,$3,$4,$5,$6,TRUE) data',
        [
          d.id,
          observed.revision,
          observed.configHash,
          observed.baseHash,
          observed.sourceHash,
          'Synthetic release reason'
        ]
      )
    ).rows[0]!.data;
  };
  const business = async () => {
    const result: Record<string, string> = {};
    for (const { name } of (
      await root.query<{ name: string }>(
        "SELECT schemaname||'.'||tablename name FROM pg_tables WHERE schemaname IN('core','identity','admin','platform','audit','ops') AND tablename<>'achievement_publication_candidates' ORDER BY 1"
      )
    ).rows) {
      if (name === 'admin.achievement_config_drafts') continue;
      const where =
        name === 'audit.events'
          ? "WHERE r.action NOT LIKE 'achievement.draft_%' AND r.action<>'achievement.publication_prepared'"
          : '';
      result[name] = (
        await root.query<{ h: string }>(
          `SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'')) h FROM ${name} r ${where}`
        )
      ).rows[0]!.h;
    }
    return result;
  };
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    old = await mkdtemp(path.join(tmpdir(), 'publication43-'));
    target44 = await mkdtemp(path.join(tmpdir(), 'publication44-'));
    for (const f of await readdir(dir)) {
      if (f.endsWith('.sql') && f < '0044_') await copyFile(path.join(dir, f), path.join(old, f));
      if (f.endsWith('.sql') && f < '0045_')
        await copyFile(path.join(dir, f), path.join(target44, f));
    }
    await runMigrations(root, old, 'publication-before43');
    login = 'publication_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${login} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime TO ${login}`);
    const url = new URL(db.databaseUrl);
    url.username = login;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    for (const [actor, role] of [
      ['super', 'super_admin'],
      ['master', 'master_admin'],
      ['viewer', 'global_viewer'],
      ['expiring', 'master_admin']
    ] as const) {
      const id = (
        await root.query<{ id: string }>(
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://publication.example.invalid',$1,$1) RETURNING id",
          [actor]
        )
      ).rows[0]!.id;
      actors[actor] = id;
      await root.query(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic pending role' FROM admin.roles WHERE code=$2",
        [id, role]
      );
    }
    const snapshot = async () => {
      const result: Record<string, string> = {};
      for (const { name } of (
        await root.query<{ name: string }>(
          "SELECT schemaname||'.'||tablename name FROM pg_tables WHERE schemaname IN('core','identity','admin','platform','audit','ops') AND tablename<>'achievement_publication_candidates' ORDER BY 1"
        )
      ).rows) {
        const where =
          name === 'admin.permissions'
            ? "WHERE r.code<>'achievement.prepare_publication'"
            : name === 'admin.role_permissions'
              ? "WHERE r.permission_id NOT IN(SELECT id FROM admin.permissions WHERE code='achievement.prepare_publication')"
              : '';
        result[name] = (
          await root.query<{ h: string }>(
            `SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,'')) h FROM ${name} r ${where}`
          )
        ).rows[0]!.h;
      }
      return result;
    };
    const before = await snapshot();
    expect(Object.keys(before)).toHaveLength(80);
    const fns = (
      await root.query<{ signature: string; definition: string }>(
        "SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('core','admin','platform','ops')"
      )
    ).rows;
    expect((await runMigrations(root, target44, 'publication44')).applied).toEqual([
      '0044_achievement_publication_candidates.sql'
    ]);
    expect((await runMigrations(root, target44, 'publication44-repeat')).applied).toEqual([]);
    expect(await snapshot()).toEqual(before);
    for (const f of fns)
      expect(
        (
          await root.query<{ definition: string }>(
            'SELECT pg_get_functiondef($1::regprocedure) definition',
            [f.signature]
          )
        ).rows[0]!.definition
      ).toBe(f.definition);
  });
  afterAll(async () => {
    await runtime?.end();
    if (login) {
      await root.query(`DROP OWNED BY ${login}`);
      await root.query(`DROP ROLE ${login}`);
    }
    await dispose?.();
    if (old) await rm(old, { recursive: true, force: true });
    if (target44) await rm(target44, { recursive: true, force: true });
  });
  it.each(['super', 'master'])(
    'lets %s prepare only a sealed waiting version, preserving all live/award/job data',
    async (actor) => {
      const before = await business(),
        d = await save(actor),
        r = await review(d.id, actor);
      expect(r.eligible).toBe(true);
      const p = await prepare(d, actor, r);
      expect(p).toMatchObject({
        code: d.code,
        draftRevision: 1,
        candidateVersion: 1,
        state: 'awaiting_activation',
        activationEnabled: false,
        awardingEnabled: false,
        stale: false
      });
      expect(p.snapshot.config).toEqual(config());
      expect(p.snapshot.timezoneSnapshot).toContain('UTC');
      expect(
        Date.parse(p.snapshot.deadline.settlementAt) -
          Date.parse(p.snapshot.deadline.latestMakeupCutoff)
      ).toBe(86400000);
      expect(
        (
          await root.query(
            'SELECT count(*)::int n FROM core.practice_badge_definitions WHERE code=$1',
            [d.code]
          )
        ).rows[0]!.n
      ).toBe(0);
      expect(
        (
          await root.query(
            'SELECT count(*)::int n FROM core.achievement_rule_versions WHERE badge_code=$1',
            [d.code]
          )
        ).rows[0]!.n
      ).toBe(0);
      expect(await business()).toEqual(before);
    }
  );
  it('deduplicates concurrent same-revision preparations across the two roles without refreshing timestamp or audit', async () => {
    const d = await save(),
      r = await review(d.id),
      before = (
        await root.query(
          "SELECT count(*)::int n FROM audit.events WHERE action='achievement.publication_prepared'"
        )
      ).rows[0]!.n;
    const [a, b] = await Promise.all([prepare(d, 'super', r), prepare(d, 'master', r)]);
    expect(a.id).toBe(b.id);
    expect(a.preparedAt).toBe(b.preparedAt);
    expect(a.snapshotHash).toBe(b.snapshotHash);
    expect(
      (
        await root.query(
          "SELECT count(*)::int n FROM audit.events WHERE action='achievement.publication_prepared'"
        )
      ).rows[0]!.n
    ).toBe(before + 1);
  });
  it('does not overwrite a sealed snapshot when its draft changes or is archived', async () => {
    const d = await save(),
      p = await prepare(d);
    await save('super', config({ nameZhTw: 'New revision' }), d.id, d.code, 1);
    const read = (
      await invoke<{ data: Candidate }>(
        'super',
        'SELECT admin.achievement_publication_candidate($1) data',
        [p.id],
        true
      )
    ).rows[0]!.data;
    expect(read.stale).toBe(true);
    expect(read.snapshotHash).toBe(p.snapshotHash);
    expect(read.snapshot.config.nameZhTw).toBe('Synthetic pending activity');
    const newer = await prepare({ ...d, revision: 2 });
    expect(newer.candidateVersion).toBe(2);
    expect(newer.id).not.toBe(p.id);
    await invoke(
      'super',
      "SELECT admin.archive_achievement_config_draft($1,2,'Synthetic archive')",
      [d.id]
    );
    expect(
      (
        await invoke<{ data: Candidate }>(
          'super',
          'SELECT admin.achievement_publication_candidate($1) data',
          [newer.id]
        )
      ).rows[0]!.data.stale
    ).toBe(true);
  });
  it('rejects forged hashes/revisions, missing confirmation and past effective dates', async () => {
    const d = await save(),
      r = await review(d.id);
    for (const values of [
      [d.id, 99, r.configHash, r.baseHash, r.sourceHash, 'Synthetic', true],
      [d.id, 1, '0'.repeat(64), r.baseHash, r.sourceHash, 'Synthetic', true],
      [d.id, 1, r.configHash, r.baseHash, r.sourceHash, 'Synthetic', false]
    ])
      await expect(
        invoke(
          'super',
          'SELECT admin.prepare_achievement_publication($1,$2,$3,$4,$5,$6,$7)',
          values
        )
      ).rejects.toMatchObject({ code: values[6] === false ? '22023' : '40001' });
    const past = await save(
        'super',
        config({ effectiveDate: '2020-01-01', startDate: '2020-01-01', endDate: '2020-01-31' })
      ),
      blocked = await review(past.id);
    expect(blocked).toMatchObject({ eligible: false, blockedReason: 'effective_date_not_future' });
    await expect(prepare(past, 'super', blocked)).rejects.toMatchObject({ code: '55000' });
  });
  it('revalidates source metadata and seasonal year rather than sealing stale or mislabelled conditions', async () => {
    const value = {
      nameZhTw: 'Synthetic rule',
      nameZhCn: '',
      nameEn: '',
      description: '',
      effectiveDate: '2199-01-01',
      threshold: 3,
      methodCodes: []
    };
    const d = (
      await invoke<{ data: Draft }>(
        'super',
        "SELECT admin.save_achievement_config_draft(NULL,0,'rule','streak_3',NULL,$1,'Synthetic source') data",
        [value]
      )
    ).rows[0]!.data;
    const oldName = (
      await root.query<{ name_zh_tw: string }>(
        "SELECT name_zh_tw FROM core.practice_badge_definitions WHERE code='streak_3'"
      )
    ).rows[0]!.name_zh_tw;
    try {
      await root.query(
        "UPDATE core.practice_badge_definitions SET name_zh_tw='Changed source' WHERE code='streak_3'"
      );
      expect(await review(d.id)).toMatchObject({
        eligible: false,
        blockedReason: 'source_changed'
      });
    } finally {
      await root.query(
        "UPDATE core.practice_badge_definitions SET name_zh_tw=$1 WHERE code='streak_3'",
        [oldName]
      );
    }
    const c = config();
    const { continuous, ...season } = c;
    expect(continuous).toBe(true);
    const year = (
      await invoke<{ data: Draft }>(
        'super',
        "SELECT admin.save_achievement_config_draft(NULL,0,'activity','seasonal_winter',2198,$1,'Synthetic year') data",
        [season]
      )
    ).rows[0]!.data;
    expect(await review(year.id)).toMatchObject({
      eligible: false,
      blockedReason: 'activity_year_mismatch'
    });
  });
  it('reserves a candidate version above stored unknown legacy award versions without registering a live rule', async () => {
    const person = (
      await root.query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name) VALUES('Synthetic legacy version holder') RETURNING id"
      )
    ).rows[0]!.id;
    await root.query(
      "INSERT INTO core.person_practice_badges(person_id,badge_code,period,rule_version) VALUES($1,'streak_3','lifetime',123)",
      [person]
    );
    const d = (
      await invoke<{ data: Draft }>(
        'super',
        "SELECT admin.save_achievement_config_draft(NULL,0,'rule','streak_3',NULL,$1,'Synthetic version reserve') data",
        [
          {
            nameZhTw: 'Synthetic rule',
            nameZhCn: '',
            nameEn: '',
            description: '',
            effectiveDate: '2199-01-01',
            threshold: 3,
            methodCodes: []
          }
        ]
      )
    ).rows[0]!.data;
    const c = await prepare(d);
    expect(c.candidateVersion).toBe(124);
    expect(
      (
        await root.query(
          "SELECT count(*)::int n FROM core.achievement_rule_versions WHERE badge_code='streak_3' AND rule_version=124"
        )
      ).rows[0]!.n
    ).toBe(0);
  });
  it('checks the current source again after a real capacity-lock wait', async () => {
    const d = (
        await invoke<{ data: Draft }>(
          'super',
          "SELECT admin.save_achievement_config_draft(NULL,0,'rule','total_10',NULL,$1,'Synthetic source wait') data",
          [
            {
              nameZhTw: 'Synthetic total',
              nameZhCn: '',
              nameEn: '',
              description: '',
              effectiveDate: '2199-01-01',
              threshold: 10,
              methodCodes: []
            }
          ]
        )
      ).rows[0]!.data,
      r = await review(d.id),
      original = (
        await root.query<{ name_zh_tw: string }>(
          "SELECT name_zh_tw FROM core.practice_badge_definitions WHERE code='total_10'"
        )
      ).rows[0]!.name_zh_tw,
      lock = await root.connect();
    try {
      await lock.query('BEGIN;SELECT pg_advisory_xact_lock(1944,1)');
      const p = prepare(d, 'super', r),
        rejection = expect(p).rejects.toMatchObject({ code: '40001' });
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        blocked = (
          await root.query<{ blocked: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename=$1 AND wait_event='advisory') blocked",
            [login]
          )
        ).rows[0]!.blocked;
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(blocked).toBe(true);
      await root.query(
        "UPDATE core.practice_badge_definitions SET name_zh_tw='Changed after lock' WHERE code='total_10'"
      );
      await lock.query('COMMIT');
      await rejection;
      expect(
        (
          await root.query(
            'SELECT count(*)::int n FROM admin.achievement_publication_candidates WHERE draft_id=$1',
            [d.id]
          )
        ).rows[0]!.n
      ).toBe(0);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      await root.query(
        "UPDATE core.practice_badge_definitions SET name_zh_tw=$1 WHERE code='total_10'",
        [original]
      );
    }
  });
  it('enforces immutable rows, fixed disabled activation and raw/helper/worker/viewer denial', async () => {
    const p = await prepare(await save());
    await expect(
      root.query(
        'UPDATE admin.achievement_publication_candidates SET activation_enabled=TRUE WHERE id=$1',
        [p.id]
      )
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      root.query('DELETE FROM admin.achievement_publication_candidates WHERE id=$1', [p.id])
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      root.query('TRUNCATE admin.achievement_publication_candidates')
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      invoke('viewer', 'SELECT admin.achievement_publication_review($1)', [p.draftId])
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      invoke('super', 'SELECT * FROM admin.achievement_publication_candidates')
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      invoke('super', 'SELECT admin._achievement_publication_context($1)', [p.draftId])
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      (
        await root.query(
          "SELECT has_function_privilege('qigong_worker_runtime','admin.prepare_achievement_publication(uuid,integer,text,text,text,text,boolean)','EXECUTE') allowed"
        )
      ).rows[0]!.allowed
    ).toBe(false);
  });
  it('rolls back candidate and audit if audit storage fails', async () => {
    const d = await save(),
      r = await review(d.id);
    await root.query(
      "CREATE FUNCTION audit.block_publication_fixture() RETURNS TRIGGER LANGUAGE plpgsql AS $$BEGIN IF NEW.action='achievement.publication_prepared' THEN RAISE EXCEPTION 'Synthetic audit rejected';END IF;RETURN NEW;END$$;CREATE TRIGGER block_publication_fixture BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.block_publication_fixture()"
    );
    try {
      await expect(prepare(d, 'super', r)).rejects.toMatchObject({ code: 'P0001' });
      expect(
        (
          await root.query(
            'SELECT count(*)::int n FROM admin.achievement_publication_candidates WHERE draft_id=$1',
            [d.id]
          )
        ).rows[0]!.n
      ).toBe(0);
    } finally {
      await root.query(
        'DROP TRIGGER block_publication_fixture ON audit.events;DROP FUNCTION audit.block_publication_fixture()'
      );
    }
  });
  it('rechecks natural grant expiry after waiting on the publication capacity lock', async () => {
    const d = await save('expiring'),
      r = await review(d.id, 'expiring');
    await root.query(
      "UPDATE admin.role_grants SET valid_to=clock_timestamp()+INTERVAL '250 milliseconds' WHERE principal_id=$1",
      [actors.expiring]
    );
    const lock = await root.connect();
    try {
      await lock.query('BEGIN;SELECT pg_advisory_xact_lock(1944,1)');
      const pending = prepare(d, 'expiring', r);
      const rejection = expect(pending).rejects.toMatchObject({ code: '42501' });
      await root.query('SELECT pg_sleep(0.4)');
      await lock.query('COMMIT');
      await rejection;
      expect(
        (
          await root.query(
            'SELECT count(*)::int n FROM admin.achievement_publication_candidates WHERE draft_id=$1',
            [d.id]
          )
        ).rows[0]!.n
      ).toBe(0);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
  });
});
