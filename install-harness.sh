#!/usr/bin/env sh
set -eu
target=""; force=0
while [ "$#" -gt 0 ]; do case "$1" in --target) target=$2; shift 2;; --force) force=1; shift;; *) echo "Usage: sh install-harness.sh --target <directory> [--force]"; exit 2;; esac; done
[ -n "$target" ] || { echo "Missing --target"; exit 2; }
source=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$target"
existing=""; for item in .claude CLAUDE.md distribution; do [ ! -e "$target/$item" ] || existing="$existing $item"; done
[ -z "$existing" ] || [ "$force" -eq 1 ] || { echo "Existing harness files:$existing. Use --force to replace."; exit 1; }
if [ -n "$existing" ]; then backup="$target/.harness-backup-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$backup"; for item in $existing; do cp -R "$target/$item" "$backup/$item"; rm -rf "$target/$item"; done; fi
cp -R "$source/.claude" "$target/.claude"; cp "$source/CLAUDE.md" "$target/CLAUDE.md"; cp -R "$source/distribution" "$target/distribution"; mkdir -p "$target/_workspace"
echo "Standard Q&A harness installed: $target"
