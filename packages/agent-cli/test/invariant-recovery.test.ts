import { afterEach, expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { HttpRequestError } from '@bloxwap/hyperliquid';
import { ApiRequestError } from '@bloxwap/hyperliquid/api/exchange';
import {
  migrate,
  stateDir,
  saveConfig,
  loadConfig,
} from '../src/core/config.js';
import { mockTrading, quoteFixture } from './fixtures.js';
import { placeOrder, orderSchema } from '../src/commands/order.js';
import {
  exchangeAction,
  dailyLossFromPortfolio,
  withTradeLock,
  tradingServices,
} from '../src/core/trading.js';
import { orderRecord, executionScope } from '../src/core/operations.js';
import { auditedAction, audit, readAudit } from '../src/core/audit.js';
import { EventStore, readEvents } from '../src/runner/events.js';
import {
  newApproval,
  resolvePendingApproval,
  submitApproval,
} from '../src/wallet/approval.js';
import { PaperStore } from '../src/paper/store.js';
import {
  applyFill,
  accrueFunding,
  initialPaperState,
  dailyLoss,
  rolloverDay,
} from '../src/paper/simulator.js';
import { paperExchange, type PaperData } from '../src/paper/services.js';
import {
  writeDeposits,
  readDeposits,
  type Deposit,
} from '../src/funding/store.js';
import { pollDeposits, assertDepositsSettled } from '../src/funding/status.js';
import { submitDepositSignature } from '../src/funding/signatures.js';
import { Subscriptions } from '../src/runner/subscriptions.js';
import { PaperEngine } from '../src/paper/engine.js';
import { Runner, setActiveRunner } from '../src/runner/lifecycle.js';
import { dispatch, setRouting } from '../src/core/router.js';
let counter = 0;
const path = () => join(stateDir(), `recovery-${counter++}`);
const config = () =>
  migrate({
    approved: true,
    approvedNetwork: 'testnet',
    masterAddress: `0x${(++counter).toString(16).padStart(40, '0')}`,
    agentAddress: '0x' + 'b'.repeat(40),
    agentExpiry: Date.now() + 86400000,
  });
const order = (cloid?: string) =>
  orderSchema.parse({
    coin: 'BTC',
    side: 'buy',
    size: '0.001',
    price: '20000',
    cloid,
  });
const fill = (now = Date.now()) => ({
  coin: 'BTC',
  side: 'B' as const,
  sz: '1',
  px: '100',
  taker: true,
  builderFee: 0,
  now,
});
const data: PaperData = {
  book: async () => ({
    bids: [{ px: '99', sz: '5' }],
    asks: [{ px: '100', sz: '5' }],
  }),
  marks: async () => ({ BTC: '100' }),
  mids: async () => ({ BTC: '100' }),
  fundingRates: async () => ({ BTC: '0' }),
  coinOfAsset: async () => 'BTC',
  maxLeverageOf: async () => 40,
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setRouting(undefined);
  setActiveRunner(undefined);
  vi.stubGlobal('fetch', async () => {
    throw new Error('Unmocked network');
  });
});

test('unknown orders block resubmission and new exposure until positively reconciled', async () => {
  const c = config(),
    services = mockTrading(),
    input = order('0x' + '11'.repeat(16));
  services.exchange.order = vi.fn(async () => {
    throw new HttpRequestError({ detail: 'Request timed out after 10000 ms' });
  });
  await expect(placeOrder(c, input, services)).rejects.toMatchObject({
    code: 'NETWORK_ERROR',
    retryable: false,
    details: { outcome: 'unknown', cloid: input.cloid },
  });
  expect(
    (await orderRecord(await executionScope(c), input.cloid!))?.state,
  ).toBe('submitting');
  await expect(placeOrder(c, input, services)).rejects.toMatchObject({
    details: { outcome: 'unknown' },
  });
  await expect(placeOrder(c, order(), services)).rejects.toMatchObject({
    details: { outcome: 'unknown' },
  });
  expect(services.exchange.order).toHaveBeenCalledTimes(1);
  services.orderByCloid = async () => ({
    status: 'ok',
    response: { data: { statuses: [{ resting: { oid: 42 } }] } },
  });
  expect((await placeOrder(c, input, services)).idempotent).toBe(true);
  expect(services.exchange.order).toHaveBeenCalledTimes(1);
});

