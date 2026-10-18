import { afterEach, expect, test, vi } from 'vitest';
import { startEventFollower } from '../scripts/testnet-follower.mjs';

const followers = [];
afterEach(async () => {
  await Promise.all(
    followers.splice(0).map((follower) => follower.stop().catch(() => {})),
  );
});
function start(source, options = {}) {
  const follower = startEventFollower({
    command: process.execPath,
    args: ['-e', source],
    timeoutMs: 200,
    ...options,
  });
  followers.push(follower);
  return follower;
}
async function ready(follower) {
  await vi.waitFor(() => expect(follower.text).toContain('ready'));
}

test('stopping drains trailing stdout through close and is idempotent', async () => {
  const follower = start(`
    process.on('SIGTERM', () => { process.stdout.write(JSON.stringify({tail:'x'.repeat(262144)})+'\\n', () => process.exit(0)); });
    console.log(JSON.stringify({ready:true}));
    setInterval(() => {}, 1000);
  `);
  await ready(follower);
  const stopped = follower.stop();
  expect(follower.stop()).toBe(stopped);
  const events = await stopped;
  expect(events).toHaveLength(2);
  expect(events[1].tail).toHaveLength(262144);
});

test('a child already terminated by signal rejects promptly rather than waiting for another exit', async () => {
  const follower = start(
    `console.log(JSON.stringify({ready:true})); process.kill(process.pid, 'SIGKILL');`,
  );
  await ready(follower);
  // The signal has been delivered before stop is requested.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await expect(follower.stop()).rejects.toThrow('unexpectedly');
});

test('an unrequested successful early exit is still a follower failure', async () => {
  const follower = start(`console.log(JSON.stringify({ready:true}));`);
  await ready(follower);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await expect(follower.stop()).rejects.toThrow('unexpectedly');
});

test('malformed streamed JSON fails after a graceful shutdown', async () => {
  const follower = start(`
    process.on('SIGTERM', () => process.exit(0));
    console.log('ready but not JSON'); setInterval(() => {}, 1000);
  `);
  await ready(follower);
  await expect(follower.stop()).rejects.toThrow('malformed JSON');
});

test('output overflow terminates the follower without retaining unbounded output', async () => {
  const follower = start(
    `process.on('SIGTERM', () => process.stdout.write('x'.repeat(100000))); console.log('ready'); setInterval(() => {}, 1000);`,
    { maxBytes: 32 },
  );
  await ready(follower);
  await expect(follower.stop()).rejects.toThrow('output limit');
  expect(Buffer.byteLength(follower.text)).toBeLessThanOrEqual(32);
});

test('a follower ignoring SIGTERM is killed within the bounded stop budget', async () => {
  const follower = start(
    `process.on('SIGTERM', () => {}); console.log(JSON.stringify({ready:true})); setInterval(() => {}, 1000);`,
  );
  await ready(follower);
  await expect(follower.stop()).rejects.toThrow('time limit');
});

test('spawn errors settle without waiting forever', async () => {
  const follower = start('', {
    command: '/not-a-real-bloxwap-test-executable',
  });
  await expect(follower.stop()).rejects.toThrow('could not start');
});
