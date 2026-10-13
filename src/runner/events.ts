import { parseUsdc } from '../funding/amounts.js';
import { AgentCliError } from '../errors/index.js';
import { auditFill } from '../core/audit.js';
import {
  appendFile,
  mkdir,
  readFile,
  chmod,
  open,
  unlink,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { stateDir } from '../core/config.js';
import { redact } from '../core/logger.js';
export const eventTypes = [
  'fill',
  'order_update',
  'position_change',
  'deposit',
  'error',
  'agent_expiry_warning',
  'runner_state',
] as const;
export type EventType = (typeof eventTypes)[number];
export const eventSchema = z.object({
  seq: z.number().int().positive(),
  timestamp: z.string(),
  type: z.enum(eventTypes),
  data: z.unknown(),
});
export type RunnerEvent = z.infer<typeof eventSchema>;
export async function readEvents(
  path = join(stateDir(), 'events.jsonl'),
  since = 0,
  types: EventType[] = [],
): Promise<RunnerEvent[]> {
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return contents
    .split('\n')
    .slice(0, -1)
    .filter(Boolean)
    .map((line) => eventSchema.parse(JSON.parse(line)))
    .filter(
      (event) =>
        event.seq > since && (!types.length || types.includes(event.type)),
    );
}
export class EventStore {
  private queue = Promise.resolve();
  constructor(readonly path = join(stateDir(), 'events.jsonl')) {}
  append(type: EventType, data: unknown) {
    let event: RunnerEvent;
    const operation = this.queue.then(async () => {
      if (type === 'fill' && data && typeof data === 'object')
        await auditFill(data as Record<string, unknown>);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await chmod(dirname(this.path), 0o700);
      let guard;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          guard = await open(this.path + '.lock', 'wx', 0o600);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      if (!guard)
        throw new AgentCliError('INTERNAL', 'Event journal lock busy');
      try {
        const previous = (await readEvents(this.path)).at(-1)?.seq ?? 0;
        event = eventSchema.parse({
          seq: previous + 1,
          timestamp: new Date().toISOString(),
          type,
          data: redact(type === 'fill' ? normalizeFillAmounts(data) : data),
        });
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        await appendFile(this.path, JSON.stringify(event) + '\n', {
          mode: 0o600,
        });
        await chmod(this.path, 0o600);
        return event;
      } finally {
        await guard.close();
        await unlink(this.path + '.lock');
      }
    });
    this.queue = operation.then(() => {});
    return operation;
  }
  async flush() {
    await this.queue;
  }
}
export async function followEvents(options: {
  path?: string;
  since?: number;
  types?: EventType[];
  signal?: AbortSignal;
  write: (event: RunnerEvent) => void;
  interval?: number;
}) {
  let since = options.since ?? 0;
  while (!options.signal?.aborted) {
    for (const event of await readEvents(options.path, since, options.types)) {
      options.write(event);
      since = event.seq;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, options.interval ?? 250);
      function done() {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', done);
        resolve();
      }
      options.signal?.addEventListener('abort', done, { once: true });
    });
  }
}
export const events = new EventStore();

function normalizeFillAmounts(data: unknown) {
  if (!data || typeof data !== 'object') return data;
  const fill = data as Record<string, unknown>;
  if (typeof fill.fee !== 'string') return fill;
  const units = fill.fee.startsWith('-')
    ? -parseUsdc(fill.fee.slice(1), 8)
    : parseUsdc(fill.fee, 8);
  return { ...fill, feeUnits: units.toString() };
}
