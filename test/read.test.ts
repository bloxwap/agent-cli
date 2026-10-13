import { accountFixture } from './fixtures.js';
import { expect, test } from 'vitest';
import {
  accountBalance,
  positions,
  expiryStatus,
} from '../src/commands/read.js';
import { migrate } from '../src/core/config.js';

test('read fixtures retain numeric strings and exact balances', () => {
  expect(accountBalance(accountFixture).accountValueUnits).toBe('10012345678');
  expect(positions(accountFixture)[0]).toMatchObject({
    size: '0.001',
    leverage: '5',
    entryPrice: '20000',
  });
  expect(
    expiryStatus(migrate({ agentExpiry: 86400000 }), 0).warnings,
  ).toHaveLength(3);
});
