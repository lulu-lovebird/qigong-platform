import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
import { learnerPrivacyVersion, learnerPrivacyHash } from '../src/learner-privacy-policy.js';
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
suite('Privacy notice and verified chatbot entry', () => {
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
          buttons.every((button) => button.url.startsWith('https://checkin.baiyinqigong.org/'))
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
    await root.query(
      "UPDATE platform.learner_privacy_policies SET state='draft',document_hash=$1",
      [learnerPrivacyHash]
    );
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

  const activate = () => root.query("UPDATE platform.learner_privacy_policies SET state='active'");
  const privacyPost = (values: Record<string, unknown>, origin = true) =>
    app.inject({
      method: 'POST',
      url: '/learner/privacy/accept',
      headers: origin ? headers : { 'content-type': 'application/json' },
      payload: {
        platform: 'telegram',
        locale: 'en',
        version: learnerPrivacyVersion,
        hash: learnerPrivacyHash,
        accepted: true,
        reflectionConsent: true,
        ...values
      }
    });
  const webhook = (command = '/start') =>
    app.inject({
      method: 'POST',
      url: '/telegram/onboarding/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'workspace-webhook-secret' },
      payload: {
        update_id: counter++,
        message: {
          chat: { id: Number(subject), type: 'private' },
          from: { id: Number(subject), first_name: 'Learner' },
          text: command
        }
      }
    });
  const gate = async () => {
    const secret = randomBytes(32).toString('base64url');
    await withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
      c.query('SELECT platform.begin_privacy_gate($1,$2,$3)', ['telegram', subject, secret])
    );
    return secret;
  };
  it('serves complete bilingual draft documents without enabling acceptance', async () => {
    for (const lang of ['en', 'zh_TW']) {
      const response = await app.inject('/privacy?lang=' + lang);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toContain('eqibaiyin@gmail.com');
      expect(response.body).not.toContain('Bean, Bird');
      expect(response.body).toContain('privacy-fields" disabled');
    }
    expect((await app.inject('/learner/privacy/notice')).json()).toMatchObject({
      active: false,
      hash: learnerPrivacyHash
    });
  });
  it('requires a private policy capability, correct Origin, version, hash and explicit acceptance', async () => {
    await activate();
    const secret = await gate();
    expect((await privacyPost({ token: secret }, false)).statusCode).toBe(403);
    expect((await privacyPost({ token: secret, accepted: false })).statusCode).toBe(400);
    expect((await privacyPost({ token: secret, hash: '0'.repeat(64) })).statusCode).toBe(409);
    expect((await privacyPost({ token: secret, platform: 'line' })).statusCode).toBe(403);
    expect((await privacyPost({ token: secret, subject })).statusCode).toBe(400);
    expect((await privacyPost({ token: secret })).statusCode).toBe(200);
    expect((await privacyPost({ token: secret })).statusCode).toBe(200);
  });
  it('redirects new and existing learner chatbot commands to notice, never silently accepting', async () => {
    await activate();
    expect((await webhook('/checkin')).statusCode).toBe(200);
    expect(sendMessage.mock.calls[0]?.[1]).toContain('/privacy?platform=telegram');
    expect(
      (
        await root.query<{ count: string }>(
          "SELECT count(*) FROM platform.learner_privacy_acceptances WHERE platform='telegram' AND subject_hash=public.digest('telegram:'||$1,'sha256')",
          [subject]
        )
      ).rows[0]!.count
    ).toBe('0');
    const secret = await gate();
    expect((await privacyPost({ token: secret })).statusCode).toBe(200);
    sendMessage.mockClear();
    expect((await webhook('/checkin')).statusCode).toBe(200);
    expect(sendMessage.mock.calls[0]?.[2]).toHaveLength(5);
    sendMessage.mockClear();
    expect((await webhook('/privacy')).statusCode).toBe(200);
    expect(sendMessage.mock.calls[0]?.[1]).toContain('/privacy?platform=telegram');
  });
  it('blocks direct learner APIs until consent, then defaults new records to shared content without external opt-in', async () => {
    await activate();
    expect((await post('/telegram/workspace/profile')).statusCode).toBe(403);
    expect((await post('/telegram/journal/feed')).statusCode).toBe(403);
    const secret = await gate();
    expect((await privacyPost({ token: secret })).statusCode).toBe(200);
    const id = await checkin();
    const own = await post('/telegram/journal/own');
    expect(own.statusCode).toBe(200);
    expect(
      own
        .json<{
          entries: Array<{ checkinId: string; active: boolean; externalEnabled: boolean }>;
        }>()
        .entries.find((e) => e.checkinId === id)
    ).toMatchObject({ active: true, externalEnabled: false });
  });
  it('limits publication to super admins with CSRF and the exact document hash', async () => {
    const coach = await login('coach_admin');
    expect((await app.inject({ url: '/admin/privacy-policy', headers: coach })).statusCode).toBe(
      403
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/api/privacy-policy/publish',
          headers: coach,
          payload: { version: learnerPrivacyVersion, hash: learnerPrivacyHash, reason: 'Reviewed' }
        })
      ).statusCode
    ).toBe(403);
    await root.query('DELETE FROM admin.role_grants WHERE principal_id=$1', [principal]);
    const auth = await login();
    expect(
      (await app.inject({ url: '/admin/privacy-policy?lang=en', headers: auth })).statusCode
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/api/privacy-policy/publish',
          headers: { cookie: auth.cookie },
          payload: { version: learnerPrivacyVersion, hash: learnerPrivacyHash, reason: 'Reviewed' }
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/api/privacy-policy/publish',
          headers: auth,
          payload: {
            version: learnerPrivacyVersion,
            hash: learnerPrivacyHash,
            reason: 'Operator reviewed supplement'
          }
        })
      ).statusCode
    ).toBe(200);
    expect((await app.inject('/learner/privacy/notice')).json()).toMatchObject({ active: true });
  });
  it('uses scoped versioned suspension, retains staff shared history and invalidates old learner capabilities', async () => {
    await activate();
    const secret = await gate();
    await privacyPost({ token: secret });
    const id = await checkin();
    const auth = await login('regional_admin', true);
    expect(
      (await app.inject({ url: '/admin/learners?lang=zh_TW', headers: auth })).statusCode
    ).toBe(200);
    const endpoint = '/admin/api/learners/' + person + '/suspend';
    expect(
      (
        await app.inject({
          method: 'POST',
          url: endpoint,
          headers: { cookie: auth.cookie },
          payload: { version: 1, reason: 'Paused' }
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: endpoint,
          headers: auth,
          payload: { version: 9, reason: 'Paused' }
        })
      ).statusCode
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: endpoint,
          headers: auth,
          payload: { version: 1, reason: 'Course paused' }
        })
      ).statusCode
    ).toBe(200);
    expect((await post('/telegram/workspace/profile')).statusCode).toBe(403);
    expect((await post('/telegram/journal/feed')).statusCode).toBe(403);
    expect((await root.query('SELECT id FROM core.checkins WHERE id=$1', [id])).rowCount).toBe(1);
    const staff = await app.inject({ url: '/admin/api/shared-journal?lang=en', headers: auth });
    expect(staff.statusCode).toBe(200);
    expect(staff.body).toContain('Sensitive original reflection');
  });
  it('blocks expired sessions and policy/document mismatch', async () => {
    await activate();
    const secret = await gate();
    await root.query(
      "UPDATE platform.learner_privacy_sessions SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE token_hash=public.digest($1,'sha256')",
      [secret]
    );
    expect((await privacyPost({ token: secret })).statusCode).toBe(403);
    await root.query('UPDATE platform.learner_privacy_policies SET document_hash=$1', [
      '0'.repeat(64)
    ]);
    expect((await app.inject('/privacy')).statusCode).toBe(503);
  });
});
