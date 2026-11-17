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
  accrueFunding,
  rolloverDay,
  assertInitialMargin,
  cancelOrder,
  dailyLoss,
  initialMargin,
  leverageOf,
  liquidationPx,
  matchOrders,
  positionOf,
  restOrder,
  unrealizedPnl,
  walkBook,
  type PaperBook,
  type PaperOrder,
  type PaperState,
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
let ctxCache: {
  at: number;
  marks: Record<string, string>;
  funding: Record<string, string>;
} | null = null;
async function assetCtxs() {
  if (ctxCache && Date.now() - ctxCache.at < 5_000) return ctxCache;
  const [meta, assetCtxs] = await hlInfo<
    [{ universe: { name: string }[] }, AssetCtx[]]
  >(paperDataNetwork, 'metaAndAssetCtxs');
  if (
    !Array.isArray(meta?.universe) ||
    meta.universe.length !== assetCtxs.length
  )
    throw new AgentCliError(
      'UPSTREAM_ERROR',
      'Market context metadata mismatch',
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
      const book = await hlInfo<{
        time: number;
        levels: { px: string; sz: string }[][];
      }>(paperDataNetwork, 'l2Book', { coin });
      if (
        !Number.isSafeInteger(book.time) ||
        Math.abs(Date.now() - book.time) > 5_000 ||
        !Array.isArray(book.levels) ||
        book.levels.length !== 2
      )
        throw new AgentCliError('UPSTREAM_ERROR', 'Invalid l2Book snapshot');
      const result = { bids: book.levels[0] ?? [], asks: book.levels[1] ?? [] };
      validateBook(result);
      return result;
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
      if (!coin)
        throw new AgentCliError('UNKNOWN_MARKET', `Unknown asset ${asset}`);
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
    const mark = marks[position.coin];
    if (!mark)
      throw new AgentCliError('POLICY_REJECTED', 'Paper mark unavailable', {
        coin: position.coin,
      });
    return {
      position: {
        coin: position.coin,
        szi: position.size,
        entryPx: position.entryPx,
        unrealizedPnl: formatUsdc(unrealizedPnl(position, mark), 18),
        liquidationPx: liquidationPx(position, maxLeverageOf(position.coin)),
        leverage: {
          type: position.leverage.type,
          value: position.leverage.value,
        },
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
        ? (absBig(parseUsdc(p.size, 18)) * parseUsdc(marks[p.coin], 18)) / SCALE
        : 0n),
    0n,
  );
  return {
    marginSummary: {
      accountValue: formatUsdc(accountEquity(state, marks), 18),
      totalMarginUsed: formatUsdc(marginUsed, 18),
      totalNtlPos: formatUsdc(notional, 18),
    },
    withdrawable: formatUsdc(
      accountEquity(state, marks) > marginUsed
        ? accountEquity(state, marks) - marginUsed
        : 0n,
      18,
    ),
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
    sz: formatUsdc(parseUsdc(order.sz, 18) - parseUsdc(order.filledSz, 18), 18),
    limitPx: order.limitPx,
    side: order.side,
    reduceOnly: order.reduceOnly,
    ...(order.isTrigger
      ? {
          isTrigger: true,
          triggerPx: order.triggerPx,
          orderType: `${order.tpsl === 'tp' ? 'Take Profit' : 'Stop Loss'} ${order.triggerIsMarket ? 'Market' : 'Limit'}`,
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
      const marks = await data.marks();
      return store.update((state) => {
        rolloverDay(state, marks, Date.now());
        return dailyLoss(state, marks);
      });
    },
    assetLeverage: async (coin) => leverageOf(await store.load(), coin).value,
    orderByCloid: async (cloid) => {
      const state = await store.load();
      const resting = state.orders.find((order) => order.cloid === cloid);
      if (resting)
        return {
          status: 'ok',
          response: {
            data: { statuses: [{ resting: { oid: resting.oid } }] },
          },
        };
      const status = await store.orderResult(cloid);
      return status
        ? { status: 'ok', response: { data: { statuses: [status] } } }
        : null;
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
  if (emit) store.setEmitter(emit);
  const prepare = async (state: PaperState) => {
    const [marks, rates] = await Promise.all([
      data.marks(),
      data.fundingRates(),
    ]);
    const now = Date.now();
    rolloverDay(state, marks, now);
    accrueFunding(state, rates, marks, now);
    state.marks = marks;
    state.fundingRates = rates;
    state.marketAt = now;
    return now;
  };
  const execute = async (
    state: PaperState,
    wire: WireOrder,
    coin: string,
    existing?: PaperOrder,
  ) => {
    const now = await prepare(state);
    const book = await data.book(coin);
    validateBook(book);
    const side = wire.b ? ('B' as const) : ('A' as const);
    const best = wire.b ? book.asks[0]?.px : book.bids[0]?.px;
    const crosses =
      best !== undefined &&
      (wire.b
        ? parseUsdc(best, 18) <= parseUsdc(wire.p, 18)
        : parseUsdc(best, 18) >= parseUsdc(wire.p, 18));
    const tif = 'limit' in wire.t ? wire.t.limit.tif : 'Gtc';
    if (tif === 'Alo' && crosses)
      throw new AgentCliError(
        'POLICY_REJECTED',
        'Post-only order would cross the book',
      );
    if (!wire.r)
      assertInitialMargin(
        state,
        coin,
        wire.b ? wire.s : `-${wire.s}`,
        wire.p,
        state.marks,
      );
    if (existing) cancelOrder(state, existing.oid);
    const order = restOrder(state, {
      coin,
      side,
      sz: wire.s,
      limitPx: wire.p,
      reduceOnly: wire.r,
      tif,
      cloid: wire.c,
      ...('trigger' in wire.t
        ? {
            isTrigger: true,
            triggerPx: wire.t.trigger.triggerPx,
            tpsl: wire.t.trigger.tpsl,
            triggerIsMarket: wire.t.trigger.isMarket,
          }
        : {}),
      now,
    });
    if (existing) order.oid = existing.oid;
    if ('trigger' in wire.t) {
      const matched = matchOrders(
        state,
        coin,
        {
          markPx: state.marks[coin],
          bestBid: book.bids[0]?.px,
          bestAsk: book.asks[0]?.px,
          time: now,
        },
        book,
        builderFee,
        now,
        order.oid,
      );
      const fills = matched.fills.filter((t) => t.oid === order.oid);
      if (state.orders.some((o) => o.oid === order.oid))
        return { resting: { oid: order.oid } };
      const size = fills.reduce((sum, t) => sum + parseUsdc(t.sz, 18), 0n);
      const value = fills.reduce(
        (sum, t) => sum + parseUsdc(t.sz, 18) * parseUsdc(t.px, 18),
        0n,
      );
      return {
        filled: {
          oid: order.oid,
          totalSz: formatUsdc(size, 18),
          avgPx: size ? formatUsdc(value / size, 18) : '0',
          status: size ? 'filled' : 'canceled',
        },
      };
    }
    if (crosses || tif === 'Ioc') {
      const walk = walkBook(
        state,
        {
          coin,
          side,
          sz: wire.s,
          limitPx: wire.p,
          oid: order.oid,
          cloid: wire.c,
          reduceOnly: wire.r,
        },
        book,
        builderFee,
        now,
      );
      order.filledSz = walk.filledSz;
      const position = positionOf(state, coin);
      const exhausted =
        wire.r && (!position || parseUsdc(position.size, 18) > 0n === wire.b);
      if (
        tif === 'Ioc' ||
        exhausted ||
        parseUsdc(walk.filledSz, 18) >= parseUsdc(wire.s, 18)
      ) {
        cancelOrder(state, order.oid);
        if (!walk.trades.length && !wire.r)
          return {
            error:
              'Order could not immediately match against any resting orders',
          };
        return {
          filled: {
            oid: order.oid,
            totalSz: walk.filledSz,
            avgPx: walk.avgPx ?? '0',
            status:
              parseUsdc(walk.filledSz, 18) === parseUsdc(wire.s, 18)
                ? 'filled'
                : 'canceled',
          },
        };
      }
    }
    return { resting: { oid: order.oid } };
  };
  const place = async (wire: WireOrder) => {
    const coin = await data.coinOfAsset(wire.a);
    return store.orderOperation(wire, (state) => execute(state, wire, coin));
  };
  const envelope = (statuses: unknown[]) => ({
    status: 'ok',
    response: { data: { statuses } },
  });
  return {
    order: async ({ orders }: { orders: WireOrder[] }) => {
      const statuses = [];
      for (const wire of orders) {
        try {
          statuses.push(await place(wire));
        } catch (error) {
          if (orders.length === 1) throw error;
          statuses.push({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return envelope(statuses);
    },
    cancel: async ({ cancels }: { cancels: { a: number; o: number }[] }) => {
      const statuses = [];
      for (const { a, o } of cancels) {
        const coin = await data.coinOfAsset(a);
        const removed = await store.update((state) =>
          state.orders.find((order) => order.oid === o && order.coin === coin)
            ? cancelOrder(state, o)
            : null,
        );
        statuses.push(
          removed ? { success: true } : { error: `Order ${o} not found` },
        );
      }
      return envelope(statuses);
    },
    cancelByCloid: async ({
      cloids,
    }: {
      cloids: { a: number; c: string }[];
    }) => {
      const statuses = [];
      for (const { a, c } of cloids) {
        const coin = await data.coinOfAsset(a);
        const removed = await store.update((state) => {
          const order = state.orders.find(
            (o) =>
              o.coin === coin && o.cloid?.toLowerCase() === c.toLowerCase(),
          );
          return order ? cancelOrder(state, order.oid) : null;
        });
        statuses.push(
          removed
            ? { success: true }
            : { error: `Order with cloid ${c} not found` },
        );
      }
      return envelope(statuses);
    },
    batchModify: async ({
      modifies,
    }: {
      modifies: { oid: number | string; order: WireOrder }[];
    }) => {
      const statuses = [];
      for (const { oid, order: wire } of modifies) {
        const coin = await data.coinOfAsset(wire.a);
        try {
          const modified = await store.update(async (state) => {
            const existing = state.orders.find(
              (o) =>
                o.oid === oid || (typeof oid === 'string' && o.cloid === oid),
            );
            if (!existing || existing.coin !== coin) return false;
            await execute(
              state,
              { ...wire, c: existing.cloid },
              coin,
              existing,
            );
            return true;
          });
          statuses.push(
            modified
              ? { status: 'modified' }
              : { error: `Order ${oid} not found` },
          );
        } catch (error) {
          statuses.push({
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return envelope(statuses);
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
      if (
        !Number.isSafeInteger(leverage) ||
        leverage < 1 ||
        leverage > maxLeverage
      )
        throw new AgentCliError(
          'POLICY_REJECTED',
          'Leverage exceeds market ceiling',
        );
      await store.update(async (state) => {
        await prepare(state);
        const setting = {
          type: isCross ? ('cross' as const) : ('isolated' as const),
          value: leverage,
        };
        state.leverage[coin] = setting;
        const position = positionOf(state, coin);
        if (position) position.leverage = setting;
        const used = state.positions.reduce(
          (sum, p) => sum + initialMargin(p, state.marks[p.coin]),
          0n,
        );
        if (used > accountEquity(state, state.marks))
          throw new AgentCliError(
            'INSUFFICIENT_MARGIN',
            'Leverage change exceeds available paper margin',
          );
      });
      return { status: 'ok' };
    },
  };
}
export function validateBook(book: PaperBook) {
  for (const [side, levels] of [
    ['bids', book.bids],
    ['asks', book.asks],
  ] as const) {
    let previous: bigint | undefined;
    for (const level of levels) {
      const px = parseUsdc(level.px, 18),
        size = parseUsdc(level.sz, 18);
      if (
        px <= 0n ||
        size < 0n ||
        (previous !== undefined &&
          (side === 'bids' ? px > previous : px < previous))
      )
        throw new AgentCliError(
          'UPSTREAM_ERROR',
          'Invalid or unordered paper book',
        );
      previous = px;
    }
  }
}
