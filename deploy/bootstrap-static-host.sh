#!/usr/bin/env bash
set -Eeuo pipefail

APPLY=false
CONFIRMATION=""
SSH_PORT=""
ALLOW_UBUNTU_20_TEST=false
HOST_PROFILE="supported-lts"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
BUNDLE_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

usage() {
  cat <<'EOF'
Usage:
  bash deploy/bootstrap-static-host.sh --ssh-port PORT
  sudo bash deploy/bootstrap-static-host.sh --apply --ssh-port PORT --confirm INSTALL_STATIC_HOSTING
  bash deploy/bootstrap-static-host.sh --allow-ubuntu-20-test --ssh-port PORT
  sudo bash deploy/bootstrap-static-host.sh --apply --allow-ubuntu-20-test --ssh-port PORT \
    --confirm INSTALL_STATIC_HOSTING_TEST

The default mode is read-only. Apply mode installs the minimum static-hosting
packages, configures UFW after allowing SSH/HTTP/HTTPS, and installs the Nginx
HTTP bootstrap configuration. It never upgrades Ubuntu or requests a certificate.
Ubuntu 20.04 is accepted only for a static test host when Ubuntu Pro ESM is
already attached and both esm-infra and esm-apps are enabled.
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
      (($# >= 2)) || fail 'STATIC_BOOTSTRAP_ARGUMENTS_INVALID'
      CONFIRMATION="$2"
      shift 2
      ;;
    --ssh-port)
      (($# >= 2)) || fail 'STATIC_BOOTSTRAP_ARGUMENTS_INVALID'
      SSH_PORT="$2"
      shift 2
      ;;
    --allow-ubuntu-20-test)
      ALLOW_UBUNTU_20_TEST=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail 'STATIC_BOOTSTRAP_ARGUMENTS_INVALID'
      ;;
  esac
done

[[ -n "$SSH_PORT" && "$SSH_PORT" =~ ^[0-9]+$ ]] || fail 'STATIC_BOOTSTRAP_SSH_PORT_REQUIRED'
((10#$SSH_PORT >= 1 && 10#$SSH_PORT <= 65535)) || fail 'STATIC_BOOTSTRAP_SSH_PORT_INVALID'
[[ "$(uname -s 2>/dev/null || true)" == "Linux" ]] || fail 'STATIC_BOOTSTRAP_LINUX_REQUIRED'
[[ -r /etc/os-release ]] || fail 'STATIC_BOOTSTRAP_OS_RELEASE_MISSING'

# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || fail 'STATIC_BOOTSTRAP_UBUNTU_REQUIRED'
case "${VERSION_ID:-}" in
  22.04|24.04|26.04) ;;
  20.04)
    [[ "$ALLOW_UBUNTU_20_TEST" == true ]] \
      || fail 'STATIC_BOOTSTRAP_UBUNTU_20_TEST_APPROVAL_REQUIRED'
    HOST_PROFILE="ubuntu20-static-test"
    ;;
  *) fail 'STATIC_BOOTSTRAP_UBUNTU_VERSION_UNSUPPORTED' ;;
esac

esm_service_enabled() {
  local service="$1"
  LC_ALL=C pro status 2>/dev/null | awk -v service="$service" '
    $1 == service {
      for (i = 2; i <= NF; i += 1) {
        if ($i == "enabled") found = 1
      }
    }
    END { exit(found ? 0 : 1) }
  '
}

if [[ "$HOST_PROFILE" == "ubuntu20-static-test" ]]; then
  command -v pro >/dev/null 2>&1 || fail 'STATIC_BOOTSTRAP_UBUNTU_20_ESM_REQUIRED'
  esm_service_enabled esm-infra || fail 'STATIC_BOOTSTRAP_UBUNTU_20_ESM_REQUIRED'
  esm_service_enabled esm-apps || fail 'STATIC_BOOTSTRAP_UBUNTU_20_ESM_REQUIRED'
fi

REQUIRED_SOURCES=(
  "deploy/nginx/conf.d/hanstone-cache-map.conf"
  "deploy/nginx/snippets/hanstone-security-headers.conf"
  "deploy/nginx/snippets/hanstone-api-proxy.conf"
  "deploy/nginx/sites-available/hanstone-bootstrap.conf"
  "deploy/install-hosting-release.py"
  "deploy/verify-hosting-release.py"
)
for name in "${REQUIRED_SOURCES[@]}"; do
  source_path="${BUNDLE_ROOT}/${name}"
  [[ -f "$source_path" && ! -L "$source_path" ]] || fail 'STATIC_BOOTSTRAP_SOURCE_MISSING'
done

if [[ "$APPLY" != true ]]; then
  printf '%s\n' 'Static hosting bootstrap plan (read-only)'
  printf 'Ubuntu: %s\n' "${VERSION_ID}"
  printf 'Host profile: %s\n' "$HOST_PROFILE"
  if [[ "$HOST_PROFILE" == "ubuntu20-static-test" ]]; then
    printf '%s\n' 'WARNING: Ubuntu 20.04 is approved for static testing only; Ubuntu Pro ESM is enabled.'
  fi
  printf 'SSH port to preserve: %s/tcp\n' "$SSH_PORT"
  printf '%s\n' 'Packages: nginx, certbot, python3-certbot-nginx, python3, ufw, ca-certificates, curl'
  printf '%s\n' 'Firewall additions: configured SSH port, 80/tcp, 443/tcp'
  printf '%s\n' 'Nginx phase: HTTP bootstrap only; certificate issuance remains a separate step'
  printf '{"ok":true,"mode":"plan","profile":"%s","changesApplied":false}\n' "$HOST_PROFILE"
  exit 0
fi

if [[ "$HOST_PROFILE" == "ubuntu20-static-test" ]]; then
  [[ "$CONFIRMATION" == 'INSTALL_STATIC_HOSTING_TEST' ]] \
    || fail 'STATIC_BOOTSTRAP_TEST_CONFIRMATION_REQUIRED'
else
  [[ "$CONFIRMATION" == 'INSTALL_STATIC_HOSTING' ]] \
    || fail 'STATIC_BOOTSTRAP_CONFIRMATION_REQUIRED'
fi
((EUID == 0)) || fail 'STATIC_BOOTSTRAP_ROOT_REQUIRED'

if [[ -n "${SSH_CONNECTION:-}" ]]; then
  read -r _ _ _ ACTIVE_SSH_PORT <<<"${SSH_CONNECTION}"
  [[ "$ACTIVE_SSH_PORT" == "$SSH_PORT" ]] || fail 'STATIC_BOOTSTRAP_ACTIVE_SSH_PORT_MISMATCH'
elif command -v ss >/dev/null 2>&1; then
  ss -ltnH | awk '{print $4}' | grep -Eq "(^|:)${SSH_PORT}$" \
    || fail 'STATIC_BOOTSTRAP_SSH_LISTENER_NOT_FOUND'
else
  fail 'STATIC_BOOTSTRAP_SSH_PORT_UNVERIFIED'
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates certbot curl nginx python3 python3-certbot-nginx ufw

safe_directory() {
  local path="$1"
  if [[ -L "$path" ]]; then
    fail 'STATIC_BOOTSTRAP_DIRECTORY_SYMLINK_FORBIDDEN'
  fi
  install -d -m 0755 -- "$path"
}

safe_install_config() {
  local source="$1"
  local destination="$2"
  if [[ -L "$destination" ]]; then
    fail 'STATIC_BOOTSTRAP_CONFIG_SYMLINK_FORBIDDEN'
  fi
  if [[ -e "$destination" ]]; then
    cmp -s -- "$source" "$destination" || fail 'STATIC_BOOTSTRAP_CONFIG_CONFLICT'
    return
  fi
  install -m 0644 -- "$source" "$destination"
}

safe_directory /var/www/hanstone
safe_directory /var/www/hanstone/releases
safe_directory /var/www/hanstone/manifests
safe_directory /var/log/hanstone
safe_directory /etc/nginx/conf.d
safe_directory /etc/nginx/snippets
safe_directory /etc/nginx/sites-available
safe_directory /etc/nginx/sites-enabled

safe_install_config \
  "${BUNDLE_ROOT}/deploy/nginx/conf.d/hanstone-cache-map.conf" \
  /etc/nginx/conf.d/hanstone-cache-map.conf
safe_install_config \
  "${BUNDLE_ROOT}/deploy/nginx/snippets/hanstone-security-headers.conf" \
  /etc/nginx/snippets/hanstone-security-headers.conf
safe_install_config \
  "${BUNDLE_ROOT}/deploy/nginx/snippets/hanstone-api-proxy.conf" \
  /etc/nginx/snippets/hanstone-api-proxy.conf
safe_install_config \
  "${BUNDLE_ROOT}/deploy/nginx/sites-available/hanstone-bootstrap.conf" \
  /etc/nginx/sites-available/hanstone

if [[ -e /etc/nginx/sites-enabled/hanstone || -L /etc/nginx/sites-enabled/hanstone ]]; then
  [[ -L /etc/nginx/sites-enabled/hanstone ]] || fail 'STATIC_BOOTSTRAP_SITE_LINK_CONFLICT'
  [[ "$(readlink /etc/nginx/sites-enabled/hanstone)" == '/etc/nginx/sites-available/hanstone' ]] \
    || fail 'STATIC_BOOTSTRAP_SITE_LINK_CONFLICT'
else
  ln -s /etc/nginx/sites-available/hanstone /etc/nginx/sites-enabled/hanstone
fi

nginx -t
systemctl enable --now nginx
systemctl reload nginx

# Preserve remote access before enabling the host firewall.
ufw allow "${SSH_PORT}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

printf '{"ok":true,"mode":"apply","profile":"%s","ubuntu":"%s","sshPort":%d,"certificateIssued":false}\n' \
  "$HOST_PROFILE" "${VERSION_ID}" "$((10#$SSH_PORT))"
