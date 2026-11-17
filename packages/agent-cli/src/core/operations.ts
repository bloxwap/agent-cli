import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { atomicWrite, stateDir, type Config } from './config.js';
import { withFileLock } from './lock.js';
import { newCloid, responseOids } from './idempotency.js';
import {
  AgentCliError,
  errorDefaults,
  type ErrorCode,
} from '../errors/index.js';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export async function executionScope(config: Config) {
  if (config.mode === 'paper') {
    const { PaperStore } = await import('../paper/store.js');
    const state = await new PaperStore(
      undefined,
      config.paper.startingBalance,
    ).load();
    return `paper:${state.sessionId}`;
  }
  return `${config.network}:${config.masterAddress?.toLowerCase() ?? 'uninitialized'}`;
}
function directory(scope: string) {
  return join(
    stateDir(),
    ...(scope.startsWith('paper:') ? ['paper'] : []),
    'operations',
    hash(scope),
  );
}
const cloidSchema = z.string().regex(/^0x[\da-f]{32}$/);
const recordSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  cloid: cloidSchema,
  intentId: z.string(),
  requestHash: z.string(),
  state: z.enum(['prepared', 'submitting', 'complete', 'rejected']),
  updatedAt: z.number().int().nonnegative(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.custom<ErrorCode>(
        (value) =>
          typeof value === 'string' && Object.hasOwn(errorDefaults, value),
      ),
      message: z.string(),
      details: z.unknown(),
      retryable: z.boolean(),
    })
    .optional(),
});
export type OrderRecord = z.infer<typeof recordSchema>;
async function read<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  try {
    return schema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new AgentCliError('CONFIG_INVALID', 'Invalid operation state', {
      path,
    });
  }
}
export function requestDigest(input: Record<string, unknown>) {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, value]) => value !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, canonical(value)]),
      );
    return value;
  };
  const { intentId, intent, cloid, ...body } = input;
  void intentId;
  void intent;
  void cloid;
  return hash(JSON.stringify(canonical(body)));
}
export async function orderRecord(scope: string, cloid: string) {
  if (!/^0x[\da-f]{32}$/i.test(cloid))
    throw new AgentCliError('CONFIG_INVALID', 'Invalid order identity');
  const record = await read(
    join(directory(scope), `order-${cloid.toLowerCase()}.json`),
    recordSchema,
  );
  if (
    record &&
    (record.scope !== scope ||
      record.cloid !== cloid.toLowerCase() ||
      (record.state === 'complete' && record.result === undefined) ||
      (record.state === 'rejected' && !record.error))
  )
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Order record identity or outcome is inconsistent',
    );
  return record;
}
export async function bindOrderIdentity(
  config: Config,
  input: Record<string, unknown>,
) {
  const scope = await executionScope(config);
  const dir = directory(scope);
  return withFileLock(join(dir, 'bindings.lock'), async () => {
    const intentId =
      typeof input.intentId === 'string' ? input.intentId : randomUUID();
    const intentPath = join(dir, `intent-${hash(intentId)}.json`);
    const binding = await read(intentPath, z.object({ cloid: cloidSchema }));
    const requested =
      typeof input.cloid === 'string' ? input.cloid.toLowerCase() : undefined;
    if (binding && requested && binding.cloid !== requested)
      throw new AgentCliError(
        'CONFIG_INVALID',
        'intentId is already bound to a different cloid',
        { intentId, cloid: binding.cloid },
      );
    const cloid = binding?.cloid ?? requested ?? newCloid();
    const previous = await orderRecord(scope, cloid);
    const requestHash = requestDigest(input);
    if (previous && previous.requestHash !== requestHash)
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Order identity is already bound to a different request',
        { cloid, intentId },
      );
    const record: OrderRecord = previous ?? {
      version: 1,
      scope,
      cloid,
      intentId,
      requestHash,
      state: 'prepared',
      updatedAt: Date.now(),
    };
    if (!previous)
      await atomicWrite(
        join(dir, `order-${cloid}.json`),
        JSON.stringify(record),
      );
    await atomicWrite(intentPath, JSON.stringify({ cloid }));
    input.cloid = cloid;
    input.intentId = record.intentId;
    return record;
  });
}
export async function updateOrderRecord(record: OrderRecord) {
  const dir = directory(record.scope);
  await withFileLock(join(dir, 'bindings.lock'), async () => {
    const pendingPath = join(dir, 'pending.json');
    const pending = new Set(
      (await read(pendingPath, z.array(cloidSchema))) ?? [],
    );
    if (record.state === 'submitting') {
      pending.add(record.cloid);
      // Reserve exposure before publishing an attempted submission.
      await atomicWrite(pendingPath, JSON.stringify([...pending]));
    }
    record.updatedAt = Date.now();
    await atomicWrite(
      join(dir, `order-${record.cloid}.json`),
      JSON.stringify(recordSchema.parse(record)),
    );
    if (record.state === 'complete')
      for (const oid of responseOids(record.result))
        await atomicWrite(
          join(dir, `oid-${oid}.json`),
          JSON.stringify({ cloid: record.cloid }),
        );
    if (record.state !== 'submitting') {
      pending.delete(record.cloid);
      await atomicWrite(pendingPath, JSON.stringify([...pending]));
    }
  });
}
export function unknownOrder(record: OrderRecord) {
  return new AgentCliError(
    'NETWORK_ERROR',
    'Order outcome is unresolved; reconcile this cloid before submitting more exposure',
    { outcome: 'unknown', cloid: record.cloid, intentId: record.intentId },
    false,
  );
}
export function rejectedOrder(record: OrderRecord) {
  const error = record.error;
  return error
    ? new AgentCliError(
        error.code as ErrorCode,
        error.message,
        error.details,
        error.retryable,
      )
    : new AgentCliError('INTERNAL', 'Rejected order has no recorded outcome');
}
export async function reconcilePendingOrders(
  config: Config,
  lookup: (cloid: string) => Promise<unknown | null>,
) {
  const scope = await executionScope(config);
  const pending =
    (await read(
      join(directory(scope), 'pending.json'),
      z.array(cloidSchema),
    )) ?? [];
  for (const cloid of pending) {
    const record = await orderRecord(scope, cloid);
    if (!record)
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Pending order record is missing',
        { cloid },
      );
    if (record.state === 'submitting') {
      const result = await lookup(cloid);
      if (!result) throw unknownOrder(record);
      record.state = 'complete';
      record.result = result;
    }
    await updateOrderRecord(record);
  }
}
export async function operationForFill(
  scope: string,
  fill: { oid?: unknown; cloid?: unknown },
) {
  let cloid = typeof fill.cloid === 'string' ? fill.cloid : undefined;
  if (!cloid && typeof fill.oid === 'number' && Number.isSafeInteger(fill.oid))
    cloid = (
      await read(
        join(directory(scope), `oid-${fill.oid}.json`),
        z.object({ cloid: cloidSchema }),
      )
    )?.cloid;
  return cloid ? orderRecord(scope, cloid) : null;
}
