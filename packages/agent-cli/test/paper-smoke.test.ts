import { expect, test, vi } from 'vitest';
// Optional smoke test against real mainnet Hyperliquid public data.
// Run explicitly with: BLOXWAP_PAPER_SMOKE=1 npx vitest run test/paper-smoke.test.ts
// It never runs in the default suite (fetch stays stubbed there).
const enabled = process.env.BLOXWAP_PAPER_SMOKE === '1';
test('paper mode reads real mainnet public market data', { timeout: 30_000 }, async () => {
  if (!enabled) return;
  // The unit-test setup stubs fetch to fail; the smoke test needs the network.
  vi.unstubAllGlobals();
  const { paperData } = await import('../src/paper/services.js');
  const data = paperData();
  const [marks, funding, mids] = await Promise.all([
    data.marks(),
    data.fundingRates(),
    data.mids(),
  ]);
  expect(marks.BTC).toBeTruthy();
  expect(Number(marks.BTC)).toBeGreaterThan(0);
  expect(funding.BTC).toBeTruthy();
  expect(mids.BTC).toBeTruthy();
  const book = await data.book('BTC');
  expect(book.asks.length).toBeGreaterThan(0);
  expect(Number(book.asks[0].px)).toBeGreaterThanOrEqual(Number(book.bids[0].px));
  const coin = await data.coinOfAsset(0);
  expect(coin).toBe('BTC');
  const { createClients } = await import('../src/core/hlclient.js');
  const market = await createClients('mainnet').meta.lookup('BTC');
  expect(market.maxLeverage).toBeGreaterThan(0);
});
