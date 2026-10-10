import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const headers = { origin: 'https://checkin.baiyinqigong.org', 'content-type': 'application/json' };
interface Profile {
  today: string;
  entries: { id: string; version: number; practiceNote: string; methods: { code: string }[] }[];
  confirmed: boolean;
  totalDays: number;
}
suite('Journal HTTP identity boundaries, sharing and taxonomy', () => {
  let root: Pool;
  let runtime: Pool;
  let dispose: () => Promise<void>;
  let role: string;
  let region: string;
  let principal: string;
  let app: FastifyInstance;
  let token: string;
  let person: string;
  let identity: string;
  let subject: string;
  let counter = 700000;
  const sendMessage = vi.fn(
    async (
      chatId: number,
      text: string,
      buttons?: ReadonlyArray<{ text: string; url: string }>
    ) => {
      expect(chatId).toBeGreaterThan(0);
      expect(text).toBeTruthy();
      if (buttons)
        expect(
          buttons.every((button) =>
            button.url.startsWith('https://checkin.baiyinqigong.org/telegram/')
          )
        ).toBe(true);
    }
  );
  const post = (path: string, payload: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: path,
      headers,
      payload: { token, locale: 'en', ...payload }
    });
  const profile = async () => {
    const response = await post('/telegram/workspace/profile');
    expect(response.statusCode).toBe(200);
    return response.json<Profile>();
  };
  const confirm = async () => {
    const response = await post('/telegram/preferences/timezone', { timezone: 'UTC' });
    expect(response.statusCode).toBe(200);
  };
  const save = async (extra: Record<string, unknown> = {}) =>
    post('/telegram/workspace/save', {
      requestId: randomUUID(),
      date: (await profile()).today,
      version: 0,
      methods: ['dayan_chu'],
      practiceNote: 'Sensitive original reflection 🧘',
      feelingTagIds: [],
      ...extra
    });
  beforeAll(async () => {
    const database = await createIsolatedTestDatabase(url!);
    root = database.pool;
    dispose = () => database.dispose();
    await runMigrations(root, directory, 'http-workspace');
    role = 'qigong_workspace_http_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime,qigong_worker_runtime TO ${role}`);
    const connection = new URL(database.databaseUrl);
    connection.username = role;
    connection.password = password;
    runtime = new pg.Pool({ connectionString: connection.href });
    principal = (
      await root.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://workspace-http.test','root','Root') RETURNING id"
      )
    ).rows[0]!.id;
    const global = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('global-workspace-http','global','全球','Global') RETURNING id"
      )
    ).rows[0]!.id;
    const country = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'country-workspace-http','country','國家','Country') RETURNING id",
        [global]
      )
    ).rows[0]!.id;
    region = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'tw-general','operational','地區','Region') RETURNING id",
        [country]
      )
    ).rows[0]!.id;
  });
  beforeEach(async () => {
    subject = String(++counter);
    person = (
      await root.query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Confidential learner','UTC') RETURNING id"
      )
    ).rows[0]!.id;
    identity = (
      await root.query<{ id: string }>(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'telegram',$2) RETURNING id",
        [person, subject]
      )
    ).rows[0]!.id;
    await root.query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
      [person, identity]
    );
    await root.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('telegram',$1,'Learner','Learner','private@example.test','+886912345600',$2,'approved',$3,CURRENT_TIMESTAMP,$4)",
      [subject, region, person, principal]
    );
    await root.query(
      "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-30)",
      [person, region]
    );
    token = randomBytes(32).toString('base64url');
    await withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (client) =>
      client.query('SELECT platform.begin_telegram_checkin($1,$2)', [subject, token])
    );
    app = buildApp({
      pool: runtime,
      logger: false,
      adminAuth: {
        callbackUrl: 'https://checkin.baiyinqigong.org/admin/auth/callback',
        begin: async (_v, state) => new URL('https://login.test/?state=' + state),
        complete: async () => ({ iss: 'https://workspace-http.test', sub: 'root' })
      },
      telegramOnboarding: {
        botToken: '123456:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        webhookSecret: 'workspace-webhook-secret',
        regionCode: 'tw-general',
        sendMessage
      }
    });
    sendMessage.mockClear();
    await root.query('DELETE FROM admin.role_grants WHERE principal_id=$1', [principal]);
    await root.query(
      "UPDATE ops.telegram_practice_receipts SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE status IN ('pending','sending')"
    );
  });
  afterEach(async () => {
    await app?.close();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await runtime?.end();
    if (role) {
      await root.query(`DROP OWNED BY ${role}`);
      await root.query(`DROP ROLE ${role}`);
    }
    await dispose?.();
  });

  const login = async (code = 'super_admin', scoped = false) => {
    await root.query(
      'INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,reason) SELECT $1,id,$2,$3,$4 FROM admin.roles WHERE code=$5',
      [
        principal,
        scoped ? 'region' : 'global',
        scoped ? region : null,
        'Isolated journal access',
        code
      ]
    );
    const begin = await app.inject('/admin/auth/login');
    const state = new URL(String(begin.headers.location)).searchParams.get('state')!;
    const callback = await app.inject({
      url: '/admin/auth/callback?state=' + state + '&code=verified-test',
      headers: { cookie: '__Host-qigong-admin-state=' + state }
    });
    expect(callback.statusCode).toBe(302);
    const set = callback.headers['set-cookie'];
    const cookie = (Array.isArray(set) ? set : [set]).map((v) => v?.split(';')[0]).join('; ');
    const csrf = cookie.match(/__Host-qigong-admin-csrf=([^;]+)/)?.[1] || '';
    return { cookie, 'x-csrf-token': csrf, ...headers };
  };
  const checkin = async () => {
    await confirm();
    const saved = await save();
    expect(saved.statusCode).toBe(200);
    return saved.json<{ checkinId: string }>().checkinId;
  };
  const publish = async (id: string, extra: Record<string, unknown> = {}) => {
    const sourceHash =
      (
        await root.query<{ hash: string | null }>(
          "SELECT encode(public.digest(platform.journal_source($1)::text,'sha256'),'hex') hash",
          [id]
        )
      ).rows[0]!.hash ?? '0'.repeat(64);
    return post('/telegram/journal/publish', {
      checkinId: id,
      sourceHash,
      version: 0,
      active: true,
      shareNote: true,
      shareFeelings: false,
      externalEnabled: false,
      alias: 'Shared ' + subject,
      ...extra
    });
  };
  const issue = async (auth: Record<string, string>) => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/api/journal/clients',
      headers: auth,
      payload: {
        label: 'Partner test',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        reason: 'Approved isolated partner'
      }
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ id: string; token: string }>();
  };
  it('rejects anonymous, pending and browser integration requests without private response fields', async () => {
    for (const path of [
      '/admin/api/journal',
      '/admin/api/practice-feeling-tags',
      '/admin/api/journal/capabilities'
    ])
      expect((await app.inject(path)).statusCode).toBe(401);
    for (const path of ['/admin/journal', '/admin/practice-feeling-tags'])
      expect((await app.inject(path)).statusCode).toBe(302);
    expect((await app.inject('/api/v1/shared-journal')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/v1/shared-journal',
          headers: { origin: headers.origin, authorization: 'Bearer ' + 'Z'.repeat(43) }
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          url: '/api/v1/shared-journal',
          headers: { authorization: 'Bearer ' + 'Z'.repeat(43) }
        })
      ).statusCode
    ).toBe(401);
  });
  it.each(['coach_admin', 'master_admin'])(
    'allows %s private reading but not taxonomy or partner credential management',
    async (code) => {
      const id = await checkin();
      const auth = await login(code);
      const page = await app.inject({ url: '/admin/journal?lang=en', headers: auth });
      expect(page.statusCode).toBe(200);
      expect(page.headers['cache-control']).toBe('no-store');
      expect(page.body).not.toContain('Sensitive original reflection 🧘');
      const result = await app.inject({
        url: '/admin/api/journal?personId=' + person + '&lang=en',
        headers: auth
      });
      expect(result.statusCode).toBe(200);
      expect(result.body).toContain('Sensitive original reflection 🧘');
      expect(result.json<{ entries: { checkinId: string }[] }>().entries[0]!.checkinId).toBe(id);
      expect(
        (await app.inject({ url: '/admin/api/practice-feeling-tags', headers: auth })).statusCode
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/admin/api/journal/clients',
            headers: auth,
            payload: {
              label: 'Not allowed',
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
              reason: 'Not allowed'
            }
          })
        ).statusCode
      ).toBe(403);
      expect(
        (await app.inject({ url: '/admin/api/journal/capabilities', headers: auth })).json()
      ).toMatchObject({ canReadJournal: true, canManageTags: false });
    }
  );
  it('requires regional private permission, returns indistinguishable 404s for inaccessible learners, and handles revoked sessions', async () => {
    await checkin();
    const auth = await login('regional_viewer', true);
    expect(
      (await app.inject({ url: '/admin/api/journal?personId=' + person, headers: auth })).statusCode
    ).toBe(200);
    const unknown = randomUUID();
    expect(
      (await app.inject({ url: '/admin/api/journal?personId=' + unknown, headers: auth }))
        .statusCode
    ).toBe(404);
    await root.query(
      'UPDATE core.person_region_assignments SET valid_to=CURRENT_DATE WHERE person_id=$1 AND valid_to IS NULL',
      [person]
    );
    expect(
      (await app.inject({ url: '/admin/api/journal?personId=' + person, headers: auth })).statusCode
    ).toBe(404);
    await root.query(
      'UPDATE admin.sessions SET revoked_at=CURRENT_TIMESTAMP WHERE principal_id=$1',
      [principal]
    );
    expect((await app.inject({ url: '/admin/api/journal', headers: auth })).statusCode).toBe(401);
  });
  it('keeps global viewers and regional administrators out of the private stream', async () => {
    for (const code of ['global_viewer', 'regional_admin']) {
      await root.query('DELETE FROM admin.role_grants WHERE principal_id=$1', [principal]);
      const auth = await login(code, code === 'regional_admin');
      expect((await app.inject({ url: '/admin/api/journal', headers: auth })).statusCode).toBe(403);
    }
  });
  it('saves catalogs with CSRF/version/Unicode checks and preserves labels on failed or stale writes', async () => {
    const auth = await login();
    const catalog = await app.inject({ url: '/admin/api/practice-feeling-tags', headers: auth });
    expect(catalog.statusCode).toBe(200);
    const version = catalog.json<{ version: number }>().version;
    const body = { version, tags: [{ name_zh_tw: '放鬆', name_en: 'Relaxed', active: true }] };
    const noCsrf = { ...auth, 'x-csrf-token': '' };
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/admin/api/practice-feeling-tags',
          headers: noCsrf,
          payload: body
        })
      ).statusCode
    ).toBe(403);
    const saved = await app.inject({
      method: 'PUT',
      url: '/admin/api/practice-feeling-tags',
      headers: auth,
      payload: body
    });
    expect(saved.statusCode).toBe(200);
    const next = saved.json<{ version: number; tags: Record<string, unknown>[] }>();
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/admin/api/practice-feeling-tags',
          headers: auth,
          payload: body
        })
      ).statusCode
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/admin/api/practice-feeling-tags',
          headers: auth,
          payload: { version: next.version, tags: [{ ...next.tags[0], name_zh_tw: 'a\0' }] }
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/admin/api/practice-feeling-tags',
          headers: auth,
          payload: { version: next.version, tags: [] }
        })
      ).statusCode
    ).toBe(400);
    expect(
      (await app.inject({ url: '/admin/api/practice-feeling-tags', headers: auth })).json()
    ).toEqual(next);
    expect(
      (await app.inject({ url: '/admin/practice-feeling-tags?lang=zh_TW', headers: auth }))
        .statusCode
    ).toBe(200);
  });
  it('starts unshared and publishes only selected content, with separate partner consent and stable versions', async () => {
    const id = await checkin();
    const before = await post('/telegram/journal/own');
    expect(before.statusCode).toBe(200);
    expect(before.json<{ entries: { active: boolean }[] }>().entries[0]!.active).toBe(false);
    const first = await publish(id);
    expect(first.statusCode).toBe(200);
    expect((await publish(id)).statusCode).toBe(409);
    const feed = await post('/telegram/journal/feed');
    expect(feed.statusCode).toBe(200);
    expect(feed.body).toContain('Shared ' + subject);
    for (const value of [person, identity, id, subject + 'SECRET', 'private@example.test'])
      expect(feed.body).not.toContain(value);
    const auth = await login();
    const client = await issue(auth);
    const external = () =>
      app.inject({
        url: '/api/v1/shared-journal?lang=en',
        headers: { authorization: 'Bearer ' + client.token }
      });
    expect((await external()).body).not.toContain('Shared ' + subject);
    expect((await publish(id, { version: 1, externalEnabled: true })).statusCode).toBe(200);
    expect((await external()).body).toContain('Shared ' + subject);
    expect((await publish(id, { version: 2, active: false })).statusCode).toBe(200);
    expect((await external()).body).not.toContain('Shared ' + subject);
  });
  it('denies foreign origins and strict-payload forgeries, and leaves originals private on invalid publish', async () => {
    const id = await checkin();
    expect(
      (await app.inject({ method: 'POST', url: '/telegram/journal/own', payload: { token } }))
        .statusCode
    ).toBe(403);
    expect((await post('/telegram/journal/own', { personId: randomUUID() })).statusCode).toBe(400);
    expect((await post('/telegram/journal/feed', { token: 'Z'.repeat(43) })).statusCode).toBe(403);
    expect((await publish(id, { shareNote: false, shareFeelings: false })).statusCode).toBe(400);
    expect((await publish(randomUUID())).statusCode).toBe(404);
    expect((await publish(id, { alias: 'a\u0000' })).statusCode).toBe(400);
    const own = await post('/telegram/journal/own');
    expect(own.body).toContain('Sensitive original reflection 🧘');
    expect(own.json<{ entries: { active: boolean }[] }>().entries[0]!.active).toBe(false);
  });
  it('revokes service credentials and rate limits valid callers without exposing hashes or sensitive errors', async () => {
    const auth = await login();
    const client = await issue(auth);
    const get = () =>
      app.inject({
        url: '/api/v1/shared-journal',
        headers: { authorization: 'Bearer ' + client.token }
      });
    expect((await get()).statusCode).toBe(200);
    await root.query('UPDATE platform.journal_api_clients SET rate_used=60 WHERE id=$1', [
      client.id
    ]);
    const limited = await get();
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    const revoked = await app.inject({
      method: 'POST',
      url: '/admin/api/journal/clients/' + client.id + '/revoke',
      headers: auth,
      payload: { reason: 'End test integration' }
    });
    expect(revoked.statusCode).toBe(200);
    expect((await get()).statusCode).toBe(401);
    for (const response of [limited, revoked, await get()])
      expect(response.body).not.toContain(client.token);
  });
  it('serves learner sharing without admin or private data in HTML and advertises the fifth Bot entry', async () => {
    for (const lang of ['en', 'zh_TW']) {
      const page = await app.inject('/telegram/journal?lang=' + lang);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('telegram-web-app.js');
      expect(page.body).not.toContain(token);
      expect(page.headers['content-security-policy']).toContain(
        'frame-ancestors https://web.telegram.org'
      );
    }
    const result = await app.inject({
      method: 'POST',
      url: '/telegram/onboarding/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'workspace-webhook-secret' },
      payload: {
        update_id: ++counter,
        message: {
          chat: { id: Number(subject), type: 'private' },
          from: { id: Number(subject), first_name: 'Learner' },
          text: '/journal'
        }
      }
    });
    expect(result.statusCode).toBe(200);
    expect(
      sendMessage.mock.calls[0]![2]?.some(
        (button) => button.url.includes('/telegram/journal') && !button.url.includes('#')
      )
    ).toBe(true);
    expect(sendMessage.mock.calls[0]![2]).toHaveLength(5);
  });
});
