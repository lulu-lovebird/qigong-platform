import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
import { managementDraftSchema } from '../src/admin-achievement-management.js';
import { publicationReviewSchema } from '../src/admin-achievement-publication.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Session-bound immutable pending-publication HTTP, no activation surface', () => {
  let root: Pool, runtime: Pool, dispose: () => Promise<void>, login: string;
  const users = new Map<string, { id: string; token: string; csrf: string; cookie: string }>();
  const api = '/admin/api/achievement-management';
  const factory = () =>
    buildApp({
      pool: runtime,
      logger: false,
      adminAuth: {
        callbackUrl: 'https://draft-http.example.invalid/admin/auth/callback',
        begin: async () => new URL('https://draft-http.example.invalid/authorize'),
        complete: async () => ({ iss: 'https://draft-http.example.invalid', sub: 'unused' })
      }
    });
  const headers = (actor = 'super') => ({
    cookie: users.get(actor)!.cookie,
    origin: 'https://checkin.baiyinqigong.org',
    'x-csrf-token': users.get(actor)!.csrf
  });
  const input = () => ({
    subject: 'rule',
    code: 'streak_3',
    year: null,
    config: {
      nameZhTw: '合成 <img src=x>',
      nameZhCn: '',
      nameEn: 'Synthetic HTTP draft',
      description: 'NO LIVE RULE CHANGE',
      effectiveDate: '2199-01-01',
      threshold: 5,
      methodCodes: []
    },
    reason: 'Synthetic internal draft',
    expectedRevision: 0
  });
  const business = async () =>
    (
      await root.query<{ h: string }>(
        'SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(d) ORDER BY code) FROM core.practice_badge_definitions d),(SELECT jsonb_agg(to_jsonb(s) ORDER BY kind,year) FROM core.practice_badge_seasons s),(SELECT jsonb_agg(to_jsonb(b) ORDER BY person_id,badge_code,period,rule_version) FROM core.person_practice_badges b),(SELECT jsonb_agg(to_jsonb(j) ORDER BY person_id) FROM ops.practice_badge_jobs j))::text) h'
      )
    ).rows[0]!.h;
  beforeAll(async () => {
    const db = await createIsolatedTestDatabase(base!);
    root = db.pool;
    dispose = () => db.dispose();
    await runMigrations(root, dir, 'management-http');
    login = 'draft_http_' + randomUUID().replaceAll('-', '');
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
          "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://draft-http.example.invalid',$1,$1) RETURNING id",
          [actor]
        )
      ).rows[0]!.id;
      await root.query(
        "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic HTTP draft' FROM admin.roles WHERE code=$2",
        [id, role]
      );
      const token = randomBytes(32).toString('base64url'),
        csrf = randomBytes(32).toString('base64url');
      await root.query(
        "INSERT INTO admin.sessions(token_hash,principal_id,expires_at) VALUES(public.digest($1,'sha256'),$2,clock_timestamp()+INTERVAL '1 hour')",
        [token, id]
      );
      users.set(actor, {
        id,
        token,
        csrf,
        cookie: '__Host-qigong-admin=' + token + '; __Host-qigong-admin-csrf=' + csrf
      });
    }
  });
  afterAll(async () => {
    await runtime?.end();
    if (login) {
      await root.query(`DROP OWNED BY ${login}`);
      await root.query(`DROP ROLE ${login}`);
    }
    await dispose?.();
  });
  const make = async (app: ReturnType<typeof factory>, actor = 'super', payload = input()) => {
    const d = await app.inject({
      method: 'POST',
      url: api + '/drafts',
      headers: headers(actor),
      payload
    });
    expect(d.statusCode).toBe(200);
    const draft = managementDraftSchema.parse(d.json());
    const review = await app.inject({
      url: api + '/drafts/' + draft.id + '/publication-review',
      headers: headers(actor)
    });
    expect(review.statusCode).toBe(200);
    return { draft, review: publicationReviewSchema.parse(review.json()) };
  };
  const payload = (r: {
    revision: number;
    configHash: string;
    baseHash: string;
    sourceHash: string;
  }) => ({
    expectedRevision: r.revision,
    expectedConfigHash: r.configHash,
    expectedBaseHash: r.baseHash,
    expectedSourceHash: r.sourceHash,
    reason: 'Synthetic immutable preparation',
    confirmed: true
  });
  it.each(['super', 'master'])(
    'lets %s prepare/retry/read an immutable waiting release without modifying live awards',
    async (actor) => {
      const app = factory(),
        before = await business();
      try {
        const { draft, review } = await make(app, actor);
        expect(review.eligible).toBe(true);
        const url = api + '/drafts/' + draft.id + '/prepare-publication',
          request = payload(review),
          prepared = await app.inject({
            method: 'POST',
            url,
            headers: headers(actor),
            payload: request
          });
        expect(prepared.statusCode).toBe(200);
        const c = prepared.json();
        expect(c).toMatchObject({
          draftId: draft.id,
          draftRevision: 1,
          code: 'streak_3',
          state: 'awaiting_activation',
          activationEnabled: false,
          awardingEnabled: false,
          stale: false
        });
        expect(c.candidateVersion).toBeGreaterThan(1);
        expect(c.snapshot.config).toEqual(input().config);
        const repeated = await app.inject({
          method: 'POST',
          url,
          headers: headers(actor),
          payload: request
        });
        expect(repeated.statusCode).toBe(200);
        expect(repeated.json()).toMatchObject({
          id: c.id,
          preparedAt: c.preparedAt,
          snapshotHash: c.snapshotHash
        });
        expect(
          (
            await root.query(
              "SELECT count(*)::int n FROM audit.events WHERE action='achievement.publication_prepared' AND target_id=$1",
              [c.id]
            )
          ).rows[0]!.n
        ).toBe(1);
        expect(
          (
            await app.inject({
              url: api + '/publication-candidates/' + c.id,
              headers: headers(actor)
            })
          ).statusCode
        ).toBe(200);
        const list = await app.inject({
          url: api + '/publication-candidates?page=1',
          headers: headers(actor)
        });
        expect(list.statusCode).toBe(200);
        expect(list.json().rows.some((r: { id: string }) => r.id === c.id)).toBe(true);
        expect(await business()).toBe(before);
        expect(
          (await app.inject({ url: api + '/capabilities', headers: headers(actor) })).json()
        ).toMatchObject({ canPreparePublication: true, canPublish: false });
        for (const endpoint of ['publish', 'activate', 'recalculate'])
          expect(
            (
              await app.inject({
                method: 'POST',
                url: api + '/' + endpoint,
                headers: headers(actor),
                payload: {}
              })
            ).statusCode
          ).toBe(404);
      } finally {
        await app.close();
      }
    }
  );
  it('requires actual sessions, role permission, exact Origin/CSRF, strict confirmation and server review hashes', async () => {
    const app = factory();
    try {
      const { draft, review } = await make(app),
        url = api + '/drafts/' + draft.id + '/prepare-publication',
        body = payload(review);
      expect((await app.inject({ method: 'POST', url, payload: body })).statusCode).toBe(401);
      expect(
        (await app.inject({ method: 'POST', url, headers: headers('viewer'), payload: body }))
          .statusCode
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { ...headers(), origin: 'https://foreign.example.invalid' },
            payload: body
          })
        ).statusCode
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: { ...headers(), 'x-csrf-token': 'bad' },
            payload: body
          })
        ).statusCode
      ).toBe(403);
      for (const extra of [
        { confirmed: false },
        { activationEnabled: true },
        { actor: 'forged' },
        { config: {} },
        { expectedRevision: '1' }
      ])
        expect(
          (
            await app.inject({
              method: 'POST',
              url,
              headers: headers(),
              payload: { ...body, ...extra }
            })
          ).statusCode
        ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: headers(),
            payload: { ...body, expectedConfigHash: '0'.repeat(64) }
          })
        ).statusCode
      ).toBe(409);
      expect(
        (
          await root.query(
            'SELECT count(*)::int n FROM admin.achievement_publication_candidates WHERE draft_id=$1',
            [draft.id]
          )
        ).rows[0]!.n
      ).toBe(0);
    } finally {
      await app.close();
    }
  });
  it('reports past simulation dates as ineligible and refuses preparation without rewriting the draft', async () => {
    const app = factory();
    try {
      const value = input();
      value.config.effectiveDate = '2020-01-01';
      const { draft, review } = await make(app, 'super', value);
      expect(review).toMatchObject({ eligible: false, blockedReason: 'effective_date_not_future' });
      const r = await app.inject({
        method: 'POST',
        url: api + '/drafts/' + draft.id + '/prepare-publication',
        headers: headers(),
        payload: payload(review)
      });
      expect(r.statusCode).toBe(423);
      expect(
        (await app.inject({ url: api + '/drafts/' + draft.id, headers: headers() })).json().config
          .effectiveDate
      ).toBe('2020-01-01');
    } finally {
      await app.close();
    }
  });
  it('rolls back the candidate/audit if the actual session is revoked inside audit before the final response check', async () => {
    const app = factory();
    try {
      const { draft, review } = await make(app);
      await root.query(
        "CREATE FUNCTION audit.revoke_preparation_session() RETURNS TRIGGER LANGUAGE plpgsql AS $$BEGIN IF NEW.action='achievement.publication_prepared' THEN UPDATE admin.sessions SET revoked_at=clock_timestamp() WHERE principal_id=NEW.actor_principal_id;END IF;RETURN NEW;END$$;CREATE TRIGGER revoke_preparation_session BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.revoke_preparation_session()"
      );
      try {
        const r = await app.inject({
          method: 'POST',
          url: api + '/drafts/' + draft.id + '/prepare-publication',
          headers: headers(),
          payload: payload(review)
        });
        expect(r.statusCode).toBe(403);
        expect(r.body).not.toContain('snapshotHash');
        expect(
          (
            await root.query(
              'SELECT count(*)::int n FROM admin.achievement_publication_candidates WHERE draft_id=$1',
              [draft.id]
            )
          ).rows[0]!.n
        ).toBe(0);
        expect(
          (
            await root.query(
              "SELECT count(*)::int n FROM audit.events WHERE action='achievement.publication_prepared' AND metadata->>'draftId'=$1",
              [draft.id]
            )
          ).rows[0]!.n
        ).toBe(0);
      } finally {
        await root.query(
          'DROP TRIGGER revoke_preparation_session ON audit.events;DROP FUNCTION audit.revoke_preparation_session()'
        );
      }
    } finally {
      await app.close();
    }
  });
  it('rechecks natural session expiry after the real publication lock wait', async () => {
    const app = factory();
    let lock;
    try {
      const { draft, review } = await make(app, 'expiring');
      lock = await root.connect();
      await lock.query('BEGIN;SELECT pg_advisory_xact_lock(1944,1)');
      await root.query(
        "UPDATE admin.sessions SET expires_at=clock_timestamp()+INTERVAL '250 milliseconds' WHERE principal_id=$1",
        [users.get('expiring')!.id]
      );
      const waiting = app.inject({
        method: 'POST',
        url: api + '/drafts/' + draft.id + '/prepare-publication',
        headers: headers('expiring'),
        payload: payload(review)
      });
      const completed = waiting.then((r) => r);
      await root.query('SELECT pg_sleep(0.4)');
      await lock.query('COMMIT');
      const result = await completed;
      expect(result.statusCode).toBe(403);
      expect(
        (
          await root.query(
            'SELECT count(*)::int n FROM admin.achievement_publication_candidates WHERE draft_id=$1',
            [draft.id]
          )
        ).rows[0]!.n
      ).toBe(0);
    } finally {
      if (lock) {
        await lock.query('ROLLBACK');
        lock.release();
      }
      await app.close();
    }
  });
});
