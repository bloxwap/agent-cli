import { join } from 'node:path';
import { loadConfig, stateDir } from './config.js';
import type { Context } from './router.js';
export type Mode = 'live' | 'paper';
export const paperDir = () => join(stateDir(), 'paper');
// Paper trading always runs against real mainnet Hyperliquid public market data.
export const paperDataNetwork = 'mainnet' as const;
export async function resolveMode(
  context: Pick<Context, 'configPath' | 'paper'>,
  command?: string,
): Promise<Mode> {
  if (context.paper || command === 'paper') return 'paper';
  try {
    return (await loadConfig(context.configPath)).mode;
  } catch {
    return 'live';
  }
}
export function modeFields(mode: Mode) {
  return { mode, paper: mode === 'paper' };
}
