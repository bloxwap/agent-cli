# agent-cli docs: OG-only font candidate refresh (hig#115)

This isolated refresh adopts HIG `0.1.0-candidate.shae3390bbd` from
[`e3390bbd`](https://github.com/bloxwap/hig/tree/e3390bbd0ac12b9d4b371175bd250d01ea866abe).
The [candidate release report](candidate-report.json) records a clean source snapshot and no publication.

The OG renderer now reads the approved Bold and Black TTFs with
`@bloxwap/hig-og-fonts/node` `readOgFont()`. It keeps the `Bloxwap Sans` name, normal style,
weights 700/900, and the exact prior bytes/SHA-256 values ([before](before.json), [after](after.json)).

At original consumer baseline `76384c4911c9e69fafd17a55d3d004cf51a26ca0`, all **13 generated OG PNGs were byte-identical** to the pre-refresh production export.
The desktop home/docs and 390 px home captures are also byte-identical, with no page errors or
horizontal overflow ([browser comparison](browser-comparison.json)). Both builds use the same
real deployment base path. The explicit `hig-react/css/base` import preserves the previous
whole-page rules after HIG split them from component CSS.

The vendor set drops from 4,454,889 B to 881,378 B (**−3,573,511B**). The native-fonts archive,
dev dependency and lock entries are removed; no TTF is included in the static export.
`vendor/bloxwap-hig/provenance.json` and the docs guard verify all four archive hashes, installed
candidate versions and the exact selected font faces.

Original refresh validated locally on Node 24.10.0 / npm 11.5.1:

- Fresh lock resolution and `npm ci`, without compatibility flags.
- Root build, lint, typecheck and **103 tests** ([log](root-gates.log)).
- Production default-Turbopack docs build: **13 cards** ([log](after-build.log)).
- Docs provenance/font/type gates ([log](docs-check.log)).
- Existing Chromium docs smoke: **14 checks** against the local production export ([log](docs-smoke.log)).
- Before/after browser captures and all-card byte comparison ([report](report.json)).
- Scoped anti-drift from the same HIG commit: 41 files, 0 exceptions ([log](drift.log)).

The old-lock update attempted to fetch an unpublished transitive candidate. Moving the generated
install/lock aside and resolving the coherent file dependencies from scratch avoided that fetch.
The redundant HIG root file overrides also resolved under `apps/docs` on fresh npm resolution;
they have been removed. The unrelated esbuild/mdast overrides remain.

Package publication and deployment are outside this refresh. Remote CI and the central HIG
adoption linkage are tracked through the draft refresh PR.

## Current main integration — 2026-10-18

Merged `origin/main` at `bb242b8ef95ae238a65b779d427bff3813e6b267` into the original refresh head
`a2798c7fd09c4f4efa95dad138ea889937f349d5` without rewriting history. The only conflict was the progress-log
append; both sections and upstream npm-token publication status are retained. Upstream
Mac runner, Colima install, testnet and generated skill changes remain intact.

The [integration report](main-integration/report.json) records a fresh frozen install,
build/lint/types, **232 CLI tests**, packed-package installation, production docs build/check
(two CSS guard tests), **14 browser smoke checks** and the pinned drift check (41 files,
zero exceptions). Node 24.15.0 / npm 11.5.1 match the workflow Node 24 major. All four
`e3390bbd` archives, the lockfile and selected OG font bytes remain unchanged; no
candidate was regenerated. The current 13-card manifest matches the historical manifest.
The original screenshot-parity claim above applies only to its recorded baseline; current
main browser validation uses the production smoke checks, without a new screenshot-parity claim.

[PR #55](https://github.com/bloxwap/agent-cli/pull/55) records current remote checks and
mergeability. No credentialed testnet run, publication or deployment was performed.
