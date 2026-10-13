import { randomBytes, randomUUID } from 'node:crypto';
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
        reply: async () => {}
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
      privacy: { token: string; version: string; hash: string };
    }>();
    expect(data.status).toBe('privacy');
    expect(data.privacy.token).not.toBe(cap);
    expect(
      (
        await learner('redeem', {
          name: 'Synthetic',
          email: 'demo@example.invalid',
          phone: '+65960000001'
        })
      ).statusCode
    ).toBe(403);
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
          phone: '+65960000001'
        })
      ).json<{ status: string }>().status
    ).toBe('approved');
  });
});
