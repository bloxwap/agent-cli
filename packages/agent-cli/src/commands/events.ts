import { z } from 'zod';
import { join } from 'node:path';
import { register } from '../core/router.js';
import { stateDir } from '../core/config.js';
import {
  readEvents,
  followEvents,
  eventTypes,
  type EventType,
} from '../runner/events.js';
import { paperDir, resolveMode } from '../core/mode.js';
register('events', {
  description: 'Replay or follow JSON-line runner events',
  schema: z.object({
    follow: z.boolean().default(false),
    since: z.number().int().nonnegative().default(0),
    types: z.array(z.enum(eventTypes)).default([]),
  }),
  execute: async (input, context) => {
    const paper = (await resolveMode(context, 'events')) === 'paper';
    const path = paper
      ? join(paperDir(), 'events.jsonl')
      : join(stateDir(), 'events.jsonl');
    if (!input.follow)
      return readEvents(
        path,
        input.since as number,
        input.types as EventType[],
      );
    context.streaming = true;
    const abort = new AbortController();
    const stop = () => abort.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      await followEvents({
        path,
        since: input.since as number,
        types: input.types as EventType[],
        signal: abort.signal,
        write: (event) => process.stdout.write(JSON.stringify(event) + '\n'),
      });
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
    return null;
  },
});
