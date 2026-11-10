import { z } from 'zod';
import { join } from 'node:path';
import { register } from '../core/router.js';
import { commandConfig } from './read.js';
import { assertApprovedNetwork, assertLiveMode } from '../core/trading.js';
import { cancelOrders, cancelSchema } from './cancel.js';
import { saveConfig, stateDir, type Config } from '../core/config.js';
import {
  newApproval,
  submitFreshApproval,
  resolvePendingApproval,
} from '../wallet/approval.js';
import { activeRunner } from '../runner/lifecycle.js';
import { AgentCliError } from '../errors/index.js';
export function markRevoked(config: Config) {
  config.revoked = true;
  config.approved = false;
  return config;
}
register('revoke', {
  description:
    'Disable local agent and prepare master-signed exchange revocation',
  schema: z.object({
    cancelOrders: z.boolean().default(false),
    signature: z.string().optional(),
  }),
  execute: async (input, context) => {
    const config = await commandConfig(context);
    assertLiveMode(config, 'revoke');
    assertApprovedNetwork(config);
    if (!config.agentAddress)
      throw new AgentCliError('AGENT_NOT_APPROVED', 'No agent to revoke');
    if (input.cancelOrders && !config.revoked)
      await cancelOrders(config, cancelSchema.parse({ all: true }));
    const path = join(
      stateDir(),
      `revoke-${config.network}-${config.agentAddress}.json`,
    );
    const refresh = () =>
      newApproval(config, 'approveAgent', {
        agentAddress: '0x' + '0'.repeat(40),
        agentName: config.agentName,
      });
    const pending = await resolvePendingApproval(path, refresh);
    let exchangeRevoked = false;
    if (input.signature) {
      await submitFreshApproval(
        config.network,
        path,
        pending,
        input.signature as string,
        refresh,
      );
      exchangeRevoked = true;
      config.authorizationKeyRef = undefined;
      config.privyWalletId = undefined;
      config.eoaKeyRef = undefined;
    }
    markRevoked(config);
    await saveConfig(config, context.configPath);
    if (activeRunner) {
      activeRunner.signer = undefined;
      Object.assign(activeRunner.config, config);
    }
    return {
      agentAddress: config.agentAddress,
      locallyRevoked: true,
      exchangeRevoked,
      requiresSignature: !exchangeRevoked,
      expiresAt: pending.expiresAt,
      approval: pending.approval,
    };
  },
});
