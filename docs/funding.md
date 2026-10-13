# Funding and signatures

Run `fund --amount 10 --origin-chain 42161` and show the returned QR/address to the
user. Inspect the origin token, minimum, fees and quote expiry before sending.
Amounts are decimal strings; HyperCore perps amounts use 8 decimals, EVM USDC 6.

Some routes return two master-wallet signatures: a Relay nonce/deposit mapping
and a Hyperliquid deposit authorization. The exact payloads come from the quote;
never synthesize them or sign them using the trade-only agent. `fund` emits
`signatureSteps` with payloads and `requiresSignature`. Query `deposit --deposit-id ID`
to resume; submit each in order with `--step-id ID --signature 0x...`. Completed
steps are persisted immediately. Relay signature submission keeps the quoted
POST body intact and adds the signature as a query parameter, per the
[step execution contract](https://docs.relay.link/references/api/api_core_concepts/step-execution). Retrying a completed flow is harmless.

Poll `status` until the deposit is settled; a bridge status alone is insufficient
without the corresponding Hyperliquid balance increase. Testnet uses Relay's
testnet API and may require a mocked quote if that route is unavailable.
