import { expect, test } from 'vitest';
import {
  commandEnvelopeError,
  safeTestnetError,
} from '../scripts/testnet-errors.mjs';

test('CLI envelope failures preserve their normalized code and message', () => {
  expect(
    commandEnvelopeError('init', {
      ok: false,
      code: 'UPSTREAM_ERROR',
      message: 'approveAgent failed: Must deposit before performing actions',
    }).message,
  ).toBe(
    'Command init failed: [UPSTREAM_ERROR] approveAgent failed: Must deposit before performing actions',
  );
});

test('testnet failure reports redact configured secrets and key material', () => {
  const secret = 'test-app-secret';
  const privateKey = '0x' + 'ab'.repeat(32);
  const message = safeTestnetError(
    new Error(`request failed for ${secret} with ${privateKey}`),
    [secret],
  );
  expect(message).toBe('request failed for [REDACTED] with [REDACTED]');
});
