import type { Config } from '../core/config.js';
import { assertApprovedNetwork } from '../core/trading.js';
import type { Signer } from '../core/hlclient.js';
import { eoaSigner } from './eoa.js';
import { privyClient, privySigner } from './privy.js';

export async function openSigner(config: Config): Promise<Signer> {
  if (config.mode !== 'paper') assertApprovedNetwork(config);
  return config.signerType === 'eoa'
    ? eoaSigner(config)
    : privySigner(config, await privyClient(config));
}
