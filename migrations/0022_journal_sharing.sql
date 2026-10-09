-- Explicitly approved regional private reading; other reporting templates stay unchanged.
INSERT INTO admin.role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM admin.roles r CROSS JOIN admin.permissions p
WHERE r.code='regional_viewer' AND p.code='checkin.read_private_note' ON CONFLICT DO NOTHING;
UPDATE admin.sessions SET revoked_at=CURRENT_TIMESTAMP WHERE revoked_at IS NULL
AND principal_id IN (SELECT g.principal_id FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id WHERE r.code='regional_viewer');
INSERT INTO audit.events(request_id,action,target_type,outcome,metadata)
VALUES(gen_random_uuid(),'journal.regional_read_enabled','role_template','success','{"role":"regional_viewer","scope":"region","migration":"0022"}');

CREATE OR REPLACE FUNCTION admin.save_feeling_tags(input_version INTEGER,input_tags JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_version INTEGER; item JSONB; target UUID; position INTEGER:=0;
BEGIN
  PERFORM pg_advisory_xact_lock(1919,1);
  IF NOT EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.principals a ON a.id=g.principal_id JOIN admin.role_permissions rp ON rp.role_id=g.role_id JOIN admin.permissions p ON p.id=rp.permission_id
    WHERE a.id=admin.request_principal_id() AND a.status='active' AND p.code='taxonomy.manage' AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()))
  THEN RAISE EXCEPTION 'tag management denied' USING ERRCODE='42501'; END IF;
  IF input_tags IS NULL OR jsonb_typeof(input_tags)<>'array' OR jsonb_array_length(input_tags)>30
  THEN RAISE EXCEPTION 'invalid feeling tags'; END IF;
  SELECT version INTO current_version FROM core.practice_feeling_tag_state FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.principals a ON a.id=g.principal_id JOIN admin.role_permissions rp ON rp.role_id=g.role_id JOIN admin.permissions p ON p.id=rp.permission_id WHERE a.id=admin.request_principal_id() AND a.status='active' AND p.code='taxonomy.manage' AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp())) THEN RAISE EXCEPTION 'tag management denied' USING ERRCODE='42501'; END IF;
  IF input_version IS DISTINCT FROM current_version THEN RAISE EXCEPTION 'tag version conflict' USING ERRCODE='40001'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(input_tags) LOOP
    IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'name_zh_tw') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'name_en') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'active') IS DISTINCT FROM 'boolean'
      OR length(trim(item->>'name_zh_tw')) NOT BETWEEN 1 AND 40
      OR length(trim(item->>'name_en')) NOT BETWEEN 1 AND 80
      OR (item ? 'id' AND (item->>'id' IS NULL OR (item->>'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'))
    THEN RAISE EXCEPTION 'invalid feeling tags'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(input_tags) t WHERE t ? 'id'
    GROUP BY (t->>'id')::uuid HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(input_tags) t WHERE t ? 'id'
      AND NOT EXISTS (SELECT 1 FROM core.practice_feeling_tags WHERE id=(t->>'id')::uuid))
    OR EXISTS (SELECT 1 FROM core.practice_feeling_tags t WHERE NOT EXISTS
      (SELECT 1 FROM jsonb_array_elements(input_tags) proposed(value) WHERE (proposed.value->>'id')::uuid=t.id))
    OR EXISTS (SELECT 1 FROM (
      SELECT DISTINCT ordinal,lower(trim(label)) name FROM jsonb_array_elements(input_tags) WITH ORDINALITY x(item,ordinal),
        LATERAL (VALUES(x.item->>'name_zh_tw'),(x.item->>'name_en')) names(label)
    ) labels GROUP BY name HAVING count(*)>1)
  THEN RAISE EXCEPTION 'invalid feeling tags'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(input_tags) LOOP
    position:=position+1;
    IF item ? 'id' THEN
      UPDATE core.practice_feeling_tags SET name_zh_tw=trim(item->>'name_zh_tw'),name_en=trim(item->>'name_en'),
        active=(item->>'active')::boolean,sort_order=position WHERE id=(item->>'id')::uuid;
    ELSE
      INSERT INTO core.practice_feeling_tags(name_zh_tw,name_en,active,sort_order)
      VALUES(trim(item->>'name_zh_tw'),trim(item->>'name_en'),(item->>'active')::boolean,position);
    END IF;
  END LOOP;
  UPDATE core.practice_feeling_tag_state SET version=version+1;
  INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,outcome,metadata)
  VALUES(admin.request_id(),admin.request_principal_id(),'feeling_tags.update','feeling_tag_catalog','success',
    jsonb_build_object('version',current_version+1,'count',position));
  RETURN admin.feeling_tag_catalog();
