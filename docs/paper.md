# Paper trading

Paper mode lets an agent run its full strategy against **real mainnet
Hyperliquid public market data** — info `l2Book`, WS `l2Book`/`trades`/`bbo`,
`meta` and funding — and shows exactly which trades it would make, with no
funding and no real money. It never signs or submits anything: no Privy
session, no `approveAgent`, no deposit. Going live afterwards is a separate,
explicit action.

## Enabling and labeling

- Per invocation: the global `--paper` flag (`order --paper ...`).
- Persisted: `config set mode paper` (writes `mode` in `~/.bloxwap/config.json`).
- Runner: `run --paper` (or `run` while `mode` is `paper`).
- Back to live: `config set mode live --yes` — the `--yes` confirmation is
  required so live mode is never entered silently.

Every success and error envelope carries `mode: "live" | "paper"` and
`paper: true | false`, and every event record carries the same fields. Paper
commands never use the live runner socket, pid file, audit chain, event
journal or logs, and live commands never read paper state: paper state lives
entirely under `~/.bloxwap/paper/` (`state.json`, `trades.jsonl`,
`events.jsonl`, `audit.jsonl`, `runner.pid`, `run.sock`, `logs/`).

`init`, `fund`, `rotate` and `revoke` are live-custody operations and refuse to
run in paper mode.

## Simulator semantics

Trading commands (`order`, `cancel`, `modify`, `leverage`) go through the same
validation, normalized errors, risk limits, builder fee and audit trail as live
trading; a local simulator fills them against the live market:

- Market/IOC orders walk the live book across price levels with slippage
  (IOC bounds come from the same slippage-bounded price as live mode).
- Limit GTC/ALO orders rest and fill at their limit price when the market
  trades through them (a book cross or a trade print on the other side).
- Reduce-only orders cap at the open position and are cancelled when they
  would increase it; TP/SL trigger orders fire when the trade/mark price
  crosses the trigger in the trigger direction, then execute as market
  (walking the book) or rest as limits.
- Fees: Hyperliquid base taker 4.5 bps / maker 1.5 bps plus the Bloxwap
  builder fee (default `f=10` = 1 bp, `config set builder.fee`).
- Funding accrues hourly at Hyperliquid's `funding` rate (from
  `metaAndAssetCtxs`) of perp notional — the field is the hourly rate, paid
  every hour (longs pay positive funding).
- Margin and liquidation are approximations: cross liquidation compares
  account equity against aggregate maintenance margin (`1 / (2 * maxLeverage)`
  of notional per market); isolated liquidation compares position margin plus
  PnL against maintenance. Liquidated positions close at mark with taker fees.
- Leverage and cross/isolated mode are per market; starting virtual balance is
  `config set paper.startingBalance` or `paper reset --balance N --yes`.

`status`, `balance`, `positions`, `orders`, `events` and `logs` all work in
paper mode and read paper state; account values use live mark prices.

## Operating rhythm

```sh
agent-cli paper reset --yes
agent-cli run --paper --detach        # optional: live fills/funding/liq ticks
agent-cli order --paper --json '{"coin":"BTC","side":"buy","size":"0.01","type":"market"}'
agent-cli positions --paper
agent-cli paper summary               # equity, realized/unrealized PnL, fees, funding
agent-cli events --paper --types '["fill"]'
agent-cli paper reset --yes           # start a new session
```

## Verification

The simulator core is deterministic and covered by fixture-book unit tests
(book walking, resting fills, reduce-only, TP/SL, fees, funding, liquidation);
unit tests never touch the network. An optional env-gated smoke test
(`BLOXWAP_PAPER_SMOKE=1 npx vitest run test/paper-smoke.test.ts`) reads real
mainnet public data when explicitly enabled.
