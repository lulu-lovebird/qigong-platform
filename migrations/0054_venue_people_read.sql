-- Scoped, read-only venue participants. No membership, identity linking or attendance writes.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
-- Copyright (c) 2026 Bean, Bird & Badminton Tech Consulting. All rights reserved.
SET LOCAL search_path = pg_catalog;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='qigong_venue_people_reader') THEN
    RAISE EXCEPTION 'venue people reader must be a new isolated role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid IN
    ('core.practice_fields'::regclass,'core.field_attendance'::regclass,'identity.people'::regclass,'audit.events'::regclass)
    AND (NOT relrowsecurity OR NOT relforcerowsecurity)) THEN
    RAISE EXCEPTION 'venue people requires FORCE RLS';
  END IF;
END $$;
CREATE ROLE qigong_venue_people_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA core, identity, admin, audit TO qigong_venue_people_reader;
GRANT SELECT (id,region_id,code,name_zh_tw) ON core.practice_fields TO qigong_venue_people_reader;
GRANT SELECT (id,person_id,field_id,checkin_method,checkin_at,attendance_date,attendance_timezone)
  ON core.field_attendance TO qigong_venue_people_reader;
GRANT SELECT (id,preferred_name,legal_name) ON identity.people TO qigong_venue_people_reader;
GRANT INSERT (request_id,actor_principal_id,action,target_type,scope_type,scope_id,outcome,metadata)
  ON audit.events TO qigong_venue_people_reader;
GRANT EXECUTE ON FUNCTION admin.request_id(),admin.request_person_id(),admin.request_principal_id(),
  admin.session_principal(TEXT),admin.can_access_region(UUID,TEXT) TO qigong_venue_people_reader;

-- Restrictive policies remain authoritative even if another migration adds PUBLIC policies.
-- These GUCs are set ONLY after session verification by the inaccessible function owner.
CREATE POLICY venue_people_fields_allow ON core.practice_fields FOR SELECT TO qigong_venue_people_reader USING(TRUE);
CREATE POLICY venue_people_fields_scope ON core.practice_fields AS RESTRICTIVE FOR SELECT TO qigong_venue_people_reader
  USING (region_id=NULLIF(current_setting('qigong.venue_people_region',TRUE),'')::uuid
    AND NULLIF(current_setting('qigong.venue_people_permission',TRUE),'') IN ('checkin.read','stats.export')
    AND admin.can_access_region(region_id,current_setting('qigong.venue_people_permission',TRUE)));
CREATE POLICY venue_people_attendance_allow ON core.field_attendance FOR SELECT TO qigong_venue_people_reader USING(TRUE);
CREATE POLICY venue_people_attendance_scope ON core.field_attendance AS RESTRICTIVE FOR SELECT TO qigong_venue_people_reader
  USING (EXISTS(SELECT 1 FROM core.practice_fields f WHERE f.id=field_id));
CREATE POLICY venue_people_names_allow ON identity.people FOR SELECT TO qigong_venue_people_reader USING(TRUE);
CREATE POLICY venue_people_names_scope ON identity.people AS RESTRICTIVE FOR SELECT TO qigong_venue_people_reader
  USING (EXISTS(SELECT 1 FROM core.field_attendance a WHERE a.person_id=people.id));
CREATE POLICY venue_people_audit ON audit.events FOR INSERT TO qigong_venue_people_reader
  WITH CHECK (request_id=admin.request_id() AND actor_principal_id=admin.request_principal_id()
    AND scope_type='region' AND scope_id=NULLIF(current_setting('qigong.venue_people_region',TRUE),'')::uuid
    AND outcome='success' AND action IN ('venue.people_read','venue.people_export'));

