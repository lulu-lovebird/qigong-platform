import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
import {
  reviewNotificationsEnabled,
  buildReviewNotification,
  createReviewNotificationSender,
  deliverReviewNotifications,
  type ReviewNotification
} from '../src/review-notifications.js';
import { renderReviewNotificationPage } from '../src/admin-review-notification-page.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations'),
  origin = 'https://checkin.baiyinqigong.org';
describe('Private reviewer message safety and settings markup', () => {
  it('keeps operator flag off by default and makes no direct approval or unauthenticated links', () => {
    expect(reviewNotificationsEnabled(undefined)).toBe(false);
    expect(reviewNotificationsEnabled('true')).toBe(true);
    expect(() => reviewNotificationsEnabled('1')).toThrow();
    for (const kind of ['admin', 'learner', 'test'] as const) {
      const msg = buildReviewNotification({
        allowed: true,
        recipient: '54832',
        kind,
        count: 2,
        locale: 'zh_TW',
        region: '台灣'
      });
      expect(msg.url).toMatch(/^https:\/\/checkin\.baiyinqigong\.org\/admin\//);
      expect(msg.url).not.toContain('token');
      expect(msg.text).not.toContain('54832');
    }
  });
  it('renders bilingual two-sided confirmation and the actual admin CSRF cookie, without persistent secrets', () => {
    for (const locale of ['zh_TW', 'en'] as const) {
      const html = renderReviewNotificationPage(locale, true);
      for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
        expect(() => new vm.Script(script[1]!)).not.toThrow();
      expect(html).toContain('__Host-qigong-admin-csrf=');
      expect(html).toContain('/admin_notify ');
      expect(html).not.toContain('localStorage');
      expect(html).not.toContain('sessionStorage');
    }
  });
  it('does not send extra private fields and sanitizes Telegram failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    try {
      await createReviewNotificationSender('synthetic-not-real')({
        allowed: true,
        recipient: '54832',
        kind: 'learner',
        count: 2,
        locale: 'en',
        region: 'Taiwan'
      });
      const body = fetch.mock.calls[0]![1]?.body;
      if (typeof body !== 'string') throw Error('JSON expected');
      expect(JSON.parse(body) as unknown).toMatchObject({
        chat_id: '54832',
        reply_markup: { inline_keyboard: [[{ url: origin + '/admin/applications' }]] }
      });
      fetch.mockResolvedValueOnce(Response.json({ ok: false }));
      await expect(
        createReviewNotificationSender('synthetic-not-real')({
          allowed: true,
          recipient: '54832',
          kind: 'test',
          count: 1,
          locale: 'en',
          region: null
        })
      ).rejects.toThrow(/^Private reviewer notification delivery failed$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
suite('Authenticated reviewer Telegram setup and delivery', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    role: string,
    actor: string,
    region: string,
    app: FastifyInstance,
    cookie: string,
    csrf: string;
  let cleaners: Array<() => Promise<void>> = [];
  const subject = '548000000032',
    secret = 'synthetic-review-secret-not-real',
    replies: string[] = [];
  const post = (path: string, body: Record<string, unknown>, valid = true) =>
    app.inject({
      method: 'POST',
      url: '/admin/api/notifications/' + path,
      headers: { origin, cookie, ...(valid ? { 'x-csrf-token': csrf } : {}) },
      payload: body
    });
  const state = async () =>
    (await app.inject({ url: '/admin/api/notifications/state', headers: { cookie } })).json<{
      revision: number;
      bound: boolean;
      adminEnabled: boolean;
      learnerEnabled: boolean;
      recipientHint: string;
      pendingCount: number;
    }>();
  const webhook = (text: string, privateChat = true) =>
    app.inject({
      method: 'POST',
      url: '/telegram/onboarding/webhook',
      headers: { 'x-telegram-bot-api-secret-token': secret },
      payload: {
        update_id: 900000001,
        message: {
          chat: { id: privateChat ? Number(subject) : -1, type: privateChat ? 'private' : 'group' },
          from: { id: Number(subject), first_name: 'Synthetic' },
          text
        }
      }
    });
  const bind = async () => {
    const link = await post('link', {});
    expect(link.statusCode, link.body).toBe(200);
    const data = link.json<{ id: string; token: string }>();
    expect((await webhook('/admin_notify ' + data.token)).statusCode).toBe(200);
    const code = /[0-9]{6}/.exec(replies.at(-1)!)?.[0];
    expect(code).toBeTruthy();
    const confirmed = await post('confirm', {
      id: data.id,
      code,
      version: (await state()).revision
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    return data;
  };
  beforeEach(async () => {
    replies.length = 0;
    cleaners = [];
    db = await createIsolatedTestDatabase(base!);
    const database = db;
    cleaners.push(() => database.dispose());
    await runMigrations(db.pool, directory, 'review-http');
    role = 'qigong_review_http_' + randomUUID().replaceAll('-', '');
    const roleName = role,
      password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime,qigong_worker_runtime TO ${role}`);
    cleaners.push(async () => {
      await database.pool.query(`DROP OWNED BY ${roleName}`);
      await database.pool.query(`DROP ROLE ${roleName}`);
    });
    const url = new URL(db.databaseUrl);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    const pool = runtime;
    cleaners.push(() => pool.end());
    actor = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://review-http.example.invalid','super','Synthetic super') RETURNING id"
      )
    ).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic' FROM admin.roles WHERE code='super_admin'",
      [actor]
    );
    region = (
      await db.pool.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('review-http-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'review-http-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tw-general','operational','台灣','Taiwan' FROM c RETURNING id"
      )
    ).rows[0]!.id;
    app = buildApp({
      pool: runtime,
      logger: false,
      adminAuth: {
        callbackUrl: origin + '/admin/auth/callback',
        begin: async (verifier, s) => {
          expect(verifier).toBeTruthy();
          return new URL('https://review-http.example.invalid/authorize?state=' + s);
        },
        complete: async () => ({ iss: 'https://review-http.example.invalid', sub: 'super' })
      },
      telegramOnboarding: {
        botToken: '123456:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        webhookSecret: secret,
        regionCode: 'tw-general',
        sendMessage: async (chat, text) => {
          expect(chat).toBe(Number(subject));
          replies.push(text);
        }
      }
    });
    const api = app;
    cleaners.push(() => api.close());
    const login = await app.inject('/admin/auth/login'),
      s = new URL(login.headers.location!).searchParams.get('state')!;
    const callback = await app.inject({
      url: '/admin/auth/callback?state=' + s + '&code=synthetic',
      headers: { cookie: '__Host-qigong-admin-state=' + s }
    });
    const headers = callback.headers['set-cookie'];
    if (!Array.isArray(headers)) throw Error('Missing admin cookies');
    cookie = headers.map((h) => h.split(';')[0]!).join('; ');
    csrf = /__Host-qigong-admin-csrf=([^;]+)/.exec(cookie)![1]!;
  });
  afterEach(async () => {
    for (const cleanup of cleaners.reverse()) await cleanup();
  });
  it('requires admin session, CSRF and private signed webhook, not a learner approval or name/email match', async () => {
    expect((await app.inject('/admin/api/notifications/state')).statusCode).toBe(401);
    expect((await post('link', {}, false)).statusCode).toBe(403);
    const link = (await post('link', {})).json<{ token: string; id: string }>();
    await webhook('/admin_notify ' + link.token, false);
    expect(replies).toHaveLength(0);
    expect((await state()).bound).toBe(false);
    await webhook('/admin_notify ' + link.token);
    const code = /[0-9]{6}/.exec(replies.at(-1)!)![0];
    expect((await state()).bound).toBe(false);
    expect(
      (await post('confirm', { id: link.id, code, version: (await state()).revision })).statusCode
    ).toBe(200);
    expect((await state()).recipientHint).toBe('••••0032');
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(0);
  });
  it('binds without auto-opting in, stores only hashed challenges, masks the recipient and refuses body impersonation', async () => {
    const link = await bind();
    const data = await state();
    expect(data.bound).toBe(true);
    expect(data.adminEnabled).toBe(false);
    expect(data.learnerEnabled).toBe(false);
    expect(JSON.stringify(data)).not.toContain(link.token);
    expect(JSON.stringify(data)).not.toContain(subject);
    expect(
      (
        await post('preferences', {
          version: data.revision,
          adminEnabled: true,
          learnerEnabled: true,
          locale: 'zh_TW',
          principalId: randomUUID()
        })
      ).statusCode
    ).toBe(400);
  });
  it('sends one merged private alert for complete new learners, with no applicant PII', async () => {
    await bind();
    const data = await state();
    await post('preferences', {
      version: data.revision,
      adminEnabled: true,
      learnerEnabled: true,
      locale: 'zh_TW'
    });
    for (let i = 0; i < 2; i++)
      await db.pool.query(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164) VALUES('line',$1,'Private legal',$2,'Private legal','private@example.invalid','+659900000032')",
        ['U' + randomBytes(16).toString('hex'), region]
      );
    await withRequestContext(runtime, 'qigong_worker_runtime', { requestId: randomUUID() }, (c) =>
      c.query('SELECT ops.queue_review_notifications(200)')
    );
    await db.pool.query(
      "UPDATE ops.review_notification_deliveries SET available_at=clock_timestamp()-INTERVAL '1 second'"
    );
    const sender = vi.fn(async (data: ReviewNotification) => {
      expect(data.allowed).toBe(true);
    });
    expect(await deliverReviewNotifications(runtime, sender, () => {})).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
    const sent = sender.mock.calls[0]?.[0];
    expect(sent).toMatchObject({ kind: 'learner', count: 2, recipient: subject });
    expect(JSON.stringify(sent)).not.toContain('private@example.invalid');
    expect(await deliverReviewNotifications(runtime, sender, () => {})).toBe(0);
  });
  it('disconnects pending alerts and rate-limits tests without changing roles or sessions', async () => {
    const grants = (await db.pool.query('SELECT * FROM admin.role_grants')).rows;
    await bind();
    expect((await post('test', {})).statusCode).toBe(200);
    expect((await post('test', {})).statusCode).toBe(429);
    const data = await state();
    expect(
      (
        await post('preferences', {
          version: data.revision,
          adminEnabled: false,
          learnerEnabled: false,
          locale: 'zh_TW',
          disconnect: true
        })
      ).statusCode
    ).toBe(200);
    expect((await state()).bound).toBe(false);
    expect((await db.pool.query('SELECT * FROM admin.role_grants')).rows).toEqual(grants);
    expect((await app.inject({ url: '/admin/auth/me', headers: { cookie } })).statusCode).toBe(200);
  });
});
