/**
 * Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
 * Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
 */

export const CHECKIN_METHODS = ['nfc_gps', 'volunteer_manual'] as const;

export type CheckinMethod = (typeof CHECKIN_METHODS)[number];

export interface ActiveTimeRules {
  readonly day_of_week: readonly number[];
  readonly start_time: string;
  readonly end_time: string;
}

export interface PracticeField {
  readonly id: string;
  readonly region_id: string;
  readonly code: string;
  readonly name_zh_tw: string;
  readonly name_en: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly radius_meters: number;
  readonly active_time_rules: ActiveTimeRules;
  readonly is_active: boolean;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface FieldAttendance {
  readonly id: string;
  readonly checkin_id: string | null;
  readonly person_id: string;
  readonly field_id: string;
  readonly checkin_method: CheckinMethod;
  readonly volunteer_person_id: string | null;
  readonly user_latitude: number | null;
  readonly user_longitude: number | null;
  readonly distance_meters: number | null;
  readonly checkin_at: Date;
  readonly student_note: string | null;
}

export interface CreatePracticeFieldInput {
  readonly region_id: string;
  readonly code: string;
  readonly name_zh_tw: string;
  readonly name_en?: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly radius_meters?: number;
  readonly active_time_rules?: ActiveTimeRules;
  readonly is_active?: boolean;
}

export interface CreateFieldAttendanceInput {
  readonly checkin_id?: string | null;
  readonly person_id: string;
  readonly field_id: string;
  readonly checkin_method: CheckinMethod;
  readonly volunteer_person_id?: string | null;
  readonly user_latitude?: number | null;
  readonly user_longitude?: number | null;
  readonly distance_meters?: number | null;
  readonly checkin_at?: Date;
  readonly student_note?: string | null;
}

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isValidTimeString = (time: string): boolean => TIME_REGEX.test(time);

export const parseTimeStringToMinutes = (time: string): number => {
  const match = TIME_REGEX.exec(time);
  const hours = match?.[1];
  const minutes = match?.[2];
  if (!hours || !minutes) {
    throw new Error(`Invalid time format "${time}", expected HH:mm (00:00-23:59)`);
  }
  return Number.parseInt(hours, 10) * 60 + Number.parseInt(minutes, 10);
};

export const isCheckinMethod = (value: unknown): value is CheckinMethod =>
  typeof value === 'string' && (CHECKIN_METHODS as readonly string[]).includes(value);

export const parseActiveTimeRules = (raw: unknown): ActiveTimeRules => {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('ActiveTimeRules must be a valid JSON string or object');
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('ActiveTimeRules must be an object');
  }

  const record = parsed as Record<string, unknown>;

  if (!Array.isArray(record.day_of_week) || record.day_of_week.length === 0) {
    throw new Error('ActiveTimeRules.day_of_week must be a non-empty array of numbers');
  }

  const days: number[] = [];
  for (const day of record.day_of_week) {
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error(
        `Invalid day_of_week value: ${String(day)}. Must be an integer between 0 (Sunday) and 6 (Saturday)`
      );
    }
    if (!days.includes(day)) {
      days.push(day);
    }
  }
  days.sort((a, b) => a - b);

  if (typeof record.start_time !== 'string' || !isValidTimeString(record.start_time)) {
    throw new Error(
      `Invalid start_time: ${String(record.start_time)}. Expected HH:mm in 24-hour format (00:00-23:59)`
    );
  }

  if (typeof record.end_time !== 'string' || !isValidTimeString(record.end_time)) {
    throw new Error(
      `Invalid end_time: ${String(record.end_time)}. Expected HH:mm in 24-hour format (00:00-23:59)`
    );
  }

  const startMinutes = parseTimeStringToMinutes(record.start_time);
  const endMinutes = parseTimeStringToMinutes(record.end_time);

  if (endMinutes <= startMinutes) {
    throw new Error(
      `ActiveTimeRules end_time (${record.end_time}) must be after start_time (${record.start_time})`
    );
  }

  return Object.freeze({
    day_of_week: Object.freeze(days),
    start_time: record.start_time,
    end_time: record.end_time
  });
};

