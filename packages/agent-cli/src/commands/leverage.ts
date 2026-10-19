import { z } from 'zod';
import { register } from '../core/router.js';
import { commandConfig } from './read.js';
import type { Config } from '../core/config.js';
import {
  assertCanTrade,
  servicesForMode,
  exchangeAction,
  requiredDailyLoss,
  type TradingServices,
} from '../core/trading.js';
import { parseUsdc } from '../funding/amounts.js';
import { AgentCliError } from '../errors/index.js';
export const leverageSchema = z.object({
  coin: z.string(),
  leverage: z.number().int().positive(),
  mode: z.enum(['cross', 'isolated']).default('cross'),
  intent: z.string().optional(),
});
export async function setLeverage(
  config: Config,
  input: z.infer<typeof leverageSchema>,
  services?: TradingServices,
) {
  await assertCanTrade(config);
  const clients = services ?? (await servicesForMode(config));
  const market = await clients.market(input.coin);
  if (
    (config.allowedMarkets.length &&
      !config.allowedMarkets.includes(input.coin)) ||
    input.leverage >
      Math.min(market.maxLeverage, config.limits.maxLeverage ?? Infinity)
  )
    throw new AgentCliError(
      'POLICY_REJECTED',
      'Leverage or market exceeds configured limits',
    );
  if (
    config.limits.dailyLoss !== undefined &&
    parseUsdc(await requiredDailyLoss(clients), 8) >
      parseUsdc(String(config.limits.dailyLoss), 8)
  )
    throw new AgentCliError('POLICY_REJECTED', 'Daily loss cap exceeded');
  return exchangeAction('updateLeverage', () =>
    clients.exchange.updateLeverage({
      asset: market.asset,
      isCross: input.mode === 'cross',
      leverage: input.leverage,
    }),
  );
}
register('leverage', {
  description: 'Set market leverage and cross/isolated margin mode',
  schema: leverageSchema,
  execute: async (input, context) =>
    setLeverage(
      await commandConfig(context),
      input as z.infer<typeof leverageSchema>,
    ),
});
