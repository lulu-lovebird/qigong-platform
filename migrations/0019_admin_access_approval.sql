-- New roles only: never expand the legacy cohort coach or regional/viewer templates.
INSERT INTO admin.roles(code,description) VALUES
 ('coach_admin','Global read-only coaching including private notes'),
 ('master_admin','Global private reporting and delegated ordinary administrator approval');
INSERT INTO admin.permissions(code,description) VALUES ('admin_access.manage','Manage ordinary administrator grants');
INSERT INTO admin.role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM admin.roles r JOIN admin.permissions p ON
 (r.code IN ('coach_admin','master_admin') AND p.code IN ('learner.read','checkin.read','stats.read','checkin.read_private_note'))
 OR (r.code IN ('master_admin','super_admin') AND p.code='admin_access.manage');
CREATE FUNCTION admin.validate_access_role_scope()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM admin.roles WHERE id=NEW.role_id AND code IN ('coach_admin','master_admin')) AND NEW.scope_type<>'global'
 THEN RAISE EXCEPTION 'global admin scope required'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER validate_access_role_scope BEFORE INSERT OR UPDATE OF role_id,scope_type ON admin.role_grants
FOR EACH ROW EXECUTE FUNCTION admin.validate_access_role_scope();
REVOKE ALL ON FUNCTION admin.validate_access_role_scope() FROM PUBLIC;

-- Authgear authentication is NOT authorization. Pending credentials never resolve via session_principal.
CREATE TABLE admin.access_applications (
  principal_id UUID PRIMARY KEY REFERENCES admin.principals(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','approved','rejected')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  requested_role TEXT CHECK(requested_role IN ('regional_admin','global_viewer','coach_admin','master_admin')),
  scope_description TEXT NOT NULL DEFAULT '',
  applicant_reason TEXT NOT NULL DEFAULT '',
  decision_reason TEXT,
  decided_by UUID REFERENCES admin.principals(id),
  decided_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE admin.access_sessions (
  token_hash BYTEA PRIMARY KEY,
  principal_id UUID NOT NULL REFERENCES admin.principals(id),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
ALTER TABLE admin.access_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.access_applications FORCE ROW LEVEL SECURITY;
ALTER TABLE admin.access_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.access_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON admin.access_applications,admin.access_sessions FROM PUBLIC;

CREATE FUNCTION admin.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id
    JOIN admin.principals p ON p.id=g.principal_id WHERE p.id=admin.request_principal_id()
    AND p.status='active' AND r.code='super_admin' AND g.scope_type='global'
    AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()))
$$;
CREATE FUNCTION admin.can_manage_admin_access()
RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT admin.is_super_admin() OR EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id
  JOIN admin.principals p ON p.id=g.principal_id JOIN admin.role_permissions rp ON rp.role_id=r.id JOIN admin.permissions permission ON permission.id=rp.permission_id
  WHERE p.id=admin.request_principal_id() AND p.status='active' AND r.code='master_admin' AND g.scope_type='global'
   AND permission.code='admin_access.manage' AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()))
$$;
CREATE FUNCTION admin.can_manage_access_target(target UUID)
RETURNS BOOLEAN LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT admin.can_manage_admin_access() AND target IS NOT NULL AND target<>admin.request_principal_id()
  AND (admin.is_super_admin() OR (
   NOT EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id
    WHERE g.principal_id=target AND r.code IN ('super_admin','master_admin') AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()))
   AND NOT EXISTS(SELECT 1 FROM admin.access_applications WHERE principal_id=target AND requested_role='master_admin' AND status<>'approved')
  ))
$$;
CREATE FUNCTION admin.require_access_manager()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  -- Serialize role mutations; recheck the actor AFTER the lock, including concurrent revocation.
  PERFORM pg_advisory_xact_lock(1919,1);
  IF admin.can_manage_admin_access() IS NOT TRUE THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
