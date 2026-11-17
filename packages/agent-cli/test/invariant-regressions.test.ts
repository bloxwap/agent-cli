import { test, expect, vi, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import {
  migrate,
  stateDir,
  saveConfig,
  loadConfig,
  bindApproval,
} from '../src/core/config.js';
import { dispatch, commands } from '../src/core/router.js';
import { accountBalance } from '../src/commands/read.js';
import {
  advanceDeposit,
  pollDeposits,
  assertDepositsSettled,
} from '../src/funding/status.js';
import {
  writeDeposits,
  readDeposits,
  type Deposit,
} from '../src/funding/store.js';
import { fund, fundSchema } from '../src/commands/fund.js';
import {
  newApproval,
  resolvePendingApproval,
  submitFreshApproval,
} from '../src/wallet/approval.js';
import { PaperStore } from '../src/paper/store.js';
import {
  initialPaperState,
  applyFill,
  matchOrders,
  restOrder,
  positionOf,
} from '../src/paper/simulator.js';
import {
  paperExchange,
  paperTradingServices,
  paperAccountState,
  type PaperData,
} from '../src/paper/services.js';
import { quoteFixture, mockTrading, accountFixture } from './fixtures.js';
import { placeOrder, orderSchema } from '../src/commands/order.js';
import { Subscriptions } from '../src/runner/subscriptions.js';
import { Runner } from '../src/runner/lifecycle.js';
import { PaperEngine } from '../src/paper/engine.js';
import {
  audit,
  auditedAction,
  readAudit,
  verifyAudit,
} from '../src/core/audit.js';
import { readEvents } from '../src/runner/events.js';
import { tradeLockPath } from '../src/core/trading.js';
import '../src/commands/deposit.js';
import '../src/commands/config.js';
import '../src/commands/init.js';
import '../src/commands/market.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { prepareEoaAgent } from '../src/wallet/eoa.js';

let counter = 0;
const path = (name = 'state') =>
  join(stateDir(), `review-${counter++}-${name}`);
const master = '0x' + '12'.repeat(20);
const live = () =>
  migrate({
    approved: true,
    masterAddress: master,
    agentAddress: '0x' + 'ab'.repeat(20),
    agentExpiry: Date.now() + 86400000,
    approvedNetwork: 'testnet',
  });
const deposit = (extra: Partial<Deposit> = {}): Deposit => ({
  id: 'd',
  network: 'testnet',
  recipient: master,
  route: 'r',
  quote: quoteFixture,
  expiresAt: Date.now() + 60000,
  state: 'awaiting_funds',
  baseline: '0',
  createdAt: Date.now() - 1000,
  completedSteps: [],
  ...extra,
});
const data: PaperData = {
  book: async () => ({
    bids: [{ px: '99', sz: '1' }],
    asks: [{ px: '100', sz: '1' }],
  }),
  marks: async () => ({ BTC: '100' }),
  mids: async () => ({ BTC: '100' }),
  fundingRates: async () => ({ BTC: '0' }),
  coinOfAsset: async () => 'BTC',
  maxLeverageOf: async () => 40,
};
const fill = (extra = {}) => ({
  coin: 'BTC',
  side: 'B' as const,
  sz: '1',
  px: '100',
  taker: true,
  builderFee: 0,
  now: Date.now(),
  ...extra,
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubGlobal('fetch', async () => {
    throw new Error('Unmocked network');
  });
});

test('pending deposits remain blocking after quote expiry and unknown status', async () => {
  const p = path();
  const d = deposit({ state: 'pending', expiresAt: Date.now() - 1000000 });
  expect(advanceDeposit(d, 'unknown')).toBe('pending');
  await writeDeposits([d], p);
  await expect(
    assertDepositsSettled('testnet', master, p),
  ).rejects.toMatchObject({ code: 'DEPOSIT_PENDING' });
});

test('a pending deposit reuses its own attributed credit when Relay succeeds', async () => {
  const p = path();
  const d = deposit();
  await writeDeposits([d], p);
  let relayStatus = 'pending';
  const options = {
    path: p,
    relay: {
      status: async () => ({
        status: relayStatus,
        txHashes: ['credit'],
        destinationChainId: 1337,
      }),
    } as never,
    ledger: async () => [
      {
        time: Date.now(),
        hash: 'credit',
        delta: { type: 'deposit', usdc: '1' },
      },
    ],
  };
  await pollDeposits('testnet', master, '1', options);
  expect((await readDeposits(p))[0]).toMatchObject({
    state: 'pending',
    ledgerHash: 'credit',
  });
  relayStatus = 'success';
  await pollDeposits('testnet', master, '1', options);
  expect((await readDeposits(p))[0].state).toBe('settled');
});

test('paper deposit command rejects before submitting any Relay signature', async () => {
  const d = deposit();
  d.quote = {
    ...quoteFixture,
    steps: [
      {
        id: 'sign',
        kind: 'signature',
        items: [
          {
            status: 'incomplete',
            data: {
              sign: {},
              post: { method: 'POST', endpoint: '/execute', body: {} },
            },
          },
        ],
      },
    ],
  };
  await writeDeposits([d]);
  const fetcher = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  const result = await dispatch([
    'deposit',
    '--paper',
    '--json',
    JSON.stringify({
      depositId: 'd',
      stepId: 'sign:0',
      signature: '0x' + '11'.repeat(65),
    }),
  ]);
  expect(result.body).toMatchObject({
    ok: false,
    code: 'CONFIG_INVALID',
    mode: 'paper',
  });
  expect(fetcher).not.toHaveBeenCalled();
  await writeDeposits([]);
});

test('cached quote requests include origin decimals and are revalidated', async () => {
  const p = path();
  const config = migrate({ masterAddress: master });
  const relay = {
    quote: vi.fn(async () => ({
      ...structuredClone(quoteFixture),
      details: { ...quoteFixture.details, recipient: master },
    })),
  } as never;
  const options = {
    path: p,
    relay,
    baseline: async () => '0',
    qr: async () => ({ qrAscii: null, qrPath: null }),
  };
  await fund(
    config,
    fundSchema.parse({ amount: '10', originDecimals: 6, qr: false }),
    options,
  );
  await expect(
    fund(
      config,
      fundSchema.parse({
        amount: '0.00000000001',
        originDecimals: 18,
        qr: false,
      }),
      options,
    ),
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
});

test('nonce rejection forces a new payload even when the rejected payload is fresh', async () => {
  const p = path();
  const wallet = privateKeyToAccount(generatePrivateKey());
  const config = migrate({ masterAddress: wallet.address });
  const create = vi.fn(() =>
    newApproval(config, 'approveAgent', {
      agentAddress: '0x' + 'a'.repeat(40),
      agentName: 'agent',
    }),
  );
  const pending = await resolvePendingApproval(p, create);
  vi.stubGlobal('fetch', async () =>
    Response.json({ status: 'err', response: 'nonce already used' }),
  );
  const signature = await wallet.signTypedData(
    pending.approval.typedData as Parameters<typeof wallet.signTypedData>[0],
  );
  await expect(
    submitFreshApproval('testnet', p, pending, signature, create),
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  const next = JSON.parse(await readFile(p, 'utf8'));
  expect(next.approval.action.nonce).toBeGreaterThan(
    pending.approval.action.nonce as number,
  );
  expect(create).toHaveBeenCalledTimes(2);
});

test('master override cannot inherit another account approval', async () => {
  const p = path();
  await saveConfig(live(), p);
  await expect(
    loadConfig(p, { BLOXWAP_MASTER_ADDRESS: '0x' + '34'.repeat(20) }),
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
});

test('marketable sell exposure is bounded using the current market value', async () => {
  const services = mockTrading();
  services.state = async () => ({ ...accountFixture, assetPositions: [] });
  const config = live();
  config.limits = { maxNotional: 100, maxPositionNotional: 100 };
  await expect(
    placeOrder(
      config,
      orderSchema.parse({ coin: 'BTC', side: 'sell', size: '1', price: '20' }),
      services,
    ),
  ).rejects.toMatchObject({ code: 'POLICY_REJECTED' });
  expect(services.exchange.order).not.toHaveBeenCalled();
});

test('same cloid rejects a different canonical order request', async () => {
  const services = mockTrading();
  const config = live();
  const cloid = '0x' + 'af'.repeat(16);
  await placeOrder(
    config,
    orderSchema.parse({
      coin: 'BTC',
      side: 'buy',
      size: '0.001',
      price: '20000',
      cloid,
    }),
    services,
  );
  await expect(
    placeOrder(
      config,
      orderSchema.parse({
        coin: 'ETH',
        side: 'sell',
        size: '999',
        price: '1',
        cloid,
      }),
      services,
    ),
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  expect(services.exchange.order).toHaveBeenCalledTimes(1);
});

test('failed emission leaves a fill retryable in the same subscriber', async () => {
  const emit = vi.fn(async (): Promise<void> => {
    throw new Error('disk full');
  });
  const s = new Subscriptions(
    new Runner(live(), path()),
    {
      subscribe: async () => ({ unsubscribe: async () => {} }),
      onState: () => {},
      close: async () => {},
      gap: async () => [],
    },
    emit,
  );
  const f = { tid: 5, time: Date.now() };
  await expect(s.fill(f)).rejects.toThrow('disk full');
  emit.mockResolvedValueOnce(undefined);
  await s.fill(f);
  expect(emit).toHaveBeenCalledTimes(2);
});

test('order audit repairs a torn tail before reading linkage or the chain', async () => {
  await mkdir(stateDir(), { recursive: true });
  await appendFile(audit.path, '{"torn":');
  await expect(
    auditedAction('order', {}, async () => ({}), { paper: false }),
  ).resolves.toEqual({});
  expect(verifyAudit(await readAudit())).toBe(true);
});

test('paper reversal prices residual exposure at the reversal fill', () => {
  const state = initialPaperState(10000);
  applyFill(state, fill());
  applyFill(state, fill({ side: 'A', sz: '3', px: '200' }));
  expect(positionOf(state, 'BTC')).toMatchObject({
    size: '-2',
    entryPx: '200',
  });
});

test('reduce-only trigger cancels if the position sign changed', () => {
  const state = initialPaperState(10000);
  applyFill(state, fill({ side: 'A' }));
  restOrder(state, {
    coin: 'BTC',
    side: 'A',
    sz: '1',
    limitPx: '90',
    reduceOnly: true,
    tif: 'Gtc',
    isTrigger: true,
    triggerPx: '95',
    triggerIsMarket: true,
    tpsl: 'sl',
    now: 1,
  });
  matchOrders(
    state,
    'BTC',
    { markPx: '90' },
    { bids: [{ px: '90', sz: '5' }], asks: [] },
    0,
    2,
  );
  expect(positionOf(state, 'BTC')?.size).toBe('-1');
});

test('trigger without a book waits without manufacturing a fill', () => {
  const state = initialPaperState(10000);
  applyFill(state, fill());
  restOrder(state, {
    coin: 'BTC',
    side: 'A',
    sz: '5',
    limitPx: '90',
    reduceOnly: true,
    tif: 'Gtc',
    isTrigger: true,
    triggerPx: '95',
    triggerIsMarket: true,
    tpsl: 'sl',
    now: 1,
  });
  matchOrders(state, 'BTC', { markPx: '90' }, null, 0, 2);
  expect(positionOf(state, 'BTC')?.size).toBe('1');
  expect(state.orders).toHaveLength(1);
});

test('paper archive keeps advancing beyond the 500-trade display buffer', async () => {
  const store = new PaperStore(path());
  await store.reset(100000);
  const full = await store.load();
  for (let i = 0; i < 500; i++) applyFill(full, fill());
  await writeFile(store.statePath, JSON.stringify(full));
  await store.update((state) => applyFill(state, fill()));
  expect((await store.load()).trades.at(-1)?.tid).toBe(501);
  expect((await store.readTrades()).at(-1)?.tid).toBe(501);
  expect((await store.load()).trades).toHaveLength(500);
});

test('crossed post-only orders reject without a fill', async () => {
  const store = new PaperStore(path());
  await store.reset(10000);
  const exchange = paperExchange(migrate({ mode: 'paper' }), store, data);
  await expect(
    exchange.order({
      orders: [
        {
          a: 0,
          b: true,
          p: '100',
          s: '1',
          r: false,
          t: { limit: { tif: 'Alo' } },
        },
      ],
    }),
  ).rejects.toMatchObject({ code: 'POLICY_REJECTED' });
  expect((await store.load()).trades).toHaveLength(0);
});

test('paper GTC retains the unfilled remainder after crossing', async () => {
  const store = new PaperStore(path());
  await store.reset(10000);
  const exchange = paperExchange(migrate({ mode: 'paper' }), store, data);
  await exchange.order({
    orders: [
      {
        a: 0,
        b: true,
        p: '100',
        s: '2',
        r: false,
        t: { limit: { tif: 'Gtc' } },
      },
    ],
  });
  const state = await store.load();
  expect(state.positions[0].size).toBe('1');
  expect(state.orders).toMatchObject([{ sz: '2', filledSz: '1' }]);
});

test('modifying a dormant trigger preserves activation semantics', async () => {
  const store = new PaperStore(path());
  await store.reset(10000);
  await store.update((state) =>
    restOrder(state, {
      coin: 'BTC',
      side: 'B',
      sz: '1',
      limitPx: '100',
      reduceOnly: false,
      tif: 'Gtc',
      isTrigger: true,
      triggerPx: '150',
      tpsl: 'sl',
      triggerIsMarket: true,
      now: 1,
    }),
  );
  const exchange = paperExchange(migrate({ mode: 'paper' }), store, data);
  await exchange.batchModify({
    modifies: [
      {
        oid: 1,
        order: {
          a: 0,
          b: true,
          p: '100',
          s: '1',
          r: false,
          t: { trigger: { isMarket: true, triggerPx: '150', tpsl: 'sl' } },
        },
      },
    ],
  });
  expect((await store.load()).positions).toHaveLength(0);
  expect((await store.load()).orders[0].isTrigger).toBe(true);
});

test('resting orders recheck available margin at each fill', () => {
  const state = initialPaperState(100);
  for (let i = 0; i < 3; i++)
    restOrder(state, {
      coin: 'BTC',
      side: 'B',
      sz: '1',
      limitPx: '99',
      reduceOnly: false,
      tif: 'Gtc',
      now: 1,
    });
  matchOrders(state, 'BTC', { bestAsk: '99' }, null, 0, 2);
  expect(positionOf(state, 'BTC')?.size).toBe('1');
  expect(state.orders).toHaveLength(0);
});

test('paper fractional fees remain readable as exact account units', () => {
  const state = initialPaperState(10000);
  applyFill(state, fill({ px: '0.12345' }));
  const account = paperAccountState(state, { BTC: '0.12345' }, () => 40);
  expect(() => accountBalance(account)).not.toThrow();
  expect(accountBalance(account).accountValueUnits).toMatch(/^\d+$/);
});

test('paper risk path persists its UTC-day rollover', async () => {
  const store = new PaperStore(path());
  await store.reset(10000);
  await store.update((state) => {
    state.dayStartAt = Date.now() - 3 * 86400000;
    state.balance = '9900';
    state.realizedPnl = '-100';
  });
  expect(
    await paperTradingServices(migrate({ mode: 'paper' }), store, data)
      .dailyLoss!(),
  ).toBe('0');
  expect((await store.load()).dayStartAt).toBe(
    Math.floor(Date.now() / 86400000) * 86400000,
  );
});

test('direct paper exchange fills have durable events', async () => {
  const store = new PaperStore(path());
  await store.reset(10000);
  const journal = join(store.directory, 'events.jsonl');
  await paperTradingServices(
    migrate({ mode: 'paper' }),
    store,
    data,
  ).exchange.order({
    orders: [
      {
        a: 0,
        b: true,
        p: '100',
        s: '1',
        r: false,
        t: { limit: { tif: 'Ioc' } },
      },
    ],
  });
  expect((await store.load()).trades).toHaveLength(1);
  expect(
    (await readEvents(journal)).filter((e) => e.type === 'fill'),
  ).toHaveLength(1);
});

test('paper consumes SDK trade arrays and BBO snapshots', async () => {
  const store = new PaperStore(path());
  await store.reset(10000);
  await store.update((state) =>
    restOrder(state, {
      coin: 'BTC',
      side: 'B',
      sz: '1',
      limitPx: '99',
      reduceOnly: false,
      tif: 'Gtc',
      now: 1,
    }),
  );
  const listeners = new Map<string, (data: unknown) => void>();
  const runner = new Runner(migrate({ mode: 'paper' }), path());
  const backend = {
    subscribe: async (
      type: string,
      _params: unknown,
      listener: (data: unknown) => void,
    ) => {
      listeners.set(type, listener);
      return { unsubscribe: async () => {} };
    },
    onState: () => {},
    close: async () => {},
  };
  const engine = new PaperEngine(runner, store, backend, async () => {}, data);
  await engine.start();
  try {
    await engine.flush();
    listeners.get('trades')!([
      { coin: 'BTC', px: '98', side: 'A', time: Date.now() },
    ]);
    await engine.flush();
    expect((await store.load()).trades).toHaveLength(1);
    await store.update((state) =>
      restOrder(state, {
        coin: 'BTC',
        side: 'B',
        sz: '1',
        limitPx: '99',
        reduceOnly: false,
        tif: 'Gtc',
        now: Date.now(),
      }),
    );
    listeners.get('bbo')!({
      coin: 'BTC',
      bbo: [
        { px: '97', sz: '5' },
        { px: '98', sz: '5' },
      ],
      time: Date.now(),
    });
    await engine.flush();
    expect((await store.load()).orders).toHaveLength(0);
    expect((await store.load()).trades).toHaveLength(2);
  } finally {
    await runner.shutdown();
  }
});

test('paper configurations serialize on the same store lock', () => {
  expect(tradeLockPath(migrate({ mode: 'paper', masterAddress: master }))).toBe(
    tradeLockPath(migrate({ mode: 'paper' })),
  );
});

test('small numeric limits compare exactly instead of failing decimal parsing', async () => {
  const config = live();
  config.limits = { maxOrderSize: 1e-7 };
  const services = mockTrading();
  services.market = async () => ({
    name: 'BTC',
    asset: 0,
    szDecimals: 6,
    maxLeverage: 40,
  });
  await expect(
    placeOrder(
      config,
      orderSchema.parse({
        coin: 'BTC',
        side: 'buy',
        size: '0.000001',
        price: '100',
      }),
      services,
    ),
  ).rejects.toMatchObject({
    code: 'POLICY_REJECTED',
    details: expect.objectContaining({ limit: 'maxOrderSize' }),
  });
});

test('a config captured before revocation is refreshed under the trade lock', async () => {
  const p = path();
  const config = live();
  await saveConfig(config, p);
  const revoked = { ...config, approved: false, revoked: true };
  await saveConfig(revoked, p);
  const services = mockTrading();
  await expect(
    placeOrder(
      config,
      orderSchema.parse({
        coin: 'BTC',
        side: 'buy',
        size: '0.001',
        price: '20000',
      }),
      services,
    ),
  ).rejects.toMatchObject({ code: 'AGENT_NOT_APPROVED' });
  expect(services.exchange.order).not.toHaveBeenCalled();
});

test('init cannot claim an extended approval until the exchange verifies it', async () => {
  const p = path();
  const key = generatePrivateKey();
  vi.stubEnv('BLOXWAP_REVIEW_EOA', key);
  const config = live();
  config.agentAddress = privateKeyToAccount(key).address;
  config.eoaKeyRef = 'env:BLOXWAP_REVIEW_EOA';
  bindApproval(config);
  await saveConfig(config, p);
  const oldExpiry = config.agentExpiry;
  const types: string[] = [];
  vi.stubGlobal('fetch', async (_url: unknown, request: RequestInit) => {
    const type = JSON.parse(String(request.body)).type;
    types.push(type);
    return Response.json(
      type === 'extraAgents'
        ? [{ address: config.agentAddress, validUntil: oldExpiry }]
        : {},
    );
  });
  const nextExpiry = Date.now() + 10 * 86400000;
  const result = await commands
    .get('init')!
    .execute(
      { validUntil: nextExpiry, qr: false },
      { pretty: false, configPath: p },
    );
  expect(result).toMatchObject({ approved: false, requiresSignature: true });
  expect((await loadConfig(p)).approved).toBe(false);
  expect(types).toContain('extraAgents');
});

test('rotation prepares keys without saving a scratch config or sharing its revision', async () => {
  const p = path();
  const key = generatePrivateKey();
  vi.stubEnv('BLOXWAP_REVIEW_EOA', key);
  const config = migrate({
    ...live(),
    approved: false,
    revision: 10,
    agentAddress: undefined,
    eoaKeyRef: 'env:BLOXWAP_REVIEW_EOA',
  });
  await prepareEoaAgent(config, null);
  expect(config.revision).toBe(10);
  const next = { ...config, revision: 11, agentAddress: undefined };
  await prepareEoaAgent(next, null);
  expect(next.revision).toBe(11);
  await expect(readFile(p)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('paper market discovery always uses mainnet data', async () => {
  const p = path();
  await saveConfig(migrate({ network: 'testnet' }), p);
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: unknown, request: RequestInit) => {
    urls.push(String(url));
    const type = JSON.parse(String(request.body)).type;
    return Response.json(
      type === 'meta'
        ? { universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }] }
        : { BTC: '20000' },
    );
  });
  const result = await dispatch([
    'market',
    '--paper',
    '--config',
    p,
    '--coin',
    'BTC',
  ]);
  expect(result.body).toMatchObject({ ok: true, mode: 'paper' });
  expect(urls.every((url) => url.includes('api.hyperliquid.xyz'))).toBe(true);
});

test('paper preserves a canceled cloid for the entire session', async () => {
  const store = new PaperStore(path());
  await store.reset(10000);
  const services = paperTradingServices(
    migrate({ mode: 'paper' }),
    store,
    data,
  );
  const cloid = '0x' + 'ab'.repeat(16);
  await services.exchange.order({
    orders: [
      {
        a: 0,
        b: true,
        p: '98',
        s: '1',
        r: false,
        t: { limit: { tif: 'Gtc' } },
        c: cloid,
      },
    ],
  });
  expect(await services.orderByCloid(cloid)).not.toBeNull();
  await services.exchange.cancel({ cancels: [{ a: 0, o: 1 }] });
  expect(await services.orderByCloid(cloid)).not.toBeNull();
});
