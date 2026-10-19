import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runner } from '../src/runner/lifecycle.js';
import { PaperEngine } from '../src/paper/engine.js';
import { PaperStore } from '../src/paper/store.js';
import { applyFill, restOrder } from '../src/paper/simulator.js';
import type { PaperData } from '../src/paper/services.js';
import { migrate } from '../src/core/config.js';
interface Listener {
  type: string;
  coin: string;
  listener: (data: unknown) => void;
}
function fakeBackend() {
  const listeners: Listener[] = [];
  return {
    listeners,
    backend: {
      subscribe: async (
        type: string,
        params: Record<string, unknown>,
        listener: (data: unknown) => void,
      ) => {
        const entry = { type, coin: params.coin as string, listener };
        listeners.push(entry);
        return {
          unsubscribe: async () => {
            listeners.splice(listeners.indexOf(entry), 1);
          },
        };
      },
      onState: () => {},
      close: async () => {},
    },
    push: (type: string, coin: string, data: unknown) => {
      for (const entry of listeners)
        if (entry.type === type && entry.coin === coin) entry.listener(data);
    },
  };
}
const data = (marks: Record<string, string> = { BTC: '100' }): PaperData => ({
  book: async () => ({ bids: [], asks: [] }),
  marks: async () => marks,
  fundingRates: async () => ({ BTC: '0.0008' }),
  mids: async () => marks,
  coinOfAsset: async () => 'BTC',
  maxLeverageOf: async () => 40,
});
async function setup(options: { allowedMarkets?: string[]; marks?: Record<string, string> } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-engine-'));
  const runner = new Runner(
    migrate({ mode: 'paper', allowedMarkets: options.allowedMarkets ?? ['BTC'] }),
    dir,
  );
  const store = new PaperStore(join(dir, 'paper'));
  await store.reset(10_000);
  const backend = fakeBackend();
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const engine = new PaperEngine(
    runner,
    store,
    backend.backend,
    async (type, payload) => {
      events.push({ type, data: payload as Record<string, unknown> });
    },
    data(options.marks),
  );
  await engine.start();
  return { dir, runner, store, backend, events, engine };
}
test('engine subscribes to l2Book, trades and bbo for active coins', async () => {
  const { dir, runner, backend, engine } = await setup();
  try {
    expect(
      backend.listeners.map((listener) => `${listener.type}:${listener.coin}`).sort(),
    ).toEqual(['bbo:BTC', 'l2Book:BTC', 'trades:BTC']);
    await engine.flush();
  } finally {
    await runner.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
test('resting limit fills when a trade prints through the price', async () => {
  const { dir, runner, store, backend, events, engine } = await setup();
  try {
    await store.update((state) => {
      restOrder(state, {
        coin: 'BTC',
        side: 'B',
        sz: '1',
        limitPx: '99',
        reduceOnly: false,
        tif: 'Gtc',
        now: 1,
      });
    });
    backend.push('l2Book', 'BTC', {
      coin: 'BTC',
      levels: [[{ px: '98.5', sz: '5', n: 1 }], [{ px: '100', sz: '5', n: 1 }]],
    });
    await engine.flush();
    backend.push('trades', 'BTC', {
      coin: 'BTC',
      trades: [{ coin: 'BTC', px: '98.9', sz: '0.2', side: 'A' }],
    });
    await engine.flush();
    expect(events.some((event) => event.type === 'fill')).toBe(true);
    const fill = events.find((event) => event.type === 'fill')!;
    expect(fill.data).toMatchObject({ px: '99', sz: '1', paper: true });
    expect(
      events.some(
        (event) => event.type === 'order_update' && event.data.status === 'filled',
      ),
    ).toBe(true);
    const state = await store.load();
    expect(state.positions[0].size).toBe('1');
  } finally {
    await runner.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
test('l2Book deltas maintain the book and cross resting orders', async () => {
  const { dir, runner, store, backend, events, engine } = await setup();
  try {
    await store.update((state) => {
      restOrder(state, {
        coin: 'BTC',
        side: 'A',
        sz: '1',
        limitPx: '99.5',
        reduceOnly: false,
        tif: 'Gtc',
        now: 1,
      });
    });
    backend.push('l2Book', 'BTC', {
      coin: 'BTC',
      levels: [[{ px: '98', sz: '5', n: 1 }], [{ px: '100', sz: '5', n: 1 }]],
    });
    await engine.flush();
    backend.push('l2Book', 'BTC', {
      coin: 'BTC',
      side: 'B',
      levels: [[{ px: '99.6', sz: '2', n: 1 }]],
    });
    await engine.flush();
    expect(events.some((event) => event.type === 'fill')).toBe(true);
    expect((await store.load()).orders).toEqual([]);
  } finally {
    await runner.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
test('tick accrues funding and emits runner_state', async () => {
  const { dir, runner, store, events, engine } = await setup();
  try {
    await store.update((state) => {
      applyFill(state, {
        coin: 'BTC',
        side: 'B',
        sz: '1',
        px: '100',
        taker: true,
        builderFee: 10,
        now: Date.now() - 3_600_000,
      });
      state.lastFundingAt = Date.now() - 3_600_000;
    });
    await engine.tick();
    await engine.flush();
    const state = await store.load();
    expect(Number(state.fundingPaid)).toBeCloseTo(-0.08, 6);
    expect(
      events.some(
        (event) => event.type === 'position_change' && event.data.type === 'funding',
      ),
    ).toBe(true);
    expect(
      events.some((event) => event.type === 'runner_state'),
    ).toBe(true);
  } finally {
    await runner.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
test('tick liquidates leveraged positions that breach maintenance margin', async () => {
  const { dir, runner, store, events, engine } = await setup({ marks: { BTC: '70' } });
  try {
    await store.update((state) => {
      state.leverage.BTC = { type: 'cross', value: 40 };
      applyFill(state, {
        coin: 'BTC',
        side: 'B',
        sz: '400',
        px: '100',
        taker: true,
        builderFee: 10,
        now: 1,
      });
    });
    await engine.tick();
    await engine.flush();
    const state = await store.load();
    expect(state.positions).toEqual([]);
    expect(state.liquidations).toBe(1);
    expect(
      events.some(
        (event) => event.type === 'fill' && event.data.liquidation === true,
      ),
    ).toBe(true);
  } finally {
    await runner.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
test('subscriptions follow newly ordered coins and drop idle ones', async () => {
  const { dir, runner, store, backend, engine } = await setup({
    allowedMarkets: [],
  });
  try {
    expect(backend.listeners).toEqual([]);
    await store.update((state) => {
      restOrder(state, {
        coin: 'ETH',
        side: 'B',
        sz: '1',
        limitPx: '10',
        reduceOnly: false,
        tif: 'Gtc',
        now: 1,
      });
    });
    await engine.refreshSubscriptions();
    expect(
      backend.listeners.map((listener) => `${listener.type}:${listener.coin}`).sort(),
    ).toEqual(['bbo:ETH', 'l2Book:ETH', 'trades:ETH']);
    await store.update((state) => {
      state.orders = [];
    });
    await engine.refreshSubscriptions();
    expect(backend.listeners).toEqual([]);
  } finally {
    await runner.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