export const isActiveTimeRules = (value: unknown): value is ActiveTimeRules => {
  try {
    parseActiveTimeRules(value);
    return true;
  } catch {
    return false;
  }
};

const WEEKDAY_NAME_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

export const isTimeWithinActiveRules = (
  rules: ActiveTimeRules,
  date: Date,
  timeZone = 'Asia/Taipei'
): boolean => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });

  const parts = formatter.formatToParts(date);
  let weekdayStr = '';
  let hourStr = '';
  let minuteStr = '';

  for (const part of parts) {
    if (part.type === 'weekday') weekdayStr = part.value;
    else if (part.type === 'hour') hourStr = part.value;
    else if (part.type === 'minute') minuteStr = part.value;
  }

  const dayOfWeek = WEEKDAY_NAME_TO_INDEX[weekdayStr];
  if (dayOfWeek === undefined || !rules.day_of_week.includes(dayOfWeek)) {
    return false;
  }

  const currentMinutes = Number.parseInt(hourStr, 10) * 60 + Number.parseInt(minuteStr, 10);
  const startMinutes = parseTimeStringToMinutes(rules.start_time);
  const endMinutes = parseTimeStringToMinutes(rules.end_time);

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
};

const EARTH_RADIUS_METERS = 6_371_000;
const DEG_TO_RAD = Math.PI / 180;

export const calculateDistanceMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_METERS * c * 100) / 100;
};

export const isWithinRadius = (
  userLat: number,
  userLon: number,
  fieldLat: number,
  fieldLon: number,
  radiusMeters: number
): boolean => {
  const distance = calculateDistanceMeters(userLat, userLon, fieldLat, fieldLon);
  return distance <= radiusMeters;
};

const parseDateValue = (field: string, value: unknown): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d;
    }
  }
  throw new Error(`${field} must be a valid Date or timestamp`);
};

export const validatePracticeField = (value: unknown): PracticeField => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('PracticeField must be an object');
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== 'string' || record.id.trim() === '') {
    throw new Error('PracticeField.id must be a non-empty string');
  }
  if (typeof record.region_id !== 'string' || record.region_id.trim() === '') {
    throw new Error('PracticeField.region_id must be a non-empty string');
  }
  if (typeof record.code !== 'string' || record.code.trim() === '') {
    throw new Error('PracticeField.code must be a non-empty string');
  }
  if (typeof record.name_zh_tw !== 'string' || record.name_zh_tw.trim() === '') {
    throw new Error('PracticeField.name_zh_tw must be a non-empty string');
  }
  if (
    record.name_en !== null &&
    record.name_en !== undefined &&
    typeof record.name_en !== 'string'
  ) {
    throw new Error('PracticeField.name_en must be a string, null, or undefined');
  }
  if (typeof record.latitude !== 'number' || record.latitude < -90 || record.latitude > 90) {
    throw new Error('PracticeField.latitude must be a number between -90 and 90');
  }
  if (typeof record.longitude !== 'number' || record.longitude < -180 || record.longitude > 180) {
    throw new Error('PracticeField.longitude must be a number between -180 and 180');
  }
  if (
    typeof record.radius_meters !== 'number' ||
    !Number.isInteger(record.radius_meters) ||
    record.radius_meters <= 0
  ) {
    throw new Error('PracticeField.radius_meters must be a positive integer');
  }

  const active_time_rules = parseActiveTimeRules(record.active_time_rules);

  if (typeof record.is_active !== 'boolean') {
    throw new Error('PracticeField.is_active must be a boolean');
  }

  const created_at = parseDateValue('PracticeField.created_at', record.created_at);
  const updated_at = parseDateValue('PracticeField.updated_at', record.updated_at);

  return Object.freeze({
    id: record.id,
    region_id: record.region_id,
    code: record.code,
    name_zh_tw: record.name_zh_tw,
    name_en: typeof record.name_en === 'string' ? record.name_en : null,
    latitude: record.latitude,
    longitude: record.longitude,
    radius_meters: record.radius_meters,
    active_time_rules,
    is_active: record.is_active,
    created_at,
    updated_at
  });
};

