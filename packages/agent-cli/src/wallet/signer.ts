import type { Config } from '../core/config.js';
import type { Signer } from '../core/hlclient.js';
import { eoaSigner } from './eoa.js';
import { privyClient, privySigner } from './privy.js';

export async function openSigner(config: Config): Promise<Signer> {
  return config.signerType === 'eoa'
    ? eoaSigner(config)
    : privySigner(config, await privyClient(config));
}
