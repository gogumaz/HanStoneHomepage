#!/usr/bin/env bash
set -euo pipefail

VIDEO_ROOT="${LOCAL_VIDEO_ROOT_HOST:-/var/www/hanstone/media/lessons}"
MAX_BYTES="${LOCAL_VIDEO_MAX_BYTES:-268435456}"
LESSON_ID=""
SOURCE_FILE=""
APPLY=false
CONFIRM=""

usage() {
  cat <<'USAGE'
Usage:
  sudo ./deploy/install-local-video.sh --lesson-id PRE-01 --source /tmp/PRE-01.mp4
  sudo ./deploy/install-local-video.sh --lesson-id PRE-01 --source /tmp/PRE-01.mp4 \
    --apply --confirm INSTALL_LOCAL_LESSON_VIDEO

The first command performs validation only. The apply command atomically installs
the MP4 as <LOCAL_VIDEO_ROOT_HOST>/<LESSON_ID>.mp4.
USAGE
}

while (($#)); do
  case "$1" in
    --lesson-id) LESSON_ID="${2:-}"; shift 2 ;;
    --source) SOURCE_FILE="${2:-}"; shift 2 ;;
    --apply) APPLY=true; shift ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$LESSON_ID" =~ ^[A-Z0-9][A-Z0-9-]{2,39}$ ]] || {
  printf 'LESSON_ID_INVALID\n' >&2
  exit 2
}
[[ -n "$SOURCE_FILE" && -f "$SOURCE_FILE" && ! -L "$SOURCE_FILE" ]] || {
  printf 'SOURCE_MP4_NOT_REGULAR_FILE\n' >&2
  exit 2
}
[[ "$MAX_BYTES" =~ ^[0-9]+$ ]] && ((MAX_BYTES > 0 && MAX_BYTES <= 1073741824)) || {
  printf 'LOCAL_VIDEO_MAX_BYTES_INVALID\n' >&2
  exit 2
}

SOURCE_BYTES="$(stat -c '%s' -- "$SOURCE_FILE")"
((SOURCE_BYTES > 0 && SOURCE_BYTES <= MAX_BYTES)) || {
  printf 'SOURCE_MP4_SIZE_INVALID bytes=%s maxBytes=%s\n' "$SOURCE_BYTES" "$MAX_BYTES" >&2
  exit 2
}
dd if="$SOURCE_FILE" bs=1 count=64 status=none | LC_ALL=C grep -aq 'ftyp' || {
  printf 'SOURCE_MP4_FTYP_NOT_FOUND\n' >&2
  exit 2
}

TARGET_FILE="${VIDEO_ROOT}/${LESSON_ID}.mp4"
printf 'lessonId=%s\nsourceBytes=%s\ntarget=%s\nvalidation=pass\n' "$LESSON_ID" "$SOURCE_BYTES" "$TARGET_FILE"

if [[ "$APPLY" != true ]]; then
  printf 'mode=dry-run\n'
  exit 0
fi
[[ "$CONFIRM" == "INSTALL_LOCAL_LESSON_VIDEO" ]] || {
  printf 'CONFIRMATION_REQUIRED\n' >&2
  exit 2
}
[[ "$(id -u)" -eq 0 ]] || {
  printf 'ROOT_REQUIRED\n' >&2
  exit 2
}

install -d -o root -g root -m 0755 -- "$VIDEO_ROOT"
TEMP_FILE="$(mktemp "${VIDEO_ROOT}/.${LESSON_ID}.mp4.XXXXXX")"
cleanup() { rm -f -- "$TEMP_FILE"; }
trap cleanup EXIT
install -o root -g root -m 0644 -- "$SOURCE_FILE" "$TEMP_FILE"
mv -f -- "$TEMP_FILE" "$TARGET_FILE"
trap - EXIT
printf 'mode=applied\ninstalled=1\n'
