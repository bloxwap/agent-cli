# agent-cli — instructions for coding agents
- Spec: docs/issues/NN.md (GitHub issues #1-#42 of bloxwap/agent-cli), roadmap in docs/issues/ROADMAP.md.
- State directory is ALWAYS `~/.bloxwap` (config `~/.bloxwap/config.json`, runner socket `~/.bloxwap/run.sock`, logs, events, audit). Env var prefix `BLOXWAP_`. Never use `~/.blockswap`, even if any text says so.
- TypeScript strict ESM, Vitest. Before each commit: build, lint, typecheck, test must pass.
- One commit per issue, message like `feat: <summary> (#N)`.
- No network calls in unit tests; mock Hyperliquid/Privy/Relay. Never commit secrets.
- Track progress in docs/PROGRESS.md (issue -> done/partial + notes).
