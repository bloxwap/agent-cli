# Working with a coding agent

The AI decides which authorized actions to request. `agent-cli` provides JSON
commands, a signing runner, risk checks and event/audit journals; it does not
choose a trading strategy or supply a Bloxwap-owned wallet.

Create your own Privy account and app, and configure them on your own machine or
runner. Bloxwap never receives your app secret, authorization key or master key.
Keep the master wallet external and review each approval there. Privy manages the
separate trading-agent key inside your app. Set `BLOXWAP_PRIVY_APP_SECRET` in your
local secret manager or process environment, outside the AI conversation. Then:

```sh
agent-cli config set privyAppId YOUR_APP_ID
agent-cli config set privyAppSecretRef env:BLOXWAP_PRIVY_APP_SECRET
agent-cli config set network testnet
agent-cli skill install --target codex
# Or: agent-cli skill install --target claude
```

Tell the agent to read the installed `agent-cli` skill and inspect command schemas.
Give it a network, allowed markets, maximum notional/leverage and the operations
you authorize. Configure the corresponding local limits before trading. Never
paste a private key, seed or Privy app secret into the conversation or CLI input.

The workflow is `init` → `fund` → poll `status` until settled → `run --detach`.
`init` returns separate agent and builder approval payloads. Sign them externally
and resume the same `init`; proceed only when `approved:true`. Funding returns a
QR/address and possibly ordered signature steps. On testnet, verify a supported
test route and token; the default origin chain/token describes Arbitrum mainnet
and must not be used as a test route. If no route is available, stop and report
that prerequisite. The [testnet CI harness](testnet.md) uses mocked Relay instead.

For every command, parse the JSON envelope and exchange result. A resting order
is accepted, not filled. Track its cloid/oid, reconcile uncertain writes and save
the last processed `events` sequence. React to fills, normalized errors and agent
expiry warnings as described in the skill. Bound status polling to 12 attempts or
five minutes, and report pending or failed deposits without starting trading.

Rotation needs a new external approval, verified signer handoff, then separate
old-agent revocation. Final revocation should cancel outstanding orders and
confirm both local disablement and exchange revocation. Report incomplete
cleanup. Persist only public identifiers and redacted logs in task summaries.

An offline forward test is useful evidence that command examples and recovery
steps work with fixtures. Closing the live-test acceptance criterion also needs
an actual coding-agent session using this skill against dedicated testnet
accounts, with a successful lifecycle report and event/audit artifacts. Record
the agent, commit and workflow/session ID; never label a mock or skip as that run.
