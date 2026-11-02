# @bloxwap/agent-cli

## 0.3.0

### Minor Changes

- Support user-owned EOA trading agents (`signerType: eoa` with a local `eoaKeyRef`)
  alongside user-owned Privy apps. The default Bloxwap builder fee is now zero, with
  optional non-zero overrides, and the default BLOXWAP referral is applied after
  agent approval when the account has none. Testnet approval errors now keep the
  action and upstream rejection, and preflight requires a positive test USDC balance.

## 0.2.0

### Minor Changes

- a04a6c7: Add managed Hyperliquid agents, Relay funding, JSON commands, a persistent runner,
  risk checks, durable events/audit journals, and the packaged trading skill.

### Patch Changes

- db928e2: Ship license, changelog and repository metadata with the CLI. Verify script-free
  global npm installs and installed bunx execution on macOS/Linux and Node 22.12/24.

## 0.1.0

Initial implementation of managed-agent trading, funding and persistent runner.
Use Changesets for subsequent versioning and release notes.
