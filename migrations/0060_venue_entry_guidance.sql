-- Read-only NFC-primary / QR-secondary entry guidance, never attendance authority.
-- Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
-- No business-row changes, runtime membership, or changes to the strict write resolver.
SET LOCAL search_path = pg_catalog;

DO $$ DECLARE role_name TEXT; role_oid OID; BEGIN
  FOREACH role_name IN ARRAY ARRAY['qigong_venue_entry_reader','qigong_venue_entry_identity_reader'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      RAISE EXCEPTION 'venue entry roles must be new isolated roles';
    END IF;
    EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',role_name);
    SELECT oid INTO role_oid FROM pg_roles WHERE rolname=role_name;
    IF EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid=role_oid OR member=role_oid) THEN
      RAISE EXCEPTION 'unexpected venue entry role membership';
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA core,platform TO qigong_venue_entry_reader;
GRANT USAGE ON SCHEMA identity,platform TO qigong_venue_entry_identity_reader;
GRANT SELECT(code,name_zh_tw,name_en,is_active,timezone,active_time_rules,region_id)
  ON core.practice_fields TO qigong_venue_entry_reader;
GRANT SELECT(id,parent_region_id,region_type,active)
  ON core.regions TO qigong_venue_entry_reader;
GRANT SELECT(id,status) ON identity.people TO qigong_venue_entry_identity_reader;
GRANT SELECT(id,person_id,platform,external_subject_id,revoked_at,verified_at)
  ON identity.platform_identities TO qigong_venue_entry_identity_reader;
GRANT SELECT(person_id,platform_identity_id,valid_from,valid_to)
  ON identity.person_interaction_channels TO qigong_venue_entry_identity_reader;
GRANT SELECT(person_id,platform,external_subject_id,status)
  ON identity.onboarding_applications TO qigong_venue_entry_identity_reader;

-- Five existing venue/identity tables have ENABLE + FORCE RLS. core.regions does
-- not currently enable RLS: retain that setting, with an owner-only policy ready
-- for future enforcement, and grant only the four hierarchy-validation columns.
-- Never weaken existing policies or trust caller-supplied person/principal GUCs.
CREATE POLICY venue_entry_public_fields ON core.practice_fields
  FOR SELECT TO qigong_venue_entry_reader USING(TRUE);
CREATE POLICY venue_entry_public_regions ON core.regions
  FOR SELECT TO qigong_venue_entry_reader USING(TRUE);
CREATE POLICY venue_entry_subject_identity ON identity.platform_identities
  FOR SELECT TO qigong_venue_entry_identity_reader
  USING(platform='line' AND external_subject_id=current_setting('qigong.venue_entry_subject',TRUE));
CREATE POLICY venue_entry_subject_application ON identity.onboarding_applications
  FOR SELECT TO qigong_venue_entry_identity_reader
  USING(platform='line' AND external_subject_id=current_setting('qigong.venue_entry_subject',TRUE));
CREATE POLICY venue_entry_subject_person ON identity.people
  FOR SELECT TO qigong_venue_entry_identity_reader
  USING(EXISTS(SELECT 1 FROM identity.platform_identities i WHERE i.person_id=people.id));
CREATE POLICY venue_entry_subject_channel ON identity.person_interaction_channels
  FOR SELECT TO qigong_venue_entry_identity_reader
  USING(EXISTS(SELECT 1 FROM identity.platform_identities i WHERE i.person_id=person_interaction_channels.person_id));

