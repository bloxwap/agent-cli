import type { Config } from './config.js';
import { AgentCliError } from '../errors/index.js';
import { parseUsdc } from '../funding/amounts.js';
export interface RiskIntent {
  coin: string;
  size: string;
  price: string;
  side: 'buy' | 'sell';
  leverage: number;
  reduceOnly?: boolean;
}
export interface RiskState {
  positionSize: string;
  dailyLoss: string;
  openOrders: number;
  marketMaxLeverage: number;
  pendingSize?: string;
  pendingBuySize?: string;
  pendingSellSize?: string;
}
const scale = 10n ** 18n;
const decimal = (value: string) =>
  value.startsWith('-') ? -parseUsdc(value.slice(1), 18) : parseUsdc(value, 18);
const absolute = (value: bigint) => (value < 0n ? -value : value);
export function evaluateRisk(
  config: Config,
  intent: RiskIntent,
  state: RiskState,
) {
  const fail = (limit: string, actual: unknown, maximum: unknown): never => {
    throw new AgentCliError('POLICY_REJECTED', `Risk limit: ${limit}`, {
      limit,
      actual,
      maximum,
    });
  };
  if (
    config.allowedMarkets.length &&
    !config.allowedMarkets.includes(intent.coin)
  )
    fail('allowedMarkets', intent.coin, config.allowedMarkets);
  if (
    !Number.isInteger(intent.leverage) ||
    intent.leverage < 1 ||
    intent.leverage >
      Math.min(config.limits.maxLeverage ?? Infinity, state.marketMaxLeverage)
  )
    fail(
      'maxLeverage',
      intent.leverage,
      Math.min(config.limits.maxLeverage ?? Infinity, state.marketMaxLeverage),
    );
  const size = decimal(intent.size),
    price = decimal(intent.price);
  if (size <= 0n || price <= 0n)
    fail('positive size/price', intent.size, intent.price);
  const notional = (size * price) / scale;
  const signed = intent.side === 'buy' ? size : -size;
  const position = decimal(state.positionSize);
  if (
    intent.reduceOnly &&
    (position === 0n ||
      (position > 0n && signed > 0n) ||
      (position < 0n && signed < 0n))
  )
    fail('reduceOnly', intent.side, state.positionSize);
  const effective = intent.reduceOnly
    ? (position > 0n ? 1n : -1n) *
      (absolute(position) -
        (size > absolute(position) ? absolute(position) : size))
    : position + signed;
  const legacy = decimal(state.pendingSize ?? '0');
  const buys = decimal(
    state.pendingBuySize ?? (legacy > 0n ? state.pendingSize! : '0'),
  );
  const sells = decimal(
    state.pendingSellSize ?? (legacy < 0n ? state.pendingSize!.slice(1) : '0'),
  );
  const long = absolute(effective + buys),
    short = absolute(effective - sells);
  const projected = long > short ? long : short;
  const comparisons: [string, bigint, number | undefined][] = [
    ['maxOrderSize', size, config.limits.maxOrderSize],
    ['maxNotional', notional, config.limits.maxNotional],
    [
      'maxPositionNotional',
      (projected * price) / scale,
      config.limits.maxPositionNotional,
    ],
    ['dailyLoss', decimal(state.dailyLoss), config.limits.dailyLoss],
  ];
  for (const [name, actual, maximum] of comparisons)
    if (maximum !== undefined && actual > decimal(String(maximum)))
      fail(name, actual.toString(), maximum);
  if (
    config.limits.maxOpenOrders !== undefined &&
    state.openOrders >= config.limits.maxOpenOrders
  )
    fail('maxOpenOrders', state.openOrders, config.limits.maxOpenOrders);
  return { allowed: true, notional: notional.toString() };
}
