# Implementation progress

| Issue | State | Notes |
| --- | --- | --- |
| #1 | done | Strict TypeScript ESM scaffold, bundled CLI, Vitest smoke test and CI checks. |

| #2 | done | ADR selects private newline-framed JSON-RPC socket; defines methods and Windows strategy. |
| #3 | done | Stable error catalog, serialization, exit codes and append-only guard. |
| #4 | done | Validated JSON/flags/stdin router, JSON schemas, envelopes and exit codes. |
| #5 | done | Versioned validated config, atomic private writes, migration, commands and env overrides. |
| #6 | done | JSON logging, recursive redaction, correlation IDs and size/day rotation. |
| #7 | done | Requested SDK adapter, lazy WS factory, cached metadata, decimal rounding and remote signer abstraction. SDK requires Node 22.12+; runtime smoke checked on Node 20. |
| #8 | done | Service error adapters, redacted upstream detail, fixture-driven classification and retry defaults. |
| #9 | done | Bounded jittered retries and per-signer persisted monotonic nonces guarded by exclusive locks. Stale locks fail closed. |
| #10 | done | Privy server SDK create/link, P-256 owner, private authorization storage and typed-data signer; sandbox test env-gated. |
| #11 | partial | Versioned domain/network Privy policy and local trade allowlist; L1 action hash prevents Privy per-action/notional inspection. Exchange agent permissions enforce withdrawal boundary. |
| #12 | done | Idempotent managed-wallet onboarding, persisted external master EIP-712 approvals/deeplink, expiry bound, agent/builder verification and master-key rejection. |
| #13 | partial | Builder attachment helper checks approved maximum; fee reporting. No official builder address/rate supplied in specs, so default is zero fee until configured. |
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
| #26 | done | Private exclusive PID lock, managed signer session, foreground/detach, idempotency and graceful shutdown; persistent stores survive restart. Stale locks fail closed. |
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
| #37 | partial | Validated self-contained skill with every command example, ordered funding/custody flow and complete error table; real agent testnet execution requires credentials (#39 gate). |
| #38 | done | Install/testnet README, custody architecture, schema-generated command reference and static docs site with gated Pages workflow. |
| #39 | partial | Full mocked CLI/SDK/RPC lifecycle passes; opt-in real testnet lifecycle with mocked Relay, nightly secrets gate and journal artifacts. Real execution skipped without credentials. |
| #40 | partial | Postinstall-free executable package, supported Node 22.12+ engine and global/Bun install smoke pass locally; macOS/Linux CI and optional compiled binaries. Registry install awaits publication. |
| #41 | partial | Changesets/version PR workflow, gated tag publish with npm provenance, generated release notes and binary/skill assets; publishing not run without registry credentials. |
