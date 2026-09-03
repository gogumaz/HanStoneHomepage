#!/usr/bin/env bash

# Read-only readiness audit for the uzdream.com Ubuntu host.
# This script never installs packages, changes configuration, or starts services.

set -uo pipefail

MODE="full"
DOMAIN="uzdream.com"
EXPECTED_IP=""
API_BASE_URL=""
SSH_PORT="22"
ALLOW_UBUNTU_20_TEST=false

PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0

usage() {
  cat <<'EOF'
Usage:
  ./deploy/check-host-readiness.sh [options]

Options:
  --mode base|static|full   base: OS/resources, static: +Nginx/HTTPS,
                            full: +Docker/API (default: full)
  --domain DOMAIN          Public website domain (default: uzdream.com)
  --expected-ip IP         Expected public IPv4 address for DNS comparison
  --api-base-url URL       API base URL (default: https://DOMAIN)
  --ssh-port PORT          SSH port expected in UFW (default: 22)
  --allow-ubuntu-20-test   Allow Ubuntu 20.04 only for static testing; requires
                           Ubuntu Pro esm-infra and esm-apps to be enabled
  -h, --help               Show this help

Examples:
  ./deploy/check-host-readiness.sh --mode base --expected-ip 203.0.113.10
  ./deploy/check-host-readiness.sh --mode static --expected-ip 203.0.113.10
  ./deploy/check-host-readiness.sh --mode full --expected-ip 203.0.113.10

The script is read-only. Redirect its output to save a report:
  ./deploy/check-host-readiness.sh --mode full | tee host-readiness.txt
EOF
}

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '[PASS] %s\n' "$1"
}

warn() {
  WARN_COUNT=$((WARN_COUNT + 1))
  printf '[WARN] %s\n' "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '[FAIL] %s\n' "$1"
}

require_value() {
  local option="$1"
  local value="${2:-}"
  if [[ -z "$value" ]]; then
    printf 'Missing value for %s\n' "$option" >&2
    usage >&2
    exit 2
  fi
}

while (($# > 0)); do
  case "$1" in
    --mode)
      require_value "$1" "${2:-}"
      MODE="$2"
      shift 2
      ;;
    --domain)
      require_value "$1" "${2:-}"
      DOMAIN="$2"
      shift 2
      ;;
    --expected-ip)
      require_value "$1" "${2:-}"
      EXPECTED_IP="$2"
      shift 2
      ;;
    --api-base-url)
      require_value "$1" "${2:-}"
      API_BASE_URL="$2"
      shift 2
      ;;
    --ssh-port)
      require_value "$1" "${2:-}"
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
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$MODE" in
  base|static|full) ;;
  *)
    printf 'Invalid --mode: %s (expected base, static, or full)\n' "$MODE" >&2
    exit 2
    ;;
esac

if [[ ! "$SSH_PORT" =~ ^[0-9]+$ ]] || ((SSH_PORT < 1 || SSH_PORT > 65535)); then
  printf 'Invalid --ssh-port: %s\n' "$SSH_PORT" >&2
  exit 2
fi

if [[ -z "$API_BASE_URL" ]]; then
  API_BASE_URL="https://${DOMAIN}"
fi
API_BASE_URL="${API_BASE_URL%/}"

printf 'HanStone host readiness audit\n'
printf 'Mode: %s | Domain: %s | Expected IP: %s\n' \
  "$MODE" "$DOMAIN" "${EXPECTED_IP:-not supplied}"
printf '%s\n' '------------------------------------------------------------'

if [[ "$(uname -s 2>/dev/null || true)" == "Linux" ]]; then
  pass 'Linux host detected'
else
  fail 'This audit must run on the Ubuntu server, not on the Windows PC'
fi

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:26.04|ubuntu:24.04|ubuntu:22.04)
      pass "Supported Ubuntu LTS detected (${VERSION_ID})"
      ;;
    ubuntu:20.04)
      if [[ "$ALLOW_UBUNTU_20_TEST" != true ]]; then
        fail 'Ubuntu 20.04 requires --allow-ubuntu-20-test and Ubuntu Pro ESM'
      elif [[ "$MODE" == "full" ]]; then
        fail 'Ubuntu 20.04 exception is limited to base/static testing; full service is not allowed'
      else
        warn 'Ubuntu 20.04 static-test exception selected; do not use this host for API or production data'
        if ! command -v pro >/dev/null 2>&1; then
          fail 'Ubuntu Pro client is missing; attach Ubuntu Pro before public testing'
        else
          PRO_STATUS="$(LC_ALL=C pro status 2>/dev/null || true)"
          for esm_service in esm-infra esm-apps; do
            if awk -v service="$esm_service" '
              $1 == service {
                for (i = 2; i <= NF; i += 1) {
                  if ($i == "enabled") found = 1
                }
              }
              END { exit(found ? 0 : 1) }
            ' <<<"$PRO_STATUS"; then
              pass "Ubuntu Pro ${esm_service} is enabled"
            else
              fail "Ubuntu Pro ${esm_service} is not enabled"
            fi
          done
        fi
      fi
      ;;
    ubuntu:*)
      warn "Ubuntu ${VERSION_ID:-unknown} was not part of the validated deployment baseline"
      ;;
    *)
      fail "Expected Ubuntu, found ${ID:-unknown} ${VERSION_ID:-unknown}"
      ;;
  esac
