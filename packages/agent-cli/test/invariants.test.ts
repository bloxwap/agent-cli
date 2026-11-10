import { expect, test, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { migrate, readStoredConfig, saveConfig, updateConfig, copyAgentFields, stateDir } from '../src/core/config.js';
import { nextNonce } from '../src/core/nonce.js';
import { AuditStore, auditFill, readAudit, verifyAudit } from '../src/core/audit.js';
import { intentForFill } from '../src/core/audit.js';
import { auditedAction } from '../src/core/audit.js';
import { EventStore, readEvents } from '../src/runner/events.js';
import { PaperStore } from '../src/paper/store.js';
import { withFileLock } from '../src/core/lock.js';
import { Runner, runningInfo, STARTUP_TIMEOUT_MS } from '../src/runner/lifecycle.js';
import { rpcServer, rpcCall, socketPath } from '../src/runner/rpc.js';
import { placeOrder, orderSchema } from '../src/commands/order.js';
import { modifyOrders, modifySchema } from '../src/commands/modify.js';
import { cancelOrders, cancelSchema } from '../src/commands/cancel.js';
import { accountFixture, mockTrading, quoteFixture } from './fixtures.js';
import { AgentCliError } from '../src/errors/index.js';
import { mapHyperliquidError } from '../src/errors/mappers.js';
import { fund, fundSchema } from '../src/commands/fund.js';
import { advanceDeposit, abandonDeposit, pollDeposits, DEPOSIT_EXPIRY_GRACE_MS } from '../src/funding/status.js';
import { readDeposits, updateDeposits, writeDeposits, type Deposit } from '../src/funding/store.js';
import { resolvePendingApproval, APPROVAL_MAX_AGE_MS } from '../src/wallet/approval.js';
import { Subscriptions } from '../src/runner/subscriptions.js';
import { dispatch } from '../src/core/router.js';
import '../src/commands/order.js';
import '../src/commands/revoke.js';

const master = '0x' + '12'.repeat(20);
function liveConfig(extra: Record<string, unknown> = {}) {
  return migrate({
    approved: true,
    approvedNetwork: 'testnet',
    masterAddress: master,
    agentAddress: '0x' + 'ab'.repeat(20),
    agentExpiry: Date.now() + 86_400_000,
    ...extra,
  });
}
const orderInput = () =>
  orderSchema.parse({
    coin: 'BTC',
    side: 'buy',
    size: '0.001',
    price: '20000',
  });

async function deadPid() {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
    child.once('exit', () => resolve(child.pid!));
    child.once('error', reject);
  });
}

test('a timed-out order is not retryable and the same cloid is not sent twice', async () => {
  const services = mockTrading();
  let accepted: string | null = null;
  services.orderByCloid = async (cloid) =>
    accepted === cloid
      ? { status: 'ok', response: { data: { statuses: [{ resting: { oid: 7 } }] } } }
      : null;
  services.exchange.order = vi.fn(async (request: { orders: { c: string }[] }) => {
    accepted = request.orders[0].c;
    throw new AgentCliError('NETWORK_ERROR', 'timed out');
  });
  const config = liveConfig();
  let cloid = '';
  try {
    await placeOrder(config, orderInput(), services);
    throw new Error('order should have timed out');
  } catch (error) {
    expect(error).toMatchObject({
      code: 'NETWORK_ERROR',
      retryable: false,
      details: { outcome: 'unknown' },
    });
    cloid = (error as AgentCliError).details &&
      typeof (error as AgentCliError).details === 'object'
      ? String((error as { details: { cloid?: string } }).details.cloid)
      : '';
  }
  expect(cloid).toMatch(/^0x[0-9a-f]{32}$/);
  expect(accepted).toBe(cloid);
  const again = await placeOrder(
    config,
    orderSchema.parse({ ...orderInput(), cloid: accepted }),
    services,
  );
  expect(services.exchange.order).toHaveBeenCalledTimes(1);
  expect(again).toMatchObject({ cloid: accepted, idempotent: true });
});

