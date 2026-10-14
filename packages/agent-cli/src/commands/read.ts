import { collateralBalance } from '../core/account.js';
import { runnerHealth } from '../runner/health.js';
import { events } from '../runner/events.js';
import { activeRunner } from '../runner/lifecycle.js';
import { z } from 'zod';
import { register, type Context } from '../core/router.js';
import { loadConfig, type Config } from '../core/config.js';
import { hlInfo } from '../core/http.js';
import { pollDeposits } from '../funding/status.js';
import { parseUsdc } from '../funding/amounts.js';
import { AgentCliError } from '../errors/index.js';
import { mapHyperliquidError } from '../errors/mappers.js';
export interface AccountState {
  marginSummary: {
    accountValue: string;
    totalMarginUsed: string;
    totalNtlPos: string;
  };
  withdrawable: string;
  assetPositions: {
    position: {
      coin: string;
      szi: string;
      entryPx: string | null;
      unrealizedPnl: string;
      liquidationPx: string | null;
      leverage: { type: string; value: number };
    };
  }[];
}
export interface OpenOrder {
  coin: string;
  oid: number;
  cloid?: string;
  sz: string;
  limitPx: string;
  side: 'A' | 'B';
  reduceOnly?: boolean;
  isTrigger?: boolean;
  triggerPx?: string;
  triggerCondition?: string;
  orderType?: string;
  tif?: 'Gtc' | 'Ioc' | 'Alo';
}
export function accountBalance(state: AccountState) {
  return {
    accountValue: state.marginSummary.accountValue,
    accountValueUnits: parseUsdc(
      state.marginSummary.accountValue,
      8,
    ).toString(),
    withdrawable: state.withdrawable,
    marginUsed: state.marginSummary.totalMarginUsed,
  };
}
export function positions(state: AccountState) {
  return state.assetPositions.map(({ position: p }) => ({
    coin: p.coin,
    size: p.szi,
    entryPrice: p.entryPx,
    unrealizedPnl: p.unrealizedPnl,
    liquidationPrice: p.liquidationPx,
    leverage: String(p.leverage.value),
    marginMode: p.leverage.type,
  }));
}
export function expiryStatus(config: Config, now = Date.now()) {
  const days =
    config.agentExpiry === undefined
      ? null
      : Math.max(0, (config.agentExpiry - now) / 86400000);
  return {
    expiry: config.agentExpiry ?? null,
    daysRemaining: days === null ? null : String(days),
    warnings:
      days === null
        ? []
        : config.expiryWarningDays
            .filter((threshold) => days <= threshold)
            .map((threshold) => `Agent expires within ${threshold} days`),
  };
}
export async function readCommand(name: string, config: Config) {
  if (!config.masterAddress)
    throw new AgentCliError('AGENT_NOT_APPROVED', 'Initialize master address');
  try {
    if (name === 'orders')
      return (
        await hlInfo<OpenOrder[]>(config.network, 'frontendOpenOrders', {
          user: config.masterAddress,
        })
      ).map((order) =>
        Object.fromEntries(
          Object.entries(order).map(([key, value]) => [
            key,
            typeof value === 'number' ? String(value) : value,
          ]),
        ),
      );
    const state = await hlInfo<AccountState>(
      config.network,
      'clearinghouseState',
      { user: config.masterAddress },
    );
    if (name === 'balance') return accountBalance(state);
    if (name === 'positions') return positions(state);
    const [agents, deposits, maxBuilderFee] = await Promise.all([
      hlInfo<{ address: string; validUntil: number }[]>(
        config.network,
        'extraAgents',
        { user: config.masterAddress },
      ),
      pollDeposits(
        config.network,
        config.masterAddress,
        collateralBalance(state),
        {
          emit: activeRunner
            ? async (deposit) => {
                await events.append('deposit', {
                  id: deposit.id,
                  state: deposit.state,
                });
              }
            : undefined,
        },
      ),
      config.builder.address
        ? hlInfo<number>(config.network, 'maxBuilderFee', {
            user: config.masterAddress,
            builder: config.builder.address,
          })
        : Promise.resolve(0),
    ]);
    return {
      balance: accountBalance(state),
      positions: positions(state),
      agent: {
        address: config.agentAddress,
        approved: agents.some(
          (a) => a.address.toLowerCase() === config.agentAddress?.toLowerCase(),
        ),
        revoked: config.revoked,
        ...expiryStatus(config),
      },
      policy: {
        id: config.policyId ?? null,
        version: String(config.policyVersion ?? 0),
      },
      deposits: deposits.map((d) => ({ id: d.id, state: d.state })),
      approvedMaxBuilderFee: String(maxBuilderFee),
      runner: await runnerHealth(),
    };
  } catch (error) {
    throw mapHyperliquidError(error);
  }
}
export async function commandConfig(context: Context) {
  const config = await loadConfig(context.configPath);
  if (context.network) config.network = context.network;
  return config;
}
for (const name of ['status', 'balance', 'positions', 'orders'])
  register(name, {
    description: `Read account ${name}`,
    schema: z.object({}),
    execute: async (_input, context) =>
      readCommand(name, await commandConfig(context)),
  });
