#!/usr/bin/env bash
# Build once in the workflow; test one artifact in four isolated environments.
set -euo pipefail

repo=$PWD
scratch=$(mktemp -d "$RUNNER_TEMP/install-smoke.XXXXXX")
host_dirs=()
pids=()
names=(macos-node22 macos-node24 linux-node22 linux-node24)
cleanup() {
  for pid in ${pids[@]+"${pids[@]}"}; do kill "$pid" 2>/dev/null || true; done
  for dir in ${host_dirs[@]+"${host_dirs[@]}"}; do rm -rf "$dir"; done
  rm -rf "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$scratch/pack"
npm pack --workspace @bloxwap/agent-cli --ignore-scripts --pack-destination "$scratch/pack" >/dev/null
tarballs=("$scratch/pack/"*.tgz)
[ "${#tarballs[@]}" -eq 1 ] && [ -f "${tarballs[0]}" ]
tarball=${tarballs[0]}
bun_dir=$(.github/scripts/fetch-linux-bun.sh x64)
# Initialize Colima before starting parallel containers (avoid concurrent starts).
. .github/scripts/ensure-colima.sh

for name in linux-node22 linux-node24; do
  host_dir=$(.github/scripts/colima-stage.sh)
  host_dirs+=("$host_dir")
  mkdir -p "$host_dir/pack" "$host_dir/bun"
  cp "$bun_dir/bun" "$host_dir/bun/bun"
  chmod +x "$host_dir/bun/bun"
  cp "$tarball" "$host_dir/pack/"
  cp packages/agent-cli/package.json "$host_dir/package.json"
  cp packages/agent-cli/scripts/package-smoke.mjs "$host_dir/package-smoke.mjs"
done

macos_smoke() (
  name=$1
  node_bin=$2
  work="$scratch/$name"
  mkdir -p "$work/tmp" "$work/home" "$work/prefix"
  export PATH="$node_bin:$PATH"
  export HOME="$work/home" TMPDIR="$work/tmp" RUNNER_TEMP="$work/tmp"
  export npm_config_prefix="$work/prefix" npm_config_cache="$work/npm-cache"
  export BUN_INSTALL_CACHE_DIR="$work/bun-cache"
  export BLOXWAP_SMOKE_BUN=1 BLOXWAP_SMOKE_TARBALL="$tarball"
  cd "$repo/packages/agent-cli"
  node --version
  node scripts/package-smoke.mjs
)

linux_smoke() (
  export LINUX_HOST_DIR=$1
  export BLOXWAP_SMOKE_BUN=1
  export BLOXWAP_SMOKE_TARBALL="/work/pack/$(basename "$tarball")"
  # linux-run gives each container its own HOME, npm cache and temp directory;
  # package-smoke also creates a unique global npm prefix beneath that temp dir.
  .github/scripts/linux-run.sh linux/amd64 "$2" \
    sh -c 'node --version && node package-smoke.mjs'
)

macos_smoke macos-node22 "${SMOKE_NODE_22_BIN:?}" > "$scratch/macos-node22.log" 2>&1 &
pids+=("$!")
macos_smoke macos-node24 "${SMOKE_NODE_24_BIN:?}" > "$scratch/macos-node24.log" 2>&1 &
pids+=("$!")
linux_smoke "${host_dirs[0]}" node:22.12.0-bookworm > "$scratch/linux-node22.log" 2>&1 &
pids+=("$!")
linux_smoke "${host_dirs[1]}" node:24-bookworm > "$scratch/linux-node24.log" 2>&1 &
pids+=("$!")

status=0
for index in "${!pids[@]}"; do
  result=0
  wait "${pids[$index]}" || result=$?
  printf '::group::%s (exit %s)\n' "${names[$index]}" "$result"
  cat "$scratch/${names[$index]}.log"
  echo '::endgroup::'
  if [ "$result" -ne 0 ]; then status=1; fi
done
pids=()
exit "$status"
