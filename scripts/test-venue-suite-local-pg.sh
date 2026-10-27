#!/usr/bin/env bash
# Entirely disposable PG16/17, socket-only, synthetic data. Never loads dotenv.
# Developed with ❤️ by Bean, Bird & Badminton Tech Consulting
set -euo pipefail
export LANG=C LC_ALL=C TZ=UTC
cd "$(dirname "$0")/.."
case ${1:-all} in all|focused|full) ;; *) printf '%s\n' 'Expected all, focused or full' >&2; exit 1 ;; esac
# Node 24 and pnpm must already be on the operator-trusted PATH. No installation,
# platform paths, inherited DB configuration or service-PG fallback.
discovery=(env -i PATH="$PATH" LANG=C LC_ALL=C TZ=UTC)
if [[ ${PG_BIN_DIR+x} ]]; then discovery+=(PG_BIN_DIR="$PG_BIN_DIR"); fi
PG_BIN_DIR=$("${discovery[@]}" node packages/database/tests/local-pg-tools.ts)
export PG_BIN_DIR
export PATH="$PG_BIN_DIR:$PATH"
clean() { env -i HOME="$HOME" PATH="$PATH" LANG=C LC_ALL=C TZ=UTC PG_BIN_DIR="$PG_BIN_DIR" "$@"; }
root=''
port=''
cleanup() {
  [[ -n "$root" ]] || return 0
  # Refuse cleanup unless this process's marker, owner, mode and live PID agree.
  clean node --input-type=module - "$root" "$port" <<'JS'
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
  if [[ -f "$root/data/postmaster.pid" ]]; then clean "$PG_BIN_DIR/pg_ctl" -D "$root/data" -m immediate -w stop >/dev/null; fi
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
  clean "$PG_BIN_DIR/initdb" -D "$root/data" --username="$owner" --encoding=UTF8 --no-locale --auth-local=trust --auth-host=reject >"$root/init.log" 2>&1
  clean "$PG_BIN_DIR/pg_ctl" -D "$root/data" -l "$root/server.log" -o "-F -k $root/socket -p $port -c listen_addresses='' -c unix_socket_permissions=0700" -w start >/dev/null
  local listening
  listening=$(clean node --input-type=module - "$root" "$port" "$owner" <<'JS'
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('packages/database/package.json'));
const { Client } = require('pg');
const [root, port, user] = process.argv.slice(2);
const client = new Client({ host: root+'/socket', port: Number(port), user, database: 'postgres', password: '', ssl: false });
try {
  await client.connect();
  const result = await client.query("SELECT current_setting('listen_addresses') AS value");
  if (result.rows[0]?.value !== '') throw new Error('TCP listener must be disabled');
  console.log('socket-only');
} finally { await client.end(); }
JS
)
  [[ "$listening" == socket-only ]]
}
if [[ ${1:-all} != full ]]; then
  clean pnpm --filter @qigong/database exec vitest run tests/local-pg-tools.test.ts tests/venue-history-postgres.test.ts
  start management venue_management_owner 55478
  printf '%s\n' "$root" >"$root/venue-management-marker"
  clean env VENUE_MANAGEMENT_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-management-postgres.test.ts
  cleanup
  start people venue_people_owner 55483
  printf '%s\n' "$root" >"$root/isolated-venue-people-marker"
  clean env VENUE_PEOPLE_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-people-postgres.test.ts
  cleanup
  start qr venue_test_owner 55479
  printf '%s\n' "$root" >"$root/isolated-venue-qr-marker"
  clean env VENUE_QR_ISOLATED_PG_DIR="$root" pnpm --filter @qigong/public-api exec vitest run tests/venue-qr-postgres.test.ts
  cleanup
fi
if [[ ${1:-all} != focused ]]; then
  start full venue_suite_owner 55484
  clean "$PG_BIN_DIR/createdb" -h "$root/socket" -p "$port" -U venue_suite_owner venue_suite_test
  # URL is created here, never adopted from the calling environment. Tests create
  # and dispose their own databases; allowlisted orphan roles are cleaned safely.
  url="postgresql://venue_suite_owner@localhost/venue_suite_test?host=$root/socket&port=$port"
  clean env TEST_DATABASE_URL="$url" TEST_DATABASE_ALLOW_ROLE_TEARDOWN=true pnpm verify
  clean pnpm exec tsc -p tsconfig.eslint.json --noEmit
  clean pnpm exec tsc -p tsconfig.receipt-health.json --noEmit
  cleanup
fi
