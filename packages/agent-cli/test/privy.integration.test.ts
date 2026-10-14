import { expect, test } from 'vitest';
import { privyClient } from '../src/wallet/privy.js';
import { migrate } from '../src/core/config.js';
test.skipIf(!process.env.BLOXWAP_PRIVY_SANDBOX)(
  'Privy sandbox credentials',
  async () => {
    const client = await privyClient(
      migrate({ privyAppId: process.env.BLOXWAP_PRIVY_APP_ID }),
    );
    expect(await client.wallets().list()).toBeDefined();
  },
);
