import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations, withRequestContext, type Pool } from '@qigong/database';
import { createIsolatedTestDatabase } from '../../../packages/database/tests/test-database.js';
import { buildApp } from '../src/app.js';
import { whatsappCsrfCookie, whatsappSessionCookie } from '../src/whatsapp-browser-session.js';
const base = process.env.TEST_DATABASE_URL,
  suite = base ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
const origin = 'https://checkin.baiyinqigong.org';
interface Browser {
  cookie: string;
  csrf: string;
  session: string;
}
suite('WhatsApp cookie sessions at the HTTP boundary', () => {
  let db: Awaited<ReturnType<typeof createIsolatedTestDatabase>>,
    runtime: Pool,
    app: FastifyInstance,
    role: string,
    person: string,
    link: string;
  const subject = '65910000001',
    sendText = vi.fn(async () => {}),
    sendWorkspaceMenu = vi.fn(async () => {});
  const post = (url: string, payload: Record<string, unknown>, browser?: Browser, csrf = true) =>
    app.inject({
      method: 'POST',
      url,
      headers: {
        origin,
        ...(browser
          ? { cookie: browser.cookie, ...(csrf ? { 'x-whatsapp-csrf-token': browser.csrf } : {}) }
          : {})
      },
      payload
    });
  const login = async (remember = true): Promise<Browser> => {
    const response = await post('/whatsapp/auth/session', { token: link, remember });
    expect(response.statusCode, response.body).toBe(200);
    const headers = response.headers['set-cookie'];
    if (!Array.isArray(headers)) throw Error('Missing cookies');
    const cookie = headers.map((h) => h.split(';')[0]!).join('; ');
    const csrf = /__Host-qigong-whatsapp-csrf=([A-Za-z0-9_-]{43})/.exec(cookie)?.[1],
      session = /__Host-qigong-whatsapp=([A-Za-z0-9_-]{43})/.exec(cookie)?.[1];
    if (!csrf || !session) throw Error('Missing browser credentials');
    return { cookie, csrf, session };
  };
  beforeEach(async () => {
    sendText.mockClear();
    sendWorkspaceMenu.mockClear();
    db = await createIsolatedTestDatabase(base!);
    await runMigrations(db.pool, directory, 'vitest-browser-api');
    role = 'qigong_browser_http_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await db.pool.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await db.pool.query(`GRANT qigong_api_runtime TO ${role}`);
    const url = new URL(db.databaseUrl);
    url.username = role;
    url.password = password;
    runtime = new pg.Pool({ connectionString: url.href });
    const actor = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://browser.example.invalid','reviewer','Synthetic reviewer') RETURNING id"
      )
    ).rows[0]!.id;
    const region = (
      await db.pool.query<{ id: string }>(
        "WITH g AS(INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('http-browser-global','global','全球','Global') RETURNING id),k AS(INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'http-browser-country','country','國家','Country' FROM g RETURNING id) INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) SELECT id,'tw-general','operational','地區','Region' FROM k RETURNING id"
      )
    ).rows[0]!.id;
    person = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.people(preferred_name,practice_timezone) VALUES('Synthetic browser learner','UTC') RETURNING id"
      )
    ).rows[0]!.id;
    const identity = (
      await db.pool.query<{ id: string }>(
        "INSERT INTO identity.platform_identities(person_id,platform,external_subject_id) VALUES($1,'whatsapp',$2) RETURNING id",
        [person, subject]
      )
    ).rows[0]!.id;
    await db.pool.query(
      "INSERT INTO identity.person_interaction_channels(person_id,platform_identity_id,activation_source) VALUES($1,$2,'onboarding')",
      [person, identity]
    );
    await db.pool.query(
      "INSERT INTO core.person_region_assignments(person_id,region_id,assignment_type,valid_from) VALUES($1,$2,'primary',CURRENT_DATE-10)",
      [person, region]
    );
    await db.pool.query(
      "INSERT INTO identity.onboarding_applications(platform,external_subject_id,display_name,learner_name,website_email,phone_e164,requested_region_id,status,person_id,decided_at,decided_by_principal_id) VALUES('whatsapp',$1,'Synthetic','Synthetic','demo@example.invalid','+65910000001',$2,'approved',$3,CURRENT_TIMESTAMP,$4)",
      [subject, region, person, actor]
    );
    link = randomBytes(32).toString('base64url');
    await withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
      c.query('SELECT platform.begin_whatsapp_link($1,$2,$3)', [subject, link, 'checkin'])
    );
    app = buildApp({
      pool: runtime,
      logger: false,
      whatsapp: {
        phoneNumberId: '123456',
        businessAccountId: '654321',
        graphVersion: 'v24.0',
        accessToken: 'synthetic-access-token-not-real',
        appSecret: 'synthetic-app-secret-not-real',
        verifyToken: 'synthetic-verification-not-real',
        sendText,
        sendWorkspaceMenu
      }
    });
  });
  afterEach(async () => {
    await app.close();
    await runtime.end();
    await db.pool.query(`DROP OWNED BY ${role}`);
    await db.pool.query(`DROP ROLE ${role}`);
    await db.dispose();
  });
  it('requires explicit remember choice and emits no credential in JSON while default UI is checked', async () => {
    expect((await post('/whatsapp/auth/session', { token: link })).statusCode).toBe(400);
    const response = await post('/whatsapp/auth/session', { token: link, remember: true });
    expect(response.statusCode).toBe(200);
    const cookies = response.headers['set-cookie'];
    if (!Array.isArray(cookies)) throw Error('Missing cookies');
    expect(cookies.find((v) => v.startsWith(whatsappSessionCookie + '='))).toContain(
      'Max-Age=2592000'
    );
    expect(cookies.find((v) => v.startsWith(whatsappSessionCookie + '='))).toContain('HttpOnly');
    expect(cookies.every((v) => v.includes('Secure') && v.includes('SameSite=Lax'))).toBe(true);
    expect(cookies.find((v) => v.startsWith(whatsappCsrfCookie + '='))).not.toContain('HttpOnly');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain(link);
    expect(response.json()).not.toHaveProperty('token');
    expect(response.json()).not.toHaveProperty('subject');
    const page = await app.inject('/whatsapp/checkin');
    expect(page.body).toContain('id="wa-remember" type="checkbox" checked');
    expect(page.body).toContain('共用或公共裝置');
  });
  it('allows cookie-only bookmark requests after the original link expires and does not renew the WhatsApp service window', async () => {
    const browser = await login();
    await db.pool.query(
      "UPDATE platform.whatsapp_links SET expires_at=clock_timestamp()-INTERVAL '1 second'"
    );
    const status = await app.inject({
      url: '/whatsapp/auth/session',
      headers: { cookie: browser.cookie }
    });
    expect(status.statusCode).toBe(200);
    expect(status.body).not.toContain(browser.session);
    expect((await post('/whatsapp/workspace/profile', { locale: 'en' }, browser)).statusCode).toBe(
      200
    );
    expect(
      (await post('/whatsapp/journal/own', { locale: 'en', page: 1 }, browser)).statusCode
    ).toBe(200);
    expect(
      (await post('/whatsapp/preferences/language', { locale: 'en' }, browser)).statusCode
    ).toBe(200);
    expect((await db.pool.query('SELECT * FROM platform.whatsapp_service_windows')).rowCount).toBe(
      0
    );
  });
  it('does not accept long cookies as bearer body credentials, downgrade to another token or skip CSRF', async () => {
    const browser = await login();
    expect((await post('/whatsapp/workspace/profile', { token: browser.session })).statusCode).toBe(
      401
    );
    expect((await post('/whatsapp/workspace/profile', { token: link }, browser)).statusCode).toBe(
      401
    );
    expect((await post('/whatsapp/workspace/profile', {}, browser, false)).statusCode).toBe(401);
    expect(
      (await post('/whatsapp/workspace/profile', {}, { ...browser, csrf: 'a'.repeat(43) }))
        .statusCode
    ).toBe(401);
    expect(
      (await post('/whatsapp/workspace/profile', { personId: person }, browser)).statusCode
    ).toBe(400);
    expect((await post('/whatsapp/checkin/history', { token: browser.session })).statusCode).toBe(
      401
    );
  });
  it('saves without any WhatsApp sender or receipt even after explicit signed-inbound window recording', async () => {
    const browser = await login();
    await withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
      c.query('SELECT platform.record_whatsapp_service_window($1,clock_timestamp())', [subject])
    );
    expect(
      (await post('/whatsapp/preferences/timezone', { timezone: 'UTC' }, browser)).statusCode
    ).toBe(200);
    const profile = (await post('/whatsapp/workspace/profile', {}, browser)).json<{
      today: string;
    }>();
    const saved = await post(
      '/whatsapp/workspace/save',
      {
        requestId: randomUUID(),
        date: profile.today,
        version: 0,
        methods: ['dayan_chu'],
        practiceNote: 'Synthetic private browser journal',
        feelingTagIds: []
      },
      browser
    );
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json<{ receiptQueued: boolean }>().receiptQueued).toBe(false);
    expect(sendText).not.toHaveBeenCalled();
    expect(sendWorkspaceMenu).not.toHaveBeenCalled();
  });
  it('rejects foreign origins, consumed proofs and changes of the current browser identity', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/whatsapp/auth/session',
          headers: { origin: 'https://attacker.example.invalid' },
          payload: { token: link, remember: true }
        })
      ).statusCode
    ).toBe(403);
    const browser = await login();
    expect(
      (await post('/whatsapp/auth/session', { token: link, remember: true }, browser)).statusCode
    ).toBe(409);
    expect((await post('/whatsapp/auth/session', { token: link, remember: true })).statusCode).toBe(
      401
    );
    expect(
      (
        await app.inject({
          url: '/whatsapp/auth/session',
          headers: { cookie: browser.cookie, origin: 'https://attacker.example.invalid' }
        })
      ).statusCode
    ).toBe(403);
  });
  it('logs out only after CSRF validation and clears credentials on revoked sessions', async () => {
    const browser = await login();
    expect((await post('/whatsapp/auth/logout', {}, browser, false)).statusCode).toBe(403);
    expect((await post('/whatsapp/auth/logout', {}, browser)).statusCode).toBe(200);
    const status = await app.inject({
      url: '/whatsapp/auth/session',
      headers: { cookie: browser.cookie }
    });
    expect(status.statusCode).toBe(401);
    expect(status.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('Max-Age=0')])
    );
  });
  it('honors privacy and administrative eligibility removal without deleting stored practice', async () => {
    const browser = await login();
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='active'");
    expect((await post('/whatsapp/workspace/profile', {}, browser)).statusCode).toBe(403);
    await db.pool.query("UPDATE platform.learner_privacy_policies SET state='draft'");
    await db.pool.query(
      'UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=$1',
      [person]
    );
    await db.pool.query("UPDATE identity.people SET status='suspended' WHERE id=$1", [person]);
    expect((await post('/whatsapp/workspace/profile', {}, browser)).statusCode).toBe(401);
  });
  it('retains browser cookies and a valid session during transient status or logout service failures', async () => {
    const browser = await login();
    const connect = vi.spyOn(runtime, 'connect');
    connect.mockRejectedValueOnce(new Error('Synthetic database outage'));
    const status = await app.inject({
      url: '/whatsapp/auth/session',
      headers: { cookie: browser.cookie }
    });
    expect(status.statusCode).toBe(503);
    expect(status.headers['set-cookie']).toBeUndefined();
    connect.mockRejectedValueOnce(new Error('Synthetic database outage'));
    const logout = await post('/whatsapp/auth/logout', {}, browser);
    expect(logout.statusCode).toBe(503);
    expect(logout.headers['set-cookie']).toBeUndefined();
    connect.mockRestore();
    expect(
      (await app.inject({ url: '/whatsapp/auth/session', headers: { cookie: browser.cookie } }))
        .statusCode
    ).toBe(200);
  });
  it('clears malformed cookies so a new private link can be used rather than getting stuck', async () => {
    const status = await app.inject({
      url: '/whatsapp/auth/session',
      headers: { cookie: whatsappSessionCookie + '=invalid' }
    });
    expect(status.statusCode).toBe(401);
    expect(status.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('Max-Age=0')])
    );
  });
});
