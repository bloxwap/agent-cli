import { vi } from 'vitest';
import type { TradingServices } from '../src/core/trading.js';
import type { AccountState } from '../src/commands/read.js';
export const accountFixture: AccountState = {
  marginSummary: {
    accountValue: '100.12345678',
    totalMarginUsed: '4',
    totalNtlPos: '20',
  },
  withdrawable: '96',
  assetPositions: [
    {
      position: {
        coin: 'BTC',
        szi: '0.001',
        entryPx: '20000',
        unrealizedPnl: '1',
        liquidationPx: '10000',
        leverage: { type: 'cross', value: 5 },
      },
    },
  ],
};
export function mockTrading(): TradingServices {
  return {
    market: async () => ({
      name: 'BTC',
      szDecimals: 5,
      maxLeverage: 40,
      asset: 0,
    }),
    state: async () => accountFixture,
    orders: async () => [],
    mids: async () => ({ BTC: '20000' }),
    exchange: {
      order: vi.fn(async () => ({ status: 'ok' })),
      cancel: vi.fn(async () => ({ status: 'ok' })),
      cancelByCloid: vi.fn(async () => ({ status: 'ok' })),
      batchModify: vi.fn(async () => ({ status: 'ok' })),
      updateLeverage: vi.fn(async () => ({ status: 'ok' })),
    },
  };
}
export const quoteFixture = {
  steps: [
    {
      id: 'deposit',
      kind: 'transaction',
      requestId: 'deposit-1',
      depositAddress: '0x' + 'a'.repeat(40),
      items: [{ status: 'incomplete', data: { chainId: 42161 } }],
    },
  ],
  fees: {
    app: { amount: '10' },
    gas: { amount: '20' },
    relayerService: { amount: '30' },
  },
  details: {
    currencyOut: { amount: '100000000', currency: { decimals: 8 } },
    minAmount: '1000000',
    expiresAt: 2000000000000,
  },
};
