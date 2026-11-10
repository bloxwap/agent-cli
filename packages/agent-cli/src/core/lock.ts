import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { writeFile, link, readFile, unlink, rename, mkdir, chmod, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { AgentCliError } from '../errors/index.js';

const heldLocks = new AsyncLocalStorage<Set<string>>();

// A confirmed live holder is never evicted. Dead PIDs and reused PIDs are
// taken over immediately. A holder we cannot see (or a corrupt lock) is
// abandoned only after this age, which is longer than an exchange timeout.
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
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'dead' : 'unknown';
  }
}

// Linux start time, used to detect a PID that was recycled after the lock was written.
export function processStartMs(pid: number): number | null {
  try {
    const statText = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = statText.slice(statText.lastIndexOf(')') + 2).split(' ');
    const startTicks = Number(rest[19]);
    if (!Number.isFinite(startTicks)) return null;
    const btime = Number(
      readFileSync('/proc/stat', 'utf8').match(/^btime (\d+)/m)?.[1],
    );
    if (!Number.isFinite(btime)) return null;
    return (btime + startTicks / 100) * 1000;
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
    const [raw, info] = await Promise.all([
      readFile(path, 'utf8'),
      stat(path),
    ]);
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
  return now - record.createdAt > staleMs ? 'dead' : 'unknown';
}

async function takeover(lockPath: string) {
  const moved = `${lockPath}.takeover-${randomUUID()}`;
  try {
    await rename(lockPath, moved);
  } catch {
    return false;
  }
  await unlink(moved).catch(() => {});
  return true;
}

export async function withFileLock<T>(
  lockPath: string,
  operation: () => Promise<T>,
  options: { staleMs?: number } = {},
): Promise<T> {
  const held = heldLocks.getStore();
  if (held?.has(lockPath)) return operation();
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(lockPath), 0o700).catch(() => {});
  const deadline = Date.now() + staleMs;
  for (;;) {
    const token = randomUUID();
    const record: LockRecord = {
      pid: process.pid,
      createdAt: Date.now(),
      token,
    };
    // Publish the lock by linking a complete file into place. An exclusive
    // create followed by a write lets another waiter observe an empty file
    // and steal the lock before the record is stored.
    const temporary = `${lockPath}.${token}.tmp`;
    let acquired = false;
    try {
      await writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
      try {
        await link(temporary, lockPath);
        acquired = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    } finally {
      await unlink(temporary).catch(() => {});
    }
    if (acquired) {
      try {
        const next = new Set(held);
        next.add(lockPath);
        return await heldLocks.run(next, operation);
      } finally {
        try {
          const current = await readLock(lockPath);
          if (current?.token === token) await unlink(lockPath);
        } catch {
          // The lock file is already gone.
        }
      }
    }
    const current = await readLock(lockPath);
    const now = Date.now();
    let info: { mtimeMs: number } | null = null;
    if (!current) {
      try {
        info = await stat(lockPath);
      } catch {
        info = null;
      }
    }
    // A missing file is not a stale lock: the holder may have released it and
    // another waiter may already have published a new one. Stealing here races
    // with that new holder. Only an existing, unreadable, aged file is corrupt.
    if (!current) {
      if (info && now - info.mtimeMs > 1_000) await takeover(lockPath);
      else if (info) await new Promise((resolve) => setTimeout(resolve, 20));
      continue;
    }
    const state = holderState(current, now, staleMs);
    if (state === 'dead' || state === 'reused') {
      await takeover(lockPath);
      continue;
    }
    if (now >= deadline)
      throw new AgentCliError(
        'INTERNAL',
        'Lock is held by a live process',
        { lock: lockPath, pid: current?.pid ?? null },
        false,
      );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
