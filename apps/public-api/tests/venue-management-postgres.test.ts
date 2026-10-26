/** Developed with ❤️ by Bean, Bird & Badminton Tech Consulting */
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
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
suite('venue management isolated PostgreSQL: base 0051 + 0053 (no invented 0052)', () => {
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
    expect(migrations.applied).not.toContainEqual(expect.stringMatching(/^0052/));
    expect(migrations.applied).toHaveLength(52);
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
