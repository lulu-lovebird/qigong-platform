import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
import { managementDraftSchema } from '../src/admin-achievement-management.js';
import {
  publicationReviewSchema,
  publicationCandidateSchema
} from '../src/admin-achievement-publication.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
suite('Operator-gated session-bound version activation and cancellation HTTP', () => {
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
  const make = async (app: ReturnType<typeof factory>, actor = 'super') => {
    const original = input(),
      value = {
        ...original,
        subject: 'event',
        code: null,
        config: {
          nameZhTw: 'Synthetic scheduled event',
          nameZhCn: 'Explicit 简中',
          nameEn: 'Synthetic event',
          description: 'No external sends',
          effectiveDate: '2199-01-01',
          startDate: '2199-01-01',
          endDate: '2199-01-31',
          timezone: 'UTC',
          requiredDays: 3,
          continuous: false
        }
      };
    const created = await app.inject({
      method: 'POST',
      url: api + '/drafts',
      headers: headers(actor),
      payload: value
    });
    expect(created.statusCode).toBe(200);
    const d = managementDraftSchema.parse(created.json()),
      review = await app.inject({
        url: api + '/drafts/' + d.id + '/publication-review',
        headers: headers(actor)
      });
    expect(review.statusCode).toBe(200);
    const r = publicationReviewSchema.parse(review.json());
    const response = await app.inject({
      method: 'POST',
      url: api + '/drafts/' + d.id + '/prepare-publication',
      headers: headers(actor),
      payload: {
        expectedRevision: r.revision,
        expectedConfigHash: r.configHash,
        expectedBaseHash: r.baseHash,
        expectedSourceHash: r.sourceHash,
        reason: 'Synthetic preparation',
        confirmed: true
      }
    });
    expect(response.statusCode).toBe(200);
    return publicationCandidateSchema.parse(response.json());
  };
  const action = (hash: string) => ({
    expectedSnapshotHash: hash,
    reason: 'Synthetic publication action',
    confirmed: true
  });
  it('keeps the operational switch OFF by default and denies activation without granting users a switch API', async () => {
    const app = factory();
    try {
      expect(
        (await root.query('SELECT enabled FROM ops.versioned_achievement_control')).rows[0]!.enabled
      ).toBe(false);
      const c = await make(app);
      const caps = await app.inject({ url: api + '/capabilities', headers: headers() });
      expect(caps.json().canPublish).toBe(false);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: api + '/publication-candidates/' + c.id + '/activate',
            headers: headers(),
            payload: action(c.snapshotHash)
          })
        ).statusCode
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: api + '/runtime-enable',
            headers: headers(),
            payload: { enabled: true }
          })
        ).statusCode
      ).toBe(404);
      await root.query('UPDATE ops.versioned_achievement_control SET enabled=TRUE');
    } finally {
      await app.close();
    }
  });
  it.each(['super', 'master'])(
    'lets %s schedule and cancel a future sealed snapshot without changing its bytes or issuing early awards',
    async (actor) => {
      const app = factory(),
        before = await business();
      try {
        const c = await make(app, actor),
          path = api + '/publication-candidates/' + c.id;
        const review = await app.inject({
          url: path + '/activation-review',
          headers: headers(actor)
        });
        expect(review.statusCode).toBe(200);
        expect(review.json()).toMatchObject({
          eligible: true,
          registered: false,
          runtimeEnabled: true
        });
        const result = await app.inject({
          method: 'POST',
          url: path + '/activate',
          headers: headers(actor),
          payload: action(c.snapshotHash)
        });
        expect(result.statusCode).toBe(200);
        expect(result.json()).toMatchObject({ registered: true, cancelled: false });
        const again = await app.inject({
          method: 'POST',
          url: path + '/activate',
          headers: headers(actor),
          payload: action(c.snapshotHash)
        });
        expect(again.statusCode).toBe(200);
        expect(
          (
            await root.query(
              "SELECT count(*)::int n FROM audit.events WHERE action='achievement.version_scheduled' AND target_id=$1",
              [c.id]
            )
          ).rows[0]!.n
        ).toBe(1);
        const updated = publicationCandidateSchema.parse(
          (await app.inject({ url: path, headers: headers(actor) })).json()
        );
        expect(updated.snapshotHash).toBe(c.snapshotHash);
        expect(updated.snapshot).toEqual(c.snapshot);
        expect(updated.stale).toBe(false);
        expect(updated.activation).toEqual({
          registered: true,
          cancelled: false,
          state: 'scheduled'
        });
        expect(
          (
            await root.query(
              'SELECT count(*)::int n FROM core.person_practice_badges WHERE badge_code=$1',
              [c.code]
            )
          ).rows[0]!.n
        ).toBe(0);
        const list = await app.inject({ url: '/admin/api/achievements', headers: headers(actor) });
        expect(list.statusCode).toBe(200);
        expect(list.json().badges.find((b: { code: string }) => b.code === c.code)).toMatchObject({
          kind: 'event',
          provenance: 'published_snapshot',
          activationState: 'scheduled'
        });
        const cancel = await app.inject({
          method: 'POST',
          url: path + '/cancel',
          headers: headers(actor),
          payload: action(c.snapshotHash)
        });
        expect(cancel.statusCode).toBe(200);
        expect(cancel.json().cancelled).toBe(true);
        const updatedDraft = await app.inject({
          method: 'PATCH',
          url: api + '/drafts/' + c.draftId,
          headers: headers(actor),
          payload: {
            subject: 'event',
            code: c.code,
            year: null,
            expectedRevision: 1,
            reason: 'Synthetic replacement after cancellation',
            config: { ...c.snapshot.config, nameZhTw: 'Replacement with the same future date' }
          }
        });
        expect(updatedDraft.statusCode).toBe(200);
        const nextReview = publicationReviewSchema.parse(
          (
            await app.inject({
              url: api + '/drafts/' + c.draftId + '/publication-review',
              headers: headers(actor)
            })
          ).json()
        );
        const nextPrepared = await app.inject({
          method: 'POST',
          url: api + '/drafts/' + c.draftId + '/prepare-publication',
          headers: headers(actor),
          payload: {
            expectedRevision: nextReview.revision,
            expectedConfigHash: nextReview.configHash,
            expectedBaseHash: nextReview.baseHash,
            expectedSourceHash: nextReview.sourceHash,
            reason: 'Synthetic new immutable candidate',
            confirmed: true
          }
        });
        expect(nextPrepared.statusCode).toBe(200);
        const next = publicationCandidateSchema.parse(nextPrepared.json());
        expect(next.candidateVersion).toBeGreaterThan(c.candidateVersion);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: api + '/publication-candidates/' + next.id + '/activate',
              headers: headers(actor),
              payload: action(next.snapshotHash)
            })
          ).statusCode
        ).toBe(200);
        expect(
          (
            await app.inject({
              method: 'POST',
              url: path + '/activate',
              headers: headers(actor),
              payload: action(c.snapshotHash)
            })
          ).statusCode
        ).toBe(423);
        expect(await business()).toBe(before);
      } finally {
        await app.close();
      }
    }
  );
  it('uses the latest immutable published rule as the next draft source without modifying legacy definitions or translating manual names', async () => {
    const app = factory();
    try {
      const value = input();
      value.config.nameZhCn = 'Manual 簡體';
      const saved = await app.inject({
        method: 'POST',
        url: api + '/drafts',
        headers: headers(),
        payload: value
      });
      expect(saved.statusCode).toBe(200);
      const d = managementDraftSchema.parse(saved.json()),
        review = publicationReviewSchema.parse(
          (
            await app.inject({
              url: api + '/drafts/' + d.id + '/publication-review',
              headers: headers()
            })
          ).json()
        );
      const prepared = await app.inject({
        method: 'POST',
        url: api + '/drafts/' + d.id + '/prepare-publication',
        headers: headers(),
        payload: {
          expectedRevision: review.revision,
          expectedConfigHash: review.configHash,
          expectedBaseHash: review.baseHash,
          expectedSourceHash: review.sourceHash,
          reason: 'Synthetic rule publication',
          confirmed: true
        }
      });
      expect(prepared.statusCode).toBe(200);
      const c = publicationCandidateSchema.parse(prepared.json());
      expect(
        (
          await app.inject({
            method: 'POST',
            url: api + '/publication-candidates/' + c.id + '/activate',
            headers: headers(),
            payload: action(c.snapshotHash)
          })
        ).statusCode
      ).toBe(200);
      const catalog = await app.inject({ url: api + '/catalog?lang=zh_CN', headers: headers() });
      expect(catalog.statusCode).toBe(200);
      const current = catalog
        .json()
        .definitions.find((r: { code: string }) => r.code === 'streak_3');
      expect(current).toMatchObject({
        rule_version: c.candidateVersion,
        threshold: 5,
        displayName: 'Manual 簡體',
        provenance: 'published_snapshot'
      });
      expect(
        (
          await root.query(
            "SELECT rule_version,threshold FROM core.practice_badge_definitions WHERE code='streak_3'"
          )
        ).rows[0]
      ).toEqual({ rule_version: 1, threshold: 3 });
      const registered = publicationCandidateSchema.parse(
        (
          await app.inject({ url: api + '/publication-candidates/' + c.id, headers: headers() })
        ).json()
      );
      expect(registered.stale).toBe(false);
      expect(
        (await app.inject({ url: api + '/drafts/' + d.id, headers: headers() })).json()
          .sourceChanged
      ).toBe(true);
    } finally {
      await app.close();
    }
  });
  it('serializes both authorized publishers without creating duplicate runtime versions or audits', async () => {
    const app = factory();
    try {
      const c = await make(app),
        url = api + '/publication-candidates/' + c.id + '/activate';
      const responses = await Promise.all(
        ['super', 'master'].map((actor) =>
          app.inject({
            method: 'POST',
            url,
            headers: headers(actor),
            payload: action(c.snapshotHash)
          })
        )
      );
      expect(responses).toHaveLength(2);
      for (const response of responses) expect(response.statusCode).toBe(200);
      expect(
        (
          await root.query(
            'SELECT count(*)::int n FROM core.achievement_runtime_versions WHERE candidate_id=$1',
            [c.id]
          )
        ).rows[0]!.n
      ).toBe(1);
      expect(
        (
          await root.query(
            "SELECT count(*)::int n FROM audit.events WHERE action='achievement.version_scheduled' AND target_id=$1",
            [c.id]
          )
        ).rows[0]!.n
      ).toBe(1);
    } finally {
      await app.close();
    }
  });
  it('rejects Origin/CSRF/permission/confirmation/hash forgery and a stale draft', async () => {
    const app = factory();
    try {
      const c = await make(app),
        url = api + '/publication-candidates/' + c.id + '/activate',
        body = action(c.snapshotHash);
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
        { config: {} },
        { actor: 'forged' },
        { enabled: true }
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
            payload: action('0'.repeat(64))
          })
        ).statusCode
      ).toBe(409);
      await root.query(
        'UPDATE admin.achievement_config_drafts SET revision=revision+1 WHERE id=$1',
        [c.draftId]
      );
      expect(
        (await app.inject({ method: 'POST', url, headers: headers(), payload: body })).statusCode
      ).toBe(423);
      expect(
        (
          await root.query(
            'SELECT count(*)::int n FROM core.achievement_runtime_versions WHERE candidate_id=$1',
            [c.id]
          )
        ).rows[0]!.n
      ).toBe(0);
    } finally {
      await app.close();
    }
  });
  it('rolls back identities/runtime/jobs/audit when the real session is revoked inside scheduling audit', async () => {
    const app = factory();
    try {
      const c = await make(app);
      await root.query(
        "CREATE FUNCTION audit.revoke_activation_session() RETURNS TRIGGER LANGUAGE plpgsql AS $$BEGIN IF NEW.action='achievement.version_scheduled' THEN UPDATE admin.sessions SET revoked_at=clock_timestamp() WHERE principal_id=NEW.actor_principal_id;END IF;RETURN NEW;END$$;CREATE TRIGGER revoke_activation_session BEFORE INSERT ON audit.events FOR EACH ROW EXECUTE FUNCTION audit.revoke_activation_session()"
      );
      try {
        const result = await app.inject({
          method: 'POST',
          url: api + '/publication-candidates/' + c.id + '/activate',
          headers: headers(),
          payload: action(c.snapshotHash)
        });
        expect(result.statusCode).toBe(403);
        expect(
          (
            await root.query(
              'SELECT count(*)::int n FROM core.achievement_runtime_versions WHERE candidate_id=$1',
              [c.id]
            )
          ).rows[0]!.n
        ).toBe(0);
        expect(
          (
            await root.query(
              'SELECT count(*)::int n FROM core.achievement_badge_identities WHERE code=$1',
              [c.code]
            )
          ).rows[0]!.n
        ).toBe(0);
        expect(
          (
            await root.query(
              "SELECT count(*)::int n FROM audit.events WHERE action='achievement.version_scheduled' AND target_id=$1",
              [c.id]
            )
          ).rows[0]!.n
        ).toBe(0);
      } finally {
        await root.query(
          'DROP TRIGGER revoke_activation_session ON audit.events;DROP FUNCTION audit.revoke_activation_session()'
        );
      }
    } finally {
      await app.close();
    }
  });
});
