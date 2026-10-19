import { hlInfo } from '../core/http.js';
import { createClients, type ExchangeAdapter } from '../core/hlclient.js';
import type { Config } from '../core/config.js';
import type { TradingServices } from '../core/trading.js';
import type { AccountState, OpenOrder } from '../commands/read.js';
import { AgentCliError } from '../errors/index.js';
import { formatUsdc, parseUsdc } from '../funding/amounts.js';
import { paperDataNetwork } from '../core/mode.js';
import { PaperStore } from './store.js';
import {
  accountEquity,
  assertInitialMargin,
  cancelOrder,
  dailyLoss,
  initialMargin,
  liquidationPx,
  matchOrders,
  positionOf,
  restOrder,
  unrealizedPnl,
  walkBook,
  type PaperBook,
  type PaperOrder,
  type PaperState,
  type PaperTrade,
} from './simulator.js';
export interface PaperData {
  book: (coin: string) => Promise<PaperBook>;
  marks: () => Promise<Record<string, string>>;
  fundingRates: () => Promise<Record<string, string>>;
  mids: () => Promise<Record<string, string>>;
  coinOfAsset: (asset: number) => Promise<string>;
  maxLeverageOf: (coin: string) => Promise<number>;
}
interface AssetCtx {
  markPx?: string;
  funding?: string;
  midPx?: string;
}
let ctxCache: { at: number; marks: Record<string, string>; funding: Record<string, string> } | null =
  null;
