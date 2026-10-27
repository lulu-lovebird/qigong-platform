#!/usr/bin/env bash
# Entirely disposable PG17, socket-only, synthetic data. Never loads dotenv.
# Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
set -euo pipefail
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:/usr/bin:/bin"
export LANG=C LC_ALL=C TZ=UTC
[[ $(node --version) == v24.* && $(postgres --version) == *' 17.'* ]] || exit 77
cd "$(dirname "$0")/.."
root=''
port=''
cleanup() {
  [[ -n "$root" ]] || return 0
  # Refuse cleanup unless this process's marker, owner, mode and live PID agree.
  node --input-type=module - "$root" "$port" <<'JS'
import { readFileSync, realpathSync, statSync } from 'node:fs';
const [root, port] = process.argv.slice(2);
if (!/^\/tmp\/venue-suite-(management|people|qr|full)-[A-Za-z0-9]+$/.test(root)) process.exit(1);
const info = statSync(root);
if (info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700 || readFileSync(root+'/suite-owner-marker','utf8').trim() !== root) process.exit(1);
try {
  const pid = readFileSync(root+'/data/postmaster.pid','utf8').split('\n');
  if (realpathSync(pid[1]) !== realpathSync(root+'/data') || pid[3] !== port || realpathSync(pid[4]) !== realpathSync(root+'/socket')) process.exit(1);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
JS
  if [[ -f "$root/data/postmaster.pid" ]]; then pg_ctl -D "$root/data" -m immediate -w stop >/dev/null; fi
  rm -rf -- "$root"
  root=''
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
start() {
  local kind=$1 owner=$2
  port=$3
  root=$(mktemp -d "/tmp/venue-suite-${kind}-XXXXXXXX")
  chmod 700 "$root"
  mkdir -m 700 "$root/socket"
  printf '%s\n' "$root" >"$root/suite-owner-marker"
  env -i HOME="$HOME" PATH="$PATH" LANG=C LC_ALL=C TZ=UTC initdb -D "$root/data" --username="$owner" --encoding=UTF8 --no-locale --auth-local=trust --auth-host=reject >"$root/init.log" 2>&1
  env -i HOME="$HOME" PATH="$PATH" LANG=C LC_ALL=C TZ=UTC pg_ctl -D "$root/data" -l "$root/server.log" -o "-F -k $root/socket -p $port -c listen_addresses='' -c unix_socket_permissions=0700" -w start >/dev/null
}
if [[ ${1:-all} != full ]]; then
  start management venue_management_owner 55478
  printf '%s\n' "$root" >"$root/venue-management-marker"
  env -i HOME="$HOME" PATH="$PATH" LANG=C LC_ALL=C TZ=UTC VENUE_MANAGEMENT_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-management-postgres.test.ts
  cleanup
  start people venue_people_owner 55483
  printf '%s\n' "$root" >"$root/isolated-venue-people-marker"
  env -i HOME="$HOME" PATH="$PATH" LANG=C LC_ALL=C TZ=UTC VENUE_PEOPLE_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-people-postgres.test.ts
  cleanup
  start qr venue_test_owner 55479
  printf '%s\n' "$root" >"$root/isolated-venue-qr-marker"
  env -i HOME="$HOME" PATH="$PATH" LANG=C LC_ALL=C TZ=UTC VENUE_QR_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-qr-postgres.test.ts
  cleanup
fi
if [[ ${1:-all} != focused ]]; then
  start full venue_suite_owner 55484
  env -i HOME="$HOME" PATH="$PATH" LANG=C LC_ALL=C TZ=UTC createdb -h "$root/socket" -p "$port" -U venue_suite_owner venue_suite_test
  # URL is created here, never adopted from the calling environment. Tests create
  # and dispose their own databases; allowlisted orphan roles are cleaned safely.
  url="postgresql://venue_suite_owner@localhost/venue_suite_test?host=$root/socket&port=$port"
  env -i HOME="$HOME" PATH="$PATH" LANG=C LC_ALL=C TZ=UTC TEST_DATABASE_URL="$url" TEST_DATABASE_ALLOW_ROLE_TEARDOWN=true pnpm verify
  env -i HOME="$HOME" PATH="$PATH" LANG=C LC_ALL=C TZ=UTC pnpm exec tsc -p tsconfig.eslint.json --noEmit
  env -i HOME="$HOME" PATH="$PATH" LANG=C LC_ALL=C TZ=UTC pnpm exec tsc -p tsconfig.receipt-health.json --noEmit
  cleanup
fi
