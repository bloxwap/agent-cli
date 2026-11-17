# Runtime invariant fixes

Implementation checklist for all 44 findings in the 2026-11-17 audit of
`ae8f543`. Finding numbers below are audit IDs, not GitHub issue numbers.
All entries are implemented. Tests use temporary state, generated test keys,
and mocked Hyperliquid/Relay services; they make no network calls.

Regression suites: [original reproductions inverted][R], [recovery][C],
[runner][U], [lock contention][L], [mode][M], [boundary checks][B], and
[durable files][F]. Existing lifecycle, funding, paper, and invariant suites
also cover the changed paths. Final verification passed: 386 tests in 64 files,
build, lint, both TypeScript compilers, npm/Bun package smoke, docs checks and
production static export.

| Finding | Enforcement | Verification |
| --- | --- | --- |
| 1 | File-lock contenders elect one owner before dead-holder replacement. Unique claims and process identity prevent stale-read takeover; live/unknown owners are never stolen. | [L]: paused stale observation, contending processes, live holder |
| 2 | The runner holds a lifetime ownership lease. Ping bypasses the command queue; unresponsive live PIDs continue to block replacement and fallback. | [U], `invariants.test.ts`: busy ping, wrong token, dead PID |
| 3 | Approval pins network, master, agent and verified expiry. Risk, lock and cached signer identities must agree. | [R], [C]: master override and wrong cached signer |
| 4 | Commands reload current config under the same account lock used by config writes. Revocation and tighter limits take effect before submission. | [R], [C]: stale config after revoke/tighter limits |
| 5 | Every custody entry point, including deposit resume/abandon/signature, rejects paper mode. | [R]: paper Relay signature blocked; `paper-mode.test.ts` |
| 6 | Dispatch resolves mode once; detached children receive explicit mode, and RPC pins it even without caller metadata. | [M], `invariants.test.ts`: JSON paper intent, explicit live detach, saved-mode change |
| 7 | Risk values exposure using the greatest applicable current mark, submitted limit and pending-order limit, with exact decimal arithmetic. | [R]: marketable sell bounded by market value; risk tests |
| 8 | Client persists intent/cloid binding before RPC; submission reserves unresolved exposure before the exchange call. Empty lookup cannot authorize resubmission. | [C]: client identity, unknown order retry, blocked additional exposure, positive reconciliation |
| 9 | Installed SDK transport errors map to non-retryable unknown mutation outcomes. | [U], [C]: actual SDK timeout classes |
| 10 | Scoped persistent operation records bind a cloid/intent to its request for its lifetime, independent of audit retention and paper display buffers. | [R]: request conflict, canceled paper cloid; `invariants.test.ts`: intent reuse |
| 11 | Mixed batch errors retain the entire response, member statuses and partial outcome. | [C]: returned and SDK-thrown mixed batches |
| 12 | An audit failure after execution preserves accepted outcome, result and identity; failure logging cannot replace the original exchange error. | [C]: injected audit response failure |
| 13 | Init verifies remote agent identity/expiry and builder approval before saving an approved tuple; changing expiry invalidates local approval until verified. | [R]: unverified expiry extension; lifecycle tests |
| 14 | Approval cache fingerprints include master, network and complete action; init and rotation validate requested builder/agent/expiry fields. | [C]: changed cached action; approval tests |
| 15 | Submitted approval typed data must match its action/network, its signature must recover the configured master, and remote state confirms approval/revocation. | [C]: wrong master; approval/lifecycle tests |
| 16 | Rejected nonces force regeneration under the pending-approval lock even when the previous payload was fresh. | [R]: fresh rejected nonce; approval tests |
| 17 | Rotation derives a replacement without writing a shared scratch config; only agent fields are copied onto the current revision. | [R]: scratch/revision regression; existing concurrent-config rotation test |
| 18 | Rotation opens the replacement signer before committing handoff. Resumption recognizes an already-visible approval and reconciles a completed config swap. | [B]: missing replacement key, then resume without resubmission; lifecycle tests |
| 19 | Started deposits remain pending through unknown/retriable failure statuses. Only never-started quotes can expire automatically. | [R], `deposit-status.test.ts` |
| 20 | A deposit may reuse its own persisted ledger hash and credit while waiting for Relay success. | [R]: pending credit reused after success |
| 21 | Settlement requires a Relay destination transaction linked to an account ledger credit. Ownership and ambiguity are checked atomically against latest state. | [C]: unrelated/ambiguous credits and concurrent polling |
| 22 | Fresh and cached quotes validate complete origin/destination identity, units, amount, recipient, address and expiry; cache keys include decimals. | [R], funding tests |
| 23 | Signature steps check account, terminal/expiry state and order, then persist a claim before POST. Uncertain claims require positive status reconciliation. | [C]: concurrent and uncertain submission; signature tests |
| 24 | Atomic state replacement flushes file contents before rename and the parent directory after it. Journals flush before publication is acknowledged. | [F]: syscall order and failures before/after rename |
| 25 | Runtime schemas validate paper state, deposits, approvals, rotation, runner ownership, operations and journal records, including counters, unique ownership and cash reconciliation. | [C], [B]: corrupt safety state and inconsistent cash |
| 26 | Live identities include network/master; paper identities include session UUID. Reset retains journal sequences. Deposit selection and transition keys include account/network. | [U], [C], [B]: cross-account fill identity, reset cursors and follower transition |
| 27 | Strict audit/event readers repair torn tails while holding the journal lock. Audit hashes are verified without changing original property order. | [R], `invariants.test.ts`: torn audit/event tails |
| 28 | Live fill dedupe/cursors advance only after durable publication; stable IDs dedupe replay across subscriber/EventStore instances. | [R], [C]: failed publication and repeat delivery |
| 29 | Paper state and deposit transitions commit durable publication obligations with state. Stable event IDs make archive, audit and event replay idempotent. | [R], [C]: direct paper fills and failed outbox publication |
| 30 | The central fill boundary enforces reduce-only direction and caps closing quantity; triggers without usable books wait. | [R], [B]: changed position sign, oversize close, missing book |
| 31 | Reversal handles sign change before same-direction averaging, pricing residual exposure at the new fill. | [R]: long-to-larger-short reversal |
| 32 | Crossing ALO rejects; GTC crossing and modification retain unfilled remainder; IOC cancels remainder. | [R], `paper-exchange.test.ts` |
| 33 | Open-order output retains trigger market/limit metadata; modification uses the same activation state machine as placement. | [R]: dormant trigger modification; paper exchange tests |
| 34 | Every exposure-increasing fill checks margin including execution fees. Leverage changes cannot undercollateralize existing positions. | [R], [C]: competing resting fills and leverage reduction |
| 35 | New trades are captured by monotonic ID before trimming display state; a durable archive and lifetime counter remain complete. | [R]: trade 501 archived |
| 36 | Internal values use 18-decimal exact arithmetic; cash movements and output units use explicit 8-decimal conversion. Numeric config limits expand exponent notation. | [R]: fractional fees and small numeric limits |
| 37 | Paper risk, fills and engine ticks persist UTC-day rollover. Missing boundary valuation blocks additional risk when daily-loss protection is configured. | [R], [C]: stale baseline and overnight valuation gap |
| 38 | Paper discovery/data use mainnet. Trade arrays and BBO snapshots are handled; stale/reconnected books and data predating order placement cannot fill new orders. | [R], [B]: SDK shapes, independent BBO fill, stale placement data |
| 39 | Paper trading, engine, risk reads and reset share the actual paper state lock. A queued mutation rejects a changed session. | [R], [C], [B]: shared lock, reset contention and changed epoch |
| 40 | Position transitions settle funding on old exposure before opening, closing or reversing it. | [C]: time-weighted exposure across fills; simulator tests |
| 41 | Paper risk logs use the paper logs directory. | [B]: rejection appears only under `paper/logs` |
| 42 | Live loss history must be ordered, current, non-future and cover UTC midnight; missing evidence blocks additional risk. | [C]: stale/future/unordered/missing baseline cases |
| 43 | RPC limits connections, queued count/bytes and frame size; large mutations return durable receipts. Reads page results, and routine journal append uses tails/indexes/cached chain heads. | [U]: queue saturation, health ping, oversized accepted result; journal replay tests |
| 44 | Cleanup registers before acquisition, tracks partial subscriptions and closes transports on startup failure. Shutdown stops RPC admission before draining. | [C]: failed live/paper subscription startup; runner tests |

