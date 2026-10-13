import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, stateDir } from '../core/config.js';
import type { RelayQuote } from './relay.js';
export interface Deposit {
  id: string;
  network: 'mainnet' | 'testnet';
  recipient: string;
  route: string;
  quote: RelayQuote;
  expiresAt: number;
  state: 'awaiting_funds' | 'pending' | 'settled' | 'failed' | 'refunded';
  baseline: string;
  createdAt: number;
  completedSteps: string[];
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
