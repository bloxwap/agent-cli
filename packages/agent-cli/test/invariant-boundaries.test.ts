import { afterEach, expect, test, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  stateDir,
  migrate,
  saveConfig,
  loadConfig,
} from '../src/core/config.js';
import { paperDir } from '../src/core/mode.js';
import { checkRisk, withTradeLock } from '../src/core/trading.js';
import { requestContext } from '../src/core/request-context.js';
import { dispatch } from '../src/core/router.js';
import { executionScope } from '../src/core/operations.js';
import { EventStore, followEvents, readEvents } from '../src/runner/events.js';
import { PaperStore } from '../src/paper/store.js';
import {
  initialPaperState,
  applyFill,
  restOrder,
  matchOrders,
} from '../src/paper/simulator.js';
import { abandonDeposit } from '../src/funding/status.js';
import {
  readDeposits,
  writeDeposits,
  type Deposit,
} from '../src/funding/store.js';
import { mockTrading, quoteFixture } from './fixtures.js';
import '../src/commands/rotate.js';
let counter = 0;
const path = () => join(stateDir(), `boundary-${counter++}`);
const fill = {
  coin: 'BTC',
  side: 'B' as const,
  sz: '1',
  px: '100',
  taker: true,
  builderFee: 0,
  now: Date.now(),
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', async () => {
    throw new Error('Unmocked network');
  });
});

