import { expect, test } from 'vitest';
import {
  accrueFunding,
  accountEquity,
  applyFill,
  assertInitialMargin,
  cancelOrder,
  dailyLoss,
  initialPaperState,
  leverageOf,
  liquidate,
  liquidationPx,
  matchOrders,
  restOrder,
  rolloverDay,
  tradeFeeRate,
  walkBook,
  type PaperBook,
  type PaperState,
} from '../src/paper/simulator.js';
const BOOK: PaperBook = {
  bids: [
    { px: '99', sz: '5' },
    { px: '98', sz: '5' },
  ],
  asks: [
    { px: '100', sz: '1' },
    { px: '101', sz: '2' },
  ],
};
const state = (): PaperState => initialPaperState(10_000, 1_700_000_000_000);
const buy = (s: PaperState, sz: string, px = '100') =>
  applyFill(s, {
    coin: 'BTC',
    side: 'B',
    sz,
    px,
    taker: true,
    builderFee: 10,
    now: 1,
  });
test('market buy walks the book with slippage and taker plus builder fees', () => {
  const s = state();
  const result = walkBook(
    s,
    { coin: 'BTC', side: 'B', sz: '1.5', limitPx: '102', reduceOnly: false },
    BOOK,
    10,
    1_700_000_000_001,
  );
  expect(result.filledSz).toBe('1.5');
  expect(result.avgPx).toBe('100.333333333333333333');
  expect(result.trades.map((t) => [t.px, t.sz])).toEqual([
    ['100', '1'],
    ['101', '0.5'],
  ]);
  // notional 150.5 * (4.5 bps taker + 1 bp builder) = 0.082775
  expect(s.feesPaid).toBe('0.082775');
  expect(s.balance).toBe('9999.917225');
  expect(s.positions[0]).toMatchObject({ coin: 'BTC', size: '1.5' });
  expect(s.positions[0].entryPx).toBe('100.333333333333333333');
  expect(s.trades.every((t) => t.taker)).toBe(true);
});
test('IOC bound caps fills and books without liquidity fill nothing', () => {
  const s = state();
  const partial = walkBook(
    s,
    { coin: 'BTC', side: 'B', sz: '5', limitPx: '100.5', reduceOnly: false },
    BOOK,
    10,
    1,
  );
  expect(partial.filledSz).toBe('1');
  expect(partial.avgPx).toBe('100');
  const empty = walkBook(
    s,
    { coin: 'BTC', side: 'B', sz: '1', limitPx: '100', reduceOnly: false },
    { bids: [], asks: [] },
    10,
    1,
  );
  expect(empty.filledSz).toBe('0');
  expect(empty.trades).toEqual([]);
});
test('sell walks bids; realized losses land in the cash balance', () => {
  const s = state();
  buy(s, '2');
  expect(s.balance).toBe('9999.89');
  const result = walkBook(
    s,
    { coin: 'BTC', side: 'A', sz: '2', limitPx: '98.5', reduceOnly: false },
    BOOK,
    10,
    2,
  );
  expect(result.filledSz).toBe('2');
  expect(result.avgPx).toBe('99');
  // fee 198 * 0.00055 = 0.1089; realized 2 * (99 - 100) = -2
  expect(s.balance).toBe('9997.7811');
  expect(s.realizedPnl).toBe('-2');
  expect(s.positions).toEqual([]);
});
test('resting limit fills when the market trades through', () => {
  const s = state();
  restOrder(s, {
    coin: 'BTC',
    side: 'B',
    sz: '1',
    limitPx: '99',
    reduceOnly: false,
    tif: 'Gtc',
    now: 1,
  });
  const noFill = matchOrders(
    s,
    'BTC',
    { bestBid: '98.5', bestAsk: '100', lastTradePx: '99.2' },
    BOOK,
    10,
    2,
  );
  expect(noFill.fills).toEqual([]);
  const fill = matchOrders(
    s,
    'BTC',
    { bestBid: '98.5', bestAsk: '100', lastTradePx: '98.9' },
    BOOK,
    10,
    3,
  );
  expect(fill.filledOids).toEqual([1]);
  expect(fill.fills[0]).toMatchObject({ px: '99', sz: '1', taker: false });
  // maker fee: 99 * (1.5 bps + 1 bp) = 0.02475
  expect(s.feesPaid).toBe('0.02475');
  expect(s.balance).toBe('9999.97525');
  expect(s.orders).toEqual([]);
});
test('book cross fills a resting limit as maker at its price', () => {
  const s = state();
  restOrder(s, {
    coin: 'BTC',
    side: 'A',
    sz: '1',
    limitPx: '100',
    reduceOnly: false,
    tif: 'Gtc',
    now: 1,
  });
  const result = matchOrders(
    s,
    'BTC',
    { bestBid: '100.1', bestAsk: '101' },
    { bids: [{ px: '100.1', sz: '1' }], asks: [{ px: '101', sz: '1' }] },
    10,
    2,
  );
  expect(result.fills[0]).toMatchObject({ px: '100', side: 'A', taker: false });
});
test('reduce-only caps fills at the position and cancels when flat', () => {
  const s = state();
  buy(s, '0.5');
  const capped = walkBook(
    s,
    { coin: 'BTC', side: 'A', sz: '2', limitPx: '98', reduceOnly: true },
    BOOK,
    10,
    2,
  );
  expect(capped.filledSz).toBe('0.5');
  expect(capped.avgPx).toBe('99');
  expect(s.positions).toEqual([]);
  restOrder(s, {
    coin: 'BTC',
    side: 'A',
    sz: '1',
    limitPx: '97',
    reduceOnly: true,
    tif: 'Gtc',
    now: 4,
  });
  const flat = matchOrders(
    s,
    'BTC',
    { bestBid: '97', bestAsk: '100', lastTradePx: '96' },
    BOOK,
    10,
    5,
  );
  expect(flat.cancelledOids).toEqual([1]);
  expect(s.orders).toEqual([]);
});
test('reduce-only that would increase the position is cancelled', () => {
  const s = state();
  buy(s, '1');
  restOrder(s, {
    coin: 'BTC',
    side: 'B',
    sz: '1',
    limitPx: '95',
    reduceOnly: true,
    tif: 'Gtc',
    now: 2,
  });
  const result = matchOrders(
    s,
    'BTC',
    { bestBid: '90', bestAsk: '94', lastTradePx: '93' },
    { bids: [{ px: '90', sz: '1' }], asks: [{ px: '94', sz: '1' }] },
    10,
    3,
  );
  expect(result.cancelledOids).toEqual([1]);
  expect(s.positions[0].size).toBe('1');
});
test('take profit triggers on the way up and fills as taker market', () => {
  const s = state();
  buy(s, '1');
  restOrder(s, {
    coin: 'BTC',
    side: 'A',
    sz: '1',
    limitPx: '105',
    reduceOnly: true,
    tif: 'Gtc',
    isTrigger: true,
    triggerPx: '105',
    tpsl: 'tp',
    triggerIsMarket: true,
    now: 2,
  });
  const early = matchOrders(
    s,
    'BTC',
    { bestBid: '104', bestAsk: '104.5', lastTradePx: '104.2' },
    BOOK,
    10,
    3,
  );
  expect(early.triggeredOids).toEqual([]);
  const hit = matchOrders(
    s,
    'BTC',
    { bestBid: '105.4', bestAsk: '105.5', lastTradePx: '105.4' },
    { bids: [{ px: '105.4', sz: '5' }], asks: [{ px: '105.5', sz: '5' }] },
    10,
    4,
  );
  expect(hit.triggeredOids).toEqual([1]);
  expect(hit.fills[0]).toMatchObject({ px: '105.4', taker: true });
  expect(s.positions).toEqual([]);
  expect(s.realizedPnl).toBe('5.4');
});
test('stop loss triggers on the way down; limit variant rests at trigger price', () => {
  const s = state();
  buy(s, '1');
  restOrder(s, {
    coin: 'BTC',
    side: 'A',
    sz: '1',
    limitPx: '95',
    reduceOnly: true,
    tif: 'Gtc',
    isTrigger: true,
    triggerPx: '95',
    tpsl: 'sl',
    triggerIsMarket: false,
    now: 2,
  });
  const hit = matchOrders(
    s,
    'BTC',
    { bestBid: '94.9', bestAsk: '95.1', lastTradePx: '94.9' },
    { bids: [{ px: '94.9', sz: '5' }], asks: [{ px: '95.1', sz: '5' }] },
    10,
    3,
  );
  expect(hit.triggeredOids).toEqual([1]);
  // trigger converts to a resting limit at 95; not yet crossed by the 94.9 bid
  expect(s.orders).toHaveLength(1);
  expect(s.orders[0].isTrigger).toBe(false);
  const fill = matchOrders(
    s,
    'BTC',
    { bestBid: '95', bestAsk: '95.2', lastTradePx: '95' },
    { bids: [{ px: '95', sz: '5' }], asks: [{ px: '95.2', sz: '5' }] },
    10,
    4,
  );
  expect(fill.fills[0]).toMatchObject({ px: '95', taker: false });
  expect(s.realizedPnl).toBe('-5');
});
test('funding accrues hourly: longs pay, shorts receive', () => {
  const s = state();
  buy(s, '1');
  const hour = 3_600_000;
  const payments = accrueFunding(
    s,
    { BTC: '0.0008' },
    { BTC: '100' },
    s.lastFundingAt + hour,
  );
  expect(payments).toEqual([{ coin: 'BTC', amount: '-0.01' }]);
  expect(s.balance).toBe('9999.935');
  expect(s.fundingPaid).toBe('-0.01');
  applyFill(s, {
    coin: 'BTC',
    side: 'A',
    sz: '2',
    px: '100',
    taker: true,
    builderFee: 10,
    now: s.lastFundingAt + 1,
  });
  const received = accrueFunding(
    s,
    { BTC: '0.0008' },
    { BTC: '100' },
    s.lastFundingAt + hour,
  );
  expect(received[0].amount).toBe('0.01'); // short 1 receives
});
test('isolated liquidation closes the position at mark with a taker fee', () => {
  const s = state();
  buy(s, '1');
  s.positions[0].leverage = { type: 'isolated', value: 40 };
  expect(liquidationPx(s.positions[0], 40)).toBe('98.75');
  const trades = liquidate(s, { BTC: '98.75' }, () => 40, 10, 2);
  expect(trades).toHaveLength(1);
  expect(trades[0]).toMatchObject({
    liquidation: true,
    side: 'A',
    px: '98.75',
    taker: true,
  });
  expect(s.positions).toEqual([]);
  expect(s.liquidations).toBe(1);
  expect(s.realizedPnl).toBe('-1.25');
  expect(s.balance).toBe('9998.6406875');
});
test('cross liquidation liquidates leveraged exposure at equity breach', () => {
  const s = state();
  s.leverage.BTC = { type: 'cross', value: 40 };
  buy(s, '400'); // notional 40000 at 40x: initial margin 1000 of 10000 equity
  expect(s.balance).toBe('9978'); // fee 40000 * 0.00055 = 22
  expect(liquidate(s, { BTC: '80' }, () => 40, 10, 2)).toEqual([]);
  const trades = liquidate(s, { BTC: '70' }, () => 40, 10, 3);
  expect(trades).toHaveLength(1);
  expect(trades[0]).toMatchObject({ liquidation: true, px: '70', sz: '400' });
  expect(s.positions).toEqual([]);
  expect(s.liquidations).toBe(1);
  expect(s.realizedPnl).toBe('-12000');
});
test('initial margin check rejects exposure beyond virtual equity', () => {
  const s = state();
  expect(() =>
    assertInitialMargin(s, 'BTC', '100', '100', { BTC: '100' }),
  ).not.toThrow();
  buy(s, '100');
  expect(() => assertInitialMargin(s, 'BTC', '1', '100', { BTC: '100' })).toThrow(
    expect.objectContaining({ code: 'INSUFFICIENT_MARGIN' }),
  );
  // reduce-only closes do not need margin
  expect(() =>
    assertInitialMargin(s, 'BTC', '-100', '100', { BTC: '100' }),
  ).not.toThrow();
});
test('leverage setting moves isolated liquidation price', () => {
  const s = state();
  buy(s, '1');
  s.positions[0].leverage = { type: 'isolated', value: 10 };
  const ten = liquidationPx(s.positions[0], 40);
  s.positions[0].leverage = { type: 'isolated', value: 40 };
  const forty = liquidationPx(s.positions[0], 40);
  expect(ten).toBe('91.25');
  expect(forty).toBe('98.75');
  expect(leverageOf(s, 'BTC').value).toBe(40);
});
test('daily loss rolls over with the virtual equity anchor', () => {
  const s = state();
  expect(dailyLoss(s, {})).toBe('0');
  buy(s, '10');
  const marks = { BTC: '90' };
  expect(dailyLoss(s, marks)).toBe('100.55'); // fee 0.55 + 10 * (100 - 90)
  rolloverDay(s, marks, s.dayStartAt + 86_400_001);
  expect(dailyLoss(s, marks)).toBe('0');
  expect(s.dayStartEquity).toBe('9899.45');
});
test('cancel removes resting orders; fee rates match the schedule', () => {
  const s = state();
  const order = restOrder(s, {
    coin: 'BTC',
    side: 'B',
    sz: '1',
    limitPx: '99',
    reduceOnly: false,
    tif: 'Gtc',
    now: 1,
  });
  expect(cancelOrder(s, order.oid)?.oid).toBe(order.oid);
  expect(cancelOrder(s, order.oid)).toBeNull();
  expect(s.orders).toEqual([]);
  expect(tradeFeeRate(true, 10)).toBeCloseTo(0.00055, 9);
  expect(tradeFeeRate(false, 10)).toBeCloseTo(0.00025, 9);
  expect(tradeFeeRate(true, 0)).toBeCloseTo(0.00045, 9);
  expect(accountEquity(s, {})).toBe(10000000000000000000000n);
});
