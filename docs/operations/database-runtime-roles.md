# Database Runtime Roles

Migration `0003_runtime_roles_and_rls.sql` creates three cluster roles:

- `qigong_api_runtime`: request-scoped API reads through RLS.
- `qigong_worker_runtime`: background-worker reads through separate RLS policies.
- `qigong_authorizer`: non-login owner of reviewed authorization helper functions.

All three roles are forced to `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS`. The migration fails if any controlled role already has an incoming or outgoing membership.

## Deployment Contract

The infrastructure layer creates credential-bearing login roles after migrations complete. Application credentials must not use a migration owner, table owner, superuser, or role with `BYPASSRLS`.

For the API login:

```sql
CREATE ROLE qigong_api_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '<managed secret>';
GRANT qigong_api_runtime TO qigong_api_login;
```

For a worker login:

```sql
CREATE ROLE qigong_worker_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '<managed secret>';
GRANT qigong_worker_runtime TO qigong_worker_login;
```

The login roles receive no direct schema, table, sequence, or function grants. They can only enter their assigned runtime role inside an explicit transaction.

## Startup Preflight

Before accepting traffic, each process must verify:

1. `SESSION_USER` is the expected managed login role.
2. The login role is not superuser and does not have `BYPASSRLS`.
3. `SET LOCAL ROLE` succeeds for the process runtime role inside a transaction.
4. `SET LOCAL ROLE` fails for the other runtime role and for `qigong_authorizer`.
5. A protected table query without request context returns no rows.

## Rotation And Revocation

1. Create the replacement login role with the same negative attributes.
2. Grant only the required runtime role.
3. Deploy and verify startup preflight with the replacement credential.
4. Revoke runtime membership from the old login role.
5. Terminate old sessions, then drop the old login role.

Never grant membership in `qigong_authorizer`. It exists only as a `SECURITY DEFINER` function owner.

Audit events remain unavailable to runtime roles until event rows carry enforceable Region, cohort, or privacy-case attribution. This is intentionally fail closed rather than inferring audit visibility from the event actor.
