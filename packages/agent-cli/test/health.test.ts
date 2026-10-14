import { expect, test } from 'vitest';
import { health } from '../src/runner/health.js';
import { Runner } from '../src/runner/lifecycle.js';
import { migrate } from '../src/core/config.js';
import type { Subscriptions } from '../src/runner/subscriptions.js';
test('health reports staleness, uptime and signer state', () => {
  const runner = new Runner(migrate({}));
  runner.subscriptions = {
    state: 'connected',
    lastMessage: 1000,
    lastFill: 500,
  } as Subscriptions;
  expect(health(runner, 2000)).toMatchObject({
    wsState: 'connected',
    wsStale: false,
    lastFillTime: 500,
    signingSession: 'unavailable',
  });
  expect(health(runner, 100000).wsStale).toBe(true);
});
