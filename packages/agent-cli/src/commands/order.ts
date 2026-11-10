import { parseUsdc, formatUsdc } from '../funding/amounts.js';
import { z } from 'zod';
import { register } from '../core/router.js';
import { commandConfig } from './read.js';
import { type Config } from '../core/config.js';
import { roundSize, roundPrice } from '../core/hlclient.js';
import { approvedBuilder, builderRate } from '../core/builder.js';
import {
  assertCanTrade,
  servicesForMode,
  checkRisk,
  exchangeAction,
  withTradeLock,
  type TradingServices,
} from '../core/trading.js';
import { AgentCliError } from '../errors/index.js';
import { newCloid } from '../core/idempotency.js';
export const orderSchema = z.object({
  coin: z.string(),
  side: z.enum(['buy', 'sell']),
  size: z.string(),
  price: z.string().optional(),
  type: z.enum(['limit', 'market', 'tp', 'sl']).default('limit'),
  tif: z.enum(['Gtc', 'Ioc', 'Alo']).default('Gtc'),
  reduceOnly: z.boolean().default(false),
  cloid: z
    .string()
    .regex(/^0x[0-9a-fA-F]{32}$/)
    .optional(),
  triggerPrice: z.string().optional(),
  slippage: z.number().min(0).max(0.1).default(0.01),
  intent: z.string().optional(),
});
export type OrderInput = z.infer<typeof orderSchema>;
export async function prepareOrder(
  config: Config,
  input: OrderInput,
  services: TradingServices,
) {
  const market = await services.market(input.coin);
  const size = roundSize(input.size, market.szDecimals);
  let price = input.price;
  if (
    input.type === 'market' ||
    ((input.type === 'tp' || input.type === 'sl') && !price)
  ) {
    const mid = (await services.mids())[input.coin];
    if (!mid) throw new AgentCliError('UNKNOWN_MARKET', 'Missing market price');
    price = boundedMarketPrice(
      mid,
      input.slippage,
      input.side,
      market.szDecimals,
    );
  }
  if (!price) throw new AgentCliError('INVALID_PRICE', 'Provide limit price');
  price = roundPrice(price, market.szDecimals);
  await checkRisk(
    config,
    {
      coin: input.coin,
      size,
      price,
      side: input.side,
      leverage: 1,
      reduceOnly: input.reduceOnly,
    },
    services,
  );
  let type: unknown = {
    limit: { tif: input.type === 'market' ? 'Ioc' : input.tif },
  };
  if (input.type === 'tp' || input.type === 'sl') {
    if (!input.triggerPrice)
      throw new AgentCliError('INVALID_PRICE', 'Trigger price required');
    type = {
      trigger: {
        isMarket: !input.price,
        triggerPx: roundPrice(input.triggerPrice, market.szDecimals),
        tpsl: input.type,
      },
    };
  }
  return {
    a: market.asset,
    b: input.side === 'buy',
    p: price,
    s: size,
    r: input.reduceOnly,
    t: type,
    c: input.cloid,
  };
}
function annotate(error: unknown, cloid: string): AgentCliError {
  if (error instanceof AgentCliError) {
    const details =
      error.details && typeof error.details === 'object' && !Array.isArray(error.details)
        ? { ...(error.details as Record<string, unknown>), cloid }
        : { cloid };
    return new AgentCliError(error.code, error.message, details, error.retryable);
  }
  return new AgentCliError(
    'INTERNAL',
    error instanceof Error ? error.message : String(error),
    { cloid },
  );
}
export async function placeOrder(
  config: Config,
  input: OrderInput,
  services?: TradingServices,
) {
  const cloid = input.cloid ?? newCloid();
  const orderInput = { ...input, cloid };
  try {
    return await withTradeLock(config, async () => {
      await assertCanTrade(config, { reduceOnly: orderInput.reduceOnly });
      const clients = services ?? (await servicesForMode(config));
      const existing = await clients.orderByCloid(cloid);
      const builder =
        config.builder.fee === 0
          ? undefined
          : config.mode === 'paper'
            ? { b: config.builder.address.toLowerCase(), f: config.builder.fee }
            : await approvedBuilder(config);
      if (existing)
        return {
          result: existing,
          builderFeeRate: builderRate(config),
          builderAddress: config.builder.address,
          cloid,
          idempotent: true,
        };
      const order = await prepareOrder(config, orderInput, clients);
      const result = await exchangeAction(
        'order',
        () =>
          clients.exchange.order({
            orders: [order],
            grouping: 'na',
            ...(builder ? { builder } : {}),
          }),
        cloid,
      );
      return {
        result,
        builderFeeRate: builderRate(config),
        builderAddress: config.builder.address,
        cloid,
        idempotent: false,
      };
    });
  } catch (error) {
    throw annotate(error, cloid);
  }
}
register('order', {
  description: 'Place limit, IOC market or TP/SL order',
  schema: orderSchema,
  execute: async (input, context) =>
    placeOrder(await commandConfig(context), input as OrderInput),
});

export function boundedMarketPrice(
  mid: string,
  slippage: number,
  side: 'buy' | 'sell',
  szDecimals: number,
) {
  const units = parseUsdc(mid, 18);
  const ratio = BigInt(Math.round(slippage * 1e9));
  const bound =
    (units * (side === 'buy' ? 1000000000n + ratio : 1000000000n - ratio)) /
    1000000000n;
  const rounded = roundPrice(formatUsdc(bound, 18), szDecimals);
  if (side === 'buy' || parseUsdc(rounded, 18) >= bound) return rounded;
  const precision = Math.max(
    0,
    Math.min(
      6 - szDecimals,
      4 - Math.floor(Math.log10(Number(formatUsdc(bound, 18)))),
    ),
  );
  const tick = 10n ** BigInt(18 - precision);
  return formatUsdc(parseUsdc(rounded, 18) + tick, 18);
}
