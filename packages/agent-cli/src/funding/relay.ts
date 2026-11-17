import { z } from 'zod';
import { jsonRequest } from '../core/http.js';
import { AgentCliError } from '../errors/index.js';
import { mapRelayError } from '../errors/mappers.js';
export const PERPS_USDC = '0x00000000000000000000000000000000';
export interface QuoteRequest {
  user: string;
  recipient: string;
  originChainId: number;
  originCurrency: string;
  amount: string;
  destinationChainId: 1337;
  destinationCurrency: typeof PERPS_USDC;
  useDepositAddress: true;
  tradeType: 'EXACT_INPUT';
}
const item = z
  .object({
    status: z.enum(['complete', 'incomplete']),
    data: z.record(z.string(), z.unknown()),
    check: z.object({ endpoint: z.string(), method: z.string() }).optional(),
  })
  .passthrough();
export const quoteSchema = z
  .object({
    steps: z.array(
      z
        .object({
          id: z.string().min(1),
          kind: z.enum(['transaction', 'signature']),
          requestId: z.string().min(1).optional(),
          depositAddress: z.string().min(1).max(128).optional(),
          items: z.array(item),
        })
        .passthrough(),
    ),
    fees: z.record(z.string(), z.unknown()).default({}),
    details: z
      .object({
        currencyOut: z
          .object({
            amount: z
              .string()
              .regex(/^\d+$/)
              .refine((v) => BigInt(v) > 0n),
            currency: z
              .object({ decimals: z.number().int().min(0).max(30) })
              .passthrough(),
          })
          .passthrough(),
        currencyIn: z
          .object({
            amount: z
              .string()
              .regex(/^\d+$/)
              .refine((v) => BigInt(v) > 0n),
            currency: z
              .object({ decimals: z.number().int().min(0).max(30) })
              .passthrough(),
          })
          .passthrough()
          .optional(),
        minAmount: z.string().regex(/^\d+$/).optional(),
        expiresAt: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type RelayQuote = z.infer<typeof quoteSchema>;
export class RelayClient {
  constructor(
    readonly base = 'https://api.relay.link',
    private fetcher: typeof fetch = fetch,
  ) {}
  async quote(request: QuoteRequest) {
    try {
      const quote = quoteSchema.parse(
        await jsonRequest(`${this.base}/quote/v2`, request, this.fetcher),
      );
      quote.details.expiresAt ??= Date.now() + 30_000;
      return quote;
    } catch (error) {
      throw mapRelayError(error);
    }
  }
  async status(requestId: string) {
    try {
      return relayStatusSchema.parse(
        await jsonRequest(
          `${this.base}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`,
          undefined,
          this.fetcher,
        ),
      );
    } catch (error) {
      throw mapRelayError(error);
    }
  }
}
export function parseQuote(quote: RelayQuote) {
  quote = quoteSchema.parse(quote);
  const deposit = quote.steps.find((step) => step.depositAddress);
  if (!deposit?.requestId)
    throw mapRelayError('Quote missing deposit address/requestId');
  return {
    depositId: deposit.requestId,
    depositAddress: deposit.depositAddress!,
    fees: {
      app: quote.fees.app ?? quote.fees.appFees ?? null,
      gas: quote.fees.gas ?? null,
      relayer: quote.fees.relayer ?? quote.fees.relayerService ?? null,
      raw: quote.fees,
    },
    minAmount: quote.details.minAmount ?? '0',
    expectedReceived: quote.details.currencyOut.amount,
    receivedDecimals: quote.details.currencyOut.currency.decimals,
    expiresAt: quote.details.expiresAt ?? 0,
    steps: quote.steps,
  };
}

export const relayStatusSchema = z
  .object({
    status: z.string(),
    txHashes: z.array(z.string().min(1)).optional(),
    inTxHashes: z.array(z.string()).optional(),
    originChainId: z.number().int().positive().optional(),
    destinationChainId: z.number().int().positive().optional(),
    updatedAt: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type RelayStatus = z.infer<typeof relayStatusSchema>;
export function validateQuote(
  quote: RelayQuote,
  request: QuoteRequest,
  decimals: number,
  now = Date.now(),
) {
  quoteSchema.parse(quote);
  const input = quote.details.currencyIn,
    output = quote.details.currencyOut;
  const matches =
    input?.amount === request.amount &&
    input.currency.decimals === decimals &&
    input.currency.chainId === request.originChainId &&
    typeof input.currency.address === 'string' &&
    input.currency.address.toLowerCase() ===
      request.originCurrency.toLowerCase() &&
    output.currency.chainId === request.destinationChainId &&
    output.currency.address === request.destinationCurrency &&
    output.currency.decimals === 8 &&
    typeof quote.details.recipient === 'string' &&
    quote.details.recipient.toLowerCase() === request.recipient.toLowerCase();
  const parsed = parseQuote(quote);
  const validAddress = request.originCurrency.startsWith('0x')
    ? /^0x[0-9a-f]{40}$/i.test(parsed.depositAddress)
    : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(parsed.depositAddress);
  if (!matches || !validAddress || parsed.expiresAt <= now)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Funding quote does not match the complete request or has expired',
    );
  if (new Set(quote.steps.map((step) => step.id)).size !== quote.steps.length)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Funding quote has duplicate step IDs',
    );
  return parsed;
}
