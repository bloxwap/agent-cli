# Implementation progress

| Issue | State | Notes |
| --- | --- | --- |
| #1 | done | Strict TypeScript ESM scaffold, bundled CLI, Vitest smoke test and CI checks. |

| #2 | done | ADR selects private newline-framed JSON-RPC socket; defines methods and Windows strategy. |
| #3 | done | Stable error catalog, serialization, exit codes and append-only guard. |
| #4 | done | Validated JSON/flags/stdin router, JSON schemas, envelopes and exit codes. |
| #5 | done | Versioned validated config, atomic private writes, migration, commands and env overrides. |
| #6 | done | JSON logging, recursive redaction, correlation IDs and size/day rotation. |
| #7 | done | Requested SDK adapter, lazy WS factory, cached metadata, decimal rounding and remote signer abstraction. SDK requires Node 22.12+; final verification uses supported Node 22 and Bun. Shared metadata cache is exposed via market discovery. |
| #8 | done | Service error adapters, redacted upstream detail, fixture-driven classification and retry defaults. |
| #9 | done | Bounded jittered retries and per-signer persisted monotonic nonces guarded by exclusive locks. Stale locks fail closed. |
| #10 | done | Privy server SDK create/link, P-256 owner, private authorization storage and typed-data signer; sandbox test env-gated. |
| #11 | partial | Each user brings their own external master wallet and Privy app. v2 domain/network and no-export policy, authorized wallet attachment and init revalidation; local typed-data and withdrawal rejection tests pass. Direct live Privy rejection still needs a dedicated test app. L1 action hashes prevent Privy per-action/notional inspection; exchange agent permissions enforce the withdrawal boundary. |
| #12 | done | Idempotent managed-wallet onboarding, persisted external master EIP-712 approvals/deeplink, expiry bound, agent/builder verification and master-key rejection. |
| #13 | done | Default Bloxwap builder address with f=10 (0.01%); config/env overrides, init approval, approved-maximum checks and fund/order address/rate reporting. |
| #14 | done | Typed validated Relay quote/status adapter, perps USDC destination, multiple origin routes and fee parsing; mocked fixtures. |
| #15 | done | Exact bigint decimal parse/format and loss-detecting 6↔8 conversions with property-style round trips. |
| #16 | done | Terminal QR on stderr and JSON field, optional PNG/SVG, no-qr support and snapshot. |
| #17 | done | Funding command returns address/fees/minimum/expiry/8-decimal received amount, persists deposits and reuses valid quotes. |
| #18 | done | Resumable ordered master-signature steps, trusted Relay submission endpoints and funding flow docs. |
| #19 | done | Persisted terminal deposit lifecycle, Relay + exact balance settlement, retryable trading gate and runner emission hook. |
| #20 | done | Account read commands, numeric strings, deposits/approval/policy/expiry status; runner preference wired in #27. |
| #21 | done | Exact decimal risk evaluation covers markets, size/notional/position/leverage/loss/open-order limits; trade hooks and audit wired in #22/#35. |
| #22 | done | Limit Gtc/Ioc/Alo, slippage IOC market, TP/SL, rounding, cloid, risk/deposit/expiry gates, builder and Privy signing; runner routing in #27. |
| #23 | done | Batch cancellation by oid/cloid, coin or account; unknown order normalization and mocked tests. |
| #24 | done | Single/batch modification by oid/cloid with rounding and pre-signing risk checks. |
| #25 | done | Cross/isolated leverage updates enforce market and configured ceilings with mocked tests. |
| #26 | done | Private exclusive PID lock, managed signer session, foreground/detach, idempotency and graceful shutdown; persistent stores survive restart. Dead PID recovery and explicit readiness; stale startup locks fail closed. |
| #27 | done | Bounded newline JSON-RPC socket with private mode, method aliases, serialized trading, normalized errors and configurable direct fallback. |
| #28 | done | SDK reconnect/resubscribe + heartbeat transport, user/market subscriptions, info gap-fill and persisted tid dedupe; simulated drop tests. |
| #29 | done | Typed persisted monotonic event journal, replay/filter/follow stream, subscription/deposit emission and shutdown flush. |
| #30 | done | JSON-line log replay/follow across rotated files, minimum-level/time/request filtering and redaction. |
| #31 | done | Runner heartbeat/state events, PID/uptime/WS/signing health and stale detection; background deposit polling. |
| #32 | done | Persisted once-per-expiry threshold warnings in runner events and nonretryable expiry trading block; mocked clock tests. |
| #33 | done | Persisted two-approval rotation, verified new agent before serialized runner hot-swap, old revocation only after handoff; rotation audit hook in #35. |
| #34 | done | Optional cancel-all, resumable master revocation payload, immediate local blocking and config/session clearing after exchange submission. |
| #35 | done | Cross-process locked fsynced hash-chain audit, intent/decision/signature digest/response/fill linkage, rotation/revoke records and filters; tamper/redaction tests. |
| #36 | done | Pre-schema recursive CLI/RPC secret detector, BIP39-like seed rejection, private authorization refs and env/log/error scrubbing; threat model docs. |
| #37 | done | Skill content, packaged/embedded installation, schema-validated examples and public /SKILL.md hosting are complete. Frontmatter, gotchas, error handling, discovery links and source parity are verified. The unverified live coding-agent testnet criterion is explicitly transferred to #39. |
| #38 | done | Install/testnet README, custody architecture, schema-generated command reference and static docs site with gated Pages workflow. |
| #39 | partial | Fifteen-stage testnet harness supports external wallet signing and separate CI-only disposable keys, exact price reconciliation, correlated WebSocket/follow/replay events, post-rotation trading, audit verification, partial-rotation cleanup and zero orders/agents/positions checks. Hyperliquid order placement/modify/cancel (and the order-book/order-update responses those stages use) are explicitly mocked and blocked from the exchange; approvals, account reads and Privy stay live. Schema 2 reports and CI summaries require evidence and record order coverage as mocked. Offline regressions pass; nightly journals and the independent coding-agent skill session transferred from #37 still require dedicated QA configuration and evidence. Test USDC pre-funding is no longer required. |
| #40 | partial | Script-free tarball global install and actual installed bunx help/schema smoke pass locally; executable/skill/license checks and Node 22.12/24 macOS/Linux CI. Public registry installation awaits publication. |
| #41 | partial | Validated Changesets patch workflow with optional version PR, native binary smoke/checksums, tagged-main version gates, exact tested tarball publication and registry verification. Publish runs on the Mac mini fleet with the organization `NPM_TOKEN` (no OIDC trusted publishing or automatic provenance). Manual candidates cannot publish. Actual release needs the publishing gate; organization policy blocks automatic version PRs, so the default workflow uploads a reviewable patch. |
| #42 | done | Final packaged flow audited and corrected (network/config isolation, exact loss/exposure/receipt checks, trigger preservation, readiness and stream errors). Skill shipped/embedded in npm and compiled CLI; Claude/Codex installation with CODEX_HOME, version synchronization, idempotency and overwrite protection. |
| #49 | done | Docs token guard checks declarations anywhere on a line; regression coverage includes formatted and minified radius, motion, density and type copies. The issue's same-line mutation makes docs:check fail. |

