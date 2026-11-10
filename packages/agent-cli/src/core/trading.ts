import { join } from 'node:path';
import { parseUsdc, formatUsdc } from '../funding/amounts.js';
import { decisionAudit } from './audit.js';
import { assertAgentValid } from '../wallet/expiry.js';
import { activeRunner } from '../runner/lifecycle.js';
import { stateDir, type Config } from './config.js';
import {
  createClients,
  type ExchangeAdapter,
  type Market,
} from './hlclient.js';
import { openSigner } from '../wallet/signer.js';
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
import { paperDir } from './mode.js';
import { withFileLock } from './lock.js';
export interface TradingServices {
  exchange: ExchangeAdapter;
  market: (coin: string) => Promise<Market>;
  state: () => Promise<AccountState>;
  orders: () => Promise<OpenOrder[]>;
  mids: () => Promise<Record<string, string>>;
  dailyLoss?: () => Promise<string>;
  assetLeverage: (coin: string) => Promise<number>;
  orderByCloid: (cloid: string) => Promise<unknown | null>;
}
export async function tradingServices(
  config: Config,
): Promise<TradingServices> {
  const signer = activeRunner?.signer ?? (await openSigner(config));
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
    assetLeverage: (coin) => accountLeverage(config, coin),
    orderByCloid: (cloid) => lookupOrderByCloid(config, cloid),
  };
}
export function assertApprovedNetwork(config: Config) {
  if (config.mode === 'paper') return;
  if (!config.approvedNetwork)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Agent approval is not bound to a network; run init again on the intended network',
    );
  if (config.network !== config.approvedNetwork)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Network does not match the approved network',
      { network: config.network, approvedNetwork: config.approvedNetwork },
    );
}
export async function assertCanTrade(
  config: Config,
  options: { reduceOnly?: boolean; cancel?: boolean } = {},
) {
  if (config.mode === 'paper') return; // simulation: no approval, deposit or session gate
  if (config.revoked || !config.approved || !config.masterAddress)
    throw new AgentCliError('AGENT_NOT_APPROVED', 'Agent approval required');
  assertAgentValid(config);
  assertApprovedNetwork(config);
  if (!options.reduceOnly && !options.cancel)
    await assertDepositsSettled(config.network, config.masterAddress);
}
export function tradeLockPath(config: Config) {
  const account = (config.masterAddress ?? 'default').toLowerCase();
  return config.mode === 'paper'
    ? join(paperDir(), 'locks', `trade-${account}.lock`)
    : join(stateDir(), 'locks', `trade-${config.network}-${account}.lock`);
}
export function withTradeLock<T>(config: Config, operation: () => Promise<T>) {
  return withFileLock(tradeLockPath(config), operation);
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
  const [market, state, orders, leverage] = await Promise.all([
    services.market(intent.coin),
    services.state(),
    services.orders(),
    accountLeverageFrom(services, intent.coin),
  ]);
  intent = { ...intent, leverage };
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
function detailRecord(details: unknown): Record<string, unknown> {
  return details && typeof details === 'object' && !Array.isArray(details)
    ? { ...(details as Record<string, unknown>) }
    : {};
}
export function asUnknownMutation(error: unknown, cloid?: string) {
  const mapped = mapHyperliquidError(error);
  const details = {
    ...detailRecord(mapped.details),
    ...(cloid ? { cloid } : {}),
  };
  if (mapped.code !== 'NETWORK_ERROR')
    return new AgentCliError(mapped.code, mapped.message, details, mapped.retryable);
  return new AgentCliError(
    'NETWORK_ERROR',
    mapped.message,
    { ...details, outcome: 'unknown' },
    false,
  );
}
export async function exchangeAction(
  action: string,
  operation: () => Promise<unknown>,
  cloid?: string,
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
    throw asUnknownMutation(error, cloid);
  }
}
async function accountLeverage(config: Config, coin: string) {
  if (!config.masterAddress)
    throw new AgentCliError(
      'POLICY_REJECTED',
      'Account leverage unavailable',
      { limit: 'maxLeverage', coin },
    );
  const data = await hlInfo<{ leverage?: { value?: unknown } }>(
    config.network,
    'activeAssetData',
    { user: config.masterAddress, coin },
  );
  return requireLeverage(data?.leverage?.value, coin);
}
async function lookupOrderByCloid(config: Config, cloid: string) {
  if (!config.masterAddress)
    throw new AgentCliError('AGENT_NOT_APPROVED', 'Master address required');
  const status = await hlInfo<{ status?: string; order?: unknown }>(
    config.network,
    'orderStatus',
    { user: config.masterAddress, oid: cloid },
  );
  if (!status || status.status === 'unknownOid') return null;
  return {
    status: 'ok',
    response: { type: 'order', data: { statuses: [status.order ?? status] } },
  };
}
function requireLeverage(value: unknown, coin: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
    throw new AgentCliError('POLICY_REJECTED', 'Account leverage unavailable', {
      limit: 'maxLeverage',
      coin,
      actual: value ?? null,
    });
  return value;
}
async function accountLeverageFrom(services: TradingServices, coin: string) {
  if (!services.assetLeverage)
    throw new AgentCliError('POLICY_REJECTED', 'Account leverage unavailable', {
      limit: 'maxLeverage',
      coin,
    });
  try {
    return requireLeverage(await services.assetLeverage(coin), coin);
  } catch (error) {
    if (error instanceof AgentCliError) throw error;
    throw new AgentCliError('POLICY_REJECTED', 'Account leverage unavailable', {
      limit: 'maxLeverage',
      coin,
    });
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
