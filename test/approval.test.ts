import { expect, test } from 'vitest';
import { approval, rejectMasterKey } from '../src/wallet/approval.js';
test('user signature payload follows SDK types and master secrets are refused', () => {
  const result = approval(
    'testnet',
    'approveAgent',
    { agentAddress: '0x' + 'a'.repeat(40), agentName: 'agent' },
    123,
  );
  expect(result.typedData).toMatchObject({
    primaryType: 'HyperliquidTransaction:ApproveAgent',
    message: { nonce: 123, hyperliquidChain: 'Testnet' },
  });
  expect(() => rejectMasterKey({ key: '0x' + 'ab'.repeat(32) })).toThrow();
  expect(() => rejectMasterKey({ privateKey: 'anything' })).toThrow();
  rejectMasterKey({ signature: '0x' + 'ab'.repeat(65) });
});
