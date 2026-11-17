import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
const environment = vi.hoisted(() => ({
  home: `/tmp/bloxwap-e2e-${process.pid}-${Math.random().toString(16).slice(2)}`,
  orders: [] as {
    coin: string;
    oid: number;
    side: string;
    sz: string;
    limitPx: string;
  }[],
  agents: [] as { address: string; validUntil: number; name: string }[],
  builderFee: 0,
  referralCode: null as string | null,
  balance: '0',
}));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => environment.home,
}));
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
let master: ReturnType<typeof privateKeyToAccount>;
let agent: ReturnType<typeof privateKeyToAccount>;
let nextAgent: ReturnType<typeof privateKeyToAccount>;
beforeEach(async () => {
  setRouting(routeToRunner);
  await mkdir(environment.home, { recursive: true, mode: 0o700 });
  path = join(environment.home, '.bloxwap', 'config.json');
  master = privateKeyToAccount(generatePrivateKey());
  const agentKey = generatePrivateKey();
  const nextAgentKey = generatePrivateKey();
  agent = privateKeyToAccount(agentKey);
  nextAgent = privateKeyToAccount(nextAgentKey);
  process.env.BLOXWAP_TEST_EOA = agentKey;
  process.env.BLOXWAP_TEST_NEXT_EOA = nextAgentKey;
  environment.orders = [];
  environment.agents = [];
  environment.balance = '0';
  environment.builderFee = 0;
  environment.referralCode = null;
  await saveConfig(
    migrate({
      eoaKeyRef: 'env:BLOXWAP_TEST_EOA',
      masterAddress: master.address,
    }),
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
            recipient: master.address,
            currencyOut: {
              amount: '1000000000',
              currency: {
                decimals: 8,
                chainId: 1337,
                address: '0x' + '0'.repeat(32),
              },
            },
            currencyIn: {
              amount: '10000000',
              currency: {
                decimals: 6,
                chainId: 42161,
                address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
              },
            },
            expiresAt: Date.now() + 60000,
          },
        });
      if (String(url).includes('/intents/status'))
        return Response.json({
          status: 'success',
          txHashes: ['0xledger'],
          destinationChainId: 1337,
        });
      if (action?.type === 'approveAgent') {
        if (action.agentAddress === '0x' + '0'.repeat(40))
          environment.agents = environment.agents.filter(
            (agent) =>
              !agent.name.startsWith(`${action.agentName} valid_until `),
          );
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
      if (action?.type === 'setReferrer') {
        environment.referralCode = action.code;
        return Response.json({ status: 'ok', response: { type: 'default' } });
      }
      if (body.type === 'maxBuilderFee')
        return Response.json(environment.builderFee);
      if (action) {
        if (action.type === 'order') expect(action.builder).toBeUndefined();
        const statuses =
          action.type === 'order' ? [{ resting: { oid: 1 } }] : ['success'];
        if (action.type === 'order') {
          environment.orders = [
            { coin: 'BTC', oid: 1, side: 'B', sz: '0.001', limitPx: '20000' },
          ];
          const { events } = await import('../src/runner/events.js');
          await events.append('order_update', {
            order: { oid: 1 },
            status: 'open',
          });
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
      if (body.type === 'referral')
        return Response.json({
          referredBy: environment.referralCode
            ? { code: environment.referralCode }
            : null,
        });
      if (body.type === 'frontendOpenOrders')
        return Response.json(environment.orders);
      if (body.type === 'allMids') return Response.json({ BTC: '20000' });
      if (body.type === 'activeAssetData')
        return Response.json({ leverage: { type: 'cross', value: 1 } });
      if (body.type === 'orderStatus')
        return Response.json({ status: 'unknownOid' });
      if (body.type === 'userNonFundingLedgerUpdates')
        return Response.json(
          environment.balance === '10'
            ? [
                {
                  time: Date.now(),
                  hash: '0xledger',
                  delta: { type: 'deposit', usdc: '10' },
                },
              ]
            : [],
        );
      throw new Error('Unexpected mocked request: ' + JSON.stringify(body));
    }),
  );
});
afterEach(async () => {
  await activeRunner?.shutdown();
  setActiveRunner(undefined);
  setRouting(undefined);
  delete process.env.BLOXWAP_TEST_EOA;
  delete process.env.BLOXWAP_TEST_NEXT_EOA;
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
const sign = (approval: unknown) =>
  master.signTypedData(
    (approval as { typedData: Parameters<typeof master.signTypedData>[0] })
      .typedData,
  );
test('mocked full account lifecycle through real CLI router, SDK and runner RPC', async () => {
  const initialized = await command('init', { qr: false });
  expect(initialized.requiresSignature).toBe(true);
  expect(initialized.agentAddress).toBe(agent.address);
  expect(initialized).toMatchObject({
    referralCode: 'BLOXWAP',
    referralApplied: false,
  });
  expect(initialized.approvals).not.toHaveProperty('builder');
  expect(
    await command('init', {
      qr: false,
      signature: await sign(
        (initialized.approvals as { agent: unknown }).agent,
      ),
    }),
  ).toMatchObject({
    approved: true,
    referralCode: 'BLOXWAP',
    referralApplied: true,
  });
  expect(environment.referralCode).toBe('BLOXWAP');
  expect((await command('init', { qr: false })).approved).toBe(true);
  const deposit = await command('fund', { qr: false, amount: '10' });
  expect(deposit.depositId).toBe('deposit-1');
  expect((await command('status')).deposits).toEqual([
    { id: 'deposit-1', state: 'pending' },
  ]);
  expect(
    (
      await dispatch([
        'order',
        '--config',
        path,
        '--json',
        '{"coin":"BTC","side":"buy","size":"0.001","price":"20000"}',
      ])
    ).body,
  ).toMatchObject({ ok: false, code: 'DEPOSIT_PENDING' });
  environment.balance = '10';
  const status = await command('status');
  expect(status.deposits).toEqual([{ id: 'deposit-1', state: 'settled' }]);
  expect(await command('market', { coin: 'BTC' })).toMatchObject({
    mid: '20000',
    szDecimals: '5',
    asset: '0',
  });
  expect(await command('run')).toMatchObject({
    ready: true,
    network: 'testnet',
  });
  expect((await command('status')).runner).toMatchObject({
    signingSession: 'ready',
    wsState: 'connected',
  });
  expect(activeRunner?.signer?.address).toBe(agent.address);
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
    builderFeeRate: '0%',
    builderAddress: '0x71b09A08257078A4d642F7Dd7315e656c837329a',
  });
  await command('modify', { oid: 1, price: '20100' });
  expect(environment.orders[0].limitPx).toBe('20100');
  await command('cancel', { all: true });
  expect(await command('orders')).toEqual([]);
  const rotation = await command('rotate', {
    eoaKeyRef: 'env:BLOXWAP_TEST_NEXT_EOA',
  });
  expect(rotation.requiresSignature).toBe(true);
  expect(rotation.newAgent).toBe(nextAgent.address);
  const swapped = await command('rotate', {
    signature: await sign(rotation.approval),
  });
  expect(swapped.swapped).toBe(true);
  expect(activeRunner?.signer?.address).toBe(swapped.newAgent);
  expect(
    (
      await command('rotate', {
        revokeSignature: await sign(swapped.revokeApproval),
      })
    ).oldRevoked,
  ).toBe(true);
  expect(environment.agents.map((agent) => agent.address)).toEqual([
    swapped.newAgent,
  ]);
  const revoked = await command('revoke', { cancelOrders: true });
  expect(revoked).toMatchObject({
    locallyRevoked: true,
    exchangeRevoked: false,
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
  expect(
    await command('revoke', { signature: await sign(revoked.approval) }),
  ).toMatchObject({
    locallyRevoked: true,
    exchangeRevoked: true,
  });
  expect(environment.agents).toEqual([]);
  const { events } = await import('../src/runner/events.js');
  await events.append('fill', {
    tid: 7,
    oid: 1,
    fee: '0.01',
    scope: `testnet:${master.address.toLowerCase()}`,
  });
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
  const replay = (await command('events')) as unknown as {
    seq: number;
    type: string;
  }[];
  expect(replay.map((event) => event.type)).toContain('order_update');
  expect(replay.map((event) => event.type)).toContain('fill');
  expect(await command('events', { since: replay[0].seq })).toEqual(
    replay.slice(1),
  );
}, 20000);
