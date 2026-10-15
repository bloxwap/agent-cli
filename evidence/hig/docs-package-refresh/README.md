# Docs: HIG candidate refresh, no Radix peers, no font bridge, no copied token numbers (bloxwap/hig#58)

Follow-up to [docs-package-migration](../docs-package-migration/README.md) (agent-cli#47). That PR left three
recorded exceptions in the agent-cli row of HIG's `planning/adoption.json`. HIG main has since fixed the cause of each:

| Exception after #47 | HIG fix | This change |
| --- | --- | --- |
| `@radix-ui/react-dropdown-menu` and `react-tooltip` installed only so `@bloxwap/hig-react/recipes` could resolve `./overlay.js` (hig#63) | hig#74: overlay-free `@bloxwap/hig-react/recipes/install-command` entry, caret Radix peers | Import the overlay-free entry; both Radix packages are removed from `apps/docs/package.json` and the lockfile |
| Font-family bridge in `global.css` (`.hig-button`/`.hig-number` mapped to the Next loader variables) (hig#65) | hig#75: `--hig-font-sans`/`--hig-font-mono` resolve `var(--font-bloxwap-*)` first | Bridge deleted; Tailwind's `--font-sans`/`--font-mono` now read the HIG roles |
| 12 radius, motion, type and density numbers copied into `--docs-*` and checked against the JS tokens | hig#75/#81: `--hig-radius-*`, `--hig-motion-*`, `--hig-type-*`, `--hig-density-*` CSS roles | Copies deleted; `global.css` reads the roles; HIG's reduced-motion rule replaces the host one |

Also in this refresh:

- **Fonts (hig#64):** `@bloxwap/hig-tokens` no longer ships TTFs. The social-card renderer reads
  `BloxwapSans-{Bold,Black}.ttf` from `@bloxwap/hig-native-fonts` as a build-time dev dependency, as
  `docs/migration/native.md` in HIG recommends for Satori. `@bloxwap/font` ships WOFF2 only, which Satori cannot read.
  All 13 social cards are byte-identical to main (`cmp` over `out/og/**/*.png`).
- **Callout (hig#69):** MDX `<Callout>` maps `info` to HIG's `note` and `idea` to `tip`, and passes inline-node titles
  through. Before this, non-string titles were replaced with a default. No current page uses a callout.
- **Overrides:** HIG React now depends on exact `@bloxwap/hig-tokens`/`hig-contracts` candidate versions, so the root
  `package.json` adds `overrides` that point them at the vendored tarballs, as `docs/governance/new-repository.md`
  describes.

HIG source: [bloxwap/hig@872906a](https://github.com/bloxwap/hig/tree/872906a9071469af8714b3b6fb5cc7bd64d2d6f3),
`0.1.0-candidate.sha872906a9`, built with `npm ci && npm run generate:fonts && npm run build && npm run
release:dry-run -- --channel candidate` (dry run: `published: false`, no tags, no releases).

## Before / after

Static export with `NEXT_PUBLIC_BASE_PATH=/agent-cli`, measured the same way on both builds. Sizes are emitted file
bytes, not transfer sizes; gzip is the sum of per-file gzip. Raw data: [measurements.json](measurements.json).

| | Before (main 778c8f5, HIG 19c7561) | After (HIG 872906a) |
| --- | ---: | ---: |
| Docs source CSS (`app/global.css`) | 408 lines, 21,885 B | 390 lines, 21,373 B |
| Copied HIG values in `global.css` | 14 `--docs-*` (radius, motion, easing, density, type; 12 checked against JS tokens) | 0 (only `--docs-icon`, a host size) |
| Host font-family bridge rules | 2 (`.hig-button`, `.hig-number`) | 0 |
| Committed font files in `apps/docs` | 0 | 0 |
| Emitted CSS | 150,822 B (24,357 gz) | 153,404 B (24,739 gz) |
| Emitted JS | 1,268,205 B (406,649 gz) | 1,270,472 B (407,458 gz) |
| Emitted fonts | 22 files, 12,965,628 B | same |
| Total static export | 20,552,673 B | 20,557,522 B |
| Docs direct dependencies (runtime) | 21 (13) | 20 (11) |
| Lockfile package entries | 762 | 735 |
| `@radix-ui/*` lockfile entries | 90 | 62 |
| Vendored tarballs | 3 files, 4,448,522 B | 4 files, 4,454,889 B |

- **CSS +2.6 KB (+0.4 KB gzip):** HIG's token sheet now carries the radius, motion, type, density and font roles,
  and the React sheet gained input, callout-severity and range focus rules. The host sheet lost 512 B.
- **JS +2.3 KB (+0.8 KB gzip):** HIG React's newer `Tabs`, `IconButton`, `InstallCommand`, `Alert`/`EmptyState`
  and provider code (localizable built-in strings, hig#62). No Radix code is bundled before or after.
- **Dependencies:** −2 runtime (`@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`), +1 dev
  (`@bloxwap/hig-native-fonts`), −27 lockfile entries. `npm ls` no longer reports invalid HIG peers: the caret ranges
  accept the `@radix-ui/react-dialog`/`react-popover` 1.3.1 that Fumadocs installs.
- **Vendored bytes:** roughly unchanged. The 4.4 MB of TTFs moved from the tokens tarball to the native-fonts tarball.

## Drift

`node <hig@872906a>/scripts/drift.mjs --root . --config hig-drift.json`: before (main) and after both report
`Scoped anti-drift: passed (38 files, 0 dated exceptions)`. CI now checks out the drift script from the same commit
as the tarballs.

## Validation (automated and browser; local macOS arm64, Node 24.10.0)

- `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` (38 files, 71 tests) and `npm run test:package`
  pass.
- `npm run docs:check` passes: content, HIG provenance, `file:` specs and overrides, installed versions, every
  `--hig-*` role `global.css` reads exists in the installed HIG CSS, no copied token numbers or font bridge, Next
  typegen and `tsc`.
- `NEXT_PUBLIC_BASE_PATH=/agent-cli npm run docs:build`: the postbuild checker verified 16 HTML pages, 597 local
  links/assets, 13 social cards and the `/agent-cli` base path.
- `npm run docs:smoke` (Playwright Chromium, against the `/agent-cli` static preview) passes 13/13. Three checks are
  new:
  - HIG controls (`Get started`, the install tab) and the code window render a loaded Bloxwap face through
    `--hig-font-*`, with Sans and Mono distinct. A negative run, with the loader variable removed from the built
    CSS, fails this check.
  - At 390 px with touch, the compact copy buttons keep a 48 × 48 px target.
  - With `prefers-reduced-motion: reduce`, `--hig-motion-duration-fast` resolves to 0 and site transitions are 0 s.

## Visual differences (screenshots/)

1440×900 and 390×844 captures from the smoke run. Search, quickstart, errors table and mobile navigation are
pixel-identical to main (not stored).

- Primary and secondary buttons (`Get started`, `Command reference`, 404 `Open documentation`) are 44 px tall
  instead of 48 px. This is HIG's new web button height (hig#80); compact controls stay 36 px, and 48 px on touch.
  The home page is 4 px shorter on desktop and 8 px shorter at 390 px.
- No other change: fonts, colors, radius, motion and spacing resolve to the same values through the HIG roles.

## Not covered

- Large-text and RTL checks were not run. Only Chromium was automated; Firefox and WebKit were not run.
- No physical devices. Simulators and emulators do not apply to this static docs change.

Rollback: revert the PR. That restores the 19c7561 tarballs, the Radix packages, the lockfile and the copied values.
