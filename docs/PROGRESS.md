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
