CREATE TABLE admin.login_attempts (
  state_hash BYTEA PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE admin.sessions (
  token_hash BYTEA PRIMARY KEY,
  principal_id UUID NOT NULL REFERENCES admin.principals(id),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX admin_sessions_principal_idx ON admin.sessions (principal_id);

ALTER TABLE admin.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.login_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE admin.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.sessions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON admin.login_attempts, admin.sessions FROM PUBLIC;

CREATE FUNCTION admin.start_login(state TEXT, verifier TEXT, nonce TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF length(state) < 32 OR length(verifier) < 32 OR length(nonce) < 32 THEN
    RAISE EXCEPTION 'invalid login challenge';
  END IF;
  INSERT INTO admin.login_attempts (state_hash, verifier, nonce, expires_at)
  VALUES (public.digest(state, 'sha256'), verifier, nonce, CURRENT_TIMESTAMP + INTERVAL '5 minutes');
END;
$$;

CREATE FUNCTION admin.consume_login(state TEXT)
RETURNS TABLE (verifier TEXT, nonce TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  RETURN QUERY
    DELETE FROM admin.login_attempts attempts
    WHERE attempts.state_hash = public.digest(state, 'sha256') AND attempts.expires_at > CURRENT_TIMESTAMP
    RETURNING attempts.verifier, attempts.nonce;
END;
$$;

CREATE FUNCTION admin.create_session(token TEXT, issuer TEXT, subject TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE matched_principal UUID;
BEGIN
  IF length(token) < 32 THEN RAISE EXCEPTION 'invalid session token'; END IF;
  SELECT id INTO matched_principal FROM admin.principals
  WHERE oidc_issuer = issuer AND oidc_subject = subject AND status = 'active';
  IF matched_principal IS NULL OR NOT EXISTS (
    SELECT 1 FROM admin.role_grants
    WHERE principal_id = matched_principal AND valid_from <= CURRENT_TIMESTAMP
      AND (valid_to IS NULL OR valid_to > CURRENT_TIMESTAMP)
  ) THEN RETURN FALSE; END IF;
  INSERT INTO admin.sessions (token_hash, principal_id, expires_at)
  VALUES (public.digest(token, 'sha256'), matched_principal, CURRENT_TIMESTAMP + INTERVAL '8 hours');
  UPDATE admin.principals SET last_login_at = CURRENT_TIMESTAMP WHERE id = matched_principal;
  RETURN TRUE;
END;
$$;

CREATE FUNCTION admin.session_principal(token TEXT)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT principal.id FROM admin.sessions session
  JOIN admin.principals principal ON principal.id = session.principal_id
  WHERE session.token_hash = public.digest(token, 'sha256') AND session.revoked_at IS NULL
    AND session.expires_at > CURRENT_TIMESTAMP AND principal.status = 'active'
    AND EXISTS (SELECT 1 FROM admin.role_grants grant_record
      WHERE grant_record.principal_id = principal.id AND grant_record.valid_from <= CURRENT_TIMESTAMP
        AND (grant_record.valid_to IS NULL OR grant_record.valid_to > CURRENT_TIMESTAMP))
$$;

CREATE FUNCTION admin.revoke_session(token TEXT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  UPDATE admin.sessions SET revoked_at = CURRENT_TIMESTAMP
  WHERE token_hash = public.digest(token, 'sha256') AND revoked_at IS NULL
$$;

REVOKE ALL ON FUNCTION admin.start_login(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin.consume_login(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin.create_session(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin.session_principal(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin.revoke_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.start_login(TEXT, TEXT, TEXT),
  admin.consume_login(TEXT), admin.create_session(TEXT, TEXT, TEXT),
  admin.session_principal(TEXT), admin.revoke_session(TEXT) TO qigong_api_runtime;

UPDATE core.platform_metadata SET architecture_version = 'phase-2-admin-auth',
  updated_at = CURRENT_TIMESTAMP WHERE singleton = TRUE;
