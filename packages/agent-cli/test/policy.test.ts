import { expect, test } from 'vitest';
import { assertTradeAction } from '../src/wallet/policy.js';
test('trade-only action whitelist rejects withdrawal and approval', () => {
  for (const action of [
    'withdraw',
    'withdraw3',
    'usdSend',
    'spotSend',
    'approveAgent',
    'approveBuilderFee',
    'usdClassTransfer',
    'sendAsset',
    'subAccountTransfer',
    'vaultTransfer',
    'cWithdraw',
  ])
    expect(() => assertTradeAction(action)).toThrow(
      expect.objectContaining({ code: 'POLICY_REJECTED' }),
    );
  assertTradeAction('order');
});
