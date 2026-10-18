import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createConnection } from 'node:net';
import { performance } from 'node:perf_hooks';

async function inspect(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error('Runner state could not be inspected');
  }
}
async function readRunner(path) {
  const stat = await inspect(path);
  if (!stat) return undefined;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384)
    throw new Error('Runner PID metadata must be a regular bounded file');
  let runner;
  try {
    runner = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    // A genuine shutdown can unlink the file between lstat and readFile.
    if (error.code === 'ENOENT') return undefined;
    throw new Error('Runner PID metadata could not be read');
  }
  if (
    !runner ||
    typeof runner !== 'object' ||
    Array.isArray(runner) ||
    !Number.isSafeInteger(runner.pid) ||
    runner.pid <= 0 ||
    runner.pid === process.pid ||
    runner.network !== 'testnet' ||
    !Number.isSafeInteger(runner.startedAt) ||
    runner.startedAt <= 0
  )
    throw new Error(
      'Runner PID metadata does not identify a separate testnet process',
    );
  return {
    pid: runner.pid,
    network: runner.network,
    startedAt: runner.startedAt,
  };
}
async function inspectSocket(path) {
  const stat = await inspect(path);
  if (stat && (!stat.isSocket() || stat.isSymbolicLink()))
    throw new Error('Runner socket path is not a Unix socket');
  return Boolean(stat);
}
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw new Error('Original runner process could not be inspected');
  }
}
function requestShutdown(path, timeoutMs) {
  return new Promise((resolve) => {
    let socket;
    let timer;
    let settled = false;
    let buffer = '';
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve();
    }
    // RPC delivery/acknowledgement alone is never proof of shutdown. Even a
    // connection failure is followed by independent file and process checks.
    try {
      socket = createConnection(path);
      timer = setTimeout(finish, Math.max(1, timeoutMs));
      socket.once('connect', () => {
        socket.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'shutdown',
            params: {},
          }) + '\n',
        );
      });
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 16_384 || buffer.includes('\n'))
          finish();
      });
      socket.once('error', finish);
      socket.once('close', finish);
    } catch {
      finish();
    }
  });
}

export async function stopTestnetRunner({
  directory,
  timeoutMs = 5000,
  expectedPid,
  isAlive = processIsAlive,
}) {
  if (typeof directory !== 'string' || !isAbsolute(directory))
    throw new Error('Runner state directory must be an absolute path');
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60_000 ||
    typeof isAlive !== 'function'
  )
    throw new Error(
      'Runner shutdown needs a bounded positive timeout and process probe',
    );
  if (
    expectedPid !== undefined &&
    (!Number.isSafeInteger(expectedPid) ||
      expectedPid <= 0 ||
      expectedPid === process.pid)
  )
    throw new Error(
      'Expected runner PID must identify a separate positive integer process',
    );
  const deadline = performance.now() + timeoutMs;
  const pidPath = join(directory, 'runner.pid');
  const socketPath = join(directory, 'run.sock');
  const original = await readRunner(pidPath);
  const socketExists = await inspectSocket(socketPath);
  if (original && expectedPid !== undefined && original.pid !== expectedPid)
    throw new Error('Runner PID metadata does not match the expected process');
  const trackedPid = expectedPid ?? original?.pid;
  if (trackedPid === undefined) {
    if (!socketExists) return;
    throw new Error('Runner socket has no trusted PID metadata');
  }
  async function alive() {
    let result;
    try {
      result = await isAlive(trackedPid);
    } catch {
      throw new Error('Original runner process could not be inspected');
    }
    if (typeof result !== 'boolean')
      throw new Error('Original runner process liveness is unproven');
    return result;
  }
  const initiallyAlive = await alive();
  if (socketExists && initiallyAlive)
    await requestShutdown(
      socketPath,
      Math.max(1, deadline - performance.now()),
    );
  for (;;) {
    const current = await readRunner(pidPath);
    const socketRemains = await inspectSocket(socketPath);
    if (
      current &&
      (current.pid !== trackedPid ||
        (original && current.startedAt !== original.startedAt))
    )
      throw new Error('Tracked runner changed during shutdown');
    const stillAlive = await alive();
    if (!current && !socketRemains && !stillAlive) return;
    if (!initiallyAlive)
      throw new Error(
        'Stale runner state remains after the original process stopped',
      );
    const remaining = deadline - performance.now();
    if (remaining <= 0)
      throw new Error(
        'Runner shutdown could not be verified within its time limit',
      );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(25, remaining)),
    );
  }
}
