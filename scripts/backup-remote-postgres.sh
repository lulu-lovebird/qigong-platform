#!/usr/bin/env bash
set -euo pipefail

# Pull the greenfield platform database to ubuntu1 through an SSH forced command.
backup_dir="${QIGONG_BACKUP_DIR:-/home/myhsu/backups/qigong-platform}"
ssh_key="${QIGONG_BACKUP_SSH_KEY:-/home/myhsu/.ssh/qigong_platform_backup}"
remote="${QIGONG_BACKUP_REMOTE:-postgres@152.42.183.10}"
retention_days="${QIGONG_BACKUP_RETENTION_DAYS:-30}"

if [[ ! "$retention_days" =~ ^[1-9][0-9]*$ ]]; then
  echo 'QIGONG_BACKUP_RETENTION_DAYS must be a positive integer' >&2
  exit 1
fi
if [[ ! -f "$ssh_key" ]]; then
  echo 'Backup SSH key is missing' >&2
  exit 1
fi
if [[ ! -d "$backup_dir" || ! -O "$backup_dir" ]]; then
  echo 'Backup directory must exist and belong to the backup user' >&2
  exit 1
fi

umask 077
exec 9>"$backup_dir/.backup.lock"
if ! flock -n 9; then
  echo 'Another backup is already running' >&2
  exit 1
fi
log_file="$backup_dir/backup.log"
if [[ -e "$log_file" ]]; then
  chmod 600 "$log_file"
fi
name="qigong-platform-$(date -u +%Y%m%dT%H%M%SZ).dump"
temporary="$(mktemp "$backup_dir/.${name}.XXXXXX")"
trap 'rm -f -- "$temporary"' EXIT

ssh -i "$ssh_key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 \
  "$remote" backup-database > "$temporary"
if [[ ! -s "$temporary" ]]; then
  echo 'The remote database backup was empty' >&2
  exit 1
fi
docker run --rm -i postgres:16-alpine pg_restore --list < "$temporary" > /dev/null
mv -- "$temporary" "$backup_dir/$name"
trap - EXIT
(
  cd "$backup_dir"
  sha256sum "$name" > "$name.sha256"
)

# Prune only our named backups after a successfully verified copy has landed.
find "$backup_dir" -maxdepth 1 -type f -name 'qigong-platform-*.dump' -mtime "+$retention_days" -delete
find "$backup_dir" -maxdepth 1 -type f -name 'qigong-platform-*.dump.sha256' -mtime "+$retention_days" -delete
echo "Backup verified: $backup_dir/$name"
