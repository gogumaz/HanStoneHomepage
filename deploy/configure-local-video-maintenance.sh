#!/usr/bin/env bash
set -euo pipefail

APPLY=false
CONFIRM=""
SOURCE_ROOT="/var/www/hanstone/media/lessons"
BACKUP_ROOT="/var/backups/hanstone/local-videos"
MAX_BYTES="${LOCAL_VIDEO_MAX_BYTES:-268435456}"
WARNING_BYTES="${LOCAL_VIDEO_WARNING_FREE_BYTES:-5368709120}"
CRITICAL_BYTES="${LOCAL_VIDEO_CRITICAL_FREE_BYTES:-1073741824}"
MAX_BACKUP_AGE_HOURS="${LOCAL_VIDEO_MAX_BACKUP_AGE_HOURS:-36}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

usage() {
  cat <<'USAGE'
Usage:
  sudo ./deploy/configure-local-video-maintenance.sh
  sudo ./deploy/configure-local-video-maintenance.sh \
    --apply --confirm CONFIGURE_LOCAL_VIDEO_MAINTENANCE

The first command validates the installation. The apply command installs two
systemd timers, performs an initial backup, and verifies storage health.
USAGE
}

while (($#)); do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$(uname -s)" == "Linux" ]] || { printf 'LINUX_REQUIRED\n' >&2; exit 2; }
command -v python3 >/dev/null || { printf 'PYTHON3_REQUIRED\n' >&2; exit 2; }
command -v systemctl >/dev/null || { printf 'SYSTEMD_REQUIRED\n' >&2; exit 2; }
[[ -d "$SOURCE_ROOT" && ! -L "$SOURCE_ROOT" ]] || { printf 'SOURCE_ROOT_INVALID\n' >&2; exit 2; }
BACKUP_PARENT="$(dirname -- "$BACKUP_ROOT")"
[[ ! -e "$BACKUP_PARENT" || (-d "$BACKUP_PARENT" && ! -L "$BACKUP_PARENT") ]] || {
  printf 'BACKUP_PARENT_INVALID\n' >&2
  exit 2
}
[[ ! -e "$BACKUP_ROOT" || (-d "$BACKUP_ROOT" && ! -L "$BACKUP_ROOT") ]] || {
  printf 'BACKUP_ROOT_INVALID\n' >&2
  exit 2
}
for value in "$MAX_BYTES" "$WARNING_BYTES" "$CRITICAL_BYTES" "$MAX_BACKUP_AGE_HOURS"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { printf 'NUMERIC_SETTING_INVALID\n' >&2; exit 2; }
done
((MAX_BYTES > 0 && MAX_BYTES <= 1073741824)) || { printf 'MAX_BYTES_INVALID\n' >&2; exit 2; }
((CRITICAL_BYTES > 0 && WARNING_BYTES > CRITICAL_BYTES)) || { printf 'FREE_SPACE_THRESHOLDS_INVALID\n' >&2; exit 2; }
((MAX_BACKUP_AGE_HOURS >= 1 && MAX_BACKUP_AGE_HOURS <= 168)) || { printf 'MAX_BACKUP_AGE_INVALID\n' >&2; exit 2; }

for file in \
  "$SCRIPT_DIR/local-video-maintenance.py" \
  "$SCRIPT_DIR/systemd/hanstone-local-video-backup.service" \
  "$SCRIPT_DIR/systemd/hanstone-local-video-backup.timer" \
  "$SCRIPT_DIR/systemd/hanstone-local-video-check.service" \
  "$SCRIPT_DIR/systemd/hanstone-local-video-check.timer"; do
  [[ -f "$file" && ! -L "$file" ]] || { printf 'INSTALL_SOURCE_INVALID\n' >&2; exit 2; }
done

python3 "$SCRIPT_DIR/local-video-maintenance.py" check \
  --source "$SOURCE_ROOT" --backup-root "$BACKUP_ROOT" \
  --max-bytes "$MAX_BYTES" --warning-free-bytes "$WARNING_BYTES" \
  --critical-free-bytes "$CRITICAL_BYTES" --max-backup-age-hours "$MAX_BACKUP_AGE_HOURS" || true
printf 'validation=pass\nsource=%s\nbackup=%s\n' "$SOURCE_ROOT" "$BACKUP_ROOT"

if [[ "$APPLY" != true ]]; then
  printf 'mode=dry-run\n'
  exit 0
fi
[[ "$CONFIRM" == "CONFIGURE_LOCAL_VIDEO_MAINTENANCE" ]] || { printf 'CONFIRMATION_REQUIRED\n' >&2; exit 2; }
[[ "$(id -u)" -eq 0 ]] || { printf 'ROOT_REQUIRED\n' >&2; exit 2; }

install -d -o root -g root -m 0755 /usr/local/lib/hanstone
install -d -o root -g root -m 0755 /etc/hanstone
install -d -o root -g root -m 0700 "$BACKUP_ROOT"
install -o root -g root -m 0755 "$SCRIPT_DIR/local-video-maintenance.py" /usr/local/lib/hanstone/local-video-maintenance.py
for unit in hanstone-local-video-backup.service hanstone-local-video-backup.timer hanstone-local-video-check.service hanstone-local-video-check.timer; do
  install -o root -g root -m 0644 "$SCRIPT_DIR/systemd/$unit" "/etc/systemd/system/$unit"
done

ENV_TEMP="$(mktemp /etc/hanstone/.local-video-maintenance.env.XXXXXX)"
cleanup() { rm -f -- "$ENV_TEMP"; }
trap cleanup EXIT
chmod 0600 "$ENV_TEMP"
cat >"$ENV_TEMP" <<EOF
LOCAL_VIDEO_SOURCE=$SOURCE_ROOT
LOCAL_VIDEO_BACKUP_ROOT=$BACKUP_ROOT
LOCAL_VIDEO_MAX_BYTES=$MAX_BYTES
LOCAL_VIDEO_WARNING_FREE_BYTES=$WARNING_BYTES
LOCAL_VIDEO_CRITICAL_FREE_BYTES=$CRITICAL_BYTES
LOCAL_VIDEO_MAX_BACKUP_AGE_HOURS=$MAX_BACKUP_AGE_HOURS
EOF
chown root:root "$ENV_TEMP"
mv -f -- "$ENV_TEMP" /etc/hanstone/local-video-maintenance.env
trap - EXIT

systemctl daemon-reload
systemctl enable --now hanstone-local-video-backup.timer hanstone-local-video-check.timer
systemctl start hanstone-local-video-backup.service
systemctl start hanstone-local-video-check.service
printf 'mode=applied\ntimers=enabled\ninitialBackup=complete\ninitialCheck=healthy\n'
