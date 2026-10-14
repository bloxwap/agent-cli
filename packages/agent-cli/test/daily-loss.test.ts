import { expect, test } from 'vitest';
import { dailyLossFromPortfolio } from '../src/core/trading.js';
test('daily loss uses realized and marked pnl history across UTC day', () => {
  const midnight = Date.UTC(2026, 0, 1);
  expect(
    dailyLossFromPortfolio(
      [
        [
          'day',
          {
            pnlHistory: [
              [midnight - 1000, '100'],
              [midnight + 1000, '90.12345678'],
            ],
          },
        ],
      ],
      midnight + 2000,
    ),
  ).toBe('9.87654322');
  expect(() => dailyLossFromPortfolio([])).toThrow();
});
