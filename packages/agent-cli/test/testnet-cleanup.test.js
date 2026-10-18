import { expect, test, vi } from 'vitest';
import { cleanupTestnetAccount } from '../scripts/testnet-cleanup.mjs';

const owned = [
  { address: '0x' + '1'.repeat(40), name: 'bloxwap' },
  { address: '0x' + '2'.repeat(40), name: 'blox-next' },
];
function fixture({ approvals = owned, orders = [], positions = [] } = {}) {
  let remaining = structuredClone(approvals);
  let open = structuredClone(orders);
  return {
    masterAddress: 'test-master',
    agents: owned,
    info: vi.fn(async (type) => {
      if (type === 'extraAgents') return remaining;
      if (type === 'frontendOpenOrders') return open;
      if (type === 'clearinghouseState') return { assetPositions: positions };
      throw new Error('Unexpected query');
    }),
    cancel: vi.fn(async ({ oid }) => {
      open = open.filter((order) => order.oid !== oid);
    }),
    revoke: vi.fn(async ({ address }) => {
      remaining = remaining.filter((agent) => agent.address !== address);
    }),
  };
}

test.each([owned, [owned[0]], [owned[1]]].map((approvals) => [approvals]))(
  'partial init/rotation cleanup revokes every approved run-owned agent (%#)',
  async (approvals) => {
    const f = fixture({ approvals, orders: [{ oid: 12 }] });
    expect(await cleanupTestnetAccount(f)).toEqual({
      status: 'verified',
      orders: 0,
      agents: 0,
      positions: 0,
    });
    expect(f.revoke.mock.calls.map(([agent]) => agent)).toEqual(approvals);
    expect(f.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      f.revoke.mock.invocationCallOrder[0],
    );
  },
);

test('an unrecognized address or name is left untouched and prevents cleanup success', async () => {
  const unknown = { address: '0x' + '3'.repeat(40), name: 'another-wallet' };
  const mismatched = { ...owned[0], name: 'other-name' };
  const f = fixture({ approvals: [unknown, mismatched, owned[1]] });
  expect(await cleanupTestnetAccount(f)).toEqual({
    status: 'failed',
    orders: 0,
    agents: 2,
    positions: 0,
  });
  expect(f.revoke.mock.calls.map(([agent]) => agent)).toEqual([owned[1]]);
});

test('a failed old-agent revocation still attempts the new-agent cleanup and final verification', async () => {
  const f = fixture();
  const revoke = f.revoke;
  f.revoke = vi.fn(async (agent) => {
    if (agent.address === owned[0].address) throw new Error('Rejected');
    return revoke(agent);
  });
  expect(await cleanupTestnetAccount(f)).toEqual({
    status: 'failed',
    orders: 0,
    agents: 1,
    positions: 0,
  });
  expect(f.revoke).toHaveBeenCalledTimes(2);
  expect(f.info).toHaveBeenCalledWith('clearinghouseState', {
    user: f.masterAddress,
  });
});

test('unavailable local cancellation never bypasses revocation and leaves explicit failure', async () => {
  const f = fixture({ orders: [{ oid: 9 }] });
  f.cancel.mockRejectedValue(new Error('Agent already locally revoked'));
  expect(await cleanupTestnetAccount(f)).toEqual({
    status: 'failed',
    orders: 1,
    agents: 0,
    positions: 0,
  });
  expect(f.revoke).toHaveBeenCalledTimes(2);
});

test('nonzero positions fail cleanup even after orders and approvals disappear', async () => {
  const f = fixture({
    positions: [{ position: { szi: '-0.001' } }, { position: { szi: '0' } }],
  });
  expect(await cleanupTestnetAccount(f)).toEqual({
    status: 'failed',
    orders: 0,
    agents: 0,
    positions: 1,
  });
});

test('unreadable exchange state cannot be reported as empty and other cleanup continues', async () => {
  const f = fixture();
  const info = f.info;
  f.info = vi.fn(async (type, params) => {
    if (type === 'frontendOpenOrders') throw new Error('Offline');
    return info(type, params);
  });
  expect(await cleanupTestnetAccount(f)).toEqual({
    status: 'failed',
    agents: 0,
    positions: 0,
  });
  expect(f.revoke).toHaveBeenCalledTimes(2);
});

test.each(['not-a-number', null, '', 0])(
  'malformed position state prevents verification (%s)',
  async (szi) => {
    const f = fixture({ positions: [{ position: { szi } }] });
    expect(await cleanupTestnetAccount(f)).toEqual({
      status: 'failed',
      orders: 0,
      agents: 0,
    });
  },
);

test('tiny nonzero positions cannot underflow to zero during cleanup', async () => {
  const f = fixture({
    positions: [{ position: { szi: '0.' + '0'.repeat(400) + '1' } }],
  });
  expect(await cleanupTestnetAccount(f)).toEqual({
    status: 'failed',
    orders: 0,
    agents: 0,
    positions: 1,
  });
});
