-- Scoped, read-only venue attendance reporting and export.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
-- Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
SET LOCAL search_path = pg_catalog;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='qigong_venue_reporting_reader') THEN
    RAISE EXCEPTION 'venue reporting reader must be a new isolated role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN
    ('core.practice_fields'::regclass,'core.field_attendance'::regclass,'identity.people'::regclass,
     'identity.platform_identities'::regclass,'identity.onboarding_applications'::regclass,
     'identity.person_interaction_channels'::regclass,'audit.events'::regclass)
    AND (NOT relrowsecurity OR NOT relforcerowsecurity)) THEN
    RAISE EXCEPTION 'venue reporting requires FORCE RLS';
  END IF;
END $$;

CREATE ROLE qigong_venue_reporting_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA core, identity, admin, audit TO qigong_venue_reporting_reader;

GRANT SELECT (id,region_id,code,name_zh_tw,name_en,timezone,is_active) ON core.practice_fields TO qigong_venue_reporting_reader;
GRANT SELECT (id,person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone)
  ON core.field_attendance TO qigong_venue_reporting_reader;
GRANT SELECT (id,preferred_name,legal_name) ON identity.people TO qigong_venue_reporting_reader;
GRANT SELECT (id,person_id,platform,external_subject_id,verified_at,revoked_at) ON identity.platform_identities TO qigong_venue_reporting_reader;
GRANT SELECT (id,person_id,platform,external_subject_id,learner_name,display_name,website_email,phone_e164,status,decided_at)
  ON identity.onboarding_applications TO qigong_venue_reporting_reader;
GRANT SELECT (person_id,platform_identity_id,valid_from,valid_to) ON identity.person_interaction_channels TO qigong_venue_reporting_reader;
GRANT SELECT (id,parent_region_id,code,name_zh_tw,name_en,region_type,active) ON core.regions TO qigong_venue_reporting_reader;

GRANT INSERT (request_id,actor_principal_id,action,target_type,scope_type,scope_id,outcome,metadata)
  ON audit.events TO qigong_venue_reporting_reader;

GRANT EXECUTE ON FUNCTION admin.request_id(),admin.request_person_id(),admin.request_principal_id(),
  admin.session_principal(TEXT),admin.can_access_region(UUID,TEXT) TO qigong_venue_reporting_reader;

-- RLS policies for reporting reader
CREATE POLICY venue_reporting_fields_allow ON core.practice_fields FOR SELECT TO qigong_venue_reporting_reader USING(TRUE);
CREATE POLICY venue_reporting_fields_scope ON core.practice_fields AS RESTRICTIVE FOR SELECT TO qigong_venue_reporting_reader
  USING (region_id=NULLIF(current_setting('qigong.reporting_region',TRUE),'')::uuid
    AND NULLIF(current_setting('qigong.reporting_permission',TRUE),'') IN ('checkin.read','stats.export')
    AND admin.can_access_region(region_id,current_setting('qigong.reporting_permission',TRUE)));

CREATE POLICY venue_reporting_attendance_allow ON core.field_attendance FOR SELECT TO qigong_venue_reporting_reader USING(TRUE);
CREATE POLICY venue_reporting_attendance_scope ON core.field_attendance AS RESTRICTIVE FOR SELECT TO qigong_venue_reporting_reader
  USING (EXISTS(SELECT 1 FROM core.practice_fields f WHERE f.id=field_id));

CREATE POLICY venue_reporting_people_allow ON identity.people FOR SELECT TO qigong_venue_reporting_reader USING(TRUE);
CREATE POLICY venue_reporting_people_scope ON identity.people AS RESTRICTIVE FOR SELECT TO qigong_venue_reporting_reader
  USING (EXISTS(SELECT 1 FROM core.field_attendance a WHERE a.person_id=people.id));

CREATE POLICY venue_reporting_identities_allow ON identity.platform_identities FOR SELECT TO qigong_venue_reporting_reader USING(TRUE);
CREATE POLICY venue_reporting_identities_scope ON identity.platform_identities AS RESTRICTIVE FOR SELECT TO qigong_venue_reporting_reader
  USING (EXISTS(SELECT 1 FROM core.field_attendance a WHERE a.person_id=platform_identities.person_id));

CREATE POLICY venue_reporting_applications_allow ON identity.onboarding_applications FOR SELECT TO qigong_venue_reporting_reader USING(TRUE);
CREATE POLICY venue_reporting_applications_scope ON identity.onboarding_applications AS RESTRICTIVE FOR SELECT TO qigong_venue_reporting_reader
  USING (EXISTS(SELECT 1 FROM core.field_attendance a WHERE a.person_id=onboarding_applications.person_id));

