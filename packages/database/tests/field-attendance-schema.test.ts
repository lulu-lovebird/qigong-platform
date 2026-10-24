/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

import { describe, expect, it } from 'vitest';
import {
  CHECKIN_METHODS,
  calculateDistanceMeters,
  isActiveTimeRules,
  isCheckinMethod,
  isFieldAttendance,
  isPracticeField,
  isTimeWithinActiveRules,
  isValidTimeString,
  isWithinRadius,
  parseActiveTimeRules,
  parseTimeStringToMinutes,
  validateFieldAttendance,
  validatePracticeField,
  type ActiveTimeRules,
  type FieldAttendance,
  type PracticeField
} from '../src/index.js';

describe('CheckinMethod schema & validation', () => {
  it('exposes expected checkin methods', () => {
    expect(CHECKIN_METHODS).toEqual(['nfc_gps', 'volunteer_manual']);
  });

  it('validates supported check-in methods', () => {
    expect(isCheckinMethod('nfc_gps')).toBe(true);
    expect(isCheckinMethod('volunteer_manual')).toBe(true);
  });

  it('rejects unsupported check-in methods or invalid types', () => {
    expect(isCheckinMethod('qr_code')).toBe(false);
    expect(isCheckinMethod('bluetooth')).toBe(false);
    expect(isCheckinMethod('')).toBe(false);
    expect(isCheckinMethod(null)).toBe(false);
    expect(isCheckinMethod(undefined)).toBe(false);
    expect(isCheckinMethod(123)).toBe(false);
  });
});

describe('TimeString utilities', () => {
  it('identifies valid 24-hour HH:mm time strings', () => {
    expect(isValidTimeString('00:00')).toBe(true);
    expect(isValidTimeString('06:30')).toBe(true);
    expect(isValidTimeString('12:00')).toBe(true);
    expect(isValidTimeString('23:59')).toBe(true);
  });

  it('rejects invalid time strings', () => {
    expect(isValidTimeString('24:00')).toBe(false);
    expect(isValidTimeString('25:30')).toBe(false);
    expect(isValidTimeString('12:60')).toBe(false);
    expect(isValidTimeString('6:30')).toBe(false);
    expect(isValidTimeString('invalid')).toBe(false);
    expect(isValidTimeString('')).toBe(false);
  });

  it('converts HH:mm strings to minutes from midnight', () => {
    expect(parseTimeStringToMinutes('00:00')).toBe(0);
    expect(parseTimeStringToMinutes('01:30')).toBe(90);
    expect(parseTimeStringToMinutes('06:30')).toBe(390);
    expect(parseTimeStringToMinutes('23:59')).toBe(1439);
  });

  it('throws on invalid time string parsing', () => {
    expect(() => parseTimeStringToMinutes('invalid')).toThrow(
      'Invalid time format "invalid", expected HH:mm (00:00-23:59)'
    );
  });
});

