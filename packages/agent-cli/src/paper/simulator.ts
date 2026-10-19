import { parseUsdc, formatUsdc } from '../funding/amounts.js';
import { AgentCliError } from '../errors/index.js';
// Deterministic local fill simulator for paper trading. Every function mutates
// the passed PaperState in place and reports what happened so callers can emit
// events; nothing here performs network or clock access unless values are passed in.
export const PAPER_TAKER_FEE = 0.00045; // Hyperliquid base taker, 4.5 bps
export const PAPER_MAKER_FEE = 0.00015; // Hyperliquid base maker, 1.5 bps
export const PAPER_FUNDING_INTERVAL_MS = 3_600_000; // funding accrues hourly
export const MAX_STATE_TRADES = 500;
const SCALE = 10n ** 18n;
export type Side = 'B' | 'A';
export interface BookLevel {
  px: string;
  sz: string;
}
export interface PaperBook {
  bids: BookLevel[]; // descending
  asks: BookLevel[]; // ascending
}
export interface PaperPosition {
  coin: string;
  size: string; // signed decimal
  entryPx: string;
  leverage: { type: 'cross' | 'isolated'; value: number };
}
export interface PaperOrder {
  oid: number;
  coin: string;
  side: Side;
  sz: string;
  filledSz: string;
  limitPx: string;
  reduceOnly: boolean;
  tif: 'Gtc' | 'Ioc' | 'Alo';
  cloid?: string;
  isTrigger?: boolean;
  triggerPx?: string;
  tpsl?: 'tp' | 'sl';
  triggerIsMarket?: boolean;
  placedAt: number;
}
export interface PaperTrade {
  tid: number;
  time: number;
  coin: string;
  side: Side;
  sz: string;
  px: string;
  oid?: number;
  cloid?: string;
  fee: string;
  feeRate: string;
  taker: boolean;
  liquidation?: boolean;
  realizedPnl?: string;
}
export interface PaperState {
  version: 1;
  createdAt: number;
  startingBalance: string;
  balance: string;
  positions: PaperPosition[];
  orders: PaperOrder[];
  leverage: Record<string, { type: 'cross' | 'isolated'; value: number }>;
  nextOid: number;
  nextTid: number;
  feesPaid: string;
  fundingPaid: string;
  realizedPnl: string;
  trades: PaperTrade[];
  liquidations: number;
  lastFundingAt: number;
  dayStartEquity: string;
  dayStartAt: number;
}
const d = (value: string) => parseUsdc(value, 18);
const f = (value: bigint) => formatUsdc(value, 18);
const abs = (value: bigint) => (value < 0n ? -value : value);
export const builderFeeFraction = (builderFee: number) =>
  Math.max(0, builderFee) / 100_000; // config tenths of a bp; f=10 -> 1 bp = 0.0001
export const tradeFeeRate = (taker: boolean, builderFee: number) =>
  (taker ? PAPER_TAKER_FEE : PAPER_MAKER_FEE) + builderFeeFraction(builderFee);
