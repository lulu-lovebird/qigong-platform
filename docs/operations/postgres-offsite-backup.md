# Offsite PostgreSQL Backup (ubuntu1)

The Singapore Droplet hosts the canonical `qigong_platform` database. A user crontab on the home server `ubuntu1` **pulls** a compressed custom-format `pg_dump` over a dedicated SSH forced command, verifies it with PostgreSQL 16 `pg_restore --list`, then stores it under `/home/myhsu/backups/qigong-platform` with a SHA-256 checksum. The home server need not accept inbound connections from the Droplet. Both systems must remain reachable from `ubuntu1` when a backup runs; a failed pull retains the previous good backups.

## Credentials and scope

- `ubuntu1` owns a dedicated Ed25519 key in `/home/myhsu/.ssh/qigong_platform_backup` (mode 0600). Its public key is installed **only** for the Droplet's `postgres` OS account with `command="/usr/bin/pg_dump --format=custom --no-owner --no-acl --dbname=qigong_platform",restrict`. The key cannot open a shell or run arbitrary SQL. Verify the SSH host key fingerprint before accepting it into `known_hosts`.
- No database password or Telegram/Authgear token is copied into Git. The dump contains learner and administrator data: keep the backup directory mode 0700 and copied files mode 0600.
- Backup retention is 30 days (`QIGONG_BACKUP_RETENTION_DAYS`). This logical backup covers the database schema, data, and ownership references, **not** cluster roles, `/etc/qigong-platform/api.env`, or Caddy/systemd host configuration. Recreate roles from the deployment contract before restoring to a fresh host.

## Verify and restore into an isolated database

On `ubuntu1`, pick a backup and verify its checksum (`cd /home/myhsu/backups/qigong-platform && sha256sum -c <backup>.sha256`). Run a separate PostgreSQL 16 container with **no published ports**, create empty `restore_test`, create the `qigong_api_runtime`, `qigong_worker_runtime`, and `qigong_authorizer` placeholder roles, then use `pg_restore --no-owner --no-acl` into it. Check `schema_migrations`, counts of `admin.principals`, `core.regions`, `identity.onboarding_applications`, and `audit.events` against the source snapshot. Do **not** restore over production. Destroy the test container after verification.

## Operations

`ubuntu1` runs the user crontab entry `20 19 * * * /home/myhsu/Devel/qigong-platform/scripts/backup-remote-postgres.sh >> /home/myhsu/backups/qigong-platform/backup.log 2>&1` (19:20 UTC = 03:20 Asia/Taipei year-round). Confirm `systemctl is-active cron`, `crontab -l`, and inspect the private log and backup timestamps after each run. Cron does not catch up if the home server was off at the scheduled time; run the script manually after an outage. Missing backups or non-zero runs need attention. Repeat an isolated restore drill after schema or role changes.
