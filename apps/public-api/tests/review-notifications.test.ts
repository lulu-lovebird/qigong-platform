import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp, checkStartupReadiness } from '../src/app.js';
import {
  reviewNotificationsEnabled,
  buildReviewNotification,
  createReviewNotificationSender,
  deliverReviewNotifications,
  type ReviewNotification
} from '../src/review-notifications.js';
import { runNotificationWorker } from '../src/notification-worker.js';
import { renderReviewNotificationPage } from '../src/admin-review-notification-page.js';
import { deliverTelegramLearnerReviews } from '../src/telegram-learner-review-notifications.js';
import type { TelegramReviewTransport } from '../src/telegram-learner-review.js';
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
    for (const locale of ['zh_TW', 'zh_CN', 'en'] as const) {
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
  let setDirectMode: (enabled: boolean) => Promise<void>;
  const subject = '548000000032',
    secret = 'synthetic-review-secret-not-real',
    replies: string[] = [];
  const reviewTransport: TelegramReviewTransport = {
    send: vi.fn(async () => 590),
    edit: vi.fn(async () => {}),
    answer: vi.fn(async () => {})
  };
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
      learnerReviewEnabled: boolean;
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
  const bind = async (locale: 'zh_TW' | 'zh_CN' | 'en' = 'zh_TW') => {
    const link = await post('link?lang=' + locale, {});
    expect(link.statusCode, link.body).toBe(200);
    const data = link.json<{ id: string; token: string }>();
    expect((await webhook('/admin_notify ' + data.token)).statusCode).toBe(200);
    if (locale === 'zh_CN') expect(replies.at(-1)).toContain('确认码');
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
    vi.clearAllMocks();
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
    const createApp = (enabled: boolean) =>
      buildApp({
        pool: runtime,
        telegramLearnerReviewEnabled: enabled,
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
          reviewTransport,
          sendMessage: async (chat, text) => {
            expect(chat).toBe(Number(subject));
            replies.push(text);
          }
        }
      });
    app = createApp(true);
    setDirectMode = async (enabled) => {
      await app.close();
      app = createApp(enabled);
    };
    cleaners.push(() => app.close());
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
  it('admits exact schema59 with reviewer feature off and preserves explicitly enabled venue capability checks', async () => {
    const apiRole = 'tgapply_readiness_' + randomUUID().replaceAll('-', '');
    await db.pool.query(
      `CREATE ROLE ${apiRole} LOGIN NOINHERIT NOBYPASSRLS;GRANT qigong_api_runtime TO ${apiRole}`
    );
    cleaners.push(async () => {
      await db.pool.query(`DROP OWNED BY ${apiRole}`);
      await db.pool.query(`DROP ROLE ${apiRole}`);
    });
    const url = new URL(db.databaseUrl);
    url.username = apiRole;
    const apiOnly = new pg.Pool({ connectionString: url.href });
    cleaners.push(() => apiOnly.end());
    const off = await checkStartupReadiness(apiOnly);
    expect(off.ready).toBe(true);
    if (!off.ready) throw Error('Schema59 readiness unavailable');
    expect(off.migration.currentVersion).toBe('0059_telegram_learner_review.sql');
    expect(
      (
        await checkStartupReadiness(
          apiOnly,
          true,
          {
            history: { enabled: true, publicOrigin: origin },
            management: { enabled: true, publicOrigin: origin },
            people: { enabled: true, publicOrigin: origin }
          },
          true
        )
      ).ready
    ).toBe(true);
    expect((await state()).learnerReviewEnabled).toBe(false);
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
  it.each(['zh_TW', 'zh_CN', 'en'] as const)(
    'sends one merged %s private alert for complete new learners, with no applicant PII',
    async (locale) => {
      await bind(locale);
      const data = await state();
      await post('preferences', {
        version: data.revision,
        adminEnabled: true,
        learnerEnabled: true,
        locale
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
      expect(sent).toMatchObject({ kind: 'learner', count: 2, recipient: subject, locale });
      expect(JSON.stringify(sent)).not.toContain('private@example.invalid');
      expect(await deliverReviewNotifications(runtime, sender, () => {})).toBe(0);
    }
  );
  it('requires separate current disclosure consent and performs one real bound callback decision despite an edit failure', async () => {
    await bind('en');
    expect((await state()).learnerReviewEnabled).toBe(false);
    const preferences = {
      version: (await state()).revision,
      adminEnabled: true,
      learnerEnabled: true,
      locale: 'en',
      learnerReviewEnabled: true
    };
    expect((await post('preferences', preferences)).statusCode).toBe(400);
    expect(
      (
        await post('preferences', {
          ...preferences,
          learnerReviewDisclosure: 'telegram-learner-review-v1'
        })
      ).statusCode
    ).toBe(200);
    expect((await state()).learnerReviewEnabled).toBe(true);
    await db.pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164,telegram_review_notice_version) VALUES('line',$1,'Synthetic nickname',$2,'Synthetic self-report','synthetic@example.invalid','+659900000059','telegram-learner-review-v1')",
      ['U' + randomBytes(16).toString('hex'), region]
    );
    expect(await deliverTelegramLearnerReviews(runtime, reviewTransport, () => {})).toBe(1);
    const sent = vi.mocked(reviewTransport.send).mock.calls[0]!;
    const approve = sent[2]![0]![0]!.callback_data;
    const press = (data: string) =>
      app.inject({
        method: 'POST',
        url: '/telegram/onboarding/webhook',
        headers: { 'x-telegram-bot-api-secret-token': secret },
        payload: {
          update_id: 590,
          callback_query: {
            id: 'synthetic-callback',
            from: { id: Number(subject), is_bot: false },
            message: {
              message_id: 590,
              date: Math.floor(Date.now() / 1000),
              from: { id: 123456, is_bot: true },
              chat: { id: Number(subject), type: 'private' }
            },
            data
          }
        }
      });
    expect((await press(approve)).statusCode).toBe(200);
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(0);
    const confirm = vi.mocked(reviewTransport.edit).mock.calls[0]![3][0]![0]!.callback_data;
    vi.mocked(reviewTransport.edit).mockRejectedValueOnce(Error('Synthetic edit timeout'));
    expect((await press(confirm)).statusCode).toBe(200);
    expect((await press(confirm)).statusCode).toBe(200);
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(1);
    expect(
      (await db.pool.query("SELECT * FROM audit.events WHERE action='onboarding.approved'"))
        .rowCount
    ).toBe(1);
    expect((await db.pool.query('SELECT * FROM ops.onboarding_notifications')).rowCount).toBe(1);
    // Old clients/feature-off save path safely turn direct review off on schema59.
    expect(
      (
        await post('preferences', {
          version: (await state()).revision,
          adminEnabled: true,
          learnerEnabled: true,
          locale: 'en'
        })
      ).statusCode
    ).toBe(200);
    expect((await state()).learnerReviewEnabled).toBe(false);
    expect(await deliverTelegramLearnerReviews(runtime, reviewTransport, () => {})).toBe(0);
    const page = await app.inject({ url: '/admin/notifications?lang=en', headers: { cookie } });
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.body).toContain('not end-to-end encrypted');
  });
  it('denies regional direct opt-in with 403 while counts and WebAdmin stay authorized', async () => {
    await bind('en');
    await db.pool.query('DELETE FROM admin.role_grants WHERE principal_id=$1', [actor]);
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,valid_from,reason) SELECT $1,id,'region',$2,clock_timestamp()-INTERVAL '1 day','Regional negative' FROM admin.roles WHERE code='regional_admin'",
      [actor, region]
    );
    const preferences = {
      version: (await state()).revision,
      adminEnabled: false,
      learnerEnabled: true,
      locale: 'en'
    };
    expect(
      (
        await post('preferences', {
          ...preferences,
          learnerReviewEnabled: true,
          learnerReviewDisclosure: 'telegram-learner-review-v1'
        })
      ).statusCode
    ).toBe(403);
    expect((await post('preferences', preferences)).statusCode).toBe(200);
    expect(
      (
        await withRequestContext(
          runtime,
          'qigong_api_runtime',
          { principalId: actor, requestId: randomUUID() },
          (c) =>
            c.query<{ allowed: boolean }>('SELECT admin.can_review_application($1) allowed', [
              region
            ])
        )
      ).rows[0]!.allowed
    ).toBe(true);
    expect(await deliverTelegramLearnerReviews(runtime, reviewTransport, () => {})).toBe(0);
  });
  it('actual schema59 worker/API off preserves unsent legacy counts with existing direct consent and receipts, blocks callbacks and consumes closed owned replies without capture', async () => {
    await bind('en');
    const preferences = {
      version: (await state()).revision,
      adminEnabled: false,
      learnerEnabled: true,
      locale: 'en',
      learnerReviewEnabled: true,
      learnerReviewDisclosure: 'telegram-learner-review-v1'
    };
    expect((await post('preferences', preferences)).statusCode).toBe(200);
    const add = async () =>
      db.pool.query(
        "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id,learner_name,website_email,phone_e164,telegram_review_notice_version) VALUES('line',$1,'Private synthetic',$2,'Private synthetic','paused-private@example.invalid','+659900000059','telegram-learner-review-v1')",
        ['U' + randomBytes(16).toString('hex'), region]
      );
    await add();
    vi.mocked(reviewTransport.send).mockResolvedValueOnce(590).mockResolvedValueOnce(592);
    expect(await deliverTelegramLearnerReviews(runtime, reviewTransport, () => {})).toBe(1);
    const press = (data: string) =>
      app.inject({
        method: 'POST',
        url: '/telegram/onboarding/webhook',
        headers: { 'x-telegram-bot-api-secret-token': secret },
        payload: {
          update_id: 590,
          callback_query: {
            id: 'paused-callback',
            from: { id: Number(subject), is_bot: false },
            message: {
              message_id: 590,
              date: Math.floor(Date.now() / 1000),
              from: { id: 123456, is_bot: true },
              chat: { id: Number(subject), type: 'private' }
            },
            data
          }
        }
      });
    const deny = vi.mocked(reviewTransport.send).mock.calls[0]![2]![0]![1]!.callback_data;
    expect((await press(deny)).statusCode).toBe(200);
    const custom = vi.mocked(reviewTransport.edit).mock.calls[0]![3][2]![0]!.callback_data;
    expect((await press(custom)).statusCode).toBe(200);
    await add(); // Unsent receipted application must not be silently lost off.
    await withRequestContext(runtime, 'qigong_worker_runtime', { requestId: randomUUID() }, (c) =>
      c.query('SELECT ops.queue_review_notifications_for_mode(200,true)')
    );
    await db.pool.query(
      'UPDATE ops.review_notification_deliveries SET available_at=clock_timestamp()'
    );
    await withRequestContext(
      runtime,
      'qigong_worker_runtime',
      { requestId: randomUUID() },
      async (c) => {
        await c.query("SELECT set_config('qigong.telegram_learner_review_enabled','true',true)");
        await c.query('SELECT * FROM ops.claim_review_notifications(5)');
      }
    );
    expect(
      (await db.pool.query('SELECT status FROM ops.review_notification_deliveries')).rows
    ).toEqual([{ status: 'cancelled' }, { status: 'cancelled' }]);
    await setDirectMode(false);
    expect(await state()).toMatchObject({
      learnerReviewEnabled: true,
      learnerReviewFeatureEnabled: false,
      isSuperAdmin: true
    });
    expect(
      (await post('preferences', { ...preferences, version: (await state()).revision })).statusCode
    ).toBe(403);
    vi.clearAllMocks();
    expect((await press(deny)).statusCode).toBe(200);
    expect(reviewTransport.edit).not.toHaveBeenCalled();
    expect(reviewTransport.send).not.toHaveBeenCalled();
    expect(reviewTransport.answer).toHaveBeenCalledWith(
      'paused-callback',
      expect.stringContaining('unavailable')
    );
    const before = (await db.pool.query('SELECT * FROM ops.telegram_learner_reviews')).rows;
    const calls: unknown[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (typeof init?.body !== 'string') throw Error('JSON required');
      calls.push(JSON.parse(init.body) as unknown);
      return Response.json({ ok: true });
    });
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const previousExit = process.exitCode;
    process.exitCode = undefined;
    vi.stubGlobal('fetch', fetch);
    try {
      const connectionString: unknown = runtime.options.connectionString;
      if (typeof connectionString !== 'string') throw Error('Synthetic runtime URL unavailable');
      const source = {
        DATABASE_URL: connectionString,
        TELEGRAM_ONBOARDING_BOT_TOKEN: '123456:' + 'a'.repeat(35),
        REVIEW_NOTIFICATIONS_ENABLED: 'true',
        TELEGRAM_LEARNER_REVIEW_ENABLED: 'false'
      };
      await runNotificationWorker(source);
      await runNotificationWorker(source);
      expect(process.exitCode).toBeUndefined();
      expect(errors).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        chat_id: subject,
        text: expect.stringContaining('1 new pending application')
      });
      expect(JSON.stringify(calls)).not.toMatch(
        /paused-private|Private synthetic|659900000059|lr:/
      );
      expect((await db.pool.query('SELECT * FROM ops.telegram_learner_reviews')).rows).toEqual(
        before
      );
      expect(await state()).toMatchObject({
        learnerReviewEnabled: true,
        learnerReviewFeatureEnabled: false
      });
    } finally {
      vi.unstubAllGlobals();
      logs.mockRestore();
      errors.mockRestore();
      process.exitCode = previousExit;
    }
    await db.pool.query(
      "UPDATE ops.telegram_learner_reviews SET stage='closed',prompt_message_id=NULL,expires_at=clock_timestamp()-INTERVAL '1 day'"
    );
    for (let i = 0; i < 2; i++)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/telegram/onboarding/webhook',
            headers: { 'x-telegram-bot-api-secret-token': secret },
            payload: {
              update_id: 600 + i,
              message: {
                message_id: 600 + i,
                date: Math.floor(Date.now() / 1000),
                from: { id: Number(subject), is_bot: false },
                chat: { id: Number(subject), type: 'private' },
                text: 'NEVER journal this private custom reason',
                reply_to_message: {
                  message_id: 592,
                  date: Math.floor(Date.now() / 1000) - 90000,
                  from: { id: 123456, is_bot: true },
                  chat: { id: Number(subject), type: 'private' }
                }
              }
            }
          })
        ).statusCode
      ).toBe(200);
    expect(reviewTransport.edit).not.toHaveBeenCalled();
    expect(reviewTransport.send).not.toHaveBeenCalled();
    expect(
      (await db.pool.query('SELECT count(*)::integer n FROM identity.onboarding_applications')).rows
    ).toEqual([{ n: 2 }]);
    expect((await db.pool.query('SELECT * FROM identity.people')).rows).toEqual([]);
    expect((await db.pool.query('SELECT * FROM core.checkin_notes')).rows).toEqual([]);
    expect((await db.pool.query('SELECT * FROM ops.onboarding_notifications')).rows).toEqual([]);
    expect((await db.pool.query('SELECT reason FROM ops.telegram_learner_reviews')).rows).toEqual([
      { reason: null }
    ]);
    expect(
      (
        await db.pool.query(
          "SELECT * FROM audit.events WHERE action IN('onboarding.approved','onboarding.rejected')"
        )
      ).rows
    ).toEqual([]);
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

