/**
 * Unit and Route Tests for Practice Field & NFC Check-in Engine
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import {
  calculateDistanceMeters,
  isWithinFieldGeofence,
  isFieldCheckinTimeWindowValid,
  getActivePracticeFields,
  processFieldCheckin,
  type DatabaseExecutor,
  type FieldCheckinInput,
  type PracticeFieldRecord
} from '../src/field-checkin-service.js';
import {
  registerFieldCheckinRoutes,
  mapCheckinErrorStatus,
  fieldCheckinSchema
} from '../src/field-checkin-routes.js';
import { buildApp } from '../src/app.js';
import type { Pool } from '@qigong/database';

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
    const centerLat = 25.030000;
    const centerLon = 121.536000;
    const radiusMeters = 50;

    // Point approx 20 meters north (1 deg lat ≈ 111,139m, so 0.00018 deg ≈ 20m)
    const insideLat = 25.030180;
    const insideLon = 121.536000;
    expect(isWithinFieldGeofence(insideLat, insideLon, centerLat, centerLon, radiusMeters)).toBe(
      true
    );

    // Point approx 100 meters north (0.00090 deg ≈ 100m)
    const outsideLat = 25.030900;
    const outsideLon = 121.536000;
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

describe('Field Check-in Core Processing Service', () => {
  const mockFieldRow = {
    id: 'f1000000-0000-0000-0000-000000000001',
    region_id: 'r1000000-0000-0000-0000-000000000001',
    code: 'DAAN_PARK',
    name_zh_tw: '大安森林公園團練點',
    name_en: 'Daan Forest Park',
    latitude: 25.029659,
    longitude: 121.536284,
    radius_meters: 50,
    active_time_rules: { day_of_week: [0, 6], start_time: '06:30', end_time: '09:00' },
    is_active: true
  };

  const validSaturdayMorning = new Date('2026-10-23T23:00:00Z'); // 07:00 Taipei

  it('successfully processes nfc_gps check-in within geofence and time window', async () => {
    const personId = randomUUID();
    const createdAttendanceId = randomUUID();

    const mockDb: DatabaseExecutor = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM core.practice_fields')) {
          return { rows: [mockFieldRow], rowCount: 1 };
        }
        if (sql.includes('FROM core.field_attendance') && sql.includes('SELECT id')) {
          return { rows: [], rowCount: 0 }; // no duplicate
        }
        if (sql.includes('INSERT INTO core.field_attendance')) {
          return {
            rows: [{ id: createdAttendanceId, checkin_at: validSaturdayMorning.toISOString() }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      })
    };

    const input: FieldCheckinInput = {
      personId,
      fieldCode: 'DAAN_PARK',
      checkinMethod: 'nfc_gps',
      userLatitude: 25.029700, // ~5 meters away
      userLongitude: 121.536300
    };

    const result = await processFieldCheckin(mockDb, input, { now: validSaturdayMorning });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attendanceId).toBe(createdAttendanceId);
      expect(result.fieldName).toBe('大安森林公園團練點');
      expect(result.fieldCode).toBe('DAAN_PARK');
      expect(result.checkinMethod).toBe('nfc_gps');
      expect(result.distanceMeters).toBeDefined();
      expect(result.distanceMeters).toBeLessThan(50);
    }
  });

  it('successfully processes volunteer_manual check-in bypassing geofence', async () => {
    const personId = randomUUID();
    const volunteerPersonId = randomUUID();
    const createdAttendanceId = randomUUID();

    const mockDb: DatabaseExecutor = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM core.practice_fields')) {
          return { rows: [mockFieldRow], rowCount: 1 };
        }
        if (sql.includes('FROM core.field_attendance') && sql.includes('SELECT id')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO core.field_attendance')) {
          return {
            rows: [{ id: createdAttendanceId, checkin_at: validSaturdayMorning.toISOString() }],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      })
    };

    const input: FieldCheckinInput = {
      personId,
      fieldId: mockFieldRow.id,
      checkinMethod: 'volunteer_manual',
      volunteerPersonId,
      studentNote: '長輩手機無電，現場由志工核實補簽'
    };

    const result = await processFieldCheckin(mockDb, input, { now: validSaturdayMorning });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attendanceId).toBe(createdAttendanceId);
      expect(result.checkinMethod).toBe('volunteer_manual');
      expect(result.distanceMeters).toBeNull();
    }
  });

  it('rejects check-in when field does not exist', async () => {
    const mockDb: DatabaseExecutor = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 }))
    };

    const input: FieldCheckinInput = {
      personId: randomUUID(),
      fieldCode: 'NON_EXISTENT_FIELD',
      checkinMethod: 'nfc_gps',
      userLatitude: 25.029659,
      userLongitude: 121.536284
    };

    const result = await processFieldCheckin(mockDb, input, { now: validSaturdayMorning });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('field_not_found');
    }
  });

  it('rejects check-in when field is inactive', async () => {
    const inactiveField = { ...mockFieldRow, is_active: false };
    const mockDb: DatabaseExecutor = {
      query: vi.fn(async () => ({ rows: [inactiveField], rowCount: 1 }))
    };

    const input: FieldCheckinInput = {
      personId: randomUUID(),
      fieldCode: 'DAAN_PARK',
      checkinMethod: 'nfc_gps',
      userLatitude: 25.029659,
      userLongitude: 121.536284
    };

    const result = await processFieldCheckin(mockDb, input, { now: validSaturdayMorning });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('field_inactive');
    }
  });

  it('rejects check-in outside active weekend practice hours', async () => {
    const mockDb: DatabaseExecutor = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM core.practice_fields')) {
          return { rows: [mockFieldRow], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      })
    };

    const mondayMorning = new Date('2026-10-25T23:00:00Z'); // Monday 07:00 Taipei
    const input: FieldCheckinInput = {
      personId: randomUUID(),
      fieldCode: 'DAAN_PARK',
      checkinMethod: 'nfc_gps',
      userLatitude: 25.029659,
      userLongitude: 121.536284
    };

    const result = await processFieldCheckin(mockDb, input, { now: mondayMorning });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('outside_time_window');
    }
  });

  it('rejects check-in when user coordinates are outside the geofence radius', async () => {
    const mockDb: DatabaseExecutor = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM core.practice_fields')) {
          return { rows: [mockFieldRow], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      })
    };

    const input: FieldCheckinInput = {
      personId: randomUUID(),
      fieldCode: 'DAAN_PARK',
      checkinMethod: 'nfc_gps',
      userLatitude: 25.033961, // Taipei 101 (~2.88 km away)
      userLongitude: 121.564472
    };

    const result = await processFieldCheckin(mockDb, input, { now: validSaturdayMorning });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('outside_geofence');
      expect(result.distanceMeters).toBeGreaterThan(50);
    }
  });

  it('rejects duplicate check-in on the same day for the same member and field', async () => {
    const existingAttendance = {
      id: randomUUID(),
      checkin_at: validSaturdayMorning.toISOString()
    };

    const mockDb: DatabaseExecutor = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM core.practice_fields')) {
          return { rows: [mockFieldRow], rowCount: 1 };
        }
        if (sql.includes('FROM core.field_attendance') && sql.includes('SELECT id')) {
          return { rows: [existingAttendance], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      })
    };

    const input: FieldCheckinInput = {
      personId: randomUUID(),
      fieldCode: 'DAAN_PARK',
      checkinMethod: 'nfc_gps',
      userLatitude: 25.029659,
      userLongitude: 121.536284
    };

    const result = await processFieldCheckin(mockDb, input, { now: validSaturdayMorning });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('already_checked_in');
    }
  });

  it('gracefully handles database unique constraint violation (code 23505) as duplicate check-in', async () => {
    const mockDb: DatabaseExecutor = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM core.practice_fields')) {
          return { rows: [mockFieldRow], rowCount: 1 };
        }
        if (sql.includes('FROM core.field_attendance') && sql.includes('SELECT id')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO core.field_attendance')) {
          const conflictError = new Error('duplicate key value violates unique constraint');
          Object.assign(conflictError, { code: '23505' });
          throw conflictError;
        }
        return { rows: [], rowCount: 0 };
      })
    };

    const input: FieldCheckinInput = {
      personId: randomUUID(),
      fieldCode: 'DAAN_PARK',
      checkinMethod: 'nfc_gps',
      userLatitude: 25.029659,
      userLongitude: 121.536284
    };

    const result = await processFieldCheckin(mockDb, input, { now: validSaturdayMorning });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('already_checked_in');
    }
  });

  it('rejects nfc_gps check-in when coordinates are missing', async () => {
    const mockDb: DatabaseExecutor = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 }))
    };

    const input: FieldCheckinInput = {
      personId: randomUUID(),
      fieldCode: 'DAAN_PARK',
      checkinMethod: 'nfc_gps'
      // userLatitude and userLongitude omitted
    };

    const result = await processFieldCheckin(mockDb, input, { now: validSaturdayMorning });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('missing_coordinates');
    }
  });

  it('rejects volunteer_manual check-in when volunteerPersonId is missing', async () => {
    const mockDb: DatabaseExecutor = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 }))
    };

    const input: FieldCheckinInput = {
      personId: randomUUID(),
      fieldCode: 'DAAN_PARK',
      checkinMethod: 'volunteer_manual'
      // volunteerPersonId omitted
    };

    const result = await processFieldCheckin(mockDb, input, { now: validSaturdayMorning });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('missing_volunteer');
    }
  });
});

describe('Active Practice Fields Listing', () => {
  it('retrieves active fields with properly parsed numeric coordinates', async () => {
    const rows = [
      {
        id: randomUUID(),
        region_id: randomUUID(),
        code: 'FIELD_01',
        name_zh_tw: '台北大安團練場',
        name_en: 'Taipei Daan Field',
        latitude: '25.029659',
        longitude: '121.536284',
        radius_meters: '50',
        active_time_rules: '{"day_of_week": [0, 6], "start_time": "06:30", "end_time": "09:00"}',
        is_active: true
      }
    ];

    const mockDb: DatabaseExecutor = {
      query: vi.fn(async () => ({ rows, rowCount: 1 }))
    };

    const fields = await getActivePracticeFields(mockDb);

    expect(fields).toHaveLength(1);
    expect(fields[0]?.code).toBe('FIELD_01');
    expect(fields[0]?.latitude).toBe(25.029659);
    expect(fields[0]?.longitude).toBe(121.536284);
    expect(fields[0]?.radius_meters).toBe(50);
    expect(fields[0]?.active_time_rules.day_of_week).toEqual([0, 6]);
  });
});

describe('Field Check-in Routes HTTP Validation & Endpoints', () => {
  it('validates request payload schema using Zod', () => {
    const validPayload = {
      personId: randomUUID(),
      fieldCode: 'DAAN_PARK',
      checkinMethod: 'nfc_gps',
      userLatitude: 25.029659,
      userLongitude: 121.536284
    };
    expect(fieldCheckinSchema.safeParse(validPayload).success).toBe(true);

    // Missing coordinates for nfc_gps
    expect(
      fieldCheckinSchema.safeParse({
        personId: randomUUID(),
        fieldCode: 'DAAN_PARK',
        checkinMethod: 'nfc_gps'
      }).success
    ).toBe(false);

    // Missing volunteerPersonId for volunteer_manual
    expect(
      fieldCheckinSchema.safeParse({
        personId: randomUUID(),
        fieldCode: 'DAAN_PARK',
        checkinMethod: 'volunteer_manual'
      }).success
    ).toBe(false);

    // Missing both fieldId and fieldCode
    expect(
      fieldCheckinSchema.safeParse({
        personId: randomUUID(),
        checkinMethod: 'nfc_gps',
        userLatitude: 25.029659,
        userLongitude: 121.536284
      }).success
    ).toBe(false);
  });

  it('maps domain error codes to corresponding HTTP status codes', () => {
    expect(mapCheckinErrorStatus('already_checked_in')).toBe(409);
    expect(mapCheckinErrorStatus('field_not_found')).toBe(404);
    expect(mapCheckinErrorStatus('outside_geofence')).toBe(403);
    expect(mapCheckinErrorStatus('outside_time_window')).toBe(403);
    expect(mapCheckinErrorStatus('invalid_input')).toBe(400);
    expect(mapCheckinErrorStatus('missing_coordinates')).toBe(400);
    expect(mapCheckinErrorStatus('missing_volunteer')).toBe(400);
    expect(mapCheckinErrorStatus('field_inactive')).toBe(400);
    expect(mapCheckinErrorStatus('unexpected_error')).toBe(500);
  });

  it('GET /api/v1/fields/active returns 200 with list of active fields', async () => {
    const app = Fastify();
    const mockFields: PracticeFieldRecord[] = [
      {
        id: randomUUID(),
        region_id: randomUUID(),
        code: 'DAAN',
        name_zh_tw: '大安團練場',
        name_en: 'Daan Field',
        latitude: 25.029659,
        longitude: 121.536284,
        radius_meters: 50,
        active_time_rules: { day_of_week: [0, 6], start_time: '06:30', end_time: '09:00' },
        is_active: true
      }
    ];

    const mockPool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM core.practice_fields')) {
          return { rows: mockFields, rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      })
    } as unknown as Pool;

    registerFieldCheckinRoutes(app, mockPool);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/fields/active'
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ ok: boolean; fields: PracticeFieldRecord[] }>();
    expect(body.ok).toBe(true);
    expect(body.fields).toHaveLength(1);
    expect(body.fields[0]?.code).toBe('DAAN');

    await app.close();
  });

  it('POST /api/v1/field-checkin returns 400 when input validation fails', async () => {
    const app = Fastify();
    const mockPool = { query: vi.fn() } as unknown as Pool;
    registerFieldCheckinRoutes(app, mockPool);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/field-checkin',
      payload: { invalid: 'body' }
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ ok: boolean; error: string }>();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid_input');

    await app.close();
  });

  it('integrates with buildApp to handle POST /api/v1/field-checkin success', async () => {
    const personId = randomUUID();
    const attendanceId = randomUUID();
    const mockField = {
      id: randomUUID(),
      region_id: randomUUID(),
      code: 'DAAN_PARK',
      name_zh_tw: '大安森林公園',
      name_en: 'Daan Park',
      latitude: '25.029659',
      longitude: '121.536284',
      radius_meters: '50',
      active_time_rules: { day_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '00:00', end_time: '23:59' },
      is_active: true
    };

    const mockPool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM core.practice_fields')) {
          return { rows: [mockField], rowCount: 1 };
        }
        if (sql.includes('FROM core.field_attendance') && sql.includes('SELECT id')) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('INSERT INTO core.field_attendance')) {
          return { rows: [{ id: attendanceId, checkin_at: new Date().toISOString() }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      })
    } as unknown as Pool;

    const app = buildApp({ pool: mockPool, logger: false });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/field-checkin',
      payload: {
        personId,
        fieldCode: 'DAAN_PARK',
        checkinMethod: 'nfc_gps',
        userLatitude: 25.029660,
        userLongitude: 121.536285
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ ok: boolean; attendanceId: string; fieldName: string }>();
    expect(body.ok).toBe(true);
    expect(body.attendanceId).toBe(attendanceId);
    expect(body.fieldName).toBe('大安森林公園');

    await app.close();
  });
});
