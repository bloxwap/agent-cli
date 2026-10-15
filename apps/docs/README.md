# @bloxwap/agent-cli documentation

Fumadocs + Next.js, statically exported for GitHub Pages. This npm workspace
mirrors [`bloxwap/chart/apps/docs`](https://github.com/bloxwap/chart/tree/main/apps/docs) conventions and shares the Bloxwap brand
used by the Hyperliquid docs. Docs dependencies stay out of the published CLI.

From the repository root (Node.js 24+):

```sh
npm ci
npm run docs:dev
npm run docs:build
npm run docs:check
npm run docs:preview
```

Development and preview use port **3903**. The default base path is empty,
so open http://localhost:3903/ for the landing page and http://localhost:3903/docs/
for the documentation. The Pages workflow sets `NEXT_PUBLIC_BASE_PATH=/agent-cli`
for deployment; set it explicitly when building or previewing that path locally.
Set `NEXT_PUBLIC_SITE_URL` for
canonical and social URLs (default `https://bloxwap.github.io`). The static preview
reads the base path from the built artifact and needs no Next.js server.

Edit MDX in `content/docs/` and sidebar order in `meta.json`. `commands.mdx` and
`skill.mdx` are generated from the built CLI and packaged SKILL.md. Run
`npm run docs:generate` after CLI changes. Dev/build also synchronize them;
`docs:check` rejects stale generated content, checks sidebar/local MDX links,
verifies HIG provenance, and checks Next.js/TypeScript types.

Build output lives in `out/`. The postbuild checker validates local HTML links
and assets, base-path containment, social metadata and 1200×630 PNG cards. Search
uses a static `search.json` index in the browser. `llms.txt`, robots, and sitemap
are generated for the configured deployment URL. The Pages workflow builds and
checks PRs and deploys only main.

The design mirrors Chart's dark surfaces, green accents, typography, navigation and
footer. Shared presentation comes from the Bloxwap HIG packages, installed from the
packed candidates in [`vendor/bloxwap-hig/`](../../vendor/bloxwap-hig/README.md):
`@bloxwap/hig-tokens/css` and `@bloxwap/hig-react/css` supply the `--hig-*` roles and
control recipes, and the install tabs, copy buttons, search states and MDX callouts
use HIG `Tabs`, `InstallCommand`, `IconButton`, `Alert`, `EmptyState` and `Callout`.
`app/global.css` maps Fumadocs onto the HIG roles and keeps only site layout. Never
copy HIG CSS, palettes or fonts into this app. `hig-tokens.mjs --check` (part of
`docs:check`) verifies the vendored hashes, the installed versions and the few
JS-only HIG values `global.css` repeats. CI also runs HIG's scoped drift check
(`hig-drift.json`) and `npm run docs:smoke`, a Playwright pass over install/copy,
keyboard, search, 404 and 390 px navigation against the static export.

Bloxwap Sans and Mono are self-hosted by `@bloxwap/font@0.1.2`. The social renderer
uses the static Bold/Black instances shipped in `@bloxwap/hig-tokens/fonts`.
Brand marks in `public/logos/` are supplied artwork, never typeset replacements.
Every MDX page receives a static social card via `app/og/[...slug]/route.tsx`.

The workspace pins `mdast-util-to-markdown` to Chart's 2.1.2: version 2.2.0
changes attention handlers in a way incompatible with Fumadocs 16.15.14's
stringifier (bold text recurses during structured search data generation).
