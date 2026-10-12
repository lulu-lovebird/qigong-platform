-- Metadata from server-verified OIDC only. Never grants roles or links by email/name.
CREATE FUNCTION admin.refresh_verified_profile(input_issuer TEXT,input_subject TEXT,input_name TEXT,input_email TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target admin.principals%ROWTYPE; name_changed BOOLEAN; email_changed BOOLEAN;
BEGIN
 IF input_issuer IS NULL OR length(input_issuer) NOT BETWEEN 1 AND 2048
  OR input_subject IS NULL OR length(input_subject) NOT BETWEEN 1 AND 512
  OR (input_name IS NOT NULL AND length(trim(input_name)) NOT BETWEEN 1 AND 200)
  OR (input_email IS NOT NULL AND (length(input_email)>320 OR input_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
 THEN RAISE EXCEPTION 'invalid verified administrator profile'; END IF;
 SELECT * INTO target FROM admin.principals
  WHERE oidc_issuer=input_issuer AND oidc_subject=input_subject AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 name_changed:=input_name IS NOT NULL AND target.display_name IS DISTINCT FROM input_name;
 email_changed:=input_email IS NOT NULL AND target.email IS DISTINCT FROM input_email;
 IF name_changed OR email_changed THEN
  UPDATE admin.principals SET display_name=coalesce(input_name,display_name),email=coalesce(input_email,email)
   WHERE id=target.id AND status='active';
  INSERT INTO audit.events(request_id,actor_principal_id,action,target_type,target_id,outcome,metadata)
   VALUES(admin.request_id(),target.id,'admin.profile_refreshed','admin_principal',target.id::text,'success',
    jsonb_build_object('nameChanged',name_changed,'emailChanged',email_changed));
 END IF;
 RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION admin.refresh_verified_profile(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.refresh_verified_profile(TEXT,TEXT,TEXT,TEXT) TO qigong_api_runtime;

CREATE FUNCTION ops.admin_oidc_profile_schema_ready() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM core.platform_metadata WHERE architecture_version='phase-11-admin-oidc-profile')
$$;
REVOKE ALL ON FUNCTION ops.admin_oidc_profile_schema_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.admin_oidc_profile_schema_ready() TO qigong_api_runtime,qigong_worker_runtime;
UPDATE core.platform_metadata SET architecture_version='phase-11-admin-oidc-profile',updated_at=CURRENT_TIMESTAMP WHERE singleton=TRUE;
