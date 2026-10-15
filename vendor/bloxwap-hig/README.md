# Vendored Bloxwap HIG candidate packages

`@bloxwap/hig-*` is not on npm yet ([bloxwap/hig#56](https://github.com/bloxwap/hig/issues/56)). The docs app
(`apps/docs`) installs these packed candidates through `file:` dependencies. Nothing here is copied source.

| Tarball | Package | Bytes | sha256 |
| --- | --- | ---: | --- |
| `bloxwap-hig-tokens-0.1.0-candidate.sha19c75619.tgz` | `@bloxwap/hig-tokens` | 4,428,740 | `55542394d90b4b8eef0fd17c413595152032195aab24e3bcd55060041d28830e` |
| `bloxwap-hig-react-0.1.0-candidate.sha19c75619.tgz` | `@bloxwap/hig-react` | 16,726 | `3a5e6b7a014900df339737feafa7458077aaf8a512881dc58a98a623dbd1fc3d` |
| `bloxwap-hig-contracts-0.1.0-candidate.sha19c75619.tgz` | `@bloxwap/hig-contracts` (dependency of react) | 3,056 | `9c61c4b82f64335bb1b7ce1bfcf25e2e5f060e0e19c52fce3b99b17a96f410c7` |

Source: [bloxwap/hig@19c7561](https://github.com/bloxwap/hig/tree/19c75619fa5020c015aa639172c83fd02f2bc0a2), HIG 0.1.0
candidate. Built in a clean clone (Node 24, Python with `fonttools[woff]==4.61.1` and `brotli==1.2.0`):

```sh
npm ci && npm run generate:fonts && npm run build
npm run release:dry-run -- --channel candidate
```

The dry run reported `published: false`, with no tags or releases. Only the three packages the docs use are
vendored; `hig-feedback` and `hig-native` are not needed. `provenance.json` holds the same hashes in machine form,
and `npm run docs:check` (`apps/docs/scripts/hig-tokens.mjs`) fails if a tarball, the `file:` specs or the installed
versions drift apart.

What the docs use:

- `@bloxwap/hig-tokens/css` for the `--hig-*` palette, spacing and control heights; `@bloxwap/hig-react/css` for the
  control recipes (`hig-button`, `hig-surface`, `hig-link`, `hig-sr-only`, focus ring).
- `@bloxwap/hig-react/button` `IconButton` (code copy), `/navigation` `Tabs` and `/recipes` `InstallCommand`
  (package-manager install), `/status` `Alert`, `EmptyState` and `Callout` (search error, no results, MDX callouts).
- `@bloxwap/hig-tokens` `tokens` and `@bloxwap/hig-tokens/fonts/BloxwapSans-{Bold,Black}.ttf` for the Open Graph
  renderer (approved static instances of `@bloxwap/font` 0.1.2; OFL in the package).

Upgrade: rebuild the tarballs from a reviewed HIG commit, replace these files, update the three `file:` specs in
`apps/docs/package.json`, `provenance.json`, this table and the drift checkout `ref` in
`.github/workflows/docs.yml`, then run `npm install`. When #56 publishes, swap the `file:` specs for registry versions
and delete this folder. Rollback is a revert of the adopting commit, which restores the previous lockfile and imports.

Packaging note: `@bloxwap/hig-react` declares exact optional peers (`@radix-ui/react-dialog` and
`@radix-ui/react-popover` 1.1.15). Fumadocs already installs 1.3.1, so `npm ls` reports those optional peers as
invalid. The docs never render HIG's Radix-backed overlays, so nothing runs against the mismatched version. However,
`@bloxwap/hig-react/recipes` statically imports `./overlay.js`, so the docs install the optional peers
`@radix-ui/react-dropdown-menu@2.1.16` and `@radix-ui/react-tooltip@1.2.8`. They are only needed to resolve that
import; the overlay code is tree-shaken out of the bundle. Remove them once HIG decouples `recipes` from `overlay`.
