#!/bin/sh
# Print a Colima-visible scratch directory under $HOME.
# Colima's default virtiofs mount is the runner user home, not /opt/github-runners.
set -eu

if [ -z "${HOME:-}" ]; then
  echo "colima-stage.sh: HOME must be set" >&2
  exit 1
fi

id="${GITHUB_RUN_ID:-local}-${GITHUB_JOB:-job}-$$"
dir="$HOME/.bloxwap-ci/$id"
mkdir -p "$dir"
printf '%s\n' "$dir"
