/**
 * Practice Field & NFC Weekend Attendance Service
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

export interface ActiveTimeRules {
  day_of_week?: number[];
  start_time?: string;
  end_time?: string;
}

export type CheckinMethod = 'nfc_gps' | 'volunteer_manual';

// Payload metadata only; no client-supplied identity or daily-practice link is accepted.
export interface FieldCheckinInput {
  fieldId?: string;
  fieldCode?: string;
  checkinMethod: CheckinMethod;
  userLatitude?: number;
  userLongitude?: number;
  studentNote?: string;
}

export interface FieldCheckinFailure {
  ok: false;
  error: 'nfc_authorization_unavailable' | 'volunteer_authorization_unavailable';
  message: string;
}

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

/**
 * Application-level quarantine, independent of the opt-in gate and DB role privileges.
 * Do not restore SQL until verified credentials, active identity/channel mapping,
 * eligibility/privacy and scoped authorization are enforced through request context.
 * Deliberately accepts no pool/client; even a privileged connection cannot bypass this guard.
 */
export const getActivePracticeFields = (): FieldCheckinFailure => ({
  ok: false,
  error: 'nfc_authorization_unavailable',
  message: 'NFC field access is unavailable pending trusted authorization'
});

export const processFieldCheckin = (
  input: Pick<FieldCheckinInput, 'checkinMethod'>
): FieldCheckinFailure => {
  if (input.checkinMethod === 'volunteer_manual') {
    return {
      ok: false,
      error: 'volunteer_authorization_unavailable',
      message: 'Volunteer check-in is forbidden pending scoped authorization'
    };
  }
  return getActivePracticeFields();
};
