# Funding and signatures

Run `fund --amount 10 --origin-chain 42161` and show the returned QR/address to the
user. Inspect the origin token, minimum, fees and quote expiry before sending.
Amounts are decimal strings; HyperCore perps amounts use 8 decimals, EVM USDC 6.

Some routes return two master-wallet signatures: a Relay nonce/deposit mapping
and a Hyperliquid deposit authorization. The exact payloads come from the quote;
never synthesize them or sign them using the trade-only agent. `fund` emits
`signatureSteps` with payloads and `requiresSignature`. Query `deposit --deposit-id ID`
to resume; submit each in order with `--step-id ID --signature 0x...`. A durable claim is recorded before each submission; completed steps are then
persisted. Concurrent callers cannot post the same step twice. Relay signature submission keeps the quoted
POST body intact and adds the signature as a query parameter, per the
[step execution contract](https://docs.relay.link/references/api/api_core_concepts/step-execution). Completed flows return their existing state. If a submission outcome is unknown,
the CLI checks the quoted status endpoint and refuses another POST until success
is positively reconciled. Terminal deposits and expired unstarted quotes reject
new signatures.

Poll `status` until the deposit is settled. Settlement requires Relay success and
a destination transaction hash that identifies a sufficient Hyperliquid ledger
credit for the selected account. An unrelated balance increase cannot settle a
deposit, and one ledger credit cannot be assigned to multiple deposits.

Started transfers remain pending through unavailable or retriable failure status.
Only never-started quotes expire automatically, after a 15-minute grace. Relay
refund is terminal. Missing destination hashes or a regenerated request ID without
an attributable transfer stay pending; `deposit --abandon` explicitly stops local
tracking and does not cancel or reverse a transfer. These choices follow the
[Relay status contract](https://docs.relay.link/references/api/get-intents-status-v3).

Every fresh or reused quote is checked against the complete origin/destination,
amount, units, recipient and expiry. When Relay supplies no expiry, the CLI assigns
a 30-second local quote TTL once. Persisted quotes are never refreshed just by
reading them. Testnet uses Relay's
testnet API and may require a mocked quote if that route is unavailable.
