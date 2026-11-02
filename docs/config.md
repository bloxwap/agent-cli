# Configuration

Default path: `~/.bloxwap/config.json`. `--config` selects another file.
All command JSON objects reject unknown fields to catch intent-changing typos.
Version 1 is validated on read and write; versionless config migrates to version 1.
Unknown versions fail closed. Writes use a private temporary file and atomic rename.

`BLOXWAP_NETWORK`, `BLOXWAP_MODE`, `BLOXWAP_LOG_LEVEL`, `BLOXWAP_PRIVY_APP_ID` and
`BLOXWAP_MASTER_ADDRESS` override stored values in commands. `config get` shows
persisted values; `config validate` validates them without overrides.
Secrets use `env:BLOXWAP_PRIVY_APP_SECRET` and `env:BLOXWAP_AUTHORIZATION_KEY`
references; authorization keys may also use `file:/absolute/private/path`.
No wallet or credentials are bundled. Set `signerType` to `privy` (default) or
`eoa`. EOA agents use `eoaKeyRef`, for example `env:BLOXWAP_EOA_KEY` or a private
`file:` reference. The referenced key must belong to a dedicated agent EOA, never
the master wallet. Raw keys are forbidden in CLI input and are never stored in config.
`BLOXWAP_SIGNER_TYPE` overrides the stored signer selection.

`mode` is `live` (default) or `paper`. Paper mode simulates orders against real
mainnet Hyperliquid public market data and never signs or submits; see
[paper trading](paper.md). `config set mode paper` enters paper mode, and
`config set mode live --yes` is the explicit confirmation to go back. The paper
starting virtual balance is `paper.startingBalance` (default 10000), also
settable via `paper reset --balance N --yes`.

The default builder address is `0x71b09A08257078A4d642F7Dd7315e656c837329a`
(Bloxwap), with `builder.fee:0`: no builder fee is charged and orders omit the
builder field. Hyperliquid uses tenths of a basis point for optional overrides
(`f=10` = 1 bp = **0.01%**). Configure `builder.address` and `builder.fee`, or
`BLOXWAP_BUILDER_ADDRESS` and `BLOXWAP_BUILDER_FEE`; fees must be integers from
0 to 100. For a non-zero fee, `init` requests an external master-wallet
`approveBuilderFee` signature and each order checks the approved maximum before
attaching `{b,f}`. Fund and order JSON expose `builderAddress` and
`builderFeeRate` (`"0%"` by default). Funding reports the trading builder rate
separately from Relay fees.

`referralCode` defaults to `BLOXWAP`. Override it with `config set referralCode
CODE` or `BLOXWAP_REFERRAL_CODE`. After agent approval, `init` submits Hyperliquid's
`setReferrer` action when the master account has no referral. This provides the
exchange's referral fee discount without adding a Bloxwap builder fee. Existing
referrals are left unchanged; re-run `init` on an approved account to apply the
configured code.