END;
$$;

CREATE TABLE core.journal_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id UUID NOT NULL UNIQUE REFERENCES core.checkins(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES identity.people(id) ON DELETE CASCADE,
  identity_id UUID NOT NULL REFERENCES identity.platform_identities(id),
  revision INTEGER NOT NULL CHECK(revision>0),
  active BOOLEAN NOT NULL,
  external_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  share_note BOOLEAN NOT NULL,
  share_feelings BOOLEAN NOT NULL,
  alias TEXT NOT NULL CHECK(length(trim(alias)) BETWEEN 1 AND 40),
  practice_date DATE NOT NULL,
  note_snapshot TEXT NOT NULL CHECK(length(note_snapshot)<=1000),
  method_snapshot JSONB NOT NULL CHECK(jsonb_typeof(method_snapshot)='array'),
  tag_snapshot JSONB NOT NULL CHECK(jsonb_typeof(tag_snapshot)='array'),
  published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(checkin_id,person_id) REFERENCES core.checkins(id,person_id) ON DELETE CASCADE
);
CREATE INDEX journal_publications_feed_idx ON core.journal_publications(published_at DESC,id DESC) WHERE active;
CREATE TABLE platform.journal_api_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 80),
  token_hash BYTEA NOT NULL UNIQUE CHECK(octet_length(token_hash)=32),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES admin.principals(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rate_window TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rate_used INTEGER NOT NULL DEFAULT 0 CHECK(rate_used>=0)
);
ALTER TABLE core.journal_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.journal_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.journal_api_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.journal_api_clients FORCE ROW LEVEL SECURITY;
REVOKE ALL ON core.journal_publications,platform.journal_api_clients FROM PUBLIC;

CREATE FUNCTION platform.journal_source(input_checkin UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('date',c.practice_date,'note',coalesce(n.practice_note,''),
    'tags',(SELECT coalesce(jsonb_agg(jsonb_build_object('zh_TW',t.name_zh_tw,'en',t.name_en) ORDER BY t.sort_order,t.tag_id),'[]') FROM core.checkin_note_tags t WHERE t.checkin_id=c.id),
    'methods',(SELECT coalesce(jsonb_agg(jsonb_build_object('zh_TW',m.name_zh_tw,'en',m.name_en) ORDER BY m.sort_order,m.code),'[]') FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=c.id))
  FROM core.checkins c LEFT JOIN core.checkin_notes n ON n.checkin_id=c.id WHERE c.id=input_checkin
$$;

CREATE FUNCTION platform.journal_person(input_token TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;
BEGIN
  target:=platform.practice_person('telegram',input_token);
  PERFORM 1 FROM identity.people WHERE id=target FOR UPDATE;
  IF platform.practice_person('telegram',input_token) IS DISTINCT FROM target
    OR NOT EXISTS(SELECT 1 FROM platform.telegram_checkin_links WHERE token_hash=public.digest(input_token,'sha256') AND expires_at>clock_timestamp())
  THEN RAISE EXCEPTION 'practice identity unavailable'; END IF;
  RETURN target;
END;
$$;
CREATE FUNCTION platform.journal_own(input_token TEXT,input_page INTEGER,input_locale TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; result JSONB;
BEGIN
  target:=platform.journal_person(input_token);
  IF input_page IS NULL OR input_page NOT BETWEEN 1 AND 100000 OR input_locale IS NULL OR input_locale NOT IN ('en','zh_TW') THEN RAISE EXCEPTION 'invalid journal query'; END IF;
  WITH visible AS (
    SELECT c.id,c.practice_date,n.practice_note,p.revision,p.active,p.alias,p.external_enabled,p.share_note,p.share_feelings,p.note_snapshot,p.tag_snapshot,p.method_snapshot
    FROM core.checkins c JOIN core.checkin_notes n ON n.checkin_id=c.id
      LEFT JOIN core.journal_publications p ON p.checkin_id=c.id
    WHERE c.person_id=target AND (n.practice_note<>'' OR EXISTS(SELECT 1 FROM core.checkin_note_tags t WHERE t.checkin_id=c.id))
  ), entries AS (SELECT * FROM visible ORDER BY practice_date DESC,id DESC LIMIT 20 OFFSET (input_page-1)*20)
  SELECT jsonb_build_object('page',input_page,'total',(SELECT count(*) FROM visible),'entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'sourceHash',encode(public.digest(platform.journal_source(e.id)::text,'sha256'),'hex'),
    'checkinId',e.id,'date',e.practice_date,'practiceNote',e.practice_note,'version',coalesce(e.revision,0),'active',coalesce(e.active,FALSE),
    'alias',coalesce(e.alias,''),'externalEnabled',coalesce(e.external_enabled,FALSE),'shareNote',coalesce(e.share_note,FALSE),'shareFeelings',coalesce(e.share_feelings,FALSE),
    'methods',(SELECT coalesce(jsonb_agg(CASE WHEN input_locale='en' THEN m.name_en ELSE m.name_zh_tw END ORDER BY m.sort_order,m.code),'[]') FROM core.checkin_method_selections s JOIN core.practice_methods m ON m.id=s.practice_method_id WHERE s.checkin_id=e.id),
    'publishedNote',e.note_snapshot,'publishedTags',e.tag_snapshot,'publishedMethods',e.method_snapshot,
    'feelingTags',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.tag_id,'name',CASE WHEN input_locale='en' THEN t.name_en ELSE t.name_zh_tw END) ORDER BY t.sort_order,t.tag_id),'[]') FROM core.checkin_note_tags t WHERE t.checkin_id=e.id)
    ) ORDER BY e.practice_date DESC,e.id DESC) FROM entries e),'[]')) INTO result;
  RETURN result;
