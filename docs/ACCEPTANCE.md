# Acceptance review

This records implementation evidence, not a claim that credential-dependent
services or hosted workflows ran. See PROGRESS.md for the remaining partial
items. Local checks use Node 24 and Bun; install CI also covers the supported
Node 22.12 minimum.

| Issues | Reviewed artifacts and meaningful validation |
| --- | --- |
| #1 | package scripts/bin, strict ESM tsconfig, CI workflow; build/lint/typecheck/Vitest smoke pass. |
| #2 | docs/adr/0001-runner-interface.md compares all three transports, method names, private permissions and Windows strategy. |
| #3–#4 | Stable append-only error catalog and serialization/exit tests; strict flags/JSON/stdin parser, input/output schemas, typo and uncaught-error tests. Streaming exceptions are explicit. |
| #5–#6 | Config validation/migration/atomic private writes/corrupt-file tests; recursive field/env/PEM redaction, request correlation and size/day rotation. |
| #7–#9 | Requested SDK, network factories, shared metadata cache/refresh, exact rounding fixtures, service mapping fixtures, bounded retries and exclusive persisted nonce tests. |
| #10–#13 | User-owned Privy app, local P-256 owner authorization, recoverable wallet creation/linking and typed-data adapter; versioned domain/source/no-export policy, authorized attachment and init revalidation; local forbidden-action tests; resumable external master approvals with persisted per-master nonces, expiry bounds and builder approval verification. Bloxwap builder defaults to f=10 (0.01%); hash-preimage policy limitations are explicit in PROGRESS/custody docs. Direct live sandbox denial still needs a dedicated Privy test app. |
| #14–#19 | Relay quote/fee/address fixture tests, bigint round trips including signed values, terminal QR snapshot and file renderer, idempotent funding store, ordered/resumable signature tests, terminal deposit transitions and collateral receipt excluding marked PnL. |
| #20–#25 | Numeric-string account/order/market projections, approval/policy/deposit/expiry/runner status; every risk bound tested, opposing pending exposure and realized/marked daily PnL checked; SDK order fixture tests cover limit/IOC/slippage/trigger behavior, cancellation, batch modification preserving reduce-only/TIF/trigger semantics and leverage ceilings/loss. |
| #26–#28 | Private PID/socket lifecycle, stale dead-PID recovery/readiness, serialized RPC, cross-network/config refusal and direct fallback only on confirmed absence; simulated WS drop, SDK resubscribe, paginated info gap-fill, persisted fill dedupe. Windows ACL limitations are documented. |
| #29–#32 | Locked sequence journal across independent writers/restarts, replay/types/follow, exact fill fee units; log filtering/redaction; runner heartbeat/staleness and deposit polling; mocked-clock expiry blocking and once-per-threshold warnings. |
| #33–#36 | New approval verified before signer handoff/old revocation, resumable rotation and immediate local revocation tests; fsynced cross-process hash-chain with intent/decision/signature digest/response/fill linkage; tamper/redaction tests and linked full-lifecycle records. CLI/RPC pre-schema hex/mnemonic detector and threat model. |
| #37–#38 | Skill source/frontmatter/error-catalog tests and every documented command input parsed through actual CLI schemas offline; user-owned Privy, ordered external approvals, bounded polling, exchange reconciliation and supported-test-route guidance; install/custody README, generated command reference and static Pages site. The skill deliverable is complete; the unproven coding-agent testnet session is tracked explicitly in #39. |
| #39 | Offline CLI/SDK/RPC lifecycle plus fifteen-stage testnet harness with external wallet approval adapter or separate CI-only disposable signer; exact prices, correlated events, post-rotation trading, partial-rotation cleanup and zero orders/agents/positions verification. Schema 2 reports/CI summaries validate stage and service evidence; Relay remains mocked. Missing configuration fails explicitly. Nightly live evidence and the independent coding-agent skill session remain pending. |
| #40–#42 | Script-free packed global installation and installed bunx smoke, executable bin, license and matching skill versions; Node 22.12/24 install CI; Linux/macOS ARM/x64 native binary smoke; changesets/tagged-main/version/provenance/asset pipeline with candidate-only manual runs. Publishing and public registry verification await npm configuration. |
| #49 | Token guard rejects declarations anywhere in formatted/minified CSS. Unit regression and a mutation of global.css prove docs:check rejects the issue's exact same-line copy. |

No package publication or credentialed account trading is claimed by this review.
Close the live criteria only with an actual run ID, commit, lifecycle report and
event/audit artifacts, or a published version with verified integrity/provenance
and public installation evidence. Mocks, missing-secret failures and candidate
artifacts are not substitutes for those records.