describe('ActiveTimeRules parsing & validation', () => {
  const defaultRules: ActiveTimeRules = {
    day_of_week: [0, 6],
    start_time: '06:30',
    end_time: '09:00'
  };

  it('parses valid object rules and sorts/deduplicates days', () => {
    const parsed = parseActiveTimeRules({
      day_of_week: [6, 0, 6],
      start_time: '06:30',
      end_time: '09:00'
    });
    expect(parsed.day_of_week).toEqual([0, 6]);
    expect(parsed.start_time).toBe('06:30');
    expect(parsed.end_time).toBe('09:00');
  });

  it('parses valid JSON string rules matching migration 0047 default', () => {
    const jsonStr = '{"day_of_week": [0, 6], "start_time": "06:30", "end_time": "09:00"}';
    const parsed = parseActiveTimeRules(jsonStr);
    expect(parsed).toEqual(defaultRules);
  });

  it('isActiveTimeRules correctly guards valid rules', () => {
    expect(isActiveTimeRules(defaultRules)).toBe(true);
    expect(
      isActiveTimeRules('{"day_of_week": [0, 6], "start_time": "06:30", "end_time": "09:00"}')
    ).toBe(true);
    expect(isActiveTimeRules({ day_of_week: [], start_time: '06:30', end_time: '09:00' })).toBe(
      false
    );
    expect(isActiveTimeRules(null)).toBe(false);
    expect(isActiveTimeRules('not a json')).toBe(false);
  });

  it('rejects malformed JSON string', () => {
    expect(() => parseActiveTimeRules('{day_of_week: [0, 6]}')).toThrow(
      'ActiveTimeRules must be a valid JSON string or object'
    );
  });

  it('rejects non-object structures', () => {
    expect(() => parseActiveTimeRules(null)).toThrow('ActiveTimeRules must be an object');
    expect(() => parseActiveTimeRules([1, 2, 3])).toThrow('ActiveTimeRules must be an object');
    expect(() => parseActiveTimeRules(42)).toThrow('ActiveTimeRules must be an object');
  });

  it('rejects invalid day_of_week formats', () => {
    expect(() =>
      parseActiveTimeRules({ day_of_week: [], start_time: '06:30', end_time: '09:00' })
    ).toThrow('ActiveTimeRules.day_of_week must be a non-empty array of numbers');

    expect(() =>
      parseActiveTimeRules({ day_of_week: [7], start_time: '06:30', end_time: '09:00' })
    ).toThrow('Invalid day_of_week value: 7');

    expect(() =>
      parseActiveTimeRules({ day_of_week: [-1], start_time: '06:30', end_time: '09:00' })
    ).toThrow('Invalid day_of_week value: -1');

    expect(() =>
      parseActiveTimeRules({ day_of_week: ['0'], start_time: '06:30', end_time: '09:00' })
    ).toThrow('Invalid day_of_week value: 0');
  });

  it('rejects invalid start_time or end_time format', () => {
    expect(() =>
      parseActiveTimeRules({ day_of_week: [0], start_time: '25:00', end_time: '09:00' })
    ).toThrow('Invalid start_time: 25:00');

    expect(() =>
      parseActiveTimeRules({ day_of_week: [0], start_time: '06:30', end_time: '09:65' })
    ).toThrow('Invalid end_time: 09:65');
  });

  it('rejects when end_time is not strictly after start_time', () => {
    expect(() =>
      parseActiveTimeRules({ day_of_week: [0], start_time: '09:00', end_time: '09:00' })
    ).toThrow('ActiveTimeRules end_time (09:00) must be after start_time (09:00)');

    expect(() =>
      parseActiveTimeRules({ day_of_week: [0], start_time: '10:00', end_time: '09:00' })
    ).toThrow('ActiveTimeRules end_time (09:00) must be after start_time (10:00)');
  });
});

describe('isTimeWithinActiveRules logic', () => {
  const weekendMorningRules: ActiveTimeRules = {
    day_of_week: [0, 6], // Sunday = 0, Saturday = 6
    start_time: '06:30',
    end_time: '09:00'
  };

  it('returns true when checked during active weekend morning window in Taipei timezone', () => {
    // 2026-10-24 is Saturday. Taipei UTC+8.
    // 07:45 Taipei is 2026-10-23 23:45 UTC.
    const checkinTime = new Date('2026-10-23T23:45:00Z');
    expect(isTimeWithinActiveRules(weekendMorningRules, checkinTime, 'Asia/Taipei')).toBe(true);
  });

  it('returns true at exact boundary start and end times', () => {
    // 06:30 Taipei is 2026-10-23 22:30 UTC
    const startTime = new Date('2026-10-23T22:30:00Z');
    expect(isTimeWithinActiveRules(weekendMorningRules, startTime, 'Asia/Taipei')).toBe(true);

    // 09:00 Taipei is 2026-10-24 01:00 UTC
    const endTime = new Date('2026-10-24T01:00:00Z');
    expect(isTimeWithinActiveRules(weekendMorningRules, endTime, 'Asia/Taipei')).toBe(true);
  });

  it('returns false outside active window on weekend', () => {
    // 06:29 Taipei is 2026-10-23 22:29 UTC
    const tooEarly = new Date('2026-10-23T22:29:00Z');
    expect(isTimeWithinActiveRules(weekendMorningRules, tooEarly, 'Asia/Taipei')).toBe(false);

    // 09:01 Taipei is 2026-10-24 01:01 UTC
    const tooLate = new Date('2026-10-24T01:01:00Z');
    expect(isTimeWithinActiveRules(weekendMorningRules, tooLate, 'Asia/Taipei')).toBe(false);
  });

  it('returns false on weekdays even if time matches window', () => {
    // 2026-10-23 is Friday.
    // 07:30 Taipei is 2026-10-22 23:30 UTC.
    const fridayMorning = new Date('2026-10-22T23:30:00Z');
    expect(isTimeWithinActiveRules(weekendMorningRules, fridayMorning, 'Asia/Taipei')).toBe(false);
  });

  it('respects different time zones correctly', () => {
    // 2026-10-24 07:00 UTC
    const utcDate = new Date('2026-10-24T07:00:00Z');
    // In UTC, Saturday 07:00 is within 06:30-09:00
    expect(isTimeWithinActiveRules(weekendMorningRules, utcDate, 'UTC')).toBe(true);
    // In Asia/Taipei, Saturday 07:00 UTC is 15:00 Taipei -> outside morning window
    expect(isTimeWithinActiveRules(weekendMorningRules, utcDate, 'Asia/Taipei')).toBe(false);
  });
});

