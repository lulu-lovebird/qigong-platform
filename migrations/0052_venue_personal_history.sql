-- Personal attendance history; no backfill, legacy snapshot or admin scope changes.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
-- Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
SET LOCAL search_path = pg_catalog;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='qigong_venue_history_reader') THEN
    RAISE EXCEPTION 'venue history requires a new isolated role';
  END IF;
  CREATE ROLE qigong_venue_history_reader NOLOGIN NOINHERIT NOSUPERUSER
    NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
END $$;
GRANT USAGE ON SCHEMA platform, core, admin TO qigong_venue_history_reader;
GRANT SELECT (id,person_id,field_id,checkin_at,attendance_date,attendance_timezone)
  ON core.field_attendance TO qigong_venue_history_reader;
GRANT SELECT (id,code,name_zh_tw) ON core.practice_fields TO qigong_venue_history_reader;
GRANT EXECUTE ON FUNCTION admin.request_id(),admin.request_person_id(),admin.request_principal_id(),
  platform.resolve_line_learner_identity(TEXT),platform.privacy_usage(TEXT,TEXT)
  TO qigong_venue_history_reader;

-- Not a ledger/session: transient transaction-local authorization slot. Its table
-- owner is the migration owner, NOT the SECURITY DEFINER role. Runtime cannot
-- write this context, even by forging arbitrary custom GUCs. Empty after each call.
CREATE TABLE platform.venue_history_context (
  backend_pid INTEGER NOT NULL,
  transaction_id XID8 NOT NULL,
  person_id UUID NOT NULL,
  PRIMARY KEY (backend_pid,transaction_id)
);
ALTER TABLE platform.venue_history_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.venue_history_context FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.venue_history_context FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
GRANT SELECT,INSERT,DELETE ON platform.venue_history_context TO qigong_venue_history_reader;
CREATE POLICY venue_history_context_owner ON platform.venue_history_context
  TO qigong_venue_history_reader
  USING (backend_pid=pg_backend_pid() AND transaction_id=pg_current_xact_id())
  WITH CHECK (backend_pid=pg_backend_pid() AND transaction_id=pg_current_xact_id());

CREATE FUNCTION platform.venue_history_person() RETURNS UUID
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $$
  SELECT person_id FROM platform.venue_history_context
  WHERE backend_pid=pg_backend_pid() AND transaction_id=pg_current_xact_id()
$$;
ALTER FUNCTION platform.venue_history_person() OWNER TO qigong_venue_history_reader;
CREATE POLICY venue_history_self ON core.field_attendance
  FOR SELECT TO qigong_venue_history_reader
  USING (person_id=platform.venue_history_person());
CREATE POLICY venue_history_own_fields ON core.practice_fields
  FOR SELECT TO qigong_venue_history_reader
  USING (EXISTS (SELECT 1 FROM core.field_attendance a WHERE a.field_id=practice_fields.id));

-- Platform is explicit for future channel-specific credential resolvers. Only
-- LINE is supported now; a subject is server-verified input, NOT a credential.
CREATE FUNCTION platform.venue_personal_history(input_platform TEXT,input_subject TEXT,
  input_month TEXT DEFAULT NULL,input_venue TEXT DEFAULT NULL,input_page BIGINT DEFAULT 1)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog SET row_security=on AS $$
