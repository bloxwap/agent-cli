import { parseUsdc } from '../funding/amounts.js';
import { auditFill } from '../core/audit.js';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { currentRequestContext } from '../core/request-context.js';
import { join } from 'node:path';
import { z } from 'zod';
import { stateDir } from '../core/config.js';
import { paperDir } from '../core/mode.js';
import { redact } from '../core/logger.js';
import { withFileLock } from '../core/lock.js';
import { repairTornTail, appendOnce, journalTail } from '../core/journal.js';
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
  eventId: z.string().optional(),
  scope: z.string().optional(),
  timestamp: z.string().datetime(),
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
  limit = Number.POSITIVE_INFINITY,
  scope?: string,
): Promise<RunnerEvent[]> {
  return withFileLock(path + '.lock', async () => {
    await repairTornTail(path);
    try {
      await stat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const input = createReadStream(path, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    const result: RunnerEvent[] = [];
    let bytes = 0;
    try {
      for await (const line of lines) {
        if (!line) continue;
        const event = eventSchema.parse(JSON.parse(line));
        if (
          event.seq <= since ||
          (types.length && !types.includes(event.type)) ||
          (scope && event.scope !== scope)
        )
          continue;
        const size = Buffer.byteLength(line);
        if (Number.isFinite(limit) && result.length && bytes + size > 512_000)
          break;
        result.push(event);
        bytes += size;
        if (result.length >= limit) break;
      }
    } finally {
      lines.close();
      input.destroy();
    }
    return result;
  });
}
export class EventStore {
  private pending = new Set<Promise<unknown>>();
  constructor(
    readonly path = join(stateDir(), 'events.jsonl'),
    readonly paper = false,
  ) {}
  append(type: EventType, data: unknown, metadata?: { scope: string }) {
    const operation = (async () => {
      const payload = type === 'fill' ? normalizeFillAmounts(data) : data;
      const obj =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : {};
      const scope =
        typeof obj.scope === 'string'
          ? obj.scope
          : (metadata?.scope ?? currentRequestContext()?.scope);
      const eventId =
        typeof obj.eventId === 'string'
          ? obj.eventId
          : scope && type === 'fill' && obj.tid !== undefined
            ? `${scope}:fill:${obj.tid}`
            : randomUUID();
      // The producer retries with the same eventId until both journals commit.
      if (type === 'fill')
        await auditFill(
          { ...obj, scope, eventId },
          this.paper ? 'paper' : 'live',
        );
      return withFileLock(this.path + '.lock', async () => {
        const repaired = await repairTornTail(this.path);
        const write = (eventType: EventType, value: unknown, id: string) =>
          appendOnce(this.path, id, async () => {
            const tail = await journalTail(this.path);
            const previous = tail.tail
              ? eventSchema.parse(JSON.parse(tail.tail)).seq
              : 0;
            return eventSchema.parse({
              seq: previous + 1,
              timestamp: new Date().toISOString(),
              type: eventType,
              data: redact(value),
              scope,
              eventId: id,
              mode: this.paper ? 'paper' : 'live',
              paper: this.paper,
            });
          });
        if (repaired.repaired)
          await write(
            'journal_repaired',
            { quarantine: repaired.quarantine ?? null },
            randomUUID(),
          );
        return eventSchema.parse(await write(type, payload, eventId));
      });
    })();
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
export async function followEvents(options: {
  path?: string;
  since?: number;
  types?: EventType[];
  signal?: AbortSignal;
  write: (event: RunnerEvent) => void;
  interval?: number;
  scope?: string | (() => Promise<string>);
}) {
  let since = options.since ?? 0;
  while (!options.signal?.aborted) {
    const scope =
      typeof options.scope === 'function'
        ? await options.scope()
        : options.scope;
    for (const event of await readEvents(
      options.path,
      since,
      options.types,
      1000,
      scope,
    )) {
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
export const paperEvents = new EventStore(
  join(paperDir(), 'events.jsonl'),
  true,
);

function normalizeFillAmounts(data: unknown) {
  if (!data || typeof data !== 'object') return data;
  const fill = data as Record<string, unknown>;
  if (typeof fill.fee !== 'string') return fill;
  const units = fill.fee.startsWith('-')
    ? -parseUsdc(fill.fee.slice(1), 18) / 10n ** 10n
    : parseUsdc(fill.fee, 18) / 10n ** 10n;
  return { ...fill, feeUnits: units.toString() };
}
