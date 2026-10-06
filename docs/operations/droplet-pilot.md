# Singapore Droplet Pilot

The initial greenfield platform is deployed on a Singapore Ubuntu 24.04 Droplet behind Caddy at `https://checkin.baiyinqigong.org`. PostgreSQL 16 and the API run locally on the host; no legacy check-ins are imported. The new platform uses a separate Telegram bot and webhook; legacy messaging webhooks remain unchanged.

## Runtime

- `qigong-platform-api.service` runs Node.js 24 as the `qigong-api` OS user from `/opt/qigong-platform/current`.
- `/etc/qigong-platform/api.env` supplies the Authgear public-client issuer, client ID, callback URI, and local peer-authenticated PostgreSQL connection string. The API connects as PostgreSQL role `qigong-api`, which may assume only `qigong_api_runtime` inside a transaction.
- PostgreSQL listens only on localhost; Caddy proxies HTTPS requests to `127.0.0.1:3100`. Check `https://checkin.baiyinqigong.org/health/ready` after restarting either service.
- Migrations are executed as the local `postgres` OS/database administrator with `DATABASE_URL=postgresql://postgres@localhost/qigong_platform?host=/var/run/postgresql`. Do not use the API login role for migrations.
- SQL migration `0006_runtime_migration_visibility.sql` grants the API runtime read-only access to the migration ledger. The application reads it under `SET LOCAL ROLE`; the API login has no direct table grants.

## Next deployment

The pilot deployment initially used a locally verified worktree. Before enabling automatic deployments, replace in-place updates with versioned releases, validate migrations and health checks before switching traffic, and test rollback. Do not overwrite `/etc/qigong-platform/api.env` with repository content.

## Outstanding pilot setup

- Add off-host PostgreSQL backups and a restore drill before accepting learner data.
- The review UI is available at `https://checkin.baiyinqigong.org/admin/`. It requires an Authgear-backed administrator session and uses the scoped review API. The new Telegram onboarding webhook is active; LINE and WhatsApp onboarding remain pending.
- Administrators may select individual visible applications or select all displayed applications (up to 100), then confirm a batch approval. Each application is checked independently against its region and current status and is audited separately; the response reports approved, conflict, or unavailable per application.
