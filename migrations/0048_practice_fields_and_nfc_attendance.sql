-- Migration 0047: Practice fields and NFC weekend attendance
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
-- Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.

CREATE TABLE IF NOT EXISTS core.practice_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id UUID NOT NULL REFERENCES core.regions(id) ON DELETE RESTRICT,
    code TEXT NOT NULL UNIQUE,
    name_zh_tw TEXT NOT NULL,
    name_en TEXT,
    latitude NUMERIC(10, 7) NOT NULL,
    longitude NUMERIC(10, 7) NOT NULL,
    radius_meters INTEGER NOT NULL DEFAULT 50,
    active_time_rules JSONB NOT NULL DEFAULT '{"day_of_week": [0, 6], "start_time": "06:30", "end_time": "09:00"}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS core.field_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkin_id UUID REFERENCES core.checkins(id) ON DELETE SET NULL,
    person_id UUID NOT NULL REFERENCES identity.people(id) ON DELETE CASCADE,
    field_id UUID NOT NULL REFERENCES core.practice_fields(id) ON DELETE RESTRICT,
    checkin_method TEXT NOT NULL CHECK(checkin_method IN ('nfc_gps', 'volunteer_manual')),
    volunteer_person_id UUID REFERENCES identity.people(id),
    user_latitude NUMERIC(10, 7),
    user_longitude NUMERIC(10, 7),
    distance_meters NUMERIC(8, 2),
    checkin_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    student_note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_field_attendance_unique_day 
ON core.field_attendance(person_id, field_id, ((checkin_at AT TIME ZONE 'Asia/Taipei')::date));

CREATE INDEX IF NOT EXISTS idx_field_attendance_field_date 
ON core.field_attendance(field_id, checkin_at);
