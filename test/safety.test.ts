import { expect, test } from 'vitest';
import { assertSafeInput } from '../src/wallet/safety.js';
import { dispatch } from '../src/core/router.js';
import { redact } from '../src/core/logger.js';
test('secret detector covers keys, seeds and nested ignored fields', () => {
  for (const value of [
    'ab'.repeat(32),
    '0x' + '12'.repeat(32),
    'abandon '.repeat(11) + 'about',
    { ignored: { seedPhrase: 'secret' } },
    ['abandon '.repeat(12).trim()],
  ])
    expect(() => assertSafeInput(value)).toThrow();
  assertSafeInput({
    signature: '0x' + '12'.repeat(65),
    address: '0x' + 'a'.repeat(40),
  });
});
test('environment secrets are scrubbed from arbitrary messages', async () => {
  process.env.BLOXWAP_SECRET_TOKEN = 'sensitive-value';
  try {
    expect(redact('failure: sensitive-value')).toBe('failure: [REDACTED]');
    expect(
      (
        await dispatch([
          'config',
          '--json',
          JSON.stringify({ privateKey: 'ab'.repeat(32) }),
        ])
      ).body,
    ).toMatchObject({ ok: false });
  } finally {
    delete process.env.BLOXWAP_SECRET_TOKEN;
  }
});
test('secrets embedded in free-form intent text are also refused', () => {
  expect(() =>
    assertSafeInput('key: 0x' + '12'.repeat(32) + ' please use it'),
  ).toThrow();
  expect(() =>
    assertSafeInput('recovery words: ' + 'abandon '.repeat(11) + 'about'),
  ).toThrow();
  assertSafeInput('signature: 0x' + '12'.repeat(65));
});
