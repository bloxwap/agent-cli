import { z } from 'zod';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { register } from '../core/router.js';
import { commandConfig } from './read.js';
import { assertApprovedNetwork, assertLiveMode } from '../core/trading.js';
import {
  atomicWrite,
  copyAgentFields,
  updateConfig,
  configPath,
  stateDir,
  type Config,
} from '../core/config.js';
import { privyClient, createAgent } from '../wallet/privy.js';
import { prepareEoaAgent } from '../wallet/eoa.js';
import { openSigner } from '../wallet/signer.js';
import {
  newApproval,
  submitApproval,
  isFreshApproval,
  APPROVAL_MAX_AGE_MS,
  type Approval,
} from '../wallet/approval.js';
import { hlInfo } from '../core/http.js';
import { activeRunner } from '../runner/lifecycle.js';
import { AgentCliError } from '../errors/index.js';
import { events } from '../runner/events.js';
export interface Rotation {
  old: Config;
  next: Config;
  approval: Approval;
  revoke: Approval;
  approvalCreatedAt?: number;
  approvalExpiresAt?: number;
  revokeCreatedAt?: number;
  revokeExpiresAt?: number;
  swapped: boolean;
  revoked: boolean;
}
export async function rotationHandoff(
  rotation: Rotation,
  dependencies: {
    verify: () => Promise<boolean>;
    swap: (next: Config) => Promise<void>;
    persist: () => Promise<void>;
  },
) {
  if (!(await dependencies.verify()))
    throw new AgentCliError(
      'AGENT_NOT_APPROVED',
      'New agent approval not visible; old agent remains active',
    );
  if (!rotation.swapped) {
    await dependencies.swap(rotation.next);
    rotation.swapped = true;
    await dependencies.persist();
  }
  return rotation.revoke;
}
register('rotate', {
  description: 'Approve new agent, hot-swap signer, then revoke old agent',
  schema: z.object({
    signature: z.string().optional(),
    revokeSignature: z.string().optional(),
    eoaKeyRef: z
      .string()
      .regex(/^env:[A-Z_][A-Z0-9_]*$|^file:.+/)
      .optional(),
  }),
  execute: async (input, context) => {
    const current = await commandConfig(context);
    assertLiveMode(current, 'rotate');
    assertApprovedNetwork(current);
    if (!current.masterAddress || !current.agentAddress)
      throw new AgentCliError('AGENT_NOT_APPROVED', 'Initialize first');
    const path = join(
      stateDir(),
      `rotation-${current.network}-${current.masterAddress}.json`,
    );
    let rotation: Rotation;
    const client =
      current.signerType === 'privy' ? await privyClient(current) : undefined;
    try {
      rotation = JSON.parse(await readFile(path, 'utf8'));
      if (rotation.revoked && !input.signature && !input.revokeSignature) {
        await atomicWrite(
          `${path}.${Date.now()}.previous`,
          JSON.stringify(rotation),
        );
        throw Object.assign(new Error('Begin next rotation'), {
          code: 'ENOENT',
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const next: Config = {
        ...structuredClone(current),
        privyWalletId: undefined,
        agentAddress: undefined,
        authorizationKeyRef: undefined,
        eoaKeyRef: undefined,
        agentExpiry: Date.now() + 179 * 86400000,
        approved: false,
        revoked: false,
      };
      if (current.signerType === 'eoa') {
        await prepareEoaAgent(
          next,
          join(stateDir(), 'rotation-next.json'),
          input.eoaKeyRef as string | undefined,
        );
      } else {
        await createAgent(
          next,
          client!,
          join(stateDir(), 'rotation-next.json'),
          current.policyId,
        );
      }
      if (next.agentAddress === current.agentAddress)
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Rotation requires a different EOA agent key',
        );
      next.agentName = `blox-${next.agentAddress!.slice(-8)}`;
      const now = Date.now();
      rotation = {
        old: current,
        next,
        approval: await newApproval(current, 'approveAgent', {
          agentAddress: next.agentAddress,
          agentName: `${next.agentName} valid_until ${next.agentExpiry}`,
        }),
        revoke: await newApproval(current, 'approveAgent', {
          agentAddress: '0x' + '0'.repeat(40),
          agentName: current.agentName,
        }),
        approvalCreatedAt: now,
        approvalExpiresAt: now + APPROVAL_MAX_AGE_MS,
        revokeCreatedAt: now,
        revokeExpiresAt: now + APPROVAL_MAX_AGE_MS,
        swapped: false,
        revoked: false,
      };
      await atomicWrite(path, JSON.stringify(rotation));
    }
    if (!rotation.swapped && !isFreshApproval(rotation.approvalCreatedAt)) {
      const now = Date.now();
      rotation.approval = await newApproval(current, 'approveAgent', {
        agentAddress: rotation.next.agentAddress,
        agentName: `${rotation.next.agentName} valid_until ${rotation.next.agentExpiry}`,
      });
      rotation.approvalCreatedAt = now;
      rotation.approvalExpiresAt = now + APPROVAL_MAX_AGE_MS;
      await atomicWrite(path, JSON.stringify(rotation));
      if (input.signature)
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Approval payload expired; sign the regenerated payload',
          { expiresAt: rotation.approvalExpiresAt, approval: rotation.approval },
        );
    }
    if (!rotation.revoked && !isFreshApproval(rotation.revokeCreatedAt)) {
      const now = Date.now();
      rotation.revoke = await newApproval(current, 'approveAgent', {
        agentAddress: '0x' + '0'.repeat(40),
        agentName: rotation.old.agentName,
      });
      rotation.revokeCreatedAt = now;
      rotation.revokeExpiresAt = now + APPROVAL_MAX_AGE_MS;
      await atomicWrite(path, JSON.stringify(rotation));
      if (input.revokeSignature)
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Revoke payload expired; sign the regenerated payload',
          {
            expiresAt: rotation.revokeExpiresAt,
            revokeApproval: rotation.revoke,
          },
        );
    }
    const refreshSigned = async (
      kind: 'approval' | 'revoke',
      signature: string,
    ) => {
      try {
        await submitApproval(current.network, rotation[kind], signature);
      } catch (error) {
        if (
          !(error instanceof AgentCliError) ||
          !(error.details as { nonceRejected?: boolean } | null)?.nonceRejected
        )
          throw error;
        const now = Date.now();
        rotation[kind] = await newApproval(current, 'approveAgent', {
          agentAddress:
            kind === 'approval'
              ? rotation.next.agentAddress
              : '0x' + '0'.repeat(40),
          agentName:
            kind === 'approval'
              ? `${rotation.next.agentName} valid_until ${rotation.next.agentExpiry}`
              : rotation.old.agentName,
        });
        if (kind === 'approval') {
          rotation.approvalCreatedAt = now;
          rotation.approvalExpiresAt = now + APPROVAL_MAX_AGE_MS;
        } else {
          rotation.revokeCreatedAt = now;
          rotation.revokeExpiresAt = now + APPROVAL_MAX_AGE_MS;
        }
        await atomicWrite(path, JSON.stringify(rotation));
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Approval nonce was rejected; sign the regenerated payload',
          {
            expiresAt:
              kind === 'approval'
                ? rotation.approvalExpiresAt
                : rotation.revokeExpiresAt,
            approval: rotation[kind],
          },
        );
      }
    };
    if (input.signature) {
      await refreshSigned('approval', input.signature as string);
      await rotationHandoff(rotation, {
        verify: async () => {
          const agents = await hlInfo<
            { address: string; validUntil: number }[]
          >(current.network, 'extraAgents', { user: current.masterAddress });
          return agents.some(
            (a) =>
              a.address.toLowerCase() ===
                rotation.next.agentAddress?.toLowerCase() &&
              a.validUntil >= rotation.next.agentExpiry!,
          );
        },
        swap: async (nextConfig) => {
          const saved = await updateConfig(
            context.configPath ?? configPath(),
            (latest) => {
              copyAgentFields(latest, nextConfig);
              latest.approved = true;
              latest.revoked = false;
            },
          );
          const signer = await openSigner(saved);
          if (activeRunner) {
            activeRunner.signer = signer;
            copyAgentFields(activeRunner.config, saved);
            activeRunner.config.approved = true;
            activeRunner.config.revoked = false;
          }
          await events.append('runner_state', {
            rotation: {
              old: rotation.old.agentAddress,
              next: nextConfig.agentAddress,
            },
          });
        },
        persist: () => atomicWrite(path, JSON.stringify(rotation)),
      });
    }
    if (input.revokeSignature) {
      if (!rotation.swapped)
        throw new AgentCliError(
          'POLICY_REJECTED',
          'Approve and swap new agent before revoking old',
        );
      await refreshSigned('revoke', input.revokeSignature as string);
      rotation.revoked = true;
      await atomicWrite(path, JSON.stringify(rotation));
    }
    return {
      oldAgent: rotation.old.agentAddress,
      newAgent: rotation.next.agentAddress,
      swapped: rotation.swapped,
      oldRevoked: rotation.revoked,
      requiresSignature: !rotation.swapped,
      approvalExpiresAt: rotation.approvalExpiresAt ?? null,
      revokeExpiresAt: rotation.swapped
        ? (rotation.revokeExpiresAt ?? null)
        : undefined,
      approval: rotation.approval,
      ...(rotation.swapped ? { revokeApproval: rotation.revoke } : {}),
    };
  },
});
