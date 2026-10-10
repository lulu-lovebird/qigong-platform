import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
import { learnerPrivacyHash } from '../src/learner-privacy-policy.js';
import { signMiniapp } from './telegram-miniapp-fixtures.js';
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const headers = { origin: 'https://checkin.baiyinqigong.org', 'content-type': 'application/json' };
suite('Telegram static launch and verified exchange', () => {
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

  const launch = (values: Record<string, unknown> = {}, origin = true) =>
    app.inject({
      method: 'POST',
      url: '/telegram/workspace/session',
      headers: origin ? headers : { 'content-type': 'application/json' },
      payload: {
        initData: signMiniapp('123456:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', Number(subject)),
        locale: 'en',
        ...values
      }
    });
  it('does not trust user IDs, wrong signature, stale proof or cross-origin requests', async () => {
    expect((await launch({}, false)).statusCode).toBe(403);
    expect((await launch({ userId: subject })).statusCode).toBe(400);
    expect(
      (await launch({ initData: signMiniapp('other-token', Number(subject)) })).statusCode
    ).toBe(401);
    expect(
      (
        await launch({
          initData: signMiniapp(
            '123456:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            Number(subject),
            Math.floor(Date.now() / 1000) - 3601
          )
        })
      ).statusCode
    ).toBe(401);
  });
  it('issues independent expiring capabilities and keeps existing private links valid', async () => {
    const first = await launch(),
      second = await launch();
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const a = first.json<{ token: string }>().token,
      b = second.json<{ token: string }>().token;
    expect(a).not.toBe(b);
    for (const value of [token, a, b])
      expect((await post('/telegram/workspace/profile', { token: value })).statusCode).toBe(200);
  });
  it('keeps policy and eligibility gates, without approving registration through signed proof', async () => {
    await root.query("UPDATE platform.learner_privacy_policies SET state='active'");
    const needed = await launch();
    expect(needed.json()).toMatchObject({ status: 'consent_required' });
    expect(needed.json<{ privacyUrl: string }>().privacyUrl).toContain(
      '/privacy?platform=telegram'
    );
    await root.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
      [person]
    );
    await root.query("UPDATE identity.people SET status='suspended' WHERE id=$1", [person]);
    expect((await launch()).statusCode).toBe(403);
  });
  it('uses static buttons for approved /start and /checkin, without expiring URL credentials', async () => {
    for (const command of ['/start', '/checkin']) {
      const response = await app.inject({
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
      expect(response.statusCode).toBe(200);
      const buttons = sendMessage.mock.calls.at(-1)?.[2];
      expect(buttons).toHaveLength(5);
      expect(buttons?.every((b) => !b.url.includes('#'))).toBe(true);
      expect(sendMessage.mock.calls.at(-1)?.[1]).not.toContain('15');
    }
  });
});