test('paper balance must reconcile with its persisted cash movements', async () => {
  const store = new PaperStore(path());
  await store.reset(1000);
  const state = await store.load();
  state.balance = '1001';
  await writeFile(store.statePath, JSON.stringify(state));
  await expect(store.load()).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
});
test('the fill boundary rejects increasing reduce-only exposure and caps closing size', () => {
  const state = initialPaperState(1000);
  applyFill(state, fill);
  expect(() => applyFill(state, { ...fill, reduceOnly: true })).toThrow();
  const closed = applyFill(state, {
    ...fill,
    side: 'A',
    sz: '5',
    reduceOnly: true,
  });
  expect(closed.sz).toBe('1');
  expect(state.positions).toEqual([]);
});
test('cached market data predating placement cannot fill a newer order', () => {
  const state = initialPaperState(1000),
    now = Date.now();
  restOrder(state, {
    coin: 'BTC',
    side: 'B',
    sz: '1',
    limitPx: '100',
    reduceOnly: false,
    tif: 'Gtc',
    now,
  });
  const tick = {
    coin: 'BTC',
    bestAsk: '99',
    bookTime: now - 1,
    lastTradePx: '99',
    tradeTime: now - 1,
  };
  matchOrders(state, 'BTC', tick, null, 0, now + 1);
  expect(state.trades).toEqual([]);
  matchOrders(state, 'BTC', { ...tick, bookTime: now + 1 }, null, 0, now + 2);
  expect(state.trades).toHaveLength(1);
});
test('all trading mutations reject a paper epoch change while waiting', async () => {
  const config = migrate({ mode: 'paper' }),
    store = new PaperStore();
  await store.reset(1000);
  const scope = await executionScope(config);
  await store.reset(1000);
  const mutation = vi.fn(async () => {});
  await expect(
    requestContext.run({ intentId: 'pending', mode: 'paper', scope }, () =>
      withTradeLock(config, mutation),
    ),
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  expect(mutation).not.toHaveBeenCalled();
});
test('paper risk rejections log inside the paper state directory', async () => {
  const config = migrate({ mode: 'paper', limits: { maxOrderSize: 0.5 } });
  await expect(
    checkRisk(
      config,
      {
        coin: 'BTC',
        side: 'buy',
        size: '1',
        price: '20000',
        leverage: 1,
        reduceOnly: false,
      },
      mockTrading(),
    ),
  ).rejects.toMatchObject({ code: 'POLICY_REJECTED' });
  expect(
    await readFile(join(paperDir(), 'logs', 'runner.jsonl'), 'utf8'),
  ).toContain('Risk rejected');
  await expect(
    readFile(join(stateDir(), 'logs', 'runner.jsonl')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});
test('event followers can advance to a reset session without restarting their cursor', async () => {
  const store = new EventStore(path(), true),
    abort = new AbortController(),
    received: number[] = [];
  let scope = 'paper:first';
  await store.append('runner_state', { scope });
  const followed = followEvents({
    path: store.path,
    scope: async () => scope,
    interval: 1,
    signal: abort.signal,
    write: (event) => {
      received.push(event.seq);
      if (received.length === 1) scope = 'paper:second';
      else abort.abort();
    },
  });
  try {
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await store.append('runner_state', { scope: 'paper:second' });
    await vi.waitFor(() => expect(received).toEqual([1, 2]));
  } finally {
    abort.abort();
    await followed;
  }
});
test('rotation resumes a remote approval only after the replacement key can be opened', async () => {
  const oldKey = generatePrivateKey(),
    nextKey = generatePrivateKey();
  const old = privateKeyToAccount(oldKey),
    next = privateKeyToAccount(nextKey);
  vi.stubEnv('BLOXWAP_BOUNDARY_OLD_KEY', oldKey);
  vi.stubEnv('BLOXWAP_BOUNDARY_NEXT_KEY', nextKey);
  const configPath = path();
  await saveConfig(
    migrate({
      masterAddress: privateKeyToAccount(generatePrivateKey()).address,
      agentAddress: old.address,
      eoaKeyRef: 'env:BLOXWAP_BOUNDARY_OLD_KEY',
      approved: true,
      approvedNetwork: 'testnet',
      agentExpiry: Date.now() + 86400000,
    }),
    configPath,
  );
  let agents: { address: string; validUntil: number }[] = [];
  const post = vi.fn();
  vi.stubGlobal('fetch', async (_url: unknown, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    if (body.type === 'extraAgents') return Response.json(agents);
    post();
    throw new Error('Rotation must reconcile without resubmitting approval');
  });
  const prepared = await dispatch([
    'rotate',
    '--config',
    configPath,
    '--eoa-key-ref',
    'env:BLOXWAP_BOUNDARY_NEXT_KEY',
  ]);
  expect(prepared.body).toMatchObject({ ok: true, data: { swapped: false } });
  agents = [{ address: next.address, validUntil: Date.now() + 180 * 86400000 }];
  vi.stubEnv('BLOXWAP_BOUNDARY_NEXT_KEY', '');
  const failed = await dispatch(['rotate', '--config', configPath]);
  expect(failed.body).toMatchObject({ ok: false });
  expect((await loadConfig(configPath)).agentAddress).toBe(old.address);
  vi.stubEnv('BLOXWAP_BOUNDARY_NEXT_KEY', nextKey);
  const resumed = await dispatch(['rotate', '--config', configPath]);
  expect(resumed.body).toMatchObject({ ok: true, data: { swapped: true } });
  expect((await loadConfig(configPath)).agentAddress).toBe(next.address);
  expect(post).not.toHaveBeenCalled();
});

test('deposit selection scopes identical request IDs to their account and network', async () => {
  const file = path();
  const first: Deposit = {
    id: 'shared-id',
    network: 'testnet',
    recipient: '0x' + '1'.repeat(40),
    route: 'route',
    quote: structuredClone(quoteFixture),
    expiresAt: Date.now() + 60000,
    createdAt: Date.now(),
    baseline: '0',
    state: 'pending',
    completedSteps: [],
  };
  const second: Deposit = { ...structuredClone(first), network: 'mainnet' };
  await writeDeposits([first, second], file);
  await expect(abandonDeposit(first.id, file)).rejects.toMatchObject({
    code: 'CONFIG_INVALID',
  });
  await abandonDeposit(second.id, file, second);
  expect((await readDeposits(file)).map((d) => d.state)).toEqual([
    'pending',
    'abandoned',
  ]);
});

test('runner metadata scopes array-shaped events without changing their payload', async () => {
  const store = new EventStore(path()),
    payload = [{ oid: 42, status: 'canceled' }];
  await store.append('order_update', payload, { scope: 'mainnet:account' });
  expect(
    await readEvents(store.path, 0, [], 200, 'mainnet:account'),
  ).toMatchObject([{ scope: 'mainnet:account', data: payload }]);
  expect(await readEvents(store.path, 0, [], 200, 'testnet:account')).toEqual(
    [],
  );
});
