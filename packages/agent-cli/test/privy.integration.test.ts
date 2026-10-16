import { expect, test } from 'vitest';
import { generateP256KeyPair } from '@privy-io/node';
import { Withdraw3Types } from '@bloxwap/hyperliquid/api/exchange/withdraw3';
import { privyClient } from '../src/wallet/privy.js';
import { policyFor } from '../src/wallet/policy.js';
import { migrate } from '../src/core/config.js';
import { mapPrivyError } from '../src/errors/mappers.js';

// This explicitly creates empty resources in the user's dedicated Privy app.
// Never use a master wallet or a funded wallet. No Hyperliquid request is sent.
test('user-owned Privy policy allows Agent signing and rejects a direct withdrawal-type request', async () => {
  const missing = ['BLOXWAP_PRIVY_APP_ID', 'BLOXWAP_PRIVY_APP_SECRET'].filter(
    (name) => !process.env[name],
  );
  if (process.env.BLOXWAP_PRIVY_SANDBOX !== '1')
    missing.unshift('BLOXWAP_PRIVY_SANDBOX=1');
  if (missing.length)
    throw new Error(
      `Privy sandbox test not run. Configure your own dedicated test app: ${missing.join(', ')}`,
    );
  const client = await privyClient(
    migrate({ privyAppId: process.env.BLOXWAP_PRIVY_APP_ID }),
  );
  const pair = await generateP256KeyPair();
  const policy = await client.policies().create({
    ...policyFor('testnet'),
    name: `agent-cli sandbox ${Date.now()}`,
  } as Parameters<ReturnType<typeof client.policies>['create']>[0]);
  const wallet = await client.wallets().create({
    chain_type: 'ethereum',
    owner: { public_key: pair.publicKey },
    policy_ids: [policy.id],
  });
  expect((await client.wallets().get(wallet.id)).policy_ids).toEqual([
    policy.id,
  ]);
  const authorization_context = {
    authorization_private_keys: [pair.privateKey],
  };
  const zeroAddress = '0x' + '0'.repeat(40);
  const domain = {
    name: 'Exchange',
    version: '1',
    chainId: 1337,
    verifyingContract: zeroAddress,
  };
  const signed = await client
    .wallets()
    .ethereum()
    .signTypedData(wallet.id, {
      params: {
        typed_data: {
          domain,
          types: {
            Agent: [
              { name: 'source', type: 'string' },
              { name: 'connectionId', type: 'bytes32' },
            ],
          },
          primary_type: 'Agent',
          message: { source: 'b', connectionId: '0x' + '1'.repeat(64) },
        },
      },
      authorization_context,
    });
  expect(signed.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
  // Deliberately bypass privySigner/assertAgentTypedData so this assertion
  // tests Privy's policy rejection rather than the local allowlist.
  const withdrawal = client
    .wallets()
    .ethereum()
    .signTypedData(wallet.id, {
      params: {
        typed_data: {
          domain: {
            ...domain,
            name: 'HyperliquidSignTransaction',
            chainId: 42161,
          },
          types: Withdraw3Types,
          primary_type: 'HyperliquidTransaction:Withdraw',
          message: {
            hyperliquidChain: 'Testnet',
            destination: zeroAddress,
            amount: '1',
            time: Date.now(),
          },
        },
      },
      authorization_context,
    });
  await expect(
    withdrawal.catch((error: unknown) => Promise.reject(mapPrivyError(error))),
  ).rejects.toMatchObject({ code: 'POLICY_REJECTED' });
}, 60_000);
