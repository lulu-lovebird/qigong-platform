import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, type Pool } from '@qigong/database';
import { buildApp } from '../src/app.js';
import type { AdminAuthProvider } from '../src/admin-auth.js';
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../migrations');
interface Status {
  principalId: string;
  version: number;
  status: string;
}
interface AccountList {
  entries: Array<{
    principalId: string;
    subject: string;
    grantVersion: number;
    canRevokeAll: boolean;
    grants: Array<{ id: string; role: string }>;
  }>;
}
interface Session {
  cookie: string;
  csrf: string;
  location: string;
}
suite('super admin approval HTTP boundary', () => {
  let root: Pool;
  let runtime: Pool;
  let app: FastifyInstance;
  let databaseName: string;
  let maintenance: pg.Client;
  let loginRole: string;
  let region: string;
  let subject: string;
  const provider: AdminAuthProvider = {
    callbackUrl: 'https://platform.example/admin/auth/callback',
    begin: async (_v, state) => new URL('https://auth.example/authorize?state=' + state),
    complete: async () => ({
      iss: 'https://auth.example',
      sub: subject,
      name: '<img src=x onerror=alert(1)>',
      verifiedEmail: 'verified@example.com'
    })
  };
  const signIn = async (who: string): Promise<Session> => {
    subject = who;
    const login = await app.inject('/admin/auth/login');
    const state = new URL(login.headers.location!).searchParams.get('state')!;
    const response = await app.inject({
      url: '/admin/auth/callback?state=' + state + '&code=mock',
      headers: { cookie: '__Host-qigong-admin-state=' + state }
    });
    expect(response.statusCode).toBe(302);
    const headers = response.headers['set-cookie'];
    if (!Array.isArray(headers)) throw new Error('Missing session cookies');
    const cookie = headers.map((h) => h.split(';')[0]!).join('; ');
    const csrf = cookie.match(/__Host-qigong-admin-csrf=([^;]+)/)?.[1];
    if (!csrf) throw new Error('Missing CSRF');
    return { cookie, csrf, location: response.headers.location! };
  };
  const get = (url: string, s: Session) => app.inject({ url, headers: { cookie: s.cookie } });
  const post = (url: string, s: Session, payload: Record<string, unknown>, csrf = true) =>
    app.inject({
      method: 'POST',
      url,
      headers: { cookie: s.cookie, ...(csrf ? { 'x-csrf-token': s.csrf } : {}) },
      payload
    });
  const grantVersion = async (grant: string) =>
    (
      await root.query<{ version: number }>(
        'SELECT p.access_grant_version version FROM admin.principals p JOIN admin.role_grants g ON g.principal_id=p.id WHERE g.id=$1',
        [grant]
      )
    ).rows[0]!.version;
  const request = async (s: Session, role = 'regional_admin') => {
    const status = (await get('/admin/access/status', s)).json<Status>();
    const submitted = await post('/admin/access/request', s, {
      version: status.version,
      role,
      scopeDescription: 'Region requested',
      reason: 'Applicant description'
    });
    expect(submitted.statusCode).toBe(200);
    return submitted.json<Status>();
  };
  beforeEach(async () => {
    if (!new URL(url!).pathname.toLowerCase().includes('test'))
      throw new Error('TEST_DATABASE_URL database name must contain test');
    maintenance = new pg.Client({ connectionString: url! });
    await maintenance.connect();
    databaseName = 'qigong_access_http_test_' + randomUUID().replaceAll('-', '');
    await maintenance.query(`CREATE DATABASE ${databaseName}`);
    const connection = new URL(url!);
    connection.pathname = '/' + databaseName;
    root = new pg.Pool({ connectionString: connection.href });
    await runMigrations(root, directory, 'vitest');
    loginRole = 'qigong_access_http_' + randomUUID().replaceAll('-', '');
    const password = randomBytes(24).toString('hex');
    await root.query(`CREATE ROLE ${loginRole} LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${password}'`);
    await root.query(`GRANT qigong_api_runtime TO ${loginRole}`);
    connection.username = loginRole;
    connection.password = password;
    runtime = new pg.Pool({ connectionString: connection.href });
    const principal = (
      await root.query<{ id: string }>(
        "INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name) VALUES('https://auth.example','root','Super admin') RETURNING id"
      )
    ).rows[0]!.id;
    await root.query(
      "INSERT INTO admin.role_grants(principal_id,role_id,scope_type,reason) SELECT $1,id,'global','test bootstrap' FROM admin.roles WHERE code='super_admin'",
      [principal]
    );
    const global = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(code,region_type,name_zh_tw,name_en) VALUES('http-global','global','全球','Global') RETURNING id"
      )
    ).rows[0]!.id;
    const country = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'http-country','country','國家','Country') RETURNING id",
        [global]
      )
    ).rows[0]!.id;
    region = (
      await root.query<{ id: string }>(
        "INSERT INTO core.regions(parent_region_id,code,region_type,name_zh_tw,name_en) VALUES($1,'http-region','operational','區域','Region') RETURNING id",
        [country]
      )
    ).rows[0]!.id;
    app = buildApp({ pool: runtime, adminAuth: provider, logger: false });
  });
  afterEach(async () => {
    await app?.close();
    await runtime?.end();
    if (loginRole) {
      await root.query(`DROP OWNED BY ${loginRole}`);
      await root.query(`DROP ROLE ${loginRole}`);
    }
    await root?.end();
    await maintenance?.query(`DROP DATABASE ${databaseName}`);
    await maintenance?.end();
  });
  it('routes new verified accounts to a private portal with no normal session or management access', async () => {
    const s = await signIn('candidate');
    expect(s.location).toBe('/admin/access');
    const page = await get('/admin/access?lang=en', s);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Administrator access request');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.body).not.toContain('onerror=alert');
    for (const path of [
      '/admin/auth/me',
      '/admin/api/reports/overview',
      '/admin/api/applications',
      '/admin/api/access/accounts'
    ])
      expect((await get(path, s)).statusCode).toBe(401);
    const status = (await get('/admin/access/status', s)).json<Status>();
    expect(
      (
        await root.query('SELECT * FROM admin.role_grants WHERE principal_id=$1', [
          status.principalId
        ])
      ).rows
    ).toEqual([]);
    expect(
      (
        await post(
          '/admin/access/request',
          s,
          { version: 1, role: 'coach_admin', scopeDescription: 'Cohort', reason: 'Please approve' },
          false
        )
      ).statusCode
    ).toBe(403);
    expect(
      (
        await post('/admin/access/request', s, {
          version: 1,
          role: 'super_admin',
          scopeDescription: 'Global',
          reason: 'Please approve'
        })
      ).statusCode
    ).toBe(400);
    expect(
      (
        await post('/admin/access/request', s, {
          version: 1,
          role: 'coach_admin',
          scopeDescription: 'Cohort',
          reason: 'Please approve',
          permissions: ['stats.read']
        })
      ).statusCode
    ).toBe(400);
    expect((await request(s)).status).toBe('pending');
  });
  it.each([
    'regional_admin',
    'regional_viewer',
    'global_viewer',
    'coach_admin',
    'master_admin'
  ] as const)(
    'lets super admins approve %s with the required scope; pending credentials never inherit roles',
    async (role) => {
      const pending = await signIn('candidate');
      const application = await request(pending, role);
      const admin = await signIn('root');
      const me = (await get('/admin/auth/me', admin)).json<{ canManageAdmins: boolean }>();
      expect(me.canManageAdmins).toBe(true);
      const home = await get('/admin/', admin);
      expect(home.body).toContain('/admin/administrators');
      const page = await get('/admin/administrators?lang=en', admin);
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('Administrators and access');
      const body = {
        version: application.version,
        decision: 'approved',
        role,
        ...(['regional_admin', 'regional_viewer'].includes(role) ? { regionId: region } : {}),
        reason: 'Identity and scope verified'
      };
      const endpoint = '/admin/api/access/accounts/' + application.principalId + '/decision';
      if (role === 'regional_viewer') {
        const invalid = { ...body };
        delete invalid.regionId;
        expect((await post(endpoint, admin, invalid)).statusCode).toBe(400);
      }
      expect((await post(endpoint, admin, body, false)).statusCode).toBe(403);
      const result = await post(endpoint, admin, body);
      expect(result.statusCode).toBe(200);
      expect((await post(endpoint, admin, body)).statusCode).toBe(409);
      expect((await get('/admin/access/status', pending)).json<Status>().status).toBe('approved');
      expect((await get('/admin/api/reports/overview', pending)).statusCode).toBe(401);
      const approved = await signIn('candidate');
      expect(approved.location).toBe('/admin/');
      expect((await get('/admin/api/reports/overview', approved)).statusCode).toBe(200);
      expect((await get('/admin/', approved)).body.includes('href="/admin/administrators')).toBe(
        role === 'master_admin'
      );
      expect(
        (await get('/admin/auth/me', approved)).json<{ canManageAdmins: boolean }>().canManageAdmins
      ).toBe(role === 'master_admin');
      expect((await get('/admin/administrators', approved)).statusCode).toBe(
        role === 'master_admin' ? 200 : 403
      );
      expect((await get('/admin/api/access/accounts', approved)).statusCode).toBe(
        role === 'master_admin' ? 200 : 403
      );
      if (role !== 'master_admin')
        expect(
          (
            await post(
              '/admin/api/access/accounts/' + application.principalId + '/grants',
              approved,
              { role: 'regional_admin', regionId: region, reason: 'Elevate' }
            )
          ).statusCode
        ).toBe(403);
      const record = (
        await root.query('SELECT * FROM admin.role_grants WHERE principal_id=$1', [
          application.principalId
        ])
      ).rows[0];
      expect(record).toMatchObject(
        ['regional_admin', 'regional_viewer'].includes(role)
          ? { scope_type: 'region', region_id: region, cohort_id: null }
          : { scope_type: 'global', region_id: null, cohort_id: null }
      );
      const grant = result.json<{ grantId: string }>().grantId;
      expect(
        (
          await post('/admin/api/access/grants/' + grant + '/revoke', admin, {
            version: await grantVersion(grant),
            reason: 'Term ended'
          })
        ).statusCode
      ).toBe(200);
      expect((await get('/admin/api/reports/overview', approved)).statusCode).toBe(401);
    }
  );
  it('allows master ordinary approvals but denies protected requests, grants, revocations and CSRF bypass', async () => {
    const masterPending = await signIn('master');
    const masterRequest = await request(masterPending, 'master_admin');
    const superSession = await signIn('root');
    expect(
      (
        await post(
          '/admin/api/access/accounts/' + masterRequest.principalId + '/decision',
          superSession,
          {
            version: masterRequest.version,
            decision: 'approved',
            role: 'master_admin',
            reason: 'Verified master'
          }
        )
      ).statusCode
    ).toBe(200);
    const master = await signIn('master');
    const candidate = await signIn('ordinary');
    const s = await request(candidate, 'coach_admin');
    const endpoint = '/admin/api/access/accounts/' + s.principalId + '/decision';
    const approval = {
      version: s.version,
      decision: 'approved',
      role: 'coach_admin',
      reason: 'Verified coach'
    };
    expect((await post(endpoint, master, approval, false)).statusCode).toBe(403);
    expect((await post(endpoint, master, { ...approval, role: 'master_admin' })).statusCode).toBe(
      403
    );
    const approved = await post(endpoint, master, approval);
    expect(approved.statusCode).toBe(200);
    expect((await post(endpoint, master, approval)).statusCode).toBe(409);
    const coach = await signIn('ordinary');
    expect((await get('/admin/api/access/accounts', coach)).statusCode).toBe(403);
    const list = (await get('/admin/api/access/accounts?status=all', master)).json<AccountList>();
    const rootAccount = list.entries.find((e) => e.subject === 'root')!;
    expect(
      (
        await post('/admin/api/access/accounts/' + rootAccount.principalId + '/grants', master, {
          role: 'global_viewer',
          reason: 'Forbidden'
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await post('/admin/api/access/grants/' + rootAccount.grants[0]!.id + '/revoke', master, {
          version: await grantVersion(rootAccount.grants[0]!.id),
          reason: 'Forbidden'
        })
      ).statusCode
    ).toBe(403);
    const anotherMaster = await signIn('another-master');
    const highRequest = await request(anotherMaster, 'master_admin');
    expect(
      (
        await post('/admin/api/access/accounts/' + highRequest.principalId + '/decision', master, {
          version: highRequest.version,
          decision: 'rejected',
          reason: 'Forbidden'
        })
      ).statusCode
    ).toBe(403);
    expect(
      (
        await post(
          '/admin/api/access/grants/' + approved.json<{ grantId: string }>().grantId + '/revoke',
          master,
          {
            version: await grantVersion(approved.json<{ grantId: string }>().grantId),
            reason: 'Term ended'
          }
        )
      ).statusCode
    ).toBe(200);
    expect((await get('/admin/auth/me', coach)).statusCode).toBe(401);
    const superList = (
      await get('/admin/api/access/accounts?status=all', superSession)
    ).json<AccountList>();
    const masterGrant = superList.entries.find((e) => e.principalId === masterRequest.principalId)!
      .grants[0]!.id;
    expect(
      (
        await post('/admin/api/access/grants/' + masterGrant + '/revoke', superSession, {
          version: await grantVersion(masterGrant),
          reason: 'Master term ended'
        })
      ).statusCode
    ).toBe(200);
    expect((await get('/admin/api/access/accounts', master)).statusCode).toBe(401);
  });
  it('lists authorized accounts, atomically edits with CSRF/version checks, and removes all access without deleting identity', async () => {
    const pending = await signIn('candidate');
    const s = await request(pending);
    const admin = await signIn('root');
    expect(
      (
        await post('/admin/api/access/accounts/' + s.principalId + '/decision', admin, {
          version: s.version,
          decision: 'approved',
          role: 'regional_admin',
          regionId: region,
          reason: 'Verified region'
        })
      ).statusCode
    ).toBe(200);
    const candidate = await signIn('candidate');
    const list = (
      await get('/admin/api/access/accounts?status=authorized', admin)
    ).json<AccountList>();
    const account = list.entries.find((e) => e.principalId === s.principalId)!;
    expect(list.entries.map((e) => e.subject).sort()).toEqual(['candidate', 'root']);
    expect(account.canRevokeAll).toBe(true);
    const endpoint = '/admin/api/access/grants/' + account.grants[0]!.id + '/edit';
    const edit = {
      version: account.grantVersion,
      role: 'coach_admin',
      reason: 'Coach responsibilities verified'
    };
    expect((await post(endpoint, admin, edit, false)).statusCode).toBe(403);
    expect((await post(endpoint, candidate, edit)).statusCode).toBe(403);
    expect(
      (await post(endpoint, admin, { ...edit, permissions: ['privacy.delete'] })).statusCode
    ).toBe(400);
    expect(
      (await post(endpoint, admin, { ...edit, role: 'regional_admin', regionId: randomUUID() }))
        .statusCode
    ).toBe(400);
    expect((await get('/admin/auth/me', candidate)).statusCode).toBe(200);
    expect((await post(endpoint, admin, edit)).statusCode).toBe(200);
    expect((await post(endpoint, admin, edit)).statusCode).toBe(409);
    expect((await get('/admin/auth/me', candidate)).statusCode).toBe(401);
    const updated = (await get('/admin/api/access/accounts?status=authorized', admin))
      .json<AccountList>()
      .entries.find((e) => e.principalId === s.principalId)!;
    const remove = '/admin/api/access/accounts/' + s.principalId + '/revoke-all';
    expect(
      (await post(remove, admin, { version: account.grantVersion, reason: 'Stale' })).statusCode
    ).toBe(409);
    expect((await post(remove, admin, { reason: 'Missing version' })).statusCode).toBe(400);
    expect(
      (await post(remove, admin, { version: updated.grantVersion, reason: 'Term ended' }, false))
        .statusCode
    ).toBe(403);
    expect(
      (await post(remove, admin, { version: updated.grantVersion, reason: 'Term ended' })).json()
    ).toEqual({ ok: true, revokedCount: 1 });
    expect(
      (await get('/admin/api/access/accounts?status=authorized', admin))
        .json<AccountList>()
        .entries.map((e) => e.subject)
    ).toEqual(['root']);
    expect(
      (
        await root.query('SELECT oidc_subject,status FROM admin.principals WHERE id=$1', [
          s.principalId
        ])
      ).rows[0]
    ).toEqual({ oidc_subject: 'candidate', status: 'active' });
    const rootAccount = list.entries.find((e) => e.subject === 'root')!;
    expect(
      (
        await post('/admin/api/access/accounts/' + rootAccount.principalId + '/revoke-all', admin, {
          version: rootAccount.grantVersion,
          reason: 'Self removal'
        })
      ).statusCode
    ).toBe(403);
  });
  it('adds scoped roles only after approval, rejects duplicate grants, and invalidates existing sessions', async () => {
    const pending = await signIn('candidate');
    const s = await request(pending);
    const admin = await signIn('root');
    await post('/admin/api/access/accounts/' + s.principalId + '/decision', admin, {
      version: s.version,
      decision: 'approved',
      role: 'regional_admin',
      regionId: region,
      reason: 'Verified'
    });
    const approved = await signIn('candidate');
    const endpoint = '/admin/api/access/accounts/' + s.principalId + '/grants';
    const body = { role: 'coach_admin', reason: 'Global coaching assignment verified' };
    expect((await post(endpoint, admin, body)).statusCode).toBe(200);
    expect((await post(endpoint, admin, body)).statusCode).toBe(409);
    expect((await get('/admin/auth/me', approved)).statusCode).toBe(401);
    const renewed = await signIn('candidate');
    expect((await get('/admin/auth/me', renewed)).statusCode).toBe(200);
    const list = (await get('/admin/api/access/accounts?status=all', admin)).json<AccountList>();
    expect(
      list.entries
        .find((e) => e.principalId === s.principalId)
        ?.grants.map((g) => g.role)
        .sort()
    ).toEqual(['coach_admin', 'regional_admin']);
    expect((await get('/admin/applications', admin)).body).toContain('href="/admin/administrators');
  });
  it('rejects applications and permits explicit resubmission without silently granting roles', async () => {
    const p = await signIn('candidate');
    const s = await request(p);
    const admin = await signIn('root');
    expect(
      (
        await post('/admin/api/access/accounts/' + s.principalId + '/decision', admin, {
          version: s.version,
          decision: 'rejected',
          reason: 'Need confirmation'
        })
      ).statusCode
    ).toBe(200);
    const rejected = (await get('/admin/access/status', p)).json<Status>();
    expect(rejected.status).toBe('rejected');
    expect((await request(p, 'coach_admin')).status).toBe('pending');
    expect((await post('/admin/auth/logout', p, {})).statusCode).toBe(200);
    expect((await get('/admin/access/status', p)).statusCode).toBe(401);
  });
  it('keeps separate subjects with equal verified emails and denies stale or suspended sessions', async () => {
    const a = await signIn('candidate-a');
    const b = await signIn('candidate-b');
    const first = (await get('/admin/access/status', a)).json<Status>();
    const second = (await get('/admin/access/status', b)).json<Status>();
    expect(first.principalId).not.toBe(second.principalId);
    await root.query("UPDATE admin.principals SET status='suspended' WHERE id=$1", [
      first.principalId
    ]);
    expect((await get('/admin/access/status', a)).statusCode).toBe(401);
    await root.query(
      'UPDATE admin.access_sessions SET expires_at=CURRENT_TIMESTAMP WHERE principal_id=$1',
      [second.principalId]
    );
    expect((await get('/admin/access/status', b)).statusCode).toBe(401);
    const admin = await signIn('root');
    const list = (await get('/admin/api/access/accounts?status=all', admin)).json<AccountList>();
    expect(list.entries.filter((e) => e.subject.startsWith('candidate'))).toHaveLength(2);
  });
});
