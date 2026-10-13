import { expect, test } from 'vitest';
import { assertTradeAction, policyFor } from '../src/wallet/policy.js';
test('trade-only action whitelist rejects withdrawal and approval', () => {
  for (const action of [
    'withdraw',
    'withdraw3',
    'usdSend',
    'spotSend',
    'approveAgent',
    'approveBuilderFee',
    'usdClassTransfer',
  ])
    expect(() => assertTradeAction(action)).toThrow(
      expect.objectContaining({ code: 'POLICY_REJECTED' }),
    );
  assertTradeAction('order');
  expect(policyFor('mainnet').rules[0].conditions[2].value).toBe('a');
});