END;
$$;
CREATE FUNCTION platform.journal_publish(input_token TEXT,input_checkin UUID,input_version INTEGER,input_active BOOLEAN,input_note BOOLEAN,input_feelings BOOLEAN,input_external BOOLEAN,input_alias TEXT,input_source_hash TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; ident UUID; current_revision INTEGER; practice DATE; note TEXT; tags JSONB; methods JSONB; source JSONB; result JSONB;
BEGIN
  target:=platform.journal_person(input_token);
  IF input_version IS NULL OR input_version<0 OR input_active IS NULL OR input_note IS NULL OR input_feelings IS NULL OR input_external IS NULL
    OR input_alias IS NULL OR length(trim(input_alias)) NOT BETWEEN 1 AND 40 OR input_alias ~ '[[:cntrl:]]'
  THEN RAISE EXCEPTION 'invalid journal publication'; END IF;
  SELECT c.practice_date,coalesce(n.practice_note,'') INTO practice,note FROM core.checkins c
    LEFT JOIN core.checkin_notes n ON n.checkin_id=c.id WHERE c.id=input_checkin AND c.person_id=target;
  IF NOT FOUND THEN RAISE EXCEPTION 'journal unavailable'; END IF;
  SELECT revision INTO current_revision FROM core.journal_publications WHERE checkin_id=input_checkin FOR UPDATE;
  IF coalesce(current_revision,0)<>input_version THEN RAISE EXCEPTION 'journal version conflict' USING ERRCODE='40001'; END IF;
  IF NOT input_active THEN
    IF current_revision IS NULL THEN RETURN jsonb_build_object('version',0,'active',FALSE); END IF;
    UPDATE core.journal_publications SET active=FALSE,external_enabled=FALSE,revision=revision+1 WHERE checkin_id=input_checkin RETURNING jsonb_build_object('version',revision,'active',active) INTO result;
  ELSE
    SELECT i.id INTO ident FROM identity.platform_identities i JOIN platform.telegram_checkin_links l ON l.telegram_user_id=i.external_subject_id
      WHERE i.person_id=target AND i.platform='telegram' AND i.revoked_at IS NULL AND l.token_hash=public.digest(input_token,'sha256');
    source:=platform.journal_source(input_checkin);
    IF input_source_hash IS DISTINCT FROM encode(public.digest(source::text,'sha256'),'hex') THEN RAISE EXCEPTION 'journal source conflict' USING ERRCODE='40001'; END IF;
    note:=source->>'note';tags:=source->'tags';methods:=source->'methods';practice:=(source->>'date')::date;
    IF NOT input_note THEN note:=''; END IF;
    IF NOT input_feelings THEN tags:='[]'; END IF;
    IF trim(note)='' AND jsonb_array_length(tags)=0 THEN RAISE EXCEPTION 'empty journal publication'; END IF;

    INSERT INTO core.journal_publications(checkin_id,person_id,identity_id,revision,active,external_enabled,share_note,share_feelings,alias,practice_date,note_snapshot,method_snapshot,tag_snapshot)
      VALUES(input_checkin,target,ident,1,TRUE,input_external,input_note,input_feelings,trim(input_alias),practice,note,methods,tags)
      ON CONFLICT(checkin_id) DO UPDATE SET revision=journal_publications.revision+1,active=TRUE,external_enabled=EXCLUDED.external_enabled,
        share_note=EXCLUDED.share_note,share_feelings=EXCLUDED.share_feelings,alias=EXCLUDED.alias,identity_id=EXCLUDED.identity_id,
        note_snapshot=EXCLUDED.note_snapshot,method_snapshot=EXCLUDED.method_snapshot,tag_snapshot=EXCLUDED.tag_snapshot,published_at=clock_timestamp()
      RETURNING jsonb_build_object('version',revision,'active',active) INTO result;
  END IF;
  INSERT INTO audit.events(request_id,action,target_type,target_id,outcome,metadata)
    VALUES(admin.request_id(),CASE WHEN input_active THEN 'journal.publish' ELSE 'journal.withdraw' END,'journal_publication',input_checkin,'success',jsonb_build_object('version',result->'version','external',input_active AND input_external));
  RETURN result;
END;
$$;
CREATE FUNCTION core.shared_journal_feed(input_locale TEXT,input_page INTEGER,input_external BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;
BEGIN
  IF input_locale IS NULL OR input_locale NOT IN ('zh_TW','en') OR input_page IS NULL OR input_page NOT BETWEEN 1 AND 100000 OR input_external IS NULL THEN RAISE EXCEPTION 'invalid journal query'; END IF;
  WITH visible AS (
    SELECT j.* FROM core.journal_publications j JOIN identity.people p ON p.id=j.person_id
      JOIN identity.platform_identities i ON i.id=j.identity_id
    WHERE j.active AND p.status='active' AND i.revoked_at IS NULL AND i.person_id=p.id
      AND (NOT input_external OR j.external_enabled)
      AND EXISTS(SELECT 1 FROM identity.person_interaction_channels ch WHERE ch.person_id=p.id AND ch.platform_identity_id=i.id AND ch.valid_from<=CURRENT_TIMESTAMP AND ch.valid_to IS NULL)
      AND EXISTS(SELECT 1 FROM identity.onboarding_applications a WHERE a.person_id=p.id AND a.platform=i.platform AND a.external_subject_id=i.external_subject_id AND a.status='approved')
  ), entries AS (SELECT * FROM visible ORDER BY published_at DESC,id DESC LIMIT 20 OFFSET(input_page-1)*20)
  SELECT jsonb_build_object('page',input_page,'total',(SELECT count(*) FROM visible),'entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',e.id,'version',e.revision,'alias',e.alias,'date',e.practice_date,'publishedAt',e.published_at,'practiceNote',e.note_snapshot,
    'methods',(SELECT coalesce(jsonb_agg(m->>input_locale),'[]') FROM jsonb_array_elements(e.method_snapshot) m),
    'feelingTags',(SELECT coalesce(jsonb_agg(t->>input_locale),'[]') FROM jsonb_array_elements(e.tag_snapshot) t)
  ) ORDER BY e.published_at DESC,e.id DESC) FROM entries e),'[]')) INTO result;
  RETURN result;