describe('Distance and radius verification', () => {
  // Daan Forest Park coordinates (Taipei)
  const daanLat = 25.033;
  const daanLon = 121.5363;

  it('returns 0 for identical coordinates', () => {
    expect(calculateDistanceMeters(daanLat, daanLon, daanLat, daanLon)).toBe(0);
  });

  it('calculates distance correctly for known displacement', () => {
    // Displacing latitude by ~0.00045 degrees is ~50 meters
    const nearbyLat = 25.03345;
    const distance = calculateDistanceMeters(daanLat, daanLon, nearbyLat, daanLon);
    expect(distance).toBeGreaterThanOrEqual(49);
    expect(distance).toBeLessThanOrEqual(51);
  });

  it('correctly evaluates isWithinRadius', () => {
    const nearbyLatWithin = 25.0333; // ~33m away
    const farLat = 25.035; // ~222m away

    expect(isWithinRadius(nearbyLatWithin, daanLon, daanLat, daanLon, 50)).toBe(true);
    expect(isWithinRadius(farLat, daanLon, daanLat, daanLon, 50)).toBe(false);
  });
});

describe('PracticeField entity validation', () => {
  const validFieldInput: PracticeField = {
    id: 'f1000000-0000-0000-0000-000000000001',
    region_id: 'r1000000-0000-0000-0000-000000000001',
    code: 'TW-TPE-DAAN',
    name_zh_tw: '大安森林公園場',
    name_en: 'Daan Forest Park Field',
    latitude: 25.033,
    longitude: 121.5363,
    radius_meters: 50,
    active_time_rules: {
      day_of_week: [0, 6],
      start_time: '06:30',
      end_time: '09:00'
    },
    is_active: true,
    created_at: new Date('2026-10-01T00:00:00Z'),
    updated_at: new Date('2026-10-01T00:00:00Z')
  };

  it('validates a complete and correct PracticeField', () => {
    const validated = validatePracticeField(validFieldInput);
    expect(validated.code).toBe('TW-TPE-DAAN');
    expect(validated.name_zh_tw).toBe('大安森林公園場');
    expect(validated.name_en).toBe('Daan Forest Park Field');
    expect(validated.radius_meters).toBe(50);
    expect(isPracticeField(validated)).toBe(true);
  });

  it('supports null name_en', () => {
    const withNullEn = { ...validFieldInput, name_en: null };
    const validated = validatePracticeField(withNullEn);
    expect(validated.name_en).toBeNull();
  });

  it('supports ISO string dates converting to Date', () => {
    const withIsoDates = {
      ...validFieldInput,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z'
    };
    const validated = validatePracticeField(withIsoDates);
    expect(validated.created_at).toBeInstanceOf(Date);
    expect(validated.updated_at).toBeInstanceOf(Date);
  });

  it('rejects invalid coordinates', () => {
    expect(() => validatePracticeField({ ...validFieldInput, latitude: 95 })).toThrow(
      'PracticeField.latitude must be a number between -90 and 90'
    );
    expect(() => validatePracticeField({ ...validFieldInput, longitude: 185 })).toThrow(
      'PracticeField.longitude must be a number between -180 and 180'
    );
  });

  it('rejects non-positive radius', () => {
    expect(() => validatePracticeField({ ...validFieldInput, radius_meters: 0 })).toThrow(
      'PracticeField.radius_meters must be a positive integer'
    );
    expect(() => validatePracticeField({ ...validFieldInput, radius_meters: -10 })).toThrow(
      'PracticeField.radius_meters must be a positive integer'
    );
  });

  it('rejects missing or empty required fields', () => {
    expect(() => validatePracticeField({ ...validFieldInput, code: '' })).toThrow(
      'PracticeField.code must be a non-empty string'
    );
    expect(() => validatePracticeField({ ...validFieldInput, name_zh_tw: '   ' })).toThrow();
  });
});