-- Input-only context, NOT an authorization helper. Runtime cannot pass a clock.
-- relevantSession = the open session, otherwise today's scheduled session, else null.
-- nextSession = first session with opensAt strictly after observedAt (may be relevantSession).
-- Use 0058 local date + time AT TIME ZONE and elapsed 30-minute semantics for
-- usable occurrences: no extra calendar-day veto, and end 24:00 survives.
-- Scan 0..15 dates: a weekly next-day session may currently be open at offset 1,
-- with its next opening at offset 8, or offset 15 after one unusable occurrence.
-- Skip future DST-collapsed/inverted intervals; they supply no session timestamps.
-- A valid covering session + 0058 TRUE wins. Otherwise an unusable today, or a
-- legacy TRUE without a usable covering session, fails closed as unavailable.
CREATE FUNCTION platform.venue_entry_schedule_context(rules JSONB, zone TEXT, at_time TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog SET row_security = on AS $$
DECLARE today DATE; session_day DATE; start_text TEXT; end_text TEXT; days JSONB;
  offset_day INTEGER; starts_at TIMESTAMPTZ; ends_at TIMESTAMPTZ; opens_at TIMESTAMPTZ;
  candidate JSONB; relevant JSONB; upcoming JSONB; today_session JSONB;
  state TEXT; is_open BOOLEAN; today_ends TIMESTAMPTZ; today_opens TIMESTAMPTZ;
  today_invalid BOOLEAN:=FALSE;
BEGIN
  IF rules IS NULL OR zone IS NULL OR at_time IS NULL OR NOT isfinite(at_time)
    OR jsonb_typeof(rules) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('availability','unavailable','relevantSession',NULL,'nextSession',NULL);
  END IF;
  start_text:=rules->>'start_time'; end_text:=rules->>'end_time'; days:=rules->'day_of_week';
  IF jsonb_typeof(rules->'start_time') IS DISTINCT FROM 'string'
    OR jsonb_typeof(rules->'end_time') IS DISTINCT FROM 'string'
    OR start_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR end_text !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
    OR start_text >= end_text OR jsonb_typeof(days) IS DISTINCT FROM 'array'
    OR jsonb_array_length(days) NOT BETWEEN 1 AND 7 THEN
    RETURN jsonb_build_object('availability','unavailable','relevantSession',NULL,'nextSession',NULL);
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(days) d
      WHERE jsonb_typeof(d) IS DISTINCT FROM 'number' OR d::text !~ '^[0-6]$')
    OR (SELECT count(DISTINCT d) FROM jsonb_array_elements(days) d) <> jsonb_array_length(days)
    OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN
    RETURN jsonb_build_object('availability','unavailable','relevantSession',NULL,'nextSession',NULL);
  END IF;
  today:=(at_time AT TIME ZONE zone)::date;
  is_open:=platform.venue_checkin_window(rules,zone,at_time);
  FOR offset_day IN 0..15 LOOP
    session_day:=today+offset_day;
    IF days @> jsonb_build_array(EXTRACT(DOW FROM session_day)::int) THEN
      starts_at:=(session_day+start_text::time) AT TIME ZONE zone;
      ends_at:=(session_day+end_text::time) AT TIME ZONE zone;
      opens_at:=starts_at-INTERVAL '30 minutes';
      IF ends_at<=starts_at THEN
        IF offset_day=0 THEN today_invalid:=TRUE; END IF;
        CONTINUE;
      END IF;
      candidate:=jsonb_build_object('startsAt',starts_at,'endsAt',ends_at,'opensAt',opens_at);
      IF offset_day=0 THEN
        today_session:=candidate; today_ends:=ends_at; today_opens:=opens_at;
      END IF;
      IF at_time>=opens_at AND at_time<ends_at AND offset_day<=1 THEN relevant:=candidate; END IF;
      IF upcoming IS NULL AND opens_at>at_time THEN upcoming:=candidate; END IF;
    END IF;
  END LOOP;
  IF is_open THEN
    IF relevant IS NULL THEN
      RETURN jsonb_build_object('availability','unavailable','relevantSession',NULL,'nextSession',NULL);
    END IF;
    state:='open';
  ELSE
    IF today_invalid THEN
      RETURN jsonb_build_object('availability','unavailable','relevantSession',NULL,'nextSession',NULL);
    END IF;
    relevant:=today_session;
    state:=CASE WHEN today_session IS NULL THEN 'not_activity_day'
      WHEN at_time<today_opens THEN 'before_open'
      WHEN at_time>=today_ends THEN 'ended' ELSE 'unavailable' END;
  END IF;
  RETURN jsonb_build_object('availability',state,'relevantSession',relevant,'nextSession',upcoming);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('availability','unavailable','relevantSession',NULL,'nextSession',NULL);
END $$;
ALTER FUNCTION platform.venue_entry_schedule_context(JSONB,TEXT,TIMESTAMPTZ) OWNER TO qigong_venue_entry_reader;

