# Testnet lifecycle verification

The `Testnet lifecycle` GitHub workflow runs nightly and on manual dispatch in the
`testnet` environment on the self-hosted Mac mini fleet (see [CI runners](ci-runners.md)).
It isolates `HOME` under `$RUNNER_TEMP` so a persistent runner cannot reuse
`~/.bloxwap`. It fails when required credentials are absent. A successful
unit test, skipped integration test or workflow that stops before the lifecycle
is not a live testnet pass.

Set these environment secret **names**, using a dedicated disposable company CI
account and separate company test Privy app:

| Secret | Purpose |
| --- | --- |
| `BLOXWAP_TEST_MASTER_KEY` | CI-only master signer for a testnet-only disposable account |
| `BLOXWAP_PRIVY_APP_ID` | Dedicated test Privy app ID |
| `BLOXWAP_PRIVY_APP_SECRET` | Dedicated test Privy app secret |

No production user key or credential belongs in this workflow. Production users
create and own their own Privy account/app and approve actions from their external
wallet. Bloxwap never receives those keys or secrets. The CI-only test signer is
not shipped as a CLI key-import mode and its key is removed from CLI child process
environments.

Pre-fund the disposable Hyperliquid **testnet** account with at least 30 test USDC.
It must have no positions, open orders or leftover agent approvals. Use an
ephemeral clean CI home: the harness refuses existing `~/.bloxwap` state. CI sets
`BLOXWAP_E2E=1` and `BLOXWAP_TEST_ACCOUNT_ONLY=1`; signing is refused outside CI.
Do not run this workflow with a mainnet account or real funds.

Hyperliquid testnet and Privy calls are real. Relay is explicitly mocked at the
testnet URL: the quote has zero expected output and settlement relies on existing
test collateral. No token transfer or bridge execution is claimed. Mainnet Relay
and Hyperliquid HTTP endpoints are blocked by the harness preload. This boundary
is visible in every lifecycle report and workflow summary.

The lifecycle asserts both init approvals, funding QR and settled state, runner
signing/readiness, post-only resting order placement, observable modification and
cancellation, WebSocket order events, `events --follow`/cursor replay, verified
rotation/old-agent revocation, final local/exchange revocation and hash-verified
audit intent/signature/response records. Assertions reconcile exchange state;
`ok:true` alone never counts as completion. Orders use BTC with a 50 test USD
notional/position cap and a two-open-order limit. Test fills are not requested.

Artifacts contain `lifecycle-report.json`, event and audit journals, streamed
events and redacted runner logs. They exclude configs, approvals and key files,
are checked against the known secret values before writing and expire after
seven days. The report records the commit/run and each stage's outcome. Failed
runs attempt order/agent cleanup; `failed-manual-review-required` means inspect
the disposable account before another run. A forced job termination can interrupt
cleanup, so account owners should review failed/timed-out runs.

An AI-driven skill forward run remains a separate acceptance requirement: have a
coding agent read the installed skill, use the dedicated testnet setup, follow its
approval/funding boundaries, and record its agent/session ID plus lifecycle and
journal evidence. The deterministic CI script is not represented as that agent
session. #37 covers the completed skill content, installation and hosting. Its
live-session criterion is now tracked in #39, which remains open until both forms
of live testnet evidence are recorded.
