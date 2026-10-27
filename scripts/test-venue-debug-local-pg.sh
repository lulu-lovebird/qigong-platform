#!/usr/bin/env bash
# Owned, fresh PG17 socket-only cluster; no inherited database/provider config.
# Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:$PATH"
for tool in node pnpm initdb pg_ctl; do
  command -v "$tool" >/dev/null || { printf 'SKIP: missing %s\n' "$tool"; exit 77; }
done
clean() { env -i HOME="$HOME" PATH="$PATH" LANG=C LC_ALL=C TZ=UTC "$@"; }
[[ $(clean node -p 'process.versions.node.split(".")[0]') == 24 ]]
[[ $(clean initdb --version) == *' 17.'* ]]
root=$(mktemp -d /tmp/venue-debug-integration-XXXXXXXX)
chmod 700 "$root"
mkdir -m 700 "$root/socket"
printf '%s\n' "$root" >"$root/venue-debug-owner-marker"
cleanup() {
  clean node --input-type=module - "$root" <<'JS'
import { readFileSync, realpathSync, statSync } from 'node:fs';
const root=process.argv[2], info=statSync(root);
if(!/^\/tmp\/venue-debug-integration-[A-Za-z0-9]+$/.test(root)||info.uid!==process.getuid()||(info.mode&0o777)!==0o700||readFileSync(root+'/venue-debug-owner-marker','utf8').trim()!==root)process.exit(1);
try { const pid=readFileSync(root+'/data/postmaster.pid','utf8').split('\n'); if(realpathSync(pid[1])!==realpathSync(root+'/data')||pid[3]!=='55485'||realpathSync(pid[4])!==realpathSync(root+'/socket'))process.exit(1); } catch(error) { if(error.code!=='ENOENT')throw error; }
JS
  if [[ -f "$root/data/postmaster.pid" ]]; then clean pg_ctl -D "$root/data" -m immediate -w stop >/dev/null; fi
  rm -rf -- "$root"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
clean initdb -D "$root/data" --username=venue_debug_owner --encoding=UTF8 --no-locale --auth-local=trust --auth-host=reject >"$root/init.log" 2>&1
# Parameter/error diagnostics disabled: SQL proofs and typed payloads must not leak.
clean pg_ctl -D "$root/data" -l "$root/server.log" -o "-F -k $root/socket -p 55485 -c listen_addresses='' -c unix_socket_permissions=0700 -c log_parameter_max_length=0 -c log_parameter_max_length_on_error=0 -c log_min_error_statement=panic" -w start >/dev/null
clean env VENUE_DEBUG_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-debug-postgres.test.ts
