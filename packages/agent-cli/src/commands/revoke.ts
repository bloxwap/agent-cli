import { z } from 'zod';
import { join } from 'node:path';
import { register } from '../core/router.js';
import { commandConfig } from './read.js';
import {
  assertApprovedNetwork,
  assertLiveMode,
  withTradeLock,
} from '../core/trading.js';
import { cancelOrders, cancelSchema } from './cancel.js';
import { saveConfig, stateDir, type Config } from '../core/config.js';
import {
  newApproval,
  submitFreshApproval,
  resolvePendingApproval,
} from '../wallet/approval.js';
import { activeRunner } from '../runner/lifecycle.js';
import { hlInfo } from '../core/http.js';
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
    return withTradeLock(config, async () => {
      if (!config.agentAddress)
        throw new AgentCliError('AGENT_NOT_APPROVED', 'No agent to revoke');
      const previous = structuredClone(config);
      markRevoked(config);
      await saveConfig(config, context.configPath);
      if (activeRunner) {
        activeRunner.signer = undefined;
        Object.assign(activeRunner.config, config);
      }
      // Local disable has committed before optional cancellation, nonce allocation,
      // signature validation or remote requests can fail.
      if (input.cancelOrders && !previous.revoked)
        await cancelOrders(previous, cancelSchema.parse({ all: true }));
      const path = join(
        stateDir(),
        `revoke-${config.network}-${config.masterAddress?.toLowerCase()}-${config.agentAddress.toLowerCase()}.json`,
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
        const agents = await hlInfo<{ address: string }[]>(
          config.network,
          'extraAgents',
          { user: config.masterAddress },
        );
        if (
          agents.some(
            (agent) =>
              agent.address.toLowerCase() ===
              config.agentAddress?.toLowerCase(),
          )
        )
          throw new AgentCliError(
            'AGENT_NOT_APPROVED',
            'Exchange revocation is not yet visible; the agent remains locally disabled',
          );
        exchangeRevoked = true;
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
    });
  },
});
