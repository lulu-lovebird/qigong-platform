import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
import {
  deliverChannelPracticeReceipts,
  createLinePracticeSender
} from '../src/channel-practice-receipts.js';
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
suite('LINE workspace HTTP and private summaries', () => {
  let root: Pool;
  let runtime: Pool;
  let dispose: () => Promise<void>;
  let role: string;
  let region: string;
  let principal: string;
  let app: FastifyInstance;
  let person: string;
  let identity: string;
  let subject: string;
  let counter = 700000;
  const post = (path: string, payload: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: path,
      headers,
      payload: { idToken: 'verified-line-token', locale: 'zh_TW', ...payload }
    });
  const profile = async () => {
    const response = await post('/line/workspace/profile');
    expect(response.statusCode).toBe(200);
    return response.json<Profile>();
  };
  const confirm = async () => {
    const response = await post('/line/preferences/timezone', { timezone: 'UTC' });
    expect(response.statusCode).toBe(200);
  };
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
    subject = 'U' + (++counter).toString(16).padStart(32, '0');
    person = (
      await root.query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Confidential learner','UTC') RETURNING id"
      )
    ).rows[0]!.id;
    identity = (
      await root.query<{ id: string }>(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'line',$2) RETURNING id",
        [person, subject]
      )
    ).rows[0]!.id;
    await root.query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
      [person, identity]
    );
    await root.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('line',$1,'Learner','Learner','private@example.test','+886912345600',$2,'approved',$3,CURRENT_TIMESTAMP,$4)",
      [subject, region, person, principal]
    );
    await root.query(
      "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-30)",
      [person, region]
    );

    app = buildApp({
      pool: runtime,
      logger: false,
      adminAuth: {
        callbackUrl: 'https://checkin.baiyinqigong.org/admin/auth/callback',
        begin: async (_v, state) => new URL('https://login.test/?state=' + state),
        complete: async () => ({ iss: 'https://workspace-http.test', sub: 'root' })
      },
      line: {
        channelSecret: 'line-workspace-secret-32-characters',
        channelAccessToken: 'fake-line-channel-token',
        loginChannelId: '123456',
        liffId: '123456-test',
        reply: async () => {},
        verifyIdToken: async (value) => {
          if (value !== 'verified-line-token') throw Error('Invalid LINE token');
          return subject;
        }
      }
    });
    await root.query('DELETE FROM admin.role_grants WHERE principal_id=$1', [principal]);
    await root.query(
      "UPDATE ops.channel_practice_receipts SET status='cancelled',lease_id=NULL,leased_until=NULL WHERE status IN ('pending','sending')"
    );
  });
  afterEach(async () => {
    await app?.close();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await runtime?.end();
    if (role && runtime) {
      await root.query(`DROP OWNED BY ${role}`);
      await root.query(`DROP ROLE ${role}`);
    }
    await dispose?.();
  });

  it('serves all six LIFF views in Traditional Chinese without Telegram SDK or credentials in URLs', async () => {
    for (const path of [
      '/line/',
      '/line/checkin',
      '/line/leaderboard',
      '/line/method-analysis',
      '/line/achievements',
      '/line/journal'
    ]) {
      const page = await app.inject(path);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('static.line-scdn.net');
      expect(page.body).not.toContain('telegram.org');
      expect(page.body).toContain('<html lang="zh-Hant">');
    }
  });
  it('authenticates every JSON request, supports reports and rejects browser IDs and recipient injection', async () => {
    expect((await post('/line/workspace/profile', { idToken: 'fake' })).statusCode).toBe(401);
    expect((await post('/line/workspace/profile', { userId: subject })).statusCode).toBe(400);
    expect((await post('/line/workspace/save', { recipient: subject })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/line/workspace/profile',
          payload: { idToken: 'verified-line-token' }
        })
      ).statusCode
    ).toBe(403);
    for (const view of ['leaderboard', 'methods', 'achievements', 'history'])
      expect(
        (
          await post('/line/workspace/report', {
            view,
            ...(view === 'history' ? { month: (await profile()).today.slice(0, 7) } : {})
          })
        ).statusCode
      ).toBe(200);
  });
  it('saves with idempotent UUID/version protection, displays own sharing, and queues a private summary', async () => {
    await confirm();
    const requestId = randomUUID(),
      payload = {
        requestId,
        date: (await profile()).today,
        version: 0,
        methods: ['dayan_chu'],
        practiceNote: 'Must not enter LINE chat',
        feelingTagIds: []
      };
    const saved = await post('/line/workspace/save', payload);
    expect(saved.statusCode).toBe(200);
    expect((await post('/line/workspace/save', payload)).json()).toEqual(saved.json());
    expect(
      (await post('/line/workspace/save', { ...payload, requestId: randomUUID() })).statusCode
    ).toBe(409);
    expect((await post('/line/journal/own', { page: 1 })).statusCode).toBe(200);
    const sender = vi.fn(async (recipient: string, text: string, id: string) => {
      expect(recipient).toBe(subject);
      expect(text).toContain('打卡成功');
      expect(text).not.toContain('Must not enter');
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });
    expect(await deliverChannelPracticeReceipts(runtime, 'line', sender, () => {}, 3)).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
  });
  it('uses fixed recipient and stable retry key and sanitizes transport errors', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const id = randomUUID();
    await createLinePracticeSender('private-provider-token')(subject, 'Safe summary', id);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Line-Retry-Key': id });
    const body = fetch.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw Error('Expected JSON body');
    expect(JSON.parse(body)).toMatchObject({ to: subject });
    fetch.mockResolvedValueOnce(
      new Response('{}', { status: 409, headers: { 'x-line-accepted-request-id': randomUUID() } })
    );
    await createLinePracticeSender('private-provider-token')(subject, 'Safe summary', id);
    fetch.mockRejectedValueOnce(Error('private-provider-token'));
    await expect(
      createLinePracticeSender('private-provider-token')(subject, 'Safe', id)
    ).rejects.toThrow('LINE practice delivery failed');
  });
});
