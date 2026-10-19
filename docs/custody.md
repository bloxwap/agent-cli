# Custody boundary

Each user creates and controls their own [Privy account/app](https://dashboard.privy.io/).
Set that app's ID and a local environment reference to its secret. There is no
shared Bloxwap Privy account, credential proxy, or hosted Bloxwap signer.
Do not send Privy credentials or wallet keys to Bloxwap, an AI conversation,
repository, issue, or support message.

Each user brings their own master wallet. It stays external and approves a separate Hyperliquid API agent.
Privy manages the agent wallet key in the user's app; the CLI generates its
P-256 owner authorization key locally. Only the public authorization key is
registered with Privy. The private authorization key remains in a private local
file or user-controlled environment reference. Bloxwap never receives or stores
the master key, agent key, app secret, or authorization key on its infrastructure.
Run the CLI/runner on your machine or infrastructure you control. The CLI calls
Privy directly with your app credentials. Privy's authorization model is described
in its [wallet controls documentation](https://docs.privy.io/security/wallet-infrastructure/policy-and-controls).

`init` creates the versioned policy in `packages/agent-cli/policies/agent-trade-only.json`,
stores its ID and CLI policy version, and attaches it when creating or linking
the agent wallet. Re-running `init` verifies the remote policy rules against the
configured network, replaces outdated/different rules, and confirms attachment.
Updating an already owned wallet uses your existing local owner authorization
key; the app secret alone is not treated as permission to replace its owner.
An owned wallet cannot be linked without that key. Never link the master wallet
as the agent. `status` reports the configured policy ID/version; it does not fetch
and attest the remote policy on every read.

The Privy policy allows only typed-data requests matching chain 1337, the zero
verifying contract and the Agent schema's network source (`a` mainnet, `b` testnet).
Agent private-key/seed export and all other unmatched methods are denied by
[Privy's default policy behavior](https://docs.privy.io/controls/policies/overview).
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
