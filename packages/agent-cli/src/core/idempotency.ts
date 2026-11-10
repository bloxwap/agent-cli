import { randomBytes } from 'node:crypto';
import { AgentCliError } from '../errors/index.js';

export function newCloid() {
  return `0x${randomBytes(16).toString('hex')}`;
}

export interface IntentCarrier {
  intentId: string;
  cloid?: string;
  stage: string;
  data: unknown;
}

export function cloidForIntent(entries: IntentCarrier[], intentId: string) {
  for (const entry of entries) {
    if (entry.intentId !== intentId) continue;
    if (entry.cloid) return entry.cloid;
    const input = (entry.data as { input?: { cloid?: unknown } } | null)?.input;
    if (typeof input?.cloid === 'string') return input.cloid;
  }
  return undefined;
}

export function bindOrderCloid(
  input: Record<string, unknown>,
  entries: IntentCarrier[],
) {
  const intentId = typeof input.intentId === 'string' ? input.intentId : undefined;
  const prior = intentId ? cloidForIntent(entries, intentId) : undefined;
  if (prior && input.cloid && input.cloid !== prior)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'intentId is already bound to a different cloid',
      { intentId, cloid: prior },
    );
  input.cloid = prior ?? input.cloid ?? newCloid();
  return input.cloid as string;
}

export function responseOids(data: unknown): number[] {
  const oids: number[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of ['resting', 'filled'] as const) {
      const status = record[key] as { oid?: unknown } | undefined;
      if (status && typeof status.oid === 'number') oids.push(status.oid);
    }
    for (const child of Object.values(record))
      if (child && typeof child === 'object') visit(child);
  };
  visit(data);
  return oids;
}

export function entryOwnsOid(data: unknown, oid: number) {
  return responseOids(data).includes(oid);
}
