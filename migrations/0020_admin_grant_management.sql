-- Grant revision is independent of application revision and last login.
ALTER TABLE admin.principals ADD COLUMN access_grant_version INTEGER NOT NULL DEFAULT 1 CHECK(access_grant_version>0);
CREATE FUNCTION admin.bump_access_grant_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN UPDATE admin.principals SET access_grant_version=access_grant_version+1 WHERE id=OLD.principal_id; RETURN OLD; END IF;
 UPDATE admin.principals SET access_grant_version=access_grant_version+1 WHERE id=NEW.principal_id;
 IF TG_OP='UPDATE' AND OLD.principal_id<>NEW.principal_id THEN UPDATE admin.principals SET access_grant_version=access_grant_version+1 WHERE id=OLD.principal_id; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER access_grant_revision AFTER INSERT OR UPDATE OR DELETE ON admin.role_grants FOR EACH ROW EXECUTE FUNCTION admin.bump_access_grant_version();
REVOKE ALL ON FUNCTION admin.bump_access_grant_version() FROM PUBLIC;

-- Internal guard: lock principal before grants, recheck authority after waiting.
CREATE FUNCTION admin.require_grant_snapshot(target UUID,input_version INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actual INTEGER;
BEGIN
 PERFORM admin.require_access_manager();
 IF admin.can_manage_access_target(target) IS NOT TRUE THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
 SELECT access_grant_version INTO actual FROM admin.principals WHERE id=target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'principal unavailable'; END IF;
 IF actual IS DISTINCT FROM input_version THEN RAISE EXCEPTION 'admin grant conflict' USING ERRCODE='40001'; END IF;
 PERFORM admin.require_access_manager();
 IF admin.can_manage_access_target(target) IS NOT TRUE THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
END;
$$;
CREATE FUNCTION admin.revoke_managed_role_versioned(input_grant UUID,input_version INTEGER,input_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; old_grant admin.role_grants%ROWTYPE;
BEGIN
 PERFORM admin.require_access_manager();
 SELECT principal_id INTO target FROM admin.role_grants WHERE id=input_grant;
 IF NOT FOUND THEN RAISE EXCEPTION 'admin grant conflict' USING ERRCODE='40001'; END IF;
 PERFORM admin.require_grant_snapshot(target,input_version);
 SELECT * INTO old_grant FROM admin.role_grants WHERE id=input_grant FOR UPDATE;
 -- Web grants are immediate. Do not silently leave future entitlements behind or rewrite their dates.
 IF NOT FOUND OR old_grant.valid_from>clock_timestamp() OR (old_grant.valid_to IS NOT NULL AND old_grant.valid_to<=clock_timestamp())
 THEN RAISE EXCEPTION 'admin grant conflict' USING ERRCODE='40001'; END IF;
 PERFORM admin.revoke_managed_role(input_grant,input_reason);
END;
$$;
CREATE FUNCTION admin.edit_managed_role(input_grant UUID,input_version INTEGER,input_role TEXT,input_region UUID,input_cohort UUID,input_reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target UUID; old_grant admin.role_grants%ROWTYPE; old_code TEXT; replacement UUID;
BEGIN
 PERFORM admin.require_access_manager();
 SELECT principal_id INTO target FROM admin.role_grants WHERE id=input_grant;
 IF NOT FOUND THEN RAISE EXCEPTION 'admin grant conflict' USING ERRCODE='40001'; END IF;
 PERFORM admin.require_grant_snapshot(target,input_version);
 SELECT * INTO old_grant FROM admin.role_grants WHERE id=input_grant FOR UPDATE;
 SELECT code INTO old_code FROM admin.roles WHERE id=old_grant.role_id;
 IF old_code NOT IN ('regional_admin','global_viewer','coach_admin','master_admin') THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
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
CREATE FUNCTION admin.revoke_all_managed_roles(target UUID,input_version INTEGER,input_reason TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old_grant admin.role_grants%ROWTYPE; total INTEGER:=0; snapshot JSONB;
BEGIN
 PERFORM admin.require_grant_snapshot(target,input_version);
 IF input_reason IS NULL OR length(trim(input_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid admin revocation'; END IF;
 SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) INTO snapshot FROM admin.role_grants g WHERE principal_id=target AND (valid_to IS NULL OR valid_to>clock_timestamp());
 IF snapshot IS NULL THEN RAISE EXCEPTION 'admin grant conflict' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id WHERE g.principal_id=target AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()) AND (g.valid_from>clock_timestamp() OR (NOT admin.is_super_admin() AND r.code NOT IN ('regional_admin','global_viewer','coach_admin'))))
 THEN RAISE EXCEPTION 'admin access denied' USING ERRCODE='42501'; END IF;
 FOR old_grant IN SELECT * FROM admin.role_grants WHERE principal_id=target AND (valid_to IS NULL OR valid_to>clock_timestamp()) ORDER BY id FOR UPDATE LOOP
  PERFORM admin.revoke_managed_role(old_grant.id,input_reason); total:=total+1;
 END LOOP;
 INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,reason,outcome,before_data)
 VALUES(admin.request_id(),admin.request_principal_id(),'admin_access.revoke_all','admin_principal',target::text,input_reason,'success',snapshot);
 RETURN total;
END;
$$;
REVOKE ALL ON FUNCTION admin.require_grant_snapshot(UUID,INTEGER),admin.revoke_managed_role_versioned(UUID,INTEGER,TEXT),admin.edit_managed_role(UUID,INTEGER,TEXT,UUID,UUID,TEXT),admin.revoke_all_managed_roles(UUID,INTEGER,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.revoke_managed_role_versioned(UUID,INTEGER,TEXT),admin.edit_managed_role(UUID,INTEGER,TEXT,UUID,UUID,TEXT),admin.revoke_all_managed_roles(UUID,INTEGER,TEXT) TO qigong_api_runtime;

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
    'canRevokeAll',admin.can_manage_access_target(p.id) AND EXISTS(SELECT 1 FROM admin.role_grants g WHERE g.principal_id=p.id AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp())) AND NOT EXISTS(SELECT 1 FROM admin.role_grants g JOIN admin.roles r ON r.id=g.role_id WHERE g.principal_id=p.id AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()) AND (g.valid_from>clock_timestamp() OR (NOT admin.is_super_admin() AND r.code NOT IN ('regional_admin','global_viewer','coach_admin')))),
    'scopeDescription',p.scope_description,'applicantReason',p.applicant_reason,'decisionReason',p.decision_reason,
    'grants',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',g.id,'role',r.code,'scopeType',g.scope_type,'regionId',g.region_id,'cohortId',g.cohort_id,
      'scopeName',coalesce(region.name_zh_tw,cohort.name),'validFrom',g.valid_from,'validTo',g.valid_to,
      'canRevoke',admin.can_manage_access_target(p.id) AND (admin.is_super_admin() OR r.code IN ('regional_admin','global_viewer','coach_admin')),
      'canEdit',admin.can_manage_access_target(p.id) AND p.status='active' AND r.code IN ('regional_admin','global_viewer','coach_admin','master_admin') AND (r.code<>'master_admin' OR admin.is_super_admin()),
      'effective',p.status='active' AND g.valid_from<=clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()),
      'scheduled',g.valid_from>clock_timestamp() AND (g.valid_to IS NULL OR g.valid_to>clock_timestamp()),
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
