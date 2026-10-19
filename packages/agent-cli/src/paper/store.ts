import { open, readFile, appendFile, mkdir, chmod, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from '../core/config.js';
import { paperDir } from '../core/mode.js';
import { AgentCliError } from '../errors/index.js';
import {
  initialPaperState,
  type PaperState,
  type PaperTrade,
} from './simulator.js';
export const PAPER_STATE_VERSION = 1 as const;
// Locked read-modify-write persistence so short-lived CLI invocations and the
// paper runner can safely share ~/.bloxwap/paper state.
export class PaperStore {
  private queue = Promise.resolve();
  constructor(readonly directory = paperDir()) {}
  get statePath() {
    return join(this.directory, 'state.json');
  }
  get tradesPath() {
    return join(this.directory, 'trades.jsonl');
  }
  async load(): Promise<PaperState> {
    try {
      const raw = JSON.parse(await readFile(this.statePath, 'utf8')) as PaperState;
      if (raw?.version !== PAPER_STATE_VERSION)
        throw new AgentCliError('CONFIG_INVALID', 'Unknown paper state version');
      return raw;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return initialPaperState(10_000);
      throw error;
    }
  }
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await chmod(this.directory, 0o700);
      let handle;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          handle = await open(this.statePath + '.lock', 'wx', 0o600);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      if (!handle)
        throw new AgentCliError('INTERNAL', 'Paper state lock busy; inspect stale lock');
      try {
        return await operation();
      } finally {
        await handle.close();
        await unlink(this.statePath + '.lock').catch(() => {});
      }
    });
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }
  // Read the latest state, mutate it, persist, and archive newly created trades.
  async update<T>(mutate: (state: PaperState) => T | Promise<T>): Promise<T> {
    return this.locked(async () => {
      const state = await this.load();
      const before = state.trades.length;
      const result = await mutate(state);
      await atomicWrite(this.statePath, JSON.stringify(state));
      const created = state.trades.length - before;
      if (created > 0)
        await appendFile(
          this.tradesPath,
          state.trades
            .slice(state.trades.length - created)
            .map((trade) => JSON.stringify(trade) + '\n')
            .join(''),
          { mode: 0o600 },
        );
      return result;
    });
  }
  async readTrades(): Promise<PaperTrade[]> {
    try {
      return (await readFile(this.tradesPath, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PaperTrade);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  async reset(startingBalance: number) {
    await this.locked(async () => {
      const state = initialPaperState(startingBalance);
      await atomicWrite(this.statePath, JSON.stringify(state));
      await atomicWrite(this.tradesPath, '');
    });
  }
}
