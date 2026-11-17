import { vi, test, expect } from 'vitest';
const interception = vi.hoisted(() => ({
  path: '',
  pending: false,
  read: () => {},
  release: Promise.resolve(),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      const value = await fs.readFile(...args);
      if (String(args[0]) === interception.path && interception.pending) {
        interception.pending = false;
        interception.read();
        await interception.release;
      }
      return value;
    },
  };
});
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stateDir } from '../src/core/config.js';
import { withFileLock } from '../src/core/lock.js';

test('stale recovery cannot overlap a newer contender even if the old read pauses', async () => {
  const path = join(stateDir(), 'recovery.lock');
  await mkdir(stateDir(), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ pid: 1073741824, createdAt: 1, token: 'dead' }),
  );
  let releaseRead!: () => void;
  let sawRead!: () => void;
  interception.path = path;
  interception.pending = true;
  interception.release = new Promise<void>(
    (resolve) => (releaseRead = resolve),
  );
  const read = new Promise<void>((resolve) => (sawRead = resolve));
  interception.read = sawRead;
  let active = 0,
    maximum = 0,
    secondEntered = false;
  const critical = async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active--;
  };
  const first = withFileLock(path, critical);
  await read;
  const second = withFileLock(path, async () => {
    secondEntered = true;
    await critical();
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(secondEntered).toBe(false);
  } finally {
    releaseRead();
    await Promise.all([first, second]);
  }
  expect(maximum).toBe(1);
});

test('simultaneous contenders serialize and an old live holder is never evicted', async () => {
  const path = join(stateDir(), 'contenders.lock');
  let active = 0,
    maximum = 0;
  await Promise.all(
    Array.from({ length: 12 }, () =>
      withFileLock(path, async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 3));
        active--;
      }),
    ),
  );
  expect(maximum).toBe(1);
  await writeFile(
    path,
    JSON.stringify({
      pid: process.pid,
      createdAt: Date.now() - 1_000_000,
      token: 'live',
    }),
  );
  await expect(
    withFileLock(path, async () => {}, { staleMs: 25 }),
  ).rejects.toMatchObject({ code: 'INTERNAL' });
});