export function initialPaperState(
  startingBalance: number,
  now = Date.now(),
): PaperState {
  if (!Number.isFinite(startingBalance) || startingBalance <= 0)
    throw new AgentCliError('CONFIG_INVALID', 'Starting balance must be positive');
  const balance = String(startingBalance);
  return {
    version: 1,
    createdAt: now,
    startingBalance: balance,
    balance,
    positions: [],
    orders: [],
    leverage: {},
    nextOid: 1,
    nextTid: 1,
    feesPaid: '0',
    fundingPaid: '0',
    realizedPnl: '0',
    trades: [],
    liquidations: 0,
    lastFundingAt: now,
    dayStartEquity: balance,
    dayStartAt: now,
  };
}
export function positionOf(state: PaperState, coin: string) {
  return state.positions.find((p) => p.coin === coin);
}
export function leverageOf(state: PaperState, coin: string) {
  return (
    positionOf(state, coin)?.leverage ??
    state.leverage[coin] ?? { type: 'cross' as const, value: 1 }
  );
}
export const maintenanceRate = (maxLeverage: number) => 1 / (2 * maxLeverage);
export function unrealizedPnl(position: PaperPosition, markPx: string) {
  return (d(position.size) * (d(markPx) - d(position.entryPx))) / SCALE;
}
export function initialMargin(position: PaperPosition, markPx: string) {
  return (
    (abs(d(position.size)) * d(markPx)) /
    BigInt(position.leverage.value) /
    SCALE
  );
}
export function maintenanceMargin(
  position: PaperPosition,
  markPx: string,
  maxLeverage: number,
) {
  return (
    (abs(d(position.size)) * d(markPx) * BigInt(Math.round(maintenanceRate(maxLeverage) * 1e9))) /
    BigInt(1e9) /
    SCALE
  );
}
export function accountEquity(state: PaperState, marks: Record<string, string>) {
  let equity = d(state.balance);
  for (const position of state.positions) {
    const mark = marks[position.coin];
    if (mark) equity += unrealizedPnl(position, mark);
  }
  return equity;
}
export function liquidationPx(
  position: PaperPosition,
  maxLeverage: number,
): string | null {
  if (d(position.size) === 0n) return null;
  const entry = d(position.entryPx);
  const buffer = 1 / position.leverage.value - maintenanceRate(maxLeverage);
  const px =
    d(position.size) > 0n
      ? (entry * BigInt(Math.round((1 - buffer) * 1e9))) / BigInt(1e9)
      : (entry * BigInt(Math.round((1 + buffer) * 1e9))) / BigInt(1e9);
  return f(px);
}
function pushTrade(state: PaperState, trade: PaperTrade) {
  state.trades.push(trade);
  if (state.trades.length > MAX_STATE_TRADES)
    state.trades.splice(0, state.trades.length - MAX_STATE_TRADES);
  return trade;
}
export interface FillInput {
  coin: string;
  side: Side;
  sz: string;
  px: string;
  oid?: number;
  cloid?: string;
  taker: boolean;
  builderFee: number;
  now: number;
  liquidation?: boolean;
}
export function applyFill(state: PaperState, input: FillInput): PaperTrade {
  const sz = d(input.sz),
    px = d(input.px);
  if (sz <= 0n || px <= 0n)
    throw new AgentCliError('INVALID_SIZE', 'Fill size and price must be positive');
  const notional = (sz * px) / SCALE;
  const fee = (notional * BigInt(Math.round(tradeFeeRate(input.taker, input.builderFee) * 1e9))) / BigInt(1e9);
  const signed = input.side === 'B' ? sz : -sz;
  let realized = 0n;
  const position = positionOf(state, input.coin);
  if (position && d(position.size) !== 0n) {
    const current = d(position.size);
    const sameDirection = current > 0n === (signed > 0n);
    if (!sameDirection) {
      const closing = abs(current) <= abs(signed) ? abs(current) : abs(signed);
      const direction = current > 0n ? 1n : -1n;
      realized = (closing * (px - d(position.entryPx)) * direction) / SCALE;
    }
    const next = current + signed;
    if (next === 0n) state.positions = state.positions.filter((p) => p !== position);
    else {
      if (abs(next) > abs(current))
        position.entryPx = f(
          (abs(current) * d(position.entryPx) + sz * px) / (abs(current) + sz),
        );
      else if (next < 0n !== current < 0n) position.entryPx = input.px;
      position.size = f(next);
    }
  } else if (signed !== 0n) {
    state.positions.push({
      coin: input.coin,
      size: f(signed),
      entryPx: input.px,
      leverage: { ...leverageOf(state, input.coin) },
    });
  }
  // Cross-style virtual margin: cash moves only by fees, funding and realized
  // PnL; position notional is not deducted. Margin checks use account equity.
  state.balance = f(d(state.balance) - fee + realized);
  state.feesPaid = f(d(state.feesPaid) + fee);
  state.realizedPnl = f(d(state.realizedPnl) + realized);
  return pushTrade(state, {
    tid: state.nextTid++,
    time: input.now,
    coin: input.coin,
    side: input.side,
    sz: input.sz,
    px: input.px,
    ...(input.oid !== undefined ? { oid: input.oid } : {}),
    ...(input.cloid ? { cloid: input.cloid } : {}),
    fee: f(fee),
    feeRate: String(tradeFeeRate(input.taker, input.builderFee)),
    taker: input.taker,
    ...(input.liquidation ? { liquidation: true } : {}),
    ...(realized !== 0n ? { realizedPnl: f(realized) } : {}),
  });
}
export interface WalkResult {
  filledSz: string;
  avgPx: string | null;
  trades: PaperTrade[];
}
// Walk a live book for a taker (market/IOC) order. limitPx bounds the walk for
// slippage-limited IOC orders; omit it for unbounded triggered market orders.
export function walkBook(
  state: PaperState,
  order: {
    coin: string;
    side: Side;
    sz: string;
    limitPx?: string;
    oid?: number;
    cloid?: string;
    reduceOnly: boolean;
  },
  book: PaperBook,
  builderFee: number,
  now: number,
): WalkResult {
  const levels = order.side === 'B' ? book.asks : book.bids;
  const bound = order.limitPx === undefined ? null : d(order.limitPx);
  let remaining = d(order.sz);
  const position = positionOf(state, order.coin);
  if (order.reduceOnly && (!position || d(position.size) === 0n))
    return { filledSz: '0', avgPx: null, trades: [] };
  if (order.reduceOnly)
    remaining = remaining < abs(d(position!.size)) ? remaining : abs(d(position!.size));
  let notional = 0n,
    filled = 0n;
  const trades: PaperTrade[] = [];
  for (const level of levels) {
    if (remaining <= 0n) break;
    const px = d(level.px);
    if (bound !== null && (order.side === 'B' ? px > bound : px < bound)) break;
    const take = remaining < d(level.sz) ? remaining : d(level.sz);
    trades.push(
      applyFill(state, {
        coin: order.coin,
        side: order.side,
        sz: f(take),
        px: level.px,
        oid: order.oid,
        cloid: order.cloid,
        taker: true,
        builderFee,
        now,
      }),
    );
    notional += (take * px) / SCALE;
    filled += take;
    remaining -= take;
  }
  return {
    filledSz: f(filled),
    avgPx: filled > 0n ? f((notional * SCALE) / filled) : null,
    trades,
  };
}
// Reject fills that increase exposure beyond available initial margin.
export function assertInitialMargin(
  state: PaperState,
  coin: string,
  signedSz: string,
  px: string,
  marks: Record<string, string>,
) {
  const current = d(positionOf(state, coin)?.size ?? '0');
  const projected = current + d(signedSz);
  const increase = abs(projected) - abs(current);
  if (increase <= 0n) return;
  const withFill = { ...marks, [coin]: px };
  const used = state.positions.reduce(
    (sum, p) => (withFill[p.coin] ? sum + initialMargin(p, withFill[p.coin]) : sum),
    0n,
  );
  const leverage = leverageOf(state, coin).value;
  const required = (increase * d(px)) / BigInt(leverage) / SCALE;
  const available = accountEquity(state, withFill) - used;
  if (available < required)
    throw new AgentCliError('INSUFFICIENT_MARGIN', 'Paper margin exhausted', {
      coin,
      required: f(required),
      available: f(available),
    });
}
export interface RestInput {
  coin: string;
  side: Side;
  sz: string;
  limitPx: string;
  reduceOnly: boolean;
  tif: 'Gtc' | 'Ioc' | 'Alo';
  cloid?: string;
  isTrigger?: boolean;
  triggerPx?: string;
  tpsl?: 'tp' | 'sl';
  triggerIsMarket?: boolean;
  now: number;
}
export function restOrder(state: PaperState, input: RestInput): PaperOrder {
  const order: PaperOrder = {
    oid: state.nextOid++,
    coin: input.coin,
    side: input.side,
    sz: input.sz,
    filledSz: '0',
    limitPx: input.limitPx,
    reduceOnly: input.reduceOnly,
    tif: input.tif,
    placedAt: input.now,
    ...(input.cloid ? { cloid: input.cloid } : {}),
    ...(input.isTrigger
      ? {
          isTrigger: true,
          triggerPx: input.triggerPx,
          tpsl: input.tpsl,
          triggerIsMarket: input.triggerIsMarket ?? false,
        }
      : {}),
  };
  state.orders.push(order);
  return order;
}
export function cancelOrder(state: PaperState, oid: number): PaperOrder | null {
  const order = state.orders.find((o) => o.oid === oid);
  if (!order) return null;
  state.orders = state.orders.filter((o) => o.oid !== oid);
  return order;
}
export interface MarketTick {
  bestBid?: string;
  bestAsk?: string;
  lastTradePx?: string;
  markPx?: string;
}
function triggered(order: PaperOrder, tick: MarketTick): string | null {
  const price = tick.lastTradePx ?? tick.markPx;
  if (!price || !order.triggerPx) return null;
  const px = d(price),
    trigger = d(order.triggerPx);
  const rising = order.side === 'A' ? px >= trigger : px <= trigger;
  if (order.tpsl === 'tp') return rising ? price : null;
  return rising ? null : price;
}
export interface MatchResult {
  fills: PaperTrade[];
  filledOids: number[];
  cancelledOids: number[];
  triggeredOids: number[];
}
// Fill resting orders for a coin from a live market tick (book top, trade print
// or mark price). Limit orders fill when the market trades through their price;
// TP/SL triggers fire when price crosses the trigger in the trigger direction.
export function matchOrders(
  state: PaperState,
  coin: string,
  tick: MarketTick,
  book: PaperBook | null,
  builderFee: number,
  now: number,
): MatchResult {
  const result: MatchResult = { fills: [], filledOids: [], cancelledOids: [], triggeredOids: [] };
  for (const order of [...state.orders]) {
    if (order.coin !== coin) continue;
    if (order.isTrigger) {
      const price = triggered(order, tick);
      if (!price) continue;
      if (order.reduceOnly && isFlat(state, coin)) {
        cancelOrder(state, order.oid);
        result.cancelledOids.push(order.oid);
        continue;
      }
      result.triggeredOids.push(order.oid);
      if (order.triggerIsMarket || !book) {
        const hasLiquidity =
          book && (order.side === 'B' ? book.asks.length : book.bids.length);
        if (book && hasLiquidity) {
          const walk = walkBook(
            state,
            {
              coin,
              side: order.side,
              sz: remainingSz(order),
              oid: order.oid,
              cloid: order.cloid,
              reduceOnly: order.reduceOnly,
            },
            book,
            builderFee,
            now,
          );
          result.fills.push(...walk.trades);
        } else {
          applyFill(state, {
            coin,
            side: order.side,
            sz: remainingSz(order),
            px: order.limitPx,
            oid: order.oid,
            cloid: order.cloid,
            taker: true,
            builderFee,
            now,
          });
          result.fills.push(state.trades.at(-1)!);
        }
        finishOrder(state, order, result);
      } else {
        order.isTrigger = false;
        order.tif = 'Gtc';
        fillCrossed(state, order, tick, builderFee, now, result);
      }
      continue;
    }
    fillCrossed(state, order, tick, builderFee, now, result);
  }
  return result;
}
function remainingSz(order: PaperOrder) {
  return f(d(order.sz) - d(order.filledSz));
}
function isFlat(state: PaperState, coin: string) {
  const position = positionOf(state, coin);
  return !position || d(position.size) === 0n;
}
function finishOrder(state: PaperState, order: PaperOrder, result: MatchResult) {
  state.orders = state.orders.filter((o) => o.oid !== order.oid);
  result.filledOids.push(order.oid);
}
function fillCrossed(
  state: PaperState,
  order: PaperOrder,
  tick: MarketTick,
  builderFee: number,
  now: number,
  result: MatchResult,
) {
  const price =
    order.side === 'B'
      ? (tick.bestAsk ?? tick.lastTradePx)
      : (tick.bestBid ?? tick.lastTradePx);
  if (!price) return;
  const crosses =
    order.side === 'B' ? d(price) <= d(order.limitPx) : d(price) >= d(order.limitPx);
  const tradedThrough =
    tick.lastTradePx !== undefined &&
    (order.side === 'B'
      ? d(tick.lastTradePx) <= d(order.limitPx)
      : d(tick.lastTradePx) >= d(order.limitPx));
  if (!crosses && !tradedThrough) return;
  let sz = d(remainingSz(order));
  if (order.reduceOnly) {
    const position = positionOf(state, order.coin);
    if (!position || d(position.size) === 0n) {
      cancelOrder(state, order.oid);
      result.cancelledOids.push(order.oid);
      return;
    }
    // A reduce-only order must shrink the position; cancel if it would add.
    if (d(position.size) > 0n === (order.side === 'B')) {
      cancelOrder(state, order.oid);
      result.cancelledOids.push(order.oid);
      return;
    }
    sz = sz < abs(d(position.size)) ? sz : abs(d(position.size));
  }
  applyFill(state, {
    coin: order.coin,
    side: order.side,
    sz: f(sz),
    px: order.limitPx,
    oid: order.oid,
    cloid: order.cloid,
    taker: false,
    builderFee,
    now,
  });
  result.fills.push(state.trades.at(-1)!);
  finishOrder(state, order, result);
}
export function accrueFunding(
  state: PaperState,
  fundingRates: Record<string, string>,
  marks: Record<string, string>,
  now: number,
): { coin: string; amount: string }[] {
  const intervals = now - state.lastFundingAt;
  if (intervals <= 0 || !state.positions.length) {
    if (intervals > 0) state.lastFundingAt = now;
    return [];
  }
  const hours = intervals / PAPER_FUNDING_INTERVAL_MS;
  const payments: { coin: string; amount: string }[] = [];
  for (const position of state.positions) {
    const rate = fundingRates[position.coin],
      mark = marks[position.coin];
    if (!rate || !mark) continue;
    // Positive funding is paid by longs and received by shorts, hourly at rate/8.
    const notionalRate =
      (((d(position.size) * d(mark)) / SCALE) * d(rate)) / SCALE;
    const cash =
      (-notionalRate * BigInt(Math.round(hours * 1e9))) / (BigInt(1e9) * 8n);
    if (cash === 0n) continue;
    state.balance = f(d(state.balance) + cash);
    state.fundingPaid = f(d(state.fundingPaid) + cash);
    payments.push({ coin: position.coin, amount: f(cash) });
  }
  state.lastFundingAt = now;
  return payments;
}
// Approximate maintenance-margin liquidation. Isolated positions liquidate when
// locked margin plus PnL breaches maintenance margin; cross positions liquidate
// largest-first while total account equity cannot cover aggregate maintenance.
export function liquidate(
  state: PaperState,
  marks: Record<string, string>,
  maxLeverageOf: (coin: string) => number,
  builderFee: number,
  now: number,
): PaperTrade[] {
  const liquidated: PaperTrade[] = [];
  const liquidatePosition = (position: PaperPosition, mark: string) => {
    const size = abs(d(position.size));
    if (size === 0n) return;
    const trade = applyFill(state, {
      coin: position.coin,
      side: d(position.size) > 0n ? 'A' : 'B',
      sz: f(size),
      px: mark,
      taker: true,
      builderFee,
      now,
      liquidation: true,
    });
    trade.liquidation = true;
    state.liquidations++;
    state.orders = state.orders.filter((o) => o.coin !== position.coin);
    liquidated.push(trade);
  };
  for (const position of [...state.positions]) {
    if (position.leverage.type !== 'isolated') continue;
    const mark = marks[position.coin];
    if (!mark) continue;
    const locked = initialMargin(position, mark);
    if (locked + unrealizedPnl(position, mark) <= maintenanceMargin(position, mark, maxLeverageOf(position.coin)))
      liquidatePosition(position, mark);
  }
  for (let guard = 0; guard < 100; guard++) {
    const cross = state.positions.filter((p) => p.leverage.type === 'cross');
    if (!cross.length) break;
    const maintTotal = cross.reduce(
      (sum, p) => sum + (marks[p.coin] ? maintenanceMargin(p, marks[p.coin], maxLeverageOf(p.coin)) : 0n),
      0n,
    );
    const equity = accountEquity(state, marks);
    const breach = cross.find(
      (p) =>
        marks[p.coin] &&
        maintenanceMargin(p, marks[p.coin], maxLeverageOf(p.coin)) > 0n &&
        equity <= maintTotal,
    );
    if (!breach) break;
    const largest = cross.reduce((a, b) =>
      abs(d(a.size)) >= abs(d(b.size)) ? a : b,
    );
    liquidatePosition(largest, marks[largest.coin]);
  }
  return liquidated;
}
export function rolloverDay(state: PaperState, marks: Record<string, string>, now: number) {
  if (now - state.dayStartAt >= 86_400_000) {
    state.dayStartEquity = f(accountEquity(state, marks));
    state.dayStartAt = now;
  }
}
export function dailyLoss(state: PaperState, marks: Record<string, string>) {
  const loss = d(state.dayStartEquity) - accountEquity(state, marks);
  return f(loss > 0n ? loss : 0n);
}
