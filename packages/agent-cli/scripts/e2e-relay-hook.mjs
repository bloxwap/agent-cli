// Loaded only by the explicit testnet e2e harness, never by the packaged CLI.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const target = new URL(url instanceof Request ? url.url : String(url));
  if (['api.hyperliquid.xyz', 'api.relay.link'].includes(target.hostname))
    throw new Error('Mainnet requests are forbidden in the CI test harness');
  if (target.origin === 'https://api.testnets.relay.link') {
    if (target.pathname.startsWith('/quote/')) {
      const quote = JSON.parse(url instanceof Request ? await url.clone().text() : String(init?.body));
      if (quote.originChainId !== 421614 || quote.originCurrency !== '0x' + '0'.repeat(40))
        throw new Error('Expected the explicit test-only Relay fixture route');
      return Response.json({
        steps: [
          {
            id: 'deposit',
            kind: 'transaction',
            requestId: 'mock-testnet-deposit',
            depositAddress: '0x' + 'b'.repeat(40),
            items: [{ status: 'incomplete', data: {} }],
          },
        ],
        fees: {},
        details: {
          currencyOut: { amount: '0', currency: { decimals: 8 } },
          expiresAt: Date.now() + 60000,
        },
      });
    }
    if (target.pathname.startsWith('/intents/status'))
      return Response.json({ status: 'success' });
    throw new Error('Unexpected Relay mock endpoint');
  }
  return originalFetch(url, init);
};
