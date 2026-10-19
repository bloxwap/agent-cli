import { z } from 'zod';
import { register } from '../core/router.js';
import { commandConfig } from './read.js';
import type { Config } from '../core/config.js';
import {
  assertCanTrade,
  servicesForMode,
  checkRisk,
  exchangeAction,
  type TradingServices,
} from '../core/trading.js';
import { roundSize, roundPrice } from '../core/hlclient.js';
import { AgentCliError } from '../errors/index.js';
const modification = z.object({
  oid: z.number().int().positive().optional(),
  cloid: z
    .string()
    .regex(/^0x[0-9a-fA-F]{32}$/)
    .optional(),
  size: z.string().optional(),
  price: z.string().optional(),
});
export const modifySchema = modification.extend({
  modifications: z.array(modification).optional(),
  intent: z.string().optional(),
});
export async function modifyOrders(
  config: Config,
  input: z.infer<typeof modifySchema>,
  services?: TradingServices,
) {
  await assertCanTrade(config);
  const clients = services ?? (await servicesForMode(config));
  const orders = await clients.orders();
  const staged = [...orders];
  const stagedServices = { ...clients, orders: async () => staged };
  const requests = input.modifications ?? [input];
  const modifies: Record<string, unknown>[] = [];
  for (const request of requests) {
    if (!request.oid && !request.cloid)
      throw new AgentCliError('CONFIG_INVALID', 'Specify oid or cloid');
    const original = orders.find((o) =>
      request.oid ? o.oid === request.oid : o.cloid === request.cloid,
    );
    if (!original)
      throw new AgentCliError('ORDER_NOT_FOUND', 'Resting order absent');
    if (
      original.isTrigger &&
      (!original.triggerPx ||
        !/take profit|stop/i.test(original.orderType ?? ''))
    )
      throw new AgentCliError(
        'UPSTREAM_ERROR',
        'Trigger order metadata incomplete',
      );
    const market = await clients.market(original.coin);
    const size = roundSize(request.size ?? original.sz, market.szDecimals);
    const price = roundPrice(
      request.price ?? original.limitPx,
      market.szDecimals,
    );
    const state = await clients.state();
    const leverage =
      state.assetPositions.find((p) => p.position.coin === original.coin)
        ?.position.leverage.value ?? 1;
    await checkRisk(
      config,
      {
        coin: original.coin,
        size,
        price,
        side: original.side === 'B' ? 'buy' : 'sell',
        leverage,
        reduceOnly: original.reduceOnly,
      },
      stagedServices,
      original.oid,
    );
    const index = staged.findIndex((order) => order.oid === original.oid);
    staged[index] = { ...original, sz: size, limitPx: price };
    modifies.push({
      oid: request.cloid ?? original.oid,
      order: {
        a: market.asset,
        b: original.side === 'B',
        p: price,
        s: size,
        r: original.reduceOnly ?? false,
        t: original.isTrigger
          ? {
              trigger: {
                triggerPx: roundPrice(original.triggerPx!, market.szDecimals),
                isMarket: /market/i.test(original.orderType!),
                tpsl: /take profit/i.test(original.orderType!) ? 'tp' : 'sl',
              },
            }
          : { limit: { tif: original.tif ?? 'Gtc' } },
        ...(original.cloid ? { c: original.cloid } : {}),
      },
    });
  }
  return exchangeAction('batchModify', () =>
    clients.exchange.batchModify({ modifies }),
  );
}
register('modify', {
  description: 'Modify price/size of single or batch resting orders',
  schema: modifySchema,
  execute: async (input, context) =>
    modifyOrders(
      await commandConfig(context),
      input as z.infer<typeof modifySchema>,
    ),
});
