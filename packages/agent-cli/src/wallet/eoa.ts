import { privateKeyToAccount } from 'viem/accounts';
import { saveConfig, type Config } from '../core/config.js';
import { signatureAudit } from '../core/audit.js';
import { AgentCliError } from '../errors/index.js';
import type { Signer } from '../core/hlclient.js';
import { resolveSecret } from './secret.js';
import { assertAgentTypedData } from './policy.js';

async function eoaAccount(config: Config, keyRef = config.eoaKeyRef) {
  if (!keyRef)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Set eoaKeyRef to an env: or file: reference for your own EOA agent key',
    );
  const privateKey = await resolveSecret(keyRef);
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey))
    throw new AgentCliError(
      'CONFIG_INVALID',
      'EOA key reference must resolve to a 32-byte hexadecimal key',
    );
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  if (account.address.toLowerCase() === config.masterAddress?.toLowerCase())
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Use a separate EOA agent, never the master wallet key',
    );
  return account;
}

export async function prepareEoaAgent(
  config: Config,
  path?: string,
  keyRef = config.eoaKeyRef,
) {
  const account = await eoaAccount(config, keyRef);
  if (
    config.approved &&
    config.agentAddress &&
    account.address.toLowerCase() !== config.agentAddress.toLowerCase()
  )
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Approved EOA cannot be replaced with init; use rotate',
    );
  config.eoaKeyRef = keyRef;
  config.agentAddress = account.address;
  await saveConfig(config, path);
  return account;
}

export async function eoaSigner(config: Config): Promise<Signer> {
  if (!config.agentAddress)
    throw new AgentCliError('AGENT_NOT_APPROVED', 'Initialize EOA agent first');
  const account = await eoaAccount(config);
  if (account.address.toLowerCase() !== config.agentAddress.toLowerCase())
    throw new AgentCliError(
      'CONFIG_INVALID',
      'EOA key does not match agentAddress; use rotate to change agents',
    );
  // Expose only the guarded method. Spreading the viem account also exposes its
  // raw signing methods, which callers can use to skip the domain check and audit.
  return {
    address: account.address,
    signTypedData: async (data) => {
      assertAgentTypedData(data, config.network);
      const signature = await account.signTypedData(data);
      await signatureAudit(signature);
      return signature;
    },
  };
}
