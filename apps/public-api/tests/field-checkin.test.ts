/**
 * Unit and Route Tests for Practice Field & NFC Check-in Engine
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import {
  calculateDistanceMeters,
  isWithinFieldGeofence,
  isFieldCheckinTimeWindowValid,
  getActivePracticeFields,
  processFieldCheckin,
  type FieldCheckinInput
} from '../src/field-checkin-service.js';
import {
  registerFieldCheckinRoutes,
  mapCheckinErrorStatus,
  fieldCheckinSchema
} from '../src/field-checkin-routes.js';
import { buildApp } from '../src/app.js';
import type { Pool } from '@qigong/database';
import {
  nfcMigrationVersion,
  nfcQuarantineMigrationVersion,
  checkNfcFeatureReadiness,
  registerAdminRoutes,
  type AdminAuthProvider
} from '../src/admin-auth.js';

beforeEach(() => {
  vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('External API calls are forbidden in these isolated tests');
    })
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const createNfcLedgerClient = (version: string | null = nfcMigrationVersion) => ({
  query: vi.fn(async (sql: string) => {
    if (/core\.(practice_fields|field_attendance)|pg_index/.test(sql)) {
      throw new Error('NFC relation and index probes are forbidden');
    }
    if (sql.includes('schema_migrations')) return { rows: version ? [{ version }] : [] };
    return { rows: [] };
  }),
  release: vi.fn()
});

const adminProvider: AdminAuthProvider = {
  callbackUrl: 'https://example.test/admin/auth/callback',
  begin: vi.fn(async () => new URL('https://example.test/login')),
  complete: vi.fn(async () => ({ iss: 'https://example.test', sub: 'admin' }))
};

const gatedApp = (kind: 'buildApp' | 'registerAdminRoutes', pool: Pool) => {
  if (kind === 'buildApp') return buildApp({ pool, adminAuth: adminProvider, logger: false });
  const app = Fastify({ genReqId: () => randomUUID() });
  registerAdminRoutes(app, pool, adminProvider);
  return app;
};

const nfcRoutes = [
  { method: 'GET', url: '/api/v1/fields/active' },
  { method: 'POST', url: '/api/v1/field-checkin' },
  { method: 'GET', url: '/admin/api/fields/capabilities' },
  { method: 'GET', url: '/admin/api/fields' },
  { method: 'GET', url: '/admin/api/fields/:id' },
  { method: 'POST', url: '/admin/api/fields' },
  { method: 'PUT', url: '/admin/api/fields/:id' },
  { method: 'PATCH', url: '/admin/api/fields/:id' },
  { method: 'GET', url: '/admin/fields' },
  { method: 'GET', url: '/admin/api/attendance/capabilities' },
  { method: 'GET', url: '/admin/api/attendance' },
  { method: 'GET', url: '/admin/attendance' },
  { method: 'GET', url: '/admin/attendance/export.csv' }
] as const;

describe.each(['buildApp', 'registerAdminRoutes'] as const)('NFC isolation via %s', (kind) => {
  it.each([undefined, 'false', '1', 'TRUE', 'yes'])('does not opt in with %s', async (setting) => {
    vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', setting);
    const pool = { query: vi.fn(), connect: vi.fn() } as unknown as Pool;
    const app = gatedApp(kind, pool);
    await app.ready();
    for (const route of nfcRoutes) {
      expect(app.hasRoute(route)).toBe(false);
      const response = await app.inject(route);
      expect(response.statusCode).toBe(404);
    }
    expect((await app.inject('/admin/auth/me')).statusCode).toBe(401);
    if (kind === 'buildApp') expect((await app.inject('/health/live')).statusCode).toBe(200);
    expect(Reflect.get(pool, 'query')).not.toHaveBeenCalled();
    expect(Reflect.get(pool, 'connect')).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    [null, 'nfc_schema_not_ready'],
    ['0046_achievement_evaluation_and_readers.sql', 'nfc_schema_not_ready'],
    [nfcMigrationVersion, 'nfc_authorization_unavailable'],
    [nfcQuarantineMigrationVersion, 'nfc_security_quarantined'],
    ['0048_future.sql', 'nfc_schema_not_ready'],
    ['0049_future.sql', 'nfc_schema_not_ready'],
    ['0050_venue_attendance_security_contract.sql', 'nfc_schema_not_ready']
  ] as const)('refuses explicit opt-in on %s with %s', async (version, reason) => {
    vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', 'true');
    const client = createNfcLedgerClient(version);
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) } as unknown as Pool;
    const app = gatedApp(kind, pool);
    try {
      await expect(app.ready()).rejects.toThrow(reason);
      for (const route of nfcRoutes) expect(app.hasRoute(route)).toBe(false);
      expect(Reflect.get(pool, 'query')).not.toHaveBeenCalled();
      expect(client.query).toHaveBeenCalledWith('SET LOCAL ROLE qigong_api_runtime');
      expect(client.query).toHaveBeenCalledWith(
        'SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1'
      );
      for (const [sql] of client.query.mock.calls) {
        expect(sql).not.toMatch(/core\.(practice_fields|field_attendance)|pg_index/);
      }
      expect(client.release).toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('fails closed when the migration ledger is inaccessible without trying NFC tables', async () => {
    vi.stubEnv('NFC_FIELD_CHECKIN_ENABLED', 'true');
    const client = createNfcLedgerClient();
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('schema_migrations')) throw new Error('ledger unavailable');
      return { rows: [] };
    });
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) } as unknown as Pool;
    const app = gatedApp(kind, pool);
    try {
      await expect(app.ready()).rejects.toThrow('nfc_schema_not_ready');
      for (const route of nfcRoutes) expect(app.hasRoute(route)).toBe(false);
      for (const [sql] of client.query.mock.calls) {
        expect(sql).not.toMatch(/core\.(practice_fields|field_attendance)|pg_index/);
      }
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalled();
      expect(Reflect.get(pool, 'query')).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    '0046_achievement_evaluation_and_readers.sql',
    nfcMigrationVersion,
    nfcQuarantineMigrationVersion
  ])('keeps existing admin routes and hides NFC navigation while off on %s', async (version) => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('schema_migrations')) return { rows: [{ version }] };
        if (sql.includes('admin.session_principal'))
          return { rows: [{ principal_id: randomUUID() }] };
        return { rows: [{ allowed: true }] };
      }),
      release: vi.fn()
    };
    const pool = { query: vi.fn(), connect: vi.fn(async () => client) } as unknown as Pool;
    const app = gatedApp(kind, pool);
    const response = await app.inject({
      url: '/admin/',
      headers: { cookie: '__Host-qigong-admin=test' }
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('href="/admin/fields');
    expect(response.body).not.toContain('href="/admin/attendance');
    expect(response.body).toContain('href="/admin/leaderboard');
    expect(response.body).toContain('href="/admin/applications');
    for (const route of nfcRoutes) {
      expect(app.hasRoute(route)).toBe(false);
      expect((await app.inject(route)).statusCode).toBe(404);
    }
    for (const [sql] of client.query.mock.calls) {
      expect(sql).not.toMatch(/core\.(practice_fields|field_attendance)|pg_index/);
    }
    expect(fetch).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('Haversine Distance & Geofencing Calculation', () => {
  const TAIPEI_101 = { lat: 25.033961, lon: 121.564472 };
  const DAAN_PARK = { lat: 25.029659, lon: 121.536284 };

  it('calculates 0 meters between identical coordinates', () => {
    const distance = calculateDistanceMeters(
      TAIPEI_101.lat,
      TAIPEI_101.lon,
      TAIPEI_101.lat,
      TAIPEI_101.lon
    );
    expect(distance).toBe(0);
  });

  it('calculates accurate distance between known Taipei landmarks (~2.88 km)', () => {
    const distance = calculateDistanceMeters(
      TAIPEI_101.lat,
      TAIPEI_101.lon,
      DAAN_PARK.lat,
      DAAN_PARK.lon
    );
    // Taipei 101 to Daan Forest park is approx 2880m
    expect(distance).toBeGreaterThan(2850);
    expect(distance).toBeLessThan(2910);
  });

  it('is strictly symmetric (distance A->B equals distance B->A)', () => {
    const d1 = calculateDistanceMeters(
      TAIPEI_101.lat,
      TAIPEI_101.lon,
      DAAN_PARK.lat,
      DAAN_PARK.lon
    );
    const d2 = calculateDistanceMeters(
      DAAN_PARK.lat,
      DAAN_PARK.lon,
      TAIPEI_101.lat,
      TAIPEI_101.lon
    );
    expect(d1).toBe(d2);
  });

  it('verifies whether coordinates fall within a practice field geofence radius', () => {
    const centerLat = 25.03;
    const centerLon = 121.536;
    const radiusMeters = 50;

    // Point approx 20 meters north (1 deg lat ≈ 111,139m, so 0.00018 deg ≈ 20m)
    const insideLat = 25.03018;
    const insideLon = 121.536;
    expect(isWithinFieldGeofence(insideLat, insideLon, centerLat, centerLon, radiusMeters)).toBe(
      true
    );

    // Point approx 100 meters north (0.00090 deg ≈ 100m)
    const outsideLat = 25.0309;
    const outsideLon = 121.536;
    expect(isWithinFieldGeofence(outsideLat, outsideLon, centerLat, centerLon, radiusMeters)).toBe(
      false
    );
  });
});

describe('Weekend Field Check-in Time Window Validation', () => {
  // 2026-10-24 is Saturday; 2026-10-25 is Sunday; 2026-10-26 is Monday
  // In Taipei (UTC+8):
  // 2026-10-23T22:30:00Z -> 2026-10-24 06:30:00 (Saturday 06:30, start boundary)
  // 2026-10-23T23:00:00Z -> 2026-10-24 07:00:00 (Saturday 07:00, within window)
  // 2026-10-24T01:00:00Z -> 2026-10-24 09:00:00 (Saturday 09:00, end boundary)
  // 2026-10-24T01:01:00Z -> 2026-10-24 09:01:00 (Saturday 09:01, past end)
  // 2026-10-23T22:29:00Z -> 2026-10-24 06:29:00 (Saturday 06:29, before start)
  // 2026-10-25T23:00:00Z -> 2026-10-26 07:00:00 (Monday 07:00, weekday)

  it('accepts check-in within standard weekend window (Saturday 07:00 Taipei time)', () => {
    const date = new Date('2026-10-23T23:00:00Z');
    expect(isFieldCheckinTimeWindowValid(date)).toBe(true);
  });

  it('accepts check-in at exact start time (06:30 Taipei time)', () => {
    const date = new Date('2026-10-23T22:30:00Z');
    expect(isFieldCheckinTimeWindowValid(date)).toBe(true);
  });

  it('accepts check-in at exact end time (09:00 Taipei time)', () => {
    const date = new Date('2026-10-24T01:00:00Z');
    expect(isFieldCheckinTimeWindowValid(date)).toBe(true);
  });

  it('rejects check-in one minute before start time (06:29 Taipei time)', () => {
    const date = new Date('2026-10-23T22:29:00Z');
    expect(isFieldCheckinTimeWindowValid(date)).toBe(false);
  });

  it('rejects check-in one minute after end time (09:01 Taipei time)', () => {
    const date = new Date('2026-10-24T01:01:00Z');
    expect(isFieldCheckinTimeWindowValid(date)).toBe(false);
  });

  it('rejects check-in on weekdays (Monday 07:00 Taipei time)', () => {
    const date = new Date('2026-10-25T23:00:00Z');
    expect(isFieldCheckinTimeWindowValid(date)).toBe(false);
  });

  it('supports custom day and time rules', () => {
    // Custom rule: Wednesday (day 3) 19:00 to 21:00
    const customRules = {
      day_of_week: [3],
      start_time: '19:00',
      end_time: '21:00'
    };
    // 2026-10-28 is Wednesday. 11:30:00 UTC = 19:30 Taipei
    const wednesdayEvening = new Date('2026-10-28T11:30:00Z');
    expect(isFieldCheckinTimeWindowValid(wednesdayEvening, customRules)).toBe(true);

    // Saturday during weekend window with custom rules should now be rejected
    const saturdayMorning = new Date('2026-10-23T23:00:00Z');
    expect(isFieldCheckinTimeWindowValid(saturdayMorning, customRules)).toBe(false);
  });
});

const gpsPayload: FieldCheckinInput = {
  fieldCode: 'DAAN_PARK',
  checkinMethod: 'nfc_gps',
  userLatitude: 25.029659,
  userLongitude: 121.536284
};

// These are syntactically plausible client claims, never verified identities/credentials.
const forgedSubject = 'U' + 'a'.repeat(32);
const forgedToken = 'not-a-verified-line-token';

const attacks = [
  {
    name: 'anonymous GPS',
    payload: gpsPayload,
    status: 503,
    error: 'nfc_authorization_unavailable'
  },
  {
    name: 'self-selected person',
    payload: { ...gpsPayload, personId: randomUUID() },
    status: 400,
    error: 'invalid_input'
  },
  {
    name: 'self-selected volunteer',
    payload: { ...gpsPayload, volunteerPersonId: randomUUID() },
    status: 400,
    error: 'invalid_input'
  },
  {
    name: 'self-selected daily checkin',
    payload: { ...gpsPayload, checkinId: randomUUID() },
    status: 400,
    error: 'invalid_input'
  },
  {
    name: 'forged subject',
    payload: { ...gpsPayload, subject: forgedSubject },
    status: 400,
    error: 'invalid_input'
  },
  {
    name: 'forged token',
    payload: { ...gpsPayload, idToken: forgedToken },
    status: 400,
    error: 'invalid_input'
  },
  {
    name: 'unscoped volunteer',
    payload: { fieldCode: 'DAAN_PARK', checkinMethod: 'volunteer_manual' },
    status: 403,
    error: 'volunteer_authorization_unavailable'
  },
  {
    name: 'forged volunteer and learner',
    payload: {
      fieldCode: 'DAAN_PARK',
      checkinMethod: 'volunteer_manual',
      personId: randomUUID(),
      volunteerPersonId: randomUUID()
    },
    status: 400,
    error: 'invalid_input'
  },
  {
    name: 'forged credential/context headers',
    payload: gpsPayload,
    headers: {
      authorization: 'Bearer ' + forgedToken,
      'x-line-access-token': forgedToken,
      'x-person-id': randomUUID(),
      'x-subject': forgedSubject,
      cookie: '__Host-qigong-admin=forged'
    },
    status: 503,
    error: 'nfc_authorization_unavailable'
  },
  {
    name: 'forged query identity',
    payload: gpsPayload,
    query: {
      personId: randomUUID(),
      subject: forgedSubject,
      volunteerPersonId: randomUUID(),
      checkinId: randomUUID()
    },
    status: 503,
    error: 'nfc_authorization_unavailable'
  }
];

describe('Field check-in application quarantine', () => {
  it('rejects all writes at the service boundary without accepting a DB executor', () => {
    expect(processFieldCheckin(gpsPayload)).toMatchObject({
      ok: false,
      error: 'nfc_authorization_unavailable'
    });
    expect(processFieldCheckin({ ...gpsPayload, checkinMethod: 'volunteer_manual' })).toMatchObject(
      { ok: false, error: 'volunteer_authorization_unavailable' }
    );
    expect(getActivePracticeFields()).toMatchObject({
      ok: false,
      error: 'nfc_authorization_unavailable'
    });
  });

  it('accepts only metadata, never client identity or checkin links', () => {
    expect(fieldCheckinSchema.safeParse(gpsPayload).success).toBe(true);
    for (const key of [
      'personId',
      'volunteerPersonId',
      'checkinId',
      'subject',
      'idToken',
      'principalId'
    ]) {
      expect(fieldCheckinSchema.safeParse({ ...gpsPayload, [key]: randomUUID() }).success).toBe(
        false
      );
    }
    expect(
      fieldCheckinSchema.safeParse({ fieldCode: 'DAAN_PARK', checkinMethod: 'nfc_gps' }).success
    ).toBe(false);
    expect(fieldCheckinSchema.safeParse({ ...gpsPayload, fieldCode: undefined }).success).toBe(
      false
    );
  });

  it('maps explicit quarantine failures to unavailable / forbidden, not success', () => {
    expect(mapCheckinErrorStatus('nfc_authorization_unavailable')).toBe(503);
    expect(mapCheckinErrorStatus('volunteer_authorization_unavailable')).toBe(403);
  });

  it('rejects invalid payloads and field reads when registered directly', async () => {
    const app = Fastify();
    registerFieldCheckinRoutes(app);
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/v1/field-checkin',
            payload: { invalid: 'body' }
          })
        ).statusCode
      ).toBe(400);
      expect((await app.inject('/api/v1/fields/active')).statusCode).toBe(503);
      expect(
        (await app.inject({ method: 'POST', url: '/api/v1/field-checkin', payload: gpsPayload }))
          .statusCode
      ).toBe(503);
    } finally {
      await app.close();
    }
  });

  it.each(attacks)(
    'direct route registration still rejects $name independently of the startup gate',
    async ({ payload, headers, query, status, error }) => {
      // Production buildApp cannot enable NFC. Keep the separate route/service rejection
      // contracts covered without mocking feature readiness or creating an enabling bypass.
      const app = Fastify();
      registerFieldCheckinRoutes(app);
      try {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/field-checkin',
          payload,
          ...(headers ? { headers } : {}),
          ...(query ? { query } : {})
        });
        expect(response.statusCode).toBe(status);
        expect(response.json()).toMatchObject({ ok: false, error });
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['referrer-policy']).toBe('no-referrer');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.body).not.toContain(forgedToken);
        expect(response.body).not.toContain(forgedSubject);
        expect((await app.inject('/api/v1/fields/active')).statusCode).toBe(503);
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    }
  );

  it('reports feature quarantine independently of whether opt-in is configured', async () => {
    const client = createNfcLedgerClient(nfcQuarantineMigrationVersion);
    const query = vi.fn();
    const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
    expect(await checkNfcFeatureReadiness(pool)).toEqual({
      ready: false,
      reason: 'nfc_security_quarantined'
    });
    expect(query).not.toHaveBeenCalled();
    for (const [sql] of client.query.mock.calls) {
      expect(sql).not.toMatch(/core\.(practice_fields|field_attendance)|pg_index/);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
