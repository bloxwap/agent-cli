import { z } from 'zod';
import { register } from '../core/router.js';
import {
  readEvents,
  followEvents,
  eventTypes,
  type EventType,
} from '../runner/events.js';
register('events', {
  description: 'Replay or follow JSON-line runner events',
  schema: z.object({
    follow: z.boolean().default(false),
    since: z.number().int().nonnegative().default(0),
    types: z.array(z.enum(eventTypes)).default([]),
  }),
  execute: async (input, context) => {
    if (!input.follow)
      return readEvents(
        undefined,
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
