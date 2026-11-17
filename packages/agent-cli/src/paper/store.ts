import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWrite } from '../core/files.js';
import { paperDir } from '../core/mode.js';
import { AgentCliError } from '../errors/index.js';
import { withFileLock } from '../core/lock.js';
import { appendOnce, repairTornTail } from '../core/journal.js';
import { requestDigest } from '../core/operations.js';
import { EventStore } from '../runner/events.js';
import {
  paperStateSchema,
  paperTradeSchema,
  paperOrderResultSchema,
} from './schema.js';
import {
  initialPaperState,
  MAX_STATE_TRADES,
  type PaperState,
  type PaperTrade,
} from './simulator.js';
export const PAPER_STATE_VERSION = 1 as const;
export class PaperStore {
  private emit: (type: string, data: unknown) => Promise<void>;
  constructor(
    readonly directory = paperDir(),
    readonly startingBalance = 10_000,
  ) {
    const events = new EventStore(join(directory, 'events.jsonl'), true);
    this.emit = async (type, data) => {
      await events.append(type as Parameters<EventStore['append']>[0], data);
    };
  }
  setEmitter(emit: (type: string, data: unknown) => Promise<void>) {
    this.emit = emit;
  }
  get statePath() {
    return join(this.directory, 'state.json');
  }
  get tradesPath() {
    return join(this.directory, 'trades.jsonl');
  }
  private async read(): Promise<PaperState> {
    try {
      const raw = JSON.parse(await readFile(this.statePath, 'utf8'));
      // A deterministic namespace lets old state migrate consistently across processes.
      if (!raw.sessionId) raw.sessionId = `legacy-${raw.createdAt}`;
      return paperStateSchema.parse(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const state = initialPaperState(this.startingBalance);
        await atomicWrite(this.statePath, JSON.stringify(state));
        return state;
      }
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Invalid paper state; restore a valid backup or explicitly reset',
        { path: this.statePath },
      );
    }
  }
  async load(): Promise<PaperState> {
    return withFileLock(this.statePath + '.lock', async () => {
      const state = await this.read();
      await this.drain(state);
      return state;
    });
  }
  private resultPath(state: PaperState, cloid: string) {
    const key = createHash('sha256')
      .update(`${state.sessionId}:${cloid.toLowerCase()}`)
      .digest('hex');
    return join(this.directory, 'order-results', key + '.json');
  }
  private async drain(state: PaperState) {
    const changed = state.orderResults.length > 0 || state.outbox.length > 0;
    while (state.orderResults.length) {
      const item = state.orderResults[0];
      await atomicWrite(
        this.resultPath(state, item.cloid),
        JSON.stringify(item),
      );
      state.orderResults.shift();
    }
    while (state.outbox.length) {
      const item = state.outbox[0];
      if (item.trade)
        await appendOnce(this.tradesPath, item.eventId, async () => ({
          ...item.trade!,
          sessionId: state.sessionId,
          eventId: item.eventId,
        }));
      await this.emit(item.type, item.data);
      state.outbox.shift();
    }
    if (changed) await atomicWrite(this.statePath, JSON.stringify(state));
  }
  async update<T>(mutate: (state: PaperState) => T | Promise<T>): Promise<T> {
    return withFileLock(this.statePath + '.lock', async () => {
      const state = await this.read();
      await this.drain(state); // fail before another mutation if publication is blocked
      const before = state.nextTid;
      const orders = structuredClone(state.orders);
      const positions = JSON.stringify(state.positions);
      const funding = state.fundingPaid;
      const result = await mutate(state);
      const scope = `paper:${state.sessionId}`;
      for (const trade of state.trades.filter((t) => t.tid >= before)) {
        const eventId = `${scope}:fill:${trade.tid}`;
        state.outbox.push({
          type: 'fill',
          eventId,
          trade,
          data: { ...trade, paper: true, scope, eventId },
        });
      }
      for (const order of state.orders.filter(
        (o) => !orders.some((old) => old.oid === o.oid),
      )) {
        const eventId = `${scope}:order:${randomUUID()}`;
        state.outbox.push({
          type: 'order_update',
          eventId,
          data: { oid: order.oid, status: 'open', scope, eventId, paper: true },
        });
      }
      for (const old of orders) {
        const next = state.orders.find((o) => o.oid === old.oid);
        if (JSON.stringify(next) === JSON.stringify(old)) continue;
        const filled = state.trades.some(
          (t) => t.tid >= before && t.oid === old.oid,
        );
        const eventId = `${scope}:order:${randomUUID()}`;
        state.outbox.push({
          type: 'order_update',
          eventId,
          data: {
            oid: old.oid,
            status: next ? 'modified' : filled ? 'filled' : 'canceled',
            scope,
            eventId,
            paper: true,
          },
        });
      }
      if (
        positions !== JSON.stringify(state.positions) ||
        funding !== state.fundingPaid
      ) {
        const eventId = `${scope}:position:${randomUUID()}`;
        state.outbox.push({
          type: 'position_change',
          eventId,
          data: {
            scope,
            eventId,
            paper: true,
            type: funding !== state.fundingPaid ? 'funding' : 'position',
            positions: state.positions,
            fundingPaid: state.fundingPaid,
          },
        });
      }
      state.trades = state.trades.slice(-MAX_STATE_TRADES);
      paperStateSchema.parse(state);
      // State and its publication obligations commit together.
      await atomicWrite(this.statePath, JSON.stringify(state));
      try {
        await this.drain(state);
      } catch {
        /* already accepted; durable outbox retries on next access */
      }
      return result;
    });
  }
  async readTrades(): Promise<PaperTrade[]> {
    const state = await this.load();
    return withFileLock(this.tradesPath + '.lock', async () => {
      await repairTornTail(this.tradesPath);
      try {
        return (await readFile(this.tradesPath, 'utf8'))
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter(
            (t) =>
              t.sessionId === state.sessionId ||
              (!t.sessionId && state.sessionId.startsWith('legacy-')),
          )
          .map((t) => paperTradeSchema.parse(t));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    });
  }
  async orderResult(cloid: string): Promise<unknown | null> {
    const state = await this.load();
    try {
      return paperOrderResultSchema.parse(
        JSON.parse(await readFile(this.resultPath(state, cloid), 'utf8')),
      ).result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async orderOperation<T>(
    wire: Record<string, unknown>,
    mutate: (state: PaperState) => Promise<T>,
  ): Promise<T> {
    return withFileLock(this.statePath + '.lock', async () => {
      const state = await this.load();
      const cloid =
        typeof wire.c === 'string' ? wire.c.toLowerCase() : undefined;
      const requestHash = requestDigest(wire);
      if (cloid) {
        try {
          const record = paperOrderResultSchema.parse(
            JSON.parse(await readFile(this.resultPath(state, cloid), 'utf8')),
          );
          if (record.requestHash !== requestHash)
            throw new AgentCliError(
              'CONFIG_INVALID',
              'Paper cloid already belongs to a different order',
            );
          return record.result as T;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      return this.update(async (latest) => {
        const result = await mutate(latest);
        if (cloid) latest.orderResults.push({ cloid, requestHash, result });
        return result;
      });
    });
  }
  async reset(startingBalance: number) {
    await withFileLock(this.statePath + '.lock', async () => {
      // Keep journals and their sequence numbers. Session IDs separate the reset account.
      // Explicit reset also permits recovery from invalid state.
      let previous: PaperState | undefined;
      try {
        previous = await this.read();
      } catch (error) {
        if (!(
          error instanceof AgentCliError && error.code === 'CONFIG_INVALID'
        ))
          throw error;
      }
      if (previous) await this.drain(previous);
      await atomicWrite(
        this.statePath,
        JSON.stringify(initialPaperState(startingBalance)),
      );
    });
  }
}
