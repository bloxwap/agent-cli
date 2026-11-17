import type { Config } from '../core/config.js';
import { assertApprovedNetwork } from '../core/trading.js';
import type { Signer } from '../core/hlclient.js';
import { eoaSigner } from './eoa.js';

export async function openSigner(config: Config): Promise<Signer> {
  if (config.mode !== 'paper') assertApprovedNetwork(config);
  return eoaSigner(config);
}
