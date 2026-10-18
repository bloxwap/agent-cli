import { expect, test, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  requireTestnetEnvironment,
  testnetLifecycle,
} from '../scripts/testnet-lifecycle.mjs';
import { verifyTestnetReport } from '../scripts/testnet-report.mjs';

function fixture(overrides = {}) {
  const oldAgent = '0x' + '1'.repeat(40);
  const newAgent = '0x' + '2'.repeat(40);
  let orders = [];
  let nextOid = 1;
  let rotated = false;
  let revoked = false;
  let started = false;
  let polls = 0;
  const journal = [
    { seq: 1, type: 'runner_state', data: { wsState: 'connected' } },
  ];
  const update = (order, status) =>
    journal.push({
      seq: journal.length + 1,
      type: 'order_update',
      data: [
        {
          order: { ...order, oid: Number(order.oid) },
          status,
          statusTimestamp: 123456789,
        },
      ],
    });
  const stop = vi.fn(async () => structuredClone(journal));
  const checkpoint = vi.fn();
  const approvals = {
    agent: {
      kind: 'agent',
      action: {
        agentAddress: oldAgent,
        agentName: 'bloxwap valid_until 9999999999999',
      },
      typedData: {},
    },
    builder: { kind: 'builder', typedData: {} },
  };
  const command = vi.fn(async (name, input = {}) => {
    if (name === 'config') return {};
    if (name === 'init')
      return {
        agentAddress: oldAgent,
        approved: !!input.builderSignature,
        approvals,
      };
    if (name === 'fund')
      return {
        depositId: 'fixture-deposit',
        expectedReceived: '0',
        qrAscii: 'QR',
      };
    if (name === 'status')
      return {
        deposits: [
          { id: 'fixture-deposit', state: ++polls > 1 ? 'settled' : 'pending' },
        ],
        runner: started
          ? {
              signingSession: revoked ? 'unavailable' : 'ready',
              wsState: 'connected',
            }
          : null,
        agent: {
          address: rotated ? newAgent : oldAgent,
          approved: !revoked,
          revoked,
        },
      };
    if (name === 'run') {
      expect(polls).toBeGreaterThan(1);
      started = true;
      return { ready: true, network: 'testnet' };
    }
    if (name === 'market') return { mid: '100000', szDecimals: '5' };
    if (name === 'order') {
      const oid = nextOid++;
      orders = [
        {
          coin: 'BTC',
          oid: String(oid),
          cloid: input.cloid,
          limitPx: input.price,
        },
      ];
      update(orders[0], 'open');
      return {
        result: { response: { data: { statuses: [{ resting: { oid } }] } } },
      };
    }
    if (name === 'orders') return orders;
    if (name === 'modify') {
      expect(input.modifications).toHaveLength(1);
      update(orders[0], 'canceled');
      orders = [
        {
          ...orders[0],
          oid: String(nextOid++),
          limitPx: input.modifications[0].price,
        },
      ];
      update(orders[0], 'open');
      return {};
    }
    if (name === 'cancel') {
      expect(input.oid).toBe(Number(orders[0].oid));
      update(orders[0], 'canceled');
      orders = [];
      return {};
    }
    if (name === 'events')
      return structuredClone(
        journal.filter((event) => event.seq > (input.since ?? 0)),
      );
    if (name === 'rotate') {
      if (input.signature) rotated = true;
      return {
        oldAgent,
        newAgent,
        swapped: rotated,
        oldRevoked: !!input.revokeSignature,
        approval: {
          kind: 'rotate',
          action: {
            agentAddress: newAgent,
            agentName: 'blox-next valid_until 9999999999999',
          },
        },
        revokeApproval: { kind: 'old-revoke' },
      };
    }
    if (name === 'revoke') {
      revoked = true;
      return {
        locallyRevoked: true,
        exchangeRevoked: !!input.signature,
        approval: { kind: 'final-revoke' },
      };
    }
    if (name === 'audit')
      return [
        ...['order', 'modify', 'cancel', 'rotate', 'revoke'].flatMap((action) =>
          ['intent', 'response'].map((stage) => ({ stage, data: { action } })),
        ),
        { stage: 'signature' },
      ];
    throw new Error(`Unexpected fixture command: ${name}`);
  });
  return {
    command,
    checkpoint,
    stop,
    rememberAgent: vi.fn(),
    masterAddress: '0xtest',
    appId: 'test-app',
    sign: vi.fn(async (approval) => `${approval.kind}-signature`),
    info: vi.fn(async (type) => {
      if (type === 'clearinghouseState')
        return { withdrawable: '30', assetPositions: [] };
      if (type === 'frontendOpenOrders') return [];
      if (type === 'extraAgents')
        return rotated && !revoked ? [{ address: newAgent }] : [];
      throw new Error(`Unexpected fixture info: ${type}`);
    }),
    startFollow: vi.fn(async () => stop),
    wait: vi.fn(async () => {}),
    now: () => 123456789,
    ...overrides,
  };
}

