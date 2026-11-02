# Custody boundary

Each user owns their settings and chooses a **Privy wallet or dedicated EOA** as
the separate Hyperliquid trading agent. The package ships no sample wallet,
credentials, shared Privy app, credential proxy, or hosted Bloxwap signer.
Do not send credentials or wallet keys to Bloxwap, an AI conversation, repository,
issue, support message, or CLI input.

For Privy, create and control your own [account/app](https://dashboard.privy.io/).
Set its ID and a local environment reference to its secret. Privy manages the
agent key; the CLI generates its P-256 owner authorization key locally and only
registers the public key. For an EOA, generate a dedicated agent key yourself and
set `signerType=eoa` plus `eoaKeyRef` to an `env:` or mode-0600 `file:` reference.
The CLI derives only the public agent address for config. Never use the master EOA
as the agent. Local EOA signing has no remote Privy policy; the same local typed-data
restrictions, risk checks, audit and Hyperliquid agent permissions still apply.

The master wallet stays external and approves that separate agent. Bloxwap never
receives or stores the master key, agent key, app secret, or authorization key on
its infrastructure. Run the CLI/runner on your machine or infrastructure you control.
Privy's authorization model is described in its
[wallet controls documentation](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls).

For Privy signers, `init` creates the versioned policy in
`packages/agent-cli/policies/agent-trade-only.json`, stores its ID and CLI policy
version, and attaches it when creating or linking the agent wallet. Re-running
`init` verifies the remote policy rules against the configured network, replaces
outdated/different rules, and confirms attachment. Updating an already owned wallet
uses your existing local owner authorization key; the app secret alone is not
permission to replace its owner. An owned wallet cannot be linked without that key.
`status` reports the configured policy ID/version; it does not fetch and attest
the remote policy on every read. EOA agents report a null policy ID.

The Privy policy allows only typed-data requests matching chain 1337, the zero
verifying contract and the Agent schema's network source (`a` mainnet, `b` testnet).
It explicitly denies agent private-key/seed export; unmatched methods are denied
by [Privy's default policy behavior](https://docs.privy.io/controls/policies/overview).
The local signer additionally requires the exact `Exchange`/`1` domain, Agent
fields and a 32-byte connection ID. User-signed withdrawals, transfers and agent
approvals have a different type/domain and are refused locally. The CLI dispatch
allowlist refuses withdrawal/transfer/approval actions before signing. Hyperliquid
API-agent permissions supply the master-account withdrawal boundary.

Privy sees the L1 action hash, not its preimage: it cannot independently distinguish
an order from another L1 action or enforce notional limits inside that hash.
Local limits and exchange agent permissions supply those checks. Do not describe
this policy as independent server-side per-action/notional enforcement. Passing
the local Agent-envelope check also does not prove that a hash contains an order.
Privy's [Hyperliquid guide](https://docs.privy.io/recipes/hyperliquid/policies-and-offline-actions)
distinguishes user-signed actions from L1 agent actions.

`npm run test:sandbox` needs `BLOXWAP_PRIVY_SANDBOX=1`, `BLOXWAP_PRIVY_APP_ID`
and `BLOXWAP_PRIVY_APP_SECRET` from your dedicated test app. It creates an empty
wallet and policy in that app, signs a valid testnet Agent envelope, then directly
requests a withdrawal-type signature and expects `POLICY_REJECTED`. It sends no
transaction to Hyperliquid and needs no master key or funds. The wallet and policy
remain visible in your Privy app for inspection; never reuse that test wallet for
funds. Without those credentials the explicit sandbox command fails its preflight.
Unit tests alone are not evidence of a live Privy rejection.