CREATE POLICY venue_reporting_channels_allow ON identity.person_interaction_channels FOR SELECT TO qigong_venue_reporting_reader USING(TRUE);
CREATE POLICY venue_reporting_channels_scope ON identity.person_interaction_channels AS RESTRICTIVE FOR SELECT TO qigong_venue_reporting_reader
  USING (EXISTS(SELECT 1 FROM core.field_attendance a WHERE a.person_id=person_interaction_channels.person_id));

CREATE POLICY venue_reporting_audit ON audit.events FOR INSERT TO qigong_venue_reporting_reader
  WITH CHECK (request_id=admin.request_id() AND actor_principal_id=admin.request_principal_id()
    AND scope_type='region' AND scope_id=NULLIF(current_setting('qigong.reporting_region',TRUE),'')::uuid
    AND outcome='success' AND action IN ('venue.attendance_summary','venue.attendance_export','venue.learner_history_read'));

-- 1. Weekend Attendance Summary & CSV Export
CREATE FUNCTION admin.venue_weekend_attendance_summary(
  input_session TEXT,
  input_region UUID,
  input_date_from DATE,
  input_date_until DATE,
  input_field UUID,
  input_export BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $$
DECLARE
  principal UUID;
  permission TEXT;
  result JSONB;
  rows_count INTEGER;
BEGIN
  principal := admin.session_principal(input_session);
  IF principal IS NULL THEN RAISE EXCEPTION 'venue_reporting_unauthenticated' USING ERRCODE='28000'; END IF;
  IF admin.request_id() IS NULL OR admin.request_person_id() IS NOT NULL
    OR (admin.request_principal_id() IS NOT NULL AND admin.request_principal_id() IS DISTINCT FROM principal) THEN
    RAISE EXCEPTION 'venue_reporting_forbidden' USING ERRCODE='42501';
  END IF;
  IF input_region IS NULL OR input_date_from IS NULL OR input_date_until IS NULL
    OR NOT isfinite(input_date_from) OR NOT isfinite(input_date_until)
    OR input_date_from < '0001-01-01'::date OR input_date_until > '9999-12-31'::date
    OR input_date_until <= input_date_from OR input_date_until - input_date_from > 366
    OR input_export IS NULL THEN
    RAISE EXCEPTION 'venue_reporting_invalid' USING ERRCODE='22023';
  END IF;

  permission := CASE WHEN input_export THEN 'stats.export' ELSE 'checkin.read' END;
  PERFORM set_config('qigong.principal_id', principal::text, TRUE);
  IF NOT admin.can_access_region(input_region, permission) THEN
    RAISE EXCEPTION 'venue_reporting_forbidden' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('qigong.reporting_region', input_region::text, TRUE);
  PERFORM set_config('qigong.reporting_permission', permission, TRUE);

  IF input_field IS NOT NULL AND NOT EXISTS(SELECT 1 FROM core.practice_fields WHERE id = input_field AND region_id = input_region) THEN
    RAISE EXCEPTION 'venue_reporting_forbidden' USING ERRCODE='42501';
  END IF;

  IF NOT input_export THEN
    -- Summary Mode: return list of venues with counts
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'fieldId', f.id,
      'fieldCode', f.code,
      'fieldName', f.name_zh_tw,
      'timezone', f.timezone,
      'isActive', f.is_active,
      'attendanceCount', coalesce(counts.total_count, 0),
      'learnerCount', coalesce(counts.learner_count, 0),
      'attendanceDays', coalesce(counts.day_count, 0)
    ) ORDER BY f.code), '[]'::jsonb) INTO result
    FROM core.practice_fields f
    LEFT JOIN LATERAL (
      SELECT count(*) AS total_count,
             count(DISTINCT a.person_id) AS learner_count,
             count(DISTINCT a.attendance_date) AS day_count
      FROM core.field_attendance a
      WHERE a.field_id = f.id
        AND a.attendance_date >= input_date_from
        AND a.attendance_date < input_date_until
    ) counts ON TRUE
    WHERE f.region_id = input_region
      AND (input_field IS NULL OR f.id = input_field);

    INSERT INTO audit.events(request_id, actor_principal_id, action, target_type, scope_type, scope_id, outcome, metadata)
    VALUES(admin.request_id(), principal, 'venue.attendance_summary', 'practice_fields', 'region', input_region, 'success',
      jsonb_build_object('dateFrom', input_date_from, 'dateUntil', input_date_until, 'fieldId', input_field));

    RETURN jsonb_build_object('mode', 'summary', 'regionId', input_region, 'dateFrom', input_date_from, 'dateUntil', input_date_until, 'fields', result);
  ELSE
    -- Export Mode: return all attendees with contact and channel details
    WITH attendees AS (
      SELECT
        a.id AS attendance_id,
        a.attendance_date,
        a.checkin_at,
        a.checkin_method,
        f.code AS field_code,
        f.name_zh_tw AS field_name,
        p.id AS person_id,
        coalesce(nullif(btrim(p.legal_name), ''), nullif(btrim(p.preferred_name), ''), nullif(btrim(contact.learner_name), ''), '學員') AS learner_name,
        coalesce(contact.website_email, '') AS email,
        coalesce(contact.phone_e164, '') AS phone,
        coalesce(channels.line_id, '') AS line_id,
        coalesce(channels.telegram_id, '') AS telegram_id,
        coalesce(channels.whatsapp_id, '') AS whatsapp_id
      FROM core.field_attendance a
      JOIN core.practice_fields f ON f.id = a.field_id
      JOIN identity.people p ON p.id = a.person_id
      LEFT JOIN LATERAL (
        SELECT
          string_agg(i.external_subject_id, ';' ORDER BY i.external_subject_id) FILTER(WHERE i.platform='line') AS line_id,
          string_agg(i.external_subject_id, ';' ORDER BY i.external_subject_id) FILTER(WHERE i.platform='telegram') AS telegram_id,
          string_agg(i.external_subject_id, ';' ORDER BY i.external_subject_id) FILTER(WHERE i.platform='whatsapp') AS whatsapp_id
        FROM identity.platform_identities i
        WHERE i.person_id = p.id AND i.revoked_at IS NULL AND i.verified_at <= clock_timestamp()
      ) channels ON TRUE
      LEFT JOIN LATERAL (
        SELECT app.learner_name, app.website_email, app.phone_e164
        FROM identity.onboarding_applications app
        WHERE app.person_id = p.id AND app.status = 'approved'
        ORDER BY app.decided_at DESC NULLS LAST, app.id DESC
        LIMIT 1
      ) contact ON TRUE
      WHERE f.region_id = input_region
        AND (input_field IS NULL OR f.id = input_field)
        AND a.attendance_date >= input_date_from
        AND a.attendance_date < input_date_until
      ORDER BY a.attendance_date DESC, a.checkin_at DESC, a.id DESC
      LIMIT 5001
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'attendanceId', attendance_id,
      'attendanceDate', attendance_date,
      'checkinAt', checkin_at,
      'checkinMethod', checkin_method,
      'fieldCode', field_code,
      'fieldName', field_name,
      'personId', person_id,
      'learnerName', learner_name,
      'email', email,
      'phone', phone,
      'lineId', line_id,
      'telegramId', telegram_id,
      'whatsappId', whatsapp_id
    )), '[]'::jsonb) INTO result
    FROM attendees;

    rows_count := jsonb_array_length(result);
    IF rows_count > 5000 THEN
      RAISE EXCEPTION 'venue_attendance_export_too_large' USING ERRCODE='54000';
    END IF;

    INSERT INTO audit.events(request_id, actor_principal_id, action, target_type, scope_type, scope_id, outcome, metadata)
    VALUES(admin.request_id(), principal, 'venue.attendance_export', 'field_attendance', 'region', input_region, 'success',
      jsonb_build_object('dateFrom', input_date_from, 'dateUntil', input_date_until, 'fieldId', input_field, 'rowCount', rows_count));

    RETURN jsonb_build_object('mode', 'export', 'regionId', input_region, 'dateFrom', input_date_from, 'dateUntil', input_date_until, 'rowCount', rows_count, 'rows', result);
  END IF;
