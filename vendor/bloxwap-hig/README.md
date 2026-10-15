# Vendored Bloxwap HIG candidate packages

`@bloxwap/hig-*` is not on npm yet ([bloxwap/hig#56](https://github.com/bloxwap/hig/issues/56)). The docs app
(`apps/docs`) installs these packed candidates through `file:` dependencies, and the root `overrides` point HIG's
internal `@bloxwap/hig-tokens` and `@bloxwap/hig-contracts` dependencies at the same files. Nothing here is copied
source.

| Tarball | Package | Bytes | sha256 |
| --- | --- | ---: | --- |
| `bloxwap-hig-tokens-0.1.0-candidate.sha872906a9.tgz` | `@bloxwap/hig-tokens` | 8,108 | `62b4007b5e06ee571352f8a33bd7e14025745fe42234d8532092739ff49f6196` |
| `bloxwap-hig-react-0.1.0-candidate.sha872906a9.tgz` | `@bloxwap/hig-react` | 20,287 | `5835fea5e4f701815fb4152cf079901d0f8af634ef3fbb537b40fc48500670c4` |
| `bloxwap-hig-contracts-0.1.0-candidate.sha872906a9.tgz` | `@bloxwap/hig-contracts` (dependency of react) | 6,119 | `ca8d5e0fe7e6138c056e9b45182e664c69d7217295264dff56a09290acabd352` |
| `bloxwap-hig-native-fonts-0.1.0-candidate.sha872906a9.tgz` | `@bloxwap/hig-native-fonts` (dev, social cards only) | 4,420,375 | `2de088737f6f76c594e95de237342dbe4457387ed9134628ef12049266195f77` |

Source: [bloxwap/hig@872906a](https://github.com/bloxwap/hig/tree/872906a9071469af8714b3b6fb5cc7bd64d2d6f3), HIG 0.1.0
candidate. Built in a clean clone (Node 24, Python with `fonttools[woff]==4.61.1` and `brotli==1.2.0`):

```sh
npm ci && npm run generate:fonts && npm run build
npm run release:dry-run -- --channel candidate
```

The dry run reported `published: false`, with no tags or releases. Only the four packages the docs use are
vendored; `hig-feedback` and `hig-native` are not needed. `provenance.json` holds the same hashes in machine form,
and `npm run docs:check` (`apps/docs/scripts/hig-tokens.mjs`) fails if a tarball, the `file:` specs, the overrides or
the installed versions drift apart.

What the docs use:

- `@bloxwap/hig-tokens/css` for the `--hig-*` palette, spacing, radius, motion, type, density and font-family roles;
  `@bloxwap/hig-react/css` for the control recipes (`hig-button`, `hig-surface`, `hig-link`, `hig-sr-only`, focus
  ring).
- `@bloxwap/hig-react/button` `IconButton` (code copy), `/navigation` `Tabs` and `/recipes/install-command`
  `InstallCommand` (package-manager install), `/status` `Alert`, `EmptyState` and `Callout` (search error, no results,
  MDX callouts).
- `@bloxwap/hig-tokens` `tokens` for the Open Graph colors, and
  `@bloxwap/hig-native-fonts/fonts/BloxwapSans-{Bold,Black}.ttf` for the Open Graph renderer. Satori needs static
  TTFs, which `@bloxwap/font` (WOFF2) does not ship; these are the approved static instances of `@bloxwap/font`
  0.1.2 (OFL in the package). It is a dev dependency because the cards are rendered at build time.

The docs install no Radix packages for HIG. `@bloxwap/hig-react/recipes/install-command` is an overlay-free entry, so
the optional `@radix-ui/react-dropdown-menu` and `@radix-ui/react-tooltip` peers are no longer needed
([bloxwap/hig#63](https://github.com/bloxwap/hig/issues/63)). HIG's Radix peers are caret ranges now, so the
`@radix-ui/react-dialog`/`react-popover` 1.3.1 that Fumadocs installs satisfy them and `npm ls` reports no invalid
HIG peers.

Upgrade: rebuild the tarballs from a reviewed HIG commit, replace these files, update the four `file:` specs in
`apps/docs/package.json`, the two `overrides` in the root `package.json`, `provenance.json`, this table and the drift
checkout `ref` in `.github/workflows/docs.yml`, then run `npm install`. When #56 publishes, swap the `file:` specs for
registry versions, drop the overrides and delete this folder. Rollback is a revert of the adopting commit, which
restores the previous tarballs, lockfile and imports.
