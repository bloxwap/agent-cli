import { z } from 'zod';
import { register } from '../core/router.js';
import { createClients } from '../core/hlclient.js';
import { hlInfo } from '../core/http.js';
import { commandConfig } from './read.js';
import { AgentCliError } from '../errors/index.js';
import { mapHyperliquidError } from '../errors/mappers.js';
register('market', {
  description:
    'Discover market asset, precision, leverage ceiling and current mid',
  schema: z.object({ coin: z.string() }),
  execute: async (input, context) => {
    const config = await commandConfig(context);
    try {
      const [market, mids] = await Promise.all([
        createClients(config.network).meta.lookup(input.coin as string),
        hlInfo<Record<string, string>>(config.network, 'allMids'),
      ]);
      const mid = mids[market.name];
      if (!mid)
        throw new AgentCliError('UNKNOWN_MARKET', 'Market has no mid price');
      return {
        coin: market.name,
        asset: String(market.asset),
        szDecimals: String(market.szDecimals),
        maxLeverage: String(market.maxLeverage),
        mid,
      };
    } catch (error) {
      throw mapHyperliquidError(error);
    }
  },
});