-- Canonical public DTO v1: availability, venue:null|{code,name,timezone}, observedAt,
-- relevantSession:null|{startsAt,endsAt,opensAt}, nextSession:same. Timestamps are
-- full timestamptz strings, not local HH:mm; display using venue.timezone.
-- Unknown valid codes return only the coarse not_found state, never internal IDs.
CREATE FUNCTION platform.venue_entry_availability(input_code TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on AS $$
DECLARE observed_at TIMESTAMPTZ:=clock_timestamp(); venue RECORD; data JSONB; context JSONB;
BEGIN
  IF input_code IS NULL OR length(input_code)>64
    OR input_code !~ '^[a-z][a-z0-9]*(-[a-z0-9]+)+$' THEN
    RAISE EXCEPTION 'venue_entry_invalid' USING ERRCODE='22023';
  END IF;
  data:=jsonb_build_object('version',1,'availability','not_found','venue',NULL,
    'observedAt',observed_at,'relevantSession',NULL,'nextSession',NULL);
  BEGIN
    SELECT code,name_zh_tw,is_active,timezone,active_time_rules,region_id INTO venue
      FROM core.practice_fields WHERE code=input_code;
    IF NOT FOUND THEN RETURN data; END IF;
    data:=data||jsonb_build_object('venue',jsonb_build_object('code',venue.code,'name',venue.name_zh_tw,'timezone',venue.timezone));
    -- Standard entry never enables the public test site or an inactive/broken
    -- three-tier hierarchy. Trusted debug remains a separate server-owned flow.
    IF NOT venue.is_active OR venue.code='tw-location-test' OR NOT EXISTS(
      SELECT 1 FROM core.regions operational
      JOIN core.regions country ON country.id=operational.parent_region_id
      JOIN core.regions global_region ON global_region.id=country.parent_region_id
      WHERE operational.id=venue.region_id AND operational.region_type='operational' AND operational.active
        AND country.region_type='country' AND country.active
        AND global_region.region_type='global' AND global_region.active AND global_region.parent_region_id IS NULL
    ) THEN RETURN data||jsonb_build_object('availability','disabled'); END IF;
    context:=platform.venue_entry_schedule_context(venue.active_time_rules,venue.timezone,observed_at);
    RETURN data||context;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('version',1,'availability','unavailable','venue',NULL,
      'observedAt',observed_at,'relevantSession',NULL,'nextSession',NULL);
  END;
END $$;
ALTER FUNCTION platform.venue_entry_availability(TEXT) OWNER TO qigong_venue_entry_reader;

-- Canonical private DTO v1: {version:1,status:needs_application|pending|approved|blocked}.
-- SERVER must verify LINE issuer/audience/signature/expiry before supplying subject.
-- No subject echo, IDs, contact lookup, consent acceptance or onboarding writes.
-- SET gives this function a fresh scope and automatically restores it on return/error;
-- a forged incoming GUC never substitutes for input_subject.
CREATE FUNCTION platform.venue_entry_learner_status(input_subject TEXT)
RETURNS JSONB LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET row_security = on SET qigong.venue_entry_subject = '' AS $$
DECLARE observed_at TIMESTAMPTZ:=clock_timestamp(); linked RECORD; application RECORD;
  person_status TEXT; result TEXT;
BEGIN
  IF input_subject IS NULL OR input_subject !~ '^U[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'venue_entry_invalid' USING ERRCODE='22023';
  END IF;
  PERFORM set_config('qigong.venue_entry_subject',input_subject,TRUE);
  SELECT id,person_id,revoked_at,verified_at INTO linked FROM identity.platform_identities
    WHERE platform='line' AND external_subject_id=input_subject;
  SELECT person_id,status INTO application FROM identity.onboarding_applications
    WHERE platform='line' AND external_subject_id=input_subject;
  IF linked.id IS NOT NULL THEN
    SELECT status INTO person_status FROM identity.people WHERE id=linked.person_id;
    IF linked.revoked_at IS NOT NULL OR linked.verified_at>observed_at
      OR person_status IS DISTINCT FROM 'active'
      OR NOT EXISTS(SELECT 1 FROM identity.person_interaction_channels c
        WHERE c.person_id=linked.person_id AND c.platform_identity_id=linked.id
          AND c.valid_from<=observed_at AND (c.valid_to IS NULL OR c.valid_to>observed_at)) THEN
      RETURN jsonb_build_object('version',1,'status','blocked');
    END IF;
  END IF;
  result:=CASE WHEN application.status='pending' THEN 'pending'
    WHEN application.status='approved' AND linked.id IS NOT NULL
      AND application.person_id=linked.person_id THEN 'approved'
    WHEN application.status IS NULL AND linked.id IS NULL THEN 'needs_application'
    ELSE 'blocked' END;
  RETURN jsonb_build_object('version',1,'status',result);
END $$;
ALTER FUNCTION platform.venue_entry_learner_status(TEXT) OWNER TO qigong_venue_entry_identity_reader;

-- Remove arbitrary migration-owner default ACL residue on these three NEW functions
-- only. The old helper's existing owner/writer/debug ACLs remain unchanged.
DO $$ DECLARE f RECORD; g RECORD; BEGIN
  FOR f IN SELECT p.oid,p.proowner,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE p.oid=ANY(ARRAY['platform.venue_entry_schedule_context(jsonb,text,timestamptz)'::regprocedure,
      'platform.venue_entry_availability(text)'::regprocedure,
      'platform.venue_entry_learner_status(text)'::regprocedure]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM PUBLIC CASCADE',f.nspname,f.proname,f.args);
    FOR g IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=f.oid AND a.grantee<>f.proowner LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM %I CASCADE',f.nspname,f.proname,f.args,g.rolname);
    END LOOP;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION platform.venue_checkin_window(JSONB,TEXT,TIMESTAMPTZ) TO qigong_venue_entry_reader;
GRANT EXECUTE ON FUNCTION platform.venue_entry_availability(TEXT),platform.venue_entry_learner_status(TEXT)
  TO qigong_api_runtime;
-- No worker/PUBLIC EXECUTE, raw runtime SELECT, or role membership. The public
-- owner cannot read identity tables; the private owner cannot read venue tables.
-- Next API phase must expand venue-suite's old-helper exact ACL allowlist to the
-- three owners: qigong_venue_qr_writer, qigong_venue_debug, qigong_venue_entry_reader.
