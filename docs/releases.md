# Releases

## Prepare a candidate

Add `.changeset/*.md` for user-visible changes. The version workflow runs
`npm run version:packages` to consume changesets, update the package lock/changelog,
and synchronize the packaged skill version. By default it regenerates the docs,
validates build, lint, typecheck, tests and docs checks, then uploads a reviewable
`version.patch` artifact. Apply that
patch on a fresh branch at the run's revision and open the version PR yourself;
alternatively run `npm run version:packages` locally and create the PR. Read the
resulting CLI package version and changelog to select the matching release tag.

The optional `create_pr=true` input uses Changesets to create the version PR after
the same validation. This needs GitHub Actions' permission to create pull requests.
At audit time, enabling it returned HTTP409: the organization disallows Actions
from creating or approving PRs. An organization owner must permit it before the
repository can enable that setting, or maintainers must configure an appropriately
scoped GitHub App token. The default patch path works without changing that policy.

Run `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`, and
`BLOXWAP_SMOKE_BUN=1 npm run test:package`. The package smoke test installs the
packed artifact with lifecycle scripts disabled and exercises npm's global
executable and installed bunx with both Node and Bun. Install CI runs on
macOS/Linux with Node 22.12 and 24.

The Release workflow can also be manually dispatched on a branch to build a
candidate. It validates metadata, tests packed installs, compiles and executes
native Linux/macOS x64/arm64 binaries, and uploads reviewable artifacts. A manual
run **never publishes**, even when `BLOXWAP_PUBLISH=1`. The compiled x64 Linux
binary uses Bun's baseline target; binaries do not load incidental `.env` or
`bunfig.toml` files from the caller's directory.

## Configure publishing

As of 2026-10-16, `@bloxwap/agent-cli` is not publicly available on npm (registry
404), no `BLOXWAP_PUBLISH` variable or `NPM_TOKEN` secret is configured, and the
`npm-release` GitHub environment does not exist. The install and publication
criteria remain pending until an actual public release passes registry smoke.
No version tag, npm publication or GitHub release was created by this audit.

Before enabling publication:

1. Confirm npm write access to the `@bloxwap` scope and the package name. Configure
   a granular npm token as the `NPM_TOKEN` secret in the `npm-release` environment
   for the initial publication, or configure an authorized npm trusted publisher.
   A local `npm whoami` does not verify OIDC trusted-publisher permissions.
2. Create the `npm-release` GitHub environment and apply the desired tag/reviewer
   restrictions before setting the repository variable `BLOXWAP_PUBLISH=1`.
3. Prefer npm trusted publishing after the package exists. Bind it to organization
   `bloxwap`, repository `agent-cli`, workflow **`release.yml`**, and environment
   **`npm-release`**, with direct `npm publish` allowed. Node 24 includes a supported
   npm CLI (trusted publishing requires npm 11.5.1+ and Node 22.14+). Do not leave a
   token configured after migrating fully to OIDC. New trusted publisher bindings
   must complete their first successful publish within npm's activation window.

See the current [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/)
for scope ownership, activation and authentication details. The package's
repository metadata identifies the public GitHub source required for provenance.

## Publish a reviewed version

Merge the version PR and all required fixes to `main`, ensure CI is green, then
check the exact version and revision before pushing a tag:

```sh
git switch main
git pull --ff-only
node -p 'JSON.parse(require("node:fs").readFileSync("packages/agent-cli/package.json", "utf8")).version'
# Substitute that version below only after reviewing the candidate artifacts.
git tag -a vVERSION -m 'Release vVERSION'
git push origin vVERSION
```

A matching stable `vVERSION` tag must point to a commit on `origin/main`, have a
matching packaged skill and changelog, and contain no unconsumed changesets.
The workflow rejects mismatched, prerelease or unreviewed branch tags. A tag with
publishing disabled still builds candidate artifacts; enabling the gate later
requires rerunning the existing tag's workflow, not moving the tag.

After all four native candidates succeed, the gated publish job downloads the
exact tested tarball, computes `SHA256SUMS`, publishes it with `--provenance`, and
verifies registry integrity plus the provenance attestation. It then tests a
public global npm install and bunx registry execution before creating generated
GitHub release notes and attaching the npm tarball, four binaries, SKILL.md,
CHANGELOG.md, LICENSE and checksums. Downloaded binaries need `chmod +x` before
execution. Verify downloads with `sha256sum -c SHA256SUMS` (Linux) or
`shasum -a 256 -c SHA256SUMS` (macOS).

A published npm version is immutable. If publication succeeds but a later step
fails, inspect the registry and failure before rerunning the job; keep the tag in
place. The publish step accepts an existing version only when its registry hash
matches the tested archive and its provenance is present, then continues the
remaining release steps. Authentication and network errors never count as an
unpublished version. A conflicting existing archive stops the workflow.
