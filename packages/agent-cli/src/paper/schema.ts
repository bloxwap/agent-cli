import { z } from 'zod';
import { parseUsdc } from '../funding/amounts.js';
const decimal = z.string().regex(/^-?\d+(\.\d{1,18})?$/);
const positive = decimal.refine((v) => parseUsdc(v, 18) > 0n);
const nonnegative = decimal.refine((v) => parseUsdc(v, 18) >= 0n);
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const leverage = z.object({
  type: z.enum(['cross', 'isolated']),
  value: id.max(1000),
});
const cloid = z.string().regex(/^0x[0-9a-f]{32}$/i);
export const paperTradeSchema = z.object({
  tid: id,
  time,
  coin: z.string().min(1),
  side: z.enum(['B', 'A']),
  sz: positive,
  px: positive,
  oid: id.optional(),
  cloid: cloid.optional(),
  fee: nonnegative,
  feeRate: nonnegative,
  taker: z.boolean(),
  liquidation: z.boolean().optional(),
  realizedPnl: decimal.optional(),
});
export const paperOrderSchema = z
  .object({
    oid: id,
    coin: z.string().min(1),
    side: z.enum(['B', 'A']),
    sz: positive,
    filledSz: nonnegative,
    limitPx: positive,
    reduceOnly: z.boolean(),
    tif: z.enum(['Gtc', 'Ioc', 'Alo']),
    cloid: cloid.optional(),
    isTrigger: z.boolean().optional(),
    triggerPx: positive.optional(),
    tpsl: z.enum(['tp', 'sl']).optional(),
    triggerIsMarket: z.boolean().optional(),
    placedAt: time,
  })
  .refine(
    (o) =>
      parseUsdc(o.filledSz, 18) <= parseUsdc(o.sz, 18) &&
      (!o.isTrigger || !!(o.triggerPx && o.tpsl)),
    'Invalid order state',
  );
export const paperOrderResultSchema = z.object({
  cloid,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  result: z.unknown().refine((value) => value !== undefined),
});
export const paperStateSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.string().min(1),
    createdAt: time,
    startingBalance: positive,
    balance: decimal,
    positions: z.array(
      z.object({
        coin: z.string().min(1),
        size: decimal.refine((v) => parseUsdc(v, 18) !== 0n),
        entryPx: positive,
        leverage,
      }),
    ),
    orders: z.array(paperOrderSchema),
    leverage: z.record(z.string(), leverage),
    nextOid: id,
    nextTid: id,
    feesPaid: nonnegative,
    fundingPaid: decimal,
    realizedPnl: decimal,
    trades: z.array(paperTradeSchema),
    liquidations: z.number().int().nonnegative(),
    lastFundingAt: time,
    dayStartEquity: decimal,
    dayStartAt: time,
    marketAt: time.default(0),
    dayBaselineValid: z.boolean().default(false),
    marks: z.record(z.string(), positive).default({}),
    fundingRates: z.record(z.string(), decimal).default({}),
    orderResults: z.array(paperOrderResultSchema).default([]),
    outbox: z
      .array(
        z.object({
          eventId: z.string(),
          type: z.enum(['fill', 'order_update', 'position_change', 'error']),
          data: z.record(z.string(), z.unknown()),
          trade: paperTradeSchema.optional(),
        }),
      )
      .default([]),
  })
  .superRefine((state, ctx) => {
    if (
      parseUsdc(state.balance, 18) !==
      parseUsdc(state.startingBalance, 18) +
        parseUsdc(state.realizedPnl, 18) +
        parseUsdc(state.fundingPaid, 18) -
        parseUsdc(state.feesPaid, 18)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Paper balance does not reconcile to realized PnL, funding and fees',
      });
    const unique = (values: (string | number)[]) =>
      new Set(values).size === values.length;
    if (
      !unique(state.positions.map((p) => p.coin)) ||
      !unique(state.orders.map((o) => o.oid)) ||
      !unique(state.trades.map((t) => t.tid)) ||
      state.orders.some((o) => o.oid >= state.nextOid) ||
      state.trades.some((t) => t.tid >= state.nextTid) ||
      !unique(
        state.orders.flatMap((o) => (o.cloid ? [o.cloid.toLowerCase()] : [])),
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Duplicate identities or invalid paper counters',
      });
  });