## Operational and compatibility notes

- Stop an older runner before upgrading. An alive but unresponsive owner is
  deliberately not replaced. Recovery requires establishing that the owning
  process exited; a timeout alone is insufficient evidence.
- Retain operation records and journal indexes with their journals. An uncertain
  order stays reserved until exchange lookup positively identifies its outcome.
  A missing or pruned upstream order is not proof that submission failed; the
  CLI does not automatically clear that reservation or send a new order.
- Defaults for events/audit are current account or paper session, 200 records,
  maximum 1,000 per page. Use `--all-scopes` for retained history and `--since`
  for the next sequence. Orders/positions use offset/limit. A paper reset starts
  a new session while retaining old journals and global sequence numbers.
- Pending paper/deposit outboxes replay on the next access. If publication is
  still failing, subsequent mutations stop before changing state. An error
  after a mutation can carry `outcome: "accepted"` and its result; oversized RPC
  results have a private `resultPath`. Do not retry these as rejected actions.
- Existing inconsistent safety files fail closed. Paper can be explicitly reset;
  custody/funding state requires restoring or reconciling the actual state.
  Legacy approvals with complete identity are pinned before environment overrides;
  incomplete approvals require init. Old unscoped history remains available via
  `--all-scopes`, without being attributed to the current account.
- File durability uses Node file fsync and POSIX directory fsync. Windows does not
  expose directory fsync through this API, so sudden-power-loss guarantees for
  directory entries are narrower there. Tests inject failures at the write
  boundaries; they are not a power-loss certification of a filesystem/device.
- Paper execution remains an approximation of exchange liquidity, queue priority,
  funding history and liquidation. Historical funding uses the last captured
  rates/marks; it does not reconstruct every missed exchange funding interval.
  Daily-loss checks fail closed when the UTC boundary cannot be valued.
- Funding without attributable destination hashes remains pending, including when
  Relay cannot link a regenerated request ID to the saved quote. No amount-only
  settlement fallback exists. Explicit abandon ends local tracking, not a transfer.

[R]: ../packages/agent-cli/test/invariant-regressions.test.ts
[C]: ../packages/agent-cli/test/invariant-recovery.test.ts
[U]: ../packages/agent-cli/test/invariant-runner-regressions.test.ts
[L]: ../packages/agent-cli/test/invariant-lock-regressions.test.ts
[M]: ../packages/agent-cli/test/invariant-mode.test.ts
[B]: ../packages/agent-cli/test/invariant-boundaries.test.ts
[F]: ../packages/agent-cli/test/invariant-files.test.ts