export const isPracticeField = (value: unknown): value is PracticeField => {
  try {
    validatePracticeField(value);
    return true;
  } catch {
    return false;
  }
};

export const validateFieldAttendance = (value: unknown): FieldAttendance => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('FieldAttendance must be an object');
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== 'string' || record.id.trim() === '') {
    throw new Error('FieldAttendance.id must be a non-empty string');
  }
  if (
    record.checkin_id !== null &&
    record.checkin_id !== undefined &&
    (typeof record.checkin_id !== 'string' || record.checkin_id.trim() === '')
  ) {
    throw new Error('FieldAttendance.checkin_id must be a string or null');
  }
  if (typeof record.person_id !== 'string' || record.person_id.trim() === '') {
    throw new Error('FieldAttendance.person_id must be a non-empty string');
  }
  if (typeof record.field_id !== 'string' || record.field_id.trim() === '') {
    throw new Error('FieldAttendance.field_id must be a non-empty string');
  }
  if (!isCheckinMethod(record.checkin_method)) {
    throw new Error(`FieldAttendance.checkin_method must be one of: ${CHECKIN_METHODS.join(', ')}`);
  }
  if (
    record.volunteer_person_id !== null &&
    record.volunteer_person_id !== undefined &&
    (typeof record.volunteer_person_id !== 'string' || record.volunteer_person_id.trim() === '')
  ) {
    throw new Error('FieldAttendance.volunteer_person_id must be a string or null');
  }
  if (
    record.user_latitude !== null &&
    record.user_latitude !== undefined &&
    (typeof record.user_latitude !== 'number' ||
      record.user_latitude < -90 ||
      record.user_latitude > 90)
  ) {
    throw new Error('FieldAttendance.user_latitude must be a number between -90 and 90, or null');
  }
  if (
    record.user_longitude !== null &&
    record.user_longitude !== undefined &&
    (typeof record.user_longitude !== 'number' ||
      record.user_longitude < -180 ||
      record.user_longitude > 180)
  ) {
    throw new Error(
      'FieldAttendance.user_longitude must be a number between -180 and 180, or null'
    );
  }
  if (
    record.distance_meters !== null &&
    record.distance_meters !== undefined &&
    (typeof record.distance_meters !== 'number' || record.distance_meters < 0)
  ) {
    throw new Error('FieldAttendance.distance_meters must be a non-negative number or null');
  }

  const checkin_at = parseDateValue('FieldAttendance.checkin_at', record.checkin_at);

  if (
    record.student_note !== null &&
    record.student_note !== undefined &&
    typeof record.student_note !== 'string'
  ) {
    throw new Error('FieldAttendance.student_note must be a string or null');
  }

  return Object.freeze({
    id: record.id,
    checkin_id: typeof record.checkin_id === 'string' ? record.checkin_id : null,
    person_id: record.person_id,
    field_id: record.field_id,
    checkin_method: record.checkin_method,
    volunteer_person_id:
      typeof record.volunteer_person_id === 'string' ? record.volunteer_person_id : null,
    user_latitude: typeof record.user_latitude === 'number' ? record.user_latitude : null,
    user_longitude: typeof record.user_longitude === 'number' ? record.user_longitude : null,
    distance_meters: typeof record.distance_meters === 'number' ? record.distance_meters : null,
    checkin_at,
    student_note: typeof record.student_note === 'string' ? record.student_note : null
  });
};

export const isFieldAttendance = (value: unknown): value is FieldAttendance => {
  try {
    validateFieldAttendance(value);
    return true;
  } catch {
    return false;
  }
};
