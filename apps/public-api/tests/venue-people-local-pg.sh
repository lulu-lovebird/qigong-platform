#!/usr/bin/env bash
# Disposable PG17/Node24 only; never adopt an existing DB or use connection URLs.
# Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
set -euo pipefail
for tool in initdb pg_ctl postgres node pnpm; do
  command -v "$tool" >/dev/null || { printf '%s\n' "SKIP: $tool required"; exit 77; }
done
[[ $(node --version) == v24.* ]] || { printf '%s\n' 'Node24 required'; exit 77; }
[[ $(postgres --version) == *' 17.'* ]] || { printf '%s\n' 'PG17 required'; exit 77; }
root=$(mktemp -d /tmp/venue-people-pg.XXXXXXXX)
chmod 700 "$root"
mkdir -m 700 "$root/socket"
cleanup() {
  if [[ -f "$root/data/postmaster.pid" ]]; then
    pg_ctl -D "$root/data" -m immediate -w stop >/dev/null
  fi
  case "$root" in /tmp/venue-people-pg.*) rm -rf -- "$root" ;; esac
}
trap cleanup EXIT INT TERM
initdb -D "$root/data" --username=venue_people_owner --encoding=UTF8 --no-locale --auth-local=trust --auth-host=reject >"$root/init.log" 2>&1
pg_ctl -D "$root/data" -l "$root/server.log" -o "-F -k $root/socket -p 55483 -c listen_addresses='' -c unix_socket_permissions=0700" -w start >/dev/null
printf '%s\n' "$root" >"$root/isolated-venue-people-marker"
cd "$(dirname "$0")/../../.."
env -u TEST_DATABASE_URL -u DATABASE_URL -u PGSERVICE -u PGSERVICEFILE -u PGOPTIONS \
  -u PGHOST -u PGPORT -u PGDATABASE -u PGUSER -u PGPASSWORD -u PGSSLMODE \
  VENUE_PEOPLE_ISOLATED_PG_DIR="$root" \
  pnpm --filter @qigong/public-api exec vitest run tests/venue-people-postgres.test.ts
