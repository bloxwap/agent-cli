import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blockedOrderMessage,
  inspectExchangeAction,
  inspectWebsocketPayload,
  mockExchangeAction,
  mockHyperliquidOrdersEnabled,
  mockOpenOrders,
  mockOrdersEnv,
} from '../scripts/e2e-hl-orders.mjs';

const signature = { r: '0x' + '1'.repeat(64), s: '0x' + '2'.repeat(64), v: 27 };
const cloid = '0x' + 'ab'.repeat(16);

async function withHome(action) {
  const home = await mkdtemp(join(tmpdir(), 'bloxwap-e2e-orders-'));
  const previousHome = process.env.HOME;
  const previousMock = process.env[mockOrdersEnv];
  process.env.HOME = home;
  try {
    return await action();
  } finally {
    process.env.HOME = previousHome;
    if (previousMock === undefined) delete process.env[mockOrdersEnv];
    else process.env[mockOrdersEnv] = previousMock;
    await rm(home, { recursive: true, force: true });
  }
}

afterEach(() => {
  delete process.env[mockOrdersEnv];
});

test('approvals stay live while order and fund-moving actions cannot escape', () => {
  expect(inspectExchangeAction({ type: 'approveAgent' })).toBe('live');
  expect(inspectExchangeAction({ type: 'approveBuilderFee' })).toBe('live');
  expect(inspectExchangeAction({ type: 'order' })).toBe('order');
  expect(inspectExchangeAction({ type: 'cancel' })).toBe('order');
  expect(inspectExchangeAction({ type: 'batchModify' })).toBe('order');
  expect(inspectExchangeAction({ type: 'withdraw3' })).toBe('forbidden');
  expect(inspectExchangeAction({ type: 'usdSend' })).toBe('forbidden');
  expect(inspectExchangeAction({ type: 'usdClassTransfer' })).toBe('forbidden');
  expect(mockHyperliquidOrdersEnabled()).toBe(false);
  expect(() =>
    mockExchangeAction({
      action: { type: 'order', orders: [] },
      nonce: 1,
      signature,
    }),
  ).toThrow(blockedOrderMessage('order'));
});

test('the mocked book records resting, modified and canceled orders without claiming fills', async () => {
  await withHome(async () => {
    process.env[mockOrdersEnv] = '1';
    const placed = mockExchangeAction({
      action: {
        type: 'order',
        orders: [
          {
            a: 0,
            b: true,
            p: '7174.9',
            s: '0.00279',
            r: false,
            t: { limit: { tif: 'Alo' } },
            c: cloid,
          },
        ],
      },
      nonce: 1,
      signature,
    });
    expect(placed.response.response.data.statuses[0].resting.oid).toBe(1);
    expect(placed.updates).toEqual([
      expect.objectContaining({
        status: 'open',
        order: expect.objectContaining({
          coin: 'BTC',
          oid: 1,
          cloid,
          limitPx: '7174.9',
        }),
      }),
    ]);
    expect(mockOpenOrders('frontendOpenOrders')).toMatchObject([
      { oid: 1, coin: 'BTC', cloid, limitPx: '7174.9', sz: '0.00279' },
    ]);

    const modified = mockExchangeAction({
      action: {
        type: 'batchModify',
        modifies: [
          {
            oid: 1,
            order: {
              a: 0,
              b: true,
              p: '7031.4',
              s: '0.00279',
              r: false,
              t: { limit: { tif: 'Alo' } },
              c: cloid,
            },
          },
        ],
      },
      nonce: 2,
      signature,
    });
    expect(modified.response.response.data.statuses[0].resting.oid).toBe(1);
    expect(mockOpenOrders('frontendOpenOrders')[0].limitPx).toBe('7031.4');

    const canceled = mockExchangeAction({
      action: { type: 'cancel', cancels: [{ a: 0, o: 1 }] },
      nonce: 3,
      signature,
    });
    expect(canceled.response.response.data.statuses).toEqual(['success']);
    expect(canceled.updates[0].status).toBe('canceled');
    expect(mockOpenOrders('openOrders')).toEqual([]);
  });
});

test('unsigned or unknown exchange actions fail closed even when the mock is enabled', async () => {
  await withHome(async () => {
    process.env[mockOrdersEnv] = '1';
    expect(() =>
      mockExchangeAction({
        action: {
          type: 'order',
          orders: [{ a: 0, b: true, p: '1', s: '1', r: false, t: { limit: { tif: 'Alo' } } }],
        },
      }),
    ).toThrow('Unsigned');
    expect(() =>
      mockExchangeAction({
        action: { type: 'withdraw3' },
        nonce: 1,
        signature,
      }),
    ).toThrow('Unexpected Hyperliquid exchange action');
    expect(mockOpenOrders('clearinghouseState')).toBeNull();
  });
});

test('WebSocket action posts cannot place a live order', () => {
  const frame = JSON.stringify({
    method: 'post',
    id: 7,
    request: {
      type: 'action',
      payload: {
        action: { type: 'order', orders: [] },
        nonce: 1,
        signature,
      },
    },
  });
  expect(() => inspectWebsocketPayload(frame)).toThrow(
    blockedOrderMessage('order'),
  );
  expect(inspectWebsocketPayload(JSON.stringify({ method: 'subscribe' }))).toBe(
    'pass',
  );
});
