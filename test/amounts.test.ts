import { expect, test } from 'vitest';
import {
  parseUsdc,
  formatUsdc,
  toHyperCore,
  fromHyperCore,
} from '../src/funding/amounts.js';
test('exact bigint round trips across decimals and large values', () => {
  for (const decimals of [0, 6, 8])
    for (let i = -1000n; i < 1000n; i += 7n) {
      const value = i * 123456789012345678901n;
      expect(parseUsdc(formatUsdc(value, decimals), decimals)).toBe(value);
    }
  expect(fromHyperCore(toHyperCore(1234567n))).toBe(1234567n);
  expect(() => fromHyperCore(101n)).toThrow();
  expect(() => parseUsdc('1.0000001', 6)).toThrow();
});
