import { SubscriptionClient, WebSocketTransport } from '@bloxwap/hyperliquid';
import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { withFileLock } from '../core/lock.js';
import { AgentCliError } from '../errors/index.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, type Config } from '../core/config.js';
import { hlInfo } from '../core/http.js';
import { normalizeError } from '../errors/index.js';
import type { Runner } from './lifecycle.js';
import { readEvents } from './events.js';
interface Fill {
  tid: number;
  time: number;
  [key: string]: unknown;
}
interface Backend {
  subscribe: (
    type: string,
    params: Record<string, unknown>,
    listener: (data: unknown) => void,
  ) => Promise<{ unsubscribe: () => Promise<void> }>;
  onState: (listener: (state: string) => void) => void;
  close: () => Promise<void>;
  gap: (startTime?: number) => Promise<Fill[]>;
}
export function subscriptionSet(config: Config) {
  return [
    'userEvents',
    'userFills',
    'orderUpdates',
    'clearinghouseState',
    ...(config.allowedMarkets.length
      ? ['allMids', ...config.allowedMarkets.map((coin) => `l2Book:${coin}`)]
      : []),
  ];
}
export class Subscriptions {
  state = 'connecting';
  lastMessage = Date.now();
  lastFill: number | null = null;
  private seen = new Set<number>();
  private queue = Promise.resolve();
  private stopped = false;
  private stopping?: Promise<void>;
  private get scope() {
    return `${this.runner.config.network}:${this.runner.config.masterAddress?.toLowerCase() ?? 'uninitialized'}`;
  }
  private get cursorPath() {
    return join(
      this.runner.directory,
      `subscriptions-${createHash('sha256').update(this.scope).digest('hex')}.json`,
    );
  }
  private subscriptions: { unsubscribe: () => Promise<void> }[] = [];
  constructor(
    private runner: Runner,
    private backend: Backend,
    private emit: (type: string, data: unknown) => Promise<void>,
  ) {}
  async start() {
    this.runner.onShutdown(() => this.stop());
    try {
      const path = this.cursorPath;
      try {
        const saved = z
          .object({
            scope: z.literal(this.scope),
            seen: z.array(z.number().int().nonnegative()).max(10000),
            lastFill: z.number().int().nonnegative().nullable(),
          })
          .parse(JSON.parse(await readFile(path, 'utf8')));
        this.seen = new Set(saved.seen);
        this.lastFill = saved.lastFill;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      for (const tid of await this.journalTids()) this.seen.add(tid);
      for (const fill of await this.backend.gap(this.lastFill ?? undefined))
        await this.fill(fill);
      this.backend.onState((state) => {
        if (this.stopped) return;
        const reconnect = this.state !== 'connecting' && state === 'connected';
        this.state = state;
        this.lastMessage = Date.now();
        if (reconnect)
          this.enqueue(async () => {
            for (const fill of await this.backend.gap(
              this.lastFill ?? Date.now() - 60_000,
            ))
              await this.fill(fill);
            await this.emit('runner_state', { wsState: state });
          });
      });
      for (const name of subscriptionSet(this.runner.config)) {
        const [type, coin] = name.split(':');
        const params = coin
          ? { coin }
          : type === 'allMids'
            ? {}
            : { user: this.runner.config.masterAddress };
        this.subscriptions.push(
          await this.backend.subscribe(type, params, (data) => {
            if (this.stopped) return;
            this.lastMessage = Date.now();
            this.enqueue(async () => {
              if (type === 'userFills') {
                for (const fill of (data as { fills: Fill[] }).fills)
                  await this.fill(fill);
              } else if (type === 'userEvents' && 'fills' in (data as object)) {
                for (const fill of (data as { fills: Fill[] }).fills)
                  await this.fill(fill);
              } else if (type === 'orderUpdates')
                await this.emit('order_update', data);
              else if (type === 'clearinghouseState')
                await this.emit('position_change', data);
            });
          }),
        );
      }
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  private stop() {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    return (this.stopping = (async () => {
      await this.queue.catch(() => {});
      await Promise.allSettled(this.subscriptions.map((s) => s.unsubscribe()));
      this.subscriptions = [];
      await this.backend.close();
    })());
  }
  private enqueue(operation: () => Promise<void>) {
    this.queue = this.queue.then(operation).catch(async (error) => {
      await this.emit('error', normalizeError(error).toJSON());
    });
  }
  private async journalTids() {
    try {
      return (await readEvents(join(this.runner.directory, 'events.jsonl')))
        .filter((event) => event.type === 'fill' && event.scope === this.scope)
        .map((event) => (event.data as { tid?: unknown }).tid)
        .filter((tid): tid is number => typeof tid === 'number');
    } catch (error) {
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Cannot recover subscription journal',
        { cause: String(error) },
      );
    }
  }
  private async persist() {
    await atomicWrite(
      this.cursorPath,
      JSON.stringify({
        scope: this.scope,
        seen: [...this.seen].slice(-10000),
        lastFill: this.lastFill,
      }),
    );
  }
  async fill(fill: Fill) {
    if (
      !Number.isSafeInteger(fill.tid) ||
      fill.tid < 0 ||
      !Number.isSafeInteger(fill.time) ||
      fill.time < 0
    )
      throw new AgentCliError('UPSTREAM_ERROR', 'Invalid fill identity');
    return withFileLock(this.cursorPath + '.lock', async () => {
      if (this.seen.has(fill.tid)) return;
      await this.emit('fill', {
        ...fill,
        scope: this.scope,
        eventId: `${this.scope}:fill:${fill.tid}`,
      });
      this.seen.add(fill.tid);
      this.lastFill = Math.max(this.lastFill ?? 0, fill.time);
      if (this.seen.size > 10000)
        this.seen.delete(this.seen.values().next().value!);
      await this.persist();
    });
  }
  async flush() {
    await this.queue;
  }
}
export function sdkBackend(config: Config): Backend {
  const transport = new WebSocketTransport({
    isTestnet: config.network === 'testnet',
    resubscribe: true,
    webSocketFactory: (url, protocols) =>
      new WebSocket(url, protocols) as unknown as globalThis.WebSocket,
  });
  const client = new SubscriptionClient({ transport }) as unknown as Record<
    string,
    (
      params: Record<string, unknown>,
      listener: (data: unknown) => void,
    ) => Promise<{ unsubscribe: () => Promise<void> }>
  >;
  return {
    subscribe: (type, params, listener) => client[type](params, listener),
    onState: (listener) =>
      transport.events.addEventListener('connectionstatechange', (event) =>
        listener(event.detail),
      ),
    close: async () => {
      await transport.close();
    },
    gap: async (startTime = Date.now() - 60_000) => {
      const fills: Fill[] = [];
      const endTime = Date.now();
      for (let page = 0; page < 100; page++) {
        const batch = await hlInfo<Fill[]>(config.network, 'userFillsByTime', {
          user: config.masterAddress,
          startTime,
          endTime,
        });
        fills.push(...batch);
        if (batch.length < 2000) return fills;
        const last = Math.max(...batch.map((fill) => fill.time));
        if (last <= startTime)
          throw new Error('Fill backfill cannot advance; inspect gap');
        startTime = last;
      }
      throw new Error('Fill backfill exceeded pagination bound');
    },
  };
}
export async function startSubscriptions(
  runner: Runner,
  emit: (type: string, data: unknown) => Promise<void>,
) {
  const subscriptions = new Subscriptions(
    runner,
    sdkBackend(runner.config),
    emit,
  );
  await subscriptions.start();
  return subscriptions;
}
