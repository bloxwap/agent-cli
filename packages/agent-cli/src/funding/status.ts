import {
  readDeposits,
  updateDeposits,
  type Deposit,
  type DepositState,
} from './store.js';
import { RelayClient, parseQuote } from './relay.js';
import { parseUsdc } from './amounts.js';
import { AgentCliError } from '../errors/index.js';
import { hlInfo } from '../core/http.js';

// A quote that nobody funded stays blocking only until this grace after
// expiresAt. In-flight Relay states are not expired.
export const DEPOSIT_EXPIRY_GRACE_MS = 15 * 60 * 1000;
const terminal = new Set<DepositState>([
  'settled',
  'failed',
  'refunded',
  'expired',
  'abandoned',
]);
const started = new Set([
  'success',
  'pending',
  'deposit-confirmed',
  'deposit_confirmed',
  'submitted',
  'failure',
  'failed',
  'refunded',
]);
export function isTerminalDeposit(state: DepositState) {
  return terminal.has(state);
}
export interface LedgerUpdate {
  time: number;
  hash?: string;
  delta?: { type?: string; usdc?: string };
}
function expectedUnits(deposit: Deposit) {
  const quote = parseQuote(deposit.quote);
  return quote.receivedDecimals <= 8
    ? BigInt(quote.expectedReceived) * 10n ** BigInt(8 - quote.receivedDecimals)
    : BigInt(quote.expectedReceived) /
        10n ** BigInt(quote.receivedDecimals - 8);
}
export function matchLedgerDeposit(
  deposit: Deposit,
  updates: LedgerUpdate[],
  used: Set<string>,
) {
  const expected = expectedUnits(deposit);
  if (expected <= 0n) return null;
  for (const update of updates) {
    if (update.delta?.type !== 'deposit' || update.time < deposit.createdAt)
      continue;
    const hash = update.hash ?? `${update.time}:${update.delta.usdc ?? ''}`;
    if (used.has(hash)) continue;
    let credit = 0n;
    try {
      credit = parseUsdc(update.delta.usdc ?? '0', 8);
    } catch {
      continue;
    }
    if (credit >= expected) {
      used.add(hash);
      return { hash, usdc: update.delta.usdc ?? '0' };
    }
  }
  return null;
}
export function advanceDeposit(
  deposit: Deposit,
  relayStatus: string,
  _balance = '0',
  options: {
    now?: number;
    ledgerCredit?: string | null;
    graceMs?: number;
  } = {},
) {
  if (isTerminalDeposit(deposit.state)) return deposit.state;
  if (relayStatus === 'failure' || relayStatus === 'failed')
    return 'failed' as const;
  if (relayStatus === 'refunded') return 'refunded' as const;
  const now = options.now ?? Date.now();
  const grace = options.graceMs ?? DEPOSIT_EXPIRY_GRACE_MS;
  if (relayStatus === 'success') {
    if (options.ledgerCredit && options.ledgerCredit !== '0')
      return 'settled' as const;
    return 'pending' as const;
  }
  if (started.has(relayStatus)) return 'pending' as const;
  if (deposit.expiresAt + grace < now) return 'expired' as const;
  return deposit.state;
}
async function defaultLedger(
  network: Deposit['network'],
  recipient: string,
): Promise<LedgerUpdate[]> {
  try {
    return await hlInfo<LedgerUpdate[]>(
      network,
      'userNonFundingLedgerUpdates',
      { user: recipient, startTime: 0 },
    );
  } catch {
    return [];
  }
}
export async function pollDeposits(
  network: Deposit['network'],
  recipient: string,
  balance: string,
  options: {
    path?: string;
    relay?: RelayClient;
    emit?: (deposit: Deposit) => Promise<void>;
    ledger?: () => Promise<LedgerUpdate[]>;
    now?: number;
  } = {},
) {
  const path = options.path;
  const snapshot = (await readDeposits(path)).filter(
    (deposit) =>
      deposit.network === network &&
      deposit.recipient.toLowerCase() === recipient.toLowerCase(),
  );
  const updates = await (
    options.ledger ?? (() => defaultLedger(network, recipient))
  )();
  const used = new Set(
    (await readDeposits(path))
      .map((deposit) => deposit.ledgerHash)
      .filter((hash): hash is string => Boolean(hash)),
  );
  const relay =
    options.relay ??
    new RelayClient(
      network === 'testnet'
        ? 'https://api.testnets.relay.link'
        : 'https://api.relay.link',
    );
  const changes = new Map<
    string,
    { state: DepositState; ledgerHash?: string }
  >();
  for (const deposit of snapshot) {
    if (isTerminalDeposit(deposit.state)) continue;
    let relayStatus = 'unknown';
    try {
      relayStatus = (await relay.status(deposit.id)).status;
    } catch {
      relayStatus = 'unknown';
    }
    const credit = matchLedgerDeposit(deposit, updates, used);
    const next = advanceDeposit(deposit, relayStatus, balance, {
      now: options.now,
      ledgerCredit: credit?.usdc ?? null,
    });
    if (next !== deposit.state)
      changes.set(deposit.id, { state: next, ledgerHash: credit?.hash });
  }
  const fresh = await updateDeposits(path, async (deposits) => {
    for (const deposit of deposits) {
      const change = changes.get(deposit.id);
      if (!change || isTerminalDeposit(deposit.state)) continue;
      const previous = deposit.state;
      deposit.state = change.state;
      if (change.ledgerHash) deposit.ledgerHash = change.ledgerHash;
      if (previous !== deposit.state) await options.emit?.(deposit);
    }
  });
  return fresh.filter(
    (deposit) =>
      deposit.network === network &&
      deposit.recipient.toLowerCase() === recipient.toLowerCase(),
  );
}
export async function assertDepositsSettled(
  network: Deposit['network'],
  recipient: string,
  path?: string,
  now = Date.now(),
) {
  const deposits = await updateDeposits(path, (list) => {
    for (const deposit of list) {
      if (
        deposit.network !== network ||
        deposit.recipient.toLowerCase() !== recipient.toLowerCase() ||
        isTerminalDeposit(deposit.state)
      )
        continue;
      const next = advanceDeposit(deposit, 'unknown', deposit.baseline, {
        now,
      });
      if (next === 'expired') deposit.state = next;
    }
  });
  const pending = deposits.filter(
    (deposit) =>
      deposit.network === network &&
      deposit.recipient.toLowerCase() === recipient.toLowerCase() &&
      (deposit.state === 'awaiting_funds' || deposit.state === 'pending'),
  );
  if (pending.length)
    throw new AgentCliError('DEPOSIT_PENDING', 'Wait for deposit settlement', {
      depositIds: pending.map((deposit) => deposit.id),
    });
}
export async function abandonDeposit(id: string, path?: string) {
  let abandoned = false;
  await updateDeposits(path, (deposits) => {
    const deposit = deposits.find((item) => item.id === id);
    if (!deposit) throw new AgentCliError('CONFIG_INVALID', 'Unknown deposit');
    if (isTerminalDeposit(deposit.state))
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Deposit is already terminal',
        { state: deposit.state },
      );
    deposit.state = 'abandoned';
    abandoned = true;
  });
  return { depositId: id, state: abandoned ? 'abandoned' : 'abandoned' };
}
