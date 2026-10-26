#!/usr/bin/env bash
# Synthetic only. No dotenv, existing database, TCP, or external services.
# Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
set -euo pipefail
root=$(mktemp -d /tmp/venue-management-XXXXXXXX)
chmod 700 "$root"
mkdir -m 700 "$root/socket"
cleanup() {
  if [[ -f "$root/data/postmaster.pid" ]]; then pg_ctl -D "$root/data" -m immediate -w stop >/dev/null; fi
  case "$root" in /tmp/venue-management-*) rm -rf -- "$root" ;; esac
}
trap cleanup EXIT INT TERM
initdb -D "$root/data" --username=venue_management_owner --encoding=UTF8 --no-locale --auth-local=trust --auth-host=reject >"$root/init.log" 2>&1
pg_ctl -D "$root/data" -l "$root/server.log" -o "-F -k $root/socket -p 55478 -c listen_addresses='' -c unix_socket_permissions=0700" -w start >/dev/null
printf '%s\n' "$root" >"$root/venue-management-marker"
cd "$(dirname "$0")/../../.."
env -u DATABASE_URL -u TEST_DATABASE_URL -u PGSERVICE -u PGSERVICEFILE -u PGOPTIONS \
 VENUE_MANAGEMENT_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-management-postgres.test.ts
