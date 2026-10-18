import { createServer } from 'node:net';
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, vi } from 'vitest';
import { stopTestnetRunner } from '../scripts/testnet-runner.mjs';

const fakePid = process.pid + 100_000;
const runner = () => ({ pid: fakePid, network: 'testnet', startedAt: 1 });
async function fixture(action) {
  const directory = await mkdtemp(join(tmpdir(), 'bloxwap-runner-stop-'));
  const clients = new Set();
  let server;
  const pidPath = join(directory, 'runner.pid');
  const socketPath = join(directory, 'run.sock');
  async function listen(handler) {
    server = createServer((socket) => {
      clients.add(socket);
      socket.once('close', () => clients.delete(socket));
      socket.on('error', () => {});
      socket.setEncoding('utf8');
      let text = '';
      socket.on('data', (chunk) => {
        text += chunk;
        if (text.includes('\n'))
          handler(socket, JSON.parse(text.split('\n')[0]));
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    return server;
  }
  try {
    await action({ directory, pidPath, socketPath, listen });
  } finally {
    for (const client of clients) client.destroy();
    if (server) await new Promise((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}

test('no runner PID or socket returns without inspecting an unknown process', async () => {
  await fixture(async ({ directory }) => {
    const isAlive = vi.fn();
    await expect(
      stopTestnetRunner({ directory, timeoutMs: 100, isAlive }),
    ).resolves.toBeUndefined();
    expect(isAlive).not.toHaveBeenCalled();
  });
});

test('normal RPC shutdown verifies both state paths and original process disappearance', async () => {
  await fixture(async ({ directory, pidPath, listen }) => {
    await writeFile(pidPath, JSON.stringify(runner()));
    let live = true;
    let shutdown;
    const server = await listen((socket, request) => {
      shutdown = request;
      socket.end(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { stopping: true } }) +
          '\n',
      );
      void unlink(pidPath).then(() => {
        live = false;
        server.close();
      });
    });
    const isAlive = vi.fn(() => live);
    await expect(
      stopTestnetRunner({ directory, timeoutMs: 1000, isAlive }),
    ).resolves.toBeUndefined();
    expect(shutdown).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'shutdown',
      params: {},
    });
    expect(isAlive.mock.calls.every(([pid]) => pid === fakePid)).toBe(true);
    await expect(readFile(pidPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

test('an expected PID that remains live cannot pass when both metadata paths are already gone', async () => {
  await fixture(async ({ directory }) => {
    const isAlive = vi.fn(() => true);
    await expect(
      stopTestnetRunner({
        directory,
        expectedPid: fakePid,
        timeoutMs: 100,
        isAlive,
      }),
    ).rejects.toThrow('time limit');
    expect(isAlive.mock.calls.every(([pid]) => pid === fakePid)).toBe(true);
  });
});

test('an expected PID that is dead passes when both metadata paths are gone', async () => {
  await fixture(async ({ directory }) => {
    const isAlive = vi.fn(() => false);
    await expect(
      stopTestnetRunner({
        directory,
        expectedPid: fakePid,
        timeoutMs: 100,
        isAlive,
      }),
    ).resolves.toBeUndefined();
    expect(isAlive).toHaveBeenCalledWith(fakePid);
  });
});

test('PID metadata that differs from the expected PID is rejected before probing either process', async () => {
  await fixture(async ({ directory, pidPath }) => {
    await writeFile(pidPath, JSON.stringify({ ...runner(), pid: fakePid + 1 }));
    const isAlive = vi.fn();
    await expect(
      stopTestnetRunner({ directory, expectedPid: fakePid, isAlive }),
    ).rejects.toThrow('does not match the expected process');
    expect(isAlive).not.toHaveBeenCalled();
  });
});

test.each([0, -1, 1.5, null, '123', process.pid])(
  'an invalid expected PID never reaches a process probe (%s)',
  async (expectedPid) => {
    await fixture(async ({ directory }) => {
      const isAlive = vi.fn();
      await expect(
        stopTestnetRunner({ directory, expectedPid, isAlive }),
      ).rejects.toThrow('Expected runner PID');
      expect(isAlive).not.toHaveBeenCalled();
    });
  },
);

test('a dead original PID with a stale file fails without deleting that file', async () => {
  await fixture(async ({ directory, pidPath }) => {
    const data = JSON.stringify(runner());
    await writeFile(pidPath, data);
    await expect(
      stopTestnetRunner({ directory, timeoutMs: 100, isAlive: () => false }),
    ).rejects.toThrow('Stale runner state');
    expect(await readFile(pidPath, 'utf8')).toBe(data);
  });
});

test('a socket without PID metadata is never sent a shutdown request', async () => {
  await fixture(async ({ directory, listen }) => {
    const request = vi.fn();
    await listen(request);
    const isAlive = vi.fn();
    await expect(
      stopTestnetRunner({ directory, timeoutMs: 100, isAlive }),
    ).rejects.toThrow('no trusted PID');
    expect(request).not.toHaveBeenCalled();
    expect(isAlive).not.toHaveBeenCalled();
  });
});

test('an unresponsive runner is bounded and does not remove state or force-kill', async () => {
  await fixture(async ({ directory, pidPath, listen }) => {
    await writeFile(pidPath, JSON.stringify(runner()));
    const request = vi.fn();
    await listen(request);
    const start = performance.now();
    await expect(
      stopTestnetRunner({ directory, timeoutMs: 100, isAlive: () => true }),
    ).rejects.toThrow('time limit');
    expect(performance.now() - start).toBeLessThan(1000);
    expect(request).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(pidPath, 'utf8'))).toEqual(runner());
  });
});

test('RPC acknowledgement and removed paths cannot hide a still-live original PID', async () => {
  await fixture(async ({ directory, pidPath, listen }) => {
    await writeFile(pidPath, JSON.stringify(runner()));
    const server = await listen((socket) => {
      socket.end('{"jsonrpc":"2.0","id":1,"result":{"stopping":true}}\n');
      void unlink(pidPath).then(() => server.close());
    });
    await expect(
      stopTestnetRunner({ directory, timeoutMs: 100, isAlive: () => true }),
    ).rejects.toThrow('time limit');
  });
});

test('a changed tracked PID stops verification without probing the replacement process', async () => {
  await fixture(async ({ directory, pidPath, listen }) => {
    await writeFile(pidPath, JSON.stringify(runner()));
    const changed = { ...runner(), pid: fakePid + 1 };
    await listen((socket) => {
      void writeFile(pidPath, JSON.stringify(changed)).then(() =>
        socket.end('{}\n'),
      );
    });
    const isAlive = vi.fn(() => true);
    await expect(
      stopTestnetRunner({ directory, timeoutMs: 1000, isAlive }),
    ).rejects.toThrow('changed during shutdown');
    expect(isAlive.mock.calls.every(([pid]) => pid === fakePid)).toBe(true);
  });
});

test.each([
  'not JSON',
  'null',
  '[]',
  '{}',
  JSON.stringify({ ...runner(), pid: 0 }),
  JSON.stringify({ ...runner(), pid: -1 }),
  JSON.stringify({ ...runner(), pid: String(fakePid) }),
  JSON.stringify({ ...runner(), pid: 1.5 }),
  JSON.stringify({ ...runner(), pid: process.pid }),
  JSON.stringify({ ...runner(), network: 'mainnet' }),
  JSON.stringify({ ...runner(), startedAt: null }),
])(
  'malformed or untrusted PID metadata is rejected before probing a process (%#)',
  async (metadata) => {
    await fixture(async ({ directory, pidPath }) => {
      await writeFile(pidPath, metadata);
      const isAlive = vi.fn();
      await expect(
        stopTestnetRunner({ directory, timeoutMs: 100, isAlive }),
      ).rejects.toThrow('Runner PID metadata');
      expect(isAlive).not.toHaveBeenCalled();
    });
  },
);

test('PID symlinks and regular files at the socket path are rejected', async () => {
  await fixture(async ({ directory, pidPath, socketPath }) => {
    const target = join(directory, 'metadata.json');
    await writeFile(target, JSON.stringify(runner()));
    await symlink(target, pidPath);
    await expect(
      stopTestnetRunner({ directory, isAlive: () => true }),
    ).rejects.toThrow('regular bounded file');
    await unlink(pidPath);
    await writeFile(pidPath, JSON.stringify(runner()));
    await writeFile(socketPath, 'not a socket');
    await expect(
      stopTestnetRunner({ directory, isAlive: () => true }),
    ).rejects.toThrow('not a Unix socket');
  });
});

test('unreadable or unknown process liveness never counts as a stopped runner', async () => {
  await fixture(async ({ directory, pidPath }) => {
    await writeFile(pidPath, JSON.stringify(runner()));
    await expect(
      stopTestnetRunner({
        directory,
        isAlive: () => {
          throw new Error('sentinel-secret');
        },
      }),
    ).rejects.toThrow('could not be inspected');
    await expect(
      stopTestnetRunner({ directory, isAlive: () => undefined }),
    ).rejects.toThrow('liveness is unproven');
  });
});

test.each([0, -1, Infinity, NaN, 1.5, 60_001])(
  'invalid shutdown timeout fails immediately (%s)',
  async (timeoutMs) => {
    await fixture(async ({ directory }) => {
      await expect(stopTestnetRunner({ directory, timeoutMs })).rejects.toThrow(
        'bounded positive timeout',
      );
    });
  },
);
