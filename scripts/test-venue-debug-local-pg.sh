#!/usr/bin/env bash
# Fresh, owned PG17 socket-only clusters. No inherited DB/provider configuration.
# Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH"
export LANG=C LC_ALL=C TZ=UTC
case ${1:-debug} in debug|migration|focused|full|all) ;; *) printf 'Expected debug, migration, focused, full or all\n' >&2; exit 1 ;; esac
for tool in node pnpm initdb pg_ctl createdb; do
  command -v "$tool" >/dev/null || { printf 'SKIP: missing %s\n' "$tool"; exit 77; }
done
clean() { env -i HOME="$HOME" PATH="$PATH" LANG=C LC_ALL=C TZ=UTC "$@"; }
[[ $(clean node -p 'process.versions.node.split(".")[0]') == 24 ]]
[[ $(clean initdb --version) == *' 17.'* ]]
root=''
port=''
cleanup() {
  [[ -n "$root" ]] || return 0
  clean node --input-type=module - "$root" "$port" <<'JS'
import { readFileSync, realpathSync, statSync } from 'node:fs';
const [root,port]=process.argv.slice(2), info=statSync(root);
if(!/^\/tmp\/venue-debug-integration-[A-Za-z0-9]+$/.test(root)||info.uid!==process.getuid()||(info.mode&0o777)!==0o700||readFileSync(root+'/venue-debug-owner-marker','utf8').trim()!==root)process.exit(1);
try { const pid=readFileSync(root+'/data/postmaster.pid','utf8').split('\n'); if(realpathSync(pid[1])!==realpathSync(root+'/data')||pid[3]!==port||realpathSync(pid[4])!==realpathSync(root+'/socket'))process.exit(1); } catch(error) { if(error.code!=='ENOENT')throw error; }
JS
  if [[ -f "$root/data/postmaster.pid" ]]; then clean pg_ctl -D "$root/data" -m immediate -w stop >/dev/null; fi
  rm -rf -- "$root"
  root=''
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
start() {
  local owner=$1
  port=$2
  root=$(mktemp -d /tmp/venue-debug-integration-XXXXXXXX)
  chmod 700 "$root"
  mkdir -m 700 "$root/socket"
  printf '%s\n' "$root" >"$root/venue-debug-owner-marker"
  clean initdb -D "$root/data" --username="$owner" --encoding=UTF8 --no-locale --auth-local=trust --auth-host=reject >"$root/init.log" 2>&1
  # Disable parameter/statement diagnostics: proof and GPS are ephemeral.
  clean pg_ctl -D "$root/data" -l "$root/server.log" -o "-F -k $root/socket -p $port -c listen_addresses='' -c unix_socket_permissions=0700 -c log_parameter_max_length=0 -c log_parameter_max_length_on_error=0 -c log_min_error_statement=panic" -w start >/dev/null
}
if [[ ${1:-debug} != full ]]; then
  start venue_debug_owner 55485
  if [[ ${1:-debug} == migration ]]; then
    clean env VENUE_DEBUG_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-debug-postgres.test.ts -t 'migration'
  else
    clean env VENUE_DEBUG_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-debug-postgres.test.ts
  fi
  cleanup
fi
if [[ ${1:-debug} == focused || ${1:-debug} == all ]]; then
  start venue_management_owner 55478
  printf '%s\n' "$root" >"$root/venue-management-marker"
  clean env VENUE_MANAGEMENT_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-management-postgres.test.ts
  cleanup
  start venue_people_owner 55483
  printf '%s\n' "$root" >"$root/isolated-venue-people-marker"
  clean env VENUE_PEOPLE_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-people-postgres.test.ts
  cleanup
  start venue_test_owner 55479
  printf '%s\n' "$root" >"$root/isolated-venue-qr-marker"
  clean env VENUE_QR_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-qr-postgres.test.ts
  cleanup
fi
if [[ ${1:-debug} == full || ${1:-debug} == all ]]; then
  start venue_debug_owner 55485
  clean createdb -h "$root/socket" -p "$port" -U venue_debug_owner venue_debug_test
  # Constructed here only, never adopted from the operator environment.
  url="postgresql://venue_debug_owner@localhost/venue_debug_test?host=$root/socket&port=$port"
  # Runtime smoke tests execute the compiled worker through a symlink. A fresh
  # worktree must build first; verify's own build runs only after its test stage.
  clean pnpm build
  clean env TEST_DATABASE_URL="$url" TEST_DATABASE_ALLOW_ROLE_TEARDOWN=true pnpm verify
  clean pnpm exec tsc -p tsconfig.eslint.json --noEmit
  clean pnpm exec tsc -p tsconfig.receipt-health.json --noEmit
  cleanup
fi
