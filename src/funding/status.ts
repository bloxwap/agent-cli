import { readDeposits, writeDeposits, type Deposit } from './store.js';
import { RelayClient, parseQuote } from './relay.js';
import { parseUsdc } from './amounts.js';
import { AgentCliError } from '../errors/index.js';
export function advanceDeposit(
  deposit: Deposit,
  relayStatus: string,
  balance: string,
) {
  if (['settled', 'failed', 'refunded'].includes(deposit.state))
    return deposit.state;
  if (relayStatus === 'failure' || relayStatus === 'failed')
    return 'failed' as const;
  if (relayStatus === 'refunded') return 'refunded' as const;
  const quote = parseQuote(deposit.quote);
  const needed =
    quote.receivedDecimals <= 8
      ? BigInt(quote.expectedReceived) *
        10n ** BigInt(8 - quote.receivedDecimals)
      : BigInt(quote.expectedReceived) /
        10n ** BigInt(quote.receivedDecimals - 8);
  if (
    relayStatus === 'success' &&
    parseUsdc(balance, 8) >= parseUsdc(deposit.baseline, 8) + needed
  )
    return 'settled' as const;
  if (
    ['success', 'pending', 'deposit-confirmed', 'waiting'].includes(relayStatus)
  )
    return 'pending' as const;
  return deposit.state;
}
export async function pollDeposits(
  network: Deposit['network'],
  recipient: string,
  balance: string,
  options: {
    path?: string;
    relay?: RelayClient;
    emit?: (deposit: Deposit) => Promise<void>;
  } = {},
) {
  const deposits = await readDeposits(options.path);
  let changed = false;
  for (const deposit of deposits.filter(
    (d) =>
      d.network === network &&
      d.recipient.toLowerCase() === recipient.toLowerCase(),
  )) {
    if (['settled', 'failed', 'refunded'].includes(deposit.state)) continue;
    const status = await (
      options.relay ??
      new RelayClient(
        network === 'testnet'
          ? 'https://api.testnets.relay.link'
          : 'https://api.relay.link',
      )
    ).status(deposit.id);
    const next = advanceDeposit(deposit, status.status, balance);
    if (next !== deposit.state) {
      deposit.state = next;
      changed = true;
      await options.emit?.(deposit);
    }
  }
  if (changed) await writeDeposits(deposits, options.path);
  return deposits.filter(
    (d) =>
      d.network === network &&
      d.recipient.toLowerCase() === recipient.toLowerCase(),
  );
}
export async function assertDepositsSettled(
  network: Deposit['network'],
  recipient: string,
  path?: string,
) {
  const pending = (await readDeposits(path)).filter(
    (d) =>
      d.network === network &&
      d.recipient.toLowerCase() === recipient.toLowerCase() &&
      ['awaiting_funds', 'pending'].includes(d.state),
  );
  if (pending.length)
    throw new AgentCliError('DEPOSIT_PENDING', 'Wait for deposit settlement', {
      depositIds: pending.map((d) => d.id),
    });
}
