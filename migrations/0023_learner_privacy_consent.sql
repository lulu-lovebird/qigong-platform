-- Consent and eligibility controls. The new notice is draft until explicitly published.
CREATE TABLE platform.learner_privacy_policies (
 version TEXT PRIMARY KEY,document_hash TEXT NOT NULL CHECK(document_hash ~ '^[0-9a-f]{64}$'),
 state TEXT NOT NULL CHECK(state IN ('draft','active','superseded')),published_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX one_active_learner_privacy_policy ON platform.learner_privacy_policies(state) WHERE state='active';
INSERT INTO platform.learner_privacy_policies VALUES('baiyin-checkin-supplement-v1','4a16db1e9eb64f957bf1966be45fbc471c0795a42ec4700c08fa46e8640b1184','draft',NULL);
CREATE TABLE platform.learner_privacy_sessions (
 token_hash BYTEA PRIMARY KEY,platform TEXT NOT NULL CHECK(platform IN ('telegram','line','whatsapp')),
 subject_hash BYTEA NOT NULL,expires_at TIMESTAMPTZ NOT NULL,accepted_at TIMESTAMPTZ
);
CREATE TABLE platform.learner_privacy_acceptances (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),platform TEXT NOT NULL CHECK(platform IN ('telegram','line','whatsapp')),
 subject_hash BYTEA NOT NULL,policy_version TEXT NOT NULL REFERENCES platform.learner_privacy_policies(version),
 document_hash TEXT NOT NULL,locale TEXT NOT NULL CHECK(locale IN ('zh_TW','en')),
 reflection_consent BOOLEAN NOT NULL,accepted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),revoked_at TIMESTAMPTZ,
 UNIQUE(platform,subject_hash,policy_version)
);
CREATE TABLE platform.learner_access_states (
 person_id UUID PRIMARY KEY REFERENCES identity.people(id),revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 suspended_at TIMESTAMPTZ,suspended_by UUID REFERENCES admin.principals(id),reason TEXT
);
CREATE TABLE core.checkin_privacy_origins (
 checkin_id UUID PRIMARY KEY REFERENCES core.checkins(id) ON DELETE CASCADE,
 acceptance_id UUID NOT NULL REFERENCES platform.learner_privacy_acceptances(id)
);
ALTER TABLE core.journal_publications ADD COLUMN shared_with_staff BOOLEAN NOT NULL DEFAULT FALSE;
DO $$DECLARE t TEXT;BEGIN FOREACH t IN ARRAY ARRAY['platform.learner_privacy_policies','platform.learner_privacy_sessions','platform.learner_privacy_acceptances','platform.learner_access_states','core.checkin_privacy_origins'] LOOP
 EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON %s FROM PUBLIC',t);END LOOP;END$$;
INSERT INTO admin.permissions(code,description) VALUES('journal.read_shared','Read learner-shared content, including suspended author history, not private originals');
INSERT INTO admin.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM admin.roles r CROSS JOIN admin.permissions p
 WHERE r.code IN ('super_admin','master_admin','coach_admin','global_viewer','regional_admin','regional_viewer','country_admin') AND p.code='journal.read_shared';

CREATE FUNCTION platform.privacy_subject_hash(input_platform TEXT,input_subject TEXT) RETURNS BYTEA
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT public.digest(input_platform||':'||input_subject,'sha256')$$;
CREATE FUNCTION platform.privacy_notice() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('version',version,'hash',document_hash,'active',state='active')
 FROM platform.learner_privacy_policies ORDER BY (state='active') DESC,version DESC LIMIT 1
