import { expect, test, vi } from 'vitest';
import {
  MetaCache,
  roundPrice,
  roundSize,
  createClients,
} from '../src/core/hlclient.js';
test('fixture metadata caches and refreshes', async () => {
  const fixture = {
    universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }],
  };
  const fetch = vi.fn(async () => fixture);
  const cache = new MetaCache(fetch);
  expect(await cache.lookup('BTC')).toEqual({
    ...fixture.universe[0],
    asset: 0,
  });
  await cache.lookup('BTC');
  expect(fetch).toHaveBeenCalledTimes(1);
  await cache.refresh();
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(cache.lookup('NO')).rejects.toMatchObject({
    code: 'UNKNOWN_MARKET',
  });
});
test('SDK rounds exact decimal fixtures', () => {
  expect(roundSize('1.234567', 5)).toBe('1.23456');
  expect(roundPrice('97123.456', 5)).toBe('97123');
  expect(roundPrice('1.23456', 3)).toBe('1.234');
  expect(() => roundSize('0.000001', 5)).toThrow();
  expect(createClients('testnet').exchange).toBeUndefined();
});
test('malformed metadata cannot disable leverage or precision limits', async () => {
  const cache = new MetaCache(async () => ({
    universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: NaN }],
  }));
  await expect(cache.lookup('BTC')).rejects.toMatchObject({
    code: 'UPSTREAM_ERROR',
  });
});
