import { z } from 'zod';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { register } from '../core/router.js';
import { commandConfig } from './read.js';
import {
  atomicWrite,
  saveConfig,
  stateDir,
  type Config,
} from '../core/config.js';
import { privyClient, createAgent, privySigner } from '../wallet/privy.js';
import {
  newApproval,
  submitApproval,
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
  }),
  execute: async (input, context) => {
    const current = await commandConfig(context);
    if (!current.masterAddress || !current.agentAddress)
      throw new AgentCliError('AGENT_NOT_APPROVED', 'Initialize first');
    const path = join(
      stateDir(),
      `rotation-${current.network}-${current.masterAddress}.json`,
    );
    let rotation: Rotation;
    const client = await privyClient(current);
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
        agentExpiry: Date.now() + 179 * 86400000,
        approved: false,
        revoked: false,
      };
      await createAgent(
        next,
        client,
        join(stateDir(), 'rotation-next.json'),
        current.policyId,
      );
      next.agentName = `blox-${next.agentAddress!.slice(-8)}`;
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
        swapped: false,
        revoked: false,
      };
      await atomicWrite(path, JSON.stringify(rotation));
    }
    if (input.signature) {
      await submitApproval(
        current.network,
        rotation.approval,
        input.signature as string,
      );
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
        swap: async (next) => {
          const signer = await privySigner(next, client);
          next.approved = true;
          await saveConfig(next, context.configPath);
          if (activeRunner) {
            activeRunner.signer = signer;
            Object.assign(activeRunner.config, next);
          }
          await events.append('runner_state', {
            rotation: {
              old: rotation.old.agentAddress,
              next: next.agentAddress,
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
      await submitApproval(
        current.network,
        rotation.revoke,
        input.revokeSignature as string,
      );
      rotation.revoked = true;
      await atomicWrite(path, JSON.stringify(rotation));
    }
    return {
      oldAgent: rotation.old.agentAddress,
      newAgent: rotation.next.agentAddress,
      swapped: rotation.swapped,
      oldRevoked: rotation.revoked,
      requiresSignature: !rotation.swapped,
      approval: rotation.approval,
      ...(rotation.swapped ? { revokeApproval: rotation.revoke } : {}),
    };
  },
});