else
  fail '/etc/os-release is unavailable'
fi

ARCH="$(uname -m 2>/dev/null || true)"
case "$ARCH" in
  x86_64|aarch64|arm64)
    pass "Supported 64-bit architecture detected (${ARCH})"
    ;;
  *)
    fail "Unsupported or unknown architecture (${ARCH:-unknown})"
    ;;
esac

MEM_KB="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || true)"
if [[ "$MEM_KB" =~ ^[0-9]+$ ]]; then
  MEM_MIB=$((MEM_KB / 1024))
  if [[ "$MODE" == "static" ]]; then
    if ((MEM_MIB >= 450)); then
      pass "Memory ${MEM_MIB} MiB is sufficient for the static-only profile"
    else
      fail "Memory ${MEM_MIB} MiB is below the static-only minimum"
    fi
  elif ((MEM_MIB >= 3800)); then
    pass "Memory ${MEM_MIB} MiB meets the recommended full-service baseline"
  elif ((MEM_MIB >= 1900)); then
    warn "Memory ${MEM_MIB} MiB meets the minimum but 4 GiB is recommended"
  else
    fail "Memory ${MEM_MIB} MiB is below the 2 GiB full-service minimum"
  fi
else
  fail 'Unable to read total memory'
fi

FREE_KB="$(df -Pk / 2>/dev/null | awk 'NR == 2 {print $4}' || true)"
if [[ "$FREE_KB" =~ ^[0-9]+$ ]]; then
  FREE_GIB=$((FREE_KB / 1024 / 1024))
  if ((FREE_GIB >= 8)); then
    pass "Root filesystem has ${FREE_GIB} GiB free"
  else
    fail "Root filesystem has only ${FREE_GIB} GiB free; keep at least 8 GiB available"
  fi
else
  fail 'Unable to read root filesystem free space'
fi

SWAP_KB="$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo 2>/dev/null || true)"
if [[ "$SWAP_KB" =~ ^[0-9]+$ ]] && ((SWAP_KB >= 1048576)); then
  pass "Swap is configured ($((SWAP_KB / 1024)) MiB)"
else
  warn 'At least 1 GiB swap is recommended for this small host'
fi

for command_name in awk curl df getent python3 ss; do
  if command -v "$command_name" >/dev/null 2>&1; then
    pass "Required command is available (${command_name})"
  else
    fail "Required command is missing (${command_name})"
  fi
done

DNS_IPS="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | paste -sd, - || true)"
if [[ -n "$DNS_IPS" ]]; then
  pass "DNS resolves ${DOMAIN} to ${DNS_IPS}"
  if [[ -n "$EXPECTED_IP" ]]; then
    if tr ',' '\n' <<<"$DNS_IPS" | grep -Fxq "$EXPECTED_IP"; then
      pass "DNS includes the expected server IP (${EXPECTED_IP})"
    else
      fail "DNS does not include the expected server IP (${EXPECTED_IP})"
    fi
  else
    warn 'No --expected-ip was supplied; DNS-to-server matching was not verified'
  fi
else
  fail "DNS did not return an IPv4 address for ${DOMAIN}"
fi

UFW_STATUS=""
if command -v ufw >/dev/null 2>&1; then
  UFW_STATUS="$(ufw status 2>/dev/null || sudo -n ufw status 2>/dev/null || true)"
  if grep -Fq 'Status: active' <<<"$UFW_STATUS"; then
    pass 'UFW is active'
    if grep -Eq "(^|[[:space:]])(${SSH_PORT}/tcp|${SSH_PORT}|OpenSSH)([[:space:]]|$)" <<<"$UFW_STATUS"; then
      pass "UFW allows the configured SSH port (${SSH_PORT})"
    else
      warn "Unable to confirm an allow rule for SSH port ${SSH_PORT}"
    fi
    if grep -Eq '(80/tcp|Nginx Full|Nginx HTTP)' <<<"$UFW_STATUS"; then
      pass 'UFW allows HTTP traffic'
    else
      warn 'Unable to confirm an HTTP allow rule'
    fi
    if grep -Eq '(443/tcp|Nginx Full|Nginx HTTPS)' <<<"$UFW_STATUS"; then
      pass 'UFW allows HTTPS traffic'
    else
      warn 'Unable to confirm an HTTPS allow rule'
    fi
  elif [[ -n "$UFW_STATUS" ]]; then
    fail 'UFW is installed but inactive'
  else
    warn 'UFW status requires sudo; rerun with an account allowed to inspect it'
  fi
