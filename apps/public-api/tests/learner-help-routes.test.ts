import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';

const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
suite('signed public help before learner eligibility', () => {
  let database: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: pg.Pool,
    role: string;
  const lineSecret = 'synthetic-line-secret-for-help-only',
    tgSecret = 'synthetic-telegram-help-secret',
    waSecret = 'synthetic-whatsapp-secret-for-help';
  const replies = vi.fn<(token: string, text: string) => Promise<void>>(async () => {});
  const tgSend = vi.fn<
    (
      chat: number,
      text: string,
      buttons?: ReadonlyArray<{ text: string; url: string; webApp?: boolean }>
    ) => Promise<void>
  >(async () => {});
  const waSend = vi.fn<(to: string, text: string) => Promise<void>>(async () => {});
  const makeApp = (realTgTransport = false) =>
    buildApp({
      pool: runtime,
      logger: false,
      line: {
        channelSecret: lineSecret,
        channelAccessToken: 'synthetic-line-access-token',
        loginChannelId: '12345',
        liffId: '12345-synthetic',
        reply: replies
      },
      telegramOnboarding: {
        botToken: '12345:' + 'x'.repeat(35),
        webhookSecret: tgSecret,
        regionCode: 'tw-general',
        ...(realTgTransport ? {} : { sendMessage: tgSend })
      },
      whatsapp: {
        phoneNumberId: '11111',
        businessAccountId: '22222',
        appSecret: waSecret,
        accessToken: 'synthetic-whatsapp-access-token',
        verifyToken: 'synthetic-whatsapp-verification',
        graphVersion: 'v99.0',
        sendText: waSend
      }
    });
  beforeAll(async () => {
    database = await createIsolatedTestDatabase(base!);
    await runMigrations(
      database.pool,
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations'),
      'help-tests'
    );
    await database.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    role = 'help_' + randomUUID().replaceAll('-', '');
    const password = randomUUID();
    await database.pool.query(
      `CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`
    );
    await database.pool.query(`GRANT qigong_api_runtime TO ${role}`);
    const url = new URL(database.databaseUrl);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
  });
  afterEach(() => {
    replies.mockClear();
    tgSend.mockClear();
    waSend.mockClear();
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    await runtime?.end();
    if (role) {
      await database.pool.query(`DROP OWNED BY ${role}`);
      await database.pool.query(`DROP ROLE ${role}`);
    }
    await database?.dispose();
  });
  const state = async () => {
    const tables = await database.pool.query<{ name: string }>(
      "SELECT schemaname||'.'||tablename name FROM pg_tables WHERE schemaname IN('identity','core','platform','admin','audit','ops') AND NOT(schemaname='platform' AND tablename='whatsapp_events') ORDER BY 1"
    );
    const hashes: unknown[] = [];
    for (const { name } of tables.rows) {
      if (!/^[a-z_]+\.[a-z_]+$/.test(name)) throw Error('Unexpected fixture table');
      hashes.push(
        (
          await database.pool.query(
            `SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text) value FROM ${name} r`
          )
        ).rows
      );
    }
    return hashes;
  };
  const tg = (id: number, text = '/help') => ({
    update_id: id,
    message: {
      chat: { id: 770001, type: 'private' },
      from: { id: 770001, first_name: 'Synthetic help reader' },
      text,
      date: Math.floor(Date.now() / 1000)
    }
  });
  const line = (id: string, text = '使用說明', timestamp = Date.now()) => ({
    events: [
      {
        type: 'message',
        webhookEventId: id,
        replyToken: 'synthetic-reply-' + id,
        source: { type: 'user', userId: 'U' + 'e'.repeat(32) },
        message: { type: 'text', text },
        timestamp
      }
    ]
  });
  const wa = (id: string, interactive = false, timestamp = Math.floor(Date.now() / 1000)) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '22222',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '11111' },
              messages: [
                {
                  id,
                  from: '659900001234',
                  timestamp: String(timestamp),
                  type: interactive ? 'interactive' : 'text',
                  ...(interactive
                    ? { interactive: { type: 'list_reply', list_reply: { id: 'workspace:help' } } }
                    : { text: { body: 'help' } })
                }
              ]
            }
          }
        ]
      }
    ]
  });
  const signed = (channel: 'line' | 'whatsapp', body: unknown) => {
    const raw = JSON.stringify(body);
    return {
      method: 'POST' as const,
      url: '/' + channel + '/webhook',
      headers: {
        'content-type': 'application/json',
        ...(channel === 'line'
          ? { 'x-line-signature': createHmac('sha256', lineSecret).update(raw).digest('base64') }
          : {
              'x-hub-signature-256':
                'sha256=' + createHmac('sha256', waSecret).update(raw).digest('hex')
            })
      },
      payload: raw
    };
  };
  it('gives an unapproved Telegram reader help with a public URL button and bounded duplicate suppression, without domain writes', async () => {
    const app = makeApp();
    try {
      const before = await state();
      const request = {
        method: 'POST' as const,
        url: '/telegram/onboarding/webhook',
        headers: { 'x-telegram-bot-api-secret-token': tgSecret },
        payload: tg(910001)
      };
      expect(
        (await app.inject({ ...request, headers: { 'x-telegram-bot-api-secret-token': 'wrong' } }))
          .statusCode
      ).toBe(401);
      const responses = await Promise.all([app.inject(request), app.inject(request)]);
      expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
      expect((await app.inject(request)).statusCode).toBe(200);
      expect(tgSend).toHaveBeenCalledTimes(1);
      expect(tgSend.mock.calls[0]?.[1]).toContain('https://checkin.baiyinqigong.org/telegram/help');
      expect(tgSend.mock.calls[0]?.[2]?.[0]).toMatchObject({ webApp: false });
      expect(tgSend.mock.calls[0]?.[1]).not.toMatch(/#|申請連結|765/);
      const conflict = {
        ...request,
        payload: {
          ...tg(910001),
          message: {
            ...tg(910001).message,
            chat: { id: 770002, type: 'private' },
            from: { id: 770002, first_name: 'Synthetic other reader' }
          }
        }
      };
      expect((await app.inject(conflict)).statusCode).toBe(503);
      expect(await state()).toEqual(before);
    } finally {
      await app.close();
    }
  });
  it('keeps group, sender-mismatch and stale Telegram help silent and retries a failed help reply', async () => {
    const app = makeApp();
    try {
      const before = await state();
      for (const message of [
        { ...tg(910002).message, chat: { id: 770001, type: 'group' } },
        { ...tg(910003).message, chat: { id: 770099, type: 'private' } },
        { ...tg(910004).message, date: Math.floor(Date.now() / 1000) - 86401 }
      ])
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/telegram/onboarding/webhook',
              headers: { 'x-telegram-bot-api-secret-token': tgSecret },
              payload: { update_id: 910004, message }
            })
          ).statusCode
        ).toBe(200);
      expect(tgSend).not.toHaveBeenCalled();
      tgSend.mockRejectedValueOnce(Error('Synthetic timeout'));
      const req = {
        method: 'POST' as const,
        url: '/telegram/onboarding/webhook',
        headers: { 'x-telegram-bot-api-secret-token': tgSecret },
        payload: tg(910005)
      };
      expect((await app.inject(req)).statusCode).toBe(503);
      expect((await app.inject(req)).statusCode).toBe(200);
      expect(tgSend).toHaveBeenCalledTimes(2);
      expect(await state()).toEqual(before);
    } finally {
      await app.close();
    }
  });
  it('sends a regular Telegram URL button, not a Mini App authorization button', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    const app = makeApp(true);
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/telegram/onboarding/webhook',
            headers: { 'x-telegram-bot-api-secret-token': tgSecret },
            payload: tg(910006)
          })
        ).statusCode
      ).toBe(200);
      expect(fetch).toHaveBeenCalledTimes(1);
      const body = fetch.mock.calls[0]?.[1]?.body;
      if (typeof body !== 'string') throw Error('Missing transport body');
      expect(JSON.parse(body)).toMatchObject({
        reply_markup: {
          inline_keyboard: [
            [{ text: '使用說明', url: 'https://checkin.baiyinqigong.org/telegram/help' }]
          ]
        }
      });
      expect(body).not.toContain('web_app');
    } finally {
      await app.close();
    }
  });
  it('serves signed LINE help before applications with no domain writes and rejects stale/group/conflicting repeats', async () => {
    const app = makeApp();
    try {
      const before = await state();
      const req = signed('line', line('help-line-1'));
      expect(
        (await app.inject({ ...req, headers: { ...req.headers, 'x-line-signature': 'wrong' } }))
          .statusCode
      ).toBe(401);
      expect((await app.inject(req)).statusCode).toBe(200);
      expect((await app.inject(req)).statusCode).toBe(200);
      expect(replies).toHaveBeenCalledTimes(1);
      expect(replies.mock.calls[0]?.[1]).toBe(
        '使用說明\nhttps://checkin.baiyinqigong.org/line/help'
      );
      expect((await app.inject(signed('line', line('help-line-1', 'help')))).statusCode).toBe(503);
      expect(
        (await app.inject(signed('line', line('help-line-stale', 'help', Date.now() - 86400001))))
          .statusCode
      ).toBe(200);
      const group = line('help-line-group');
      group.events[0]!.source.type = 'group';
      expect((await app.inject(signed('line', group))).statusCode).toBe(200);
      expect(replies).toHaveBeenCalledTimes(1);
      expect(await state()).toEqual(before);
    } finally {
      await app.close();
    }
  });
  it('preserves WhatsApp durable replay protection, account signatures and the service-window boundary for help', async () => {
    const req = signed('whatsapp', wa('help-wa-1'));
    const app = makeApp();
    try {
      const before = await state();
      expect(
        (
          await app.inject({
            ...req,
            headers: { ...req.headers, 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }
          })
        ).statusCode
      ).toBe(401);
      expect(
        (await Promise.all([app.inject(req), app.inject(req)])).map((r) => r.statusCode)
      ).toEqual([200, 200]);
      expect(waSend).toHaveBeenCalledTimes(1);
      expect(waSend.mock.calls[0]?.[1]).toBe(
        '使用說明\nhttps://checkin.baiyinqigong.org/whatsapp/help'
      );
      expect((await app.inject(signed('whatsapp', wa('help-wa-list', true)))).statusCode).toBe(200);
      expect(waSend).toHaveBeenCalledTimes(2);
      expect(
        (
          await app.inject(
            signed('whatsapp', wa('help-wa-stale', false, Math.floor(Date.now() / 1000) - 86400))
          )
        ).statusCode
      ).toBe(200);
      expect(waSend).toHaveBeenCalledTimes(2);
      expect(await state()).toEqual(before);
    } finally {
      await app.close();
    }
    const restarted = makeApp();
    try {
      expect((await restarted.inject(req)).statusCode).toBe(200);
      expect(waSend).toHaveBeenCalledTimes(2);
    } finally {
      await restarted.close();
    }
  });
});