END;
$$;

-- 2. Learner Attendance Search & Annual History
CREATE FUNCTION admin.venue_learner_attendance_history(
  input_session TEXT,
  input_region UUID,
  input_search TEXT,
  input_person UUID,
  input_page INTEGER,
  input_limit INTEGER
)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $$
DECLARE
  principal UUID;
  result JSONB;
  total_count INTEGER;
  annual_summary JSONB;
  learner_info JSONB;
BEGIN
  principal := admin.session_principal(input_session);
  IF principal IS NULL THEN RAISE EXCEPTION 'venue_reporting_unauthenticated' USING ERRCODE='28000'; END IF;
  IF admin.request_id() IS NULL OR admin.request_person_id() IS NOT NULL
    OR (admin.request_principal_id() IS NOT NULL AND admin.request_principal_id() IS DISTINCT FROM principal) THEN
    RAISE EXCEPTION 'venue_reporting_forbidden' USING ERRCODE='42501';
  END IF;
  IF input_region IS NULL
    OR input_page IS NULL OR input_page NOT BETWEEN 1 AND 10000
    OR input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 100
    OR (input_person IS NULL AND (input_search IS NULL OR length(input_search) > 80 OR input_search <> btrim(input_search) OR input_search ~ '[[:cntrl:]]')) THEN
    RAISE EXCEPTION 'venue_reporting_invalid' USING ERRCODE='22023';
  END IF;

  PERFORM set_config('qigong.principal_id', principal::text, TRUE);
  IF NOT admin.can_access_region(input_region, 'checkin.read') THEN
    RAISE EXCEPTION 'venue_reporting_forbidden' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('qigong.reporting_region', input_region::text, TRUE);
  PERFORM set_config('qigong.reporting_permission', 'checkin.read', TRUE);

  IF input_person IS NULL THEN
    -- Search Mode: search learners by name with phone & email disambiguation
    WITH matched_people AS (
      SELECT
        p.id AS person_id,
        coalesce(nullif(btrim(p.legal_name), ''), nullif(btrim(p.preferred_name), ''), nullif(btrim(contact.learner_name), ''), '學員') AS learner_name,
        coalesce(contact.website_email, '') AS email,
        coalesce(contact.phone_e164, '') AS phone,
        stats.attendance_count,
        stats.attendance_days,
        stats.latest_date,
        stats.latest_field_code,
        stats.latest_field_name
      FROM identity.people p
      JOIN LATERAL (
        SELECT
          count(*) AS attendance_count,
          count(DISTINCT a.attendance_date) AS attendance_days,
          max(a.attendance_date) AS latest_date,
          (ARRAY_AGG(f.code ORDER BY a.attendance_date DESC, a.checkin_at DESC))[1] AS latest_field_code,
          (ARRAY_AGG(f.name_zh_tw ORDER BY a.attendance_date DESC, a.checkin_at DESC))[1] AS latest_field_name
        FROM core.field_attendance a
        JOIN core.practice_fields f ON f.id = a.field_id
        WHERE a.person_id = p.id AND f.region_id = input_region
      ) stats ON stats.attendance_count > 0
      LEFT JOIN LATERAL (
        SELECT app.learner_name, app.website_email, app.phone_e164
        FROM identity.onboarding_applications app
        WHERE app.person_id = p.id AND app.status = 'approved'
        ORDER BY app.decided_at DESC NULLS LAST, app.id DESC
        LIMIT 1
      ) contact ON TRUE
      WHERE (input_search = '' OR strpos(lower(coalesce(p.preferred_name, '') || ' ' || coalesce(p.legal_name, '')), lower(input_search)) > 0)
    ), counted AS (
      SELECT count(*)::integer AS matched_count FROM matched_people
    ), paged AS (
      SELECT * FROM matched_people
      ORDER BY latest_date DESC, attendance_count DESC, person_id
      LIMIT input_limit OFFSET (input_page - 1) * input_limit
    )
    SELECT
      (SELECT coalesce(counted.matched_count, 0) FROM counted),
      coalesce(jsonb_agg(jsonb_build_object(
        'personId', paged.person_id,
        'learnerName', paged.learner_name,
        'email', paged.email,
        'phone', paged.phone,
        'attendanceCount', paged.attendance_count,
        'attendanceDays', paged.attendance_days,
        'latestDate', paged.latest_date,
        'latestFieldCode', paged.latest_field_code,
        'latestFieldName', paged.latest_field_name
      ) ORDER BY paged.latest_date DESC, paged.attendance_count DESC, paged.person_id), '[]'::jsonb)
    INTO total_count, result
    FROM paged;

    INSERT INTO audit.events(request_id, actor_principal_id, action, target_type, scope_type, scope_id, outcome, metadata)
    VALUES(admin.request_id(), principal, 'venue.attendance_summary', 'people', 'region', input_region, 'success',
      jsonb_build_object('search', input_search, 'page', input_page, 'limit', input_limit, 'total', total_count));

    RETURN jsonb_build_object(
      'mode', 'search',
      'regionId', input_region,
      'search', input_search,
      'total', total_count,
      'page', input_page,
      'limit', input_limit,
      'rows', result
    );
  ELSE
    -- Detail Mode: return learner info, annual breakdown, and paginated attendance records
    SELECT jsonb_build_object(
      'personId', p.id,
      'learnerName', coalesce(nullif(btrim(p.legal_name), ''), nullif(btrim(p.preferred_name), ''), nullif(btrim(contact.learner_name), ''), '學員'),
      'email', coalesce(contact.website_email, ''),
      'phone', coalesce(contact.phone_e164, ''),
      'lineId', coalesce(channels.line_id, ''),
      'telegramId', coalesce(channels.telegram_id, ''),
      'whatsappId', coalesce(channels.whatsapp_id, '')
    ) INTO learner_info
    FROM identity.people p
    LEFT JOIN LATERAL (
      SELECT
        string_agg(i.external_subject_id, ';' ORDER BY i.external_subject_id) FILTER(WHERE i.platform='line') AS line_id,
        string_agg(i.external_subject_id, ';' ORDER BY i.external_subject_id) FILTER(WHERE i.platform='telegram') AS telegram_id,
        string_agg(i.external_subject_id, ';' ORDER BY i.external_subject_id) FILTER(WHERE i.platform='whatsapp') AS whatsapp_id
      FROM identity.platform_identities i
      WHERE i.person_id = p.id AND i.revoked_at IS NULL AND i.verified_at <= clock_timestamp()
    ) channels ON TRUE
    LEFT JOIN LATERAL (
      SELECT app.learner_name, app.website_email, app.phone_e164
      FROM identity.onboarding_applications app
      WHERE app.person_id = p.id AND app.status = 'approved'
      ORDER BY app.decided_at DESC NULLS LAST, app.id DESC
      LIMIT 1
    ) contact ON TRUE
    WHERE p.id = input_person;

    IF learner_info IS NULL THEN
      RAISE EXCEPTION 'venue_reporting_not_found' USING ERRCODE='P0002';
    END IF;

    -- Annual Summary
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'year', yr,
      'attendanceCount', attendance_count,
      'attendanceDays', attendance_days
    ) ORDER BY yr DESC), '[]'::jsonb) INTO annual_summary
    FROM (
      SELECT
        extract(YEAR FROM a.attendance_date)::integer AS yr,
        count(*) AS attendance_count,
        count(DISTINCT a.attendance_date) AS attendance_days
      FROM core.field_attendance a
      JOIN core.practice_fields f ON f.id = a.field_id
      WHERE a.person_id = input_person
        AND f.region_id = input_region
      GROUP BY extract(YEAR FROM a.attendance_date)::integer
    ) annual;

    -- Paginated check-in records
    SELECT count(*) INTO total_count
    FROM core.field_attendance a
    JOIN core.practice_fields f ON f.id = a.field_id
    WHERE a.person_id = input_person
      AND f.region_id = input_region;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'attendanceId', sub.id,
      'attendanceDate', sub.attendance_date,
      'checkinAt', sub.checkin_at,
      'timezone', sub.attendance_timezone,
      'checkinMethod', sub.checkin_method,
      'fieldCode', sub.code,
      'fieldName', sub.name_zh_tw
    ) ORDER BY sub.attendance_date DESC, sub.checkin_at DESC, sub.id DESC), '[]'::jsonb) INTO result
    FROM (
      SELECT a.id, a.attendance_date, a.checkin_at, a.attendance_timezone, a.checkin_method, f.code, f.name_zh_tw
      FROM core.field_attendance a
      JOIN core.practice_fields f ON f.id = a.field_id
      WHERE a.person_id = input_person
        AND f.region_id = input_region
      ORDER BY a.attendance_date DESC, a.checkin_at DESC, a.id DESC
      LIMIT input_limit OFFSET (input_page - 1) * input_limit
    ) sub;

    INSERT INTO audit.events(request_id, actor_principal_id, action, target_type, scope_type, scope_id, outcome, metadata)
    VALUES(admin.request_id(), principal, 'venue.learner_history_read', 'people', 'region', input_region, 'success',
      jsonb_build_object('personId', input_person, 'page', input_page, 'limit', input_limit, 'total', total_count));

    RETURN jsonb_build_object(
      'mode', 'detail',
      'regionId', input_region,
      'learner', learner_info,
      'annualSummary', annual_summary,
      'total', total_count,
      'page', input_page,
      'limit', input_limit,
      'history', result
    );
  END IF;
END;
$$;
