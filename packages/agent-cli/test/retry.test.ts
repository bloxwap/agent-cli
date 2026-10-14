import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retry } from '../src/core/retry.js';
import { nextNonce } from '../src/core/nonce.js';
import { AgentCliError } from '../src/errors/index.js';
test('bounded backoff only retries temporary errors', async () => {
  let attempts = 0;
  const sleeps: number[] = [];
  expect(
    await retry(
      async () => {
        if (++attempts < 3) throw new AgentCliError('RATE_LIMIT', 'wait');
        return 7;
      },
      {
        baseMs: 100,
        random: () => 0.5,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      },
    ),
  ).toBe(7);
  expect(sleeps).toEqual([100, 200]);
  await expect(
    retry(async () => {
      throw new AgentCliError('POLICY_REJECTED', 'stop');
    }),
  ).rejects.toMatchObject({ retryable: false });
});
test('persisted nonces serialize concurrent callers and restarts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-nonce-'));
  const signer = '0x' + 'a'.repeat(40);
  try {
    const values = await Promise.all(
      Array.from({ length: 8 }, () => nextNonce(signer, dir, () => 1000)),
    );
    expect(new Set(values).size).toBe(8);
    expect(await nextNonce(signer, dir, () => 500)).toBe(1008);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
