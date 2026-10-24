/**
 * Practice Field & NFC Weekend Attendance Service
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

import type { Pool } from '@qigong/database';

export interface ActiveTimeRules {
  day_of_week?: number[];
  start_time?: string;
  end_time?: string;
}

export interface PracticeFieldRecord {
  id: string;
  region_id: string;
  code: string;
  name_zh_tw: string;
  name_en: string | null;
  latitude: number;
  longitude: number;
  radius_meters: number;
  active_time_rules: ActiveTimeRules;
  is_active: boolean;
  created_at?: string | Date;
  updated_at?: string | Date;
}

interface RawPracticeFieldRow {
  id: string;
  region_id: string;
  code: string;
  name_zh_tw: string;
  name_en: string | null;
  latitude: string | number;
  longitude: string | number;
  radius_meters: string | number;
  active_time_rules: ActiveTimeRules | string;
  is_active: boolean;
  created_at?: string | Date;
  updated_at?: string | Date;
}

export type CheckinMethod = 'nfc_gps' | 'volunteer_manual';

export interface FieldCheckinInput {
  personId: string;
  fieldId?: string;
  fieldCode?: string;
  checkinMethod: CheckinMethod;
  userLatitude?: number;
  userLongitude?: number;
  volunteerPersonId?: string;
  studentNote?: string;
  checkinId?: string;
}

export interface ProcessFieldCheckinOptions {
  now?: Date;
  skipTimeWindowCheck?: boolean;
  requestId?: string;
}

export interface FieldCheckinSuccess {
  ok: true;
  attendanceId: string;
  checkinId?: string | null;
  personId: string;
  fieldId: string;
  fieldCode: string;
  fieldName: string;
  checkinMethod: CheckinMethod;
  distanceMeters?: number | null;
  checkinAt: string;
  message: string;
}

export interface FieldCheckinFailure {
  ok: false;
  error:
    | 'invalid_input'
    | 'field_not_found'
    | 'field_inactive'
    | 'outside_time_window'
    | 'outside_geofence'
    | 'missing_coordinates'
    | 'missing_volunteer'
    | 'already_checked_in'
    | 'database_error';
  message: string;
  distanceMeters?: number;
}

export type FieldCheckinResult = FieldCheckinSuccess | FieldCheckinFailure;

export type DatabaseExecutor = Pick<Pool, 'query'>;

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates the great-circle distance between two GPS coordinates using the Haversine formula.
 * Returns distance in meters, rounded to two decimal places.
 */
export const calculateDistanceMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const toRadians = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = EARTH_RADIUS_METERS * c;

  return Math.round(distance * 100) / 100;
};

/**
 * Checks whether user coordinates fall within the geofence radius of a practice field.
 */
export const isWithinFieldGeofence = (
  userLat: number,
  userLon: number,
  fieldLat: number,
  fieldLon: number,
  radiusMeters: number
): boolean => {
  const distance = calculateDistanceMeters(userLat, userLon, fieldLat, fieldLon);
  return distance <= radiusMeters;
};

/**
 * Validates whether the given date/time falls within the active check-in window.
 * Default rules: weekend (Saturday and Sunday) between 06:30 and 09:00 Taipei time.
 */
export const isFieldCheckinTimeWindowValid = (
  date: Date = new Date(),
  rules?: ActiveTimeRules,
  timezone = 'Asia/Taipei'
): boolean => {
  const dayOfWeek = rules?.day_of_week ?? [0, 6];
  const startTime = rules?.start_time ?? '06:30';
  const endTime = rules?.end_time ?? '09:00';

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short'
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  const currentDay = weekdayMap[parts.weekday ?? ''] ?? -1;
  const currentTime = `${parts.hour ?? '00'}:${parts.minute ?? '00'}`;

  if (!dayOfWeek.includes(currentDay)) {
    return false;
  }

  if (currentTime < startTime || currentTime > endTime) {
    return false;
  }

  return true;
};

const parseActiveTimeRules = (raw: ActiveTimeRules | string): ActiveTimeRules => {
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as ActiveTimeRules;
      }
    } catch {
      return { day_of_week: [0, 6], start_time: '06:30', end_time: '09:00' };
    }
    return { day_of_week: [0, 6], start_time: '06:30', end_time: '09:00' };
  }
  return raw ?? { day_of_week: [0, 6], start_time: '06:30', end_time: '09:00' };
};

/**
 * Retrieves all currently active practice fields.
 */
export const getActivePracticeFields = async (
  db: DatabaseExecutor
): Promise<PracticeFieldRecord[]> => {
  const result = await db.query<RawPracticeFieldRow>(
    `SELECT id, region_id, code, name_zh_tw, name_en, latitude, longitude, radius_meters, active_time_rules, is_active, created_at, updated_at
     FROM core.practice_fields
     WHERE is_active = TRUE
     ORDER BY code ASC`
  );

  return result.rows.map((row) => ({
    ...row,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    radius_meters: Number(row.radius_meters),
    active_time_rules: parseActiveTimeRules(row.active_time_rules)
  }));
};

/**
 * Core field check-in processing logic.
 * Handles validation, geofencing, time window checks, and duplicate check-in prevention.
 */
