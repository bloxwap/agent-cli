import { z } from 'zod';
import { register } from '../core/router.js';
import { readAudit, verifyAudit, auditStoreFor } from '../core/audit.js';
import { resolveMode } from '../core/mode.js';
register('audit', {
  description: 'Verify and query the hash-chained trading audit',
  schema: z.object({
    intent: z.string().optional(),
    intentId: z.string().optional(),
    cloid: z.string().optional(),
  }),
  execute: async (input, context) => {
    const entries = await readAudit(
      auditStoreFor(await resolveMode(context)).path,
    );
    verifyAudit(entries);
    return entries.filter(
      (entry) =>
        ((!input.intent && !input.intentId) ||
          entry.intentId === (input.intentId ?? input.intent)) &&
        (!input.cloid || entry.cloid === input.cloid),
    );
  },
});
