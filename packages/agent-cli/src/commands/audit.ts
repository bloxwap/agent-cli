import { executionScope } from '../core/operations.js';
import { commandConfig } from './read.js';
import { z } from 'zod';
import { register } from '../core/router.js';
import { readAudit, verifyAudit, auditStoreFor } from '../core/audit.js';
import { resolveMode } from '../core/mode.js';
register('audit', {
  description: 'Verify and query the hash-chained trading audit',
  schema: z.object({
    since: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(1000).default(200),
    allScopes: z.boolean().default(false),
    intent: z.string().optional(),
    intentId: z.string().optional(),
    cloid: z.string().optional(),
  }),
  execute: async (input, context) => {
    const entries = await readAudit(
      auditStoreFor(await resolveMode(context)).path,
    );
    verifyAudit(entries);
    const scope = input.allScopes
      ? undefined
      : await executionScope(await commandConfig(context));
    let bytes = 0;
    return entries
      .filter(
        (entry) =>
          (!scope || entry.scope === scope) &&
          entry.seq > (input.since as number) &&
          ((!input.intent && !input.intentId) ||
            entry.intentId === (input.intentId ?? input.intent)) &&
          (!input.cloid || entry.cloid === input.cloid),
      )
      .slice(0, input.limit as number)
      .filter((entry, index) => {
        bytes += Buffer.byteLength(JSON.stringify(entry));
        return index === 0 || bytes < 512_000;
      });
  },
});