else
  warn 'UFW is not installed'
fi

if [[ "$MODE" == "static" || "$MODE" == "full" ]]; then
  if command -v nginx >/dev/null 2>&1; then
    pass 'Nginx is installed'
    if systemctl is-active --quiet nginx 2>/dev/null; then
      pass 'Nginx service is active'
    else
      fail 'Nginx service is not active'
    fi
    if nginx -t >/dev/null 2>&1 || sudo -n nginx -t >/dev/null 2>&1; then
      pass 'Nginx configuration test passed'
    else
      fail 'Nginx configuration test failed or requires sudo access'
    fi
  else
    fail 'Nginx is not installed'
  fi

  LISTENERS="$(ss -ltnH 2>/dev/null | awk '{print $4}' || true)"
  if grep -Eq '(^|:)80$' <<<"$LISTENERS"; then
    pass 'HTTP port 80 is listening'
  else
    fail 'HTTP port 80 is not listening'
  fi
  if grep -Eq '(^|:)443$' <<<"$LISTENERS"; then
    pass 'HTTPS port 443 is listening'
  else
    fail 'HTTPS port 443 is not listening'
  fi

  HTTP_CODE="$(curl -sS -o /dev/null --connect-timeout 5 --max-time 15 -w '%{http_code}' "https://${DOMAIN}" 2>/dev/null || true)"
  if [[ "$HTTP_CODE" =~ ^[23][0-9][0-9]$ ]]; then
    pass "HTTPS website responded with HTTP ${HTTP_CODE}"
  else
    fail "HTTPS website check failed (HTTP ${HTTP_CODE:-unavailable})"
  fi
fi

if [[ "$MODE" == "full" ]]; then
  DOCKER_PREFIX=()
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    DOCKER_PREFIX=(docker)
    pass 'Docker Engine is reachable by the current user'
  elif command -v docker >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
    DOCKER_PREFIX=(sudo -n docker)
    pass 'Docker Engine is reachable through non-interactive sudo'
  else
    fail 'Docker Engine is missing, inactive, or not accessible'
  fi

  if ((${#DOCKER_PREFIX[@]} > 0)); then
    if "${DOCKER_PREFIX[@]}" compose version >/dev/null 2>&1; then
      pass 'Docker Compose v2 is available'
    else
      fail 'Docker Compose v2 is unavailable'
    fi
  fi

  if [[ -f /opt/hanstone/deploy/compose.production.yaml ]]; then
    pass 'Production Compose file exists'
  else
    fail '/opt/hanstone/deploy/compose.production.yaml is missing'
  fi

  if [[ -f /etc/hanstone/production.env ]]; then
    ENV_MODE="$(stat -c '%a' /etc/hanstone/production.env 2>/dev/null || true)"
    ENV_OWNER="$(stat -c '%U' /etc/hanstone/production.env 2>/dev/null || true)"
    if [[ "$ENV_MODE" == "600" && "$ENV_OWNER" == "root" ]]; then
      pass 'Production environment file is owned by root with mode 600'
    else
      fail "Production environment file permissions must be root:root 600 (found ${ENV_OWNER:-unknown}:${ENV_MODE:-unknown})"
    fi
  else
    fail '/etc/hanstone/production.env is missing'
  fi

  LISTENERS="$(ss -ltnH 2>/dev/null | awk '{print $4}' || true)"
  if grep -Eq '(^|\[::ffff:)127\.0\.0\.1:3000$' <<<"$LISTENERS"; then
    pass 'API port 3000 is bound to loopback only'
  elif grep -Eq '(^|:)3000$' <<<"$LISTENERS"; then
    fail 'API port 3000 is publicly bound; use 127.0.0.1:3000 only'
  else
    fail 'API port 3000 is not listening'
  fi

  for endpoint in live ready; do
    if curl -fsS --connect-timeout 5 --max-time 15 \
      "${API_BASE_URL}/api/v1/health/${endpoint}" >/dev/null 2>&1; then
      pass "Public API health/${endpoint} check passed"
    else
      fail "Public API health/${endpoint} check failed"
    fi
  done
fi

printf '%s\n' '------------------------------------------------------------'
printf 'Summary: PASS=%d WARN=%d FAIL=%d\n' "$PASS_COUNT" "$WARN_COUNT" "$FAIL_COUNT"

if ((FAIL_COUNT > 0)); then
  printf 'Result: NOT READY — resolve every FAIL before deployment.\n'
  exit 1
fi

printf 'Result: READY — review WARN items before deployment.\n'
