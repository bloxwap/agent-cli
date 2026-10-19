import { expect, test, vi } from 'vitest';
import { migrate } from '../src/core/config.js';
import { PaperStore } from '../src/paper/store.js';
import {
  paperExchange,
  type PaperData,
} from '../src/paper/services.js';
import { paperTradingServices } from '../src/paper/services.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
let counter = 0;
const store = () =>
  new PaperStore(
    join(homedir(), '.bloxwap', `paper-xchg-${process.pid}-${counter++}`),
  );
const BOOK = {
  bids: [{ px: '99', sz: '5' }],
  asks: [{ px: '100', sz: '1' }, { px: '101', sz: '2' }],
};
const data = (books: Record<string, unknown> = { BTC: BOOK }): PaperData => ({
  book: async (coin) =>
    (books[coin] as never) ?? { bids: [], asks: [] },
  marks: async () => ({ BTC: '100' }),
  fundingRates: async () => ({ BTC: '0.0001' }),
  mids: async () => ({ BTC: '100' }),
  coinOfAsset: async (asset) => (asset === 0 ? 'BTC' : 'ETH'),
  maxLeverageOf: async () => 40,
});
const config = () => migrate({ mode: 'paper' });
test('IOC order walks the live book and reports a fill', async () => {
  const paper = store();
  await paper.reset(10000);
  const emitted: [string, unknown][] = [];
  const exchange = paperExchange(
    config(),
    paper,
    data(),
    async (type, payload) => void emitted.push([type, payload]),
  );
  const result = (await exchange.order({
    orders: [
      { a: 0, b: true, p: '100.5', s: '1', r: false, t: { limit: { tif: 'Ioc' } } },
    ],
  })) as { response: { data: { statuses: unknown[] } } };
  expect(result.response.data.statuses[0]).toEqual({
    filled: { oid: 1, totalSz: '1', avgPx: '100', status: 'filled' },
  });
  const state = await paper.load();
  expect(state.positions[0]).toMatchObject({ coin: 'BTC', size: '1', entryPx: '100' });
  expect(state.balance).toBe('9999.945');
  expect(emitted.map(([type]) => type)).toEqual(['fill']);
});
test('IOC without liquidity returns an error status', async () => {
  const paper = store();
  await paper.reset(10000);
  const exchange = paperExchange(config(), paper, data({ BTC: { bids: [], asks: [] } }));
  const result = (await exchange.order({
    orders: [
      { a: 0, b: true, p: '100', s: '1', r: false, t: { limit: { tif: 'Ioc' } } },
    ],
  })) as { response: { data: { statuses: { error?: string }[] } } };
  expect(result.response.data.statuses[0].error).toMatch(/immediately match/);
});
test('GTC limit rests when not crossed and fills immediately when crossed', async () => {
  const paper = store();
  await paper.reset(10000);
  const exchange = paperExchange(config(), paper, data());
  const resting = (await exchange.order({
    orders: [
      { a: 0, b: false, p: '102', s: '1', r: false, t: { limit: { tif: 'Gtc' } } },
    ],
  })) as { response: { data: { statuses: unknown[] } } };
  expect(resting.response.data.statuses[0]).toEqual({ resting: { oid: 1 } });
  expect((await paper.load()).orders[0].limitPx).toBe('102');
  const crossed = (await exchange.order({
    orders: [
      { a: 0, b: true, p: '100', s: '0.5', r: false, t: { limit: { tif: 'Gtc' } } },
    ],
  })) as { response: { data: { statuses: unknown[] } } };
  expect(crossed.response.data.statuses[0]).toEqual({
    filled: { oid: 2, totalSz: '0.5', avgPx: '100', status: 'filled' },
  });
  expect((await paper.load()).positions[0].size).toBe('0.5');
});
test('TP/SL trigger orders rest and fire when already triggered', async () => {
  const paper = store();
  await paper.reset(10000);
  const exchange = paperExchange(config(), paper, data());
  const resting = (await exchange.order({
    orders: [
      {
        a: 0,
        b: false,
        p: '105',
        s: '1',
        r: true,
        t: { trigger: { isMarket: true, triggerPx: '105', tpsl: 'tp' } },
      },
    ],
  })) as { response: { data: { statuses: unknown[] } } };
  expect(resting.response.data.statuses[0]).toEqual({ resting: { oid: 1 } });
  const order = (await paper.load()).orders[0];
  expect(order).toMatchObject({ isTrigger: true, triggerPx: '105', tpsl: 'tp' });
  // Stop with trigger already below the mark fires immediately as a market walk.
  const fired = (await exchange.order({
    orders: [
      {
        a: 0,
        b: false,
        p: '99',
        s: '1',
        r: false,
        t: { trigger: { isMarket: true, triggerPx: '105', tpsl: 'sl' } },
      },
    ],
  })) as { response: { data: { statuses: unknown[] } } };
  expect(fired.response.data.statuses[0]).toEqual({
    filled: { oid: 2, totalSz: '1', avgPx: '99', status: 'filled' },
  });
});
test('cancel, cancelByCloid and unknown cancel errors', async () => {
  const paper = store();
  await paper.reset(10000);
  const exchange = paperExchange(config(), paper, data());
  await exchange.order({
    orders: [
      { a: 0, b: false, p: '102', s: '1', r: false, t: { limit: { tif: 'Gtc' } }, c: '0x' + 'ab'.repeat(16) },
    ],
  });
  const byOid = (await exchange.cancel({ cancels: [{ a: 0, o: 1 }] })) as {
    response: { data: { statuses: unknown[] } };
  };
  expect(byOid.response.data.statuses[0]).toEqual({ success: true });
  await exchange.order({
    orders: [
      { a: 0, b: false, p: '102', s: '1', r: false, t: { limit: { tif: 'Gtc' } }, c: '0x' + 'cd'.repeat(16) },
    ],
  });
  const byCloid = (await exchange.cancelByCloid({
    cloids: [{ a: 0, c: '0x' + 'cd'.repeat(16) }],
  })) as { response: { data: { statuses: unknown[] } } };
  expect(byCloid.response.data.statuses[0]).toEqual({ success: true });
  const missing = (await exchange.cancel({ cancels: [{ a: 0, o: 999 }] })) as {
    response: { data: { statuses: { error?: string }[] } };
  };
  expect(missing.response.data.statuses[0].error).toMatch(/not found/);
  expect((await paper.load()).orders).toEqual([]);
});
test('batchModify updates resting orders and fills when modified into a cross', async () => {
  const paper = store();
  await paper.reset(10000);
  const exchange = paperExchange(config(), paper, data());
  await exchange.order({
    orders: [
      { a: 0, b: true, p: '98', s: '1', r: false, t: { limit: { tif: 'Gtc' } } },
    ],
  });
  const modified = (await exchange.batchModify({
    modifies: [
      {
        oid: 1,
        order: { a: 0, b: true, p: '100', s: '1', r: false, t: { limit: { tif: 'Gtc' } } },
      },
    ],
  })) as { response: { data: { statuses: unknown[] } } };
  expect(modified.response.data.statuses[0]).toEqual({ status: 'modified' });
  const state = await paper.load();
  expect(state.orders).toEqual([]);
  expect(state.positions[0].size).toBe('1');
  const missing = (await exchange.batchModify({
    modifies: [
      {
        oid: 777,
        order: { a: 0, b: true, p: '100', s: '1', r: false, t: { limit: { tif: 'Gtc' } } },
      },
    ],
  })) as { response: { data: { statuses: { error?: string }[] } } };
  expect(missing.response.data.statuses[0].error).toMatch(/not found/);
});
test('updateLeverage sets defaults and position leverage within the ceiling', async () => {
  const paper = store();
  await paper.reset(10000);
  const exchange = paperExchange(config(), paper, data());
  await exchange.updateLeverage({ asset: 0, isCross: false, leverage: 40 });
  expect((await paper.load()).leverage.BTC).toEqual({
    type: 'isolated',
    value: 40,
  });
  await expect(
    exchange.updateLeverage({ asset: 0, isCross: true, leverage: 50 }),
  ).rejects.toMatchObject({ code: 'POLICY_REJECTED' });
});
test('margin exhaustion surfaces as INSUFFICIENT_MARGIN from the adapter', async () => {
  const paper = store();
  await paper.reset(10000);
  const exchange = paperExchange(config(), paper, data());
  await expect(
    exchange.order({
      orders: [
        { a: 0, b: true, p: '100', s: '200', r: false, t: { limit: { tif: 'Gtc' } } },
      ],
    }),
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_MARGIN' });
});
test('paperTradingServices exposes account state, open orders and daily loss', async () => {
  const paper = store();
  await paper.reset(10000);
  const services = paperTradingServices(config(), paper, data());
  const exchange = services.exchange;
  await exchange.order({
    orders: [
      { a: 0, b: true, p: '100.5', s: '1', r: false, t: { limit: { tif: 'Ioc' } } },
    ],
  });
  await exchange.order({
    orders: [
      { a: 0, b: false, p: '105', s: '1', r: true, t: { trigger: { isMarket: true, triggerPx: '105', tpsl: 'tp' } } },
    ],
  });
  const state = await services.state();
  expect(state.marginSummary.accountValue).toBe('9999.945');
  expect(state.withdrawable).toBe('9999.945');
  expect(state.assetPositions[0].position).toMatchObject({
    coin: 'BTC',
    szi: '1',
    leverage: { type: 'cross', value: 1 },
  });
  const orders = await services.orders();
  expect(orders[0]).toMatchObject({
    coin: 'BTC',
    oid: 2,
    side: 'A',
    reduceOnly: true,
    isTrigger: true,
    triggerPx: '105',
  });
  expect(await services.mids()).toEqual({ BTC: '100' });
  expect(await services.dailyLoss!()).toBe('0.055');
  expect(vi.isMockFunction(services.exchange.order)).toBe(false);
});
