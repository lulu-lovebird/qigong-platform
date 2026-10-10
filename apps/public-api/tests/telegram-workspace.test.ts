import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
import {
  buildTelegramPracticeSummary,
  createTelegramPracticeSender,
  deliverTelegramPracticeReceipts
} from '../src/telegram-practice-receipts.js';
import { telegramPracticeSaveSchema } from '../src/telegram-workspace.js';

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
const summary = {
  date: '2026-10-09',
  action: 'regular',
  locale: 'zh_TW',
  methods: ['大雁初'],
  currentStreak: 7,
  totalDays: 20
};

describe('Telegram private chat summary allow-list and API transport', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['regular', 'makeup', 'corrected'] as const)(
    'builds both languages for %s without private fields',
    (action) => {
      const zh = buildTelegramPracticeSummary({
        ...summary,
        action,
        practiceNote: 'DO NOT SEND',
        feelingTags: ['PRIVATE TAG'],
        token: 'PRIVATE TOKEN'
      });
      expect(zh).toContain('2026-10-09');
      expect(zh).toContain('大雁初');
      expect(zh).toContain('7 天');
      expect(zh).not.toMatch(/DO NOT SEND|PRIVATE/);
      const en = buildTelegramPracticeSummary({ ...summary, action, locale: 'en' });
      expect(en).toContain('Current streak: 7 days');
      expect(en).toContain('Total practice: 20 days');
    }
  );
  it('bounds worst-case Unicode method labels below Telegram message size', () => {
    const result = buildTelegramPracticeSummary({
      ...summary,
      methods: Array.from({ length: 30 }, () => '🙂'.repeat(200))
    });
    expect(result.length).toBeLessThan(4096);
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });
  it('requires a valid date, outcome and method list', () => {
    expect(() => buildTelegramPracticeSummary({ ...summary, date: 'invalid' })).toThrow();
    expect(() => buildTelegramPracticeSummary({ ...summary, methods: [] })).toThrow();
    expect(() => buildTelegramPracticeSummary({ ...summary, action: 'approved' })).toThrow();
  });
  it('checks Telegram acceptance, uses plain text, and suppresses provider URLs from errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetchMock);
    const send = createTelegramPracticeSender('test-token-not-a-production-secret');
    await send('12345', 'plain summary');
    const requestBody = fetchMock.mock.calls[0]![1]?.body;
    if (typeof requestBody !== 'string') throw new Error('Expected JSON request');
    const body = JSON.parse(requestBody) as Record<string, unknown>;
    expect(body).toEqual({
      chat_id: '12345',
      text: 'plain summary',
      link_preview_options: { is_disabled: true }
    });
    expect(body).not.toHaveProperty('parse_mode');
    for (const response of [
      new Response('{"ok":false}'),
      new Response('bad-json'),
      new Response('{}', { status: 429 })
    ]) {
      fetchMock.mockResolvedValueOnce(response);
      await expect(send('12345', 'summary')).rejects.toThrow('Telegram practice delivery failed');
    }
    fetchMock.mockRejectedValueOnce(
      new Error('https://api.telegram.org/botSECRET-TOKEN/sendMessage')
    );
    await expect(send('12345', 'summary')).rejects.toThrow(/^Telegram practice delivery failed$/);
  });
  it('rejects untrusted recipients, duplicate methods, NUL and overlong notes in save payloads', () => {
    const base = {
      token: 'a'.repeat(43),
      requestId: randomUUID(),
      date: '2026-10-09',
      version: 0,
      methods: ['dayan_chu']
    };
    for (const extra of [
      { personId: randomUUID() },
      { chatId: 12345 },
      { methods: ['dayan_chu', 'dayan_chu'] },
      { practiceNote: 'x\0' },
      { practiceNote: '🙂'.repeat(1001) }
    ])
      expect(telegramPracticeSaveSchema.safeParse({ ...base, ...extra }).success).toBe(false);
    expect(
      telegramPracticeSaveSchema.safeParse({ ...base, practiceNote: '🙂'.repeat(1000) }).success
    ).toBe(true);
  });
});

