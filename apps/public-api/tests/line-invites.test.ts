import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
import { verifyLineFriendship } from '../src/line-invites.js';
import { renderLineInvitePage } from '../src/line-invite-page.js';
import { renderAdminLineInvites } from '../src/admin-line-invite-pages.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations'),
  origin = 'https://checkin.baiyinqigong.org',
  subject = 'U' + 'a'.repeat(32);
describe('LINE invite rendering and server friendship verification', () => {
  it('syntax-checks pages, preserves LIFF initialization before URL cleanup and has no persistent bearer storage', () => {
    for (const html of [
      renderLineInvitePage('123-test'),
      renderAdminLineInvites('zh_TW'),
      renderAdminLineInvites('en')
    ]) {
      for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
        expect(() => new vm.Script(script[1]!)).not.toThrow();
      expect(html).not.toContain('localStorage');
      expect(html).not.toContain('sessionStorage');
    }
    const html = renderLineInvitePage('123-test');
    expect(html.indexOf('await liff.init')).toBeLessThan(html.indexOf('history.replaceState'));
    expect(html).toContain('reflectionConsent:false');
    expect(renderAdminLineInvites('en')).toContain('__Host-qigong-admin-csrf=');
  });
  it('checks access-token channel, exact subject and server friendFlag rather than browser flags', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ client_id: '123', expires_in: 100 }))
      .mockResolvedValueOnce(Response.json({ userId: subject }))
      .mockResolvedValueOnce(Response.json({ friendFlag: true }));
    vi.stubGlobal('fetch', fetch);
    try {
      expect(await verifyLineFriendship('synthetic-access', subject, '123')).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(3);
      fetch.mockResolvedValueOnce(Response.json({ client_id: 'wrong', expires_in: 100 }));
      await expect(verifyLineFriendship('synthetic-access', subject, '123')).rejects.toThrow(
        'unavailable'
      );
      fetch
        .mockResolvedValueOnce(Response.json({ client_id: '123', expires_in: 100 }))
        .mockResolvedValueOnce(Response.json({ userId: 'U' + 'b'.repeat(32) }));
      await expect(verifyLineFriendship('synthetic-access', subject, '123')).rejects.toThrow(
        'unavailable'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('refuses expired access tokens or invalid provider booleans', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ client_id: '123', expires_in: 0 }));
    vi.stubGlobal('fetch', fetch);
    try {
      await expect(verifyLineFriendship('synthetic-access', subject, '123')).rejects.toThrow(
        'unavailable'
      );
      fetch
        .mockResolvedValueOnce(Response.json({ client_id: '123', expires_in: 100 }))
        .mockResolvedValueOnce(Response.json({ userId: subject }))
        .mockResolvedValueOnce(Response.json({ friendFlag: 'true' }));
      await expect(verifyLineFriendship('synthetic-access', subject, '123')).rejects.toThrow(
        'unavailable'
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
suite('LINE invitation HTTP onboarding and administrator boundaries', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    app: FastifyInstance,
    role: string,
    actor: string,
    cookie: string,
    csrf: string,
    cap: string,
    invite: { id: string; revision: number },
    friend: boolean;
  const replies = vi.fn(async (replyToken: string, text: string) => {
    expect(replyToken).toBeTruthy();
    expect(text).toBeTruthy();
  });
  const webhook = async (type: 'follow' | 'message', user = subject) => {
    const body = JSON.stringify({
      events: [
        {
          type,
          source: { type: 'user', userId: user },
          webhookEventId: randomUUID(),
          replyToken: 'synthetic-reply',
          ...(type === 'message' ? { message: { type: 'text', text: '加入' } } : {})
        }
      ]
    });
    return app.inject({
      method: 'POST',
      url: '/line/webhook',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'x-line-signature': createHmac('sha256', 'synthetic-secret-not-real')
          .update(body)
          .digest('base64')
      }
    });
  };
  const friendship = vi.fn(async (access: string, uid: string) => {
    if (access !== 'verified-access' || uid !== subject)
      throw Error('LINE friendship verification unavailable');
    return friend;
  });
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
  const learner = (url: string, values: Record<string, unknown> = {}) =>
    post('/line/invite/' + url, {
      idToken: 'verified-id',
      accessToken: 'verified-access',
      token: cap,
      ...values
    });
  beforeEach(async () => {
    friend = true;
    friendship.mockClear();
    replies.mockClear();
    db = await createIsolatedTestDatabase(base!);
    await runMigrations(db.pool, directory, 'invite-http');
    role = 'qigong_invite_http_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime TO ${role}`);
    const url = new URL(db.databaseUrl);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    actor = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://invite-http.example.invalid','super','Synthetic super') RETURNING id"
      )
    ).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,valid_from,reason) SELECT $1,id,'global',clock_timestamp()-INTERVAL '1 day','Synthetic super' FROM admin.roles WHERE code='super_admin'",
      [actor]
    );
    await db.pool.query(
      "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('invite-http-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'invite-http-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en,default_timezone) SELECT id,'tw-general','operational','台灣','Taiwan','Asia/Taipei' FROM k"
    );
    app = buildApp({
      pool: runtime,
      logger: false,
      line: {
        channelSecret: 'synthetic-secret-not-real',
        channelAccessToken: 'synthetic-channel-access-not-real',
        loginChannelId: '123',
        liffId: '123-test',
        verifyIdToken: async (token) => {
          if (token !== 'verified-id') throw Error('Invalid identity');
          return subject;
        },
        verifyFriendship: friendship,
        reply: replies
      },
      adminAuth: {
        callbackUrl: origin + '/admin/auth/callback',
        begin: async (verifier, state) => {
          expect(verifier).toBeTruthy();
          return new URL('https://invite-http.example.invalid/authorize?state=' + state);
        },
        complete: async () => ({ iss: 'https://invite-http.example.invalid', sub: 'super' })
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
    const created = await post(
      '/admin/api/line-invites',
      { label: 'Synthetic invite', reason: 'Authorized synthetic batch' },
      true
    );
    expect(created.statusCode, created.body).toBe(201);
    invite = created.json<{ id: string; revision: number }>();
    cap = new URL(created.json<{ url: string }>().url).hash.slice(1);
  });
  afterEach(async () => {
    await app?.close();
    await runtime?.end();
    if (db) {
      const exists = await db.pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
      if (exists.rowCount) {
        await db.pool.query(`DROP OWNED BY ${role}`);
        await db.pool.query(`DROP ROLE ${role}`);
      }
      await db.dispose();
    }
  });
  it('defaults to7days100uses and requires active super, CSRF and exact Origin for management', async () => {
    const record = (await db.pool.query('SELECT * FROM platform.line_invites')).rows[0]!;
    expect(record.max_uses).toBe(100);
    expect(record.expires_at.getTime() - record.created_at.getTime()).toBeGreaterThan(
      6.99 * 86400000
    );
    expect(
      (await post('/admin/api/line-invites', { label: 'No CSRF', reason: 'Invalid' }, true, false))
        .statusCode
    ).toBe(403);
    expect((await app.inject('/admin/api/line-invites')).statusCode).toBe(401);
    const list = await app.inject({ url: '/admin/api/line-invites', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(cap);
    expect((await app.inject({ url: '/admin/line-invites', headers: { cookie } })).statusCode).toBe(
      200
    );
    await db.pool.query(
      "UPDATE admin.role_grants SET valid_to=clock_timestamp()-INTERVAL '1 second' WHERE principal_id=$1",
      [actor]
    );
    expect(
      (await post('/admin/api/line-invites', { label: 'Revoked actor', reason: 'Invalid' }, true))
        .statusCode
    ).toBe(401);
  });
  it('rejects browser ID/friendFlag/region spoofing, missing identity and cross-origin requests', async () => {
    expect((await learner('status', { userId: subject })).statusCode).toBe(400);
    expect((await learner('status', { friendFlag: true })).statusCode).toBe(400);
    expect((await learner('status', { idToken: 'wrong' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/line/invite/status',
          headers: { origin: 'https://evil.example.invalid' },
          payload: { idToken: 'verified-id', token: cap }
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await learner('redeem', {
          name: 'Synthetic',
          email: 'demo@example.invalid',
          phone: '+65960000001',
          region: 'my-general'
        })
      ).statusCode
    ).toBe(400);
  });
  it('requires server-confirmed friendship for new users then auto-approves without an admin decision', async () => {
    friend = false;
    expect((await learner('status')).json<{ status: string }>().status).toBe('friend');
    expect(
      (
        await learner('redeem', {
          name: 'Synthetic',
          email: 'demo@example.invalid',
          phone: '+65960000001'
        })
      ).statusCode
    ).toBe(403);
    expect((await db.pool.query('SELECT uses FROM platform.line_invites')).rows[0]!.uses).toBe(0);
    friend = true;
    expect((await learner('status')).json<{ status: string }>().status).toBe('form');
    const joined = await learner('redeem', {
      name: 'Synthetic',
      email: 'demo@example.invalid',
      phone: '+65960000001'
    });
    expect(joined.statusCode, joined.body).toBe(200);
    expect(joined.json()).toEqual({ status: 'approved', alreadyMember: false });
    expect(
      (await db.pool.query('SELECT status FROM identity.onboarding_applications')).rows[0]!.status
    ).toBe('approved');
  });
  it('resumes invite -> add friend -> signed follow -> basic details -> approved -> checkin without entering manual review', async () => {
    friend = false;
    const started = (await learner('status')).json<{ status: string; resumeToken: string }>();
    expect(started.status).toBe('friend');
    expect(started.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(started.resumeToken).not.toBe(cap);
    expect((await webhook('follow')).statusCode).toBe(200);
    expect(replies.mock.calls.at(-1)?.[1]).toContain('/invite#' + started.resumeToken);
    expect(replies.mock.calls.at(-1)?.[1]).not.toContain('/apply#');
    expect((await db.pool.query('SELECT * FROM platform.line_links')).rowCount).toBe(0);
    friend = true;
    const resumed = await learner('status', { token: started.resumeToken });
    expect(resumed.json()).toMatchObject({ status: 'form', resumeToken: started.resumeToken });
    expect((await learner('status', { token: undefined })).json()).toMatchObject({
      status: 'form',
      resumeToken: started.resumeToken
    });
    const result = await learner('redeem', {
      token: started.resumeToken,
      name: 'Invited learner',
      email: 'invited@example.invalid',
      phone: '+65960000002'
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toEqual({ status: 'approved', alreadyMember: false });
    expect(
      (await db.pool.query('SELECT status FROM identity.onboarding_applications')).rows[0]!.status
    ).toBe('approved');
    expect((await db.pool.query('SELECT * FROM ops.review_notification_events')).rowCount).toBe(0);
    expect((await db.pool.query('SELECT * FROM platform.line_invite_redemptions')).rowCount).toBe(
      1
    );
    expect((await db.pool.query('SELECT * FROM platform.line_invite_continuations')).rowCount).toBe(
      0
    );
    const history = await post('/line/checkin/history', { idToken: 'verified-id' });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json<{ entries: unknown[] }>().entries).toEqual([]);
  });
  it('does not send a general application link when follow precedes the first authenticated invitation request', async () => {
    expect((await webhook('follow')).statusCode).toBe(200);
    const text = replies.mock.calls.at(-1)?.[1] ?? '';
    expect(text).toContain('原邀請頁');
    expect(text).not.toContain('/apply#');
    expect((await db.pool.query('SELECT * FROM platform.line_links')).rowCount).toBe(0);
    expect((await webhook('message')).statusCode).toBe(200);
    expect(replies.mock.calls.at(-1)?.[1]).toContain('/apply#');
  });
  it('prevents an old manual form from creating a pending application while a valid invitation continuation exists', async () => {
    await webhook('message');
    const manual = /\/apply#([A-Za-z0-9_-]{43})/.exec(replies.mock.calls.at(-1)?.[1] ?? '')?.[1];
    expect(manual).toBeTruthy();
    const start = (await learner('status')).json<{ resumeToken: string }>();
    const applied = await post('/line/onboarding/apply', {
      token: manual,
      idToken: 'verified-id',
      name: 'Manual draft',
      email: 'draft@example.invalid',
      phone: '+65960000002',
      region: 'tw-general'
    });
    expect(applied.statusCode, applied.body).toBe(409);
    expect(applied.json()).toEqual({
      error: 'line_invite_continuation_required',
      resumeToken: start.resumeToken
    });
    expect((await db.pool.query('SELECT * FROM identity.onboarding_applications')).rowCount).toBe(
      0
    );
    expect((await db.pool.query('SELECT * FROM ops.review_notification_events')).rowCount).toBe(0);
  });
  it('allows only the same pending applicant to explicitly confirm a valid invitation, without creating a second applicant', async () => {
    await db.pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164) VALUES('line',$1,'Draft','Draft','draft@example.invalid','+65960000002')",
      [subject]
    );
    const before = (await db.pool.query('SELECT id,status FROM identity.onboarding_applications'))
      .rows[0]!;
    const status = await learner('status');
    expect(status.json()).toMatchObject({ status: 'form', pendingApplication: true });
    expect(
      (await db.pool.query('SELECT status FROM identity.onboarding_applications')).rows[0]!.status
    ).toBe('pending');
    const joined = await learner('redeem', {
      name: 'Confirmed learner',
      email: 'confirmed@example.invalid',
      phone: '+65960000003'
    });
    expect(joined.statusCode, joined.body).toBe(200);
    expect(
      (await db.pool.query('SELECT id,status FROM identity.onboarding_applications')).rows
    ).toEqual([{ id: before.id, status: 'approved' }]);
    expect((await db.pool.query('SELECT uses FROM platform.line_invites')).rows[0]!.uses).toBe(1);
  });
  it('does not expose another user continuation and rejects revoked/expired continuations rather than downgrading them', async () => {
    const start = (await learner('status')).json<{ resumeToken: string }>();
    await webhook('follow', 'U' + 'b'.repeat(32));
    expect(replies.mock.calls.at(-1)?.[1]).not.toContain(start.resumeToken);
    expect((await learner('status', { idToken: 'wrong', token: undefined })).statusCode).toBe(401);
    await post(
      '/admin/api/line-invites/' + invite.id + '/revoke',
      { version: invite.revision, reason: 'Synthetic revoke' },
      true
    );
    expect((await learner('status', { token: start.resumeToken })).json()).toMatchObject({
      status: 'invalid'
    });
    expect((await learner('status', { token: undefined })).json()).toMatchObject({
      status: 'invalid'
    });
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(0);
  });
  it('does not trust an access token from a different verified user or provider failure', async () => {
    expect((await learner('status', { accessToken: 'wrong-access' })).statusCode).toBe(503);
    expect((await db.pool.query('SELECT * FROM identity.people')).rowCount).toBe(0);
  });
  it('routes existing approved identities independently of invitation validity and without friendship/quota checks', async () => {
    await learner('redeem', {
      name: 'Synthetic',
      email: 'demo@example.invalid',
      phone: '+65960000001'
    });
    await post(
      '/admin/api/line-invites/' + invite.id + '/revoke',
      { version: invite.revision, reason: 'Synthetic revoke' },
      true
    );
    friendship.mockClear();
    friend = false;
    const result = await learner('status', { token: 'z'.repeat(43), accessToken: undefined });
    expect(result.statusCode).toBe(200);
    expect(result.json<{ status: string }>().status).toBe('approved');
    expect(friendship).not.toHaveBeenCalled();
    expect((await db.pool.query('SELECT uses FROM platform.line_invites')).rows[0]!.uses).toBe(1);
  });
  it('uses a per-subject privacy proof, never the shared bearer, before new admission', async () => {
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    const status = await learner('status');
    expect(status.statusCode).toBe(200);
    const data = status.json<{
      status: string;
      resumeToken: string;
      privacy: { token: string; version: string; hash: string };
    }>();
    expect(data.status).toBe('privacy');
    expect(data.privacy.token).not.toBe(cap);
    expect(data.privacy.token).not.toBe(data.resumeToken);
    await webhook('follow');
    expect(replies.mock.calls.at(-1)?.[1]).toContain('/invite#' + data.resumeToken);
    expect(replies.mock.calls.at(-1)?.[1]).not.toContain('/privacy#');
    expect(
      (
        await learner('redeem', {
          name: 'Synthetic',
          email: 'demo@example.invalid',
          phone: '+65960000001'
        })
      ).statusCode
    ).toBe(403);
    expect((await learner('status', { token: undefined })).json()).toMatchObject({
      status: 'privacy',
      resumeToken: data.resumeToken
    });
    const accepted = await post('/learner/privacy/accept', {
      platform: 'line',
      ...data.privacy,
      accepted: true,
      reflectionConsent: false,
      locale: 'zh_TW'
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(
      (
        await learner('redeem', {
          name: 'Synthetic',
          email: 'demo@example.invalid',
          phone: '+65960000001',
          token: data.resumeToken
        })
      ).json<{ status: string }>().status
    ).toBe('approved');
  });
});
