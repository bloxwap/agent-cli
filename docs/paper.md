# Paper trading

Paper mode lets an agent run its full strategy against **real mainnet
Hyperliquid public market data** — info `l2Book`, WS `l2Book`/`trades`/`bbo`,
`metaAndAssetCtxs` and funding — and simulates the trades it would make, with no
funding and no real money. It never signs or submits anything: no agent
key, no `approveAgent`, no deposit. Going live afterwards is a separate,
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

`init`, `fund`, `deposit`, `rotate` and `revoke` are live-custody operations and refuse to
run in paper mode.

## Simulator semantics

Trading commands (`order`, `cancel`, `modify`, `leverage`) go through the same
validation, normalized errors, risk limits, builder fee and audit trail as live
trading; a local simulator fills them against the live market:

- Market/IOC orders walk the live book across price levels with slippage
  (IOC bounds come from the same slippage-bounded price as live mode).
- GTC orders cross available liquidity and retain any unfilled remainder.
  ALO orders reject when marketable. Resting limits fill at their limit price
  when a fresh book crosses or a trade prints through; queue priority and actual
  obtainable size at the exchange are not modeled.
- Reduce-only orders cap at the open position and are cancelled when they
  would increase it; TP/SL trigger orders fire when the trade/mark price
  crosses the trigger in the trigger direction, then execute as market
  (walking the book) or rest as limits.
- Fees: Hyperliquid base taker 4.5 bps / maker 1.5 bps plus the optional
  Bloxwap builder fee (default `f=0`, `config set builder.fee`). Live referral
  discounts are not simulated.
- Funding accrues proportionally to elapsed time using captured hourly rates
  from `metaAndAssetCtxs` (longs pay positive funding). Fills settle the old
  exposure before changing it. Missed historical rates are approximated using
  the last stored rate and mark; the simulator does not reconstruct history.
- Every exposure-increasing fill checks available margin including fees. Cash
  fees, realized PnL and funding use 8 decimal places, truncated toward zero.
  Leverage changes also require sufficient margin.
- Margin and liquidation are approximations: cross liquidation compares
  account equity against aggregate maintenance margin (`1 / (2 * maxLeverage)`
  of notional per market); isolated liquidation compares position margin plus
  PnL against maintenance. Liquidated positions close at mark with taker fees.
- Leverage and cross/isolated mode are per market; starting virtual balance is
  `config set paper.startingBalance` or `paper reset --balance N --yes`.

`status`, `balance`, `positions`, `orders`, `events` and `logs` all work in
paper mode and read paper state; account values use live mark prices.

Paper state updates, risk checks and resets serialize on one state lock. Market
snapshots older than five seconds or predating placement cannot fill new orders;
reconnect clears cached books. If configured daily-loss protection cannot value
the UTC-day boundary, new exposure is blocked while reduce-only remains available.

Each reset creates a new session ID. Old trade/audit/event journals remain on disk;
normal reads select the current session and `--all-scopes` exposes retained event
and audit history. Event sequences never reset. A durable outbox publishes direct
command fills as well as engine fills and retries interrupted publication.

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