suite('Telegram workspace HTTP, bot menu and durable delivery integration', () => {
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
      practiceNote: 'Private reflection',
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
      telegramOnboarding: {
        botToken: '123456:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        webhookSecret: 'workspace-webhook-secret',
        regionCode: 'tw-general',
        sendMessage
      }
    });
    sendMessage.mockClear();
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
  it('serves all four private-link pages in both languages with privacy headers', async () => {
    for (const path of ['checkin', 'leaderboard', 'method-analysis', 'achievements'])
      for (const lang of ['en', 'zh_TW']) {
        const response = await app.inject(`/telegram/${path}?lang=${lang}`);
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['referrer-policy']).toBe('no-referrer');
        expect(response.headers['content-security-policy']).toContain("connect-src 'self'");
        expect(response.body).toContain('Bean, Bird &amp; Badminton Tech Consulting');
        expect(response.body).not.toContain(token);
      }
  });
  it('rejects foreign origins, forged scopes and unknown credentials without querying another identity', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/telegram/workspace/profile',
          headers: { ...headers, origin: 'https://foreign.example' },
          payload: { token }
        })
      ).statusCode
    ).toBe(403);
    expect(
      (await post('/telegram/workspace/report', { view: 'leaderboard', personId: randomUUID() }))
        .statusCode
    ).toBe(400);
    expect(
      (await post('/telegram/workspace/profile', { token: randomBytes(32).toString('base64url') }))
        .statusCode
    ).toBe(403);
    expect((await post('/telegram/workspace/report', { view: 'history' })).statusCode).toBe(400);
    expect(
      (await post('/telegram/workspace/report', { view: 'history', month: '2099-12' })).statusCode
    ).toBe(400);
    expect(
      (await post('/telegram/workspace/report', { view: 'methods', days: 365 })).statusCode
    ).toBe(400);
  });
  it('requires confirmation, saves once across duplicate retries and queues no private content', async () => {
    expect((await save()).statusCode).toBe(409);
    await confirm();
    const requestId = randomUUID();
    const first = await save({ requestId });
    expect(first.statusCode).toBe(200);
    expect((await save({ requestId })).json()).toEqual(first.json());
    expect((await save()).statusCode).toBe(409);
    const data = await profile();
    expect(data.entries[0]!.practiceNote).toBe('Private reflection');
    expect(data.totalDays).toBe(1);
    const receipts = (
      await root.query<{ payload: unknown }>(
        'SELECT payload FROM ops.telegram_practice_receipts WHERE person_id=$1',
        [person]
      )
    ).rows;
    expect(receipts).toHaveLength(1);
    expect(JSON.stringify(receipts)).not.toMatch(
      /Private reflection|feeling|private@example|phone|token/i
    );
  });
  it('performs versioned corrections, keeps a stale request from overwriting, and reconciles combo badges', async () => {
    await confirm();
    const first = await save({ methods: ['dayan_chu', 'dayan_gao'] });
    expect(first.statusCode).toBe(200);
    const { version } = first.json<{ version: number }>();
    const earned = await post('/telegram/workspace/report', { view: 'achievements' });
    expect(earned.statusCode).toBe(200);
    expect(
      earned
        .json<{ badges: { code: string; awards: { revoked: boolean }[] }[] }>()
        .badges.find((b) => b.code === 'combo_dayan_7')?.awards[0]?.revoked
    ).toBe(false);
    const second = await save({
      version,
      methods: ['dayan_chu'],
      practiceNote: 'Corrected private note'
    });
    expect(second.statusCode).toBe(200);
    expect((await save({ version, methods: ['dayan_gao'] })).statusCode).toBe(409);
    const corrected = await profile();
    expect(corrected.entries[0]!.practiceNote).toBe('Corrected private note');
    expect(corrected.entries[0]!.methods.map((m) => m.code)).toEqual(['dayan_chu']);
    const achievements = await post('/telegram/workspace/report', { view: 'achievements' });
    expect(
      achievements
        .json<{ badges: { code: string; awards: { revoked: boolean }[] }[] }>()
        .badges.find((b) => b.code === 'combo_dayan_7')?.awards[0]?.revoked
    ).toBe(true);
  });
  it('exposes reports only through the bound token and returns own history with literal private text', async () => {
    await confirm();
    await save({ practiceNote: '<script>private literal</script>' });
    const data = await profile();
    for (const payload of [
      { view: 'leaderboard', period: 'week' },
      { view: 'methods', days: 90 },
      { view: 'achievements' },
      { view: 'history', month: data.today.slice(0, 7) }
    ]) {
      const response = await post('/telegram/workspace/report', payload);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      if (payload.view === 'history') expect(response.body).toContain('private literal');
      else if (payload.view === 'leaderboard')
        expect(response.body).not.toContain('private literal');
    }
  });
  it('revokes token access immediately when the active Telegram channel closes', async () => {
    await root.query(
      'UPDATE identity.person_interaction_channels SET valid_to=CURRENT_TIMESTAMP WHERE platform_identity_id=$1 AND valid_to IS NULL',
      [identity]
    );
    expect((await post('/telegram/workspace/profile')).statusCode).toBe(403);
    expect((await post('/telegram/preferences/timezone', { timezone: 'UTC' })).statusCode).toBe(
      403
    );
  });
  it('opens each workspace command with five static WebApp buttons and server-verified launch authentication', async () => {
    let updateId = 1000;
    for (const command of [
      'checkin',
      'leaderboard',
      'methodanalysis',
      'methods',
      'achievements',
      'history'
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/telegram/onboarding/webhook',
        headers: { 'x-telegram-bot-api-secret-token': 'workspace-webhook-secret' },
        payload: {
          update_id: ++updateId,
          message: {
            chat: { id: Number(subject), type: 'private' },
            from: { id: Number(subject), first_name: 'Learner' },
            text: '/' + command
          }
        }
      });
      expect(response.statusCode).toBe(200);
      const call = sendMessage.mock.calls.at(-1)!;
      expect(call[0]).toBe(Number(subject));
      expect(call[2]).toHaveLength(5);
      expect(call[2]?.every((button) => !button.url.includes('#'))).toBe(true);
    }
    const count = sendMessage.mock.calls.length;
    await app.inject({
      method: 'POST',
      url: '/telegram/onboarding/webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'workspace-webhook-secret' },
      payload: {
        update_id: ++updateId,
        message: {
          chat: { id: Number(subject), type: 'group' },
          from: { id: Number(subject), first_name: 'Learner' },
          text: '/achievements'
        }
      }
    });
    expect(sendMessage.mock.calls).toHaveLength(count);
  });
  it('delivers committed summaries once through a mocked sender, never sending notes or feelings', async () => {
    await confirm();
    await save();
    const sender = vi.fn(async (recipient: string, text: string) => {
      expect(recipient).toBe(subject);
      expect(text).toContain('大雁初');
      expect(text).not.toMatch(/Private reflection|feeling|private@example/);
    });
    const errors = vi.fn();
    expect(await deliverTelegramPracticeReceipts(runtime, sender, errors, 3)).toBe(1);
    expect(await deliverTelegramPracticeReceipts(runtime, sender, errors, 3)).toBe(0);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
  });
  it('persists sanitized failure and backs off without rolling back a successful check-in', async () => {
    await confirm();
    await save();
    const errors = vi.fn();
    const sender = vi.fn(async () => {
      throw new Error('SECRET TOKEN private reflection');
    });
    await deliverTelegramPracticeReceipts(runtime, sender, errors, 3);
    expect((await profile()).totalDays).toBe(1);
    const receipt = (
      await root.query<{ status: string; last_error: string; attempts: number }>(
        'SELECT status,last_error,attempts FROM ops.telegram_practice_receipts WHERE person_id=$1',
        [person]
      )
    ).rows[0]!;
    expect(receipt.status).toBe('pending');
    expect(receipt.attempts).toBe(1);
    expect(receipt.last_error).toBe('Telegram delivery failed');
    expect(errors.mock.calls[0]?.[0]).toEqual(new Error('Telegram practice delivery failed'));
    expect(await deliverTelegramPracticeReceipts(runtime, sender, errors, 3)).toBe(0);
    expect(sender).toHaveBeenCalledTimes(1);
  });
  it('keeps old submission clients compatible and queues their successful check-ins', async () => {
    const response = await post('/telegram/checkin/submit', {
      methods: ['dayan_chu'],
      makeup: false,
      practiceNote: 'Legacy client private note'
    });
    expect(response.statusCode).toBe(200);
    const rows = (
      await root.query<{ payload: unknown }>(
        'SELECT payload FROM ops.telegram_practice_receipts WHERE person_id=$1',
        [person]
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('Legacy client private note');
  });
  it('checks schema readiness as the restricted worker without giving it migration-table access', async () => {
    const ready = await withRequestContext(
      runtime,
      'qigong_worker_runtime',
      { requestId: randomUUID() },
      (client) =>
        client.query<{ ready: boolean }>('SELECT ops.telegram_miniapp_schema_ready() ready')
    );
    expect(ready.rows[0]!.ready).toBe(true);
    await expect(
      withRequestContext(runtime, 'qigong_worker_runtime', { requestId: randomUUID() }, (client) =>
        client.query('SELECT * FROM public.schema_migrations')
      )
    ).rejects.toThrow('permission denied');
  });
});