END;
$$;
CREATE FUNCTION platform.journal_feed(input_token TEXT,input_locale TEXT,input_page INTEGER) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM platform.journal_person(input_token);
  RETURN core.shared_journal_feed(input_locale,input_page,FALSE);
END;
$$;
CREATE FUNCTION admin.issue_journal_client(input_token TEXT,input_label TEXT,input_expires TIMESTAMPTZ,input_reason TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(1919,1);
  IF admin.is_super_admin() IS NOT TRUE THEN RAISE EXCEPTION 'journal client management denied' USING ERRCODE='42501'; END IF;
  IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' OR input_label IS NULL OR length(trim(input_label)) NOT BETWEEN 1 AND 80
    OR input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500 OR input_expires IS NULL
    OR input_expires<=clock_timestamp() OR input_expires>clock_timestamp()+INTERVAL '90 days' THEN RAISE EXCEPTION 'invalid journal client'; END IF;
  INSERT INTO platform.journal_api_clients(label,token_hash,expires_at,created_by) VALUES(trim(input_label),public.digest(input_token,'sha256'),input_expires,admin.request_principal_id()) RETURNING id INTO target;
  INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,outcome,metadata) VALUES(admin.request_id(),admin.request_principal_id(),'journal.client_issue','journal_api_client',target,'success',jsonb_build_object('reason',trim(input_reason),'expiresAt',input_expires));
  RETURN target;
