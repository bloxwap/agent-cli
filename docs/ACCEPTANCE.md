# Acceptance review

This records implementation evidence, not a claim that credential-dependent
services or hosted workflows ran. See PROGRESS.md for the remaining partial
items. The final local run uses the SDK-supported Node 22 runtime and Bun.

| Issues | Reviewed artifacts and meaningful validation |
| --- | --- |
| #1 | package scripts/bin, strict ESM tsconfig, CI workflow; build/lint/typecheck/Vitest smoke pass. Hosted CI awaits a push, which was explicitly excluded. |
| #2 | docs/adr/0001-runner-interface.md compares all three transports, method names, private permissions and Windows strategy. |
| #3–#4 | Stable append-only error catalog and serialization/exit tests; strict flags/JSON/stdin parser, input/output schemas, typo and uncaught-error tests. Streaming exceptions are explicit. |
| #5–#6 | Config validation/migration/atomic private writes/corrupt-file tests; recursive field/env/PEM redaction, request correlation and size/day rotation. |
| #7–#9 | Requested SDK, network factories, shared metadata cache/refresh, exact rounding fixtures, service mapping fixtures, bounded retries and exclusive persisted nonce tests. |
| #10–#13 | P-256 managed-wallet creation/linking and typed-data adapter; versioned Privy domain/source policy and local forbidden-action tests; resumable external master approvals with persisted per-master nonces, expiry bounds and builder approval verification. Missing official builder defaults and hash-preimage policy limitations are explicit in PROGRESS/custody docs. Sandbox calls are separately gated. |
| #14–#19 | Relay quote/fee/address fixture tests, bigint round trips including signed values, terminal QR snapshot and file renderer, idempotent funding store, ordered/resumable signature tests, terminal deposit transitions and collateral receipt excluding marked PnL. |
| #20–#25 | Numeric-string account/order/market projections, approval/policy/deposit/expiry/runner status; every risk bound tested, opposing pending exposure and realized/marked daily PnL checked; SDK order fixture tests cover limit/IOC/slippage/trigger behavior, cancellation, batch modification preserving reduce-only/TIF/trigger semantics and leverage ceilings/loss. |
| #26–#28 | Private PID/socket lifecycle, stale dead-PID recovery/readiness, serialized RPC, cross-network/config refusal and direct fallback only on confirmed absence; simulated WS drop, SDK resubscribe, paginated info gap-fill, persisted fill dedupe. Windows ACL limitations are documented. |
| #29–#32 | Locked sequence journal across independent writers/restarts, replay/types/follow, exact fill fee units; log filtering/redaction; runner heartbeat/staleness and deposit polling; mocked-clock expiry blocking and once-per-threshold warnings. |
| #33–#36 | New approval verified before signer handoff/old revocation, resumable rotation and immediate local revocation tests; fsynced cross-process hash-chain with intent/decision/signature digest/response/fill linkage; tamper/redaction tests and linked full-lifecycle records. CLI/RPC pre-schema hex/mnemonic detector and threat model. |
| #37–#38 | Frontmatter validator, independent simulated skill forward-test (schema-validated actions, ordered signatures, pending/rejection/expiry handling), bounded polling and supported-test-route guidance; install/custody README, generated input/output command reference and static Pages site. Real agent/testnet validation is credential-gated. |
| #39 | Offline full CLI/SDK/RPC account lifecycle test; separate opt-in nightly testnet script signs only in CI, uses mocked Relay and funded test collateral, covers onboarding/orders/events/rotation/revoke and exports event/audit artifacts. Live execution skips without secrets. |
| #40–#42 | Packed global installation and Bun smoke, executable bin, engine declaration, no package postinstall; Linux/macOS binary build, changesets/tag/version/provenance/asset pipeline behind publish gate; packaged/embedded skill, Claude/Codex paths, CODEX_HOME, overwrite protection and matching versions. Publishing/registry verification awaits external credentials. |

No push, tag creation, remote changes, package publication or live-account trading
was performed. Local acceptance deliberately leaves unsupported external claims
unproven instead of labelling skipped checks as successful live tests.
