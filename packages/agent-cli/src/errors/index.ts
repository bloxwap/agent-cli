import { redact } from '../core/logger.js';
export const errorDefaults = {
  INSUFFICIENT_MARGIN: false,
  POLICY_REJECTED: false,
  AGENT_EXPIRED: false,
  AGENT_NOT_APPROVED: false,
  DEPOSIT_PENDING: true,
  NONCE_COLLISION: true,
  RATE_LIMIT: true,
  INVALID_SIZE: false,
  INVALID_PRICE: false,
  UNKNOWN_MARKET: false,
  ORDER_NOT_FOUND: false,
  RUNNER_NOT_RUNNING: true,
  CONFIG_INVALID: false,
  NETWORK_ERROR: true,
  UPSTREAM_ERROR: false,
  INTERNAL: false,
} as const;
export type ErrorCode = keyof typeof errorDefaults;
export class AgentCliError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: unknown = null,
    retryable = errorDefaults[code] as boolean,
  ) {
    super(message);
    this.name = 'AgentCliError';
    this.retryable = retryable;
  }
  toJSON() {
    return {
      ok: false as const,
      code: this.code,
      message: String(redact(this.message)),
      retryable: this.retryable,
      details: redact(this.details),
    };
  }
  get exitCode() {
    return this.code === 'CONFIG_INVALID' ? 2 : this.retryable ? 75 : 1;
  }
}
export function normalizeError(error: unknown): AgentCliError {
  return error instanceof AgentCliError
    ? error
    : new AgentCliError(
        'INTERNAL',
        error instanceof Error ? error.message : String(error),
      );
}
export const success = <T>(data: T) => ({ ok: true as const, data });
