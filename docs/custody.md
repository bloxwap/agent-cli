# Custody boundary

Each user owns their settings and brings their own wallet: a **dedicated EOA**
is the separate Hyperliquid trading agent. The package ships no sample wallet,
credentials, credential proxy, or hosted Bloxwap signer.
Do not send credentials or wallet keys to Bloxwap, an AI conversation, repository,
issue, support message, or CLI input.

Generate a dedicated agent key yourself and set `eoaKeyRef` to an `env:` or
mode-0600 `file:` reference. The CLI derives only the public agent address for
config and reads the key through that reference when it signs. Never use the
master EOA as the agent. `init` refuses a key that resolves to the master address,
and an approved agent key can only be replaced through `rotate`.

The master wallet stays external and approves that separate agent. Bloxwap never
receives or stores the master key or agent key on its infrastructure. Run the
CLI/runner on your machine or infrastructure you control.

The local signer exposes one operation: typed-data signing of the Hyperliquid L1
Agent envelope. It requires the exact `Exchange`/`1` domain on chain 1337 with the
zero verifying contract, the Agent fields, the configured network source (`a`
mainnet, `b` testnet) and a 32-byte connection ID. User-signed withdrawals,
transfers and agent approvals have a different type/domain and are refused
locally. The CLI dispatch allowlist refuses withdrawal/transfer/approval actions
before signing. Hyperliquid API-agent permissions supply the master-account
withdrawal boundary.

The Agent envelope carries the L1 action hash, not its preimage: the envelope
check cannot distinguish an order from another L1 action or enforce notional
limits inside that hash. Local limits and exchange agent permissions supply those
checks. There is no remote signing policy and no independent server-side
per-action/notional enforcement. Anyone who can read the agent key can sign as
the agent within Hyperliquid's agent permissions, so protect the reference
target, keep expiry short, and `rotate` or `revoke` after suspected exposure.
