# Authgear Administrator Identity

Authgear Cloud authenticates platform administrators only. Baiyan's learner member database is a separate system for learner accounts and course history. The platform stores administrator roles, regional grants, and onboarding decisions in its own PostgreSQL database.

## Authgear setup

1. Create one Authgear project for platform administrators and configure MFA for administrator sign-in.
2. In Authgear Applications, add a **public OIDC Client Application** for the administration backend. Register the exact HTTPS callback URI used by the platform (`ADMIN_OIDC_REDIRECT_URI`); for production this is `https://checkin.baiyinqigong.org/admin/auth/callback`.
3. Configure the Authgear issuer and client ID using `ADMIN_OIDC_ISSUER_URL` and `ADMIN_OIDC_CLIENT_ID`, plus `ADMIN_OIDC_REDIRECT_URI` and `ADMIN_OIDC_SCOPES`. This public client has no client secret. The backend exchanges authorization codes using PKCE S256 and `token_endpoint_auth_method=none`. Do not use the Baiyan learner IdP values for these fields.
4. Limit Authgear portal administrator seats to IAM operators. Regional administrators log in as application users, then receive explicitly provisioned regional roles in `admin.principals` and `admin.role_grants`.

## Platform authorization boundary

- The verified OIDC `(iss, sub)` pair identifies a principal. A first login may create a private pending access request, never an administrator role; normal administrative access still requires explicitly reviewed local grants.
- Check principal status and current local grants for each protected request. Never accept a principal ID, role, or region from an HTTP header or OIDC profile claim as authorization.
- Use authorization-code flow with PKCE, state, nonce, signature/issuer/audience/expiry validation, secure server-side sessions, CSRF protection, and an explicit logout path.
- The platform's audit ledger records review and role-management actions independently of the IdP's log retention.

The OIDC configuration and claims contract live in `packages/identity`. The API exposes `/admin/auth/login`, `/admin/auth/callback`, `/admin/auth/me`, `/admin/auth/logout`, and `/admin/api/applications`. Login attempts and sessions are stored as hashed opaque tokens; the `__Host-qigong-admin` cookie is `Secure`, `HttpOnly`, and `SameSite=Lax`. Mutating admin routes require the separate CSRF cookie and `x-csrf-token` header. Administrative grants must be explicitly reviewed/provisioned before a normal administrative session succeeds; unapproved accounts use the isolated pending portal. Configure the Authgear HTTPS callback exactly and use TLS when exercising the cookie flow.

## Schema26: verified profile metadata (deployed97de588)

The deployed implementation requests the existing `openid profile email` scopes, validates the ID token, then reads the advertised UserInfo endpoint with the same grant access token and exact expected subject. Only verified email metadata is retained; neither email nor name authorizes account matching, linking or roles. Subject mismatch or UserInfo failure rejects the login safely. Pending and approved logins refresh active principal metadata by the verified issuer/subject in the session transaction. Missing values do not erase known metadata, and no role, region, grant revision or existing session is changed.

This repair was deployed with approval as97de588／schema26 on2026-10-12. Matching API/worker and migrations0001–0026 are required; historical migrations stay immutable. The applicant must log in again once to populate the email; refreshing the admin roster alone does not fetch Authgear UserInfo. The old caption “Email not provided by Authgear” becomes “Verified email not available”. See [Administrator OIDC profile repair](admin-oidc-profile.md) for tests, release and rollback boundaries.
