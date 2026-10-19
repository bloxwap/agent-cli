import { z } from 'zod';
import { register } from '../core/router.js';
import { loadConfig, atomicWrite, type Config } from '../core/config.js';
import { paperDataNetwork } from '../core/mode.js';
import { PaperStore } from '../paper/store.js';
import {
  paperAccountState,
  paperData,
  type PaperData,
} from '../paper/services.js';
import {
  accountEquity,
  liquidationPx,
  rolloverDay,
} from '../paper/simulator.js';
import { formatUsdc, parseUsdc } from '../funding/amounts.js';
import { AgentCliError } from '../errors/index.js';
import { paperEvents } from '../runner/events.js';
export async function paperSummary(
  store: PaperStore,
  data: PaperData = paperData(),
) {
  const [state, marks] = await Promise.all([store.load(), data.marks()]);
  rolloverDay(state, marks, Date.now());
  const maxLeverageOf = async (coin: string) => data.maxLeverageOf(coin);
  const resolved = new Map<string, number>();
  for (const coin of new Set(state.positions.map((p) => p.coin)))
    resolved.set(coin, await maxLeverageOf(coin));
  const equity = accountEquity(state, marks);
  const account = paperAccountState(state, marks, (coin) => resolved.get(coin) ?? 1);
  const unrealized = account.assetPositions.reduce(
    (sum, p) => sum + parseUsdc(p.position.unrealizedPnl, 18),
    0n,
  );
  return {
    paper: true,
    mode: 'paper' as const,
    dataNetwork: paperDataNetwork,
    startingBalance: state.startingBalance,
    balance: state.balance,
    equity: formatUsdc(equity, 18),
    netPnl: formatUsdc(equity - parseUsdc(state.startingBalance, 18), 18),
    realizedPnl: state.realizedPnl,
    unrealizedPnl: formatUsdc(unrealized, 18),
    feesPaid: state.feesPaid,
    fundingPaid: state.fundingPaid,
    trades: state.trades.length,
    liquidations: state.liquidations,
    openOrders: state.orders.length,
    positions: account.assetPositions.map(({ position: p }) => ({
      coin: p.coin,
      size: p.szi,
      entryPrice: p.entryPx,
      markPrice: marks[p.coin] ?? null,
      unrealizedPnl: p.unrealizedPnl,
      liquidationPrice: liquidationPx(
        state.positions.find((position) => position.coin === p.coin)!,
        resolved.get(p.coin) ?? 1,
      ),
      leverage: String(p.leverage.value),
      marginMode: p.leverage.type,
    })),
  };
}
register('paper', {
  description: 'Reset or summarize the local paper trading account',
  schema: z.object({
    args: z.array(z.string()).default([]),
    yes: z.boolean().default(false),
    balance: z.number().positive().optional(),
  }),
  execute: async (input, context) => {
    const [action = 'summary'] = input.args as string[];
    const config: Config = await loadConfig(context.configPath);
    if (context.paper !== undefined)
      config.mode = context.paper ? 'paper' : 'live';
    const store = new PaperStore();
    if (action === 'reset') {
      if (!input.yes)
        throw new AgentCliError(
          'CONFIG_INVALID',
          'paper reset clears all paper state; re-run with --yes to confirm',
        );
      const starting = (input.balance as number | undefined) ?? config.paper.startingBalance;
      await store.reset(starting);
      await atomicWrite(paperEvents.path, '');
      return {
        paper: true,
        mode: 'paper' as const,
        reset: true,
        startingBalance: String(starting),
      };
    }
    if (action !== 'summary')
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Use paper summary or paper reset',
      );
    return paperSummary(store);
  },
});
