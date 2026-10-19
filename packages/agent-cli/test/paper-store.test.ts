import { expect, test } from 'vitest';
import { PaperStore } from '../src/paper/store.js';
import { applyFill, initialPaperState, restOrder } from '../src/paper/simulator.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
let counter = 0;
const store = () =>
  new PaperStore(join(homedir(), '.bloxwap', `paper-test-${process.pid}-${counter++}`));
test('store round-trips state and archives trades', async () => {
  const paper = store();
  await paper.reset(5000);
  expect((await paper.load()).startingBalance).toBe('5000');
  const oid = await paper.update((state) => {
    applyFill(state, {
      coin: 'BTC',
      side: 'B',
      sz: '1',
      px: '100',
      taker: true,
      builderFee: 10,
      now: 1,
    });
    return restOrder(state, {
      coin: 'BTC',
      side: 'A',
      sz: '1',
      limitPx: '101',
      reduceOnly: false,
      tif: 'Gtc',
      now: 2,
    }).oid;
  });
  expect(oid).toBe(1);
  const loaded = await paper.load();
  expect(loaded.positions[0].size).toBe('1');
  expect(loaded.orders[0].limitPx).toBe('101');
  expect(loaded.trades).toHaveLength(1);
  const archived = await paper.readTrades();
  expect(archived).toHaveLength(1);
  expect(archived[0]).toMatchObject({ px: '100', sz: '1' });
  const journal = await readFile(
    join(paper.directory, 'trades.jsonl'),
    'utf8',
  );
  expect(journal.trim().split('\n')).toHaveLength(1);
});
test('missing state starts at 10000 and reset restores a clean account', async () => {
  const paper = store();
  const fresh = await paper.load();
  expect(fresh).toMatchObject({
    version: 1,
    startingBalance: '10000',
    balance: '10000',
    positions: [],
    orders: [],
  });
  await paper.update((state) => {
    applyFill(state, {
      coin: 'BTC',
      side: 'B',
      sz: '1',
      px: '100',
      taker: true,
      builderFee: 10,
      now: 1,
    });
  });
  await paper.reset(250);
  const reset = await paper.load();
  expect(reset.balance).toBe('250');
  expect(reset.positions).toEqual([]);
  expect(await paper.readTrades()).toEqual([]);
});
test('updates serialize through the lock and compose', async () => {
  const paper = store();
  await paper.reset(1000);
  const first = paper.update(async (state) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    state.balance = '900';
    return 'first';
  });
  const second = paper.update((state) => {
    state.balance = '800';
    return 'second';
  });
  expect(await first).toBe('first');
  expect(await second).toBe('second');
  expect((await paper.load()).balance).toBe('800');
});
test('initialPaperState validates the starting balance', () => {
  expect(() => initialPaperState(0)).toThrow(
    expect.objectContaining({ code: 'CONFIG_INVALID' }),
  );
  expect(() => initialPaperState(-5)).toThrow(
    expect.objectContaining({ code: 'CONFIG_INVALID' }),
  );
});
