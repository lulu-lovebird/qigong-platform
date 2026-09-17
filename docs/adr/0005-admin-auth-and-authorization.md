# ADR 0005: Admin Authentication and Authorization

## Status

Accepted

## Decision

Integrate the Baiyan website through OpenID Connect Authorization Code Flow with PKCE. The website is the authoritative authentication and membership source. This platform does not receive passwords or password hashes.

Admin authorization remains local to this platform through action-based roles and region/cohort scopes. Website membership claims do not directly grant administrative privileges.

Enforce authorization in API middleware, repository/query scope, PostgreSQL RLS, and integration tests. Admin runtime roles must not own tables or bypass RLS. Every administrative mutation is audited.

## Required OIDC Validation

- issuer, audience, signature, expiry, nonce, state, and PKCE;
- immutable `sub` as the website identity key;
- verified redirect URIs;
- recent authentication or MFA for high-risk actions.
