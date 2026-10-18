# Testnet lifecycle verification

The `Testnet lifecycle` GitHub workflow runs nightly and on manual dispatch in the
`testnet` environment on the self-hosted Mac mini fleet (see [CI runners](ci-runners.md)).
Each run uses a fresh Node 24 Linux container with its default home and state
location; the persistent host's wallet state is never mounted. It fails when
required configuration is absent. Offline
fixtures, skipped tests and runs that stop before the lifecycle do not establish
live coverage.

Every production user brings their own external master wallet and Privy app.
Bloxwap receives neither their keys nor their app credentials. The test harness
supports an external wallet on a caller-controlled QA runner and a separate
CI-only signer for a disposable company test account. Neither mode imports a
production wallet into the CLI.

## External wallet on your QA runner

Create a dedicated test Privy app and choose a disposable testnet wallet that you
control. Set these variables locally through your secret manager or environment;
never put secrets in a conversation, issue, source file or command argument:

| Variable | Purpose |
| --- | --- |
| `BLOXWAP_TEST_MASTER_ADDRESS` | Public address of your test wallet |
| `BLOXWAP_TEST_SIGNER` | Absolute path to your executable wallet approval adapter, without arguments |
| `BLOXWAP_PRIVY_APP_ID` | Your dedicated test Privy app ID |
| `BLOXWAP_PRIVY_APP_SECRET` | Your dedicated test Privy app secret |
| `BLOXWAP_E2E` | Explicitly set to `1` |
| `BLOXWAP_TEST_ACCOUNT_ONLY` | Explicitly set to `1` to acknowledge a disposable test account |

Do not set `BLOXWAP_TEST_MASTER_KEY` in this mode. The external wallet retains its
private key; the harness receives only signatures. From the repository root:

```sh
npm ci
npm run build
npm run test:e2e
```

The adapter is executed without a shell or arguments. It receives one JSON object
on stdin (EOF ends the request):

```json
{
  "schemaVersion": 1,
  "network": "testnet",
  "address": "0x...public test wallet address...",
  "action": {"type": "approveAgent", "...": "canonical exchange action"},
  "typedData": {"domain": {}, "types": {}, "primaryType": "...", "message": {}}
}
```

It must return exactly `{"signature":"0x...65-byte signature..."}` on stdout.
Connect it to your wallet's signing/approval mechanism; this protocol is not a
wallet implementation. It has a 60-second timeout and a 16 KiB output limit.
Privy credentials and the CI master-key variable are removed from its environment.

Before invoking the adapter, the harness verifies the exact Hyperliquid approval
domain/types, testnet network and correspondence between action and typed data.
Only `approveAgent` (including revocation) and `approveBuilderFee` are accepted.
Withdrawals, trades and mainnet approvals are refused. The recovered signature
must match your configured public master address. Review the exact agent address,
name/expiry and builder fee before approving.

## Nightly CI configuration

Set these secret names in the repository's `testnet` environment, using a separate
disposable company test wallet and company QA Privy app:

| Secret | Purpose |
| --- | --- |
| `BLOXWAP_TEST_MASTER_KEY` | CI-only signer for the disposable testnet account |
| `BLOXWAP_PRIVY_APP_ID` | Dedicated test Privy app ID |
| `BLOXWAP_PRIVY_APP_SECRET` | Dedicated test Privy app secret |

This mode requires `CI=true` or `CI=1`, both explicit test flags, and no external
signer variables. Its key is removed from CLI child process environments. It is
not a production CLI key-import feature. Missing secrets fail the nightly job.

## Account preparation and coverage

Pre-fund the dedicated Hyperliquid **testnet** account with at least 30 test USDC.
It must have no positions, open orders or leftover agent approvals. Use a clean
OS account or container: the harness refuses existing `~/.bloxwap` state, and
never changes the CLI's state location. Do not use a mainnet account or real funds.

Hyperliquid testnet and Privy calls are real. Relay is explicitly mocked at the
testnet URL: the quote has zero expected output and settlement relies on existing
test collateral. No token transfer or bridge execution is claimed. The preload
blocks mainnet Hyperliquid and Relay HTTP endpoints in CLI child processes.

Fifteen stages verify both init approvals, funding QR/settlement, runner signing
and readiness, resting post-only orders, exact exchange prices after modification,
cancellation, correlated open/canceled WebSocket events, cursor replay, signer
rotation and old-agent revocation, an order/cancel with the new signer, final
revocation, audit integrity and streamed-event delivery. `ok:true` alone never
counts as exchange acceptance. Orders use BTC with a 50 test USD notional/position
cap and a two-open-order limit; the suite does not request fills.

Cleanup records both agent addresses/names before approvals so an interrupted
rotation can revoke either or both. It cancels orders before revocation and
verifies zero orders, approved agents and positions. Unknown approvals are left
untouched and make cleanup fail. Existing local revocation is never bypassed to
cancel orders. Failed cleanup requires owner review of the dedicated test account.
A forced job termination can interrupt cleanup, so inspect timed-out runs too.
The harness also confirms runner process exit and removal of its PID/socket
before exporting journals; a shutdown timeout fails the report.

## Evidence

Schema 2 `lifecycle-report.json` records the commit/run, stage outcomes, observed
service coverage and cleanup counts. Reports are saved at stage checkpoints.
A pass requires all fifteen stages and verified cleanup. CI summaries validate
the report and never infer live coverage from missing or failed prerequisites.

Artifacts include the report, event/audit journals, streamed events and redacted
runner logs. Configs, approval payloads and key files are excluded. The harness
clears its explicit artifact filenames at the next run so previous journals
cannot masquerade as current evidence, checks files against known secret values,
and CI expires uploads after seven days. Save evidence elsewhere before rerunning.

An independent coding-agent session remains a separate acceptance requirement:
have a coding agent read the [hosted skill](https://bloxwap.github.io/agent-cli/SKILL.md)
or installed skill, follow the dedicated testnet flow with your external approvals,
and record its actual agent/session ID, commit, commands/results and event/audit
journals. Do not invent a session ID or relabel this deterministic script as that
session. Its report deliberately retains `agentSession.status: "not-run"`.
#37 covers the completed skill deliverable; #39 remains open until both the
credentialed nightly lifecycle and independent agent evidence are recorded.
