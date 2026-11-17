import { withFileLock } from '../core/lock.js';
import { recoverTypedDataAddress } from 'viem';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { nextNonce } from '../core/nonce.js';
import { atomicWrite, type Config } from '../core/config.js';
import { assertSafeInput } from './safety.js';
import { ApproveAgentTypes } from '@bloxwap/hyperliquid/api/exchange/approveAgent';
import { ApproveBuilderFeeTypes } from '@bloxwap/hyperliquid/api/exchange/approveBuilderFee';
import { AgentCliError } from '../errors/index.js';
import { jsonRequest, hlEndpoint } from '../core/http.js';
export interface Approval {
  masterAddress?: string;
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
  validateApproval(network, pending);
  if (!pending.masterAddress)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Approval is not bound to a master address; regenerate it',
    );
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature))
    throw new AgentCliError('CONFIG_INVALID', 'Expected 65-byte signature');
  let recovered: string;
  try {
    recovered = await recoverTypedDataAddress({
      ...pending.typedData,
      signature,
    } as Parameters<typeof recoverTypedDataAddress>[0]);
  } catch {
    throw new AgentCliError('CONFIG_INVALID', 'Invalid approval signature');
  }
  if (recovered.toLowerCase() !== pending.masterAddress.toLowerCase())
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Signature does not belong to the configured master wallet',
    );
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
export function isFreshApproval(
  createdAt: number | undefined,
  now = Date.now(),
) {
  return (
    typeof createdAt === 'number' &&
    now >= createdAt &&
    now - createdAt < APPROVAL_MAX_AGE_MS
  );
}
export const approvalSchema = z.object({
  masterAddress: z
    .string()
    .regex(/^0x[0-9a-f]{40}$/i)
    .optional(),
  action: z.record(z.string(), z.unknown()),
  typedData: z.record(z.string(), z.unknown()),
});
export function approvalFingerprint(value: Approval) {
  const { nonce, ...action } = value.action;
  void nonce;
  return JSON.stringify({
    masterAddress: value.masterAddress?.toLowerCase(),
    action: Object.fromEntries(
      Object.entries(action).sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
}
export function validateApproval(network: Config['network'], value: Approval) {
  approvalSchema.parse(value);
  const { type, nonce, hyperliquidChain, signatureChainId, ...fields } =
    value.action;
  if (
    (type !== 'approveAgent' && type !== 'approveBuilderFee') ||
    !Number.isSafeInteger(nonce) ||
    hyperliquidChain !== (network === 'mainnet' ? 'Mainnet' : 'Testnet') ||
    signatureChainId !== '0xa4b1'
  )
    throw new AgentCliError('CONFIG_INVALID', 'Invalid approval identity');
  const expected = approval(network, type, fields, nonce as number);
  if (JSON.stringify(expected.typedData) !== JSON.stringify(value.typedData))
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Approval action and typed data disagree',
    );
}
export async function resolvePendingApproval(
  path: string,
  create: () => Promise<Approval>,
  now = Date.now(),
  force = false,
): Promise<PendingApproval> {
  return withFileLock(path + '.lock', async () => {
    const candidate = await create();
    const network =
      candidate.action.hyperliquidChain === 'Mainnet' ? 'mainnet' : 'testnet';
    validateApproval(network, candidate);
    if (!force)
      try {
        const stored = JSON.parse(
          await readFile(path, 'utf8'),
        ) as PendingApproval;
        if (stored.approval) validateApproval(network, stored.approval);
        if (
          stored.approval &&
          isFreshApproval(stored.createdAt, now) &&
          stored.expiresAt === stored.createdAt + APPROVAL_MAX_AGE_MS &&
          approvalFingerprint(stored.approval) ===
            approvalFingerprint(candidate)
        )
          return stored;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new AgentCliError(
            'CONFIG_INVALID',
            'Invalid pending approval',
            { path },
          );
      }
    const pending = {
      approval: candidate,
      createdAt: now,
      expiresAt: now + APPROVAL_MAX_AGE_MS,
    };
    await atomicWrite(path, JSON.stringify(pending));
    return pending;
  });
}
export async function submitFreshApproval(
  network: 'mainnet' | 'testnet',
  path: string,
  pending: PendingApproval,
  signature: string,
  refresh: () => Promise<Approval>,
) {
  return withFileLock(path + '.lock', async () => {
    const current = JSON.parse(await readFile(path, 'utf8')) as PendingApproval;
    if (JSON.stringify(current) !== JSON.stringify(pending))
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Approval changed; sign the current payload',
      );
    if (!isFreshApproval(pending.createdAt)) {
      const next = await resolvePendingApproval(
        path,
        refresh,
        Date.now(),
        true,
      );
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
        const next = await resolvePendingApproval(
          path,
          refresh,
          Date.now(),
          true,
        );
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Approval nonce was rejected; sign the regenerated payload',
          { expiresAt: next.expiresAt, approval: next.approval },
        );
      }
      throw error;
    }
  });
}
export const rejectMasterKey = assertSafeInput;

export async function newApproval(
  config: Config,
  type: 'approveAgent' | 'approveBuilderFee',
  fields: Record<string, unknown>,
) {
  if (!config.masterAddress)
    throw new AgentCliError('CONFIG_INVALID', 'Master address required');
  return {
    ...approval(
      config.network,
      type,
      fields,
      await nextNonce(config.masterAddress),
    ),
    masterAddress: config.masterAddress,
  };
}