DECLARE mapping JSONB; privacy JSONB; person UUID; result JSONB; month_start DATE; month_end DATE;
BEGIN
  IF admin.request_id() IS NULL OR admin.request_person_id() IS NOT NULL
    OR admin.request_principal_id() IS NOT NULL OR input_platform IS DISTINCT FROM 'line'
    OR input_subject IS NULL OR input_subject !~ '^U[0-9a-f]{32}$'
    OR input_page IS NULL OR input_page NOT BETWEEN 1 AND 9007199254740991
    OR (input_month IS NOT NULL AND (input_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR left(input_month,4)='0000'))
    OR (input_venue IS NOT NULL AND (length(input_venue)>64 OR input_venue !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)+$')) THEN
    RAISE EXCEPTION 'venue_history_invalid' USING ERRCODE='22023';
  END IF;
  -- Revalidate in THIS read transaction; the HTTP adapter snapshot is not authority.
  mapping := platform.resolve_line_learner_identity(input_subject);
  IF mapping IS NULL THEN RAISE EXCEPTION 'venue_history_denied' USING ERRCODE='42501'; END IF;
  privacy := platform.privacy_usage(input_platform,input_subject);
  IF coalesce((privacy->>'required')::boolean,FALSE) OR coalesce((privacy->>'unavailable')::boolean,FALSE) THEN
    RAISE EXCEPTION 'venue_history_denied' USING ERRCODE='42501';
  END IF;
  person := (mapping->>'personId')::uuid;
  month_start := (coalesce(input_month,to_char(clock_timestamp() AT TIME ZONE 'Asia/Taipei','YYYY-MM'))||'-01')::date;
  month_end := (month_start+interval '1 month')::date;
  INSERT INTO platform.venue_history_context VALUES(pg_backend_pid(),pg_current_xact_id(),person);
  WITH own AS MATERIALIZED (
    SELECT a.id,a.field_id,a.checkin_at,a.attendance_date,a.attendance_timezone
    FROM core.field_attendance a WHERE a.person_id=person
  ), totals AS (
    SELECT count(*) attendance_count,count(DISTINCT attendance_date) attendance_days,
      count(*) FILTER (WHERE attendance_date>=month_start AND attendance_date<month_end) month_count FROM own
  ), filtered AS (
    SELECT a.id,a.checkin_at,a.attendance_date,a.attendance_timezone,f.code,f.name_zh_tw
    FROM own a JOIN core.practice_fields f ON f.id=a.field_id
    WHERE (input_month IS NULL OR (a.attendance_date>=month_start AND a.attendance_date<month_end))
      AND (input_venue IS NULL OR f.code=input_venue)
  ), page_rows AS MATERIALIZED (
    SELECT * FROM filtered ORDER BY checkin_at DESC,id DESC
    LIMIT 21 OFFSET ((input_page::bigint-1)*20)
  ), visible AS (
    SELECT * FROM page_rows ORDER BY checkin_at DESC,id DESC LIMIT 20
  ) SELECT jsonb_build_object('ok',TRUE,'timezone','Asia/Taipei',
    'totals',jsonb_build_object('attendanceCount',attendance_count,'attendanceDays',attendance_days,'monthCount',month_count),
    'page',input_page,'pageSize',20,'hasMore',(SELECT count(*)>20 FROM page_rows),
    'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'venueCode',code,'venueName',name_zh_tw,
      'checkedInAt',to_char(checkin_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'venueLocalDate',attendance_date,'venueTimezone',attendance_timezone) ORDER BY checkin_at DESC,id DESC)
      FROM visible),'[]'::jsonb)) INTO result FROM totals;
  DELETE FROM platform.venue_history_context WHERE backend_pid=pg_backend_pid() AND transaction_id=pg_current_xact_id();
  RETURN result;
END $$;
ALTER FUNCTION platform.venue_personal_history(TEXT,TEXT,TEXT,TEXT,BIGINT) OWNER TO qigong_venue_history_reader;

-- Remove arbitrary default function ACLs, not just PUBLIC. Never grant membership
-- in this reader, direct attendance SELECT, or the context helper to runtime.
DO $$ DECLARE f RECORD; g RECORD; BEGIN
  FOR f IN SELECT p.oid,p.proowner,p.oid::regprocedure signature FROM pg_proc p
    WHERE p.oid=ANY(ARRAY['platform.venue_history_person()'::regprocedure,
      'platform.venue_personal_history(text,text,text,text,bigint)'::regprocedure]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC CASCADE',f.signature);
    FOR g IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=f.oid AND a.grantee<>f.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I CASCADE',f.signature,g.rolname);
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON core.field_attendance,core.practice_fields FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
GRANT EXECUTE ON FUNCTION platform.venue_personal_history(TEXT,TEXT,TEXT,TEXT,BIGINT) TO qigong_api_runtime;
