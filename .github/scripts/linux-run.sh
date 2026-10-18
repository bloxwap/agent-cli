#!/bin/sh
# Run a command in a Linux container via Colima.
# Usage: linux-run.sh <platform> <image> <command> [args...]
# Mounts LINUX_HOST_DIR (must live under $HOME so Colima virtiofs can see it) at /work.
set -eu

usage() {
  echo "usage: linux-run.sh <platform> <image> <command> [args...]" >&2
  exit 2
}

[ "$#" -ge 3 ] || usage

platform=$1
image=$2
shift 2

if [ -z "${LINUX_HOST_DIR:-}" ]; then
  echo "linux-run.sh: LINUX_HOST_DIR must be a Colima-visible host directory" >&2
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# shellcheck disable=SC1091
. "$script_dir/ensure-colima.sh"

mkdir -p "$LINUX_HOST_DIR/tmp" "$LINUX_HOST_DIR/home"

envfile="$LINUX_HOST_DIR/linux-run.env"
: > "$envfile"
[ -n "${BLOXWAP_SMOKE_BUN:-}" ] && printf 'BLOXWAP_SMOKE_BUN=%s\n' "$BLOXWAP_SMOKE_BUN" >> "$envfile"
[ -n "${BLOXWAP_SMOKE_TARBALL:-}" ] && printf 'BLOXWAP_SMOKE_TARBALL=%s\n' "$BLOXWAP_SMOKE_TARBALL" >> "$envfile"
[ -n "${BLOXWAP_SMOKE_REGISTRY:-}" ] && printf 'BLOXWAP_SMOKE_REGISTRY=%s\n' "$BLOXWAP_SMOKE_REGISTRY" >> "$envfile"

path=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
if [ -x "$LINUX_HOST_DIR/bun/bun" ]; then
  path="/work/bun:$path"
fi

exec docker run --rm \
  --platform "$platform" \
  --env-file "$envfile" \
  -e TMPDIR=/work/tmp \
  -e HOME=/work/home \
  -e RUNNER_TEMP=/work/tmp \
  -e npm_config_cache=/work/tmp/npm-cache \
  -e npm_config_update_notifier=false \
  -e PATH="$path" \
  -v "$LINUX_HOST_DIR:/work" \
  -w /work \
  "$image" \
  "$@"
