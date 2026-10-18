import { spawn } from 'node:child_process';

// Capture close immediately: exit can precede trailing stdout, and a signaled
// process has a null exitCode even after it has already stopped.
export function startEventFollower({
  command,
  args,
  env,
  timeoutMs = 5000,
  maxBytes = 4_194_304,
}) {
  const child = spawn(command, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  let bytes = 0;
  let stopping = false;
  let closed = false;
  let failure;
  let stopPromise;
  const close = new Promise((resolve) => {
    child.on('error', () => {
      failure = 'Event follower could not start';
    });
    child.once('exit', (code, signal) => {
      if (!stopping || (code !== 0 && signal !== 'SIGTERM'))
        failure ??= 'Event follower terminated unexpectedly';
    });
    child.once('close', () => {
      closed = true;
      resolve();
    });
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > maxBytes) {
      failure = 'Event follower exceeded its output limit';
      child.kill('SIGKILL');
      return;
    }
    text += chunk;
  });
  // Arbitrary process errors may include credentials. Never export stderr.
  child.stderr.resume();
  async function finish() {
    stopping = true;
    if (
      child.pid &&
      !closed &&
      child.exitCode === null &&
      child.signalCode === null
    )
      child.kill('SIGTERM');
    let timer;
    const timedOut = await Promise.race([
      close.then(() => false),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(true), timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    if (timedOut) {
      failure ??= 'Event follower did not stop within its time limit';
      if (child.pid) child.kill('SIGKILL');
      let killTimer;
      await Promise.race([
        close,
        new Promise((resolve) => {
          killTimer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      clearTimeout(killTimer);
    }
    if (failure) throw new Error(failure);
    try {
      return text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch {
      throw new Error('Event follower returned malformed JSON');
    }
  }
  return {
    get text() {
      return text;
    },
    stop() {
      return (stopPromise ??= finish());
    },
  };
}