test('the same intentId reuses the original cloid', async () => {
  const first: Record<string, unknown> = { intentId: 'intent-81' };
  await auditedAction('order', first, async () => ({ ok: true }));
  const second: Record<string, unknown> = { intentId: 'intent-81' };
  await auditedAction('order', second, async () => ({ ok: true }));
  expect(second.cloid).toBe(first.cloid);
  expect(first.cloid).toMatch(/^0x[0-9a-f]{32}$/);
  await expect(
    auditedAction(
      'order',
      { intentId: 'intent-81', cloid: '0x' + 'cd'.repeat(16) },
      async () => ({ ok: true }),
    ),
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
});

test('flat accounts are risk-checked at the leverage Hyperliquid will apply', async () => {
  const services = mockTrading();
  services.state = async () => ({ ...accountFixture, assetPositions: [] });
  services.assetLeverage = async () => 40;
  const config = liveConfig({ limits: { maxLeverage: 3 } });
  await expect(placeOrder(config, orderInput(), services)).rejects.toMatchObject({
    code: 'POLICY_REJECTED',
    details: expect.objectContaining({ limit: 'maxLeverage', actual: 40 }),
  });
  services.orders = async () => [
    { coin: 'BTC', oid: 1, sz: '0.001', limitPx: '20000', side: 'B' },
  ];
  await expect(
    modifyOrders(config, modifySchema.parse({ oid: 1, price: '20000' }), services),
  ).rejects.toMatchObject({
    code: 'POLICY_REJECTED',
    details: expect.objectContaining({ limit: 'maxLeverage' }),
  });
  services.assetLeverage = async () => {
    throw new Error('activeAssetData down');
  };
  await expect(placeOrder(config, orderInput(), services)).rejects.toMatchObject({
    code: 'POLICY_REJECTED',
  });
});

test('concurrent orders cannot both pass the same position limit', async () => {
  for (const mode of ['live', 'paper'] as const) {
    let filled = false;
    const services = mockTrading();
    services.assetLeverage = async () => 1;
    services.state = async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return {
        ...accountFixture,
        assetPositions: filled
          ? [
              {
                position: {
                  ...accountFixture.assetPositions[0].position,
                  szi: '0.05',
                  leverage: { type: 'cross', value: 1 },
                },
              },
            ]
          : [],
      };
    };
    services.exchange.order = vi.fn(async () => {
      filled = true;
      return {
        status: 'ok',
        response: { data: { statuses: [{ filled: { oid: 1 } }] } },
      };
    });
    const config = liveConfig({
      mode,
      masterAddress: mode === 'paper' ? '0x' + '99'.repeat(20) : master,
      limits: { maxPositionNotional: 1500 },
    });
    const input = orderSchema.parse({
      coin: 'BTC',
      side: 'buy',
      size: '0.05',
      price: '20000',
    });
    const results = await Promise.allSettled([
      placeOrder(config, input, services),
      placeOrder(config, input, services),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(services.exchange.order).toHaveBeenCalledTimes(1);
  }
});

test('a live runner rejects an order after config mode flips to paper', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-mode-'));
  const path = join(dir, 'config.json');
  const config = liveConfig();
  await saveConfig(config, path);
  const runner = new Runner(config, dir);
  try {
    await rpcServer(runner, { pretty: false, configPath: path, paper: false });
    await runner.markReady();
    const paper = await readStoredConfig(path);
    paper!.mode = 'paper';
    await saveConfig(paper, path);
    await expect(
      rpcCall(
        'order',
        {
          coin: 'BTC',
          side: 'buy',
          size: '0.001',
          price: '20000',
          __context: { mode: 'live', configPath: path, network: 'testnet' },
        },
        socketPath(dir),
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  } finally {
    await runner.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test('trading rejects a network that differs from the approval', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-net-'));
  const path = join(dir, 'config.json');
  await saveConfig(liveConfig(), path);
  const previous = process.env.BLOXWAP_NETWORK;
  try {
    process.env.BLOXWAP_NETWORK = 'mainnet';
    const byEnv = await dispatch([
      'order',
      '--config',
      path,
      '--json',
      JSON.stringify({ coin: 'BTC', side: 'buy', size: '0.001', price: '20000' }),
    ]);
    expect(byEnv.body).toMatchObject({ ok: false, code: 'CONFIG_INVALID' });
    delete process.env.BLOXWAP_NETWORK;
    const byFlag = await dispatch([
      'order',
      '--config',
      path,
      '--network',
      'mainnet',
      '--json',
      JSON.stringify({ coin: 'BTC', side: 'buy', size: '0.001', price: '20000' }),
    ]);
    expect(byFlag.body).toMatchObject({ ok: false, code: 'CONFIG_INVALID' });
  } finally {
    if (previous === undefined) delete process.env.BLOXWAP_NETWORK;
    else process.env.BLOXWAP_NETWORK = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('rotation keeps limits changed after it started and saves detect races', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-rotate-config-'));
  const path = join(dir, 'config.json');
  try {
    await saveConfig(
      liveConfig({ limits: { maxNotional: 5000 }, allowedMarkets: ['BTC'] }),
      path,
    );
    const started = (await readStoredConfig(path))!;
    const loosened = migrate({
      ...started,
      limits: { maxNotional: 1 },
      allowedMarkets: ['ETH'],
      agentAddress: '0x' + 'ef'.repeat(20),
    });
    started.limits.maxNotional = 500;
    started.allowedMarkets = ['BTC', 'ETH'];
    await saveConfig(started, path);
    await updateConfig(path, (latest) => copyAgentFields(latest, loosened));
    const saved = (await readStoredConfig(path))!;
    expect(saved.limits.maxNotional).toBe(500);
    expect(saved.allowedMarkets).toEqual(['BTC', 'ETH']);
    expect(saved.agentAddress).toBe('0x' + 'ef'.repeat(20));
    const stale = (await readStoredConfig(path))!;
    const current = (await readStoredConfig(path))!;
    current.limits.maxNotional = 50;
    await saveConfig(current, path);
    stale.limits.maxNotional = 5;
    await expect(saveConfig(stale, path)).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
    expect((await readStoredConfig(path))!.limits.maxNotional).toBe(50);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a stale revoke payload is regenerated and can then be submitted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-approval-'));
  const path = join(dir, 'revoke.json');
  const oldNonce = 111;
  await writeFile(
    path,
    JSON.stringify({
      createdAt: Date.now() - APPROVAL_MAX_AGE_MS - 5_000,
      expiresAt: Date.now() - 1_000,
      approval: {
        action: { type: 'approveAgent', nonce: oldNonce },
        typedData: {},
      },
    }),
  );
  const pending = await resolvePendingApproval(path, async () => ({
    action: { type: 'approveAgent', nonce: 222 },
    typedData: { primaryType: 'ApproveAgent' },
  }));
  expect(pending.approval.action.nonce).toBe(222);
  expect(pending.expiresAt).toBeGreaterThan(Date.now());
  const submitted: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      submitted.push(body.nonce);
      return Response.json({ status: 'ok', response: { type: 'default' } });
    }),
  );
  try {
    const { submitApproval } = await import('../src/wallet/approval.js');
    await submitApproval(
      'testnet',
      pending.approval,
      '0x' + '11'.repeat(64) + '1b',
    );
    expect(submitted).toEqual([222]);
  } finally {
    vi.stubGlobal('fetch', async () => {
      throw new Error('Unit test attempted an unmocked network request');
    });
    await rm(dir, { recursive: true, force: true });
  }
});

test('funding rejects an origin decimals mismatch and shows verified units', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-decimals-'));
  const path = join(dir, 'deposits.json');
  const config = migrate({ masterAddress: master });
  try {
    await expect(
      fund(
        config,
        fundSchema.parse({ amount: '50', originDecimals: 6, qr: false }),
        {
          path,
          baseline: async () => '0',
          qr: async () => ({ qrAscii: null, qrPath: null }),
          relay: {
            quote: async () => ({
              ...quoteFixture,
              details: {
                ...quoteFixture.details,
                currencyIn: { amount: '50', currency: { decimals: 18 } },
              },
            }),
          } as never,
        },
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    const quoted = await fund(
      config,
      fundSchema.parse({ amount: '10', originDecimals: 6, qr: false }),
      {
        path,
        baseline: async () => '0',
        qr: async () => ({ qrAscii: null, qrPath: null }),
        relay: {
          quote: async (request: { amount: string }) => ({
            ...quoteFixture,
            details: {
              ...quoteFixture.details,
              currencyIn: { amount: request.amount, currency: { decimals: 6 } },
            },
          }),
        } as never,
      },
    );
    expect(quoted.minDeposit).toBe('1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function deposit(extra: Partial<Deposit> = {}): Deposit {
  return {
    id: 'dep-1',
    network: 'testnet',
    recipient: master,
    route: 'route',
    quote: quoteFixture,
    expiresAt: Date.now() + 60_000,
    state: 'awaiting_funds',
    baseline: '0',
    createdAt: Date.now(),
    completedSteps: [],
    ...extra,
  };
}

test('expired deposits and reduce-only actions do not block trading forever', async () => {
  const services = mockTrading();
  const config = liveConfig();
  const path = join(stateDir(), 'deposits.json');
  await writeDeposits(
    [
      deposit({
        expiresAt: Date.now() - DEPOSIT_EXPIRY_GRACE_MS - 1_000,
      }),
    ],
    path,
  );
  await expect(placeOrder(config, orderInput(), services)).resolves.toMatchObject({
    cloid: expect.stringMatching(/^0x[0-9a-f]{32}$/),
  });
  await writeDeposits([deposit({ id: 'open', expiresAt: Date.now() + 3_600_000 })], path);
  await expect(placeOrder(config, orderInput(), services)).rejects.toMatchObject({
    code: 'DEPOSIT_PENDING',
  });
  services.orders = async () => [
    { coin: 'BTC', oid: 4, sz: '0.001', limitPx: '20000', side: 'A', reduceOnly: true },
  ];
  await expect(
    cancelOrders(config, cancelSchema.parse({ oid: 4 }), services),
  ).resolves.toMatchObject({ cancelled: ['4'] });
  await expect(
    placeOrder(
      config,
      orderSchema.parse({ ...orderInput(), side: 'sell', reduceOnly: true }),
      services,
    ),
  ).resolves.toMatchObject({ cloid: expect.any(String) });
  expect(await abandonDeposit('open', path)).toMatchObject({ state: 'abandoned' });
  services.orders = async () => [];
  await expect(placeOrder(config, orderInput(), services)).resolves.toBeTruthy();
  const sample = deposit({ baseline: '2' });
  expect(
    advanceDeposit(sample, 'success', '2.6', { ledgerCredit: '1' }),
  ).toBe('settled');
  expect(advanceDeposit(sample, 'success', '3')).toBe('pending');
});

test('an in-flight deposit poll does not drop a deposit added beside it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-deposits-'));
  const path = join(dir, 'deposits.json');
  const existing = deposit({ id: 'a' });
  await writeDeposits([existing], path);
  let release: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const polling = pollDeposits('testnet', master, '0', {
      path,
      ledger: async () => [],
      relay: {
        status: async () => {
          release();
          await new Promise((resolve) => setTimeout(resolve, 40));
          return { status: 'pending' };
        },
      } as never,
    });
    await entered;
    await updateDeposits(path, (deposits) => {
      deposits.push(deposit({ id: 'b', route: 'other' }));
    });
    await polling;
    expect((await readDeposits(path)).map((item) => item.id).sort()).toEqual([
      'a',
      'b',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unknown or expired agent is not reported as a missing order', () => {
  expect(
    mapHyperliquidError('User or API Wallet 0xabc does not exist.').code,
  ).toBe('AGENT_NOT_APPROVED');
  expect(mapHyperliquidError('Invalid nonce: nonce too old').retryable).toBe(false);
});

test('fills during downtime are backfilled once and a crash does not duplicate them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-fills-'));
  const runner = new Runner(migrate({ masterAddress: master }), dir);
  const events = new EventStore(join(dir, 'events.jsonl'));
  await events.append('fill', { tid: 1, time: 10, oid: 1 });
  const emitted: unknown[] = [];
  const backend = {
    subscribe: async () => ({ unsubscribe: async () => {} }),
    onState: () => {},
    close: async () => {},
    gap: async () => [
      { tid: 1, time: 10 },
      { tid: 2, time: 20 },
    ],
  };
  const manager = new Subscriptions(runner, backend, async (type, data) => {
    emitted.push({ type, data });
    if (type === 'fill') await events.append('fill', data);
  });
  try {
    await manager.start();
    await manager.flush();
    const fills = emitted.filter(
      (event) => (event as { type: string }).type === 'fill',
    );
    expect(fills).toEqual([{ type: 'fill', data: { tid: 2, time: 20 } }]);
    const restarted = new Subscriptions(runner, backend, async () => {
      emitted.push({ type: 'fill', data: { tid: 'duplicate' } });
    });
    await restarted.start();
    expect(emitted.some((event) => (event as { data: { tid?: unknown } }).data?.tid === 'duplicate')).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a torn journal tail is quarantined before the next append', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-torn-'));
  try {
    const eventsPath = join(dir, 'events.jsonl');
    await writeFile(
      eventsPath,
      '{"seq":1,"timestamp":"2026-01-01T00:00:00.000Z","type":"error","data":{},"mode":"live","paper":false}\n{"seq":2',
    );
    await new EventStore(eventsPath).append('deposit', { id: 'kept' });
    const events = await readEvents(eventsPath);
    expect(events.map((event) => event.type)).toContain('deposit');
    expect(events.map((event) => event.type)).toContain('journal_repaired');
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(dir)).some((name) => name.includes('.corrupt-'))).toBe(true);
    const auditPath = join(dir, 'audit.jsonl');
    const audit = new AuditStore(auditPath);
    await audit.append('decision', { allowed: true }, { intentId: 'kept' });
    const intact = await readFile(auditPath, 'utf8');
    await writeFile(auditPath, intact.slice(0, -1) + 'TORN');
    await audit.append('decision', { allowed: false }, { intentId: 'after' });
    expect(verifyAudit(await readAudit(auditPath))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stale locks from dead processes are recovered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-locks-'));
  const pid = await deadPid();
  const record = JSON.stringify({
    pid,
    createdAt: Date.now() - 10_000,
    token: 'stale',
  });
  try {
    const signer = '0x' + 'aa'.repeat(20);
    await writeFile(join(dir, `${signer}.json.lock`), record);
    expect(await nextNonce(signer, dir)).toBeGreaterThan(0);
    const auditPath = join(dir, 'audit.jsonl');
    await writeFile(auditPath + '.lock', record);
    await expect(
      new AuditStore(auditPath).append('decision', { allowed: true }, { intentId: 'lock' }),
    ).resolves.toMatchObject({ stage: 'decision' });
    const eventsPath = join(dir, 'events.jsonl');
    await writeFile(eventsPath + '.lock', record);
    await expect(new EventStore(eventsPath).append('error', { ok: false })).resolves.toMatchObject({
      type: 'error',
    });
    const paper = new PaperStore(join(dir, 'paper'));
    const { mkdir } = await import('node:fs/promises');
    await mkdir(paper.directory, { recursive: true });
    await writeFile(paper.statePath + '.lock', record);
    await expect(paper.reset(10)).resolves.toBeUndefined();
    await writeFile(join(dir, 'busy.lock'), record);
    await expect(withFileLock(join(dir, 'busy.lock'), async () => 'ok')).resolves.toBe('ok');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runner liveness follows the socket token and stale startup locks are cleared', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-pid-'));
  const pidPath = join(dir, 'runner.pid');
  try {
    await writeFile(
      pidPath,
      JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
        network: 'testnet',
        ready: true,
        token: 'not-this-process',
      }),
    );
    expect(await runningInfo(pidPath)).toBeNull();
    const dead = await deadPid();
    await writeFile(
      pidPath + '.startup',
      JSON.stringify({ pid: dead, createdAt: Date.now() - STARTUP_TIMEOUT_MS - 1, token: 'old' }),
    );
    const runner = new Runner(migrate({}), dir);
    await expect(
      runner.start(async () => ({ address: '0x' + '11'.repeat(20) }) as never),
    ).resolves.toMatchObject({ existing: false, pid: process.pid });
    await runner.shutdown();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fill linkage compares order ids exactly', async () => {
  const response = (oid: number) => ({
    result: { response: { data: { statuses: [{ resting: { oid } }] } } },
  });
  const entries = [
    {
      seq: 1,
      timestamp: '',
      intentId: 'twelve',
      stage: 'response',
      data: response(12),
      previousHash: '',
      hash: '',
    },
    {
      seq: 2,
      timestamp: '',
      intentId: 'onetwothree',
      stage: 'response',
      data: response(123),
      previousHash: '',
      hash: '',
    },
  ];
  expect(intentForFill(entries, { oid: 12 })?.intentId).toBe('twelve');
  expect(intentForFill([...entries].reverse(), { oid: 12 })?.intentId).toBe('twelve');
  await auditFill({ oid: 12, tid: 12, cloid: undefined });
  const recorded = (await readAudit()).filter((entry) => entry.stage === 'fill' && (entry.data as { tid?: number }).tid === 12);
  expect(recorded.at(-1)?.intentId).not.toBe('onetwothree');
});