CREATE FUNCTION admin.venue_people_read(input_session TEXT,input_region UUID,input_from DATE,input_until DATE,
  input_field UUID,input_person UUID,input_search TEXT,input_mode TEXT,input_sort TEXT,input_direction TEXT,
  input_page INTEGER,input_limit INTEGER,input_export BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $$
DECLARE principal UUID; permission TEXT; result JSONB;
BEGIN
  principal := admin.session_principal(input_session);
  IF principal IS NULL THEN RAISE EXCEPTION 'venue_people_unauthenticated' USING ERRCODE='28000'; END IF;
  IF admin.request_id() IS NULL OR admin.request_person_id() IS NOT NULL
    OR (admin.request_principal_id() IS NOT NULL AND admin.request_principal_id() IS DISTINCT FROM principal) THEN
    RAISE EXCEPTION 'venue_people_forbidden' USING ERRCODE='42501';
  END IF;
  IF input_region IS NULL OR input_from IS NULL OR input_until IS NULL
    OR NOT isfinite(input_from) OR NOT isfinite(input_until)
    OR input_from<'0001-01-01'::date OR input_until>'9999-12-31'::date
    OR input_until<=input_from OR input_until-input_from>366
    OR input_page IS NULL OR input_page NOT BETWEEN 1 AND 10000
    OR input_limit IS NULL OR input_limit NOT BETWEEN 1 AND 100 OR input_export IS NULL
    OR input_mode IS NULL OR input_mode NOT IN ('people','detail')
    OR (input_mode='people' AND input_person IS NOT NULL) OR (input_mode='detail' AND input_person IS NULL)
    OR input_sort IS NULL OR input_sort NOT IN ('name','count','days','recent')
    OR input_direction IS NULL OR input_direction NOT IN ('asc','desc')
    OR input_search IS NULL OR length(input_search)>80 OR input_search<>btrim(input_search) OR input_search ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'venue_people_invalid' USING ERRCODE='22023';
  END IF;
  permission := CASE WHEN input_export THEN 'stats.export' ELSE 'checkin.read' END;
  PERFORM set_config('qigong.principal_id',principal::text,TRUE);
  IF NOT admin.can_access_region(input_region,permission) THEN
    RAISE EXCEPTION 'venue_people_forbidden' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('qigong.venue_people_region',input_region::text,TRUE);
  PERFORM set_config('qigong.venue_people_permission',permission,TRUE);
  IF input_field IS NOT NULL AND NOT EXISTS(SELECT 1 FROM core.practice_fields WHERE id=input_field AND region_id=input_region) THEN
    RAISE EXCEPTION 'venue_people_forbidden' USING ERRCODE='42501';
  END IF;
  WITH scoped AS MATERIALIZED (
    SELECT a.id,a.person_id,a.attendance_date,a.attendance_timezone,a.checkin_at,a.checkin_method,
      f.id field_id,f.code,f.name_zh_tw,
      left(coalesce(nullif(btrim(p.preferred_name),''),nullif(btrim(p.legal_name),''),'學員'),120) learner_name
    FROM core.field_attendance a JOIN core.practice_fields f ON f.id=a.field_id
    JOIN identity.people p ON p.id=a.person_id
    WHERE f.region_id=input_region AND a.attendance_date>=input_from AND a.attendance_date<input_until
      AND (input_field IS NULL OR f.id=input_field) AND (input_person IS NULL OR p.id=input_person)
      -- Literal substring, NOT caller-controlled LIKE/regex/SQL. Names never establish identity.
      AND (input_search='' OR strpos(lower(coalesce(p.preferred_name,'')||' '||coalesce(p.legal_name,'')),lower(input_search))>0)
  ), people AS MATERIALIZED (
    SELECT person_id,learner_name,count(*) attendance_count,count(DISTINCT attendance_date) attendance_days,
      max(attendance_date) latest_date FROM scoped GROUP BY person_id,learner_name
  ), candidates AS (
    SELECT person_id::text tie,learner_name,attendance_count,attendance_days,latest_date,
      jsonb_build_object('personId',person_id,'name',learner_name,'attendanceCount',attendance_count,
        'attendanceDays',attendance_days,'latestDate',latest_date) row_data
    FROM people WHERE input_mode='people'
    UNION ALL
    SELECT id::text,learner_name,1::bigint,1::bigint,attendance_date,
      jsonb_build_object('recordId',id,'personId',person_id,'name',learner_name,'date',attendance_date,
        'timezone',attendance_timezone,'checkedInAt',to_char(checkin_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'fieldId',field_id,'fieldCode',code,'fieldName',name_zh_tw,'method',checkin_method)
    FROM scoped WHERE input_mode='detail'
  ), ordered AS (
    SELECT row_data,row_number() OVER (ORDER BY
      CASE WHEN input_direction='asc' AND input_sort='name' THEN learner_name END ASC,
      CASE WHEN input_direction='desc' AND input_sort='name' THEN learner_name END DESC,
      CASE WHEN input_direction='asc' AND input_sort='count' THEN attendance_count END ASC,
      CASE WHEN input_direction='desc' AND input_sort='count' THEN attendance_count END DESC,
      CASE WHEN input_direction='asc' AND input_sort='days' THEN attendance_days END ASC,
      CASE WHEN input_direction='desc' AND input_sort='days' THEN attendance_days END DESC,
      CASE WHEN input_direction='asc' AND input_sort='recent' THEN latest_date END ASC,
      CASE WHEN input_direction='desc' AND input_sort='recent' THEN latest_date END DESC,tie) position
    FROM candidates
  ), paged AS (
    SELECT * FROM ordered ORDER BY position
    LIMIT CASE WHEN input_export THEN 1001 ELSE input_limit END
    OFFSET CASE WHEN input_export THEN 0 ELSE (input_page-1)*input_limit END
  ) SELECT jsonb_build_object('version',1,'mode',input_mode,'regionId',input_region,'fieldId',input_field,
    'personId',input_person,'from',input_from,'until',input_until,'search',input_search,
    'sort',input_sort,'direction',input_direction,'page',CASE WHEN input_export THEN 1 ELSE input_page END,
    'limit',CASE WHEN input_export THEN 1000 ELSE input_limit END,'exporting',input_export,
    'total',(SELECT count(*) FROM candidates),
    'totals',jsonb_build_object('attendanceCount',(SELECT count(*) FROM scoped),
      'attendanceDays',(SELECT count(DISTINCT attendance_date) FROM scoped),'learnerCount',(SELECT count(*) FROM people)),
    'rows',coalesce((SELECT jsonb_agg(row_data ORDER BY position) FROM paged),'[]'::jsonb)) INTO result;
  IF input_export AND (result->>'total')::bigint>1000 THEN
    RAISE EXCEPTION 'venue_people_export_too_large' USING ERRCODE='54000';
  END IF;
  INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,scope_type,scope_id,outcome,metadata)
    VALUES(admin.request_id(),principal,CASE WHEN input_export THEN 'venue.people_export' ELSE 'venue.people_read' END,
      'venue_people','region',input_region,'success',jsonb_build_object('mode',input_mode,'rowCount',jsonb_array_length(result->'rows')));
  RETURN result;
END $$;
ALTER FUNCTION admin.venue_people_read(TEXT,UUID,DATE,DATE,UUID,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,BOOLEAN)
  OWNER TO qigong_venue_people_reader;
-- Match 0052/0053: clear arbitrary inherited default EXECUTE ACLs, not
-- only PUBLIC. The new owner is retained; no role membership is granted.
DO $$ DECLARE f RECORD; g RECORD; BEGIN
  SELECT p.oid,p.proowner,p.oid::regprocedure signature INTO STRICT f FROM pg_proc p
    WHERE p.oid='admin.venue_people_read(text,uuid,date,date,uuid,uuid,text,text,text,text,integer,integer,boolean)'::regprocedure;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC CASCADE',f.signature);
  FOR g IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
    JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=f.oid AND a.grantee<>f.proowner LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I CASCADE',f.signature,g.rolname);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION admin.venue_people_read(TEXT,UUID,DATE,DATE,UUID,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,BOOLEAN)
  TO qigong_api_runtime;
-- No table ownership, runtime SELECT, role membership, BYPASSRLS or writes to attendance.
