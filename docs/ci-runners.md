# CI runners

Every GitHub Actions job in this repository runs on the self-hosted Apple
silicon Mac mini fleet. Jobs select that fleet with:

```yaml
runs-on: [self-hosted, macOS, ARM64]
```

The labels are case-sensitive. Register each runner with exactly `self-hosted`,
`macOS`, and `ARM64`. Do not use GitHub-hosted `ubuntu-*` or `macos-*` images.

Jobs may stay queued when the fleet is busy. That is expected: the Mac minis are
the only runners.

## Required software

Install these on the runner account. Workflows never use `sudo` or `apt`.

| Tool | Why |
| --- | --- |
| macOS on Apple silicon | Native `darwin-arm64` builds and tests |
| Rosetta 2 | `darwin-x64` binary smokes (`arch -x86_64`) and optional `linux/amd64` containers |
| GitHub Actions runner | Must stay logged in as a user that can run Colima and Docker without privilege escalation |
| Xcode Command Line Tools | `git`, `clang`, `tar`, `unzip`, `curl` |
| Colima + Docker CLI | Linux containers for binary and install smokes |
| Node.js 24 | Workflows also pin Node with `actions/setup-node` |
| Bun 1.3.10 | Native compiles and package smokes; workflows also pin Bun with `oven-sh/setup-bun` |

One-time Colima VM (persistent; later jobs run `colima status || colima start`):

```sh
colima start --vm-type vz --vz-rosetta --cpu 4 --memory 8 --disk 100
```

`--vz-rosetta` is required for `linux/amd64` containers. `linux/arm64` runs
natively on the VM. Confirm `docker info` works without `sudo` after Colima is
up. If the default Docker context is not Colima, workflows export
`DOCKER_HOST=unix://$HOME/.colima/default/docker.sock`.

Install Rosetta 2 once on the machine (this is the only privileged step, and it
is not part of CI):

```sh
softwareupdate --install-rosetta --agree-to-license
```

## Container images

Jobs pull these images on demand. Pre-pull them to avoid Docker Hub rate limits:

```sh
docker pull --platform linux/amd64 debian:bookworm-slim
docker pull --platform linux/arm64 debian:bookworm-slim
docker pull --platform linux/amd64 node:22.12.0-bookworm
docker pull --platform linux/amd64 node:24-bookworm
```

`debian:bookworm-slim` runs the compiled Linux CLI (glibc). The Node bookworm
images run the Linux install smoke for Node 22.12 and 24.

## Playwright

Docs CI installs Chromium with `npx playwright install chromium`. Do **not**
pass `--with-deps`: that path tries to install apt packages. Keep a current
Playwright Chromium build in the runner user cache, or let the workflow download
it.

## Temporary files

Scratch space is `$RUNNER_TEMP` (GitHub Actions empties it at the start and end
of each job). Package smokes, Linux container homedirs, and Bun downloads go
there. The testnet job also sets `HOME=$RUNNER_TEMP/e2e-home` so a persistent
Mac mini cannot reuse `~/.bloxwap` state.

## Network

The runner needs outbound access to:

- GitHub (git, Actions APIs, artifact upload, Pages, Bun releases)
- npm (`registry.npmjs.org`)
- Docker Hub (or a mirror of the images above)
- Playwright CDN
- Hyperliquid testnet and Privy, for the dedicated testnet workflow

## How jobs use the Mac mini

- **CI / version / docs deploy / npm publish** run natively on darwin-arm64.
- **Release** cross-compiles `linux-x64`, `linux-arm64`, `darwin-x64`, and
  `darwin-arm64` with Bun on the Mac. Linux binaries are smoke-tested in
  `linux/amd64` and `linux/arm64` containers. The `darwin-x64` binary is
  smoke-tested under Rosetta.
- **Install smoke** still covers macOS and Linux × Node 22.12 and 24. Linux
  cases pack on the Mac, then install inside a `linux/amd64` Node container.
- **Docs smoke** uses Playwright Chromium already installed for macOS.

CI helper scripts live in `.github/scripts/` and are POSIX `/bin/sh` (BSD
userland). They must stay free of GNU-only flags, `apt`, and `sudo`.
