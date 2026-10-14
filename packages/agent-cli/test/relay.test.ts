import { quoteFixture } from './fixtures.js';
import { expect, test, vi } from 'vitest';
import { RelayClient, PERPS_USDC, parseQuote } from '../src/funding/relay.js';

test('Relay request uses perps destination and parses fees/address', async () => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify(quoteFixture)),
  ) as unknown as typeof fetch;
  const client = new RelayClient('https://api.relay.link', fetcher);
  const quote = await client.quote({
    user: 'master',
    recipient: 'master',
    originChainId: 42161,
    originCurrency: 'USDC',
    amount: '1000000',
    destinationChainId: 1337,
    destinationCurrency: PERPS_USDC,
    useDepositAddress: true,
    tradeType: 'EXACT_INPUT',
  });
  expect(parseQuote(quote)).toMatchObject({
    depositId: 'deposit-1',
    expectedReceived: '100000000',
    fees: {
      app: { amount: '10' },
      gas: { amount: '20' },
      relayer: { amount: '30' },
    },
  });
});
