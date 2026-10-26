/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import Fastify, { type FastifyRequest } from 'fastify';
import { registerVenueManagementRoutes } from '../src/venue-management-routes.js';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, withRequestContext } from '@qigong/database';
import {
  lookupManagedVenue,
  runVenueManagement,
  type VenueManagementField
} from '../src/venue-management.js';
const root = process.env.VENUE_MANAGEMENT_ISOLATED_PG_DIR;
const suite = root ? describe : describe.skip;
suite('venue management isolated PostgreSQL: integrated migration chain', () => {
  let owner: pg.Pool;
  let runtime: pg.Pool;
  let tw: string;
  let sg: string;
  const session = 'm'.repeat(43);
  const execute = (input: unknown, credential = session) =>
    runVenueManagement(runtime, randomUUID(), credential, input);
  const field = (code = 'tw-managed-one'): VenueManagementField => ({
    region_id: tw,
    code,
    name_zh_tw: '<img src=x onerror=alert(1)>',
    name_en: null,
    address: 'Synthetic address',
    latitude: 25,
    longitude: 121,
    radius_meters: 100,
    timezone: 'Asia/Taipei',
    active_time_rules: {
      day_of_week: [0, 1, 2, 3, 4, 5, 6],
      start_time: '00:00',
      end_time: '24:00'
    },
    is_active: true
  });
  const create = async (value = field()) => {
    const result = await execute({
      action: 'create',
      regionId: value.region_id,
      field: value,
      reason: 'synthetic create'
    });
    if (!('field' in result)) throw new Error('missing field');
    return result.field;
  };
  beforeAll(async () => {
    if (!root || !/^\/tmp\/venue-management-[A-Za-z0-9]+$/.test(root))
      throw new Error('isolated root required');
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await readFile(root + '/venue-management-marker', 'utf8')).trim()).toBe(root);
    const options = { host: root + '/socket', port: 55478, database: 'postgres' };
    owner = new pg.Pool({ ...options, user: 'venue_management_owner' });
    const migrations = await runMigrations(
      owner,
      resolve(process.cwd(), '../../migrations'),
      'synthetic-venue-management'
    );
    expect(migrations.applied).toContain('0053_venue_management.sql');
    expect(migrations.applied).toContain('0052_venue_personal_history.sql');
    expect(migrations.applied).toHaveLength(53);
    const visibleMigrations = (await readdir(resolve(process.cwd(), '../../migrations')))
      .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
      .sort();
    expect(migrations.applied).toEqual(visibleMigrations);
    expect(
      (await runMigrations(owner, resolve(process.cwd(), '../../migrations'))).applied
    ).toEqual([]);
    await owner.query(
      await readFile(new URL('./fixtures/venue-qr-synthetic.sql', import.meta.url), 'utf8')
    );
    await owner.query(`INSERT INTO admin.roles(code,description) VALUES('venue_manage_test','Synthetic manager');
      INSERT INTO admin.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM admin.roles r CROSS JOIN admin.permissions p WHERE r.code='venue_manage_test' AND p.code='venue_attendance.field.manage';
      INSERT INTO admin.principals(id,oidc_issuer,oidc_subject,display_name) VALUES('10000000-0000-4000-8000-000000000003','https://synthetic.invalid','manager','Synthetic manager');
      INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,reason) SELECT '10000000-0000-4000-8000-000000000003',r.id,'region',g.id,'Synthetic only' FROM admin.roles r CROSS JOIN core.regions g WHERE r.code='venue_manage_test' AND g.code='tw-general';
      INSERT INTO admin.sessions(token_hash,principal_id,expires_at) VALUES(public.digest(repeat('m',43),'sha256'),'10000000-0000-4000-8000-000000000003',clock_timestamp()+interval '1 day');`);
    runtime = new pg.Pool({ ...options, user: 'venue_qr_test_login' });
    const regions = await owner.query<{ id: string; code: string }>(
      "SELECT id,code FROM core.regions WHERE code IN ('tw-general','sg-general')"
    );
    tw = regions.rows.find((r) => r.code === 'tw-general')!.id;
    sg = regions.rows.find((r) => r.code === 'sg-general')!.id;
  }, 120000);
  afterAll(async () => {
    await runtime?.end();
    await owner?.end();
  });
  it('nonowner NOLOGIN/noBYPASSRLS isolated roles, no memberships/runtime table grants, keeps attendance vetoes', async () => {
    const roles = await owner.query(
      "SELECT rolname,rolsuper,rolcanlogin,rolbypassrls FROM pg_roles WHERE rolname IN ('qigong_venue_manager','qigong_venue_config_guard')"
    );
    expect(roles.rows).toHaveLength(2);
    for (const role of roles.rows)
      expect(role).toMatchObject({ rolsuper: false, rolcanlogin: false, rolbypassrls: false });
    expect(
      (
        await owner.query(
          "SELECT 1 FROM pg_auth_members WHERE roleid IN (SELECT oid FROM pg_roles WHERE rolname IN ('qigong_venue_manager','qigong_venue_config_guard')) OR member IN (SELECT oid FROM pg_roles WHERE rolname IN ('qigong_venue_manager','qigong_venue_config_guard'))"
        )
      ).rowCount
    ).toBe(0);
    const tables = await owner.query(
      "SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) owner FROM pg_class WHERE oid IN ('core.practice_fields'::regclass,'core.field_attendance'::regclass)"
    );
    for (const t of tables.rows) {
      expect(t).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
      expect(t.owner).not.toMatch(/qigong_venue/);
    }
    await expect(
      withRequestContext(runtime, 'qigong_api_runtime', { requestId: randomUUID() }, (c) =>
        c.query('SELECT * FROM core.practice_fields')
      )
    ).rejects.toMatchObject({ code: '42501' });
    const policies = await owner.query(
      "SELECT policyname,qual,with_check FROM pg_policies WHERE policyname IN ('venue_attendance_no_update','venue_attendance_no_delete','venue_fields_no_delete')"
    );
    expect(policies.rows).toHaveLength(3);
    for (const p of policies.rows) expect(p.qual).toBe('false');
  });
  it('real create/read/update, stable UUID/code, duplicate and inactive code cannot be reused, audit versions', async () => {
    const row = await create();
    expect(row.version).toBe(1);
    expect(row.name_zh_tw).toBe(field().name_zh_tw);
    await expect(create()).rejects.toMatchObject({ code: '23505' });
    const changed = { ...field(), name_zh_tw: 'Renamed', is_active: false, latitude: 24 };
    const saved = await execute({
      action: 'update',
      regionId: tw,
      id: row.id,
      version: 1,
      field: changed,
      reason: 'explicit location change'
    });
    expect(saved).toMatchObject({
      field: { id: row.id, code: row.code, version: 2, is_active: false }
    });
    expect(await lookupManagedVenue(runtime, randomUUID(), row.code)).toEqual({
      code: row.code,
      name: 'Renamed',
      active: false
    });
    await expect(create()).rejects.toMatchObject({ code: '23505' });
    await expect(
      execute({
        action: 'update',
        regionId: tw,
        id: row.id,
        version: 2,
        field: { ...changed, code: 'tw-new-code' },
        reason: 'not allowed'
      })
    ).rejects.toMatchObject({ code: '22023' });
    const audit = await owner.query(
      "SELECT metadata FROM audit.events WHERE action='venue.management.update' AND target_id=$1",
      [row.id]
    );
    expect(audit.rows[0].metadata).toMatchObject({
      reason: 'explicit location change',
      before: { version: 1, latitude: 25 },
      after: { version: 2, latitude: 24 }
    });
    await expect(
      owner.query('DELETE FROM core.practice_fields WHERE id=$1', [row.id])
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      owner.query('UPDATE core.practice_fields SET id=gen_random_uuid() WHERE id=$1', [row.id])
    ).rejects.toMatchObject({ code: '22023' });
  });
  it('existing regional viewer reads but cannot create/manage; source and target scope cannot be forged', async () => {
    expect(await execute({ action: 'capabilities', regionId: tw }, 'v'.repeat(43))).toEqual({
      canRead: true,
      canManage: false
    });
    expect(await execute({ action: 'list', regionId: tw }, 'v'.repeat(43))).toHaveProperty(
      'fields'
    );
    await expect(
      execute(
        { action: 'create', regionId: tw, field: field('tw-view-denied'), reason: 'denied' },
        'v'.repeat(43)
      )
    ).rejects.toMatchObject({ code: '42501' });
    await expect(execute({ action: 'list', regionId: sg })).rejects.toMatchObject({
      code: '42501'
    });
    const row = await create(field('tw-scope-test'));
    await expect(
      execute({
        action: 'update',
        regionId: tw,
        id: row.id,
        version: 1,
        field: { ...field('tw-scope-test'), region_id: sg },
        reason: 'target denied'
      })
    ).rejects.toMatchObject({ code: '42501' });
    await expect(execute({ action: 'get', regionId: sg, id: row.id })).rejects.toMatchObject({
      code: '42501'
    });
    await expect(
      withRequestContext(
        runtime,
        'qigong_api_runtime',
        { requestId: randomUUID(), principalId: '10000000-0000-4000-8000-000000000003' },
        (c) =>
          c.query("SELECT admin.venue_management('forged','list',$1,NULL,NULL,NULL,NULL)", [tw])
      )
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('one of two concurrent versions wins, the loser receives explicit conflict', async () => {
    const row = await create(field('tw-concurrent-test'));
    const result = await Promise.allSettled(
      [1, 2].map((n) =>
        execute({
          action: 'update',
          regionId: tw,
          id: row.id,
          version: 1,
          field: { ...field(row.code), name_zh_tw: 'Version ' + n },
          reason: 'concurrent synthetic edit'
        })
      )
    );
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(result.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: '40001' }
    });
  });
  it('preserves attendance; freezes used region/timezone even when caller has both scopes', async () => {
    const row = await create(field('tw-used-test'));
    await owner.query(
      `INSERT INTO core.field_attendance(person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone) VALUES('20000000-0000-4000-8000-000000000001',$1,'qr_gps',clock_timestamp(),(clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date,'Asia/Taipei')`,
      [row.id]
    );
    const before = (
      await owner.query('SELECT * FROM core.field_attendance WHERE field_id=$1', [row.id])
    ).rows;
    await expect(
      execute({
        action: 'update',
        regionId: tw,
        id: row.id,
        version: 1,
        field: { ...field(row.code), timezone: 'UTC' },
        reason: 'forbidden timezone'
      })
    ).rejects.toMatchObject({ code: '40001' });
    await owner.query(
      `INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,reason) SELECT '10000000-0000-4000-8000-000000000003',r.id,'region',$1,'Synthetic target grant' FROM admin.roles r WHERE r.code='venue_manage_test'`,
      [sg]
    );
    await expect(
      execute({
        action: 'update',
        regionId: tw,
        id: row.id,
        version: 1,
        field: { ...field(row.code), region_id: sg },
        reason: 'forbidden move after use'
      })
    ).rejects.toMatchObject({ code: '40001' });
    await execute({
      action: 'update',
      regionId: tw,
      id: row.id,
      version: 1,
      field: { ...field(row.code), is_active: false },
      reason: 'retire without deleting attendance'
    });
    expect(
      (await owner.query('SELECT * FROM core.field_attendance WHERE field_id=$1', [row.id])).rows
    ).toEqual(before);
    await expect(
      owner.query(
        `INSERT INTO core.field_attendance(person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone) VALUES('20000000-0000-4000-8000-000000000001',$1,'qr_gps',clock_timestamp(),CURRENT_DATE,'UTC')`,
        [row.id]
      )
    ).rejects.toMatchObject({ code: '40001' });
  });
  it('HTTP CRUD enforces credential/CSRF/origin/scope and returns real stable URLs', async () => {
    const origin = 'https://venue.example.invalid';
    const csrf = 'c'.repeat(43);
    const cookie = `__Host-qigong-admin=${session}; __Host-qigong-admin-csrf=${csrf}`;
    const privateCookie = (request: FastifyRequest, name: string) => {
      const parts = (request.headers.cookie ?? '')
        .split(';')
        .map((v) => v.trim())
        .filter((v) => v.startsWith(name + '='));
      return parts.length === 1 ? parts[0]!.slice(name.length + 1) : null;
    };
    const app = Fastify({ genReqId: () => randomUUID() });
    registerVenueManagementRoutes(app, runtime, {
      enabled: true,
      publicOrigin: origin,
      principalFor: async () => '10000000-0000-4000-8000-000000000003',
      sessionFor: (request) => privateCookie(request, '__Host-qigong-admin'),
      validCsrf: (request) => {
        const saved = privateCookie(request, '__Host-qigong-admin-csrf');
        const sent = request.headers['x-csrf-token'];
        return (
          typeof sent === 'string' &&
          !!saved &&
          saved.length === 43 &&
          sent.length === 43 &&
          timingSafeEqual(Buffer.from(saved), Buffer.from(sent))
        );
      }
    });
    const call = (action: string, payload: object, customHeaders: Record<string, string> = {}) =>
      app.inject({
        method: 'POST',
        url: '/admin/api/venue-management/' + action,
        headers: { origin, cookie, 'x-csrf-token': csrf, ...customHeaders },
        payload
      });
    try {
      const value = field('tw-http-test');
      const createPayload = { regionId: tw, field: value, reason: 'HTTP synthetic create' };
      for (const headers of [
        { 'x-csrf-token': 'wrong' },
        { origin: 'https://evil.invalid' },
        { cookie: cookie + '; __Host-qigong-admin-csrf=' + csrf }
      ])
        expect((await call('create', createPayload, headers)).statusCode).toBe(403);
      expect(
        (
          await call('create', createPayload, {
            cookie: cookie + '; __Host-qigong-admin=' + session
          })
        ).statusCode
      ).toBe(401);
      expect(
        (await owner.query("SELECT 1 FROM core.practice_fields WHERE code='tw-http-test'")).rowCount
      ).toBe(0);
      const created = await call('create', createPayload);
      expect(created.statusCode).toBe(201);
      const saved = created.json<{
        field: { id: string; version: number; urls: { nfc: string; qr: string; link: string } };
      }>().field;
      expect(saved.version).toBe(1);
      expect(saved.urls.nfc).toBe(origin + '/venue-checkin?venue=tw-http-test&source=nfc');
      expect((await call('create', createPayload)).statusCode).toBe(409);
      const update = {
        regionId: tw,
        id: saved.id,
        version: 1,
        field: { ...value, name_zh_tw: 'Renamed via HTTP', is_active: false },
        reason: 'HTTP retirement audit'
      };
      expect((await call('update', update)).statusCode).toBe(200);
      expect((await call('update', update)).statusCode).toBe(409);
      expect((await call('get', { regionId: tw, id: saved.id })).json()).toMatchObject({
        field: { id: saved.id, version: 2, is_active: false, urls: saved.urls }
      });
      expect((await lookupManagedVenue(runtime, randomUUID(), value.code))?.active).toBe(false);
      expect(
        (
          await call('update', {
            ...update,
            field: { ...update.field, region_id: randomUUID() },
            version: 2
          })
        ).statusCode
      ).toBe(403);
      expect((await call('get', { regionId: sg, id: saved.id })).statusCode).toBe(404);
      expect(
        (
          await call(
            'create',
            { ...createPayload, field: field('tw-http-view-denied') },
            { cookie: cookie.replace(session, 'v'.repeat(43)) }
          )
        ).statusCode
      ).toBe(403);
      expect(
        (await call('list', { regionId: tw, principalId: '10000000-0000-4000-8000-000000000003' }))
          .statusCode
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: '/admin/api/venue-management/' + saved.id,
            headers: { origin, cookie, 'x-csrf-token': csrf }
          })
        ).statusCode
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it.each(['session-expiry', 'grant-expiry'] as const)(
    'rechecks %s by wall clock after lock waits',
    async (kind) => {
      const row = await create(field('tw-lock-' + kind));
      const blocker = await owner.connect();
      let result: Promise<unknown> | undefined;
      try {
        await blocker.query('BEGIN');
        await blocker.query(
          "SELECT pg_advisory_xact_lock(hashtextextended('venue-config:'||$1::text,0))",
          [row.id]
        );
        result = execute({
          action: 'update',
          regionId: tw,
          id: row.id,
          version: 1,
          field: { ...field(row.code), name_zh_tw: 'Should not save' },
          reason: 'blocked synthetic request'
        }).then(
          (data) => data,
          (error) => error as unknown
        );
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const locks = await owner.query(
            "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted"
          );
          if (locks.rowCount) {
            waiting = true;
            break;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
        }
        expect(waiting).toBe(true);
        if (kind === 'session-expiry')
          await owner.query(
            "UPDATE admin.sessions SET expires_at=clock_timestamp() WHERE token_hash=public.digest(repeat('m',43),'sha256')"
          );
        else
          await owner.query(
            "UPDATE admin.role_grants SET valid_to=clock_timestamp() WHERE principal_id='10000000-0000-4000-8000-000000000003'"
          );
        await blocker.query('ROLLBACK');
        expect(await result).toMatchObject({ code: '42501' });
        expect(
          (await owner.query('SELECT version FROM core.practice_fields WHERE id=$1', [row.id]))
            .rows[0].version
        ).toBe(1);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        await result;
        await owner.query(
          "UPDATE admin.sessions SET expires_at=clock_timestamp()+interval '1 day' WHERE token_hash=public.digest(repeat('m',43),'sha256'); UPDATE admin.role_grants SET valid_to=NULL WHERE principal_id='10000000-0000-4000-8000-000000000003'"
        );
      }
    }
  );
  it('serializes the first attendance against a concurrent timezone edit without losing attendance', async () => {
    const row = await create(field('tw-first-attendance-race'));
    const recorder = await owner.connect();
    let attempted: Promise<unknown> | undefined;
    try {
      await recorder.query('BEGIN');
      await recorder.query(
        `INSERT INTO core.field_attendance(person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone) VALUES('20000000-0000-4000-8000-000000000001',$1,'qr_gps',clock_timestamp(),(clock_timestamp() AT TIME ZONE 'Asia/Taipei')::date,'Asia/Taipei')`,
        [row.id]
      );
      attempted = execute({
        action: 'update',
        regionId: tw,
        id: row.id,
        version: 1,
        field: { ...field(row.code), timezone: 'UTC' },
        reason: 'concurrent first attendance'
      }).then(
        (data) => data,
        (error) => error as unknown
      );
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          (await owner.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted"))
            .rowCount
        ) {
          waiting = true;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      expect(waiting).toBe(true);
      await recorder.query('COMMIT');
      expect(await attempted).toMatchObject({ code: '40001' });
      expect(
        (
          await owner.query('SELECT timezone,version FROM core.practice_fields WHERE id=$1', [
            row.id
          ])
        ).rows[0]
      ).toEqual({ timezone: 'Asia/Taipei', version: 1 });
      expect(
        (await owner.query('SELECT 1 FROM core.field_attendance WHERE field_id=$1', [row.id]))
          .rowCount
      ).toBe(1);
    } finally {
      await recorder.query('ROLLBACK');
      recorder.release();
      await attempted;
    }
  });
  it('0051 QR writer remains functional after management policies and triggers', async () => {
    const result = await withRequestContext(
      runtime,
      'qigong_api_runtime',
      { requestId: randomUUID() },
      (c) =>
        c.query<{ data: { ok: boolean } }>(
          "SELECT platform.venue_qr_checkin('Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','tw-test-one',25,121) data"
        )
    );
    expect(result.rows[0]?.data.ok).toBe(true);
    expect(
      (
        await owner.query(
          "SELECT 1 FROM core.field_attendance a JOIN core.practice_fields f ON f.id=a.field_id WHERE f.code='tw-test-one'"
        )
      ).rowCount
    ).toBe(1);
  });
  it('allows unused cross-region move only with both scopes; revocation is checked each operation', async () => {
    const row = await create(field('tw-unused-test'));
    expect(
      await execute({
        action: 'update',
        regionId: tw,
        id: row.id,
        version: 1,
        field: { ...field(row.code), region_id: sg, timezone: 'Asia/Singapore' },
        reason: 'approved synthetic move'
      })
    ).toMatchObject({ field: { region_id: sg, version: 2 } });
    await owner.query(
      "UPDATE admin.sessions SET revoked_at=clock_timestamp() WHERE token_hash=public.digest(repeat('m',43),'sha256')"
    );
    await expect(execute({ action: 'list', regionId: tw })).rejects.toThrow('unauthenticated');
  });
});
