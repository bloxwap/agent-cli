import { expect, test } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runner } from '../src/runner/lifecycle.js';
import { rpcServer, rpcCall, socketPath } from '../src/runner/rpc.js';
import { migrate } from '../src/core/config.js';
test('private RPC framing, multi-client serialization and normalized errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-rpc-'));
  const runner = new Runner(migrate({}), dir);
  try {
    await rpcServer(runner, { pretty: false }, async (name, input) => ({
      name,
      input,
    }));
    const path = socketPath(dir);
    if (process.platform !== 'win32')
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(
      await Promise.all([
        rpcCall('status.get', {}, path),
        rpcCall('balance', {}, path),
      ]),
    ).toEqual([
      { name: 'status', input: {} },
      { name: 'balance', input: {} },
    ]);
    await expect(rpcCall('withdraw', {}, path)).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  } finally {
    await runner.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
test('RPC refuses a client targeting another network', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-rpc-network-'));
  const runner = new Runner(migrate({ network: 'testnet' }), dir);
  try {
    await rpcServer(runner, { pretty: false }, async () => ({ ok: true }));
    await expect(
      rpcCall('order', { __context: { network: 'mainnet' } }, socketPath(dir)),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  } finally {
    await runner.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
