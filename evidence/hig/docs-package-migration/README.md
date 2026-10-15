# Docs: copied HIG CSS → HIG packages (bloxwap/hig#58)

The agent-cli docs (`apps/docs`) now consume the HIG 0.1.0 candidate packages built from
[bloxwap/hig@19c7561](https://github.com/bloxwap/hig/tree/19c75619fa5020c015aa639172c83fd02f2bc0a2) and vendored in
[`vendor/bloxwap-hig/`](../../../vendor/bloxwap-hig/README.md). Nothing was published, tagged or released.

## Before / after

Static export with `NEXT_PUBLIC_BASE_PATH=/agent-cli`. Sizes are emitted file bytes, not transfer sizes; gzip is
the sum of per-file gzip. Raw data: [measurements.json](measurements.json).

| | Before (main 19ebad0) | After |
| --- | ---: | ---: |
| Docs source CSS | 3 files, 530 lines, 25,447 B | 1 file, 408 lines, 21,885 B |
| Committed font files in `apps/docs` | 2 TTFs, 892,964 B | 0 |
| Copied HIG files (`vendor/hig`, `styles/hig.generated.css`, `fonts/`) | 9 | 0 |
| Emitted CSS | 142,143 B (22,554 gz) | 150,822 B (24,357 gz) |
| Emitted JS | 1,262,320 B (404,715 gz) | 1,268,249 B (406,679 gz) |
| Emitted fonts | 22 files, 12,965,628 B | same |
| Total static export | 20,535,551 B | 20,552,717 B |
| Docs direct dependencies (runtime) | 15 (8) | 21 (13) |
| Lockfile package entries | 703 | 764 |

- **CSS +8.7 KB (+1.8 KB gzip):** `@bloxwap/hig-react/css` ships every control recipe as one sheet (fields, ranges,
  segmented controls, progress and so on). The docs use only a few. The local `.btn` family, install tabs and focus
  ring were removed.
- **JS +5.9 KB (+2.0 KB gzip):** HIG `Tabs`, `IconButton`, `InstallCommand`, `Alert`/`EmptyState` and the
  context provider code.
- **Dependencies:** +3 HIG packages (`hig-tokens`, `hig-react`, `hig-contracts`), +1 dev (`playwright` for the new
  smoke test), and +2 Radix packages. The Radix ones are needed only because `@bloxwap/hig-react/recipes`
  statically imports `./overlay.js`, which imports the optional peers `@radix-ui/react-dropdown-menu` and
  `@radix-ui/react-tooltip`. Without them the build fails with "Module not found". The overlay code is
  tree-shaken out of the docs bundle: composing the same recipe from `Surface` and `Button` produced the same JS size
  (1,268,192 B) but 56 fewer lockfile entries. This needs an upstream HIG fix: either drop the overlay import from
  `recipes`, or make those peers required.
- **Optional peer mismatch:** `hig-react` pins `@radix-ui/react-dialog`/`react-popover` to exactly 1.1.15, but
  Fumadocs installs 1.3.1. `npm ls` reports them as invalid. Unlike in sfx#50, npm did not re-resolve Fumadocs here,
  so this adds no JS.
- **Fonts:** the social-card renderer now reads `BloxwapSans-{Bold,Black}.ttf` from `@bloxwap/hig-tokens/fonts`. The
  files differ in bytes from the deleted local instances, but every rendered card is byte-identical
  (`out/og/home.png` compared with `cmp`).

## Drift

`node <hig@19c7561>/scripts/drift.mjs --root . --config hig-drift.json`:

- Before (main): 6 violations. The `vendor/hig` import in `global.css` and `og-card.tsx`, the two TTFs, and the copied
  palette and token definitions in `vendor/hig/tokens.css`.
- After: `Scoped anti-drift: passed (36 files, 0 dated exceptions)`. CI runs the check from the same pinned HIG commit
  (`.github/workflows/docs.yml`).

## Validation (automated and browser; local Linux x64, Node 24.22.0)

- `npm run build`, `npm run lint`, `npm run typecheck` and `npm test` all pass.
- `npm run docs:check` passes: content, HIG provenance/installed versions/host token values, Next typegen and `tsc`.
- `NEXT_PUBLIC_BASE_PATH=/agent-cli npm run docs:build`: the postbuild checker verified 16 HTML pages, 597 local
  links/assets, 13 social cards and the `/agent-cli` base path.
- `npm run docs:smoke` (Playwright Chromium, against the `/agent-cli` static preview). It passes 10/10, and the same
  script passes 10/10 on the before build:
  - home renders with every stylesheet inside the base path and no runtime errors
  - install tabs respond to ArrowRight/Home/End with roving focus
  - install copy writes the clipboard and announces status
  - hero code copy works
  - Tab reaches "Get started" with a 2 px solid focus ring
  - Ctrl+K search finds results, shows the no-results state and closes with Escape
  - docs and table pages render
  - the 404 page returns status 404 and its recovery link stays under `/agent-cli/docs/`
  - at 390 px the home page has no horizontal scroll, and the sidebar opens and navigates to `/docs/runner/`

## Visual differences (screenshots/)

Each `before-*` and `after-*` pair was captured at 1440×900 or 390×844.

- Install picker: HIG `Tabs`, with the selected tab filled in green. The HIG `InstallCommand` recipe (surface,
  command, "Copy install command" button, visible status) replaces the pill and icon-only copy button.
- Code-window copy: HIG ghost `IconButton`, a nested fill at compact density with 48 px targets on coarse pointers.
- Search no-results: HIG `EmptyState`. Search error: HIG `Alert`.
- Tables: HIG's global table rule adds 12 px cell padding.
- Unchanged: Fumadocs shell, navigation, search index, base path, metadata, social cards, footer and deep links.

## Not covered

- Large-text and RTL checks were not run. Only Chromium was automated; Firefox and WebKit were not run.
- No physical devices. Simulators and emulators do not apply to this static docs change.

Rollback: revert the PR. That restores the copied files, the previous lockfile and the imports.
