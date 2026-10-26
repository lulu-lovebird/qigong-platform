#!/usr/bin/env bash
# Only creates a new disposable Unix-socket cluster. Never uses DATABASE_URL/.env.
# Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
set -euo pipefail
for tool in initdb pg_ctl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '%s\n' "SKIP: existing $tool is required; nothing installed or connected."
    exit 77
  fi
done
root=$(mktemp -d /tmp/venue-qr-pg.XXXXXXXX)
chmod 700 "$root"
mkdir "$root/socket"
cleanup() {
  if [[ -f "$root/data/postmaster.pid" ]]; then
    pg_ctl -D "$root/data" -m immediate -w stop >/dev/null
  fi
  case "$root" in /tmp/venue-qr-pg.*) rm -rf -- "$root" ;; esac
}
trap cleanup EXIT INT TERM
initdb -D "$root/data" --username=venue_test_owner --encoding=UTF8 --no-locale --auth-local=trust --auth-host=reject >"$root/init.log" 2>&1
pg_ctl -D "$root/data" -l "$root/server.log" -o "-F -k $root/socket -p 55479 -c listen_addresses='' -c unix_socket_permissions=0700" -w start >/dev/null
printf '%s\n' "$root" >"$root/isolated-venue-qr-marker"
cd "$(dirname "$0")/.."
env -u TEST_DATABASE_URL -u DATABASE_URL -u PGSERVICE -u PGSERVICEFILE -u PGOPTIONS \
  VENUE_QR_ISOLATED_PG_DIR="$root" \
  pnpm --filter @qigong/public-api exec vitest run tests/venue-qr-postgres.test.ts
