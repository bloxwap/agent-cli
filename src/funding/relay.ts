import { z } from 'zod';
import { jsonRequest } from '../core/http.js';
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
    status: z.string(),
    data: z.record(z.string(), z.unknown()),
    check: z.object({ endpoint: z.string(), method: z.string() }).optional(),
  })
  .passthrough();
export const quoteSchema = z
  .object({
    steps: z.array(
      z
        .object({
          id: z.string(),
          kind: z.string(),
          requestId: z.string().optional(),
          depositAddress: z.string().optional(),
          items: z.array(item),
        })
        .passthrough(),
    ),
    fees: z.record(z.string(), z.unknown()).default({}),
    details: z
      .object({
        currencyOut: z
          .object({
            amount: z.string(),
            currency: z.object({ decimals: z.number() }).passthrough(),
          })
          .passthrough(),
        currencyIn: z.object({ amount: z.string() }).passthrough().optional(),
        minAmount: z.string().optional(),
        expiresAt: z.number().optional(),
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
      return quoteSchema.parse(
        await jsonRequest(`${this.base}/quote/v2`, request, this.fetcher),
      );
    } catch (error) {
      throw mapRelayError(error);
    }
  }
  async status(requestId: string) {
    try {
      return (await jsonRequest(
        `${this.base}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`,
        undefined,
        this.fetcher,
      )) as { status: string };
    } catch (error) {
      throw mapRelayError(error);
    }
  }
}
export function parseQuote(quote: RelayQuote) {
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
    expiresAt: quote.details.expiresAt ?? Date.now() + 30_000,
    steps: quote.steps,
  };
}
