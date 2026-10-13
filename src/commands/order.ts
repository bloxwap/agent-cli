import { parseUsdc, formatUsdc } from '../funding/amounts.js';
import { z } from 'zod';
import { register } from '../core/router.js';
import { commandConfig } from './read.js';
import { type Config } from '../core/config.js';
import { roundSize, roundPrice } from '../core/hlclient.js';
import { approvedBuilder, builderRate } from '../core/builder.js';
import {
  assertCanTrade,
  tradingServices,
  checkRisk,
  exchangeAction,
  type TradingServices,
} from '../core/trading.js';
import { AgentCliError } from '../errors/index.js';
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
  const state = await services.state();
  const leverage =
    state.assetPositions.find((p) => p.position.coin === input.coin)?.position
      .leverage.value ?? 1;
  await checkRisk(
    config,
    {
      coin: input.coin,
      size,
      price,
      side: input.side,
      leverage,
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
    ...(input.cloid ? { c: input.cloid } : {}),
  };
}
export async function placeOrder(
  config: Config,
  input: OrderInput,
  services?: TradingServices,
) {
  await assertCanTrade(config);
  const clients = services ?? (await tradingServices(config));
  const order = await prepareOrder(config, input, clients);
  const builder = await approvedBuilder(config);
  const result = await exchangeAction('order', () =>
    clients.exchange.order({
      orders: [order],
      grouping: 'na',
      ...(builder ? { builder } : {}),
    }),
  );
  return {
    result,
    builderFeeRate: builderRate(config),
    builderAddress: config.builder.address,
    cloid: input.cloid ?? null,
  };
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