test('client persists order identity before handing work to RPC', async () => {
  const c = config(),
    file = path();
  await saveConfig(c, file);
  let identity: string | undefined;
  setRouting(async (_name, input) => {
    identity = input.cloid as string;
    expect(await orderRecord(await executionScope(c), identity)).toMatchObject({
      state: 'prepared',
      intentId: input.intentId,
    });
    return { routed: true, data: { cloid: identity } };
  });
  const result = await dispatch([
    'order',
    '--config',
    file,
    '--json',
    JSON.stringify(order()),
  ]);
  expect(result.body).toMatchObject({ ok: true, data: { cloid: identity } });
  expect(identity).toMatch(/^0x[0-9a-f]{32}$/);
});

test.each([false, true])(
  'mixed batch outcomes survive error normalization (SDK=%s)',
  async (sdk) => {
    const response = {
      status: 'ok',
      response: {
        data: {
          statuses: [
            'success',
            { error: 'Order not found' },
            { resting: { oid: 7 } },
          ],
        },
      },
    };
    await expect(
      exchangeAction('batchModify', async () => {
        if (sdk) throw new ApiRequestError(response);
        return response;
      }),
    ).rejects.toMatchObject({
      retryable: false,
      details: {
        outcome: 'partial',
        response,
        statuses: response.response.data.statuses,
      },
    });
  },
);

test('audit response failure preserves acceptance and the exact operation result', async () => {
  const original = audit.append.bind(audit);
  vi.spyOn(audit, 'append').mockImplementation((stage, ...args) =>
    stage === 'response'
      ? Promise.reject(new Error('disk full'))
      : original(stage, ...args),
  );
  await expect(
    auditedAction('cancel', {}, async () => ({ canceled: [7] })),
  ).rejects.toMatchObject({
    code: 'INTERNAL',
    retryable: false,
    details: { outcome: 'accepted', result: { canceled: [7] } },
  });
});

test('approval cache binds action fields and rejects a different wallet signature', async () => {
  const wallet = privateKeyToAccount(generatePrivateKey()),
    stranger = privateKeyToAccount(generatePrivateKey());
  const c = migrate({ masterAddress: wallet.address }),
    file = path();
  const first = await resolvePendingApproval(file, () =>
    newApproval(c, 'approveBuilderFee', {
      builder: c.builder.address,
      maxFeeRate: '0.01%',
    }),
  );
  const next = await resolvePendingApproval(file, () =>
    newApproval(c, 'approveBuilderFee', {
      builder: c.builder.address,
      maxFeeRate: '0.02%',
    }),
  );
  expect(next.approval.action.maxFeeRate).toBe('0.02%');
  expect(next.approval.action.nonce).not.toBe(first.approval.action.nonce);
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(
    submitApproval(
      'testnet',
      next.approval,
      await stranger.signTypedData(
        next.approval.typedData as Parameters<typeof stranger.signTypedData>[0],
      ),
    ),
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  expect(fetcher).not.toHaveBeenCalled();
});

test('cached runner signer cannot be used for another account', async () => {
  const runner = new Runner(config(), path());
  runner.signer = {
    address: runner.config.agentAddress as `0x${string}`,
    signTypedData: async () => '0x',
  };
  setActiveRunner(runner);
  await expect(tradingServices(config())).rejects.toMatchObject({
    code: 'CONFIG_INVALID',
  });
});

test('a tighter persisted policy is reloaded under the account lock', async () => {
  const c = config(),
    file = path();
  await saveConfig(c, file);
  const loaded = await loadConfig(file);
  loaded.limits.maxNotional = 1;
  await saveConfig(loaded, file);
  const services = mockTrading();
  await expect(placeOrder(c, order(), services)).rejects.toMatchObject({
    code: 'POLICY_REJECTED',
  });
  expect(services.exchange.order).not.toHaveBeenCalled();
});

function deposit(id: string, recipient: string): Deposit {
  return {
    id,
    network: 'testnet',
    recipient,
    route: id,
    quote: quoteFixture,
    expiresAt: Date.now() + 60000,
    state: 'pending',
    baseline: '0',
    createdAt: Date.now() - 1000,
    completedSteps: [],
  };
}
test('unrelated ledger credits cannot settle a deposit and one transaction cannot settle two intents', async () => {
  const file = path(),
    recipient = config().masterAddress!;
  await writeDeposits([deposit('a', recipient), deposit('b', recipient)], file);
  const ledger = async () => [
    {
      time: Date.now(),
      hash: 'unrelated',
      delta: { type: 'deposit', usdc: '100' },
    },
  ];
  const relay = {
    status: async () => ({ status: 'success', txHashes: ['linked'] }),
  } as never;
  await Promise.all([
    pollDeposits('testnet', recipient, '100', { path: file, ledger, relay }),
    pollDeposits('testnet', recipient, '100', { path: file, ledger, relay }),
  ]);
  expect((await readDeposits(file)).map((d) => d.state)).toEqual([
    'pending',
    'pending',
  ]);
  await pollDeposits('testnet', recipient, '100', {
    path: file,
    relay,
    ledger: async () => [
      {
        time: Date.now(),
        hash: 'linked',
        delta: { type: 'deposit', usdc: '100' },
      },
    ],
  });
  expect((await readDeposits(file)).map((d) => d.state)).toEqual([
    'pending',
    'pending',
  ]);
});

test('signature step claims serialize callers and retain uncertain submissions', async () => {
  const file = path(),
    d = deposit('signed', config().masterAddress!);
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
  await writeDeposits([d], file);
  const submit = vi.fn(async () => {
    throw new Error('lost response');
  });
  const signature = '0x' + '11'.repeat(64) + '1b';
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      submitDepositSignature(d.id, 'sign:0', signature, { path: file, submit }),
    ),
  );
  expect(results.every((r) => r.status === 'rejected')).toBe(true);
  expect(submit).toHaveBeenCalledTimes(1);
  expect((await readDeposits(file))[0].stepClaims?.['sign:0'].state).toBe(
    'submitting',
  );
  const terminal = (await readDeposits(file))[0];
  terminal.state = 'abandoned';
  await writeDeposits([terminal], file);
  await expect(
    submitDepositSignature(d.id, 'sign:0', signature, { path: file, submit }),
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
});

