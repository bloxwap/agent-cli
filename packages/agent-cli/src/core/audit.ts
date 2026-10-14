import { requestContext as context } from './request-context.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, open, unlink, mkdir, chmod } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { stateDir } from './config.js';
import { redact } from './logger.js';
import { AgentCliError, normalizeError } from '../errors/index.js';
export interface AuditEntry {
  seq: number;
  timestamp: string;
  intentId: string;
  cloid?: string;
  requestId?: string;
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
    const operation = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await chmod(dirname(this.path), 0o700);
      const lock = this.path + '.lock';
      let handle;
      for (let i = 0; i < 100; i++) {
        try {
          handle = await open(lock, 'wx', 0o600);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      if (!handle)
        throw new AgentCliError(
          'INTERNAL',
          'Audit lock busy; inspect stale lock',
        );
      try {
        const entries = await readAudit(this.path);
        verifyAudit(entries);
        const last = entries.at(-1);
        const payload = {
          seq: (last?.seq ?? 0) + 1,
          timestamp: new Date().toISOString(),
          ...metadata,
          stage,
          data: redact(data),
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
        return entry;
      } finally {
        await handle.close();
        await unlink(lock);
      }
    });
    this.queue = operation.then(() => {});
    return operation;
  }
  async flush() {
    await this.queue;
  }
}
export const audit = new AuditStore();
export async function auditedAction<T>(
  name: string,
  input: Record<string, unknown>,
  operation: () => Promise<T>,
): Promise<T> {
  return context.run(
    {
      intentId: (input.intentId as string) ?? randomUUID(),
      cloid: input.cloid as string | undefined,
      requestId: randomUUID(),
    },
    async () => {
      await audit.append('intent', { action: name, input });
      try {
        const result = await operation();
        await audit.append('response', { action: name, result });
        return result;
      } catch (error) {
        await audit.append('decision', {
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
    await audit.append('signature', {
      digest: createHash('sha256').update(signature).digest('base64'),
    });
}
export async function decisionAudit(data: unknown) {
  if (context.getStore()) await audit.append('decision', data);
}
export async function auditFill(fill: Record<string, unknown>) {
  const entries = await readAudit();
  const linked = [...entries]
    .reverse()
    .find(
      (entry) =>
        (entry.cloid && entry.cloid === fill.cloid) ||
        (entry.stage === 'response' &&
          fill.oid !== undefined &&
          JSON.stringify(entry.data).includes(`"oid":${fill.oid}`)),
    );
  await audit.append('fill', fill, {
    intentId: linked?.intentId ?? 'external',
    cloid: linked?.cloid,
  });
}
