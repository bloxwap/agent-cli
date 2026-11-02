import { expect, test, vi } from 'vitest';
import {
  approval,
  rejectMasterKey,
  submitApproval,
} from '../src/wallet/approval.js';
import { jsonRequest } from '../src/core/http.js';
import { AgentCliError } from '../src/errors/index.js';

vi.mock('../src/core/http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/http.js')>();
  return { ...actual, jsonRequest: vi.fn() };
});

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

test('approval rejection preserves the action and upstream reason', async () => {
  vi.mocked(jsonRequest).mockResolvedValue({
    status: 'error',
    response: 'Must deposit before performing actions',
  });
  const pending = approval(
    'testnet',
    'approveAgent',
    { agentAddress: '0x' + 'a'.repeat(40), agentName: 'agent' },
    123,
  );
  const error = await submitApproval(
    'testnet',
    pending,
    '0x' + 'ab'.repeat(64) + '1b',
  ).catch((error: unknown) => error);

  expect(error).toBeInstanceOf(AgentCliError);
  expect((error as AgentCliError).toJSON()).toMatchObject({
    code: 'UPSTREAM_ERROR',
    message: 'approveAgent failed: Must deposit before performing actions',
    details: {
      hyperliquidResponse: {
        status: 'error',
        response: 'Must deposit before performing actions',
      },
    },
  });
});
