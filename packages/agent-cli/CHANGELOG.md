# @bloxwap/agent-cli

## 0.5.0

### Minor Changes

- d3f66de: Bring your own wallet: the managed Privy signer is removed and every agent is a
  user-provided EOA key referenced by `eoaKeyRef`.

  - Removed `signerType`, the Privy config fields, `BLOXWAP_PRIVY_APP_ID`,
    `BLOXWAP_SIGNER_TYPE`, the bundled Privy policy, `init`'s `signerType` and
    `policyId` outputs and `status.policy`. `@privy-io/node` is no longer a dependency.
  - Configs written for Privy still load. An agent approved through Privy can no
    longer sign: run `rotate --eoa-key-ref env:NEW_EOA_KEY` or `revoke`.
  - Fixed the EOA signer exposing raw viem signing methods, which let signatures
    skip the Agent-envelope check and the signature audit record.

## 0.4.1

### Patch Changes

- Release-process only: publish from GitHub Actions through npm trusted publishing (OIDC) with provenance,
  validating the `@bloxwap/agent-cli` trusted publisher for `release.yml` in the `npm-release` environment.
  No CLI behavior changes.

## 0.4.0

### Minor Changes

- Enforce trading, funding, and durability invariants: fail closed on retried orders, effective
  leverage, serialized risk checks, mode and network pins, rotation merges, fresh approvals, quote
  decimals, deposit terminals, locked deposits, agent error codes, exactly-once fills, journal
  repair, stale locks, runner liveness, and exact fill linkage.

### Patch Changes

- Publish file locks atomically so concurrent nonce updates stay unique. Missing locks are retried
  instead of stolen, and the lock file is linked into place only after its record is complete.

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