$$;
CREATE FUNCTION platform.privacy_status(input_platform TEXT,input_subject TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy platform.learner_privacy_policies;accepted platform.learner_privacy_acceptances;unavailable BOOLEAN;
BEGIN
 IF input_platform IS NULL OR input_subject IS NULL OR NOT((input_platform IN ('telegram','whatsapp') AND input_subject ~ '^[0-9]{1,20}$') OR (input_platform='line' AND input_subject ~ '^U[0-9a-f]{32}$')) THEN RAISE EXCEPTION 'invalid privacy identity';END IF;
 SELECT EXISTS(SELECT 1 FROM identity.platform_identities i JOIN identity.people p ON p.id=i.person_id WHERE i.platform=input_platform AND i.external_subject_id=input_subject AND (p.status<>'active' OR i.revoked_at IS NOT NULL)) INTO unavailable;
 SELECT * INTO policy FROM platform.learner_privacy_policies pp WHERE pp.state='active';
 IF policy.version IS NOT NULL THEN SELECT * INTO accepted FROM platform.learner_privacy_acceptances a WHERE a.platform=input_platform AND a.subject_hash=platform.privacy_subject_hash(input_platform,input_subject) AND a.policy_version=policy.version AND a.document_hash=policy.document_hash AND a.revoked_at IS NULL;END IF;
 RETURN jsonb_build_object('active',policy.version IS NOT NULL,'required',policy.version IS NOT NULL AND accepted.id IS NULL,'unavailable',unavailable,'reflectionConsent',coalesce(accepted.reflection_consent,FALSE),'version',policy.version,'hash',policy.document_hash);
END$$;
CREATE FUNCTION platform.begin_privacy_gate(input_platform TEXT,input_subject TEXT,input_token TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state JSONB;
BEGIN
 state:=platform.privacy_status(input_platform,input_subject);
 IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'invalid privacy session';END IF;
 IF (state->>'active')::boolean AND NOT (state->>'unavailable')::boolean THEN
  INSERT INTO platform.learner_privacy_sessions(token_hash,platform,subject_hash,expires_at) VALUES(public.digest(input_token,'sha256'),input_platform,platform.privacy_subject_hash(input_platform,input_subject),clock_timestamp()+INTERVAL '15 minutes') ON CONFLICT(token_hash) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM platform.learner_privacy_sessions WHERE token_hash=public.digest(input_token,'sha256') AND platform=input_platform AND subject_hash=platform.privacy_subject_hash(input_platform,input_subject)) THEN RAISE EXCEPTION 'privacy session conflict';END IF;
 END IF;RETURN state;
END$$;
CREATE FUNCTION platform.accept_privacy(input_platform TEXT,input_token TEXT,input_version TEXT,input_hash TEXT,input_locale TEXT,input_accepted BOOLEAN,input_reflections BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE session platform.learner_privacy_sessions;policy platform.learner_privacy_policies;acceptance UUID;
BEGIN
 IF input_accepted IS NOT TRUE OR input_reflections IS NULL OR input_locale IS NULL OR input_locale NOT IN ('zh_TW','en') OR input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' THEN RAISE EXCEPTION 'invalid privacy acceptance';END IF;
 SELECT * INTO session FROM platform.learner_privacy_sessions WHERE token_hash=public.digest(input_token,'sha256') AND platform=input_platform AND expires_at>clock_timestamp() FOR UPDATE;
 IF session.token_hash IS NULL OR session.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'privacy session unavailable' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy:'||encode(session.subject_hash,'hex'),0));
 IF EXISTS(SELECT 1 FROM identity.platform_identities i JOIN identity.people p ON p.id=i.person_id WHERE i.platform=input_platform AND platform.privacy_subject_hash(i.platform,i.external_subject_id)=session.subject_hash AND (p.status<>'active' OR i.revoked_at IS NOT NULL)) THEN RAISE EXCEPTION 'learner eligibility unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO policy FROM platform.learner_privacy_policies pp WHERE pp.state='active' FOR SHARE;
 IF policy.version IS NULL OR input_version IS DISTINCT FROM policy.version OR input_hash IS DISTINCT FROM policy.document_hash THEN RAISE EXCEPTION 'privacy policy conflict' USING ERRCODE='40001';END IF;
 INSERT INTO platform.learner_privacy_acceptances(platform,subject_hash,policy_version,document_hash,locale,reflection_consent)
 VALUES(input_platform,session.subject_hash,policy.version,policy.document_hash,input_locale,input_reflections)
 ON CONFLICT(platform,subject_hash,policy_version) DO UPDATE SET reflection_consent=EXCLUDED.reflection_consent,locale=EXCLUDED.locale,revoked_at=NULL RETURNING id INTO acceptance;
 IF NOT input_reflections THEN
  UPDATE core.journal_publications j SET note_snapshot='',tag_snapshot='[]',share_note=FALSE,share_feelings=FALSE,external_enabled=FALSE,revision=j.revision+1
  WHERE j.active AND (j.note_snapshot<>'' OR jsonb_array_length(j.tag_snapshot)>0) AND EXISTS(SELECT 1 FROM identity.platform_identities i WHERE i.id=j.identity_id AND i.platform=input_platform AND platform.privacy_subject_hash(i.platform,i.external_subject_id)=session.subject_hash);
 END IF;
 UPDATE platform.learner_privacy_sessions SET accepted_at=coalesce(accepted_at,clock_timestamp()) WHERE token_hash=session.token_hash;
 INSERT INTO audit.events(request_id,action,target_type,target_id,outcome,metadata) VALUES(coalesce(admin.request_id(),gen_random_uuid()),'privacy.accept','privacy_acceptance',acceptance,'success',jsonb_build_object('version',policy.version,'locale',input_locale,'reflections',input_reflections));
 RETURN jsonb_build_object('accepted',TRUE,'version',policy.version,'reflectionConsent',input_reflections);
END$$;
CREATE FUNCTION platform.require_privacy_subject(input_platform TEXT,input_subject TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state JSONB;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM platform.learner_privacy_policies pp WHERE pp.state='active') THEN RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy:'||encode(platform.privacy_subject_hash(input_platform,input_subject),'hex'),0));
 state:=platform.privacy_status(input_platform,input_subject);
 IF (state->>'unavailable')::boolean THEN RAISE EXCEPTION 'learner eligibility unavailable' USING ERRCODE='42501';END IF;
 IF (state->>'required')::boolean THEN RAISE EXCEPTION 'privacy acceptance required' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION platform.privacy_credential_subject(input_platform TEXT,input_credential TEXT,input_purpose TEXT DEFAULT 'checkin') RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE subject TEXT;
BEGIN
 CASE input_platform
 WHEN 'line' THEN subject:=input_credential;
 WHEN 'telegram' THEN
  IF input_purpose='apply' THEN SELECT telegram_user_id INTO subject FROM platform.telegram_application_links WHERE token_hash=public.digest(input_credential,'sha256') AND expires_at>clock_timestamp() AND used_at IS NULL;
  ELSE SELECT telegram_user_id INTO subject FROM platform.telegram_checkin_links WHERE token_hash=public.digest(input_credential,'sha256') AND expires_at>clock_timestamp();END IF;
 WHEN 'whatsapp' THEN SELECT l.subject INTO subject FROM platform.whatsapp_links l WHERE token_hash=public.digest(input_credential,'sha256') AND purpose=input_purpose AND expires_at>clock_timestamp() AND (input_purpose='checkin' OR used_at IS NULL);
 ELSE RAISE EXCEPTION 'invalid privacy identity';END CASE;
 IF subject IS NULL THEN RAISE EXCEPTION 'privacy credential unavailable' USING ERRCODE='42501';END IF;RETURN subject;
END$$;
CREATE FUNCTION platform.require_privacy_token(input_platform TEXT,input_credential TEXT,input_purpose TEXT DEFAULT 'checkin') RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM platform.learner_privacy_policies pp WHERE pp.state='active') THEN RETURN;END IF;
 PERFORM platform.require_privacy_subject(input_platform,platform.privacy_credential_subject(input_platform,input_credential,input_purpose));
 PERFORM platform.privacy_credential_subject(input_platform,input_credential,input_purpose);END$$;
CREATE FUNCTION platform.require_reflection_consent(input_platform TEXT,input_credential TEXT) RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state JSONB;
BEGIN IF NOT EXISTS(SELECT 1 FROM platform.learner_privacy_policies pp WHERE pp.state='active') THEN RETURN;END IF;
 state:=platform.privacy_status(input_platform,platform.privacy_credential_subject(input_platform,input_credential));
 IF (state->>'required')::boolean OR (state->>'unavailable')::boolean OR (state->>'reflectionConsent')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'reflection consent required' USING ERRCODE='42501';END IF;END$$;
CREATE FUNCTION platform.privacy_usage(input_platform TEXT,input_credential TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state JSONB;
BEGIN IF NOT EXISTS(SELECT 1 FROM platform.learner_privacy_policies pp WHERE pp.state='active') THEN RETURN jsonb_build_object('active',FALSE,'reflectionConsent',TRUE);END IF;
 PERFORM platform.require_privacy_token(input_platform,input_credential);state:=platform.privacy_status(input_platform,platform.privacy_credential_subject(input_platform,input_credential));RETURN state;END$$;
CREATE FUNCTION admin.publish_privacy_policy(input_version TEXT,input_hash TEXT,input_reason TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(1919,1);
 IF admin.is_super_admin() IS NOT TRUE THEN RAISE EXCEPTION 'privacy publication denied' USING ERRCODE='42501';END IF;
 IF input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid privacy publication';END IF;
 IF NOT EXISTS(SELECT 1 FROM platform.learner_privacy_policies WHERE version=input_version AND document_hash=input_hash AND state IN ('draft','active')) THEN RAISE EXCEPTION 'privacy policy conflict' USING ERRCODE='40001';END IF;
 UPDATE platform.learner_privacy_policies SET state='superseded' WHERE state='active' AND version<>input_version;
 UPDATE platform.learner_privacy_policies SET state='active',published_at=coalesce(published_at,clock_timestamp()) WHERE version=input_version;
 INSERT INTO audit.events(request_id,action,target_type,outcome,reason,metadata) VALUES(coalesce(admin.request_id(),gen_random_uuid()),'privacy.publish','privacy_policy','success',trim(input_reason),jsonb_build_object('version',input_version));
END$$;

-- Keep existing public signatures; seal pre-consent implementations from runtime roles.
DO $$
DECLARE spec RECORD;signature REGPROCEDURE;arguments TEXT;result TEXT;arg_count INTEGER;call_args TEXT;legacy TEXT;body TEXT;exposed BOOLEAN;
BEGIN
 FOR spec IN SELECT * FROM (VALUES
 ('begin_telegram_application','bigint,text,text','PERFORM platform.require_privacy_subject(''telegram'',$2);'),
 ('register_telegram_onboarding','bigint,text,text,text','PERFORM platform.require_privacy_subject(''telegram'',$2);'),
 ('submit_telegram_application','text,text,text,text,text','PERFORM platform.require_privacy_token(''telegram'',$1,''apply'');'),
 ('begin_telegram_checkin','text,text','PERFORM platform.require_privacy_subject(''telegram'',$1);'),
 ('submit_telegram_checkin','text,text[],boolean','PERFORM platform.require_privacy_token(''telegram'',$1);'),
 ('telegram_checkin_person','text','PERFORM platform.require_privacy_token(''telegram'',$1);'),
 ('telegram_checkin_methods','text','PERFORM platform.require_privacy_token(''telegram'',$1);'),
 ('telegram_checkin_method_tree','text','PERFORM platform.require_privacy_token(''telegram'',$1);'),
 ('telegram_checkin_history','text','PERFORM platform.require_privacy_token(''telegram'',$1);'),
 ('telegram_checkin_history','text,text','PERFORM platform.require_privacy_token(''telegram'',$1);'),
 ('correct_telegram_checkin','text,uuid,text[]','PERFORM platform.require_privacy_token(''telegram'',$1);'),
 ('telegram_workspace_report','text,text,text,text,integer,date','PERFORM platform.require_privacy_token(''telegram'',$1);'),
 ('telegram_workspace_save','text,uuid,date,integer,text[],text,uuid[]','PERFORM platform.require_privacy_token(''telegram'',$1);IF coalesce($6,'''')<>'''' OR cardinality($7)>0 THEN PERFORM platform.require_reflection_consent(''telegram'',$1);END IF;'),
 ('telegram_workspace_timezone','text,text','PERFORM platform.require_privacy_token(''telegram'',$1);'),
 ('begin_line_link','text,text','PERFORM platform.require_privacy_subject(''line'',$1);'),
 ('submit_line_application','text,text,text,text,text,text','PERFORM platform.require_privacy_subject(''line'',$1);'),
 ('line_checkin_person','text','PERFORM platform.require_privacy_subject(''line'',$1);'),
 ('line_checkin_method_tree','text','PERFORM platform.require_privacy_subject(''line'',$1);'),
 ('line_checkin_history','text','PERFORM platform.require_privacy_subject(''line'',$1);'),
 ('submit_line_checkin','text,text[],boolean','PERFORM platform.require_privacy_subject(''line'',$1);'),
 ('correct_line_checkin','text,uuid,text[]','PERFORM platform.require_privacy_subject(''line'',$1);'),
 ('begin_whatsapp_link','text,text,text','PERFORM platform.require_privacy_subject(''whatsapp'',$1);'),
 ('whatsapp_link_subject','text,text','PERFORM platform.require_privacy_token(''whatsapp'',$1,$2);'),
 ('submit_whatsapp_application','text,text,text,text,text,text,boolean','PERFORM platform.require_privacy_token(''whatsapp'',$1,''apply'');'),
 ('whatsapp_checkin_person','text','PERFORM platform.require_privacy_subject(''whatsapp'',$1);'),
 ('whatsapp_checkin_method_tree','text','PERFORM platform.require_privacy_subject(''whatsapp'',$1);'),
 ('whatsapp_checkin_history','text','PERFORM platform.require_privacy_subject(''whatsapp'',$1);'),
 ('whatsapp_checkin_history','text,text','PERFORM platform.require_privacy_subject(''whatsapp'',$1);'),
 ('submit_whatsapp_checkin','text,text[],boolean','PERFORM platform.require_privacy_subject(''whatsapp'',$1);'),
 ('correct_whatsapp_checkin','text,uuid,text[]','PERFORM platform.require_privacy_subject(''whatsapp'',$1);'),
 ('save_practice_note','text,text,uuid,text,uuid[]','PERFORM platform.require_privacy_token($1,$2);IF coalesce($4,'''')<>'''' OR cardinality($5)>0 THEN PERFORM platform.require_reflection_consent($1,$2);END IF;'),
 ('journal_publish','text,uuid,integer,boolean,boolean,boolean,boolean,text,text','PERFORM platform.require_privacy_token(''telegram'',$1);IF $4 AND ($5 OR $6) THEN PERFORM platform.require_reflection_consent(''telegram'',$1);END IF;')
 ) AS x(name,types,gate) LOOP
 signature:=to_regprocedure('platform.'||spec.name||'('||spec.types||')');
 IF signature IS NULL THEN RAISE EXCEPTION 'privacy wrapper target missing: %',spec.name;END IF;
 SELECT pg_get_function_arguments(oid),pg_get_function_result(oid),pronargs INTO arguments,result,arg_count FROM pg_proc WHERE oid=signature;
 exposed:=has_function_privilege('qigong_api_runtime',signature,'EXECUTE');legacy:='_pre_privacy_'||spec.name;
 SELECT string_agg('$'||n,',' ORDER BY n) INTO call_args FROM generate_series(1,arg_count) n;
 EXECUTE format('ALTER FUNCTION %s RENAME TO %I',signature,legacy);
 EXECUTE format('REVOKE ALL ON FUNCTION platform.%I(%s) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime',legacy,spec.types);
 body:=spec.gate;
 IF result='void' THEN body:=body||format('PERFORM platform.%I(%s);RETURN;',legacy,call_args);
 ELSIF result LIKE 'TABLE(%' OR result LIKE 'SETOF %' THEN body:=body||format('RETURN QUERY SELECT * FROM platform.%I(%s);',legacy,call_args);
 ELSIF spec.name='journal_publish' THEN body:=body||format('DECLARE saved JSONB;BEGIN saved:=platform.%I(%s);IF $4 AND EXISTS(SELECT 1 FROM platform.learner_privacy_policies pp WHERE pp.state=''active'') THEN UPDATE core.journal_publications SET shared_with_staff=TRUE WHERE checkin_id=$2;END IF;RETURN saved;END;',legacy,call_args);
 ELSE body:=body||format('RETURN platform.%I(%s);',legacy,call_args);END IF;
 EXECUTE format('CREATE FUNCTION platform.%I(%s) RETURNS %s LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS %L',spec.name,arguments,result,'BEGIN '||body||' END');
 EXECUTE format('REVOKE ALL ON FUNCTION platform.%I(%s) FROM PUBLIC',spec.name,spec.types);
 IF exposed THEN EXECUTE format('GRANT EXECUTE ON FUNCTION platform.%I(%s) TO qigong_api_runtime',spec.name,spec.types);END IF;
 END LOOP;
END$$;

-- Worker onboarding is not a bypass around learner consent.
ALTER FUNCTION identity.submit_application(TEXT,TEXT,TEXT,UUID) RENAME TO _pre_privacy_submit_application;
REVOKE ALL ON FUNCTION identity._pre_privacy_submit_application(TEXT,TEXT,TEXT,UUID) FROM PUBLIC,qigong_api_runtime,qigong_worker_runtime;
CREATE FUNCTION identity.submit_application(requested_platform TEXT,requested_subject TEXT,requested_name TEXT,region_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM platform.require_privacy_subject(requested_platform,requested_subject);
 RETURN identity._pre_privacy_submit_application(requested_platform,requested_subject,requested_name,region_id);
END$$;
REVOKE ALL ON FUNCTION identity.submit_application(TEXT,TEXT,TEXT,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION identity.submit_application(TEXT,TEXT,TEXT,UUID) TO qigong_worker_runtime;

CREATE OR REPLACE FUNCTION platform._pre_privacy_journal_publish(input_token TEXT,input_checkin UUID,input_version INTEGER,input_active BOOLEAN,input_note BOOLEAN,input_feelings BOOLEAN,input_external BOOLEAN,input_alias TEXT,input_source_hash TEXT) RETURNS JSONB
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
    IF trim(note)='' AND jsonb_array_length(tags)=0 AND NOT (jsonb_array_length(methods)>0 AND EXISTS(SELECT 1 FROM core.checkin_privacy_origins WHERE checkin_id=input_checkin)) THEN RAISE EXCEPTION 'empty journal publication'; END IF;

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
CREATE FUNCTION core.capture_checkin_privacy_origin() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE consent UUID;
BEGIN
 SELECT a.id INTO consent FROM platform.learner_privacy_acceptances a JOIN platform.learner_privacy_policies p ON p.version=a.policy_version AND p.document_hash=a.document_hash
 JOIN identity.platform_identities i ON i.id=NEW.submitted_via_identity_id AND i.platform=a.platform AND platform.privacy_subject_hash(i.platform,i.external_subject_id)=a.subject_hash
 WHERE p.state='active' AND a.revoked_at IS NULL;
 IF consent IS NOT NULL THEN INSERT INTO core.checkin_privacy_origins VALUES(NEW.id,consent);END IF;RETURN NEW;
END$$;
CREATE TRIGGER capture_checkin_privacy_origin AFTER INSERT ON core.checkins FOR EACH ROW EXECUTE FUNCTION core.capture_checkin_privacy_origin();
CREATE FUNCTION core.refresh_default_publication() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE practice UUID;entry core.checkins;origin platform.learner_privacy_acceptances;source JSONB;prior core.journal_publications;note TEXT;tags JSONB;label TEXT;
BEGIN
 IF TG_TABLE_NAME='checkins' THEN practice:=coalesce(NEW.id,OLD.id);ELSE practice:=coalesce(NEW.checkin_id,OLD.checkin_id);END IF;
 SELECT c.* INTO entry FROM core.checkins c WHERE c.id=practice;
 IF entry.id IS NULL THEN RETURN NULL;END IF;
 SELECT a.* INTO origin FROM core.checkin_privacy_origins o JOIN platform.learner_privacy_acceptances a ON a.id=o.acceptance_id WHERE o.checkin_id=practice AND a.revoked_at IS NULL;
 IF origin.id IS NULL OR NOT EXISTS(SELECT 1 FROM identity.people WHERE id=entry.person_id AND status='active') THEN RETURN NULL;END IF;
 source:=platform.journal_source(practice);note:=CASE WHEN origin.reflection_consent THEN source->>'note' ELSE '' END;tags:=CASE WHEN origin.reflection_consent THEN source->'tags' ELSE '[]'::jsonb END;
 SELECT * INTO prior FROM core.journal_publications WHERE checkin_id=practice FOR UPDATE;
 IF prior.id IS NOT NULL AND NOT prior.active THEN RETURN NULL;END IF;
 IF prior.id IS NOT NULL AND prior.note_snapshot=note AND prior.tag_snapshot=tags AND prior.method_snapshot=source->'methods' THEN RETURN NULL;END IF;
 label:=coalesce(prior.alias,'Learner '||substr(encode(public.digest(entry.person_id::text,'sha256'),'hex'),1,8));
 INSERT INTO core.journal_publications(checkin_id,person_id,identity_id,revision,active,external_enabled,share_note,share_feelings,alias,practice_date,note_snapshot,method_snapshot,tag_snapshot,shared_with_staff)
 VALUES(practice,entry.person_id,entry.submitted_via_identity_id,1,TRUE,FALSE,note<>'',jsonb_array_length(tags)>0,label,entry.practice_date,note,source->'methods',tags,TRUE)
 ON CONFLICT(checkin_id) DO UPDATE SET revision=journal_publications.revision+1,external_enabled=FALSE,note_snapshot=EXCLUDED.note_snapshot,method_snapshot=EXCLUDED.method_snapshot,tag_snapshot=EXCLUDED.tag_snapshot,share_note=EXCLUDED.share_note,share_feelings=EXCLUDED.share_feelings,shared_with_staff=TRUE,published_at=clock_timestamp();
 RETURN NULL;
END$$;
CREATE CONSTRAINT TRIGGER default_publication_checkin AFTER INSERT OR UPDATE ON core.checkins DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.refresh_default_publication();
CREATE CONSTRAINT TRIGGER default_publication_methods AFTER INSERT OR DELETE ON core.checkin_method_selections DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.refresh_default_publication();
CREATE CONSTRAINT TRIGGER default_publication_notes AFTER INSERT OR UPDATE ON core.checkin_notes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.refresh_default_publication();
CREATE CONSTRAINT TRIGGER default_publication_tags AFTER INSERT OR DELETE ON core.checkin_note_tags DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.refresh_default_publication();

CREATE FUNCTION admin.can_manage_learner_now(target_person_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    FALSE
    OR EXISTS (
      SELECT 1
      FROM admin.role_grants grant_record
      JOIN admin.principals principal ON principal.id = grant_record.principal_id
      JOIN admin.role_permissions role_permission ON role_permission.role_id = grant_record.role_id
      JOIN admin.permissions permission ON permission.id = role_permission.permission_id
      WHERE grant_record.principal_id = admin.request_principal_id()
        AND principal.status = 'active'
        AND permission.code = 'learner.manage_profile'
        AND grant_record.valid_from <= clock_timestamp()
        AND (grant_record.valid_to IS NULL OR grant_record.valid_to > clock_timestamp())
        AND (
          grant_record.scope_type = 'global'
          OR (
            grant_record.scope_type = 'region'
            AND EXISTS (
              SELECT 1 FROM core.person_region_assignments assignment
              WHERE assignment.person_id = target_person_id
                AND assignment.region_id = grant_record.region_id
                AND assignment.assignment_type = 'primary'
                AND assignment.valid_from <= CURRENT_DATE
                AND (assignment.valid_to IS NULL OR assignment.valid_to > CURRENT_DATE)
            )
          )
          OR (
            grant_record.scope_type = 'country'
            AND EXISTS (
              SELECT 1
              FROM core.person_region_assignments assignment
              JOIN core.regions operational ON operational.id = assignment.region_id
              WHERE assignment.person_id = target_person_id
                AND operational.parent_region_id = grant_record.region_id
                AND assignment.assignment_type = 'primary'
                AND assignment.valid_from <= CURRENT_DATE
                AND (assignment.valid_to IS NULL OR assignment.valid_to > CURRENT_DATE)
            )
          )
          OR (
            grant_record.scope_type = 'cohort'
            AND EXISTS (
              SELECT 1 FROM core.cohort_memberships membership
              WHERE membership.person_id = target_person_id
                AND membership.cohort_id = grant_record.cohort_id
                AND membership.valid_from <= CURRENT_DATE
                AND (membership.valid_to IS NULL OR membership.valid_to > CURRENT_DATE)
            )
          )
          OR (
            grant_record.scope_type = 'privacy_case'
            AND EXISTS (
              SELECT 1 FROM admin.privacy_cases privacy_case
              WHERE privacy_case.id = grant_record.privacy_case_id
                AND privacy_case.person_id = target_person_id
                AND privacy_case.status IN ('open', 'in_progress')
            )
          )
        )
    )
$$;
REVOKE ALL ON FUNCTION admin.can_manage_learner_now(UUID) FROM PUBLIC;

CREATE FUNCTION admin.learner_access_list(input_page INTEGER,input_query TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;
BEGIN
 IF admin.has_permission('learner.manage_profile') IS NOT TRUE THEN RAISE EXCEPTION 'learner access management denied' USING ERRCODE='42501';END IF;
 IF input_page IS NULL OR input_page NOT BETWEEN 1 AND 100000 OR input_query IS NULL OR length(input_query)>100 THEN RAISE EXCEPTION 'invalid learner access query';END IF;
 WITH visible AS (SELECT p.id,p.preferred_name,p.status,coalesce(s.revision,1) revision FROM identity.people p LEFT JOIN platform.learner_access_states s ON s.person_id=p.id WHERE p.status IN ('active','suspended') AND admin.can_manage_learner_now(p.id) AND (input_query='' OR strpos(lower(coalesce(p.preferred_name,'')),lower(input_query))>0)),entries AS (SELECT * FROM visible ORDER BY id LIMIT 20 OFFSET(input_page-1)*20)
 SELECT jsonb_build_object('page',input_page,'total',(SELECT count(*) FROM visible),'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',preferred_name,'status',status,'version',revision) ORDER BY id) FROM entries),'[]')) INTO result;RETURN result;
END$$;
CREATE FUNCTION admin.suspend_learner(input_person UUID,input_version INTEGER,input_reason TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE revision INTEGER;state TEXT;
BEGIN
 PERFORM pg_advisory_xact_lock(1919,1);
 IF admin.can_manage_learner_now(input_person) IS NOT TRUE THEN RAISE EXCEPTION 'learner unavailable' USING ERRCODE='42501';END IF;
 IF input_version IS NULL OR input_version<1 OR input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid learner suspension';END IF;
 SELECT status INTO state FROM identity.people WHERE id=input_person FOR UPDATE;
 IF state IS NULL OR admin.can_manage_learner_now(input_person) IS NOT TRUE THEN RAISE EXCEPTION 'learner unavailable' USING ERRCODE='42501';END IF;
 INSERT INTO platform.learner_access_states(person_id) VALUES(input_person) ON CONFLICT DO NOTHING;
 SELECT s.revision INTO revision FROM platform.learner_access_states s WHERE person_id=input_person FOR UPDATE;
 IF revision<>input_version THEN RAISE EXCEPTION 'learner access conflict' USING ERRCODE='40001';END IF;
 IF state<>'active' THEN RAISE EXCEPTION 'learner eligibility unavailable';END IF;
 UPDATE identity.person_interaction_channels SET valid_to=clock_timestamp() WHERE person_id=input_person AND valid_to IS NULL;
 UPDATE identity.people SET status='suspended' WHERE id=input_person;
 UPDATE platform.telegram_checkin_links SET expires_at=clock_timestamp() WHERE telegram_user_id IN (SELECT external_subject_id FROM identity.platform_identities WHERE person_id=input_person AND platform='telegram');
 UPDATE platform.whatsapp_links SET expires_at=clock_timestamp() WHERE subject IN (SELECT external_subject_id FROM identity.platform_identities WHERE person_id=input_person AND platform='whatsapp');
 UPDATE platform.learner_privacy_acceptances a SET revoked_at=clock_timestamp() WHERE EXISTS(SELECT 1 FROM identity.platform_identities i WHERE i.person_id=input_person AND i.platform=a.platform AND platform.privacy_subject_hash(i.platform,i.external_subject_id)=a.subject_hash);
 UPDATE platform.learner_access_states access SET revision=access.revision+1,suspended_at=clock_timestamp(),suspended_by=admin.request_principal_id(),reason=trim(input_reason) WHERE person_id=input_person RETURNING access.revision INTO revision;
 INSERT INTO audit.events(request_id,action,target_type,target_id,outcome,reason,metadata) VALUES(coalesce(admin.request_id(),gen_random_uuid()),'learner.suspend','person',input_person,'success',trim(input_reason),jsonb_build_object('version',revision));RETURN jsonb_build_object('version',revision,'status','suspended');
END$$;

CREATE FUNCTION core.journal_audience_feed(input_locale TEXT,input_page INTEGER,input_external BOOLEAN,input_staff BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;
BEGIN
  IF input_locale IS NULL OR input_locale NOT IN ('zh_TW','en') OR input_page IS NULL OR input_page NOT BETWEEN 1 AND 100000 OR input_external IS NULL OR input_staff IS NULL OR (input_staff AND input_external) THEN RAISE EXCEPTION 'invalid journal query'; END IF;
  WITH visible AS (
    SELECT j.* FROM core.journal_publications j JOIN identity.people p ON p.id=j.person_id
      JOIN identity.platform_identities i ON i.id=j.identity_id
    WHERE j.active AND (p.status='active' OR (input_staff AND p.status='suspended')) AND i.revoked_at IS NULL AND i.person_id=p.id
      AND (NOT input_external OR j.external_enabled)
      AND (input_staff OR EXISTS(SELECT 1 FROM identity.person_interaction_channels ch WHERE ch.person_id=p.id AND ch.platform_identity_id=i.id AND ch.valid_from<=CURRENT_TIMESTAMP AND ch.valid_to IS NULL))
      AND (input_staff OR EXISTS(SELECT 1 FROM identity.onboarding_applications a WHERE a.person_id=p.id AND a.platform=i.platform AND a.external_subject_id=i.external_subject_id AND a.status='approved'))
      AND (NOT input_staff OR j.shared_with_staff OR (admin.can_access_person(p.id,'learner.read') AND admin.can_access_person(p.id,'checkin.read_private_note')))
  ), entries AS (SELECT * FROM visible ORDER BY published_at DESC,id DESC LIMIT 20 OFFSET(input_page-1)*20)
  SELECT jsonb_build_object('page',input_page,'total',(SELECT count(*) FROM visible),'entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',e.id,'version',e.revision,'alias',e.alias,'date',e.practice_date,'publishedAt',e.published_at,'practiceNote',e.note_snapshot,
    'methods',(SELECT coalesce(jsonb_agg(m->>input_locale),'[]') FROM jsonb_array_elements(e.method_snapshot) m),
    'feelingTags',(SELECT coalesce(jsonb_agg(t->>input_locale),'[]') FROM jsonb_array_elements(e.tag_snapshot) t)
  ) ORDER BY e.published_at DESC,e.id DESC) FROM entries e),'[]')) INTO result;
  RETURN result;
END;
$$;
CREATE OR REPLACE FUNCTION admin.practice_journal(input_person UUID,input_page INTEGER,input_locale TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;
BEGIN
  IF admin.request_principal_id() IS NULL OR NOT admin.has_permission('learner.read')
    OR NOT admin.has_permission('checkin.read_private_note') THEN
    RAISE EXCEPTION 'journal access denied' USING ERRCODE='42501';
  END IF;
  IF input_page IS NULL OR input_page<1 OR input_page>100000 OR input_locale IS NULL
    OR input_locale NOT IN ('zh_TW','en') THEN RAISE EXCEPTION 'invalid journal query'; END IF;
  IF input_person IS NOT NULL AND (admin.can_access_person(input_person,'learner.read')
    AND admin.can_access_person(input_person,'checkin.read_private_note')) IS NOT TRUE THEN
    RAISE EXCEPTION 'learner unavailable';
  END IF;
  WITH visible AS (
    SELECT n.*,c.practice_date,
      coalesce(nullif(p.preferred_name,''),nullif(p.legal_name,''),nullif(p.public_nickname,''),
        CASE WHEN input_locale='en' THEN 'Unnamed learner' ELSE '未命名學員' END) display_name
    FROM core.checkin_notes n JOIN core.checkins c ON c.id=n.checkin_id
    JOIN identity.people p ON p.id=n.person_id
    WHERE p.status IN ('active','suspended') AND (input_person IS NULL OR n.person_id=input_person)
      AND admin.can_access_person(n.person_id,'learner.read')
      AND admin.can_access_person(n.person_id,'checkin.read_private_note')
      AND (n.practice_note<>'' OR EXISTS(SELECT 1 FROM core.checkin_note_tags t WHERE t.checkin_id=n.checkin_id))
  ), entries AS (
    SELECT * FROM visible ORDER BY updated_at DESC,checkin_id DESC LIMIT 20 OFFSET (input_page-1)*20
  ) SELECT jsonb_build_object('page',input_page,'total',(SELECT count(*) FROM visible),
    'entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'checkinId',e.checkin_id,'personId',e.person_id,'name',e.display_name,'practiceDate',e.practice_date,
      'updatedAt',e.updated_at,'practiceNote',e.practice_note,
      'feelingTags',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.tag_id,'name',
        CASE WHEN input_locale='en' THEN t.name_en ELSE t.name_zh_tw END)
        ORDER BY t.sort_order,t.tag_id),'[]'::jsonb) FROM core.checkin_note_tags t WHERE t.checkin_id=e.checkin_id),
      'methodsVisible',coalesce(admin.can_access_person(e.person_id,'checkin.read'),FALSE),
      'methods',CASE WHEN admin.can_access_person(e.person_id,'checkin.read') THEN
        (SELECT coalesce(jsonb_agg(CASE WHEN input_locale='en' THEN m.name_en ELSE m.name_zh_tw END ORDER BY m.sort_order,m.code),'[]'::jsonb)
         FROM core.checkin_method_selections cm JOIN core.practice_methods m ON m.id=cm.practice_method_id WHERE cm.checkin_id=e.checkin_id)
        ELSE '[]'::jsonb END
    ) ORDER BY e.updated_at DESC,e.checkin_id DESC) FROM entries e),'[]'::jsonb)) INTO result;
  RETURN result;
