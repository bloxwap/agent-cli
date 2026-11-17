import { readFile, stat } from 'node:fs/promises';
import { AgentCliError } from '../errors/index.js';

export async function resolveSecret(
  ref: string | undefined,
  env = process.env,
): Promise<string> {
  if (!ref)
    throw new AgentCliError('CONFIG_INVALID', 'Missing secret reference');
  if (ref.startsWith('env:')) {
    const value = env[ref.slice(4)];
    if (value) return value;
  }
  if (ref.startsWith('file:')) {
    const path = ref.slice(5);
    const info = await stat(path);
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Secret file must have mode 0600',
      );
    return (await readFile(path, 'utf8')).trim();
  }
  throw new AgentCliError('CONFIG_INVALID', 'Secret unavailable');
}
