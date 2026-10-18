#!/bin/sh
# Start Colima when needed and point Docker at its socket. No sudo, no apt.
set -eu

if ! command -v colima >/dev/null 2>&1; then
  echo "ensure-colima.sh: colima is required on this runner" >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "ensure-colima.sh: docker CLI is required on this runner" >&2
  exit 1
fi

colima status || colima start

if ! docker info >/dev/null 2>&1; then
  sock="${HOME}/.colima/default/docker.sock"
  if [ -S "$sock" ]; then
    DOCKER_HOST="unix://$sock"
    export DOCKER_HOST
    if [ -n "${GITHUB_ENV:-}" ]; then
      echo "DOCKER_HOST=$DOCKER_HOST" >> "$GITHUB_ENV"
    fi
  fi
fi

docker info >/dev/null
