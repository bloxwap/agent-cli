import { SubscriptionClient, WebSocketTransport } from '@bloxwap/hyperliquid';
import WebSocket from 'ws';
import { health } from '../runner/health.js';
import { normalizeError } from '../errors/index.js';
import { PaperStore } from './store.js';
import {
  accrueFunding,
  liquidate,
  matchOrders,
  type MatchResult,
  type PaperBook,
} from './simulator.js';
import { paperData, type PaperData } from './services.js';
import type { Runner } from '../runner/lifecycle.js';
interface Backend {
  subscribe: (
    type: string,
    params: Record<string, unknown>,
    listener: (data: unknown) => void,
  ) => Promise<{ unsubscribe: () => Promise<void> }>;
  onState: (listener: (state: string) => void) => void;
  close: () => Promise<void>;
}
interface BookMessage {
  coin: string;
  side?: 'B' | 'A';
  levels: { px: string; sz: string; n?: number }[][];
}
interface TradeMessage {
  coin: string;
  px: string;
  side: 'B' | 'A';
}
// Live-feed paper engine: fills resting orders from real mainnet l2Book/trades
// data, accrues funding and applies the liquidation approximation on a timer.
export class PaperEngine {
  state = 'connecting';
  lastMessage = Date.now();
  lastFill: number | null = null;
  private books = new Map<string, PaperBook>();
  private lastTrade = new Map<string, string>();
  private subscriptions: {
    coin: string;
    type: string;
    handle: { unsubscribe: () => Promise<void> };
  }[] = [];
  private queue = Promise.resolve();
  private timer?: NodeJS.Timeout;
  constructor(
    private runner: Runner,
    private store: PaperStore,
    private backend: Backend,
    private emit: (type: string, data: unknown) => Promise<void>,
    private data: PaperData = paperData(),
    private builderFee = runner.config.builder.fee,
  ) {}
  async start() {
    this.backend.onState((state) => {
      const reconnect = this.state !== 'connecting' && state === 'connected';
      this.state = state;
      this.lastMessage = Date.now();
      if (reconnect)
        this.enqueue(async () => {
          await this.refreshSubscriptions();
          await this.emit('runner_state', { wsState: state, paper: true });
        });
    });
    await this.refreshSubscriptions();
    this.timer = setInterval(() => {
      this.enqueue(() => this.tick());
    }, 30_000);
    this.runner.onShutdown(async () => {
      if (this.timer) clearInterval(this.timer);
      await this.queue;
      await Promise.all(
        this.subscriptions.map((subscription) => subscription.handle.unsubscribe()),
      );
      this.subscriptions = [];
      await this.backend.close();
    });
    this.enqueue(() => this.tick());
  }
  private enqueue(operation: () => Promise<void>) {
    this.queue = this.queue.then(operation).catch(async (error) => {
      await this.emit('error', normalizeError(error).toJSON());
    });
  }
  private async activeCoins(): Promise<string[]> {
    const state = await this.store.load();
    return [
      ...new Set([
        ...this.runner.config.allowedMarkets,
        ...state.orders.map((order) => order.coin),
        ...state.positions.map((position) => position.coin),
      ]),
    ];
  }
  async refreshSubscriptions() {
    const coins = await this.activeCoins();
    for (const subscription of [...this.subscriptions]) {
      if (!coins.includes(subscription.coin)) {
        await subscription.handle.unsubscribe();
        this.subscriptions = this.subscriptions.filter(
          (candidate) => candidate !== subscription,
        );
        this.books.delete(subscription.coin);
      }
    }
    for (const coin of coins) {
      for (const type of ['l2Book', 'trades', 'bbo']) {
        if (this.subscriptions.some((s) => s.coin === coin && s.type === type))
          continue;
        const handle = await this.backend.subscribe(
          type,
          { coin },
          (message) => {
            this.lastMessage = Date.now();
            this.enqueue(() => this.handleMessage(type, coin, message));
          },
        );
        this.subscriptions.push({ coin, type, handle });
      }
    }
  }
  private async handleMessage(type: string, coin: string, message: unknown) {
    if (type === 'trades') {
      for (const trade of (message as { trades?: TradeMessage[] }).trades ?? []) {
        if (trade.coin === coin) this.lastTrade.set(coin, trade.px);
      }
      await this.match(coin);
      return;
    }
    if (type === 'l2Book') this.applyBookMessage(coin, message as BookMessage);
    await this.match(coin);
  }
  private applyBookMessage(coin: string, message: BookMessage) {
    let book = this.books.get(coin) ?? { bids: [], asks: [] };
    if (message.side) {
      const side = message.side === 'B' ? 'bids' : 'asks';
      for (const level of message.levels[0] ?? []) {
        const index = book[side].findIndex((existing) => existing.px === level.px);
        if (Number(level.sz) === 0) {
          if (index >= 0) book[side].splice(index, 1);
        } else if (index >= 0) book[side][index].sz = level.sz;
        else book[side].push({ px: level.px, sz: level.sz });
      }
      book.bids.sort((a, b) => Number(b.px) - Number(a.px));
      book.asks.sort((a, b) => Number(a.px) - Number(b.px));
    } else if (Array.isArray(message.levels)) {
      book = { bids: message.levels[0] ?? [], asks: message.levels[1] ?? [] };
    } else return;
    this.books.set(coin, book);
  }
  private async match(coin: string) {
    const book = this.books.get(coin) ?? null;
    const marks = await this.data.marks();
    const result = await this.store.update((state) =>
      matchOrders(
        state,
        coin,
        {
          bestBid: book?.bids[0]?.px,
          bestAsk: book?.asks[0]?.px,
          lastTradePx: this.lastTrade.get(coin),
          markPx: marks[coin],
        },
        book,
        this.builderFee,
        Date.now(),
      ),
    );
    await this.report(result);
  }
  private async report(result: MatchResult) {
    for (const trade of result.fills) {
      this.lastFill = Math.max(this.lastFill ?? 0, trade.time);
      await this.emit('fill', { ...trade, paper: true });
    }
    for (const oid of [...result.filledOids, ...result.triggeredOids])
      await this.emit('order_update', { oid, status: 'filled', paper: true });
    for (const oid of result.cancelledOids)
      await this.emit('order_update', { oid, status: 'canceled', paper: true });
    if (result.fills.length)
      await this.emit('position_change', { fills: result.fills.length, paper: true });
  }
  async tick() {
    await this.refreshSubscriptions();
    const [marks, rates] = await Promise.all([
      this.data.marks(),
      this.data.fundingRates(),
    ]);
    const now = Date.now();
    const payments = await this.store.update((state) =>
      accrueFunding(state, rates, marks, now),
    );
    for (const payment of payments)
      await this.emit('position_change', { type: 'funding', ...payment, paper: true });
    const state = await this.store.load();
    const maxLeverage = new Map<string, number>();
    for (const coin of new Set(state.positions.map((position) => position.coin)))
      maxLeverage.set(coin, await this.data.maxLeverageOf(coin));
    const liquidated = await this.store.update((latest) =>
      liquidate(latest, marks, (coin) => maxLeverage.get(coin) ?? 1, this.builderFee, now),
    );
    for (const trade of liquidated) {
      await this.emit('fill', { ...trade, paper: true });
      await this.emit('error', {
        code: 'INSUFFICIENT_MARGIN',
        message: `Paper liquidation on ${trade.coin}`,
        paper: true,
      });
    }
    await this.emit('runner_state', { ...health(this.runner), paper: true });
  }
  async flush() {
    await this.queue;
  }
}
export function paperBackend(): Backend {
  const transport = new WebSocketTransport({
    isTestnet: false, // paper trading always reads mainnet public data
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
  };
}
export async function startPaperEngine(
  runner: Runner,
  emit: (type: string, data: unknown) => Promise<void>,
  backend: Backend = paperBackend(),
) {
  const engine = new PaperEngine(
    runner,
    new PaperStore(),
    backend,
    emit,
  );
  await engine.start();
  return engine;
}
