import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  writeFile,
  link,
  readFile,
  unlink,
  rename,
  mkdir,
  chmod,
  stat,
  readdir,
} from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { AgentCliError } from '../errors/index.js';

const heldLocks = new AsyncLocalStorage<Set<string>>();

// A live or unverified holder is never evicted. This is the acquisition
// timeout; elapsed time alone is never evidence that a holder is dead.
export const LOCK_STALE_MS = 120_000;

export interface LockRecord {
  pid: number;
  createdAt: number;
  token: string;
}

export function pidLiveness(pid: number): 'alive' | 'dead' | 'unknown' {
  if (!Number.isInteger(pid) || pid <= 0) return 'dead';
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
      ? 'dead'
      : 'unknown';
  }
}

const clockTicks = (() => {
  if (process.platform !== 'linux') return null;
  try {
    const value = Number(
      execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 1000 }),
    );
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
})();
// Linux start time, used to detect a PID that was recycled after the lock was written.
export function processStartMs(pid: number): number | null {
  try {
    if (!clockTicks) return null;
    const statText = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = statText.slice(statText.lastIndexOf(')') + 2).split(' ');
    const startTicks = Number(rest[19]);
    if (!Number.isFinite(startTicks)) return null;
    const btime = Number(
      readFileSync('/proc/stat', 'utf8').match(/^btime (\d+)/m)?.[1],
    );
    if (!Number.isFinite(btime)) return null;
    return (btime + startTicks / clockTicks) * 1000;
  } catch {
    return null;
  }
}

export function parseLock(raw: string, mtimeMs: number): LockRecord | null {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as Partial<LockRecord>;
    if (parsed && Number.isInteger(parsed.pid) && (parsed.pid ?? 0) > 0)
      return {
        pid: parsed.pid as number,
        createdAt:
          typeof parsed.createdAt === 'number' ? parsed.createdAt : mtimeMs,
        token: typeof parsed.token === 'string' ? parsed.token : '',
      };
  } catch {
    // Legacy locks stored only the PID.
  }
  if (/^\d+$/.test(trimmed))
    return { pid: Number(trimmed), createdAt: mtimeMs, token: '' };
  return null;
}

export async function readLock(path: string): Promise<LockRecord | null> {
  try {
    const [raw, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return parseLock(raw, info.mtimeMs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

export type HolderState = 'live' | 'dead' | 'reused' | 'unknown';

export function holderState(
  record: LockRecord,
  now = Date.now(),
  staleMs = LOCK_STALE_MS,
): HolderState {
  const life = pidLiveness(record.pid);
  if (life === 'dead') return 'dead';
  if (life === 'alive') {
    const started = processStartMs(record.pid);
    if (started != null && started > record.createdAt + 5_000) return 'reused';
    return 'live';
  }
  void now;
  void staleMs;
  return 'unknown';
}

interface Claim extends LockRecord {
  ticket: number | null;
}

// Each contender owns an immutable filename. Bakery tickets serialize all
// mutations of the legacy lock path, including dead-holder recovery. Removing
// a dead contender can never remove a newer contender's file (names never reuse).
// Unknown/corrupt holders fail closed; elapsed time is not proof of death.
async function claims(directory: string): Promise<Claim[]> {
  const result: Claim[] = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    const path = join(directory, name);
    let claim: Claim;
    try {
      claim = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new AgentCliError(
        'INTERNAL',
        'Unreadable lock contender',
        { path },
        false,
      );
    }
    if (
      !claim ||
      !Number.isSafeInteger(claim.pid) ||
      claim.pid <= 0 ||
      !Number.isFinite(claim.createdAt) ||
      `${claim.token}.json` !== name ||
      (claim.ticket !== null &&
        (!Number.isSafeInteger(claim.ticket) || claim.ticket < 1))
    )
      throw new AgentCliError(
        'INTERNAL',
        'Invalid lock contender',
        { path },
        false,
      );
    const state = holderState(claim);
    if (state === 'dead' || state === 'reused') {
      await unlink(path).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
    } else result.push(claim);
  }
  return result;
}
async function publishClaim(path: string, claim: Claim) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(claim), {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

export interface FileLease {
  token: string;
  release: () => Promise<void>;
}
export async function acquireFileLock(
  inputPath: string,
  options: { staleMs?: number } = {},
): Promise<FileLease> {
  const lockPath = resolve(inputPath);
  const directory = `${lockPath}.claims`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await chmod(dirname(lockPath), 0o700);
  const deadline = Date.now() + (options.staleMs ?? LOCK_STALE_MS);
  const claim: Claim = {
    pid: process.pid,
    createdAt: Date.now(),
    token: randomUUID(),
    ticket: null,
  };
  const path = join(directory, `${claim.token}.json`);
  const expired = () => {
    if (Date.now() >= deadline)
      throw new AgentCliError(
        'INTERNAL',
        'Lock is held by a live or unverified process',
        { lock: lockPath },
        false,
      );
  };
  await publishClaim(path, claim);
  let ownsLegacy = false;
  try {
    const maximum = Math.max(
      0,
      ...(await claims(directory)).map((item) => item.ticket ?? 0),
    );
    if (!Number.isSafeInteger(maximum + 1))
      throw new AgentCliError('INTERNAL', 'Lock ticket exhausted');
    claim.ticket = maximum + 1;
    await publishClaim(path, claim);
    for (;;) {
      const others = (await claims(directory)).filter(
        (item) => item.token !== claim.token,
      );
      if (
        !others.some(
          (item) =>
            item.ticket === null ||
            item.ticket < claim.ticket! ||
            (item.ticket === claim.ticket && item.token < claim.token),
        )
      )
        break;
      expired();
      await pause();
    }
    // Keep the familiar lock record for diagnostics and old on-disk state.
    // Only the elected contender may inspect/remove/create it.
    for (;;) {
      const temporary = `${lockPath}.${claim.token}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(claim), {
          flag: 'wx',
          mode: 0o600,
        });
        try {
          await link(temporary, lockPath);
          ownsLegacy = true;
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      } finally {
        await unlink(temporary).catch(() => {});
      }
      const current = await readLock(lockPath);
      if (current && ['dead', 'reused'].includes(holderState(current))) {
        await unlink(lockPath);
        continue;
      }
      // A missing path can be a release; an unreadable existing path is never stolen.
      try {
        await stat(lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      expired();
      await pause();
    }
    let released = false;
    return {
      token: claim.token,
      release: async () => {
        if (released) return;
        released = true;
        try {
          if ((await readLock(lockPath))?.token === claim.token)
            await unlink(lockPath);
        } finally {
          await unlink(path).catch(() => {});
        }
      },
    };
  } catch (error) {
    if (ownsLegacy && (await readLock(lockPath))?.token === claim.token)
      await unlink(lockPath);
    await unlink(path).catch(() => {});
    throw error;
  }
}
export async function withFileLock<T>(
  inputPath: string,
  operation: () => Promise<T>,
  options: { staleMs?: number } = {},
): Promise<T> {
  const lockPath = resolve(inputPath);
  const held = heldLocks.getStore();
  if (held?.has(lockPath)) return operation();
  const lease = await acquireFileLock(lockPath, options);
  try {
    return await heldLocks.run(new Set([...(held ?? []), lockPath]), operation);
  } finally {
    await lease.release();
  }
}