test('offline lifecycle driver verifies both approvals, settlement, reconciled writes, replay and revocation', async () => {
  const f = fixture();
  await testnetLifecycle(f);
  expect(f.sign.mock.calls.map(([approval]) => approval.kind)).toEqual([
    'agent',
    'builder',
    'rotate',
    'old-revoke',
    'final-revoke',
  ]);
  expect(
    f.command.mock.calls.find(([name]) => name === 'order')[1],
  ).toMatchObject({ tif: 'Alo' });
  expect(f.wait).toHaveBeenCalledWith(1000);
  expect(
    f.checkpoint.mock.calls.filter(([stage]) => stage.status === 'passed'),
  ).toHaveLength(15);
  expect(f.rememberAgent.mock.calls.map(([agent]) => agent)).toEqual([
    { address: '0x' + '1'.repeat(40), name: 'bloxwap' },
    { address: '0x' + '2'.repeat(40), name: 'blox-next' },
  ]);
  const rotation = f.command.mock.calls.findIndex(
    ([name, input]) => name === 'rotate' && input.revokeSignature,
  );
  expect(
    f.command.mock.calls
      .slice(rotation + 1)
      .filter(([name]) => name === 'order'),
  ).toHaveLength(1);
  expect(f.stop).toHaveBeenCalledOnce();
});

test('unsettled funding stops the workflow within the documented polling budget', async () => {
  const f = fixture();
  const command = f.command;
  f.command = vi.fn(async (name, input) =>
    name === 'status'
      ? { deposits: [{ id: 'fixture-deposit', state: 'pending' }] }
      : command(name, input),
  );
  await expect(testnetLifecycle(f)).rejects.toThrow('polling budget');
  expect(
    f.command.mock.calls.filter(([name]) => name === 'status'),
  ).toHaveLength(12);
  expect(
    f.command.mock.calls.some(([name]) => ['run', 'order'].includes(name)),
  ).toBe(false);
});

test('a successful envelope without exchange acceptance cannot complete the lifecycle', async () => {
  const f = fixture();
  const command = f.command;
  f.command = vi.fn(async (name, input) =>
    name === 'order'
      ? {
          result: { response: { data: { statuses: [{ error: 'rejected' }] } } },
        }
      : command(name, input),
  );
  await expect(testnetLifecycle(f)).rejects.toThrow('resting post-only');
  expect(f.command.mock.calls.some(([name]) => name === 'rotate')).toBe(false);
  expect(f.stop).toHaveBeenCalledOnce();
});

test('a funded but non-disposable account is rejected before any write', async () => {
  const f = fixture({
    info: async (type) =>
      type === 'clearinghouseState'
        ? { withdrawable: '30', assetPositions: [{ position: { szi: '0.1' } }] }
        : [],
  });
  await expect(testnetLifecycle(f)).rejects.toThrow('no positions');
  expect(f.command).not.toHaveBeenCalled();
});

