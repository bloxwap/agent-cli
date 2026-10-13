---
name: agent-cli
description: Operate the agent-cli Hyperliquid trading CLI, including managed-agent onboarding, funding, orders, event monitoring, rotation, and normalized error recovery.
metadata:
  version: "0.1.0"
---

Use `agent-cli` for the user's authorized Hyperliquid account operations. Obtain
command schemas with `agent-cli schema COMMAND`; arguments can be flags or
`--json '{...}'`, or a JSON object on stdin. Ordinary commands print exactly one
JSON object: `{ok:true,data}` or `{ok:false,code,message,retryable,details}`.
Logs/QR appear on stderr. `events --follow` and `logs` explicitly stream JSON lines.
Use `--network testnet` during testing; never silently change to mainnet.

## Onboarding sequence

1. Configure Privy app ID and secret reference, e.g. `config set privyAppId APP`
   and `config set privyAppSecretRef env:BLOXWAP_PRIVY_APP_SECRET`. The user sets
   the environment secret outside the conversation. Configure published builder
   address/fee if applicable; unset defaults charge no builder fee.
2. Run `init --master-address 0x... --network testnet`. Show the returned approval
   payload/deeplink/QR. The user signs in their master wallet; submit only the
   resulting signature with `init --signature 0x...`. Submit builder approval
   separately if requested. Continue only after `approved:true`.
3. Run `fund --amount 10 --origin-chain 42161`. Show `qrAscii`/deposit address,
   origin chain/token, minimum, fees, expected received amount and expiry. The user
   transfers the quoted origin token. If `signatureSteps` require signatures,
   show the exact payload and submit each via `deposit` in returned order.
4. Poll `status` with bounded backoff until each active deposit is `settled`.
   Settlement requires Relay success and Hyperliquid balance receipt. Stop on
   failed/refunded deposits and explain their status. Do not place orders while
   any deposit is awaiting funds or pending.
5. Run `run --detach`, then monitor `events --follow --since SEQ`. Persist the
   last handled sequence; replay after reconnect. A fill updates the trading
   plan, an error follows the catalog below, and expiry warnings prompt rotation
   using external master-wallet approval.

## Commands and example envelopes

Examples show representative `data`, not live balances or service promises.
Full inputs/outputs are discoverable with `schema`; amounts/prices are strings.