END;
$$;
CREATE OR REPLACE FUNCTION platform.journal_own(input_token TEXT,input_page INTEGER,input_locale TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; result JSONB;
BEGIN
  target:=platform.journal_person(input_token);
  IF input_page IS NULL OR input_page NOT BETWEEN 1 AND 100000 OR input_locale IS NULL OR input_locale NOT IN ('en','zh_TW') THEN RAISE EXCEPTION 'invalid journal query'; END IF;
  WITH visible AS (
    SELECT c.id,c.practice_date,coalesce(n.practice_note,'') practice_note,p.revision,p.active,p.alias,p.external_enabled,p.share_note,p.share_feelings,p.note_snapshot,p.tag_snapshot,p.method_snapshot
    FROM core.checkins c LEFT JOIN core.checkin_notes n ON n.checkin_id=c.id
      LEFT JOIN core.journal_publications p ON p.checkin_id=c.id
    WHERE c.person_id=target AND (EXISTS(SELECT 1 FROM core.checkin_privacy_origins origin WHERE origin.checkin_id=c.id) OR n.practice_note<>'' OR EXISTS(SELECT 1 FROM core.checkin_note_tags t WHERE t.checkin_id=c.id))
  ), entries AS (SELECT * FROM visible ORDER BY practice_date DESC,id DESC LIMIT 20 OFFSET (input_page-1)*20)
  SELECT jsonb_build_object('page',input_page,'total',(SELECT count(*) FROM visible),'entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'autoShared',EXISTS(SELECT 1 FROM core.checkin_privacy_origins origin WHERE origin.checkin_id=e.id),
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
CREATE OR REPLACE FUNCTION core.shared_journal_feed(input_locale TEXT,input_page INTEGER,input_external BOOLEAN) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT core.journal_audience_feed(input_locale,input_page,input_external,FALSE)$$;
CREATE FUNCTION admin.shared_journal(input_locale TEXT,input_page INTEGER) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF admin.has_permission('journal.read_shared') IS NOT TRUE THEN RAISE EXCEPTION 'shared journal denied' USING ERRCODE='42501';END IF;
 RETURN core.journal_audience_feed(input_locale,input_page,FALSE,TRUE);END$$;
CREATE FUNCTION platform.community_feed(input_platform TEXT,input_credential TEXT,input_locale TEXT,input_page INTEGER) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN PERFORM platform.practice_person(input_platform,input_credential);RETURN core.shared_journal_feed(input_locale,input_page,FALSE);END$$;
REVOKE ALL ON FUNCTION core.journal_audience_feed(TEXT,INTEGER,BOOLEAN,BOOLEAN),admin.shared_journal(TEXT,INTEGER),platform.community_feed(TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.shared_journal(TEXT,INTEGER),platform.community_feed(TEXT,TEXT,TEXT,INTEGER) TO qigong_api_runtime;

CREATE OR REPLACE FUNCTION platform.practice_notes(input_platform TEXT,input_credential TEXT,input_locale TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;
BEGIN
  target:=platform.practice_person(input_platform,input_credential);
  IF input_locale IS NULL OR input_locale NOT IN ('zh_TW','en') THEN RAISE EXCEPTION 'invalid practice locale'; END IF;
  RETURN jsonb_build_object('tags',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',
    CASE WHEN input_locale='en' AND input_platform<>'line' THEN name_en ELSE name_zh_tw END) ORDER BY sort_order,id),'[]'::jsonb)
    FROM core.practice_feeling_tags WHERE active),
    'notes',(SELECT coalesce(jsonb_agg(jsonb_build_object('checkin_id',n.checkin_id,'practice_note',n.practice_note,
      'feeling_tags',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.tag_id,'name',
        CASE WHEN input_locale='en' AND input_platform<>'line' THEN t.name_en ELSE t.name_zh_tw END) ORDER BY t.sort_order,t.tag_id),'[]'::jsonb)
        FROM core.checkin_note_tags t WHERE t.checkin_id=n.checkin_id)) ORDER BY c.practice_date DESC),'[]'::jsonb)
      FROM core.checkin_notes n JOIN (SELECT id,practice_date FROM core.checkins WHERE person_id=target ORDER BY practice_date DESC LIMIT 14) c ON c.id=n.checkin_id)) || CASE WHEN EXISTS(SELECT 1 FROM platform.learner_privacy_policies pp WHERE pp.state='active') THEN jsonb_build_object('privacy',platform.privacy_usage(input_platform,input_credential)) ELSE '{}'::jsonb END;
