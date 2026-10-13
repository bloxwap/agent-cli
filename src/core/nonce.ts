import { mkdir, readFile, open, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { atomicWrite, stateDir } from './config.js';
import { AgentCliError } from '../errors/index.js';
export async function nextNonce(
  signer: string,
  directory = join(stateDir(), 'nonces'),
  now = Date.now,
): Promise<number> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(signer))
    throw new AgentCliError('CONFIG_INVALID', 'Invalid nonce signer');
  const path = join(directory, `${signer.toLowerCase()}.json`);
  const lock = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 100; attempt++) {
    let handle;
    try {
      handle = await open(lock, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
      continue;
    }
    try {
      await handle.writeFile(String(process.pid));
      let previous = 0;
      try {
        previous = JSON.parse(await readFile(path, 'utf8')) as number;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new AgentCliError('CONFIG_INVALID', 'Corrupt nonce state');
      }
      if (!Number.isSafeInteger(previous) || previous < 0)
        throw new AgentCliError('CONFIG_INVALID', 'Invalid nonce state');
      const nonce = Math.max(now(), previous + 1);
      await atomicWrite(path, JSON.stringify(nonce));
      return nonce;
    } finally {
      await handle.close();
      await unlink(lock);
    }
  }
  throw new AgentCliError(
    'NONCE_COLLISION',
    'Nonce lock busy; inspect stale lock before retrying',
  );
}
