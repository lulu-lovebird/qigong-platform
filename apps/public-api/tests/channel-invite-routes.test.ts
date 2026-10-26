import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip,
  directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations'),
  origin = 'https://checkin.baiyinqigong.org';
type Platform = 'telegram' | 'whatsapp';
suite('Signed TG/WA invitation HTTP integration (mock transports, real restricted DB)', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    app: FastifyInstance,
    role: string,
    actor: string,
    cookie: string,
    csrf: string,
    sequence: number;
  const replies: { telegram: { text: string; webApp?: boolean }[]; whatsapp: string[] } = {
    telegram: [],
    whatsapp: []
  };
  const post = (url: string, payload: Record<string, unknown>, admin = false, withCsrf = true) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        origin,
        ...(admin ? { cookie, ...(withCsrf ? { 'x-csrf-token': csrf } : {}) } : {})
      },
      payload
    });
  const create = async (platform: Platform) => {
    const r = await post(
      '/admin/api/channel-invites/' + platform,
      {
        label: 'Synthetic invitation',
        region: 'tw-general',
        reason: 'Synthetic confirmed audience'
      },
      true
    );
    expect(r.statusCode, r.body).toBe(201);
    const data = r.json<{ id: string; revision: number; url: string }>();
    return { ...data, token: new URL(data.url).hash.slice(1) };
  };
  const inbound = (
    platform: Platform,
    text: string,
    id = '1001',
    options: {
      group?: boolean;
      stale?: boolean;
      wrongAccount?: boolean;
      event?: number;
      date?: number;
    } = {}
  ) => {
    const n = options.event ?? ++sequence,
      date = options.date ?? Math.floor(Date.now() / 1000) - (options.stale ? 90000 : 0);
    if (platform === 'telegram')
      return app.inject({
        method: 'POST',
        url: '/telegram/onboarding/webhook',
        headers: { 'x-telegram-bot-api-secret-token': 'synthetic-tg-secret' },
        payload: {
          update_id: n,
          message: {
            chat: { id: Number(id), type: options.group ? 'group' : 'private' },
            from: { id: Number(id), first_name: 'Synthetic' },
            date,
            text
          }
        }
      });
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: options.wrongAccount ? 'wrong-account' : '22222',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '11111' },
                messages: [
                  {
                    id: 'synthetic-wa-' + n,
                    from: id,
                    timestamp: String(date),
                    type: 'text',
                    text: { body: text }
                  }
                ]
              }
            }
          ]
        }
      ]
    });
    return app.inject({
      method: 'POST',
      url: '/whatsapp/webhook',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256':
          'sha256=' + createHmac('sha256', 'synthetic-wa-secret').update(raw).digest('hex')
      },
      payload: raw
    });
  };
  const resume = (platform: Platform) => {
    const text = platform === 'telegram' ? replies.telegram.at(-1)?.text : replies.whatsapp.at(-1);
    const match = new RegExp(
      '/' + platform + '/invite(?:\\?lang=[A-Za-z_]+)?#([A-Za-z0-9_-]{43})'
    ).exec(text ?? '');
    expect(match, 'Expected a private form URL').toBeTruthy();
    return match![1]!;
  };
  const accept = async (platform: Platform, token: string) => {
    const s = await post('/' + platform + '/invite/status', { token, locale: 'en' });
    expect(s.statusCode, s.body).toBe(200);
    const p = s.json<{ privacy?: { token: string; version: string; hash: string } }>().privacy;
    if (p) {
      const r = await post('/learner/privacy/accept', {
        platform,
        token: p.token,
        version: p.version,
        hash: p.hash,
        locale: 'en',
        accepted: true,
        reflectionConsent: false
      });
      expect(r.statusCode, r.body).toBe(200);
    }
  };
  const redeem = (platform: Platform, token: string, extra: Record<string, unknown> = {}) =>
    post('/' + platform + '/invite/redeem', {
      token,
      locale: 'en',
      name: 'Synthetic learner',
      email: 'synthetic@example.invalid',
      phone: '+999000000001',
      notificationConsent: platform === 'whatsapp',
      ...extra
    });
  beforeEach(async () => {
    replies.telegram = [];
    replies.whatsapp = [];
    sequence = 700000;
    db = await createIsolatedTestDatabase(base!);
    await runMigrations(db.pool, directory, 'channel-invite-http');
    role = 'qigong_channel_http_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime TO ${role}`);
    const url = new URL(db.databaseUrl);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    actor = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://channel.example.invalid','super','Synthetic super') RETURNING id"
      )
    ).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic super' FROM admin.roles WHERE code='super_admin'",
      [actor]
    );
    await db.pool.query(
      "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('channel-http-global','global','全球','Global') RETURNING id),c AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'channel-http-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en,default_timezone) SELECT id,'tw-general','operational','台灣','Taiwan','Asia/Taipei' FROM c"
    );
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    app = buildApp({
      pool: runtime,
      logger: false,
      inviteTransports: { telegram: 'example_helper_bot', whatsapp: '999000000001' },
      telegramOnboarding: {
        botToken: '12345:' + 'x'.repeat(35),
        webhookSecret: 'synthetic-tg-secret',
        regionCode: 'tw-general',
        sendMessage: async (_id, text, buttons) => {
          replies.telegram.push({
            text,
            ...(buttons?.[0]?.webApp !== undefined ? { webApp: buttons[0].webApp } : {})
          });
        }
      },
      whatsapp: {
        phoneNumberId: '11111',
        businessAccountId: '22222',
        appSecret: 'synthetic-wa-secret',
        accessToken: 'synthetic-access-token-not-real',
        verifyToken: 'synthetic-verification-token-not-real',
        graphVersion: 'v99.0',
        sendText: async (_id, text) => {
          replies.whatsapp.push(text);
        }
      },
      adminAuth: {
        callbackUrl: origin + '/admin/auth/callback',
        begin: async (_verifier, state) =>
          new URL('https://channel.example.invalid/authorize?state=' + state),
        complete: async () => ({ iss: 'https://channel.example.invalid', sub: 'super' })
      }
    });
    const login = await app.inject('/admin/auth/login'),
      state = new URL(login.headers.location!).searchParams.get('state')!;
    const callback = await app.inject({
      url: '/admin/auth/callback?state=' + state + '&code=synthetic',
      headers: { cookie: '__Host-qigong-admin-state=' + state }
    });
    expect(callback.statusCode).toBe(302);
    const issued = callback.headers['set-cookie'];
    if (!Array.isArray(issued)) throw Error('Missing admin cookies');
    cookie = issued.map((v) => v.split(';')[0]!).join('; ');
    csrf = /__Host-qigong-admin-csrf=([^;]+)/.exec(cookie)![1]!;
  });
  afterEach(async () => {
    await app?.close();
    await runtime?.end();
    if (db) {
      await db.pool.query(`DROP OWNED BY ${role}`);
      await db.pool.query(`DROP ROLE ${role}`);
      await db.dispose();
    }
  });
  it.each(['telegram', 'whatsapp'] as const)(
    'joins %s from one URL through privacy and explicit details, without a manual invitation field',
    async (platform) => {
      const invite = await create(platform);
      expect(invite.url).toBe(origin + '/' + platform + '/join#' + invite.token);
      const landing = await app.inject('/' + platform + '/join?lang=en');
      expect(landing.statusCode).toBe(200);
      expect(landing.body).not.toContain('name="token"');
      expect(
        (
          await inbound(
            platform,
            (platform === 'telegram' ? '/start' : 'join') + ' inv_' + invite.token
          )
        ).statusCode
      ).toBe(200);
      const privateToken = resume(platform);
      expect(privateToken).not.toBe(invite.token);
      expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(0);
      expect((await db.pool.query('SELECT uses FROM platform.channel_invites')).rows[0]!.uses).toBe(
        0
      );
      expect((await redeem(platform, privateToken)).statusCode).toBe(403);
      await accept(platform, privateToken);
      const form = await post('/' + platform + '/invite/status', {
        token: privateToken,
        locale: 'en'
      });
      expect(form.json()).toMatchObject({ status: 'form', region: 'tw-general' });
      if (platform === 'whatsapp')
        expect(
          (await redeem(platform, privateToken, { notificationConsent: false })).statusCode
        ).toBe(400);
      const done = await redeem(platform, privateToken);
      expect(done.statusCode, done.body).toBe(200);
      expect(done.json()).toEqual({ status: 'approved', alreadyMember: false });
      expect((await redeem(platform, privateToken)).json()).toEqual({
        status: 'approved',
        alreadyMember: true
      });
      expect((await db.pool.query('SELECT uses FROM platform.channel_invites')).rows[0]!.uses).toBe(
        1
      );
      expect(
        (await db.pool.query('SELECT * FROM identity.person_interaction_channels')).rowCount
      ).toBe(1);
      expect(
        (await db.pool.query('SELECT reflection_consent FROM platform.learner_privacy_acceptances'))
          .rows[0]!.reflection_consent
      ).toBe(false);
      if (platform === 'telegram') expect(replies.telegram.at(-1)?.webApp).toBe(false);
    }
  );
  it('enforces real admin sessions, super-only management, CSRF, Origin, platform scopes and secret-free lists', async () => {
    const invite = await create('telegram');
    expect((await app.inject('/admin/api/channel-invites/telegram')).statusCode).toBe(401);
    expect(
      (
        await post(
          '/admin/api/channel-invites/telegram',
          { label: 'Denied', region: 'tw-general', reason: 'Test' },
          true,
          false
        )
      ).statusCode
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/api/channel-invites/telegram',
          headers: { cookie, origin: 'https://evil.example.invalid', 'x-csrf-token': csrf },
          payload: {}
        })
      ).statusCode
    ).toBe(403);
    const list = await app.inject({
      url: '/admin/api/channel-invites/telegram',
      headers: { cookie }
    });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(invite.token);
    expect(list.json<{ items: { maxUses: number }[] }>().items[0]?.maxUses).toBe(1);
    expect(
      (await app.inject({ url: '/admin/channel-invites', headers: { cookie } })).statusCode
    ).toBe(200);
    await db.pool.query(
      "UPDATE admin.role_grants SET role_id=(SELECT id FROM admin.roles WHERE code='master_admin') WHERE principal_id=$1",
      [actor]
    );
    expect(
      (
        await app.inject({ url: '/admin/api/channel-invites/capabilities', headers: { cookie } })
      ).json()
    ).toEqual({ canManage: false });
    expect(
      (
        await post(
          '/admin/api/channel-invites/telegram',
          { label: 'Denied', region: 'tw-general', reason: 'Test' },
          true
        )
      ).statusCode
    ).toBe(403);
  });
  it('does not accept unsigned, group, stale or mismatched-account invite messages', async () => {
    const invite = await create('telegram');
    expect(
      (await app.inject({ method: 'POST', url: '/telegram/onboarding/webhook', payload: {} }))
        .statusCode
    ).toBe(401);
    await inbound('telegram', '/start inv_' + invite.token, '1001', { group: true });
    await inbound('telegram', '/start inv_' + invite.token, '1001', { stale: true });
    const wa = await create('whatsapp');
    expect(
      (await inbound('whatsapp', 'join inv_' + wa.token, '1001', { wrongAccount: true })).statusCode
    ).toBe(403);
    expect(
      (await db.pool.query('SELECT * FROM platform.channel_invite_continuations')).rowCount
    ).toBe(0);
  });
  it.each(['telegram', 'whatsapp'] as const)(
    'keeps the same %s private link across resend and never silently drops into ordinary pending',
    async (platform) => {
      const invite = await create(platform);
      await inbound(
        platform,
        (platform === 'telegram' ? '/start' : 'join') + ' inv_' + invite.token
      );
      const token = resume(platform);
      await inbound(platform, platform === 'telegram' ? '/start' : 'join');
      expect(resume(platform)).toBe(token);
      expect((await db.pool.query('SELECT * FROM identity.onboarding_applications')).rowCount).toBe(
        0
      );
      expect((await redeem(platform, token, { subject: 'spoofed' })).statusCode).toBe(400);
      expect((await redeem(platform, token, { region: 'my-general' })).statusCode).toBe(400);
      const other: Platform = platform === 'telegram' ? 'whatsapp' : 'telegram';
      expect((await post('/' + other + '/invite/status', { token, locale: 'en' })).statusCode).toBe(
        409
      );
    }
  );
  it('suppresses exact Telegram invitation retries within the bounded process guard', async () => {
    const invite = await create('telegram'),
      date = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 2; i++)
      expect(
        (await inbound('telegram', '/start inv_' + invite.token, '1001', { event: 799998, date }))
          .statusCode
      ).toBe(200);
    expect(replies.telegram).toHaveLength(1);
    expect(
      (await db.pool.query('SELECT count(*)::int n FROM platform.channel_invite_continuations'))
        .rows[0]!.n
    ).toBe(1);
  });
  it('retains WA durable inbox idempotence and does not consume quota on link previews', async () => {
    const invite = await create('whatsapp');
    for (let i = 0; i < 3; i++)
      expect((await app.inject('/whatsapp/join?lang=en')).statusCode).toBe(200);
    const date = Math.floor(Date.now() / 1000);
    expect(
      (await inbound('whatsapp', 'join inv_' + invite.token, '1001', { event: 799999, date }))
        .statusCode
    ).toBe(200);
    expect(
      (await inbound('whatsapp', 'join inv_' + invite.token, '1001', { event: 799999, date }))
        .statusCode
    ).toBe(200);
    expect(replies.whatsapp).toHaveLength(1);
    expect((await db.pool.query('SELECT uses FROM platform.channel_invites')).rows[0]!.uses).toBe(
      0
    );
  });
  it('revokes only new joining, honors stale revisions and never revokes already-approved learners', async () => {
    const invite = await create('telegram');
    await inbound('telegram', '/start inv_' + invite.token);
    const token = resume('telegram');
    await accept('telegram', token);
    await redeem('telegram', token);
    expect(
      (
        await post(
          '/admin/api/channel-invites/telegram/' + invite.id + '/revoke',
          { version: 99, reason: 'Stale' },
          true
        )
      ).statusCode
    ).toBe(409);
    expect(
      (
        await post(
          '/admin/api/channel-invites/telegram/' + invite.id + '/revoke',
          { version: 1, reason: 'Synthetic revoke' },
          true
        )
      ).statusCode
    ).toBe(200);
    expect((await redeem('telegram', token)).json()).toMatchObject({
      status: 'approved',
      alreadyMember: true
    });
    replies.telegram = [];
    await inbound('telegram', '/start inv_' + invite.token);
    expect(replies.telegram.at(-1)?.text).not.toContain('/invite');
  });
  it.each(['telegram', 'whatsapp'] as const)(
    'preserves ordinary %s manual-review enrollment without an invite',
    async (platform) => {
      await db.pool.query("UPDATE platform.learner_privacy_policies SET state='draft'");
      await inbound(platform, platform === 'telegram' ? '/start' : 'join');
      const text =
        platform === 'telegram' ? replies.telegram.at(-1)?.text : replies.whatsapp.at(-1);
      const token = /\/apply(?:\?lang=[A-Za-z_]+)?#([A-Za-z0-9_-]{43})/.exec(text ?? '')?.[1];
      expect(token).toBeTruthy();
      const r = await post('/' + platform + '/onboarding/apply', {
        token,
        name: 'Synthetic ordinary',
        email: 'ordinary@example.invalid',
        phone: '+999000000001',
        region: 'tw-general',
        ...(platform === 'whatsapp' ? { locale: 'en', notificationConsent: true } : {})
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toEqual({ status: 'pending' });
      expect(
        (await db.pool.query('SELECT * FROM platform.channel_invite_redemptions')).rowCount
      ).toBe(0);
    }
  );
});