END;
$$;
-- New facade permissions only; no table access or legacy implementation access.
DO $$DECLARE f RECORD;BEGIN FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='platform' AND p.proname IN ('privacy_subject_hash','privacy_notice','privacy_status','begin_privacy_gate','accept_privacy','require_privacy_subject','privacy_credential_subject','require_privacy_token','require_reflection_consent','privacy_usage')) OR (n.nspname='core' AND p.proname IN ('capture_checkin_privacy_origin','refresh_default_publication')) OR (n.nspname='admin' AND p.proname IN ('publish_privacy_policy','learner_access_list','suspend_learner')) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);END LOOP;END$$;
GRANT EXECUTE ON FUNCTION platform.privacy_notice(),platform.begin_privacy_gate(TEXT,TEXT,TEXT),platform.accept_privacy(TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,BOOLEAN),platform.privacy_usage(TEXT,TEXT),admin.publish_privacy_policy(TEXT,TEXT,TEXT),admin.learner_access_list(INTEGER,TEXT),admin.suspend_learner(UUID,INTEGER,TEXT) TO qigong_api_runtime;
CREATE FUNCTION ops.learner_privacy_schema_ready() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-8-learner-privacy-consent')$$;
REVOKE ALL ON FUNCTION ops.learner_privacy_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.learner_privacy_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-8-learner-privacy-consent',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
