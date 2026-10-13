import { expect, test } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Runner, runningInfo } from '../src/runner/lifecycle.js';
import { migrate } from '../src/core/config.js';
test('single instance and graceful cleanup preserve external state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-runner-'));
  const signer = {
    address: ('0x' + 'a'.repeat(40)) as `0x${string}`,
    signTypedData: async () => '0x123' as `0x${string}`,
  };
  const first = new Runner(migrate({}), dir);
  const second = new Runner(migrate({}), dir);
  try {
    expect((await first.start(async () => signer)).existing).toBe(false);
    expect((await second.start(async () => signer)).existing).toBe(true);
    expect(await runningInfo(join(dir, 'runner.pid'))).toMatchObject({
      pid: process.pid,
    });
    await first.shutdown();
    expect(await runningInfo(join(dir, 'runner.pid'))).toBeNull();
    expect(await readFile(join(dir, 'logs', 'runner.jsonl'), 'utf8')).toContain(
      'Runner stopped',
    );
  } finally {
    await first.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
test('a dead PID restarts and readiness is explicit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-runner-restart-'));
  const runner = new Runner(migrate({}), dir);
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(dir, 'runner.pid'),
      JSON.stringify({
        pid: 2147483647,
        network: 'testnet',
        startedAt: 0,
        ready: true,
      }),
    );
    await runner.start(async () => ({
      address: ('0x' + 'a'.repeat(40)) as `0x${string}`,
      signTypedData: async () => '0x1',
    }));
    expect((await runningInfo(join(dir, 'runner.pid')))?.ready).toBe(false);
    await runner.markReady();
    expect((await runningInfo(join(dir, 'runner.pid')))?.ready).toBe(true);
  } finally {
    await runner.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});
