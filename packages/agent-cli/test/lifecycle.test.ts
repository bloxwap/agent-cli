import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
const environment = vi.hoisted(() => ({
  home: `/tmp/bloxwap-e2e-${process.pid}-${Math.random().toString(16).slice(2)}`,
  wallets: 0,
  orders: [] as {
    coin: string;
    oid: number;
    side: string;
    sz: string;
    limitPx: string;
  }[],
  agents: [] as { address: string; validUntil: number; name: string }[],
  builderFee: 0,
  balance: '0',
}));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => environment.home,
}));
vi.mock('../src/wallet/privy.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../src/wallet/privy.js')>();
  return {
    ...original,
    privyClient: async () => ({
      policies: () => ({
        create: async (input: Record<string, unknown>) => ({ ...input, id: 'policy' }),
        get: async () => {
          const { policyFor } = await import('../src/wallet/policy.js');
          return { ...policyFor('testnet'), id: 'policy' };
        },
      }),
      wallets: () => ({
        ethereum: () => ({
          signTypedData: async () => ({
            signature: '0x' + '11'.repeat(64) + '1b',
          }),
        }),
      }),
    }),
    createAgent: async (
      config: import('../src/core/config.js').Config,
      _client: unknown,
      path?: string,
    ) => {
      const { saveConfig } = await import('../src/core/config.js');
      if (config.agentAddress && config.privyWalletId)
        return { id: config.privyWalletId, address: config.agentAddress };
      config.agentAddress = '0x' + String(++environment.wallets).repeat(40);
      config.privyWalletId = 'wallet-' + environment.wallets;
      config.authorizationKeyRef = 'env:BLOXWAP_E2E_AUTH';
      await saveConfig(config, path);
      return { id: config.privyWalletId, address: config.agentAddress };
    },
    privySigner: original.privySigner,
  };
});
vi.mock('../src/runner/subscriptions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/runner/subscriptions.js')>()),
  startSubscriptions: async () => ({
    state: 'connected',
    lastMessage: Date.now(),
    lastFill: null,
  }),
}));
import '../src/commands/init.js';
import '../src/commands/fund.js';
import '../src/commands/read.js';
import '../src/commands/order.js';
import '../src/commands/cancel.js';
import '../src/commands/modify.js';
import '../src/commands/leverage.js';
import '../src/commands/run.js';
import '../src/commands/rotate.js';
import '../src/commands/revoke.js';
import '../src/commands/events.js';
import '../src/commands/audit.js';
import '../src/commands/market.js';
import { dispatch, setRouting } from '../src/core/router.js';
import { saveConfig, migrate } from '../src/core/config.js';
import { activeRunner, setActiveRunner } from '../src/runner/lifecycle.js';
import { rpcCall, socketPath, routeToRunner } from '../src/runner/rpc.js';
import { readAudit, verifyAudit } from '../src/core/audit.js';
let path: string;
beforeEach(async () => {
  setRouting(routeToRunner);
  await mkdir(environment.home, { recursive: true, mode: 0o700 });
  path = join(environment.home, '.bloxwap', 'config.json');
  process.env.BLOXWAP_E2E_AUTH = 'mock-authorization';
  environment.wallets = 0;
  environment.orders = [];
  environment.agents = [];
  environment.balance = '0';
  environment.builderFee = 0;
  await saveConfig(
    migrate({ privyAppId: 'mock', masterAddress: '0x' + 'a'.repeat(40) }),
    path,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body ?? '{}'));
      const action = body.action;
      if (String(url).includes('/quote/v2'))
        return Response.json({
          steps: [
            {
              id: 'deposit',
              kind: 'transaction',
              requestId: 'deposit-1',
              depositAddress: '0x' + 'b'.repeat(40),
              items: [{ status: 'incomplete', data: {} }],
            },
          ],
          fees: {},
          details: {
            currencyOut: { amount: '1000000000', currency: { decimals: 8 } },
            expiresAt: Date.now() + 60000,
          },
        });
      if (String(url).includes('/intents/status'))
        return Response.json({ status: 'success' });
      if (action?.type === 'approveAgent') {
        if (action.agentAddress === '0x' + '0'.repeat(40))
          environment.agents = environment.agents.filter((agent) =>
            !agent.name.startsWith(`${action.agentName} valid_until `));
        else
          environment.agents.push({
            address: action.agentAddress,
            name: action.agentName,
            validUntil: Number(
              action.agentName.match(/valid_until (\d+)/)?.[1],
            ),
          });
        return Response.json({ status: 'ok', response: { type: 'default' } });
      }
      if (action?.type === 'approveBuilderFee') {
        expect(action).toMatchObject({
          builder: '0x71b09A08257078A4d642F7Dd7315e656c837329a',
          maxFeeRate: '0.01%',
        });
        environment.builderFee = 10;
        return Response.json({ status: 'ok', response: { type: 'default' } });
      }
      if (body.type === 'maxBuilderFee')
        return Response.json(environment.builderFee);
      if (action) {
        if (action.type === 'order')
          expect(action.builder).toEqual({
            b: '0x71b09a08257078a4d642f7dd7315e656c837329a',
            f: 10,
          });
        const statuses =
          action.type === 'order' ? [{ resting: { oid: 1 } }] : ['success'];
        if (action.type === 'order') {
          environment.orders = [
            { coin: 'BTC', oid: 1, side: 'B', sz: '0.001', limitPx: '20000' },
          ];
          const { events } = await import('../src/runner/events.js');
          await events.append('order_update', { order: { oid: 1 }, status: 'open' });
        }
        if (action.type === 'batchModify')
          environment.orders[0].limitPx = action.modifies[0].order.p;
        if (action.type === 'cancel') environment.orders = [];
        return Response.json({
          status: 'ok',
          response: {
            type: action.type === 'batchModify' ? 'order' : action.type,
            data: { statuses },
          },
        });
      }
      if (body.type === 'meta')
        return Response.json({
          universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }],
          marginTables: [],
        });
      if (body.type === 'clearinghouseState')
        return Response.json({
          marginSummary: {
            accountValue: environment.balance,
            totalMarginUsed: '0',
            totalNtlPos: '0',
          },
          withdrawable: environment.balance,
          assetPositions: [],
        });
      if (body.type === 'extraAgents') return Response.json(environment.agents);
      if (body.type === 'frontendOpenOrders')
        return Response.json(environment.orders);
      if (body.type === 'allMids') return Response.json({ BTC: '20000' });
      throw new Error('Unexpected mocked request: ' + JSON.stringify(body));
    }),
  );
});
afterEach(async () => {
  await activeRunner?.shutdown();
  setActiveRunner(undefined);
  setRouting(undefined);
  delete process.env.BLOXWAP_E2E_AUTH;
  vi.unstubAllGlobals();
  await rm(environment.home, { recursive: true, force: true });
});
async function command(name: string, input: Record<string, unknown> = {}) {
  const result = await dispatch([
    name,
    '--config',
    path,
    '--json',
    JSON.stringify(input),
  ]);
  expect(result.body, JSON.stringify(result.body)).toMatchObject({ ok: true });
  return (result.body as { data: Record<string, unknown> }).data;
}
test('mocked full account lifecycle through real CLI router, SDK and runner RPC', async () => {
  const initialized = await command('init', { qr: false });
  expect(initialized.requiresSignature).toBe(true);
  expect(initialized.approvals).toMatchObject({
    builder: { typedData: { message: { maxFeeRate: '0.01%' } } },
  });
  expect(
    (
      await command('init', {
        qr: false,
        signature: '0x' + '11'.repeat(64) + '1b',
      })
    ).approved,
  ).toBe(false);
  expect(
    (
      await command('init', {
        qr: false,
        builderSignature: '0x' + '11'.repeat(64) + '1b',
      })
    ).approved,
  ).toBe(true);
  expect((await command('init', { qr: false })).approved).toBe(true);
  const deposit = await command('fund', { qr: false, amount: '10' });
  expect(deposit.depositId).toBe('deposit-1');
  expect((await command('status')).deposits).toEqual([{ id: 'deposit-1', state: 'pending' }]);
  expect((await dispatch(['order', '--config', path, '--json',
    '{"coin":"BTC","side":"buy","size":"0.001","price":"20000"}'])).body)
    .toMatchObject({ ok: false, code: 'DEPOSIT_PENDING' });
  environment.balance = '10';
  const status = await command('status');
  expect(status.deposits).toEqual([{ id: 'deposit-1', state: 'settled' }]);
  expect(await command('market', { coin: 'BTC' })).toMatchObject({
    mid: '20000',
    szDecimals: '5',
    asset: '0',
  });
  expect(await command('run')).toMatchObject({ ready: true, network: 'testnet' });
  expect((await command('status')).runner).toMatchObject({ signingSession: 'ready', wsState: 'connected' });
  expect(await rpcCall('balance', {}, socketPath())).toMatchObject({
    accountValue: '10',
  });
  const placed = await command('order', {
    coin: 'BTC',
    side: 'buy',
    size: '0.001',
    price: '20000',
    intentId: 'lifecycle',
  });
  expect(placed).toMatchObject({
    builderFeeRate: '0.01%',
    builderAddress: '0x71b09A08257078A4d642F7Dd7315e656c837329a',
  });
  await command('modify', { oid: 1, price: '20100' });
  expect(environment.orders[0].limitPx).toBe('20100');
  await command('cancel', { all: true });
  expect(await command('orders')).toEqual([]);
  const rotation = await command('rotate');
  expect(rotation.requiresSignature).toBe(true);
  const swapped = await command('rotate', { signature: '0x' + '11'.repeat(64) + '1b' });
  expect(swapped.swapped).toBe(true);
  expect(activeRunner?.signer?.address).toBe(swapped.newAgent);
  expect((await command('rotate', { revokeSignature: '0x' + '11'.repeat(64) + '1b' })).oldRevoked).toBe(true);
  expect(environment.agents.map((agent) => agent.address)).toEqual([swapped.newAgent]);
  expect(await command('revoke', { cancelOrders: true })).toMatchObject({
    locallyRevoked: true, exchangeRevoked: false,
  });
  const rejected = await dispatch([
    'order',
    '--config',
    path,
    '--json',
    '{"coin":"BTC","side":"buy","size":"0.001","price":"20000"}',
  ]);
  expect(rejected.body).toMatchObject({
    ok: false,
    code: 'AGENT_NOT_APPROVED',
  });
  expect(await command('revoke', { signature: '0x' + '11'.repeat(64) + '1b' })).toMatchObject({
    locallyRevoked: true, exchangeRevoked: true,
  });
  expect(environment.agents).toEqual([]);
  const { events } = await import('../src/runner/events.js');
  await events.append('fill', { tid: 7, oid: 1, fee: '0.01' });
  const entries = await readAudit(
    join(environment.home, '.bloxwap', 'audit.jsonl'),
  );
  expect(
    entries.some(
      (entry) => entry.intentId === 'lifecycle' && entry.stage === 'signature',
    ),
  ).toBe(true);
  expect(
    entries.some(
      (entry) => entry.intentId === 'lifecycle' && entry.stage === 'fill',
    ),
  ).toBe(true);
  expect(verifyAudit(entries)).toBe(true);
  const replay = await command('events') as unknown as { seq: number; type: string }[];
  expect(replay.map((event) => event.type)).toContain('order_update');
  expect(replay.map((event) => event.type)).toContain('fill');
  expect(await command('events', { since: replay[0].seq })).toEqual(replay.slice(1));
}, 20000);
