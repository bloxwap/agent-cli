import { AgentCliError } from '../errors/index.js';
import { mapNetworkError } from '../errors/mappers.js';
export async function jsonRequest(
  url: string,
  body?: unknown,
  fetcher: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw mapNetworkError(error);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AgentCliError(
      'NETWORK_ERROR',
      'Response body could not be decoded',
      { outcome: body === undefined ? undefined : 'unknown' },
      false,
    );
  }
  if (!response.ok)
    throw {
      status: response.status,
      ...(data && typeof data === 'object' ? data : { message: String(data) }),
    };
  return data;
}
export const hlEndpoint = (network: 'mainnet' | 'testnet') =>
  `https://api${network === 'testnet' ? '.hyperliquid-testnet' : '.hyperliquid'}.xyz`;
export async function hlInfo<T>(
  network: 'mainnet' | 'testnet',
  type: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return (await jsonRequest(`${hlEndpoint(network)}/info`, {
    type,
    ...params,
  })) as T;
}
