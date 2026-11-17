import { SubscriptionClient, WebSocketTransport } from '@bloxwap/hyperliquid';
import WebSocket from 'ws';
import { health } from '../runner/health.js';
import { normalizeError } from '../errors/index.js';
import { PaperStore } from './store.js';
import {
  accrueFunding,
  rolloverDay,
  liquidate,
  matchOrders,
  type PaperBook,
} from './simulator.js';
import { paperData, validateBook, type PaperData } from './services.js';
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
  time?: number;
  side?: 'B' | 'A';
  levels: { px: string; sz: string; n?: number }[][];
}
interface TradeMessage {
  coin: string;
  px: string;
  side: 'B' | 'A';
  time?: number;
}
// Live-feed paper engine: fills resting orders from real mainnet l2Book/trades
// data, accrues funding and applies the liquidation approximation on a timer.
export class PaperEngine {
  state = 'connecting';
  lastMessage = Date.now();
  lastFill: number | null = null;
  private books = new Map<string, PaperBook>();
  private bookTimes = new Map<string, number>();
  private stopped = false;
  private stopping?: Promise<void>;
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
    this.runner.onShutdown(() => this.stop());
    this.store.setEmitter(this.emit);
    this.runner.subscriptions = this;
    try {
      this.backend.onState((state) => {
        if (this.stopped) return;
        const reconnect = this.state !== 'connecting' && state === 'connected';
        this.state = state;
        if (state !== 'connected') {
          this.books.clear();
          this.bookTimes.clear();
        }
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
      this.enqueue(() => this.tick());
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  private stop() {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    return (this.stopping = (async () => {
      await this.queue.catch(() => {});
      await Promise.allSettled(
        this.subscriptions.map((s) => s.handle.unsubscribe()),
      );
      this.subscriptions = [];
      await this.backend.close();
    })());
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
            if (this.stopped) return;
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
      const trades = Array.isArray(message)
        ? message
        : ((message as { trades?: TradeMessage[] }).trades ?? []);
      for (const trade of trades as TradeMessage[])
        if (
          trade.coin === coin &&
          trade.time !== undefined &&
          this.fresh(trade.time)
        )
          await this.match(coin, { px: trade.px, time: trade.time! });
      return;
    }
    const value = message as BookMessage & {
      bbo?: ({ px: string; sz: string } | null)[];
    };
    if (
      value.coin !== coin ||
      value.time === undefined ||
      !this.fresh(value.time) ||
      value.time < (this.bookTimes.get(coin) ?? 0)
    )
      return;
    if (type === 'bbo') {
      if (!Array.isArray(value.bbo) || value.bbo.length !== 2) return;
      this.applyBookMessage(coin, {
        coin,
        time: value.time,
        levels: [
          value.bbo[0] ? [value.bbo[0]] : [],
          value.bbo[1] ? [value.bbo[1]] : [],
        ],
      });
    } else if (type === 'l2Book') this.applyBookMessage(coin, value);
    await this.match(coin);
  }
  private fresh(time: number) {
    return Number.isSafeInteger(time) && Math.abs(Date.now() - time) <= 5_000;
  }
  private applyBookMessage(coin: string, message: BookMessage) {
    let book = this.books.get(coin) ?? { bids: [], asks: [] };
    if (message.side) {
      const side = message.side === 'B' ? 'bids' : 'asks';
      for (const level of message.levels[0] ?? []) {
        const index = book[side].findIndex(
          (existing) => existing.px === level.px,
        );
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
    validateBook(book);
    this.books.set(coin, book);
    this.bookTimes.set(coin, message.time ?? Date.now());
  }
  private async match(coin: string, trade?: { px: string; time: number }) {
    const bookTime = this.bookTimes.get(coin) ?? 0;
    const book = this.fresh(bookTime) ? (this.books.get(coin) ?? null) : null;
    const [marks, rates] = await Promise.all([
      this.data.marks(),
      this.data.fundingRates(),
    ]);
    const result = await this.store.update((state) => {
      const now = Date.now();
      rolloverDay(state, marks, now);
      accrueFunding(state, rates, marks, now);
      state.marks = marks;
      state.fundingRates = rates;
      state.marketAt = now;
      return matchOrders(
        state,
        coin,
        {
          bestBid: book?.bids[0]?.px,
          bestAsk: book?.asks[0]?.px,
          lastTradePx: trade?.px,
          markPx: marks[coin],
          time: trade?.time ?? bookTime,
          bookTime,
          tradeTime: trade?.time,
        },
        book,
        this.builderFee,
        now,
      );
    });
    for (const fill of result.fills)
      this.lastFill = Math.max(this.lastFill ?? 0, fill.time);
  }
  async tick() {
    await this.refreshSubscriptions();
    const [marks, rates] = await Promise.all([
      this.data.marks(),
      this.data.fundingRates(),
    ]);
    const now = Date.now();
    await this.store.update(async (state) => {
      rolloverDay(state, marks, now);
      accrueFunding(state, rates, marks, now);
      state.marks = marks;
      state.fundingRates = rates;
      state.marketAt = now;
      const maxLeverage = new Map<string, number>();
      for (const coin of new Set(
        state.positions.map((position) => position.coin),
      ))
        maxLeverage.set(coin, await this.data.maxLeverageOf(coin));
      const liquidated = liquidate(
        state,
        marks,
        (coin) => maxLeverage.get(coin) ?? 1,
        this.builderFee,
        now,
      );
      for (const trade of liquidated) {
        const eventId = `paper:${state.sessionId}:liquidation:${trade.tid}`;
        state.outbox.push({
          type: 'error',
          eventId,
          data: {
            code: 'INSUFFICIENT_MARGIN',
            message: `Paper liquidation on ${trade.coin}`,
            paper: true,
            scope: `paper:${state.sessionId}`,
            eventId,
          },
        });
      }
    });
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
    new PaperStore(undefined, runner.config.paper.startingBalance),
    backend,
    emit,
  );
  await engine.start();
  return engine;
}