END;
$$;
CREATE FUNCTION admin.revoke_journal_client(input_id UUID,input_reason TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(1919,1);
  PERFORM 1 FROM platform.journal_api_clients WHERE id=input_id FOR UPDATE;
  IF admin.is_super_admin() IS NOT TRUE THEN RAISE EXCEPTION 'journal client management denied' USING ERRCODE='42501'; END IF;
  IF input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid journal client'; END IF;
  UPDATE platform.journal_api_clients SET revoked_at=clock_timestamp() WHERE id=input_id AND revoked_at IS NULL RETURNING id INTO target;
  IF target IS NULL THEN RAISE EXCEPTION 'journal client unavailable'; END IF;
  INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,outcome,metadata) VALUES(admin.request_id(),admin.request_principal_id(),'journal.client_revoke','journal_api_client',target,'success',jsonb_build_object('reason',trim(input_reason)));
  RETURN TRUE;
END;
$$;
CREATE FUNCTION platform.external_journal_feed(input_token TEXT,input_locale TEXT,input_page INTEGER) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE credential platform.journal_api_clients%ROWTYPE; now_time TIMESTAMPTZ;
BEGIN
  SELECT * INTO credential FROM platform.journal_api_clients WHERE token_hash=public.digest(input_token,'sha256') FOR UPDATE;
  now_time:=clock_timestamp();
  IF NOT FOUND OR credential.revoked_at IS NOT NULL OR credential.expires_at<=now_time THEN RAISE EXCEPTION 'journal client unauthorized' USING ERRCODE='42501'; END IF;
  IF credential.rate_window<=now_time-INTERVAL '1 minute' THEN credential.rate_used:=0;credential.rate_window:=now_time; END IF;
  IF credential.rate_used>=60 THEN RAISE EXCEPTION 'journal rate limited'; END IF;
  UPDATE platform.journal_api_clients SET rate_window=credential.rate_window,rate_used=credential.rate_used+1 WHERE id=credential.id;
  INSERT INTO audit.events(request_id,action,target_type,target_id,outcome) VALUES(admin.request_id(),'journal.external_read','journal_api_client',credential.id,'success');
  RETURN core.shared_journal_feed(input_locale,input_page,TRUE);
END;
$$;
-- Explicitly include regional viewers in ordinary approval and grant management.
ALTER TABLE admin.access_applications DROP CONSTRAINT access_applications_requested_role_check;
ALTER TABLE admin.access_applications ADD CONSTRAINT access_applications_requested_role_check CHECK(requested_role IN ('regional_admin','regional_viewer','global_viewer','coach_admin','master_admin'));

CREATE OR REPLACE FUNCTION admin.submit_access_application(input_token TEXT,input_version INTEGER,input_role TEXT,input_scope TEXT,input_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; application admin.access_applications%ROWTYPE;
BEGIN
  target:=admin.access_session_principal(input_token);
  IF target IS NULL THEN RAISE EXCEPTION 'access session unavailable' USING ERRCODE='42501'; END IF;
  -- Principal -> application throughout login/request/decision, including audit FK checks.
  PERFORM 1 FROM admin.principals WHERE id=target AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access session unavailable' USING ERRCODE='42501'; END IF;
  IF input_role IS NULL OR input_role NOT IN ('regional_admin','regional_viewer','global_viewer','coach_admin','master_admin') OR input_scope IS NULL OR length(trim(input_scope)) NOT BETWEEN 1 AND 500
    OR input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid access application'; END IF;
  SELECT * INTO application FROM admin.access_applications WHERE principal_id=target FOR UPDATE;
  IF application.version IS DISTINCT FROM input_version OR application.status NOT IN ('draft','rejected')
  THEN RAISE EXCEPTION 'access version conflict' USING ERRCODE='40001'; END IF;
  UPDATE admin.access_applications SET status='pending',version=version+1,requested_role=input_role,
    scope_description=input_scope,applicant_reason=input_reason,decision_reason=NULL,decided_by=NULL,decided_at=NULL,
    updated_at=CURRENT_TIMESTAMP WHERE principal_id=target;
  INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,outcome,metadata)
  VALUES(admin.request_id(),target,'admin_access.request','admin_principal',target::text,'success',jsonb_build_object('requestedRole',input_role));
  RETURN admin.access_status(input_token);
END;
$$;

