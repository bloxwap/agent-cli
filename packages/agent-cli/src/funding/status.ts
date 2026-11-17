import {
  readDeposits,
  selectDeposit,
  type DepositAccount,
  updateDeposits,
  type Deposit,
  type DepositState,
} from './store.js';
import { RelayClient, parseQuote, type RelayStatus } from './relay.js';
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
  'depositing',
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
    if (
      used.has(hash.toLowerCase()) &&
      deposit.ledgerHash?.toLowerCase() !== hash.toLowerCase()
    )
      continue;
    if (
      !deposit.destinationTxHashes?.some(
        (tx) => tx.toLowerCase() === hash.toLowerCase(),
      )
    )
      continue;
    let credit = 0n;
    try {
      credit = parseUsdc(update.delta.usdc ?? '0', 8);
    } catch {
      continue;
    }
    if (credit >= expected) {
      used.add(hash.toLowerCase());
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
    return 'pending' as const;
  if (relayStatus === 'refunded' || relayStatus === 'refund')
    return 'refunded' as const;
  const now = options.now ?? Date.now();
  const grace = options.graceMs ?? DEPOSIT_EXPIRY_GRACE_MS;
  if (relayStatus === 'success') {
    if (options.ledgerCredit && options.ledgerCredit !== '0')
      return 'settled' as const;
    return 'pending' as const;
  }
  if (started.has(relayStatus)) return 'pending' as const;
  if (
    deposit.state === 'awaiting_funds' &&
    !deposit.ledgerHash &&
    !deposit.destinationTxHashes?.length &&
    !Object.keys(deposit.stepClaims ?? {}).length &&
    deposit.completedSteps.length === 0 &&
    deposit.expiresAt + grace < now
  )
    return 'expired' as const;
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
  const relay =
    options.relay ??
    new RelayClient(
      network === 'testnet'
        ? 'https://api.testnets.relay.link'
        : 'https://api.relay.link',
    );
  const statuses = new Map<string, RelayStatus>();
  for (const deposit of snapshot) {
    if (isTerminalDeposit(deposit.state)) continue;
    try {
      statuses.set(deposit.id, await relay.status(deposit.id));
    } catch {
      statuses.set(deposit.id, { status: 'unknown' });
    }
  }
  const changed: Deposit[] = [];
  const fresh = await updateDeposits(path, (deposits) => {
    // Attribution and uniqueness are decided from current state under one lock.
    const account = deposits.filter(
      (d) =>
        d.network === network &&
        d.recipient.toLowerCase() === recipient.toLowerCase(),
    );
    const used = new Set(
      account.flatMap((d) =>
        d.ledgerHash ? [d.ledgerHash.toLowerCase()] : [],
      ),
    );
    for (const deposit of account) {
      const status = statuses.get(deposit.id);
      if (
        status?.txHashes?.length &&
        (status.destinationChainId === undefined ||
          status.destinationChainId === 1337)
      )
        deposit.destinationTxHashes = [
          ...new Set([
            ...(deposit.destinationTxHashes ?? []),
            ...status.txHashes,
          ]),
        ];
    }
    for (const deposit of account) {
      const status = statuses.get(deposit.id);
      if (!status || isTerminalDeposit(deposit.state)) continue;
      if (
        status.destinationChainId !== undefined &&
        status.destinationChainId !== 1337
      )
        continue;
      // One destination transaction cannot be attributed to competing intents.
      const ambiguous = deposit.destinationTxHashes?.some((hash) =>
        account.some(
          (other) =>
            other.id !== deposit.id &&
            other.destinationTxHashes?.some(
              (tx) => tx.toLowerCase() === hash.toLowerCase(),
            ),
        ),
      );
      const credit = ambiguous
        ? null
        : matchLedgerDeposit(deposit, updates, used);
      if (credit) {
        deposit.ledgerHash = credit.hash;
        deposit.ledgerCredit = credit.usdc;
      }
      const next = advanceDeposit(deposit, status.status, balance, {
        now: options.now,
        ledgerCredit: ambiguous ? null : (deposit.ledgerCredit ?? null),
      });
      if (next !== deposit.state) {
        deposit.state = next;
        changed.push(structuredClone(deposit));
      }
    }
  });
  for (const deposit of changed) await options.emit?.(deposit);
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
export async function abandonDeposit(
  id: string,
  path?: string,
  account?: DepositAccount,
) {
  let abandoned = false;
  await updateDeposits(path, (deposits) => {
    const deposit = selectDeposit(deposits, id, account);
    if (!deposit) throw new AgentCliError('CONFIG_INVALID', 'Unknown deposit');
    if (isTerminalDeposit(deposit.state))
      throw new AgentCliError('CONFIG_INVALID', 'Deposit is already terminal', {
        state: deposit.state,
      });
    deposit.state = 'abandoned';
    abandoned = true;
  });
  return { depositId: id, state: abandoned ? 'abandoned' : 'abandoned' };
}
