# agent-cli

An agent-native Hyperliquid trading CLI with JSON input/output, a persistent
signing runner, Privy managed agents, Relay funding, and a packaged agent skill.

Install: `npm i -g @bloxwap/agent-cli` or `bunx @bloxwap/agent-cli --help`.
The requested Hyperliquid SDK declares Node **22.12+**; use that supported runtime
or current Bun. No postinstall script. Publishing is release-gated.

## Testnet quickstart

Create your own [Privy account and app](https://dashboard.privy.io/) first.
Use your app ID and secret on your machine or infrastructure you control.
Bloxwap does not provide a shared Privy app, receive these credentials, or operate
a hosted signing service. Keep the master wallet separate from the Privy agent.

```sh
npm ci
npm run build
node packages/agent-cli/dist/cli.js --help
node packages/agent-cli/dist/cli.js config set privyAppId YOUR_APP_ID
node packages/agent-cli/dist/cli.js config set privyAppSecretRef env:BLOXWAP_PRIVY_APP_SECRET
# Set your own app's BLOXWAP_PRIVY_APP_SECRET locally, outside the conversation.
node packages/agent-cli/dist/cli.js init --network testnet --master-address 0xYOUR_MASTER_ADDRESS
# Sign returned EIP-712 approval externally, then submit its 65-byte signature:
node packages/agent-cli/dist/cli.js init --network testnet --signature 0xYOUR_SIGNATURE
# Fund only with a supported test origin chain/token; inspect schema fund.
# Chain 42161 and the default origin token are mainnet values.
# Show QR/address and exact origin token/fees to user; complete any deposit steps.
node packages/agent-cli/dist/cli.js status --network testnet
# Continue only when active deposits report settled.
node packages/agent-cli/dist/cli.js run --network testnet --detach
node packages/agent-cli/dist/cli.js market --coin BTC
node packages/agent-cli/dist/cli.js order --json '{"coin":"BTC","side":"buy","size":"0.001","price":"20000","tif":"Gtc"}'
node packages/agent-cli/dist/cli.js events --follow
```

Testnet onboarding/trades require Privy sandbox credentials, an externally signed
testnet master approval and testnet collateral. Relay HyperCore testnet routes may
be unavailable; the e2e suite mocks Relay. The placeholders above must be replaced
with addresses/signatures from your test environment. Never paste a private key.

## Architecture and custody

```mermaid
flowchart LR
  Agent[Agent / CLI] -->|private JSON-RPC| Runner[Persistent runner]
  Runner -->|P-256 authorization| Privy[Agent in user's Privy app]
  Privy -->|EIP-712 signature| HL[Hyperliquid exchange]
  Agent --> Relay[Relay funding quote]
  Master[External master wallet] -->|one-time approvals| HL
  Runner --> Journal[Events / audit / logs]
```

You own the Privy account/app. Privy manages the separate agent wallet key in
that app; its P-256 authorization key stays on your machine or infrastructure.
Your master key stays in your external wallet. Bloxwap never receives or stores
these keys, your Privy app secret, or your authorization key on Bloxwap servers.
The CLI talks directly to Privy, Hyperliquid, and Relay. Hyperliquid agent
permissions prevent withdrawals from the master account. Privy policies restrict
the visible signing envelope; local checks enforce configured risk limits.
Read [custody limits](docs/custody.md) before using a funded account.

State: `~/.bloxwap`; config: `~/.bloxwap/config.json`; IPC:
`~/.bloxwap/run.sock`; env prefix: `BLOXWAP_`. All local state is private to the OS
user. The default Bloxwap builder address is
`0x71b09A08257078A4d642F7Dd7315e656c837329a`, with `f=10` (0.01%).
Override via `config set builder.address` / `config set builder.fee` or
`BLOXWAP_BUILDER_ADDRESS` / `BLOXWAP_BUILDER_FEE`; init requests builder approval.

## Development and docs

`npm run build`, `npm run lint`, `npm run typecheck`, `npm test` must pass before
committing. Unit tests mock services. `npm run test:sandbox` requires an explicit
opt-in and credentials for your own test app; missing prerequisites fail before
any request. `npm run test:e2e` is separately credential-gated. The master-key
testnet harness is CI-only; unit tests never access the network.

The npm workspace keeps the publishable CLI in `packages/agent-cli` and the
Fumadocs app in `apps/docs`. Use Node.js **24+** for repository development.
The published CLI still supports Node.js **22.12+**.

```sh
npm ci
npm run docs:dev       # http://localhost:3903/
npm run docs:build     # static export at apps/docs/out
npm run docs:check
npm run docs:preview   # previews the export at port 3903
npm run pack:cli       # packs only @bloxwap/agent-cli
```

The site defaults to the host root; the docs are under `/docs/`. Pages CI sets
`NEXT_PUBLIC_BASE_PATH=/agent-cli` for its deployment, builds and checks pull
requests, and deploys main. Command schemas and the skill guide are generated
from the CLI with `npm run docs:generate` and before docs builds.

[Docs index](docs/index.md), [security](docs/security.md),
[error catalog](docs/errors.md), and [SKILL.md](packages/agent-cli/SKILL.md) remain
available as repository Markdown. See [docs app README](apps/docs/README.md).
