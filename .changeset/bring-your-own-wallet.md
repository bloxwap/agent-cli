---
'@bloxwap/agent-cli': minor
---

Bring your own wallet: the managed Privy signer is removed and every agent is a
user-provided EOA key referenced by `eoaKeyRef`.

- Removed `signerType`, the Privy config fields, `BLOXWAP_PRIVY_APP_ID`,
  `BLOXWAP_SIGNER_TYPE`, the bundled Privy policy, `init`'s `signerType` and
  `policyId` outputs and `status.policy`. `@privy-io/node` is no longer a dependency.
- Configs written for Privy still load. An agent approved through Privy can no
  longer sign: run `rotate --eoa-key-ref env:NEW_EOA_KEY` or `revoke`.
- Fixed the EOA signer exposing raw viem signing methods, which let signatures
  skip the Agent-envelope check and the signature audit record.
