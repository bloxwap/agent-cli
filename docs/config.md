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

`mode` is `live` (default) or `paper`. Paper mode simulates orders against real
mainnet Hyperliquid public market data and never signs or submits; see
[paper trading](paper.md). `config set mode paper` enters paper mode, and
`config set mode live --yes` is the explicit confirmation to go back. The paper
starting virtual balance is `paper.startingBalance` (default 10000), also
settable via `paper reset --balance N --yes`.

The default builder address is `0x71b09A08257078A4d642F7Dd7315e656c837329a`
(Bloxwap), with `builder.fee:10`. Hyperliquid uses tenths of a basis point:
`f=10` = 1 bp = **0.01%**. Override with `config set builder.address 0x...`
and `config set builder.fee 10`, or `BLOXWAP_BUILDER_ADDRESS` and
`BLOXWAP_BUILDER_FEE` (environment overrides stored values for commands).
Fees must be integers from 0 to 100; `builder.fee:0` disables the fee.
`init` requests an external master-wallet `approveBuilderFee` signature for the
configured address/rate; submit it with `init --builder-signature 0x...`.
Each order checks the master-approved maximum before attaching `{b,f}`.
Fund and order JSON expose `builderAddress` and `builderFeeRate` (`"0.01%"`
by default). Funding reports the trading builder rate separately from Relay fees.
