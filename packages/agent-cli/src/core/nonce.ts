import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, stateDir } from './config.js';
import { withFileLock } from './lock.js';
import { AgentCliError } from '../errors/index.js';
export async function nextNonce(
  signer: string,
  directory = join(stateDir(), 'nonces'),
  now = Date.now,
): Promise<number> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(signer))
    throw new AgentCliError('CONFIG_INVALID', 'Invalid nonce signer');
  const path = join(directory, `${signer.toLowerCase()}.json`);
  return withFileLock(`${path}.lock`, async () => {
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
  });
}