CREATE OR REPLACE FUNCTION admin.insert_managed_role(target UUID,input_role TEXT,input_region UUID,input_cohort UUID,input_reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE grant_id UUID; role_id_value UUID; scope TEXT;
BEGIN
  PERFORM admin.require_access_manager();
  IF target IS NULL OR target=admin.request_principal_id() OR input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500
  THEN RAISE EXCEPTION 'invalid admin grant'; END IF;
  IF admin.can_manage_access_target(target) IS NOT TRUE THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM admin.principals WHERE id=target AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'principal unavailable'; END IF;
  IF input_role IN ('regional_admin','regional_viewer') AND input_region IS NOT NULL AND input_cohort IS NULL
    AND EXISTS(SELECT 1 FROM core.regions WHERE id=input_region AND active AND region_type='operational') THEN scope:='region';
  ELSIF input_role IN ('global_viewer','coach_admin','master_admin') AND input_region IS NULL AND input_cohort IS NULL THEN scope:='global';
  ELSE RAISE EXCEPTION 'invalid admin grant'; END IF;
  IF input_role='master_admin' AND admin.is_super_admin() IS NOT TRUE THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
  SELECT id INTO role_id_value FROM admin.roles WHERE code=input_role;
  IF EXISTS(SELECT 1 FROM admin.role_grants g WHERE g.principal_id=target AND g.role_id=role_id_value AND g.scope_type=scope
    AND g.region_id IS NOT DISTINCT FROM input_region AND g.cohort_id IS NOT DISTINCT FROM input_cohort
    AND (g.valid_to IS NULL OR g.valid_to>CURRENT_TIMESTAMP)) THEN RAISE EXCEPTION 'admin grant conflict' USING ERRCODE='40001'; END IF;
  INSERT INTO admin.role_grants(principal_id,role_id,scope_type,region_id,cohort_id,granted_by_principal_id,reason)
  VALUES(target,role_id_value,scope,input_region,input_cohort,admin.request_principal_id(),input_reason) RETURNING id INTO grant_id;
  UPDATE admin.sessions SET revoked_at=CURRENT_TIMESTAMP WHERE principal_id=target AND revoked_at IS NULL;
  INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,scope_type,scope_id,reason,outcome,after_data)
  VALUES(admin.request_id(),admin.request_principal_id(),'admin_access.grant','admin_principal',target::text,scope,coalesce(input_region,input_cohort),input_reason,'success',
    jsonb_build_object('grantId',grant_id,'role',input_role,'regionId',input_region,'cohortId',input_cohort));
  RETURN grant_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin.revoke_managed_role(input_grant UUID,input_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_grant admin.role_grants%ROWTYPE; role_code TEXT;
BEGIN
  PERFORM admin.require_access_manager();
  SELECT * INTO old_grant FROM admin.role_grants WHERE id=input_grant FOR UPDATE;
  IF NOT FOUND OR old_grant.principal_id=admin.request_principal_id() OR input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500
  THEN RAISE EXCEPTION 'invalid admin revocation'; END IF;
  IF old_grant.valid_to IS NOT NULL AND old_grant.valid_to<=CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'admin grant conflict' USING ERRCODE='40001'; END IF;
  SELECT code INTO role_code FROM admin.roles WHERE id=old_grant.role_id;
  IF admin.can_manage_access_target(old_grant.principal_id) IS NOT TRUE OR (admin.is_super_admin() IS NOT TRUE AND role_code NOT IN ('regional_admin','regional_viewer','global_viewer','coach_admin'))
  THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
  IF role_code='super_admin' AND NOT EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id
    JOIN admin.principals p ON p.id=g.principal_id WHERE g.principal_id<>old_grant.principal_id AND p.status='active'
      AND r.code='super_admin' AND g.scope_type='global' AND g.valid_from<=CURRENT_TIMESTAMP
      AND (g.valid_to IS NULL OR g.valid_to>CURRENT_TIMESTAMP)) THEN RAISE EXCEPTION 'last super admin protected'; END IF;
  UPDATE admin.role_grants SET valid_to=greatest(CURRENT_TIMESTAMP,valid_from+INTERVAL '1 microsecond') WHERE id=input_grant;
  UPDATE admin.sessions SET revoked_at=CURRENT_TIMESTAMP WHERE principal_id=old_grant.principal_id AND revoked_at IS NULL;
  INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,reason,outcome,before_data)
  VALUES(admin.request_id(),admin.request_principal_id(),'admin_access.revoke','admin_principal',old_grant.principal_id::text,input_reason,'success',
    jsonb_build_object('grantId',old_grant.id,'role',role_code,'regionId',old_grant.region_id,'cohortId',old_grant.cohort_id));
