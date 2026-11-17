import { AgentCliError } from '../errors/index.js';
import { chmod, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function syncDirectory(path: string) {
  // Windows does not expose directory fsync through Node. File contents are
  // still flushed before replacement; POSIX also persists the directory entry.
  if (process.platform === 'win32') return;
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function privateDirectory(path: string) {
  const created = await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
  if (created) {
    for (let directory = path; ; directory = dirname(directory)) {
      await syncDirectory(directory);
      if (directory === dirname(created)) break;
    }
  }
}

export async function atomicWrite(path: string, data: string) {
  await privateDirectory(dirname(path));
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(data);
    await file.sync();
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  } finally {
    await file.close();
  }
  let renamed = false;
  try {
    await rename(temporary, path);
    renamed = true;
    await syncDirectory(dirname(path));
  } catch (error) {
    if (renamed)
      throw new AgentCliError(
        'NETWORK_ERROR',
        'State replacement is visible but durability could not be confirmed',
        { outcome: 'unknown', path },
        false,
      );
    throw error;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