test.each([null, '', 0, '0.' + '0'.repeat(400) + '1'])(
  'invalid or nonzero position state fails preflight (%#)',
  async (szi) => {
    const f = fixture({
      info: async (type) =>
        type === 'clearinghouseState'
          ? { withdrawable: '30', assetPositions: [{ position: { szi } }] }
          : [],
    });
    await expect(testnetLifecycle(f)).rejects.toThrow('no positions');
    expect(f.command).not.toHaveBeenCalled();
  },
);

test('public run-owned agents are recorded before either approval signer is called', async () => {
  const f = fixture();
  f.sign.mockImplementation(async (approval) => {
    if (['agent', 'rotate'].includes(approval.kind)) {
      const address = approval.action.agentAddress;
      expect(
        f.rememberAgent.mock.calls.some(([agent]) => agent.address === address),
      ).toBe(true);
    }
    return `${approval.kind}-signature`;
  });
  await testnetLifecycle(f);
});

test('exchange price precision is applied before placement, modification and reconciliation', async () => {
  const f = fixture();
  const command = f.command;
  f.command = vi.fn(async (name, input) =>
    name === 'market'
      ? { mid: '10249.99', szDecimals: '5' }
      : command(name, input),
  );
  await testnetLifecycle(f);
  expect(f.command.mock.calls.find(([name]) => name === 'order')[1].price).toBe(
    '7174.9',
  );
  expect(
    f.command.mock.calls.find(([name]) => name === 'modify')[1].modifications[0]
      .price,
  ).toBe('7031.4');
});

test.each([
  [],
  [
    { seq: 1, type: 'runner_state' },
    { seq: 2, type: 'order_update', data: [] },
  ],
  [
    { seq: 1, type: 'runner_state' },
    {
      seq: 2,
      type: 'order_update',
      data: [
        { order: { coin: 'BTC', oid: 9876 }, status: 'open' },
        { order: { coin: 'BTC', oid: 9876 }, status: 'canceled' },
      ],
    },
  ],
])(
  'empty or unrelated journal updates cannot pass WebSocket verification (%#)',
  async (events) => {
    const f = fixture();
    const command = f.command;
    f.command = vi.fn(async (name, input) =>
      name === 'events' ? events : command(name, input),
    );
    await expect(testnetLifecycle(f)).rejects.toThrow('Missing correlated');
    expect(
      f.checkpoint.mock.calls
        .filter(([stage]) => stage.status === 'failed')
        .map(([stage]) => stage.name),
    ).toEqual(['websocket-events-and-replay']);
    expect(f.command.mock.calls.some(([name]) => name === 'rotate')).toBe(
      false,
    );
  },
);

test('modification cancellation cannot substitute for the final order cancellation event', async () => {
  const f = fixture();
  const command = f.command;
  f.command = vi.fn(async (name, input) => {
    const result = await command(name, input);
    return name === 'events'
      ? result.map((event) =>
          event.type === 'order_update'
            ? {
                ...event,
                data: event.data.filter(
                  (update) =>
                    !(update.status === 'canceled' && update.order.oid === 2),
                ),
              }
            : event,
        )
      : result;
  });
  await expect(testnetLifecycle(f)).rejects.toThrow('Missing correlated');
  expect(f.command.mock.calls.some(([name]) => name === 'rotate')).toBe(false);
});

test('a matching price on an unrelated order cannot prove modification', async () => {
  const f = fixture();
  const command = f.command;
  let modified = false;
  f.command = vi.fn(async (name, input) => {
    const result = await command(name, input);
    if (name === 'modify') modified = true;
    return name === 'orders' && modified
      ? result.map((order) => ({ ...order, cloid: '0x' + 'f'.repeat(32) }))
      : result;
  });
  await expect(testnetLifecycle(f)).rejects.toThrow(
    'Modified price not visible',
  );
  expect(f.command.mock.calls.some(([name]) => name === 'cancel')).toBe(false);
});

