import { AgentCliError } from '../errors/index.js';
import type { Config } from '../core/config.js';
import type { Signer } from '../core/hlclient.js';
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
// L1 action contents are opaque here: this validates the envelope, not the hash
// preimage. The command dispatch allowlist and Hyperliquid agent permissions are
// separate controls; this check cannot decode connectionId.
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