export const processFieldCheckin = async (
  db: DatabaseExecutor,
  input: FieldCheckinInput,
  options?: ProcessFieldCheckinOptions
): Promise<FieldCheckinResult> => {
  const checkinTime = options?.now ?? new Date();

  // 1. Basic input validation
  if (!input.fieldId && !input.fieldCode) {
    return {
      ok: false,
      error: 'invalid_input',
      message: 'Either fieldId or fieldCode must be provided'
    };
  }

  if (input.checkinMethod === 'nfc_gps') {
    if (
      input.userLatitude === undefined ||
      input.userLongitude === undefined ||
      !Number.isFinite(input.userLatitude) ||
      !Number.isFinite(input.userLongitude)
    ) {
      return {
        ok: false,
        error: 'missing_coordinates',
        message: 'Valid latitude and longitude coordinates are required for nfc_gps check-in'
      };
    }
  } else if (input.checkinMethod === 'volunteer_manual') {
    if (!input.volunteerPersonId) {
      return {
        ok: false,
        error: 'missing_volunteer',
        message: 'volunteerPersonId is required for volunteer_manual check-in'
      };
    }
  } else {
    return {
      ok: false,
      error: 'invalid_input',
      message: `Invalid checkinMethod: ${String(input.checkinMethod)}`
    };
  }

  // 2. Fetch practice field
  const fieldQuery = input.fieldId
    ? `SELECT id, region_id, code, name_zh_tw, name_en, latitude, longitude, radius_meters, active_time_rules, is_active
       FROM core.practice_fields WHERE id = $1 LIMIT 1`
    : `SELECT id, region_id, code, name_zh_tw, name_en, latitude, longitude, radius_meters, active_time_rules, is_active
       FROM core.practice_fields WHERE code = $1 LIMIT 1`;
  const fieldParam = input.fieldId ?? input.fieldCode;

  const fieldResult = await db.query<RawPracticeFieldRow>(fieldQuery, [fieldParam]);
  const fieldRow = fieldResult.rows[0];

  if (!fieldRow) {
    return {
      ok: false,
      error: 'field_not_found',
      message: 'Practice field not found'
    };
  }

  if (!fieldRow.is_active) {
    return {
      ok: false,
      error: 'field_inactive',
      message: 'Practice field is inactive'
    };
  }

  const field: PracticeFieldRecord = {
    ...fieldRow,
    latitude: Number(fieldRow.latitude),
    longitude: Number(fieldRow.longitude),
    radius_meters: Number(fieldRow.radius_meters),
    active_time_rules: parseActiveTimeRules(fieldRow.active_time_rules)
  };

  // 3. Time window check (can be skipped via options or for volunteer manual check-ins when specified)
  if (!options?.skipTimeWindowCheck) {
    const isTimeValid = isFieldCheckinTimeWindowValid(checkinTime, field.active_time_rules);
    if (!isTimeValid) {
      return {
        ok: false,
        error: 'outside_time_window',
        message: 'Field check-in is only available during active weekend practice hours'
      };
    }
  }

  // 4. Geofence verification for nfc_gps
  let distanceMeters: number | undefined;
  if (input.checkinMethod === 'nfc_gps') {
    distanceMeters = calculateDistanceMeters(
      input.userLatitude!,
      input.userLongitude!,
      field.latitude,
      field.longitude
    );

    if (distanceMeters > field.radius_meters) {
      return {
        ok: false,
        error: 'outside_geofence',
        message: `Current location is outside the practice field geofence (${distanceMeters}m > ${field.radius_meters}m)`,
        distanceMeters
      };
    }
  }

  // 5. Duplicate check-in prevention (one check-in per person per field per day in Asia/Taipei)
  const duplicateQuery = `
    SELECT id, checkin_at
    FROM core.field_attendance
    WHERE person_id = $1
      AND field_id = $2
      AND ((checkin_at AT TIME ZONE 'Asia/Taipei')::date = ($3::timestamptz AT TIME ZONE 'Asia/Taipei')::date)
    LIMIT 1
  `;

  const duplicateResult = await db.query<{ id: string; checkin_at: string | Date }>(
    duplicateQuery,
    [input.personId, field.id, checkinTime.toISOString()]
  );

  if (duplicateResult.rows.length > 0) {
    return {
      ok: false,
      error: 'already_checked_in',
      message: 'Member has already checked in at this practice field today'
    };
  }

  // 6. Record attendance in database
  const insertQuery = `
    INSERT INTO core.field_attendance (
      checkin_id,
      person_id,
      field_id,
      checkin_method,
      volunteer_person_id,
      user_latitude,
      user_longitude,
      distance_meters,
      checkin_at,
      student_note
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id, checkin_at
  `;

  try {
    const insertResult = await db.query<{ id: string; checkin_at: string | Date }>(insertQuery, [
      input.checkinId ?? null,
      input.personId,
      field.id,
      input.checkinMethod,
      input.volunteerPersonId ?? null,
      input.userLatitude ?? null,
      input.userLongitude ?? null,
      distanceMeters ?? null,
      checkinTime.toISOString(),
      input.studentNote ?? null
    ]);

    const createdRow = insertResult.rows[0];
    const checkinAtIso =
      createdRow?.checkin_at instanceof Date
        ? createdRow.checkin_at.toISOString()
        : String(createdRow?.checkin_at ?? checkinTime.toISOString());

    return {
      ok: true,
      attendanceId: createdRow?.id ?? '',
      checkinId: input.checkinId ?? null,
      personId: input.personId,
      fieldId: field.id,
      fieldCode: field.code,
      fieldName: field.name_zh_tw,
      checkinMethod: input.checkinMethod,
      distanceMeters: distanceMeters ?? null,
      checkinAt: checkinAtIso,
      message: 'Field check-in completed successfully'
    };
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === '23505'
    ) {
      return {
        ok: false,
        error: 'already_checked_in',
        message: 'Member has already checked in at this practice field today'
      };
    }
    throw error;
  }
};
