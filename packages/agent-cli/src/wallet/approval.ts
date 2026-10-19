import { nextNonce } from '../core/nonce.js';
import type { Config } from '../core/config.js';
import { assertSafeInput } from './safety.js';
import { ApproveAgentTypes } from '@bloxwap/hyperliquid/api/exchange/approveAgent';
import { ApproveBuilderFeeTypes } from '@bloxwap/hyperliquid/api/exchange/approveBuilderFee';
import { AgentCliError } from '../errors/index.js';
import { jsonRequest, hlEndpoint } from '../core/http.js';
export interface Approval {
  action: Record<string, unknown>;
  typedData: Record<string, unknown>;
}
export function approval(
  network: 'mainnet' | 'testnet',
  type: 'approveAgent' | 'approveBuilderFee',
  fields: Record<string, unknown>,
  nonce = Date.now(),
): Approval {
  const types =
    type === 'approveAgent' ? ApproveAgentTypes : ApproveBuilderFeeTypes;
  const action = {
    type,
    signatureChainId: '0xa4b1',
    hyperliquidChain: network === 'mainnet' ? 'Mainnet' : 'Testnet',
    ...fields,
    nonce,
  };
  const { type: _type, signatureChainId: _chain, ...message } = action;
  void _type;
  void _chain;
  return {
    action,
    typedData: {
      domain: {
        name: 'HyperliquidSignTransaction',
        version: '1',
        chainId: 42161,
        verifyingContract: '0x' + '0'.repeat(40),
      },
      types,
      primaryType: Object.keys(types)[0],
      message,
    },
  };
}
export async function submitApproval(
  network: 'mainnet' | 'testnet',
  pending: Approval,
  signature: string,
) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new AgentCliError('CONFIG_INVALID', 'Expected 65-byte signature');
  const recovery = parseInt(signature.slice(-2), 16);
  const v = recovery < 27 ? recovery + 27 : recovery;
  if (v !== 27 && v !== 28)
    throw new AgentCliError('CONFIG_INVALID', 'Invalid signature recovery');
  const response = (await jsonRequest(`${hlEndpoint(network)}/exchange`, {
    action: pending.action,
    nonce: pending.action.nonce,
    signature: {
      r: signature.slice(0, 66),
      s: '0x' + signature.slice(66, 130),
      v,
    },
  })) as { status: string; response: unknown };
  if (response.status !== 'ok') {
    const actionType = pending.action.type || 'unknown';
    const responseText = typeof response.response === 'string' 
      ? response.response 
      : JSON.stringify(response.response);
    throw new AgentCliError(
      'UPSTREAM_ERROR', 
      `${actionType} failed: ${responseText}`,
      { hyperliquidResponse: response }
    );
  }
  return response;
}
export const rejectMasterKey = assertSafeInput;

export async function newApproval(
  config: Config,
  type: 'approveAgent' | 'approveBuilderFee',
  fields: Record<string, unknown>,
) {
  if (!config.masterAddress)
    throw new AgentCliError('CONFIG_INVALID', 'Master address required');
  return approval(
    config.network,
    type,
    fields,
    await nextNonce(config.masterAddress),
  );
}
