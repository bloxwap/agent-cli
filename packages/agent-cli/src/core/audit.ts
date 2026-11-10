import { requestContext as context } from './request-context.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, open, mkdir, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { stateDir } from './config.js';
import { paperDir, resolveMode, type Mode } from './mode.js';
import { redact } from './logger.js';
import { AgentCliError, normalizeError } from '../errors/index.js';
import { withFileLock } from './lock.js';
import { repairTornTail } from './journal.js';
import { bindOrderCloid, entryOwnsOid } from './idempotency.js';
export interface AuditEntry {
  seq: number;
  timestamp: string;
  intentId: string;
  cloid?: string;
  requestId?: string;
  mode?: Mode;
  stage: string;
  data: unknown;
  previousHash: string;
  hash: string;
}
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function readAudit(
  path = join(stateDir(), 'audit.jsonl'),
): Promise<AuditEntry[]> {
  try {
    return (await readFile(path, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
export function verifyAudit(entries: AuditEntry[]) {
  let previousHash = '0'.repeat(64);
  let seq = 0;
  for (const entry of entries) {
    const { hash, ...payload } = entry;
    if (
      entry.seq !== ++seq ||
      entry.previousHash !== previousHash ||
      digest(payload) !== hash
    )
      throw new AgentCliError('INTERNAL', 'Audit chain integrity failure');
    previousHash = hash;
  }
  return true;
}
export class AuditStore {
  private queue = Promise.resolve();
  constructor(readonly path = join(stateDir(), 'audit.jsonl')) {}
  append(
    stage: string,
    data: unknown,
    metadata = context.getStore() ?? { intentId: randomUUID() },
  ) {
    const operation = this.queue.then(() =>
      withFileLock(this.path + '.lock', async () => {
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        await chmod(dirname(this.path), 0o700);
        const repaired = await repairTornTail(this.path);
        const entries = await readAudit(this.path);
        verifyAudit(entries);
        const write = async (nextStage: string, nextData: unknown) => {
          const last = entries.at(-1);
          const payload = {
            seq: (last?.seq ?? 0) + 1,
            timestamp: new Date().toISOString(),
            ...metadata,
            stage: nextStage,
            data: redact(nextData),
            previousHash: last?.hash ?? '0'.repeat(64),
          };
          const entry = { ...payload, hash: digest(payload) };
          const file = await open(this.path, 'a', 0o600);
          await file.chmod(0o600);
          try {
            await file.writeFile(JSON.stringify(entry) + '\n');
            await file.sync();
          } finally {
            await file.close();
          }
          entries.push(entry);
          return entry;
        };
        if (repaired.repaired)
          await write('journal_repaired', {
            quarantine: repaired.quarantine ?? null,
          });
        return write(stage, data);
      }),
    );
    this.queue = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
  async flush() {
    await this.queue;
  }
}
export const audit = new AuditStore();
export const paperAudit = new AuditStore(join(paperDir(), 'audit.jsonl'));
export const auditStoreFor = (mode?: Mode) =>
  mode === 'paper' ? paperAudit : audit;
export async function auditedAction<T>(
  name: string,
  input: Record<string, unknown>,
  operation: () => Promise<T>,
  routingContext?: { configPath?: string; paper?: boolean },
): Promise<T> {
  const mode = await resolveMode(routingContext ?? {}, name);
  const store = auditStoreFor(mode);
  const metadata = {
    intentId: (input.intentId as string) ?? randomUUID(),
    cloid: input.cloid as string | undefined,
    requestId: randomUUID(),
    mode,
  };
  return context.run(metadata, async () => {
      if (name === 'order')
        await withFileLock(store.path + '.lock', async () => {
          bindOrderCloid(input, await readAudit(store.path));
          metadata.cloid = input.cloid as string;
          await store.append('intent', { action: name, input });
        });
      else await store.append('intent', { action: name, input });
      try {
        const result = await operation();
        await store.append('response', { action: name, result });
        return result;
      } catch (error) {
        await store.append('decision', {
          allowed: false,
          error: normalizeError(error).toJSON(),
        });
        throw error;
      }
    },
  );
}
export async function signatureAudit(signature: string) {
  if (context.getStore())
    await auditStoreFor(context.getStore()?.mode).append('signature', {
      digest: createHash('sha256').update(signature).digest('base64'),
    });
}
export async function decisionAudit(data: unknown) {
  if (context.getStore())
    await auditStoreFor(context.getStore()?.mode).append('decision', data);
}
export function intentForFill(
  entries: AuditEntry[],
  fill: { oid?: unknown; cloid?: unknown },
) {
  return [...entries].reverse().find((entry) => {
    if (entry.cloid && entry.cloid === fill.cloid) return true;
    return (
      entry.stage === 'response' &&
      typeof fill.oid === 'number' &&
      entryOwnsOid(entry.data, fill.oid)
    );
  });
}
export async function auditFill(fill: Record<string, unknown>, mode?: Mode) {
  const store = auditStoreFor(mode ?? context.getStore()?.mode);
  const entries = await readAudit(store.path);
  const linked = intentForFill(entries, fill);
  await store.append('fill', fill, {
    intentId: linked?.intentId ?? 'external',
    cloid: linked?.cloid ?? (typeof fill.cloid === 'string' ? fill.cloid : undefined),
  });
}
