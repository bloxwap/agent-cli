import { AgentCliError, type ErrorCode } from './index.js';
import { redact } from '../core/logger.js';
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error) ?? 'Unknown upstream error';
}
function map(error: unknown, service: string): AgentCliError {
  if (error instanceof AgentCliError) return error;
  const message = String(redact(describe(error)));
  if (
    (error instanceof TypeError && /fetch|network/i.test(message)) ||
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED/.test(message)
  )
    return mapNetworkError(error);
  let code: ErrorCode = 'UPSTREAM_ERROR';
  let nonceRejected = false;
  const patterns: [RegExp, ErrorCode, { nonceRejected?: boolean }?][] = [
    [/429|rate.?limit|too many requests/i, 'RATE_LIMIT'],
    [
      /nonce.*(too old|expired|invalid)|invalid nonce|stale nonce/i,
      'UPSTREAM_ERROR',
      { nonceRejected: true },
    ],
    [/nonce already used|duplicate.*timestamp|nonce.*used/i, 'NONCE_COLLISION'],
    [/insufficient.*margin|margin.*insufficient/i, 'INSUFFICIENT_MARGIN'],
    [
      /minimum.*(size|value)|min.*notional|invalid.*size|too small/i,
      'INVALID_SIZE',
    ],
    [/tick|invalid.*price/i, 'INVALID_PRICE'],
    [
      /user or api wallet .*does not exist|api wallet .*does not exist/i,
      'AGENT_NOT_APPROVED',
    ],
    [/agent.*expired|expired.*agent/i, 'AGENT_EXPIRED'],
    [/agent.*not.*approved|not.*authorized/i, 'AGENT_NOT_APPROVED'],
    [/policy|not allowed|denied/i, 'POLICY_REJECTED'],
    [/order.*not.*found|never placed|already canceled|does not exist/i, 'ORDER_NOT_FOUND'],
  ];
  for (const [pattern, candidate, flags] of patterns)
    if (pattern.test(message)) {
      code = candidate;
      nonceRejected = flags?.nonceRejected ?? false;
      break;
    }
  return new AgentCliError(
    code,
    message,
    redact({
      service,
      upstream: error instanceof Error ? { message: error.message } : error,
      ...(nonceRejected ? { nonceRejected: true } : {}),
    }),
    nonceRejected ? false : undefined,
  );
}
export const mapHyperliquidError = (error: unknown) =>
  map(error, 'hyperliquid');
export const mapPrivyError = (error: unknown) => map(error, 'privy');
export const mapRelayError = (error: unknown) => map(error, 'relay');
export const mapNetworkError = (error: unknown) =>
  new AgentCliError(
    'NETWORK_ERROR',
    String(redact(describe(error))),
    redact({ service: 'network', upstream: describe(error) }),
  );
