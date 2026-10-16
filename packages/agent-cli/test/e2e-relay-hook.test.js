import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

test('test preload blocks mainnet, requires the explicit mocked route, and passes through real test services', async () => {
  const upstream = vi.fn(async () => Response.json({ liveServiceFixture: true }));
  vi.stubGlobal('fetch', upstream);
  await import('../scripts/e2e-relay-hook.mjs');
  await expect(fetch('https://api.hyperliquid.xyz/info')).rejects.toThrow('Mainnet');
  await expect(fetch(new Request('https://api.relay.link/quote/v2'))).rejects.toThrow('Mainnet');
  await expect(fetch('https://api.testnets.relay.link/quote/v2', {
    body: JSON.stringify({ originChainId: 42161 }),
  })).rejects.toThrow('test-only');
  const quote = await (await fetch(new Request('https://api.testnets.relay.link/quote/v2', {
    method: 'POST', body: JSON.stringify({ originChainId: 421614, originCurrency: '0x' + '0'.repeat(40) }),
  }))).json();
  expect(quote.details.currencyOut.amount).toBe('0');
  expect(await (await fetch('https://api.testnets.relay.link/intents/status?id=test')).json())
    .toEqual({ status: 'success' });
  await fetch('https://api.hyperliquid-testnet.xyz/info');
  await fetch(new Request('https://api.privy.io/v1/wallets'));
  expect(upstream).toHaveBeenCalledTimes(2);
});