async function assetCtxs() {
  if (ctxCache && Date.now() - ctxCache.at < 60_000) return ctxCache;
  const [, assetCtxs] = await hlInfo<
    [unknown, AssetCtx[]]
  >(paperDataNetwork, 'metaAndAssetCtxs');
  const meta = await hlInfo<{ universe: { name: string }[] }>(
    paperDataNetwork,
    'meta',
  );
  const marks: Record<string, string> = {},
    funding: Record<string, string> = {};
  meta.universe.forEach(({ name }, index) => {
    const ctx = assetCtxs[index];
    if (ctx?.markPx) marks[name] = ctx.markPx;
    if (ctx?.funding) funding[name] = ctx.funding;
  });
  ctxCache = { at: Date.now(), marks, funding };
  return ctxCache;
}
export function paperData(): PaperData {
  return {
    book: async (coin) => {
      const book = await hlInfo<{ levels: { px: string; sz: string }[][] }>(
        paperDataNetwork,
        'l2Book',
        { coin },
      );
      if (!Array.isArray(book.levels) || book.levels.length < 2)
        throw new AgentCliError('UPSTREAM_ERROR', 'Invalid l2Book snapshot');
      return { bids: book.levels[0] ?? [], asks: book.levels[1] ?? [] };
    },
    marks: async () => (await assetCtxs()).marks,
    fundingRates: async () => (await assetCtxs()).funding,
    mids: async () => hlInfo(paperDataNetwork, 'allMids'),
    coinOfAsset: async (asset) => {
      const { universe } = await hlInfo<{ universe: { name: string }[] }>(
        paperDataNetwork,
        'meta',
      );
      const coin = universe[asset]?.name;
      if (!coin) throw new AgentCliError('UNKNOWN_MARKET', `Unknown asset ${asset}`);
      return coin;
    },
    maxLeverageOf: async (coin) =>
      (await createClients(paperDataNetwork).meta.lookup(coin)).maxLeverage,
  };
}
export function paperAccountState(
  state: PaperState,
  marks: Record<string, string>,
  maxLeverageOf: (coin: string) => number,
): AccountState {
  const positions = state.positions.map((position) => {
    const mark = marks[position.coin] ?? position.entryPx;
    return {
      position: {
        coin: position.coin,
        szi: position.size,
        entryPx: position.entryPx,
        unrealizedPnl: formatUsdc(unrealizedPnl(position, mark), 18),
        liquidationPx: liquidationPx(position, maxLeverageOf(position.coin)),
        leverage: { type: position.leverage.type, value: position.leverage.value },
      },
    };
  });
  const marginUsed = state.positions.reduce(
    (sum, p) => sum + (marks[p.coin] ? initialMargin(p, marks[p.coin]) : 0n),
    0n,
  );
  const notional = state.positions.reduce(
    (sum, p) =>
      sum +
      (marks[p.coin]
        ? (absBig(parseUsdc(p.size, 18)) * parseUsdc(marks[p.coin], 18)) /
          SCALE
        : 0n),
    0n,
  );
  return {
    marginSummary: {
      accountValue: formatUsdc(accountEquity(state, marks), 18),
      totalMarginUsed: formatUsdc(marginUsed, 18),
      totalNtlPos: formatUsdc(notional, 18),
    },
    withdrawable: state.balance,
    assetPositions: positions,
  };
}
const SCALE = 10n ** 18n;
const absBig = (value: bigint) => (value < 0n ? -value : value);
export function paperOpenOrders(state: PaperState): OpenOrder[] {
  return state.orders.map((order) => ({
    coin: order.coin,
    oid: order.oid,
    ...(order.cloid ? { cloid: order.cloid } : {}),
    sz: order.sz,
    limitPx: order.limitPx,
    side: order.side,
    reduceOnly: order.reduceOnly,
    ...(order.isTrigger
      ? {
          isTrigger: true,
          triggerPx: order.triggerPx,
          orderType: order.tpsl === 'tp' ? 'Take Profit' : 'Stop Loss',
        }
      : {}),
    tif: order.tif,
  }));
}
export function paperTradingServices(
  config: Config,
  store: PaperStore,
  data: PaperData = paperData(),
): TradingServices {
  return {
    exchange: paperExchange(config, store, data),
    market: (coin) => createClients(paperDataNetwork).meta.lookup(coin),
    state: async () => {
      const [state, marks] = await Promise.all([store.load(), data.marks()]);
      const resolved = new Map<string, number>();
      for (const coin of new Set(state.positions.map((p) => p.coin)))
        resolved.set(coin, await data.maxLeverageOf(coin));
      return paperAccountState(state, marks, (coin) => resolved.get(coin) ?? 1);
    },
    orders: async () => paperOpenOrders(await store.load()),
    mids: () => data.mids(),
    dailyLoss: async () => {
      const [state, marks] = await Promise.all([store.load(), data.marks()]);
      return dailyLoss(state, marks);
    },
  };
}
type WireOrder = {
  a: number;
  b: boolean;
  p: string;
  s: string;
  r: boolean;
  t:
    | { limit: { tif: 'Gtc' | 'Ioc' | 'Alo' } }
    | { trigger: { isMarket: boolean; triggerPx: string; tpsl: 'tp' | 'sl' } };
  c?: string;
};
export type PaperEmit = (type: string, payload: unknown) => Promise<void>;
// Local exchange adapter: fills orders against live mainnet market data while
// running the same simulator accounting as the paper runner.
export function paperExchange(
  config: Config,
  store: PaperStore,
  data: PaperData = paperData(),
  emit?: PaperEmit,
): ExchangeAdapter {
  const builderFee = config.builder.fee;
  const emitFills = async (trades: PaperTrade[], orders: PaperOrder[]) => {
    if (!emit) return;
    for (const trade of trades)
      await emit('fill', {
        tid: trade.tid,
        time: trade.time,
        coin: trade.coin,
        side: trade.side,
        px: trade.px,
        sz: trade.sz,
        oid: trade.oid,
        cloid: trade.cloid,
        fee: trade.fee,
        paper: true,
      });
    for (const order of orders)
      await emit('order_update', { oid: order.oid, status: 'filled', paper: true });
  };
  const place = async (wire: WireOrder) => {
    const coin = await data.coinOfAsset(wire.a);
    const now = Date.now();
    const result = await store.update(async (state) => {
      const isIoc = 'limit' in wire.t && wire.t.limit.tif === 'Ioc';
      if (wire.r && isIoc && (!positionOf(state, coin) || Number(positionOf(state, coin)!.size) === 0)) {
        // A reduce-only IOC against a flat book matches nothing and is done.
        const oid = state.nextOid++;
        return {
          status: { filled: { oid, totalSz: '0', avgPx: '0', status: 'canceled' } },
          filled: [] as PaperTrade[],
          completed: [] as PaperOrder[],
        };
      }
      if ('trigger' in wire.t) {
        const { isMarket, triggerPx, tpsl } = wire.t.trigger;
        const marks = await data.marks();
        const mark = marks[coin];
        const book = isMarket ? await data.book(coin) : null;
        const order = restOrder(state, {
          coin,
          side: wire.b ? 'B' : 'A',
          sz: wire.s,
          limitPx: wire.p,
          reduceOnly: wire.r,
          tif: 'Gtc',
          cloid: wire.c,
          isTrigger: true,
          triggerPx,
          tpsl,
          triggerIsMarket: isMarket,
          now,
        });
        const matched = matchOrders(
          state,
          coin,
          { markPx: mark },
          book,
          builderFee,
          now,
        );
        if (matched.triggeredOids.length || matched.filledOids.length) {
          const filledSz = matched.fills.reduce(
            (sum, trade) => sum + parseUsdc(trade.sz, 18),
            0n,
          );
          const notional = matched.fills.reduce(
            (sum, trade) =>
              sum +
              (parseUsdc(trade.sz, 18) * parseUsdc(trade.px, 18)) / SCALE,
            0n,
          );
          return {
            status: {
              filled: {
                oid: order.oid,
                totalSz: formatUsdc(filledSz, 18),
                avgPx:
                  filledSz > 0n
                    ? formatUsdc((notional * SCALE) / filledSz, 18)
                    : (mark ?? wire.p),
                status: 'filled',
              },
            },
            filled: matched.fills,
            completed: [order],
          };
        }
        return { status: { resting: { oid: order.oid } }, filled: [], completed: [] };
      }
      const { tif } = wire.t.limit;
      if (tif === 'Ioc') {
        const book = await data.book(coin);
        assertInitialMargin(state, coin, wire.b ? wire.s : `-${wire.s}`, wire.p, await data.marks());
        const walk = walkBook(
          state,
          {
            coin,
            side: wire.b ? 'B' : 'A',
            sz: wire.s,
            limitPx: wire.p,
            cloid: wire.c,
            reduceOnly: wire.r,
          },
          book,
          builderFee,
          now,
        );
        if (walk.trades.length === 0)
          return {
            status: { error: 'Order could not immediately match against any resting orders' },
            filled: [],
            completed: [],
          };
        const oid = state.nextOid++;
        for (const trade of walk.trades) trade.oid = oid;
        return {
          status: {
            filled: {
              oid,
              totalSz: walk.filledSz,
              avgPx: walk.avgPx ?? '0',
              status: walk.filledSz === wire.s ? 'filled' : 'canceled',
            },
          },
          filled: walk.trades,
          completed: [],
        };
      }
      const book = await data.book(coin);
      const best = wire.b ? book.asks[0]?.px : book.bids[0]?.px;
      const crosses = best !== undefined &&
        (wire.b ? Number(best) <= Number(wire.p) : Number(best) >= Number(wire.p));
      if (crosses) {
        assertInitialMargin(state, coin, wire.b ? wire.s : `-${wire.s}`, wire.p, await data.marks());
        const walk = walkBook(
          state,
          {
            coin,
            side: wire.b ? 'B' : 'A',
            sz: wire.s,
            limitPx: wire.p,
            cloid: wire.c,
            reduceOnly: wire.r,
          },
          book,
          builderFee,
          now,
        );
        if (walk.trades.length) {
          const oid = state.nextOid++;
          for (const trade of walk.trades) trade.oid = oid;
          return {
            status: {
              filled: { oid, totalSz: walk.filledSz, avgPx: walk.avgPx ?? '0', status: 'filled' },
            },
            filled: walk.trades,
            completed: [],
          };
        }
      }
      assertInitialMargin(state, coin, wire.b ? wire.s : `-${wire.s}`, wire.p, await data.marks());
      const order = restOrder(state, {
        coin,
        side: wire.b ? 'B' : 'A',
        sz: wire.s,
        limitPx: wire.p,
        reduceOnly: wire.r,
        tif,
        cloid: wire.c,
        now,
      });
      return { status: { resting: { oid: order.oid } }, filled: [], completed: [] };
    });
    await emitFills(result.filled, result.completed);
    return result.status;
  };
  return {
    order: async ({ orders }: { orders: WireOrder[] }) => ({
      status: 'ok',
      response: { data: { statuses: await Promise.all(orders.map(place)) } },
    }),
    cancel: async ({ cancels }: { cancels: { a: number; o: number }[] }) => {
      const statuses = await Promise.all(
        cancels.map(async ({ o }) => {
          const removed = await store.update((state) => cancelOrder(state, o));
          if (!removed)
            return { error: `Order ${o} not found` };
          await emit?.('order_update', { oid: o, status: 'canceled', paper: true });
          return { success: true };
        }),
      );
      return { status: 'ok', response: { data: { statuses } } };
    },
    cancelByCloid: async ({ cloids }: { cloids: { a: number; c: string }[] }) => {
      const statuses = await Promise.all(
        cloids.map(async ({ c }) => {
          const removed = await store.update((state) => {
            const order = state.orders.find((order) => order.cloid === c);
            return order ? cancelOrder(state, order.oid) : null;
          });
          if (!removed) return { error: `Order with cloid ${c} not found` };
          await emit?.('order_update', { oid: removed.oid, status: 'canceled', paper: true });
          return { success: true };
        }),
      );
      return { status: 'ok', response: { data: { statuses } } };
    },
    batchModify: async ({
      modifies,
    }: {
      modifies: { oid: number | string; order: WireOrder }[];
    }) => {
      const statuses = [];
      for (const { oid, order: wire } of modifies) {
        const coin = await data.coinOfAsset(wire.a);
        const updated = await store.update(async (state) => {
          const existing = state.orders.find(
            (o) => o.oid === oid || (typeof oid === 'string' && o.cloid === oid),
          );
          if (!existing) return null;
          existing.sz = wire.s;
          existing.limitPx = wire.p;
          existing.reduceOnly = wire.r;
          existing.cloid = wire.c ?? existing.cloid;
          const book = await data.book(coin);
          const best = wire.b ? book.asks[0]?.px : book.bids[0]?.px;
          const crosses = best !== undefined &&
            (wire.b ? Number(best) <= Number(wire.p) : Number(best) >= Number(wire.p));
          if (crosses) {
            const walk = walkBook(
              state,
              {
                coin,
                side: wire.b ? 'B' : 'A',
                sz: wire.s,
                limitPx: wire.p,
                reduceOnly: wire.r,
                oid: existing.oid,
                cloid: wire.c,
              },
              book,
              builderFee,
              Date.now(),
            );
            if (walk.trades.length) {
              state.orders = state.orders.filter((o) => o.oid !== existing.oid);
              return { trades: walk.trades };
            }
          }
          return { trades: [] as PaperTrade[] };
        });
        if (!updated) {
          statuses.push({ error: `Order ${oid} not found` });
          continue;
        }
        await emitFills(updated.trades, []);
        statuses.push({ status: 'modified' });
      }
      return { status: 'ok', response: { data: { statuses } } };
    },
    updateLeverage: async ({
      asset,
      isCross,
      leverage,
    }: {
      asset: number;
      isCross: boolean;
      leverage: number;
    }) => {
      const coin = await data.coinOfAsset(asset);
      const maxLeverage = await data.maxLeverageOf(coin);
      if (leverage < 1 || leverage > maxLeverage)
        throw new AgentCliError('POLICY_REJECTED', 'Leverage exceeds market ceiling', {
          maximum: maxLeverage,
          actual: leverage,
        });
      await store.update((state) => {
        const setting = { type: isCross ? ('cross' as const) : ('isolated' as const), value: leverage };
        state.leverage[coin] = setting;
        const position = positionOf(state, coin);
        if (position) position.leverage = setting;
      });
      return { status: 'ok' };
    },
  };
}
