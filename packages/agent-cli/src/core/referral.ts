import type { Config } from './config.js';
import { createClients } from './hlclient.js';
import { hlInfo } from './http.js';
import { nextNonce } from './nonce.js';
import { openSigner } from '../wallet/signer.js';
import { AgentCliError } from '../errors/index.js';

export async function ensureReferral(config: Config) {
  if (!config.masterAddress)
    throw new AgentCliError('CONFIG_INVALID', 'Master address required');
  const referral = await hlInfo<{
    referredBy: { code: string } | null;
  }>(config.network, 'referral', { user: config.masterAddress });
  if (referral.referredBy)
    return {
      referralCode: referral.referredBy.code,
      referralApplied: true,
    };
  const signer = await openSigner(config);
  const clients = createClients(config.network, signer, () =>
    nextNonce(signer.address),
  );
  await clients.exchange!.setReferrer!({ code: config.referralCode });
  return { referralCode: config.referralCode, referralApplied: true };
}