suite(
  'Application notice receipt: three real HTTP submission paths and old-client compatibility',
  () => {
    let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>;
    let runtime: Pool;
    let role: string;
    let app: FastifyInstance;
    const noticeVersion = 'telegram-learner-review-v1';
    const lineSubject = 'U' + 'd'.repeat(32);
    const numberSubject = '548000000069';
    const lineSecret = 'synthetic-disclosure-line-secret';
    const telegramSecret = 'synthetic-disclosure-telegram-secret';
    const whatsappSecret = 'synthetic-disclosure-whatsapp-secret';
    const messages: string[] = [];
    const logs: string[] = [];
    const channels = ['line', 'telegram', 'whatsapp'] as const;
    type Channel = (typeof channels)[number];
    beforeEach(async () => {
      logs.length = 0;
      messages.length = 0;
      db = await createIsolatedTestDatabase(base!);
      await runMigrations(db.pool, directory, 'disclosure-http');
      role = 'disclosure_http_' + randomUUID().replaceAll('-', '');
      await db.pool.query(
        `CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS;GRANT qigong_api_runtime TO ${role}`
      );
      const url = new URL(db.databaseUrl);
      url.username = role;
      runtime = new pg.Pool({ connectionString: url.href });
      await db.pool.query(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('disclosure-http-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'disclosure-http-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tw-general','operational','台灣','Taiwan' FROM c"
      );
      app = buildApp({
        pool: runtime,
        logStream: {
          write: (chunk: string) => {
            logs.push(chunk);
          }
        },
        line: {
          channelSecret: lineSecret,
          channelAccessToken: 'synthetic-line-access',
          loginChannelId: '123456',
          liffId: '123456-test',
          verifyIdToken: async (token) => {
            if (token === 'verified-disclosure-token') return lineSubject;
            if (token === 'verified-other-token') return 'U' + 'e'.repeat(32);
            throw Error('Synthetic invalid provider credential');
          },
          reply: async (_token, text) => {
            messages.push(text);
          }
        },
        telegramOnboarding: {
          botToken: '123456:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          webhookSecret: telegramSecret,
          regionCode: 'tw-general',
          sendMessage: async (_recipient, text) => {
            messages.push(text);
          }
        },
        whatsapp: {
          phoneNumberId: '12345',
          businessAccountId: '67890',
          appSecret: whatsappSecret,
          verifyToken: 'synthetic-disclosure-verify',
          accessToken: 'synthetic-disclosure-access',
          graphVersion: 'v99.0',
          sendText: async (_recipient, text) => {
            messages.push(text);
          }
        }
      });
    });
    afterEach(async () => {
      await app?.close();
      await runtime?.end();
      if (role) await db.pool.query(`DROP OWNED BY ${role};DROP ROLE ${role}`);
      await db?.dispose();
    });
    const getLink = async (channel: Channel) => {
      if (channel === 'line') {
        const raw = JSON.stringify({
          events: [
            {
              type: 'message',
              webhookEventId: randomUUID(),
              replyToken: 'synthetic-reply',
              source: { type: 'user', userId: lineSubject },
              message: { type: 'text', text: '加入' }
            }
          ]
        });
        const response = await app.inject({
          method: 'POST',
          url: '/line/webhook',
          headers: {
            'content-type': 'application/json',
            'x-line-signature': createHmac('sha256', lineSecret).update(raw).digest('base64')
          },
          payload: raw
        });
        expect(response.statusCode).toBe(200);
      } else if (channel === 'telegram') {
        const response = await app.inject({
          method: 'POST',
          url: '/telegram/onboarding/webhook',
          headers: { 'x-telegram-bot-api-secret-token': telegramSecret },
          payload: {
            update_id: 690,
            message: {
              chat: { id: Number(numberSubject), type: 'private' },
              from: { id: Number(numberSubject), first_name: 'Synthetic source' },
              text: '/start'
            }
          }
        });
        expect(response.statusCode).toBe(200);
      } else {
        const raw = JSON.stringify({
          object: 'whatsapp_business_account',
          entry: [
            {
              id: '67890',
              changes: [
                {
                  field: 'messages',
                  value: {
                    messaging_product: 'whatsapp',
                    metadata: { phone_number_id: '12345' },
                    messages: [
                      {
                        id: randomUUID(),
                        from: numberSubject,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: 'text',
                        text: { body: 'join' }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        });
        const response = await app.inject({
          method: 'POST',
          url: '/whatsapp/webhook',
          headers: {
            'content-type': 'application/json',
            'x-hub-signature-256':
              'sha256=' + createHmac('sha256', whatsappSecret).update(raw).digest('hex')
          },
          payload: raw
        });
        expect(response.statusCode).toBe(200);
      }
      const token = /\/apply(?:\?lang=(?:zh_TW|zh_CN|en))?#([A-Za-z0-9_-]{43})/.exec(
        messages.at(-1) ?? ''
      )?.[1];
      if (!token) throw Error('Missing synthetic verified application link');
      return token;
    };
    const post = (channel: Channel, payload: Record<string, unknown>, requestOrigin = origin) =>
      app.inject({
        method: 'POST',
        url: `/${channel}/onboarding/apply`,
        headers: { origin: requestOrigin },
        payload
      });
    const details = (channel: Channel, token: string) => ({
      token,
      name: 'Synthetic disclosure learner',
      email: 'receipt-http@example.invalid',
      phone: '+659900000069',
      region: 'tw-general',
      ...(channel === 'line' ? { idToken: 'verified-disclosure-token' } : {}),
      ...(channel === 'whatsapp' ? { locale: 'en', notificationConsent: true } : {})
    });
    const applications = () =>
      db.pool.query<{
        platform: string;
        external_subject_id: string;
        status: string;
        telegram_review_notice_version: string | null;
      }>(
        'SELECT platform,external_subject_id,status,telegram_review_notice_version FROM identity.onboarding_applications ORDER BY external_subject_id'
      );
    for (const current of [false, true])
      it.each(channels)(
        `%s ${current ? 'current-form ACK' : 'old body'} preserves verified source ownership and only marks the submitted application`,
        async (channel) => {
          const token = await getLink(channel);
          const body = {
            ...details(channel, token),
            ...(current ? { telegramReviewNoticeVersion: noticeVersion } : {})
          };
          for (const version of [
            null,
            false,
            1,
            'old',
            'telegram-learner-review-v1 ',
            'telegram-learner-review-v2'
          ])
            expect(
              (await post(channel, { ...body, telegramReviewNoticeVersion: version })).statusCode
            ).toBe(400);
          expect((await post(channel, body, 'https://attacker.example.invalid')).statusCode).toBe(
            403
          );
          expect(
            (
              await post(channel, {
                ...body,
                token: 'z'.repeat(43),
                telegramReviewNoticeVersion: noticeVersion
              })
            ).statusCode
          ).toBe(409);
          if (channel === 'line') {
            expect(
              (
                await post(channel, {
                  ...body,
                  idToken: 'unverified',
                  telegramReviewNoticeVersion: noticeVersion
                })
              ).statusCode
            ).toBe(401);
            expect(
              (
                await post(channel, {
                  ...body,
                  idToken: 'verified-other-token',
                  userId: lineSubject,
                  telegramReviewNoticeVersion: noticeVersion
                })
              ).statusCode
            ).toBe(409);
          }
          expect((await applications()).rows).toEqual([]);
          // Body-supplied source/principal/application fields never choose the receipt target.
          const victim = (
            await db.pool.query<{ id: string }>(
              "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,requested_region_id) SELECT 'telegram','548000000070','Synthetic other application',id FROM core.regions WHERE code='tw-general' RETURNING id"
            )
          ).rows[0]!.id;
          const response = await post(channel, {
            ...body,
            applicationId: victim,
            principalId: randomUUID(),
            platform: 'telegram',
            externalSubjectId: '548000000070',
            userId: lineSubject
          });
          expect(response.statusCode).toBe(200);
          expect(response.json<unknown>()).toEqual({ status: 'pending' });
          expect((await post(channel, body)).statusCode).toBe(409);
          expect((await applications()).rows).toEqual(
            expect.arrayContaining([
              {
                platform: channel,
                external_subject_id: channel === 'line' ? lineSubject : numberSubject,
                status: 'pending',
                telegram_review_notice_version: current ? noticeVersion : null
              },
              {
                platform: 'telegram',
                external_subject_id: '548000000070',
                status: 'pending',
                telegram_review_notice_version: null
              }
            ])
          );
          expect((await applications()).rowCount).toBe(2);
          expect(
            (await db.pool.query('SELECT * FROM platform.learner_privacy_acceptances')).rows
          ).toEqual([]);
          expect(
            (
              await withRequestContext(
                runtime,
                'qigong_api_runtime',
                { requestId: randomUUID() },
                (c) =>
                  c.query<{ current_user: string; session_user: string; bypass: boolean }>(
                    'SELECT current_user,session_user,(SELECT rolbypassrls FROM pg_roles WHERE rolname=session_user) bypass'
                  )
              )
            ).rows
          ).toEqual([{ current_user: 'qigong_api_runtime', session_user: role, bypass: false }]);
          for (const sentinel of [
            token,
            body.name,
            body.email,
            body.phone,
            lineSubject,
            numberSubject,
            telegramSecret,
            lineSecret,
            whatsappSecret
          ])
            expect(logs.join('')).not.toContain(sentinel);
        }
      );
    it.each(channels)(
      '%s commits no application/receipt on SQL failure and logs no private error data',
      async (channel) => {
        const token = await getLink(channel);
        await db.pool.query(
          "CREATE FUNCTION identity.disclosure_http_fail() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.telegram_review_notice_version IS NOT NULL THEN RAISE EXCEPTION 'Synthetic private receipt failure: % % %',NEW.website_email,NEW.learner_name,NEW.external_subject_id;END IF;RETURN NEW;END$$;CREATE TRIGGER disclosure_http_fail BEFORE UPDATE ON identity.onboarding_applications FOR EACH ROW EXECUTE FUNCTION identity.disclosure_http_fail()"
        );
        const body = { ...details(channel, token), telegramReviewNoticeVersion: noticeVersion };
        expect((await post(channel, body)).statusCode).toBe(503);
        expect((await applications()).rows).toEqual([]);
        expect(logs.length).toBeGreaterThan(0);
        for (const sentinel of [
          token,
          body.name,
          body.email,
          body.phone,
          lineSubject,
          numberSubject,
          'Synthetic private receipt failure'
        ])
          expect(logs.join('')).not.toContain(sentinel);
        await db.pool.query(
          'DROP TRIGGER disclosure_http_fail ON identity.onboarding_applications'
        );
        expect((await post(channel, body)).statusCode).toBe(200);
        expect((await applications()).rows[0]?.telegram_review_notice_version).toBe(noticeVersion);
      }
    );
  }
);