| Input | Example output |
| --- | --- |
| `--help` | `{"ok":true,"data":{"commands":[{"name":"status","description":"Read account status"}],"globalFlags":["--json","--config","--network","--pretty"]}}` |
| `schema order` | `{"ok":true,"data":{"input":{"type":"object"},"output":{"oneOf":[]}}}` (actual schemas include properties) |
| `config get network` | `{"ok":true,"data":"testnet"}` |
| `config set limits.maxLeverage 5` | `{"ok":true,"data":{"version":1,"limits":{"maxLeverage":5}}}` |
| `config validate` | `{"ok":true,"data":{"valid":true,"version":1}}` |
| `init --master-address 0x...` | `{"ok":true,"data":{"approved":false,"requiresSignature":true,"approvals":{"agent":{"typedData":{}}},"qrAscii":"..."}}` |
| `fund --amount 10 --no-qr` | `{"ok":true,"data":{"depositId":"...","depositAddress":"0x...","expectedReceived":"100000000","builderFeeRate":"0%","state":"awaiting_funds","qrAscii":null}}` |
| `deposit --deposit-id ID` | `{"ok":true,"data":{"depositId":"ID","steps":[{"id":"step:0","requiresSignature":true,"payload":{}}]}}` |
| `deposit --deposit-id ID --step-id step:0 --signature 0x...` | `{"ok":true,"data":{"depositId":"ID","steps":[]}}` |
| `status` | `{"ok":true,"data":{"balance":{"accountValue":"100"},"agent":{"approved":true,"daysRemaining":"179"},"deposits":[],"policy":{"id":"...","version":"1"},"runner":{"pid":"123"}}}` |
| `balance` | `{"ok":true,"data":{"accountValue":"100","accountValueUnits":"10000000000","withdrawable":"96","marginUsed":"4"}}` |
| `positions` | `{"ok":true,"data":[{"coin":"BTC","size":"0.001","entryPrice":"20000","leverage":"5","marginMode":"cross"}]}` |
| `orders` | `{"ok":true,"data":[{"coin":"BTC","oid":"123","sz":"0.001","limitPx":"20000","side":"B"}]}` |
| `order --json '{"coin":"BTC","side":"buy","size":"0.001","price":"20000","tif":"Gtc","cloid":"0x11111111111111111111111111111111"}'` | `{"ok":true,"data":{"result":{"status":"ok","response":{"data":{"statuses":[{"resting":{"oid":123}}]}}},"builderFeeRate":"0%","cloid":"0x..."}}` |
| `order --json '{"coin":"BTC","side":"sell","size":"0.001","type":"market","slippage":0.01,"reduceOnly":true}'` | `{"ok":true,"data":{"result":{"status":"ok","response":{"data":{"statuses":[{"filled":{"oid":123}}]}}}}}` |
| `cancel --oid 123` or `cancel --all` | `{"ok":true,"data":{"cancelled":["123"],"result":{"status":"ok"}}}` |
| `modify --json '{"modifications":[{"oid":123,"price":"20100","size":"0.001"}]}'` | `{"ok":true,"data":{"status":"ok"}}` |
| `leverage --coin BTC --leverage 5 --mode isolated` | `{"ok":true,"data":{"status":"ok"}}` |
| `run --detach` | `{"ok":true,"data":{"pid":123,"startedAt":1700000000000,"network":"testnet"}}` |
| `events --since 12 --types '["fill"]'` | `{"ok":true,"data":[{"seq":13,"timestamp":"2026-01-01T00:00:00.000Z","type":"fill","data":{"tid":1}}]}` |
| `events --follow` | `{"seq":13,"timestamp":"2026-01-01T00:00:00.000Z","type":"fill","data":{"tid":1}}` (one line per event) |
| `logs --follow --level warn` | `{"level":"warn","requestId":"...","message":"Risk rejected","time":"..."}` (JSON lines) |
| `rotate` then `rotate --signature 0x...` | `{"ok":true,"data":{"oldAgent":"0x...","newAgent":"0x...","swapped":true,"oldRevoked":false,"revokeApproval":{}}}` |
| `rotate --revoke-signature 0x...` | `{"ok":true,"data":{"swapped":true,"oldRevoked":true}}` |
| `revoke --cancel-orders` | `{"ok":true,"data":{"locallyRevoked":true,"exchangeRevoked":false,"requiresSignature":true,"approval":{}}}` |
| `revoke --signature 0x...` | `{"ok":true,"data":{"locallyRevoked":true,"exchangeRevoked":true}}` |
| `audit --intent ID` | `{"ok":true,"data":[{"intentId":"ID","stage":"decision","data":{"allowed":true},"previousHash":"...","hash":"..."}]}` |
| `skill install --target codex` | `{"ok":true,"data":{"target":"codex","path":".../agent-cli/SKILL.md","version":"0.1.0"}}` |

Use `--intent-id ID --intent "reason"` on trading actions to connect the user's
reasoning to the audit. Keep cloid stable when retrying a known order intent.
For TP/SL use `type:"tp"|"sl"` and `triggerPrice` with size/price/reduceOnly;
market orders use an explicit slippage-bounded IOC, not an unbounded market order.

## Error recovery

| Code | Action |
| --- | --- |
| RATE_LIMIT, NETWORK_ERROR | Bounded exponential backoff; stop after configured attempts |
| NONCE_COLLISION | Retry using a newly issued nonce; inspect a stale lock if persistent |
| DEPOSIT_PENDING | Poll status until settled; stop on terminal funding failure |
| RUNNER_NOT_RUNNING | Start runner or use configured direct fallback |
| INSUFFICIENT_MARGIN | Reduce exposure or request authorized funding |
| POLICY_REJECTED | Stop and revise intent within limits; do not bypass policy |
| AGENT_EXPIRED | Rotate with master-wallet approval |
| AGENT_NOT_APPROVED | Complete init/approval or explain revocation |
| INVALID_SIZE, INVALID_PRICE | Correct input using market precision |
| UNKNOWN_MARKET | Refresh metadata; use an allowed market |
| ORDER_NOT_FOUND | Refresh orders before changing intent |
| CONFIG_INVALID | Correct configuration/input; never insert secrets |
| UPSTREAM_ERROR, INTERNAL | Stop, inspect redacted details/logs and report failure |

## Gotchas

HyperCore perps USDC uses **8 decimals**; EVM USDC uses **6**. Preserve strings and
bigints. Some deposits require **two distinct signatures**; resume stored steps
rather than restarting the route. Agent expiry is at most **180 days**. Never
ask for, paste, log or import a master private key or seed. The managed agent is
trade-only; local limits include markets, size/notional, leverage, daily loss and
open orders. Privy sees an L1 action hash, so it cannot independently inspect
notional/action contents; Hyperliquid agent permissions and local checks enforce
those boundaries. State is always `~/.bloxwap`, env prefix `BLOXWAP_`.
