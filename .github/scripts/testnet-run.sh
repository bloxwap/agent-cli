#!/bin/sh
# Run dedicated testnet QA in a clean Linux container without changing host HOME.
set -eu

script_dir=$(CDPATH='' cd "$(dirname "$0")" && pwd)
workspace=$(git -C "$script_dir/../.." rev-parse --show-toplevel)
artifact_output="$workspace/packages/agent-cli/artifacts"
stage=''

cleanup() {
  original_status=$?
  cleanup_failed=0
  trap - EXIT HUP INT TERM
  set +e
  # Remove previous run evidence even when setup/npm failed before a new report.
  if ! mkdir -p "$artifact_output"; then
    cleanup_failed=1
    echo 'testnet-run.sh: could not prepare artifact output' >&2
  fi
  if ! rm -f "$artifact_output/lifecycle-report.json" \
    "$artifact_output/events.jsonl" "$artifact_output/events-follow.jsonl" \
    "$artifact_output/audit.jsonl" "$artifact_output"/runner*.jsonl; then
    cleanup_failed=1
    echo 'testnet-run.sh: could not purge previous test artifacts' >&2
  fi
  if [ -n "$stage" ]; then
    source_artifacts="$stage/packages/agent-cli/artifacts"
    for artifact in "$source_artifacts/lifecycle-report.json" \
      "$source_artifacts/events.jsonl" "$source_artifacts/events-follow.jsonl" \
      "$source_artifacts/audit.jsonl" "$source_artifacts"/runner*.jsonl; do
      if [ -f "$artifact" ] && [ ! -L "$artifact" ]; then
        if ! cp "$artifact" "$artifact_output/"; then
          cleanup_failed=1
          echo 'testnet-run.sh: could not copy a test artifact' >&2
        fi
      fi
    done
    if ! rm -rf "$stage"; then
      cleanup_failed=1
      echo 'testnet-run.sh: could not remove test staging' >&2
    fi
  fi
  if [ "$original_status" -eq 0 ] && [ ! -f "$artifact_output/lifecycle-report.json" ]; then
    cleanup_failed=1
    echo 'testnet-run.sh: successful test run produced no report artifact' >&2
  fi
  if [ "$original_status" -eq 0 ] && [ "$cleanup_failed" -ne 0 ]; then
    original_status=1
  fi
  exit "$original_status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

stage=$(sh "$script_dir/colima-stage.sh")
# shellcheck disable=SC1091
. "$script_dir/ensure-colima.sh"

git -C "$workspace" archive --format=tar HEAD > "$stage/source.tar"
tar -xf "$stage/source.tar" -C "$stage"
rm "$stage/source.tar"

# Secret values stay out of argv/env files. Docker copies only these named
# variables into its fresh environment; the image keeps its own default HOME.
docker run --rm --init --platform linux/arm64 \
  -e CI=true \
  -e GITHUB_SHA -e GITHUB_RUN_ID \
  -e BLOXWAP_E2E -e BLOXWAP_TEST_ACCOUNT_ONLY \
  -e BLOXWAP_TEST_MASTER_KEY -e BLOXWAP_PRIVY_APP_ID -e BLOXWAP_PRIVY_APP_SECRET \
  -v "$stage:/work" -w /work node:24-bookworm \
  sh -eu -c '
npm ci
npm run build
npm run test:e2e
'
