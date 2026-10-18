#!/bin/sh
# Download a Linux Bun binary into $RUNNER_TEMP and print its directory.
# Usage: fetch-linux-bun.sh <x64|aarch64>
set -eu

arch=${1:-}
version=${BUN_VERSION:-1.3.10}

case "$arch" in
  x64 | amd64 | x86_64) asset=bun-linux-x64 ;;
  aarch64 | arm64) asset=bun-linux-aarch64 ;;
  *)
    echo "usage: fetch-linux-bun.sh <x64|aarch64>" >&2
    exit 2
    ;;
esac

if [ -z "${RUNNER_TEMP:-}" ]; then
  echo "fetch-linux-bun.sh: RUNNER_TEMP must be set" >&2
  exit 1
fi

dest="$RUNNER_TEMP/$asset"
mkdir -p "$dest"

if [ ! -x "$dest/bun" ]; then
  zip="$RUNNER_TEMP/$asset.zip"
  curl -fsSL -o "$zip" \
    "https://github.com/oven-sh/bun/releases/download/bun-v${version}/${asset}.zip"
  extract="$RUNNER_TEMP/extract-$asset"
  mkdir -p "$extract"
  unzip -o "$zip" -d "$extract" >/dev/null
  if [ -f "$extract/$asset/bun" ]; then
    mv "$extract/$asset/bun" "$dest/bun"
  elif [ -f "$extract/bun" ]; then
    mv "$extract/bun" "$dest/bun"
  else
    echo "fetch-linux-bun.sh: bun executable not found in $asset.zip" >&2
    exit 1
  fi
  chmod +x "$dest/bun"
fi

printf '%s\n' "$dest"