END;
$$;
CREATE FUNCTION admin.begin_access_login(input_token TEXT,input_issuer TEXT,input_subject TEXT,input_name TEXT,input_email TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;
BEGIN
  IF input_token IS NULL OR input_token !~ '^[A-Za-z0-9_-]{43}$' OR input_issuer IS NULL OR length(input_issuer) NOT BETWEEN 1 AND 2048
    OR input_subject IS NULL OR length(input_subject) NOT BETWEEN 1 AND 512
    OR (input_name IS NOT NULL AND length(input_name) NOT BETWEEN 1 AND 200)
    OR (input_email IS NOT NULL AND length(input_email)>320) THEN RAISE EXCEPTION 'invalid access login'; END IF;
  -- Called ONLY after server-side OIDC verification. Never accept these identities from HTTP JSON.
  INSERT INTO admin.principals(oidc_issuer,oidc_subject,display_name,email)
  VALUES(input_issuer,input_subject,coalesce(input_name,'Authgear account'),input_email)
  ON CONFLICT(oidc_issuer,oidc_subject) DO NOTHING;
  SELECT id INTO target FROM admin.principals WHERE oidc_issuer=input_issuer AND oidc_subject=input_subject AND status='active' FOR UPDATE;
  IF target IS NULL THEN RETURN FALSE; END IF;
  INSERT INTO admin.access_applications(principal_id) VALUES(target) ON CONFLICT DO NOTHING;
  INSERT INTO admin.access_sessions(token_hash,principal_id,expires_at)
  VALUES(public.digest(input_token,'sha256'),target,CURRENT_TIMESTAMP+INTERVAL '8 hours');
  RETURN TRUE;
END;
$$;
CREATE FUNCTION admin.access_session_principal(input_token TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT s.principal_id FROM admin.access_sessions s JOIN admin.principals p ON p.id=s.principal_id
  WHERE s.token_hash=public.digest(input_token,'sha256') AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP AND p.status='active'
$$;
CREATE FUNCTION admin.access_status(input_token TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID;
BEGIN
  target:=admin.access_session_principal(input_token);
  IF target IS NULL THEN RAISE EXCEPTION 'access session unavailable' USING ERRCODE='42501'; END IF;
  RETURN (SELECT jsonb_build_object('principalId',p.id,'name',p.display_name,'status',a.status,'version',a.version,
    'requestedRole',a.requested_role,'scopeDescription',a.scope_description,'applicantReason',a.applicant_reason,
    'decisionReason',a.decision_reason) FROM admin.access_applications a JOIN admin.principals p ON p.id=a.principal_id WHERE p.id=target);
END;
$$;
CREATE FUNCTION admin.submit_access_application(input_token TEXT,input_version INTEGER,input_role TEXT,input_scope TEXT,input_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; application admin.access_applications%ROWTYPE;
BEGIN
  target:=admin.access_session_principal(input_token);
  IF target IS NULL THEN RAISE EXCEPTION 'access session unavailable' USING ERRCODE='42501'; END IF;
  -- Principal -> application throughout login/request/decision, including audit FK checks.
  PERFORM 1 FROM admin.principals WHERE id=target AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'access session unavailable' USING ERRCODE='42501'; END IF;
  IF input_role IS NULL OR input_role NOT IN ('regional_admin','global_viewer','coach_admin','master_admin') OR input_scope IS NULL OR length(trim(input_scope)) NOT BETWEEN 1 AND 500
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
CREATE FUNCTION admin.revoke_access_session(input_token TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE admin.access_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=public.digest(input_token,'sha256') AND revoked_at IS NULL
$$;

-- Internal shared writer; no runtime EXECUTE grant. No browser-provided permission lists or super-admin promotion.
CREATE FUNCTION admin.insert_managed_role(target UUID,input_role TEXT,input_region UUID,input_cohort UUID,input_reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE grant_id UUID; role_id_value UUID; scope TEXT;
BEGIN
  PERFORM admin.require_access_manager();
  IF target IS NULL OR target=admin.request_principal_id() OR input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500
  THEN RAISE EXCEPTION 'invalid admin grant'; END IF;
  IF admin.can_manage_access_target(target) IS NOT TRUE THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM admin.principals WHERE id=target AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'principal unavailable'; END IF;
  IF input_role='regional_admin' AND input_region IS NOT NULL AND input_cohort IS NULL
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
CREATE FUNCTION admin.decide_access_application(target UUID,input_version INTEGER,input_decision TEXT,input_role TEXT,input_region UUID,input_cohort UUID,input_reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE application admin.access_applications%ROWTYPE; grant_id UUID;
BEGIN
  PERFORM admin.require_access_manager();
  IF target IS NULL OR target=admin.request_principal_id() OR input_decision IS NULL OR input_decision NOT IN ('approved','rejected')
    OR input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid access decision'; END IF;
  IF admin.can_manage_access_target(target) IS NOT TRUE THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
  -- Same principal->application lock order as login registration to avoid deadlocks.
  PERFORM 1 FROM admin.principals WHERE id=target AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'principal unavailable'; END IF;
  SELECT * INTO application FROM admin.access_applications WHERE principal_id=target FOR UPDATE;
  IF NOT FOUND OR application.status<>'pending' OR application.version IS DISTINCT FROM input_version
  THEN RAISE EXCEPTION 'access version conflict' USING ERRCODE='40001'; END IF;
  IF input_decision='approved' THEN grant_id:=admin.insert_managed_role(target,input_role,input_region,input_cohort,input_reason);
  ELSIF input_role IS NOT NULL OR input_region IS NOT NULL OR input_cohort IS NOT NULL THEN RAISE EXCEPTION 'invalid access decision'; END IF;
  UPDATE admin.access_applications SET status=input_decision,version=version+1,decision_reason=input_reason,
    decided_by=admin.request_principal_id(),decided_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE principal_id=target;
  INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,reason,outcome,before_data,after_data)
  VALUES(admin.request_id(),admin.request_principal_id(),'admin_access.decide','admin_principal',target::text,input_reason,'success',
    jsonb_build_object('status',application.status,'version',application.version),jsonb_build_object('status',input_decision,'grantId',grant_id));
  RETURN grant_id;
END;
$$;
CREATE FUNCTION admin.add_managed_role(target UUID,input_role TEXT,input_region UUID,input_cohort UUID,input_reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM admin.require_access_manager();
  -- A verified account must have been approved or explicitly provisioned out of band.
  IF EXISTS(SELECT 1 FROM admin.access_applications WHERE principal_id=target AND status<>'approved')
  THEN RAISE EXCEPTION 'access approval required'; END IF;
  RETURN admin.insert_managed_role(target,input_role,input_region,input_cohort,input_reason);
END;
$$;
CREATE FUNCTION admin.revoke_managed_role(input_grant UUID,input_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_grant admin.role_grants%ROWTYPE; role_code TEXT;
BEGIN
  PERFORM admin.require_access_manager();
  SELECT * INTO old_grant FROM admin.role_grants WHERE id=input_grant FOR UPDATE;
  IF NOT FOUND OR old_grant.principal_id=admin.request_principal_id() OR input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500
  THEN RAISE EXCEPTION 'invalid admin revocation'; END IF;
  IF old_grant.valid_to IS NOT NULL AND old_grant.valid_to<=CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'admin grant conflict' USING ERRCODE='40001'; END IF;
  SELECT code INTO role_code FROM admin.roles WHERE id=old_grant.role_id;
  IF admin.can_manage_access_target(old_grant.principal_id) IS NOT TRUE OR (admin.is_super_admin() IS NOT TRUE AND role_code NOT IN ('regional_admin','global_viewer','coach_admin'))
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
CREATE FUNCTION admin.access_admin_list(input_page INTEGER,input_status TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB;
BEGIN
  IF admin.can_manage_admin_access() IS NOT TRUE THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
  IF input_page IS NULL OR input_page NOT BETWEEN 1 AND 100000 OR input_status IS NULL
    OR input_status NOT IN ('all','draft','pending','approved','rejected','provisioned') THEN RAISE EXCEPTION 'invalid access query'; END IF;
  WITH visible AS (
    SELECT p.*,a.status application_status,a.version,a.requested_role,a.scope_description,a.applicant_reason,a.decision_reason
    FROM admin.principals p LEFT JOIN admin.access_applications a ON a.principal_id=p.id
    WHERE input_status='all' OR coalesce(a.status,'provisioned')=input_status
  ), entries AS (SELECT * FROM visible ORDER BY created_at DESC,id LIMIT 20 OFFSET (input_page-1)*20)
  SELECT jsonb_build_object('page',input_page,'total',(SELECT count(*) FROM visible),'entries',coalesce((SELECT jsonb_agg(jsonb_build_object(
    'principalId',p.id,'name',p.display_name,'email',p.email,'issuer',p.oidc_issuer,'subject',p.oidc_subject,'accountStatus',p.status,
    'status',coalesce(p.application_status,'provisioned'),'version',p.version,'requestedRole',p.requested_role,'canManage',admin.can_manage_access_target(p.id),
    'scopeDescription',p.scope_description,'applicantReason',p.applicant_reason,'decisionReason',p.decision_reason,
    'grants',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'role',r.code,'scopeType',g.scope_type,'regionId',g.region_id,'cohortId',g.cohort_id,
      'scopeName',coalesce(region.name_zh_tw,cohort.name),'validFrom',g.valid_from,'validTo',g.valid_to,
      'canRevoke',admin.can_manage_access_target(p.id) AND (admin.is_super_admin() OR r.code IN ('regional_admin','global_viewer','coach_admin')),
      'active',g.valid_from<=CURRENT_TIMESTAMP AND (g.valid_to IS NULL OR g.valid_to>CURRENT_TIMESTAMP)) ORDER BY g.created_at),'[]'::jsonb)
      FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id LEFT JOIN core.regions region ON region.id=g.region_id LEFT JOIN core.cohorts cohort ON cohort.id=g.cohort_id WHERE g.principal_id=p.id)
  ) ORDER BY p.created_at DESC,p.id) FROM entries p),'[]'::jsonb),
    'regions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'nameZhTw',name_zh_tw,'nameEn',name_en) ORDER BY code,id),'[]'::jsonb) FROM core.regions WHERE active AND region_type='operational'),
    'cohorts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'regionId',c.region_id) ORDER BY c.name,c.id),'[]'::jsonb) FROM core.cohorts c JOIN core.regions r ON r.id=c.region_id WHERE c.active AND r.active),
    'canAssignMaster',admin.is_super_admin(),
    'roles',(SELECT jsonb_agg(jsonb_build_object('code',r.code,'permissions',(SELECT jsonb_agg(p.code ORDER BY p.code) FROM admin.role_permissions rp JOIN admin.permissions p ON p.id=rp.permission_id WHERE rp.role_id=r.id)) ORDER BY r.code) FROM admin.roles r WHERE r.code IN ('regional_admin','global_viewer','coach_admin','master_admin') AND (r.code<>'master_admin' OR admin.is_super_admin()))
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION admin.can_manage_admin_access(),admin.can_manage_access_target(UUID),admin.is_super_admin(),admin.require_access_manager(),admin.begin_access_login(TEXT,TEXT,TEXT,TEXT,TEXT),
  admin.access_session_principal(TEXT),admin.access_status(TEXT),admin.submit_access_application(TEXT,INTEGER,TEXT,TEXT,TEXT),admin.revoke_access_session(TEXT),
  admin.insert_managed_role(UUID,TEXT,UUID,UUID,TEXT),admin.decide_access_application(UUID,INTEGER,TEXT,TEXT,UUID,UUID,TEXT),
  admin.add_managed_role(UUID,TEXT,UUID,UUID,TEXT),admin.revoke_managed_role(UUID,TEXT),admin.access_admin_list(INTEGER,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.can_manage_admin_access(),admin.is_super_admin(),admin.begin_access_login(TEXT,TEXT,TEXT,TEXT,TEXT),admin.access_status(TEXT),
  admin.submit_access_application(TEXT,INTEGER,TEXT,TEXT,TEXT),admin.revoke_access_session(TEXT),
  admin.decide_access_application(UUID,INTEGER,TEXT,TEXT,UUID,UUID,TEXT),admin.add_managed_role(UUID,TEXT,UUID,UUID,TEXT),
  admin.revoke_managed_role(UUID,TEXT),admin.access_admin_list(INTEGER,TEXT) TO qigong_api_runtime;