END;
$$;

CREATE OR REPLACE FUNCTION admin.edit_managed_role(input_grant UUID,input_version INTEGER,input_role TEXT,input_region UUID,input_cohort UUID,input_reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; old_grant admin.role_grants%ROWTYPE; old_code TEXT; replacement UUID;
BEGIN
 PERFORM admin.require_access_manager();
 SELECT principal_id INTO target FROM admin.role_grants WHERE id=input_grant;
 IF NOT FOUND THEN RAISE EXCEPTION 'admin grant conflict' USING ERRCODE='40001'; END IF;
 PERFORM admin.require_grant_snapshot(target,input_version);
 SELECT * INTO old_grant FROM admin.role_grants WHERE id=input_grant FOR UPDATE;
 SELECT code INTO old_code FROM admin.roles WHERE id=old_grant.role_id;
 IF old_code NOT IN ('regional_admin','regional_viewer','global_viewer','coach_admin','master_admin') THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
 IF old_code=input_role AND old_grant.region_id IS NOT DISTINCT FROM input_region AND old_grant.cohort_id IS NOT DISTINCT FROM input_cohort
 THEN RAISE EXCEPTION 'admin grant conflict' USING ERRCODE='40001'; END IF;
 PERFORM admin.revoke_managed_role_versioned(input_grant,input_version,input_reason);
 -- Failure of scope/permission/duplicate validation rolls the revocation back as well.
 replacement:=admin.add_managed_role(target,input_role,input_region,input_cohort,input_reason);
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,reason,outcome,before_data,after_data)
 VALUES(admin.request_id(),admin.request_principal_id(),'admin_access.edit','admin_principal',target::text,input_reason,'success',to_jsonb(old_grant),jsonb_build_object('grantId',replacement,'role',input_role,'regionId',input_region,'cohortId',input_cohort));
 RETURN replacement;
END;
$$;

CREATE OR REPLACE FUNCTION admin.revoke_all_managed_roles(target UUID,input_version INTEGER,input_reason TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_grant admin.role_grants%ROWTYPE; total INTEGER:=0; snapshot JSONB;
BEGIN
 PERFORM admin.require_grant_snapshot(target,input_version);
 IF input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid admin revocation'; END IF;
 SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) INTO snapshot FROM admin.role_grants g WHERE principal_id=target AND (valid_to IS NULL OR valid_to>clock_timestamp());
 IF snapshot IS NULL THEN RAISE EXCEPTION 'admin grant conflict' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id WHERE g.principal_id=target AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()) AND (g.valid_from>clock_timestamp() OR (NOT admin.is_super_admin() AND r.code NOT IN ('regional_admin','regional_viewer','global_viewer','coach_admin'))))
 THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
 FOR old_grant IN SELECT * FROM admin.role_grants WHERE principal_id=target AND (valid_to IS NULL OR valid_to>clock_timestamp()) ORDER BY id FOR UPDATE LOOP
  PERFORM admin.revoke_managed_role(old_grant.id,input_reason); total:=total+1;
 END LOOP;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,reason,outcome,before_data)
 VALUES(admin.request_id(),admin.request_principal_id(),'admin_access.revoke_all','admin_principal',target::text,input_reason,'success',snapshot);
 RETURN total;
END;
$$;

