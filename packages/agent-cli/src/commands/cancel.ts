import { z } from 'zod';
import { register } from '../core/router.js';
import { commandConfig } from './read.js';
import type { Config } from '../core/config.js';
import {
  assertCanTrade,
  tradingServices,
  exchangeAction,
  type TradingServices,
} from '../core/trading.js';
import { AgentCliError } from '../errors/index.js';
export const cancelSchema = z.object({
  oid: z.number().int().positive().optional(),
  oids: z.array(z.number().int().positive()).optional(),
  cloid: z.string().optional(),
  cloids: z.array(z.string()).optional(),
  coin: z.string().optional(),
  all: z.boolean().default(false),
  intent: z.string().optional(),
});
export async function cancelOrders(
  config: Config,
  input: z.infer<typeof cancelSchema>,
  services?: TradingServices,
) {
  await assertCanTrade(config);
  const clients = services ?? (await tradingServices(config));
  const orders = await clients.orders();
  const oids = input.oids ?? (input.oid ? [input.oid] : []),
    cloids = input.cloids ?? (input.cloid ? [input.cloid] : []);
  if (!input.all && !input.coin && !oids.length && !cloids.length)
    throw new AgentCliError('CONFIG_INVALID', 'Select oid, cloid, coin or all');
  for (const oid of oids)
    if (!orders.some((o) => o.oid === oid))
      throw new AgentCliError('ORDER_NOT_FOUND', `Order ${oid} absent`);
  for (const cloid of cloids)
    if (!orders.some((o) => o.cloid === cloid))
      throw new AgentCliError('ORDER_NOT_FOUND', `Order ${cloid} absent`);
  const selected = orders.filter(
    (o) =>
      (!input.coin || o.coin === input.coin) &&
      (input.all ||
        (input.coin && !oids.length && !cloids.length) ||
        oids.includes(o.oid) ||
        (!!o.cloid && cloids.includes(o.cloid))),
  );
  const cancels = await Promise.all(
    selected.map(async (o) => ({
      a: (await clients.market(o.coin)).asset,
      o: o.oid,
    })),
  );
  if (!cancels.length) return { cancelled: [], result: null };
  return {
    cancelled: selected.map((o) => String(o.oid)),
    result: await exchangeAction('cancel', () =>
      clients.exchange.cancel({ cancels }),
    ),
  };
}
register('cancel', {
  description: 'Cancel by oid/cloid, coin or all',
  schema: cancelSchema,
  execute: async (input, context) =>
    cancelOrders(
      await commandConfig(context),
      input as z.infer<typeof cancelSchema>,
    ),
});