test('the rotated agent must place and cancel a real resting order after old-agent revocation', async () => {
  const f = fixture();
  const command = f.command;
  let oldRevoked = false;
  f.command = vi.fn(async (name, input) => {
    if (name === 'rotate' && input.revokeSignature) oldRevoked = true;
    if (name === 'order' && oldRevoked)
      throw new Error('New agent cannot sign');
    return command(name, input);
  });
  await expect(testnetLifecycle(f)).rejects.toThrow('New agent cannot sign');
  expect(
    f.checkpoint.mock.calls
      .filter(([stage]) => stage.status === 'failed')
      .map(([stage]) => stage.name),
  ).toEqual(['post-rotation-order-and-cancel']);
});

test('follower verification has its own failed stage and rejects unrelated streamed events', async () => {
  const f = fixture();
  f.stop.mockResolvedValue([{ seq: 1, type: 'order_update', data: [] }]);
  await expect(testnetLifecycle(f)).rejects.toThrow(
    'Follower did not deliver correlated',
  );
  expect(
    f.checkpoint.mock.calls
      .filter(([stage]) => stage.status === 'failed')
      .map(([stage]) => stage.name),
  ).toEqual(['events-follow-verification']);
  expect(f.stop).toHaveBeenCalledOnce();
});

test('follower cleanup cannot replace the causal exchange rejection', async () => {
  const f = fixture();
  f.stop.mockRejectedValue(new Error('Follower cleanup failed'));
  const command = f.command;
  f.command = vi.fn(async (name, input) => {
    if (name === 'order') throw new Error('Exchange rejected test order');
    return command(name, input);
  });
  await expect(testnetLifecycle(f)).rejects.toThrow(
    'Exchange rejected test order',
  );
  expect(
    f.checkpoint.mock.calls
      .filter(([stage]) => stage.status === 'failed')
      .map(([stage]) => stage.name),
  ).toEqual(['place-and-reconcile-resting-order']);
  expect(f.stop).toHaveBeenCalledOnce();
});

test('credential absence fails the actual entrypoint with a failure artifact and no secret output', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'bloxwap-e2e-report-'));
  try {
    await mkdir(join(cwd, 'artifacts'));
    for (const name of [
      'lifecycle-report.json',
      'events.jsonl',
      'events-follow.jsonl',
      'audit.jsonl',
      'runner-old.jsonl',
    ])
      await writeFile(join(cwd, 'artifacts', name), 'stale evidence');
    const env = {
      ...process.env,
      CI: 'true',
      BLOXWAP_E2E: '1',
      BLOXWAP_TEST_ACCOUNT_ONLY: '1',
    };
    for (const name of [
      'BLOXWAP_TEST_MASTER_KEY',
      'BLOXWAP_TEST_MASTER_ADDRESS',
      'BLOXWAP_TEST_SIGNER',
      'BLOXWAP_PRIVY_APP_ID',
      'BLOXWAP_PRIVY_APP_SECRET',
    ])
      delete env[name];
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../scripts/e2e-testnet.mjs', import.meta.url))],
      { cwd, env, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).not.toMatch(/SKIP|PASS/);
    const report = JSON.parse(
      await readFile(join(cwd, 'artifacts/lifecycle-report.json'), 'utf8'),
    );
    expect(() => verifyTestnetReport(report)).not.toThrow();
    expect(report).toMatchObject({
      status: 'failed',
      failure: 'testnet-preflight',
      stages: [],
    });
    expect(report.missingSecrets).toEqual([
      'BLOXWAP_TEST_MASTER_KEY',
      'BLOXWAP_PRIVY_APP_ID',
      'BLOXWAP_PRIVY_APP_SECRET',
    ]);
    expect(await readdir(join(cwd, 'artifacts'))).toEqual([
      'lifecycle-report.json',
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('CI-only test credentials and explicit test account acknowledgement are mandatory', () => {
  expect(() => requireTestnetEnvironment({})).toThrow('BLOXWAP_E2E');
  expect(() => requireTestnetEnvironment({ BLOXWAP_E2E: '1' })).toThrow(
    'CI-only',
  );
  expect(() =>
    requireTestnetEnvironment({ BLOXWAP_E2E: '1', CI: 'true' }),
  ).toThrow('disposable');
});
