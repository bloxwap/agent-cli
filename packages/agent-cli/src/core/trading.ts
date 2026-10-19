import { parseUsdc, formatUsdc } from '../funding/amounts.js';
import { decisionAudit } from './audit.js';
import { assertAgentValid } from '../wallet/expiry.js';
import { activeRunner } from '../runner/lifecycle.js';
import { type Config } from './config.js';
import {
  createClients,
  type ExchangeAdapter,
  type Market,
} from './hlclient.js';
import { privyClient, privySigner } from '../wallet/privy.js';
import { nextNonce } from './nonce.js';
import { hlInfo } from './http.js';
import { type AccountState, type OpenOrder } from '../commands/read.js';
import { AgentCliError } from '../errors/index.js';
import { assertDepositsSettled } from '../funding/status.js';
import { assertTradeAction } from '../wallet/policy.js';
import { mapHyperliquidError } from '../errors/mappers.js';
import { evaluateRisk, type RiskIntent } from './risk.js';
import { Logger } from './logger.js';
import { PaperStore } from '../paper/store.js';
import { paperTradingServices } from '../paper/services.js';
export interface TradingServices {
  exchange: ExchangeAdapter;
  market: (coin: string) => Promise<Market>;
  state: () => Promise<AccountState>;
  orders: () => Promise<OpenOrder[]>;
  mids: () => Promise<Record<string, string>>;
  dailyLoss?: () => Promise<string>;
}
export async function tradingServices(
  config: Config,
): Promise<TradingServices> {
  const signer =
    activeRunner?.signer ??
    (await privySigner(config, await privyClient(config)));
  const clients = createClients(config.network, signer, () =>
    nextNonce(signer.address),
  );
  return {
    exchange: clients.exchange!,
    market: (coin) => clients.meta.lookup(coin),
    state: () =>
      hlInfo(config.network, 'clearinghouseState', {
        user: config.masterAddress,
      }),
    orders: () =>
      hlInfo(config.network, 'frontendOpenOrders', {
        user: config.masterAddress,
      }),
    mids: () => hlInfo(config.network, 'allMids'),
    dailyLoss: async () =>
      dailyLossFromPortfolio(
        await hlInfo(config.network, 'portfolio', {
          user: config.masterAddress,
        }),
      ),
  };
}
export async function assertCanTrade(config: Config) {
  if (config.mode === 'paper') return; // simulation: no approval, deposit or session gate
  if (config.revoked || !config.approved || !config.masterAddress)
    throw new AgentCliError('AGENT_NOT_APPROVED', 'Agent approval required');
  assertAgentValid(config);
  await assertDepositsSettled(config.network, config.masterAddress);
}
export function assertLiveMode(config: Config, command: string) {
  if (config.mode === 'paper')
    throw new AgentCliError(
      'CONFIG_INVALID',
      `${command} requires live mode; paper mode never signs or moves funds`,
    );
}
export async function servicesForMode(
  config: Config,
): Promise<TradingServices> {
  return config.mode === 'paper'
    ? paperTradingServices(config, new PaperStore())
    : tradingServices(config);
}
export async function checkRisk(
  config: Config,
  intent: RiskIntent,
  services: TradingServices,
  ignoreOid?: number,
) {
  const [market, state, orders] = await Promise.all([
    services.market(intent.coin),
    services.state(),
    services.orders(),
  ]);
  const position = state.assetPositions.find(
    (p) => p.position.coin === intent.coin,
  )?.position;
  const open = orders.filter((o) => o.oid !== ignoreOid);
  const pending = open.filter((o) => o.coin === intent.coin && !o.reduceOnly);
  const buys = pending
      .filter((o) => o.side === 'B')
      .reduce((sum, o) => sum + parseUsdc(o.sz, 18), 0n),
    sells = pending
      .filter((o) => o.side === 'A')
      .reduce((sum, o) => sum + parseUsdc(o.sz, 18), 0n);
  const loss =
    config.limits.dailyLoss !== undefined
      ? await requiredDailyLoss(services)
      : '0';
  const logger = new Logger({ level: config.logLevel });
  try {
    return evaluateRisk(config, intent, {
      positionSize: position?.szi ?? '0',
      dailyLoss: loss,
      openOrders: open.length,
      marketMaxLeverage: market.maxLeverage,
      pendingBuySize: formatUsdc(buys, 18),
      pendingSellSize: formatUsdc(sells, 18),
    });
  } catch (error) {
    logger.log('warn', 'Risk rejected', {
      error: mapHyperliquidError(error).toJSON(),
    });
    await logger.flush();
    throw error;
  }
}
export async function exchangeAction(
  action: string,
  operation: () => Promise<unknown>,
) {
  assertTradeAction(action);
  await decisionAudit({ allowed: true, action });
  try {
    const response = await operation();
    const data = response as {
      status?: string;
      response?: { data?: { statuses?: unknown[] } };
    };
    if (data.status === 'err') throw mapHyperliquidError(response);
    for (const status of data.response?.data?.statuses ?? [])
      if (status && typeof status === 'object' && 'error' in status)
        throw mapHyperliquidError((status as { error: string }).error);
    return response;
  } catch (error) {
    throw mapHyperliquidError(error);
  }
}

export function dailyLossFromPortfolio(
  portfolio: [string, { pnlHistory: [number, string][] }][],
  now = Date.now(),
) {
  const history = portfolio.find(([period]) => period === 'day')?.[1]
    .pnlHistory;
  if (!history?.length)
    throw new AgentCliError(
      'POLICY_REJECTED',
      'Daily loss history unavailable',
    );
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  const initial =
    [...history].reverse().find(([time]) => time <= midnight.getTime()) ??
    history[0];
  const last = history.at(-1)!;
  const signed = (value: string) =>
    value.startsWith('-') ? -parseUsdc(value.slice(1), 8) : parseUsdc(value, 8);
  const pnl = signed(last[1]) - signed(initial[1]);
  return formatUsdc(pnl < 0n ? -pnl : 0n, 8);
}
export async function requiredDailyLoss(services: TradingServices) {
  if (!services.dailyLoss)
    throw new AgentCliError('POLICY_REJECTED', 'Daily loss check unavailable');
  return services.dailyLoss();
}
