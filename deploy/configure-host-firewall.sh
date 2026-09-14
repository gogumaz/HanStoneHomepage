#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

APPLY=false
CONFIRMATION=""
SSH_PORT=""
ROLLBACK_ARMED=false
ORIGINAL_UFW_ACTIVE=false
BACKUP_DIR=""

usage() {
  cat <<'EOF'
Usage:
  bash deploy/configure-host-firewall.sh --ssh-port PORT
  sudo bash deploy/configure-host-firewall.sh --apply --ssh-port PORT \
    --confirm ACTIVATE_HOST_FIREWALL

The default mode is read-only. Apply mode preserves the verified SSH port,
allows HTTP and HTTPS, sets deny-incoming/allow-outgoing defaults, and then
enables UFW. Existing UFW user rules are backed up before any change.
EOF
}

fail() {
  printf '{"ok":false,"errorType":"%s"}\n' "$1" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --apply)
      APPLY=true
      shift
      ;;
    --confirm)
      (($# >= 2)) || fail 'HOST_FIREWALL_ARGUMENTS_INVALID'
      CONFIRMATION="$2"
      shift 2
      ;;
    --ssh-port)
      (($# >= 2)) || fail 'HOST_FIREWALL_ARGUMENTS_INVALID'
      SSH_PORT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail 'HOST_FIREWALL_ARGUMENTS_INVALID'
      ;;
  esac
done

[[ -n "$SSH_PORT" && "$SSH_PORT" =~ ^[0-9]+$ ]] || fail 'HOST_FIREWALL_SSH_PORT_REQUIRED'
((10#$SSH_PORT >= 1 && 10#$SSH_PORT <= 65535)) || fail 'HOST_FIREWALL_SSH_PORT_INVALID'
[[ "$(uname -s 2>/dev/null || true)" == "Linux" ]] || fail 'HOST_FIREWALL_LINUX_REQUIRED'
[[ -r /etc/os-release ]] || fail 'HOST_FIREWALL_OS_RELEASE_MISSING'

# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || fail 'HOST_FIREWALL_UBUNTU_REQUIRED'

for command_name in grep ss systemctl ufw; do
  command -v "$command_name" >/dev/null 2>&1 || fail 'HOST_FIREWALL_DEPENDENCY_MISSING'
done

systemctl is-active --quiet ssh || fail 'HOST_FIREWALL_SSH_SERVICE_INACTIVE'
ss -ltnH | awk '{print $4}' | grep -Eq "(^|:)${SSH_PORT}$" \
  || fail 'HOST_FIREWALL_SSH_LISTENER_NOT_FOUND'
systemctl is-active --quiet nginx || fail 'HOST_FIREWALL_NGINX_SERVICE_INACTIVE'
LISTENERS="$(ss -ltnH | awk '{print $4}')"
grep -Eq '(^|:)80$' <<<"$LISTENERS" || fail 'HOST_FIREWALL_HTTP_LISTENER_NOT_FOUND'
grep -Eq '(^|:)443$' <<<"$LISTENERS" || fail 'HOST_FIREWALL_HTTPS_LISTENER_NOT_FOUND'

if [[ "$APPLY" != true ]]; then
  printf '%s\n' 'HanStone host firewall plan (read-only)'
  printf 'Verified SSH port: %s/tcp\n' "$SSH_PORT"
  printf '%s\n' 'Verified public services: 80/tcp, 443/tcp'
  printf '%s\n' 'Default policies: deny incoming, allow outgoing'
  ufw status verbose || fail 'HOST_FIREWALL_STATUS_UNAVAILABLE'
  printf '{"ok":true,"mode":"plan","sshPort":%d,"changesApplied":false}\n' "$((10#$SSH_PORT))"
  exit 0
fi

[[ "$CONFIRMATION" == 'ACTIVATE_HOST_FIREWALL' ]] \
  || fail 'HOST_FIREWALL_CONFIRMATION_REQUIRED'
((EUID == 0)) || fail 'HOST_FIREWALL_ROOT_REQUIRED'

if [[ -n "${SSH_CONNECTION:-}" ]]; then
  read -r _ _ _ ACTIVE_SSH_PORT <<<"${SSH_CONNECTION}"
  [[ "$ACTIVE_SSH_PORT" == "$SSH_PORT" ]] || fail 'HOST_FIREWALL_ACTIVE_SSH_PORT_MISMATCH'
fi

if ufw status | grep -Fq 'Status: active'; then
  ORIGINAL_UFW_ACTIVE=true
fi

[[ ! -L /var/backups/hanstone-firewall ]] || fail 'HOST_FIREWALL_BACKUP_SYMLINK_FORBIDDEN'
install -d -m 0700 /var/backups/hanstone-firewall
BACKUP_DIR="/var/backups/hanstone-firewall/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 0700 "$BACKUP_DIR"
for rules_file in user.rules user6.rules; do
  [[ -f "/etc/ufw/${rules_file}" && ! -L "/etc/ufw/${rules_file}" ]] \
    || fail 'HOST_FIREWALL_RULES_FILE_INVALID'
  cp -a -- "/etc/ufw/${rules_file}" "$BACKUP_DIR/${rules_file}"
done

rollback_on_error() {
  local exit_code=$?
  trap - ERR
  set +e
  if [[ "$ROLLBACK_ARMED" == true ]]; then
    cp -a -- "$BACKUP_DIR/user.rules" /etc/ufw/user.rules
    cp -a -- "$BACKUP_DIR/user6.rules" /etc/ufw/user6.rules
    if [[ "$ORIGINAL_UFW_ACTIVE" == true ]]; then
      ufw reload
    else
      ufw --force disable
    fi
  fi
  printf '{"ok":false,"errorType":"HOST_FIREWALL_APPLY_FAILED","rollbackAttempted":true}\n' >&2
  exit "$exit_code"
}
trap rollback_on_error ERR
ROLLBACK_ARMED=true

# The active SSH port is allowed before any default policy or enable operation.
ufw allow "${SSH_PORT}/tcp" comment 'HanStone SSH'
ufw allow 80/tcp comment 'HanStone HTTP'
ufw allow 443/tcp comment 'HanStone HTTPS'
ufw default deny incoming
ufw default allow outgoing
ufw --force enable

UFW_STATUS="$(ufw status verbose)"
grep -Fq 'Status: active' <<<"$UFW_STATUS"
grep -Eq "(^|[[:space:]])${SSH_PORT}/tcp[[:space:]]+ALLOW" <<<"$UFW_STATUS"
grep -Eq '(^|[[:space:]])80/tcp[[:space:]]+ALLOW' <<<"$UFW_STATUS"
grep -Eq '(^|[[:space:]])443/tcp[[:space:]]+ALLOW' <<<"$UFW_STATUS"
grep -Eq 'Default:[[:space:]]+deny \(incoming\), allow \(outgoing\)' <<<"$UFW_STATUS"

ROLLBACK_ARMED=false
trap - ERR
printf '{"ok":true,"mode":"apply","sshPort":%d,"changesApplied":true,"backup":"%s"}\n' \
  "$((10#$SSH_PORT))" "$BACKUP_DIR"
