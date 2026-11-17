import { requestContext as context } from './request-context.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { join } from 'node:path';
import { stateDir, loadConfig } from './config.js';
import { paperDir, resolveMode, type Mode } from './mode.js';
import { redact } from './logger.js';
import { AgentCliError, normalizeError } from '../errors/index.js';
import { withFileLock } from './lock.js';
import { repairTornTail, appendJournal, appendOnce } from './journal.js';
import {
  executionScope,
  operationForFill,
  bindOrderIdentity,
} from './operations.js';
import { entryOwnsOid } from './idempotency.js';
export interface AuditEntry {
  seq: number;
  timestamp: string;
  intentId: string;
  cloid?: string;
  requestId?: string;
  mode?: Mode;
  scope?: string;
  eventId?: string;
  stage: string;
  data: unknown;
  previousHash: string;
  hash: string;
}
const auditSchema = z.object({
  seq: z.number().int().positive(),
  timestamp: z.string().datetime(),
  intentId: z.string(),
  cloid: z.string().optional(),
  requestId: z.string().optional(),
  mode: z.enum(['live', 'paper']).optional(),
  scope: z.string().optional(),
  eventId: z.string().optional(),
  stage: z.string(),
  data: z.unknown(),
  previousHash: z.string().regex(/^[a-f0-9]{64}$/),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function readAudit(
  path = join(stateDir(), 'audit.jsonl'),
): Promise<AuditEntry[]> {
  return withFileLock(path + '.lock', async () => {
    await repairTornTail(path);
    try {
      return (await readFile(path, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const raw = JSON.parse(line);
          auditSchema.parse(raw);
          return raw as AuditEntry;
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  });
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
  private pending = new Set<Promise<unknown>>();
  private cached?: { fingerprint: string; last?: AuditEntry };
  constructor(readonly path = join(stateDir(), 'audit.jsonl')) {}
  private async fingerprint() {
    return stat(this.path)
      .then((s) => `${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`)
      .catch((error) => {
        if (error.code === 'ENOENT') return 'missing';
        throw error;
      });
  }
  append(
    stage: string,
    data: unknown,
    metadata = context.getStore() ?? { intentId: randomUUID() },
  ) {
    const operation = withFileLock(this.path + '.lock', async () => {
      const repaired = await repairTornTail(this.path);
      const fingerprint = await this.fingerprint();
      if (!this.cached || this.cached.fingerprint !== fingerprint) {
        const entries = await readAudit(this.path);
        verifyAudit(entries);
        this.cached = { fingerprint, last: entries.at(-1) };
      }
      const write = async (
        nextStage: string,
        nextData: unknown,
        eventId?: string,
      ) => {
        const make = async () => {
          const last = this.cached?.last;
          const { eventId: ignoredEventId, ...baseMetadata } = metadata;
          void ignoredEventId;
          const payload = {
            seq: (last?.seq ?? 0) + 1,
            timestamp: new Date().toISOString(),
            ...baseMetadata,
            ...(eventId ? { eventId } : {}),
            stage: nextStage,
            data: redact(nextData),
            previousHash: last?.hash ?? '0'.repeat(64),
          };
          return { ...payload, hash: digest(payload) };
        };
        const entry = eventId
          ? await appendOnce(this.path, eventId, make)
          : await make();
        auditSchema.parse(entry);
        if (!eventId) await appendJournal(this.path, entry);
        // A replay may return an older entry. Never rewind the chain head.
        const last =
          entry.seq > (this.cached?.last?.seq ?? 0) ? entry : this.cached?.last;
        this.cached = { fingerprint: await this.fingerprint(), last };
        return entry;
      };
      if (repaired.repaired)
        await write('journal_repaired', {
          quarantine: repaired.quarantine ?? null,
        });
      return write(stage, data, metadata.eventId);
    });
    this.pending.add(operation);
    void operation
      .finally(() => this.pending.delete(operation))
      .catch(() => {});
    return operation;
  }
  async flush() {
    await Promise.all([...this.pending]);
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
  routingContext?: {
    configPath?: string;
    paper?: boolean;
    network?: 'mainnet' | 'testnet';
  },
): Promise<T> {
  const mode = await resolveMode(routingContext ?? {}, name);
  const config = await loadConfig(routingContext?.configPath);
  config.mode = mode;
  if (routingContext?.network) config.network = routingContext.network;
  if (name === 'order') await bindOrderIdentity(config, input);
  const store = auditStoreFor(mode);
  const metadata = {
    intentId: (input.intentId as string) ?? randomUUID(),
    cloid: input.cloid as string | undefined,
    requestId: randomUUID(),
    mode,
    scope: await executionScope(config),
  };
  return context.run(metadata, async () => {
    await store.append('intent', { action: name, input });
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      // A logging failure must never replace an exchange outcome.
      try {
        await store.append('decision', {
          allowed: false,
          error: normalizeError(error).toJSON(),
        });
      } catch {
        /* preserve outcome */
      }
      throw error;
    }
    try {
      await store.append('response', { action: name, result });
    } catch (error) {
      throw new AgentCliError(
        'INTERNAL',
        'Action completed but its audit response could not be persisted',
        {
          outcome: 'accepted',
          result,
          cloid: metadata.cloid,
          intentId: metadata.intentId,
          auditError: normalizeError(error).message,
        },
        false,
      );
    }
    return result;
  });
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
  const scope =
    typeof fill.scope === 'string' ? fill.scope : context.getStore()?.scope;
  let linked: { intentId: string; cloid?: string } | null | undefined;
  if (scope) linked = await operationForFill(scope, fill);
  else {
    // Compatibility for old, unscoped journals: repair before linkage lookup.
    linked = await withFileLock(store.path + '.lock', async () => {
      await repairTornTail(store.path);
      const entries = await readAudit(store.path);
      verifyAudit(entries);
      return intentForFill(entries, fill);
    });
  }
  await store.append('fill', fill, {
    intentId: linked?.intentId ?? 'external',
    scope,
    mode,
    eventId: typeof fill.eventId === 'string' ? fill.eventId : undefined,
    cloid:
      linked?.cloid ??
      (typeof fill.cloid === 'string' ? fill.cloid : undefined),
  });
}
