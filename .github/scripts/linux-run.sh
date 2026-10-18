#!/bin/sh
# Run a command in a Linux container via Colima.
# Usage: linux-run.sh <platform> <image> <command> [args...]
# Mounts the repo read-only at /workspace and $RUNNER_TEMP at /runner-temp.
# Optional: BUN_LINUX_DIR (host dir containing bun), LINUX_WORKDIR (default /workspace).
set -eu

usage() {
  echo "usage: linux-run.sh <platform> <image> <command> [args...]" >&2
  exit 2
}

[ "$#" -ge 3 ] || usage

platform=$1
image=$2
shift 2

if [ -z "${RUNNER_TEMP:-}" ]; then
  echo "linux-run.sh: RUNNER_TEMP must be set" >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$script_dir/ensure-colima.sh"

workdir=${LINUX_WORKDIR:-/workspace}
mkdir -p "$RUNNER_TEMP/linux-tmp" "$RUNNER_TEMP/linux-home"

envfile="$RUNNER_TEMP/linux-run.env"
: > "$envfile"
[ -n "${BLOXWAP_SMOKE_BUN:-}" ] && printf 'BLOXWAP_SMOKE_BUN=%s\n' "$BLOXWAP_SMOKE_BUN" >> "$envfile"
[ -n "${BLOXWAP_SMOKE_TARBALL:-}" ] && printf 'BLOXWAP_SMOKE_TARBALL=%s\n' "$BLOXWAP_SMOKE_TARBALL" >> "$envfile"
[ -n "${BLOXWAP_SMOKE_REGISTRY:-}" ] && printf 'BLOXWAP_SMOKE_REGISTRY=%s\n' "$BLOXWAP_SMOKE_REGISTRY" >> "$envfile"

if [ -n "${BUN_LINUX_DIR:-}" ]; then
  exec docker run --rm \
    --platform "$platform" \
    --env-file "$envfile" \
    -e TMPDIR=/runner-temp/linux-tmp \
    -e HOME=/runner-temp/linux-home \
    -e RUNNER_TEMP=/runner-temp \
    -e npm_config_cache=/runner-temp/linux-tmp/npm-cache \
    -e npm_config_update_notifier=false \
    -e PATH=/opt/bun:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    -v "$PWD:/workspace:ro" \
    -v "$RUNNER_TEMP:/runner-temp" \
    -v "$BUN_LINUX_DIR:/opt/bun:ro" \
    -w "$workdir" \
    "$image" \
    "$@"
fi

exec docker run --rm \
  --platform "$platform" \
  --env-file "$envfile" \
  -e TMPDIR=/runner-temp/linux-tmp \
  -e HOME=/runner-temp/linux-home \
  -e RUNNER_TEMP=/runner-temp \
  -e npm_config_cache=/runner-temp/linux-tmp/npm-cache \
  -e npm_config_update_notifier=false \
  -v "$PWD:/workspace:ro" \
  -v "$RUNNER_TEMP:/runner-temp" \
  -w "$workdir" \
  "$image" \
  "$@"
