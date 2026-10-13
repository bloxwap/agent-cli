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
