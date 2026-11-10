import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, stateDir } from '../core/config.js';
import { withFileLock } from '../core/lock.js';
import type { RelayQuote } from './relay.js';
export const depositStates = [
  'awaiting_funds',
  'pending',
  'settled',
  'failed',
  'refunded',
  'expired',
  'abandoned',
] as const;
export type DepositState = (typeof depositStates)[number];
export interface Deposit {
  id: string;
  network: 'mainnet' | 'testnet';
  recipient: string;
  route: string;
  quote: RelayQuote;
  expiresAt: number;
  state: DepositState;
  baseline: string;
  createdAt: number;
  completedSteps: string[];
  ledgerHash?: string;
}
export const depositPath = () => join(stateDir(), 'deposits.json');
export async function readDeposits(path = depositPath()): Promise<Deposit[]> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
export async function writeDeposits(deposits: Deposit[], path = depositPath()) {
  await atomicWrite(path, JSON.stringify(deposits));
}
export async function updateDeposits(
  path = depositPath(),
  mutate: (deposits: Deposit[]) => void | Promise<void>,
) {
  return withFileLock(`${path}.lock`, async () => {
    const deposits = await readDeposits(path);
    const before = JSON.stringify(deposits);
    await mutate(deposits);
    if (JSON.stringify(deposits) !== before)
      await writeDeposits(deposits, path);
    return deposits;
  });
}
