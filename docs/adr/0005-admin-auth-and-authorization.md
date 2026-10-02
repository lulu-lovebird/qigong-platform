# ADR 0005: Admin Authentication and Authorization

## Status

Accepted

## Decision

Use Authgear Cloud as the initial OpenID Connect provider for **platform administrators**. Authenticate administrators with Authorization Code Flow + PKCE and a server-side session; look up an explicitly provisioned `admin.principals` row by the verified `(issuer, sub)`. Authentication alone never creates an administrator or grants a role. A suspended/disabled principal, expired grant, or missing scope denies access. Admin accounts are separate from Baiyan's learner membership database, which contains learner credentials and course history only. The membership integration contract remains undecided. The platform never copies learner or administrator passwords.

Admin authorization remains local to this platform through action-based roles and region/cohort scopes. Authgear roles/groups and learner membership claims do not directly grant platform privileges. Restrict Authgear portal admin seats to the small set of IAM operators; regional administrators are application users with local grants. Record administrative mutations in the platform audit ledger independently of IdP log retention.

Enforce authorization in API middleware, repository/query scope, PostgreSQL RLS, and integration tests. Admin runtime roles must not own tables or bypass RLS. Every administrative mutation is audited.

## Required OIDC Validation

- issuer, audience, signature, expiry, nonce, state, and PKCE;
- immutable `sub` as the administrator identity key within the configured issuer; never use email as a key;
- verified redirect URIs;
- short-lived server-side sessions, secure cookies, CSRF protection, and MFA/step-up for high-risk actions.