test('corrupt persisted safety state fails closed', async () => {
  const file = path();
  await mkdir(stateDir(), { recursive: true });
  await writeFile(
    file,
    JSON.stringify([
      { ...deposit('bad', config().masterAddress!), state: 'typo' },
    ]),
  );
  await expect(
    assertDepositsSettled('testnet', config().masterAddress!, file),
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  const store = new PaperStore(path());
  await store.reset(100);
  const state = await store.load();
  state.nextTid = 0;
  await writeFile(store.statePath, JSON.stringify(state));
  await expect(store.load()).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
});

test('paper outbox survives publication failure and retries once in both journals', async () => {
  const store = new PaperStore(path());
  await store.reset(1000);
  const eventStore = new EventStore(
    join(store.directory, 'events.jsonl'),
    true,
  );
  const emitter = vi.fn(async (): Promise<void> => {
    throw new Error('publication offline');
  });
  store.setEmitter(emitter);
  await store.update((state) => applyFill(state, fill()));
  const persisted = JSON.parse(await readFile(store.statePath, 'utf8'));
  expect(persisted.positions).toHaveLength(1);
  expect(
    persisted.outbox.some((e: { type: string }) => e.type === 'fill'),
  ).toBe(true);
  store.setEmitter(async (type, payload) => {
    await eventStore.append(type as never, payload);
  });
  await store.load();
  await store.load();
  expect((await store.readTrades()).length).toBe(1);
  expect(
    (await readEvents(eventStore.path)).filter((e) => e.type === 'fill'),
  ).toHaveLength(1);
  expect(
    (await readAudit(join(stateDir(), 'paper', 'audit.jsonl'))).filter(
      (e) => e.scope === `paper:${persisted.sessionId}` && e.stage === 'fill',
    ),
  ).toHaveLength(1);
});

test('paper reset changes scope while preserving monotonic event cursors', async () => {
  const store = new PaperStore(path());
  await store.reset(1000);
  await store.update((state) => applyFill(state, fill()));
  const previous = await store.load(),
    journal = join(store.directory, 'events.jsonl');
  const cursor = (await readEvents(journal)).at(-1)!.seq;
  await store.reset(1000);
  await store.update((state) => applyFill(state, fill()));
  const next = await store.load();
  expect(next.sessionId).not.toBe(previous.sessionId);
  expect(
    (await readEvents(journal, cursor)).filter((e) => e.type === 'fill'),
  ).toHaveLength(1);
  expect(await store.readTrades()).toHaveLength(1);
});

test('paper fills settle only the exposure held during each funding interval', () => {
  const state = initialPaperState(10000, 0);
  state.fundingRates = { BTC: '0.01' };
  state.marks = { BTC: '100' };
  applyFill(state, fill(3_600_000));
  expect(state.fundingPaid).toBe('0');
  applyFill(state, { ...fill(5_400_000), side: 'A' });
  expect(state.fundingPaid).toBe('-0.5');
  expect(state.positions).toHaveLength(0);
  accrueFunding(state, { BTC: '0.01' }, { BTC: '100' }, 7_200_000);
  expect(state.fundingPaid).toBe('-0.5');
});

test('lowering leverage cannot undercollateralize an existing paper position', async () => {
  const store = new PaperStore(path());
  await store.reset(100);
  const exchange = paperExchange(migrate({ mode: 'paper' }), store, data);
  await exchange.updateLeverage({ asset: 0, isCross: true, leverage: 10 });
  await exchange.order({
    orders: [
      {
        a: 0,
        b: true,
        p: '100',
        s: '2',
        r: false,
        t: { limit: { tif: 'Ioc' } },
      },
    ],
  });
  await expect(
    exchange.updateLeverage({ asset: 0, isCross: true, leverage: 1 }),
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_MARGIN' });
  expect((await store.load()).positions[0].leverage.value).toBe(10);
});

test('paper reset and engine writes cannot interleave with a risk transaction', async () => {
  const c = migrate({ mode: 'paper' }),
    store = new PaperStore();
  await store.reset(100);
  let release!: () => void,
    entered!: () => void,
    reset = false;
  const hold = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const trading = withTradeLock(c, async () => {
    entered();
    await hold;
    expect((await store.load()).balance).toBe('100');
  });
  await started;
  const resetting = store.reset(200).then(() => {
    reset = true;
  });
  await new Promise((r) => setTimeout(r, 20));
  expect(reset).toBe(false);
  release();
  await Promise.all([trading, resetting]);
  expect((await store.load()).balance).toBe('200');
});

test('daily-loss histories reject stale, future, unordered and missing-baseline samples', () => {
  const midnight = Date.UTC(2026, 10, 17),
    now = midnight + 3600000;
  for (const history of [
    [
      [midnight, '0'],
      [now - 600000, '0'],
    ],
    [
      [midnight, '0'],
      [now + 1, '0'],
    ],
    [
      [now, '0'],
      [midnight, '0'],
    ],
    [
      [midnight + 1, '0'],
      [now, '0'],
    ],
  ] as [number, string][][])
    expect(() =>
      dailyLossFromPortfolio([['day', { pnlHistory: history }]], now),
    ).toThrow(expect.objectContaining({ code: 'POLICY_REJECTED' }));
  const state = initialPaperState(1000, midnight - 86400000);
  applyFill(state, fill(midnight - 86400000));
  rolloverDay(state, { BTC: '100' }, now);
  expect(() => dailyLoss(state, { BTC: '100' })).toThrow(
    expect.objectContaining({ code: 'POLICY_REJECTED' }),
  );
});

test.each(['live', 'paper'])(
  'partial %s subscription startup closes every acquired resource',
  async (mode) => {
    const unsubscribe = vi.fn(async () => {}),
      close = vi.fn(async () => {});
    let calls = 0;
    const backend = {
      subscribe: async () => {
        if (++calls === 2) throw new Error('subscribe failed');
        return { unsubscribe };
      },
      onState: () => {},
      close,
      gap: async () => [],
    };
    const c = migrate({ mode, allowedMarkets: ['BTC'] }),
      runner = new Runner(c, path());
    const manager =
      mode === 'paper'
        ? new PaperEngine(
            runner,
            new PaperStore(path()),
            backend,
            async () => {},
            data,
          )
        : new Subscriptions(runner, backend, async () => {});
    await expect(manager.start()).rejects.toThrow('subscribe failed');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    await runner.shutdown();
    expect(close).toHaveBeenCalledTimes(1);
  },
);

test('indexed fill replay appends exactly once across EventStore instances', async () => {
  const file = join(path(), 'events.jsonl'),
    first = new EventStore(file),
    second = new EventStore(file);
  const payload = {
    tid: 11,
    fee: '0.000000001',
    scope: 'testnet:example',
    eventId: 'testnet:example:fill:11',
  };
  await Promise.all([
    first.append('fill', payload),
    second.append('fill', payload),
  ]);
  expect(await readEvents(file)).toHaveLength(1);
});
