import type { PrivyClient } from '@privy-io/node';
import { isDeepStrictEqual } from 'node:util';
import template from '../../policies/agent-trade-only.json' with { type: 'json' };
import { AgentCliError } from '../errors/index.js';
import { mapPrivyError } from '../errors/mappers.js';
import { saveConfig, type Config } from '../core/config.js';
import type { Signer } from '../core/hlclient.js';
export const policyVersion = 2;
const allowed = new Set([
  'order',
  'cancel',
  'cancelByCloid',
  'batchModify',
  'modify',
  'updateLeverage',
  'scheduleCancel',
  'noop',
]);
export function assertTradeAction(action: string) {
  if (!allowed.has(action))
    throw new AgentCliError('POLICY_REJECTED', `Agent cannot sign ${action}`);
}
export function policyFor(network: Config['network']) {
  const policy = structuredClone(template);
  policy.rules[0].conditions[2].value = network === 'mainnet' ? 'a' : 'b';
  return policy;
}
// L1 action contents are opaque here: this validates the envelope, not the hash
// preimage. The command dispatch allowlist and Hyperliquid agent permissions are
// separate controls; neither this check nor Privy can decode connectionId.
export function assertAgentTypedData(
  data: Parameters<Signer['signTypedData']>[0],
  network: Config['network'],
) {
  const fields = data.types.Agent;
  if (
    data.domain?.name !== 'Exchange' ||
    data.domain.version !== '1' ||
    String(data.domain.chainId) !== '1337' ||
    data.domain.verifyingContract?.toLowerCase() !==
      '0x0000000000000000000000000000000000000000' ||
    Object.keys(data.domain).some(
      (key) =>
        !['name', 'version', 'chainId', 'verifyingContract'].includes(key),
    ) ||
    data.primaryType !== 'Agent' ||
    !fields ||
    fields.length !== 2 ||
    fields[0].name !== 'source' ||
    fields[0].type !== 'string' ||
    fields[1].name !== 'connectionId' ||
    fields[1].type !== 'bytes32' ||
    data.message.source !== (network === 'mainnet' ? 'a' : 'b') ||
    typeof data.message.connectionId !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(data.message.connectionId)
  )
    throw new AgentCliError(
      'POLICY_REJECTED',
      'Agent signer only accepts the configured Hyperliquid L1 Agent domain',
    );
}
function policyMatches(
  actual: Awaited<ReturnType<ReturnType<PrivyClient['policies']>['get']>>,
  expected: ReturnType<typeof policyFor>,
) {
  return (
    actual.version === expected.version &&
    actual.chain_type === expected.chain_type &&
    isDeepStrictEqual(
      actual.rules.map(({ name, method, action, conditions }) => ({
        name,
        method,
        action,
        conditions,
      })),
      expected.rules,
    )
  );
}
export async function applyPolicy(
  config: Config,
  client: PrivyClient,
  path?: string,
) {
  try {
    const expected = policyFor(config.network);
    if (config.policyId && config.policyVersion === policyVersion) {
      const existing = await client.policies().get(config.policyId);
      if (policyMatches(existing, expected)) return existing.id;
    }
    const policy = await client
      .policies()
      .create(
        expected as Parameters<
          ReturnType<PrivyClient['policies']>['create']
        >[0],
      );
    // createAgent attaches this policy with the wallet owner's authorization.
    // Persist first so a failed attach can be resumed with this same policy.
    config.policyId = policy.id;
    config.policyVersion = policyVersion;
    await saveConfig(config, path);
    return policy.id;
  } catch (error) {
    throw mapPrivyError(error);
  }
}
