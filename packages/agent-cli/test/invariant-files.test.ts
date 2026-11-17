import { expect, test, vi } from 'vitest';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
const trace = vi.hoisted(() => ({ calls: [] as string[], fail: '' }));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    rename: async (from: string, to: string) => {
      trace.calls.push('rename');
      await fs.rename(from, to);
    },
    open: async (path: string, flags: string, mode?: number) => {
      const handle = await fs.open(path, flags, mode);
      const kind = path.endsWith('.tmp') ? 'file' : 'directory';
      return {
        writeFile: async (data: string) => {
          trace.calls.push('write');
          await handle.writeFile(data);
        },
        sync: async () => {
          trace.calls.push(`sync:${kind}`);
          if (trace.fail === kind) throw new Error('Injected fsync failure');
          await handle.sync();
        },
        close: () => handle.close(),
      };
    },
  };
});
import { atomicWrite } from '../src/core/files.js';
let counter = 0;
async function target() {
  const directory = join(homedir(), `durability-${counter++}`);
  await mkdir(directory);
  return join(directory, 'state.json');
}
test('atomic replacement flushes contents before rename and its directory after rename', async () => {
  const path = await target();
  trace.calls = [];
  trace.fail = '';
  await atomicWrite(path, 'new');
  expect(trace.calls).toEqual(
    process.platform === 'win32'
      ? ['write', 'sync:file', 'rename']
      : ['write', 'sync:file', 'rename', 'sync:directory'],
  );
  expect(await readFile(path, 'utf8')).toBe('new');
  if (process.platform !== 'win32')
    expect((await stat(path)).mode & 0o777).toBe(0o600);
});
test('failure to flush new contents leaves the previous state intact', async () => {
  const path = await target();
  await writeFile(path, 'old');
  trace.calls = [];
  trace.fail = 'file';
  try {
    await expect(atomicWrite(path, 'new')).rejects.toThrow(
      'Injected fsync failure',
    );
  } finally {
    trace.fail = '';
  }
  expect(trace.calls).not.toContain('rename');
  expect(await readFile(path, 'utf8')).toBe('old');
});
test.skipIf(process.platform === 'win32')(
  'directory flush failure reports an uncertain replacement instead of a rejection',
  async () => {
    const path = await target();
    await writeFile(path, 'old');
    trace.calls = [];
    trace.fail = 'directory';
    try {
      await expect(atomicWrite(path, 'new')).rejects.toMatchObject({
        retryable: false,
        details: { outcome: 'unknown' },
      });
    } finally {
      trace.fail = '';
    }
    expect(await readFile(path, 'utf8')).toBe('new');
  },
);
