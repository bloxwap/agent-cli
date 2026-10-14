import { expect, test } from 'vitest';
import { advanceDeposit } from '../src/funding/status.js';
import type { Deposit } from '../src/funding/store.js';
import { quoteFixture } from './fixtures.js';
test('settlement requires Relay success plus expected balance increase', () => {
  const deposit = {
    quote: quoteFixture,
    state: 'awaiting_funds',
    baseline: '2',
    id: 'one',
    network: 'testnet',
    recipient: 'master',
    route: 'route',
    expiresAt: 2000000000000,
    createdAt: 0,
    completedSteps: [],
  } satisfies Deposit;
  expect(advanceDeposit(deposit, 'success', '2.9')).toBe('pending');
  expect(advanceDeposit(deposit, 'success', '3')).toBe('settled');
  expect(advanceDeposit(deposit, 'failed', '3')).toBe('failed');
  expect(advanceDeposit({ ...deposit, state: 'settled' }, 'failed', '0')).toBe(
    'settled',
  );
});
test('marked PnL changes do not count as a deposit receipt', async () => {
  const { collateralBalance } = await import('../src/core/account.js');
  expect(
    collateralBalance({
      marginSummary: { accountValue: '110' },
      assetPositions: [{ position: { unrealizedPnl: '60' } }],
    }),
  ).toBe('50');
  expect(
    collateralBalance({
      marginSummary: { accountValue: '90' },
      assetPositions: [{ position: { unrealizedPnl: '-10' } }],
    }),
  ).toBe('100');
});
