import { readFile } from 'node:fs/promises';
import { nextNonce } from '../core/nonce.js';
import { atomicWrite, type Config } from '../core/config.js';
import { assertSafeInput } from './safety.js';
import { ApproveAgentTypes } from '@bloxwap/hyperliquid/api/exchange/approveAgent';
import { ApproveBuilderFeeTypes } from '@bloxwap/hyperliquid/api/exchange/approveBuilderFee';
import { AgentCliError } from '../errors/index.js';
import { jsonRequest, hlEndpoint } from '../core/http.js';
export interface Approval {
  action: Record<string, unknown>;
  typedData: Record<string, unknown>;
}
// Hyperliquid accepts nonces from roughly T-2d to T+1d. Regenerating after 24h
// keeps a payload inside that window even if the user signs near the end of it.
export const APPROVAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export interface PendingApproval {
  createdAt: number;
  expiresAt: number;
  approval: Approval;
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
    const actionType = String(pending.action.type ?? 'approval');
    const rejection =
      typeof response.response === 'string'
        ? response.response
        : (JSON.stringify(response.response) ?? 'Unknown rejection');
    const nonceRejected = /nonce/i.test(rejection);
    throw new AgentCliError(
      'UPSTREAM_ERROR',
      `${actionType} failed: ${rejection}`,
      { hyperliquidResponse: response, nonceRejected },
      false,
    );
  }
  return response;
}
export function isFreshApproval(createdAt: number | undefined, now = Date.now()) {
  return (
    typeof createdAt === 'number' &&
    now >= createdAt &&
    now - createdAt < APPROVAL_MAX_AGE_MS
  );
}
export async function resolvePendingApproval(
  path: string,
  create: () => Promise<Approval>,
  now = Date.now(),
): Promise<PendingApproval> {
  try {
    const stored = JSON.parse(await readFile(path, 'utf8')) as PendingApproval &
      Approval;
    const approval = stored.approval?.action ? stored.approval : stored.action ? stored : undefined;
    if (approval?.action && isFreshApproval(stored.createdAt, now))
      return {
        approval,
        createdAt: stored.createdAt,
        expiresAt: stored.expiresAt ?? stored.createdAt + APPROVAL_MAX_AGE_MS,
      };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const pending: PendingApproval = {
    approval: await create(),
    createdAt: now,
    expiresAt: now + APPROVAL_MAX_AGE_MS,
  };
  await atomicWrite(path, JSON.stringify(pending));
  return pending;
}
export async function submitFreshApproval(
  network: 'mainnet' | 'testnet',
  path: string,
  pending: PendingApproval,
  signature: string,
  refresh: () => Promise<Approval>,
) {
  if (!isFreshApproval(pending.createdAt)) {
    const next = await resolvePendingApproval(path, refresh, Date.now());
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Approval payload expired; sign the regenerated payload',
      { expiresAt: next.expiresAt, approval: next.approval },
    );
  }
  try {
    return await submitApproval(network, pending.approval, signature);
  } catch (error) {
    if (
      error instanceof AgentCliError &&
      (error.details as { nonceRejected?: boolean } | null)?.nonceRejected
    ) {
      const next = await resolvePendingApproval(path, refresh, Date.now());
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Approval nonce was rejected; sign the regenerated payload',
        { expiresAt: next.expiresAt, approval: next.approval },
      );
    }
    throw error;
  }
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