CREATE OR REPLACE FUNCTION admin.access_admin_list(input_page INTEGER,input_status TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;
BEGIN
  IF admin.can_manage_admin_access() IS NOT TRUE THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
  IF input_page IS NULL OR input_page NOT BETWEEN 1 AND 100000 OR input_status IS NULL
    OR input_status NOT IN ('authorized','all','draft','pending','approved','rejected','provisioned') THEN RAISE EXCEPTION 'invalid access query'; END IF;
  WITH visible AS (
    SELECT p.*,a.status application_status,a.version,a.requested_role,a.scope_description,a.applicant_reason,a.decision_reason
    FROM admin.principals p LEFT JOIN admin.access_applications a ON a.principal_id=p.id
    WHERE input_status='all' OR coalesce(a.status,'provisioned')=input_status OR (input_status='authorized' AND EXISTS(SELECT 1 FROM admin.role_grants g WHERE g.principal_id=p.id AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp())))
  ), entries AS (SELECT * FROM visible ORDER BY created_at DESC,id LIMIT 20 OFFSET (input_page-1)*20)
  SELECT jsonb_build_object('page',input_page,'total',(SELECT count(*) FROM visible),'entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'principalId',p.id,'name',p.display_name,'email',p.email,'issuer',p.oidc_issuer,'subject',p.oidc_subject,'accountStatus',p.status,
    'status',coalesce(p.application_status,'provisioned'),'version',p.version,'requestedRole',p.requested_role,'canManage',admin.can_manage_access_target(p.id),'grantVersion',p.access_grant_version,
    'canRevokeAll',admin.can_manage_access_target(p.id) AND EXISTS(SELECT 1 FROM admin.role_grants g WHERE g.principal_id=p.id AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp())) AND NOT EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id WHERE g.principal_id=p.id AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()) AND (g.valid_from>clock_timestamp() OR (NOT admin.is_super_admin() AND r.code NOT IN ('regional_admin','regional_viewer','global_viewer','coach_admin')))),
    'scopeDescription',p.scope_description,'applicantReason',p.applicant_reason,'decisionReason',p.decision_reason,
    'grants',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'role',r.code,'scopeType',g.scope_type,'regionId',g.region_id,'cohortId',g.cohort_id,
      'scopeName',coalesce(region.name_zh_tw,cohort.name),'validFrom',g.valid_from,'validTo',g.valid_to,
      'canRevoke',admin.can_manage_access_target(p.id) AND (admin.is_super_admin() OR r.code IN ('regional_admin','regional_viewer','global_viewer','coach_admin')),
      'canEdit',admin.can_manage_access_target(p.id) AND p.status='active' AND r.code IN ('regional_admin','regional_viewer','global_viewer','coach_admin','master_admin') AND (r.code<>'master_admin' OR admin.is_super_admin()),
      'effective',p.status='active' AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()),
      'scheduled',g.valid_from>clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()),
      'active',g.valid_from<=CURRENT_TIMESTAMP AND (g.valid_to IS NULL OR g.valid_to>CURRENT_TIMESTAMP)) ORDER BY g.created_at),'[]'::jsonb)
      FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id LEFT JOIN core.regions region ON region.id=g.region_id LEFT JOIN core.cohorts cohort ON cohort.id=g.cohort_id WHERE g.principal_id=p.id)
  ) ORDER BY p.created_at DESC,p.id) FROM entries p),'[]'::jsonb),
    'regions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'nameZhTw',name_zh_tw,'nameEn',name_en) ORDER BY code,id),'[]'::jsonb) FROM core.regions WHERE active AND region_type='operational'),
    'cohorts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'regionId',c.region_id) ORDER BY c.name,c.id),'[]'::jsonb) FROM core.cohorts c JOIN core.regions r ON r.id=c.region_id WHERE c.active AND r.active),
    'canAssignMaster',admin.is_super_admin(),
    'roles',(SELECT jsonb_agg(jsonb_build_object('code',r.code,'permissions',(SELECT jsonb_agg(p.code ORDER BY p.code) FROM admin.role_permissions rp JOIN admin.permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id)) ORDER BY r.code) FROM admin.roles r WHERE r.code IN ('regional_admin','regional_viewer','global_viewer','coach_admin','master_admin') AND (r.code<>'master_admin' OR admin.is_super_admin()))
  ) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION ops.journal_workspace_schema_ready() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT max(version)='0022_journal_sharing.sql' FROM public.schema_migrations $$;
DO $$ DECLARE fn RECORD; BEGIN
  FOR fn IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='platform' AND p.proname IN ('journal_source','journal_person','journal_own','journal_publish','journal_feed','external_journal_feed'))
      OR (n.nspname='core' AND p.proname='shared_journal_feed')
      OR (n.nspname='admin' AND p.proname IN ('issue_journal_client','revoke_journal_client')) OR (n.nspname='ops' AND p.proname='journal_workspace_schema_ready')
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn.signature); END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION platform.journal_own(TEXT,INTEGER,TEXT),platform.journal_publish(TEXT,UUID,INTEGER,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,TEXT,TEXT),
  platform.journal_feed(TEXT,TEXT,INTEGER),platform.external_journal_feed(TEXT,TEXT,INTEGER),admin.issue_journal_client(TEXT,TEXT,TIMESTAMPTZ,TEXT),admin.revoke_journal_client(UUID,TEXT) TO qigong_api_runtime;
GRANT EXECUTE ON FUNCTION ops.journal_workspace_schema_ready() TO qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-7-journal-sharing',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
