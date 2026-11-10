import { parseUsdc } from '../funding/amounts.js';
import { auditFill } from '../core/audit.js';
import { mkdir, readFile, chmod, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { stateDir } from '../core/config.js';
import { paperDir } from '../core/mode.js';
import { redact } from '../core/logger.js';
import { withFileLock } from '../core/lock.js';
import { repairTornTail } from '../core/journal.js';
export const eventTypes = [
  'fill',
  'order_update',
  'position_change',
  'deposit',
  'error',
  'agent_expiry_warning',
  'runner_state',
  'journal_repaired',
] as const;
export type EventType = (typeof eventTypes)[number];
export const eventSchema = z.object({
  seq: z.number().int().positive(),
  timestamp: z.string(),
  type: z.enum(eventTypes),
  data: z.unknown(),
  mode: z.enum(['live', 'paper']).default('live'),
  paper: z.boolean().default(false),
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
  constructor(
    readonly path = join(stateDir(), 'events.jsonl'),
    readonly paper = false,
  ) {}
  append(type: EventType, data: unknown) {
    let event: RunnerEvent;
    const operation = this.queue.then(async () => {
      if (type === 'fill' && data && typeof data === 'object')
        await auditFill(
          data as Record<string, unknown>,
          this.paper ? 'paper' : 'live',
        );
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await chmod(dirname(this.path), 0o700);
      return withFileLock(this.path + '.lock', async () => {
        const repaired = await repairTornTail(this.path);
        let previous = (await readEvents(this.path)).at(-1)?.seq ?? 0;
        const write = async (eventType: EventType, payload: unknown) => {
          const next = eventSchema.parse({
            seq: ++previous,
            timestamp: new Date().toISOString(),
            type: eventType,
            data: redact(payload),
            mode: this.paper ? 'paper' : 'live',
            paper: this.paper,
          });
          const file = await open(this.path, 'a', 0o600);
          await file.chmod(0o600);
          try {
            await file.writeFile(JSON.stringify(next) + '\n');
            await file.sync();
          } finally {
            await file.close();
          }
          return next;
        };
        if (repaired.repaired)
          await write('journal_repaired', {
            quarantine: repaired.quarantine ?? null,
          });
        event = await write(
          type,
          type === 'fill' ? normalizeFillAmounts(data) : data,
        );
        return event;
      });
    });
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
export const paperEvents = new EventStore(join(paperDir(), 'events.jsonl'), true);

function normalizeFillAmounts(data: unknown) {
  if (!data || typeof data !== 'object') return data;
  const fill = data as Record<string, unknown>;
  if (typeof fill.fee !== 'string') return fill;
  const units = fill.fee.startsWith('-')
    ? -parseUsdc(fill.fee.slice(1), 8)
    : parseUsdc(fill.fee, 8);
  return { ...fill, feeUnits: units.toString() };
}