describe('FieldAttendance entity validation', () => {
  const validNfcAttendance: FieldAttendance = {
    id: 'a1000000-0000-0000-0000-000000000001',
    checkin_id: 'c1000000-0000-0000-0000-000000000001',
    person_id: 'p1000000-0000-0000-0000-000000000001',
    field_id: 'f1000000-0000-0000-0000-000000000001',
    checkin_method: 'nfc_gps',
    volunteer_person_id: null,
    user_latitude: 25.0331,
    user_longitude: 121.5364,
    distance_meters: 15.5,
    checkin_at: new Date('2026-10-24T07:15:00Z'),
    student_note: '早起練功身心舒暢'
  };

  const validManualAttendance: FieldAttendance = {
    id: 'a1000000-0000-0000-0000-000000000002',
    checkin_id: null,
    person_id: 'p1000000-0000-0000-0000-000000000002',
    field_id: 'f1000000-0000-0000-0000-000000000001',
    checkin_method: 'volunteer_manual',
    volunteer_person_id: 'p1000000-0000-0000-0000-000000000099',
    user_latitude: null,
    user_longitude: null,
    distance_meters: null,
    checkin_at: new Date('2026-10-24T07:30:00Z'),
    student_note: null
  };

  it('validates a correct NFC + GPS field attendance record', () => {
    const validated = validateFieldAttendance(validNfcAttendance);
    expect(validated.checkin_method).toBe('nfc_gps');
    expect(validated.user_latitude).toBe(25.0331);
    expect(validated.distance_meters).toBe(15.5);
    expect(isFieldAttendance(validated)).toBe(true);
  });

  it('validates a correct volunteer manual field attendance record', () => {
    const validated = validateFieldAttendance(validManualAttendance);
    expect(validated.checkin_method).toBe('volunteer_manual');
    expect(validated.volunteer_person_id).toBe('p1000000-0000-0000-0000-000000000099');
    expect(validated.user_latitude).toBeNull();
    expect(validated.distance_meters).toBeNull();
    expect(isFieldAttendance(validated)).toBe(true);
  });

  it('rejects invalid checkin_method', () => {
    expect(() =>
      validateFieldAttendance({ ...validNfcAttendance, checkin_method: 'qr_scan' })
    ).toThrow('FieldAttendance.checkin_method must be one of: nfc_gps, volunteer_manual');
  });

  it('rejects negative distance', () => {
    expect(() => validateFieldAttendance({ ...validNfcAttendance, distance_meters: -5 })).toThrow(
      'FieldAttendance.distance_meters must be a non-negative number or null'
    );
  });

  it('rejects invalid latitude and longitude values', () => {
    expect(() => validateFieldAttendance({ ...validNfcAttendance, user_latitude: 100 })).toThrow(
      'FieldAttendance.user_latitude must be a number between -90 and 90, or null'
    );

    expect(() => validateFieldAttendance({ ...validNfcAttendance, user_longitude: -190 })).toThrow(
      'FieldAttendance.user_longitude must be a number between -180 and 180, or null'
    );
  });

  it('rejects invalid checkin_at date value', () => {
    expect(() =>
      validateFieldAttendance({ ...validNfcAttendance, checkin_at: 'not-a-date' })
    ).toThrow('FieldAttendance.checkin_at must be a valid Date or timestamp');
  });
});
