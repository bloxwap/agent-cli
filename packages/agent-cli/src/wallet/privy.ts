import { signatureAudit } from '../core/audit.js';
import { PrivyClient, generateP256KeyPair } from '@privy-io/node';
import {
  randomUUID,
  createHash,
  createPrivateKey,
  createPublicKey,
} from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  atomicWrite,
  saveConfig,
  stateDir,
  type Config,
} from '../core/config.js';
import type { Signer } from '../core/hlclient.js';
import { AgentCliError } from '../errors/index.js';
import { mapPrivyError } from '../errors/mappers.js';
import { assertAgentTypedData } from './policy.js';
export async function resolveSecret(
  ref: string | undefined,
  env = process.env,
): Promise<string> {
  if (!ref)
    throw new AgentCliError('CONFIG_INVALID', 'Missing secret reference');
  if (ref.startsWith('env:')) {
    const value = env[ref.slice(4)];
    if (value) return value;
  }
  if (ref.startsWith('file:')) {
    const path = ref.slice(5);
    const info = await stat(path);
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Secret file must have mode 0600',
      );
    return (await readFile(path, 'utf8')).trim();
  }
  throw new AgentCliError('CONFIG_INVALID', 'Secret unavailable');
}
export async function privyClient(config: Config) {
  if (!config.privyAppId)
    throw new AgentCliError(
      'CONFIG_INVALID',
      'Create your own Privy account/app and set privyAppId; use only your app credentials locally',
    );
  return new PrivyClient({
    appId: config.privyAppId,
    appSecret: await resolveSecret(
      config.privyAppSecretRef ?? 'env:BLOXWAP_PRIVY_APP_SECRET',
    ),
  });
}
async function prepareAuthorizationKey(config: Config, path?: string) {
  if (config.authorizationKeyRef) {
    const privateKey = await resolveSecret(config.authorizationKeyRef);
    try {
      const key = createPrivateKey({
        key: Buffer.from(
          privateKey.replace(/^(wallet-auth:|wallet-api:)/, ''),
          'base64',
        ),
        format: 'der',
        type: 'pkcs8',
      });
      if (
        key.asymmetricKeyType !== 'ec' ||
        key.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
      )
        throw new Error('Expected P-256');
      return {
        privateKey,
        publicKey: createPublicKey(key)
          .export({ format: 'der', type: 'spki' })
          .toString('base64'),
      };
    } catch {
      throw new AgentCliError(
        'CONFIG_INVALID',
        'Expected a P-256 authorization key',
      );
    }
  }
  const pair = await generateP256KeyPair();
  const keyPath = join(stateDir(), `authorization-${randomUUID()}.key`);
  await atomicWrite(keyPath, pair.privateKey);
  config.authorizationKeyRef = `file:${keyPath}`;
  // Persist the owner reference before Privy can assign ownership. A lost API
  // response or later config-write failure must not strand the wallet owner.
  await saveConfig(config, path);
  return pair;
}
export async function createAgent(
  config: Config,
  client: PrivyClient,
  path?: string,
  policyId?: string,
) {
  try {
    if (!policyId)
      throw new AgentCliError('CONFIG_INVALID', 'Apply an agent policy first');
    if (config.privyWalletId) {
      let wallet = await client.wallets().get(config.privyWalletId);
      if (
        wallet.chain_type !== 'ethereum' ||
        wallet.address.toLowerCase() === config.masterAddress?.toLowerCase()
      )
        throw new AgentCliError(
          'CONFIG_INVALID',
          'Use a separate Ethereum agent wallet in your own Privy app, never your master wallet',
        );
      if (wallet.owner_id) {
        if (!config.authorizationKeyRef)
          throw new AgentCliError(
            'CONFIG_INVALID',
            'Set authorizationKeyRef to your existing wallet owner key; the CLI will not replace an existing owner',
          );
        if (wallet.policy_ids.length !== 1 || wallet.policy_ids[0] !== policyId)
          wallet = await client.wallets().update(wallet.id, {
            policy_ids: [policyId],
            authorization_context: {
              authorization_private_keys: [
                await resolveSecret(config.authorizationKeyRef),
              ],
            },
          });
      } else {
        const pair = await prepareAuthorizationKey(config, path);
        wallet = await client.wallets().update(wallet.id, {
          owner: { public_key: pair.publicKey },
          policy_ids: [policyId],
        });
      }
      if (wallet.policy_ids.length !== 1 || wallet.policy_ids[0] !== policyId)
        throw new AgentCliError(
          'POLICY_REJECTED',
          'Privy did not confirm the required agent policy attachment',
        );
      config.agentAddress = wallet.address;
      await saveConfig(config, path);
      return wallet;
    }
    const pair = await prepareAuthorizationKey(config, path);
    const wallet = await client.wallets().create({
      chain_type: 'ethereum',
      owner: { public_key: pair.publicKey },
      policy_ids: [policyId],
      idempotency_key: `agent-${createHash('sha256').update(pair.publicKey).digest('hex')}`,
    });
    config.privyWalletId = wallet.id;
    config.agentAddress = wallet.address;
    await saveConfig(config, path);
    return wallet;
  } catch (error) {
    throw mapPrivyError(error);
  }
}
export async function privySigner(
  config: Config,
  client: PrivyClient,
): Promise<Signer> {
  if (!config.agentAddress || !config.privyWalletId)
    throw new AgentCliError(
      'AGENT_NOT_APPROVED',
      'Initialize agent wallet first',
    );
  const authorizationKey = await resolveSecret(config.authorizationKeyRef);
  return {
    address: config.agentAddress as `0x${string}`,
    signTypedData: async (data) => {
      assertAgentTypedData(data, config.network);
      try {
        const signed = await client
          .wallets()
          .ethereum()
          .signTypedData(config.privyWalletId!, {
            params: {
              typed_data: {
                domain: data.domain,
                types: Object.fromEntries(
                  Object.entries(data.types).map(([key, fields]) => [
                    key,
                    [...fields],
                  ]),
                ),
                primary_type: data.primaryType,
                message: data.message,
              },
            },
            authorization_context: {
              authorization_private_keys: [authorizationKey],
            },
          });
        await signatureAudit(signed.signature);
        return signed.signature as `0x${string}`;
      } catch (error) {
        throw mapPrivyError(error);
      }
    },
  };
}
