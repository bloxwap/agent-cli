import { test, expect } from 'vitest';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { stateDir, migrate } from '../src/core/config.js';
import { Runner, runningInfo } from '../src/runner/lifecycle.js';
import { rpcServer, rpcCall, socketPath } from '../src/runner/rpc.js';
import { HttpRequestError } from '@bloxwap/hyperliquid';
import { asUnknownMutation } from '../src/core/trading.js';
import { Subscriptions } from '../src/runner/subscriptions.js';
import { EventStore } from '../src/runner/events.js';
import '../src/commands/read.js';

test('a busy runner answers ping independently of queued work', async () => {
  const dir = join(stateDir(), 'busy');
  await mkdir(dir, { recursive: true });
  const runner = new Runner(migrate({}), dir);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((r) => (entered = r));
  const block = new Promise<void>((r) => (release = r));
  await rpcServer(runner, { pretty: false }, async () => {
    entered();
    await block;
    return {};
  });
  await runner.markReady();
  const busy = rpcCall('status', {}, socketPath(dir));
  await started;
  try {
    expect(await runningInfo(join(dir, 'runner.pid'))).toMatchObject({
      ready: true,
      token: runner.info.token,
    });
  } finally {
    release();
    await busy;
    await runner.shutdown();
  }
});

test('a disconnected RPC caller does not cancel an already accepted command', async () => {
  const dir = join(stateDir(), 'late');
  await mkdir(dir, { recursive: true });
  const runner = new Runner(migrate({}), dir);
  let release!: () => void;
  const block = new Promise<void>((r) => (release = r));
  let mutated = false;
  await rpcServer(runner, { pretty: false }, async () => {
    await block;
    mutated = true;
    return {};
  });
  try {
    await expect(
      rpcCall('order', {}, socketPath(dir), 15),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(mutated).toBe(false);
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mutated).toBe(true);
  } finally {
    release();
    await runner.shutdown();
  }
});

test('actual SDK timeouts retain unknown mutation outcomes', () => {
  const result = asUnknownMutation(
    new HttpRequestError({ detail: 'Request timed out after 10000 ms' }),
    '0x' + 'ab'.repeat(16),
  );
  expect(result.code).toBe('NETWORK_ERROR');
  expect(result.details).toMatchObject({ outcome: 'unknown' });
  expect(result.retryable).toBe(false);
});

test('fill deduplication separates networks and accounts', async () => {
  const dir = join(stateDir(), 'identity');
  await mkdir(dir, { recursive: true });
  const events = new EventStore(join(dir, 'events.jsonl'));
  await events.append('fill', {
    tid: 77,
    time: Date.now(),
    account: 'old-account',
    network: 'testnet',
  });
  const emitted: unknown[] = [];
  const subs = new Subscriptions(
    new Runner(
      migrate({ network: 'mainnet', masterAddress: '0x' + '34'.repeat(20) }),
      dir,
    ),
    {
      subscribe: async () => ({ unsubscribe: async () => {} }),
      onState: () => {},
      close: async () => {},
      gap: async () => [],
    },
    async (_type, payload) => {
      emitted.push(payload);
    },
  );
  await subs.fill({
    tid: 77,
    time: Date.now(),
    account: 'new-account',
    network: 'mainnet',
  });
  expect(emitted).toHaveLength(1);
});

test('RPC bounds queued work and remains responsive to health checks', async () => {
  const { createConnection } = await import('node:net');
  const dir = join(stateDir(), 'bounded');
  await mkdir(dir, { recursive: true });
  const runner = new Runner(migrate({}), dir);
  let release!: () => void,
    entered!: () => void,
    executed = 0;
  const block = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  await rpcServer(runner, { pretty: false }, async () => {
    executed++;
    entered();
    await block;
    return {};
  });
  const socket = createConnection(socketPath(dir));
  socket.on('error', () => {});
  try {
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write(
      JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'status', params: {} }) +
        '\n',
    );
    await started;
    socket.write(
      Array.from(
        { length: 200 },
        (_, i) =>
          JSON.stringify({
            jsonrpc: '2.0',
            id: i + 1,
            method: 'status',
            params: {},
          }) + '\n',
      ).join(''),
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(await rpcCall('runner.ping', {}, socketPath(dir))).toMatchObject({
      token: runner.info.token,
    });
    release();
    await new Promise((r) => setTimeout(r, 100));
    expect(executed).toBeLessThanOrEqual(64);
  } finally {
    release();
    socket.destroy();
    await runner.shutdown();
  }
});

test('oversized successful mutations return a durable receipt rather than losing acceptance', async () => {
  const { readFile } = await import('node:fs/promises');
  const dir = join(stateDir(), 'large-result');
  await mkdir(dir, { recursive: true });
  const runner = new Runner(migrate({}), dir);
  const result = { value: 'x'.repeat(1_100_000) };
  await rpcServer(runner, { pretty: false }, async () => result);
  try {
    const receipt = (await rpcCall('cancel', {}, socketPath(dir))) as {
      outcome: string;
      resultPath: string;
    };
    expect(receipt.outcome).toBe('accepted');
    expect(JSON.parse(await readFile(receipt.resultPath, 'utf8'))).toEqual(
      result,
    );
  } finally {
    await runner.shutdown();
  }
});