Original implementation verification: supported Node 22, strict build/lint/typecheck and isolated offline tests. This did not establish live Privy/testnet or registry acceptance. Bloxwap builder defaults to f=10 (0.01%), with config/env overrides.

## Workspace and Fumadocs migration

- Workspace migration: done — CLI sources, tests, skill, policies and release tooling live in `packages/agent-cli`; root scripts delegate, publish targets the CLI workspace.
- Fumadocs site: done — Chart conventions, HIG assets, local fonts, static search/social cards, MDX operating guides, generated schemas/skill, and main-only Pages deployment.
- Local docs URLs: done — development defaults to `http://localhost:3903/` with documentation under `/docs/`; the Pages workflow explicitly retains `/agent-cli` as its deployment base path.
- Landing workflow panel: done — shared code-window toolbar and copy control, highlighted shell commands, muted comments, and HIG-backed blue syntax colors.
- Verification: Node 24; clean `npm ci`; root build/lint/typecheck/tests (71 tests), docs build/check, export link/social checks, static preview 200/404 checks, CLI pack and global-install smoke passed. No push or publish.

## Open-issue review — 2026-10-16

Three agents reviewed policies (#11), the skill/testnet lifecycle (#37/#39),
and installation/releases (#40/#41); the integration review fixed #49.
The integrated local checks pass build, lint, typecheck, 103 CLI tests, two docs
guard tests, docs build/check and the script-free global npm/installed bunx smoke.
The exact same-line CSS mutation from #49 is rejected by `docs:check`.

Live acceptance remains pending: the `testnet` environment has no QA credentials,
the public npm package returns 404, and publication authentication/gating is not
configured. GitHub also rejected the repository's Actions PR setting with an
organization-policy 409; version dispatch therefore defaults to an uploaded
reviewable patch. No production user credentials, package publication or live
account trading were used for this review.

The validated version-patch workflow prepared 0.2.0, consuming the pending
changesets and synchronizing package/lock/skill versions and generated docs.
This is release preparation; public npm installation is still pending.

## HIG OG-font refresh — 2026-10-18

| Issue | State | Notes |
| --- | --- | --- |
| bloxwap/hig#115 | partial | Original refresh validated against consumer baseline `76384c49`; current integration checks are recorded below. HIG `0.1.0-candidate.shae3390bbd` replaces the native-fonts dev dependency with the OG-only package. All 13 generated cards and the desktop/mobile comparison captures were byte-identical at that original baseline. |

The clean lock install, root build/lint/typecheck, 103 CLI tests, docs production
build/check (including two CSS guard tests), all 14 browser smoke checks and the
pinned HIG drift check (41 files, zero exceptions) pass. The selected Bold/Black
family, weights and font bytes are unchanged. The vendor set is 3,573,511 bytes
smaller; the redundant HIG root file overrides are removed, while unrelated
esbuild/mdast overrides remain. [Local evidence](../evidence/hig/og-font-refresh/README.md).

The draft refresh PR tracks remote CI and central HIG adoption linkage. Package
publication and deployment are outside this refresh.

## Testnet harness — 2026-10-18

#39 now supports caller-controlled external wallet approvals alongside the
separate disposable CI signer, with fifteen evidence-checked stages, correlated
events and interrupted-rotation cleanup. Hyperliquid order placement, modification
and cancellation never reach the exchange: the preload mocks those endpoints and
fails closed if an order request escapes. 30 test USDC pre-funding is not required.
Runner shutdown is confirmed before journal export. Nightly CI maps
`AGENT_CLI_TEST_MASTER_KEY`, `AGENT_CLI_PRIVY_APP_ID` and
`AGENT_CLI_PRIVY_APP_SECRET` from the `testnet` environment onto the harness
`BLOXWAP_*` variables. Live journals and the independent coding-agent session
are still not claimed.

## HIG refresh integration — 2026-10-18

Merged current main `bb242b8ef95ae238a65b779d427bff3813e6b267` into the
existing HIG refresh branch, retaining upstream runner, testnet and npm-token changes.
The exact four `e3390bbd` archives and dependency lock are unchanged. A fresh install,
build, lint, types, 232 offline CLI tests, packed-package install, production docs
build/check, 14 browser smoke checks and pinned drift check pass. Current 13-card
output matches the historical manifest; earlier screenshot parity remains scoped to its
original baseline. [Integration evidence](../evidence/hig/og-font-refresh/main-integration/report.json).
[Draft PR #55](https://github.com/bloxwap/agent-cli/pull/55) tracks remote checks and adoption.
