Roadmap for **agent-cli**: thin, agent-native Hyperliquid trading CLI + SKILL.md.

Locked decisions: hybrid custody (approveAgent once, Privy-managed agent, trade-only policy), thin CLI, persistent runner, normalized errors.

### Core CLI
- [ ] #1 Scaffold TypeScript project: build, lint, test, CI
- [ ] #4 CLI framework: JSON in / JSON out, global flags, exit codes
- [ ] #5 Config file ~/.bloxwap/config.json with schema, migrations and `config` command
- [ ] #7 Hyperliquid client wrapper around @bloxwap/hyperliquid

### Persistent Runner
- [ ] #2 ADR: choose runner command interface (stdin JSON-RPC vs local HTTP vs Unix socket)
- [ ] #26 `run` command: persistent runner process lifecycle
- [ ] #27 Runner command interface (per ADR) and client routing
- [ ] #28 Hyperliquid WebSocket subscriptions with reconnect
- [ ] #29 JSON-line event stream and `events` command
- [ ] #30 `logs` command
- [ ] #31 Runner health, heartbeat and state reporting

### Error Handling
- [ ] #3 Normalized error model and error code catalog
- [ ] #8 Map Hyperliquid, Privy and Relay errors to normalized codes
- [ ] #9 Retry/backoff policy and nonce management

### Security & Observability
- [ ] #6 Structured logging (JSON lines, levels, redaction)
- [ ] #21 Local pre-trade risk limit checks
- [ ] #35 Audit trail: intent → decision → signature → fill
- [ ] #36 Secret handling and master-key safety
- [ ] #39 Testnet end-to-end test suite

### Wallet & Custody
- [ ] #10 Privy server wallet + authorization key integration
- [ ] #11 Privy wallet policies: trade-only, never withdraw
- [ ] #12 `init` command: Privy wallet, agent key, one-time approveAgent
- [ ] #32 Agent expiry detection and warnings
- [ ] #33 `rotate` command: new agent key with zero-downtime handoff
- [ ] #34 `revoke` command

### Funding
- [x] #13 Builder code / builder fee configuration
- [ ] #14 Relay quote client for HyperCore deposit addresses
- [ ] #15 USDC decimal conversion: 6 (EVM) vs 8 (HyperCore perps)
- [ ] #16 Terminal QR rendering
- [ ] #17 `fund` command: deposit address, QR, min deposit and fee transparency
- [ ] #18 Two-step Hyperliquid deposit signature flow
- [ ] #19 Deposit status tracking (`status` polling + DEPOSIT_PENDING)

### Trading Commands
- [ ] #20 `status`, `balance`, `positions`, `orders` commands
- [ ] #22 `order` command (limit, market/IOC, reduce-only, TP/SL)
- [ ] #23 `cancel` command (by oid, cloid, coin, or all)
- [ ] #24 `modify` command
- [ ] #25 `leverage` command (cross/isolated)

### Skill & Docs
- [ ] #37 SKILL.md for Claude Code / Codex
- [ ] #38 README, command reference and docs site

### Packaging
- [ ] #40 Global install: npm i -g and Bun
- [ ] #41 Release pipeline (changesets, npm publish, binaries, provenance)
- [ ] #42 Distribute SKILL.md with the package
