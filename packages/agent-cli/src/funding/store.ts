import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, stateDir } from '../core/config.js';
import { withFileLock } from '../core/lock.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentCliError } from '../errors/index.js';
import { events } from '../runner/events.js';
import { parseUsdc } from './amounts.js';
import { quoteSchema, type RelayQuote } from './relay.js';
export const depositStates = [
  'awaiting_funds',
  'pending',
  'settled',
  'failed',
  'refunded',
  'expired',
  'abandoned',
] as const;
export type DepositState = (typeof depositStates)[number];
export interface Deposit {
  id: string;
  network: 'mainnet' | 'testnet';
  recipient: string;
  route: string;
  quote: RelayQuote;
  expiresAt: number;
  state: DepositState;
  baseline: string;
  createdAt: number;
  completedSteps: string[];
  ledgerHash?: string;
  destinationTxHashes?: string[];
  ledgerCredit?: string;
  stepClaims?: Record<
    string,
    { state: 'submitting' | 'unknown'; signatureHash: string }
  >;
  pendingEvents?: { eventId: string; state: DepositState }[];
}
const depositSchema = z
  .object({
    id: z.string().min(1),
    network: z.enum(['mainnet', 'testnet']),
    recipient: z.string().regex(/^0x[0-9a-f]{40}$/i),
    route: z.string(),
    quote: quoteSchema,
    expiresAt: z.number().int().nonnegative(),
    state: z.enum(depositStates),
    baseline: z.string().regex(/^-?\d+(\.\d{1,18})?$/),
    createdAt: z.number().int().nonnegative(),
    completedSteps: z.array(z.string()),
    ledgerHash: z.string().optional(),
    destinationTxHashes: z.array(z.string()).optional(),
    ledgerCredit: z
      .string()
      .regex(/^\d+(\.\d{1,8})?$/)
      .refine((v) => parseUsdc(v, 8) > 0n)
      .optional(),
    stepClaims: z
      .record(
        z.string(),
        z.object({
          state: z.enum(['submitting', 'unknown']),
          signatureHash: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .optional(),
    pendingEvents: z
      .array(z.object({ eventId: z.string(), state: z.enum(depositStates) }))
      .optional(),
  })
  .superRefine((deposit, ctx) => {
    if (deposit.ledgerCredit && !deposit.ledgerHash)
      ctx.addIssue({
        code: 'custom',
        message: 'Ledger credit has no transaction identity',
      });
    const ids = deposit.quote.steps.flatMap((step) =>
      step.kind === 'signature'
        ? step.items.map((_, index) => `${step.id}:${index}`)
        : [],
    );
    if (
      new Set(deposit.completedSteps).size !== deposit.completedSteps.length ||
      deposit.completedSteps.some((id, index) => id !== ids[index])
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid completed signature step order',
      });
    const claims = Object.keys(deposit.stepClaims ?? {});
    if (
      claims.length > 1 ||
      claims.some((id) => id !== ids[deposit.completedSteps.length])
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Signature claim is not the next uncompleted step',
      });
  });
const depositsSchema = z.array(depositSchema).superRefine((deposits, ctx) => {
  const ids = deposits.map(
    (d) => `${d.network}:${d.recipient.toLowerCase()}:${d.id}`,
  );
  const credits = deposits
    .filter((d) => d.ledgerHash)
    .map(
      (d) =>
        `${d.network}:${d.recipient.toLowerCase()}:${d.ledgerHash!.toLowerCase()}`,
    );
  if (
    new Set(ids).size !== ids.length ||
    new Set(credits).size !== credits.length
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Duplicate deposit or ledger ownership',
    });
});
export type DepositAccount = Pick<Deposit, 'network' | 'recipient'>;
export const depositKey = (
  deposit: Pick<Deposit, 'id' | 'network' | 'recipient'>,
) => `${deposit.network}:${deposit.recipient.toLowerCase()}:${deposit.id}`;
export function selectDeposit(
  deposits: Deposit[],
  id: string,
  account?: DepositAccount,
) {
  const matches = deposits.filter(
    (d) =>
      d.id === id &&
      (!account ||
        (d.network === account.network &&
          d.recipient.toLowerCase() === account.recipient.toLowerCase())),
  );
  if (matches.length !== 1)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Deposit identity is missing or ambiguous for the selected account',
    );
  return matches[0];
}
export const depositPath = () => join(stateDir(), 'deposits.json');
export async function readDeposits(path = depositPath()): Promise<Deposit[]> {
  try {
    return depositsSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new AgentCliError('CONFIG_INVALID', 'Invalid deposit state', {
      path,
    });
  }
}
export async function writeDeposits(deposits: Deposit[], path = depositPath()) {
  await atomicWrite(path, JSON.stringify(depositsSchema.parse(deposits)));
}
export async function updateDeposits(
  path = depositPath(),
  mutate: (deposits: Deposit[]) => void | Promise<void>,
) {
  return withFileLock(`${path}.lock`, async () => {
    const deposits = await readDeposits(path);
    await publish(deposits, path);
    const before = JSON.stringify(deposits);
    const states = new Map(deposits.map((d) => [depositKey(d), d.state]));
    await mutate(deposits);
    for (const deposit of deposits)
      if (states.get(depositKey(deposit)) !== deposit.state) {
        deposit.pendingEvents ??= [];
        deposit.pendingEvents.push({
          eventId: randomUUID(),
          state: deposit.state,
        });
      }
    if (JSON.stringify(deposits) !== before)
      await writeDeposits(deposits, path);
    try {
      await publish(deposits, path);
    } catch {
      /* state committed; durable outbox will retry */
    }
    return deposits;
  });
}

async function publish(deposits: Deposit[], path: string) {
  for (const deposit of deposits)
    while (deposit.pendingEvents?.length) {
      const event = deposit.pendingEvents[0];
      await events.append('deposit', {
        id: deposit.id,
        state: event.state,
        scope: `${deposit.network}:${deposit.recipient.toLowerCase()}`,
        eventId: event.eventId,
      });
      deposit.pendingEvents.shift();
      await writeDeposits(deposits, path);
    }
}
