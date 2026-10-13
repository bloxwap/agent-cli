// Loaded only by the explicit testnet e2e harness, never by the packaged CLI.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.testnets.relay.link/')) {
    if (String(url).includes('/quote/'))
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
    if (String(url).includes('/intents/status'))
      return Response.json({ status: 'success' });
    throw new Error('Unexpected Relay mock endpoint');
  }
  return originalFetch(url, init);
};
