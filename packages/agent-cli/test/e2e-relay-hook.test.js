import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockOrdersEnv } from '../scripts/e2e-hl-orders.mjs';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env[mockOrdersEnv];
});

const signedOrder = {
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
        c: '0x' + '1'.repeat(32),
      },
    ],
  },
  nonce: 1,
  signature: { r: '0x' + '1'.repeat(64), s: '0x' + '2'.repeat(64), v: 27 },
};

test('test preload blocks mainnet, mocks Relay and Hyperliquid orders, and passes through live test services', async () => {
  const home = await mkdtemp(join(tmpdir(), 'bloxwap-e2e-hook-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const upstream = vi.fn(async () => Response.json({ liveServiceFixture: true }));
    vi.stubGlobal('fetch', upstream);
    await import('../scripts/e2e-relay-hook.mjs');
    await expect(fetch('https://api.hyperliquid.xyz/info')).rejects.toThrow('Mainnet');
    await expect(fetch(new Request('https://api.relay.link/quote/v2'))).rejects.toThrow('Mainnet');
    await expect(fetch('https://rpc.hyperliquid.xyz/info')).rejects.toThrow('Mainnet');
    await expect(fetch('https://api.testnets.relay.link/quote/v2', {
      body: JSON.stringify({ originChainId: 42161 }),
    })).rejects.toThrow('test-only');
    const quote = await (await fetch(new Request('https://api.testnets.relay.link/quote/v2', {
      method: 'POST', body: JSON.stringify({ originChainId: 421614, originCurrency: '0x' + '0'.repeat(40) }),
    }))).json();
    expect(quote.details.currencyOut.amount).toBe('0');
    expect(await (await fetch('https://api.testnets.relay.link/intents/status?id=test')).json())
      .toEqual({ status: 'success' });

    await expect(fetch('https://api.hyperliquid-testnet.xyz/exchange', {
      method: 'POST',
      body: JSON.stringify(signedOrder),
    })).rejects.toThrow('must not reach the exchange');
    await expect(fetch('https://api.hyperliquid-testnet.xyz/exchange', {
      method: 'POST',
      body: JSON.stringify({
        action: { type: 'withdraw3' },
        nonce: 1,
        signature: signedOrder.signature,
      }),
    })).rejects.toThrow('Unexpected Hyperliquid exchange action');

    process.env[mockOrdersEnv] = '1';
    const placed = await (await fetch('https://api.hyperliquid-testnet.xyz/exchange', {
      method: 'POST',
      body: JSON.stringify(signedOrder),
    })).json();
    expect(placed.response.data.statuses[0].resting.oid).toBe(1);
    expect(await (await fetch('https://api.hyperliquid-testnet.xyz/info', {
      method: 'POST',
      body: JSON.stringify({ type: 'frontendOpenOrders' }),
    })).json()).toMatchObject([{ oid: 1, coin: 'BTC', limitPx: '7174.9' }]);

    await fetch('https://api.hyperliquid-testnet.xyz/info');
    await fetch(new Request('https://api.privy.io/v1/wallets'));
    await fetch('https://api.hyperliquid-testnet.xyz/exchange', {
      method: 'POST',
      body: JSON.stringify({
        action: { type: 'approveAgent', agentAddress: '0x' + '1'.repeat(40) },
        nonce: 2,
        signature: signedOrder.signature,
      }),
    });
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(upstream.mock.calls.map(([url]) => String(url instanceof Request ? url.url : url))).toEqual([
      'https://api.hyperliquid-testnet.xyz/info',
      'https://api.privy.io/v1/wallets',
      'https://api.hyperliquid-testnet.xyz/exchange',
    ]);
  } finally {
    process.env.HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});
