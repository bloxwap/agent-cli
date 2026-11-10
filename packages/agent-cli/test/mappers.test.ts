import { expect, test } from 'vitest';
import {
  mapHyperliquidError,
  mapPrivyError,
  mapRelayError,
  mapNetworkError,
} from '../src/errors/mappers.js';
import { AgentCliError, errorDefaults, type ErrorCode } from '../src/errors/index.js';

const upstream: [string, ErrorCode, boolean, 'hyperliquid' | 'privy' | 'relay'][] = [
  ['Insufficient margin to place order.', 'INSUFFICIENT_MARGIN', false, 'hyperliquid'],
  ['Policy denied this request', 'POLICY_REJECTED', false, 'privy'],
  ['Agent expired', 'AGENT_EXPIRED', false, 'hyperliquid'],
  [
    'User or API Wallet 0xabc does not exist.',
    'AGENT_NOT_APPROVED',
    false,
    'hyperliquid',
  ],
  ['Nonce already used', 'NONCE_COLLISION', true, 'hyperliquid'],
  ['Invalid nonce: nonce too old', 'UPSTREAM_ERROR', false, 'hyperliquid'],
  ['HTTP 429 Too Many Requests', 'RATE_LIMIT', true, 'hyperliquid'],
  ['Order must have minimum value of 10 USDC.', 'INVALID_SIZE', false, 'hyperliquid'],
  ['Price must be divisible by tick size.', 'INVALID_PRICE', false, 'hyperliquid'],
  ['Order was never placed, already canceled, or filled.', 'ORDER_NOT_FOUND', false, 'hyperliquid'],
  ['Unexpected relay quote failure', 'UPSTREAM_ERROR', false, 'relay'],
];

test.each(upstream)('maps %s to %s', (message, code, retryable, service) => {
  const mapped =
    service === 'privy'
      ? mapPrivyError(message)
      : service === 'relay'
        ? mapRelayError(message)
        : mapHyperliquidError(message);
  expect(mapped.toJSON()).toMatchObject({ code, retryable });
});

test('stale nonce rejections are not retryable', () => {
  expect(mapHyperliquidError('Invalid nonce: nonce too old').toJSON()).toMatchObject({
    code: 'UPSTREAM_ERROR',
    retryable: false,
    details: { nonceRejected: true },
  });
});

test('every catalog code has a fixture', () => {
  const seen = new Set<ErrorCode>(upstream.map((entry) => entry[1]));
  for (const code of Object.keys(errorDefaults) as ErrorCode[]) {
    if (!seen.has(code)) {
      const local = new AgentCliError(code, code);
      expect(local.code).toBe(code);
      expect(local.retryable).toBe(errorDefaults[code]);
      seen.add(code);
    }
  }
  expect([...seen].sort()).toEqual(Object.keys(errorDefaults).sort());
});

test('policy, relay unknown and network flags redact details', () => {
  expect(mapPrivyError('Policy denied').code).toBe('POLICY_REJECTED');
  expect(
    mapRelayError({ message: 'unexpected', token: 'secret' }).toJSON(),
  ).toMatchObject({
    code: 'UPSTREAM_ERROR',
    details: { upstream: { token: '[REDACTED]' } },
  });
  expect(mapNetworkError(new Error('fetch failed')).retryable).toBe(true);
});
