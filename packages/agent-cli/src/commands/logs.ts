import { z } from 'zod';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { register } from '../core/router.js';
import { stateDir } from '../core/config.js';
import { levels, redact, type Level } from '../core/logger.js';
export async function readLogs(
  options: {
    directory?: string;
    level?: Level;
    since?: string;
    requestId?: string;
  } = {},
) {
  const directory = options.directory ?? join(stateDir(), 'logs');
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const lines = (
    await Promise.all(
      files
        .filter((f) => /^runner.*\.jsonl$/.test(f))
        .map((f) => readFile(join(directory, f), 'utf8')),
    )
  ).flatMap((content) =>
    content
      .split('\n')
      .slice(0, -1)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  );
  return lines
    .filter(
      (line) =>
        (!options.level ||
          levels[line.level as Level] >= levels[options.level]) &&
        (!options.since || String(line.time) >= options.since) &&
        (!options.requestId || line.requestId === options.requestId),
    )
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))
    .map(redact);
}
register('logs', {
  description: 'Read/follow redacted JSON-line runner logs',
  schema: z.object({
    follow: z.boolean().default(false),
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    since: z.string().datetime().optional(),
    requestId: z.string().optional(),
  }),
  execute: async (input, context) => {
    context.streaming = true;
    let cursor = 0;
    const seen = new Set<string>();
    const abort = new AbortController();
    const stop = () => abort.abort();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      do {
        const logs = await readLogs(input);
        for (const log of logs) {
          const key = JSON.stringify(log);
          if (!seen.has(key)) {
            seen.add(key);
            process.stdout.write(key + '\n');
            cursor++;
          }
        }
        if (input.follow && !abort.signal.aborted)
          await new Promise((resolve) => setTimeout(resolve, 250));
      } while (input.follow && !abort.signal.aborted);
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
    return { lines: cursor };
  },
});
