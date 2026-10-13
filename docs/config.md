# Configuration

Default path: `~/.bloxwap/config.json`. `--config` selects another file.
Version 1 is validated on read and write; versionless config migrates to version 1.
Unknown versions fail closed. Writes use a private temporary file and atomic rename.

`BLOXWAP_NETWORK`, `BLOXWAP_LOG_LEVEL`, `BLOXWAP_PRIVY_APP_ID` and
`BLOXWAP_MASTER_ADDRESS` override stored values in commands. `config get` shows
persisted values; `config validate` validates them without overrides.
Secrets use `env:BLOXWAP_PRIVY_APP_SECRET` and `env:BLOXWAP_AUTHORIZATION_KEY`
references; authorization keys may also use `file:/absolute/private/path`.

Builder fees use tenths of a basis point (`fee:10` means 0.01%). Set
`builder.address` and `builder.fee`; each order verifies the master approved maximum.
The specs do not supply a Bloxwap builder address/fee schedule, so defaults disable
fees (`fee:0`, no address) instead of inventing a fee recipient. Deployments must
configure the official recipient before enabling builder fees.
