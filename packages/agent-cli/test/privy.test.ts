import { expect, test, vi } from 'vitest';
import type { PrivyClient } from '@privy-io/node';
import { Withdraw3Types } from '@bloxwap/hyperliquid/api/exchange/withdraw3';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createAgent,
  privyClient,
  privySigner,
  resolveSecret,
} from '../src/wallet/privy.js';
import { loadConfig, migrate } from '../src/core/config.js';

const agentData = () => ({
  domain: {
    name: 'Exchange',
    version: '1',
    chainId: 1337,
    verifyingContract: ('0x' + '0'.repeat(40)) as `0x${string}`,
  },
  types: {
    Agent: [
      { name: 'source', type: 'string' },
      { name: 'connectionId', type: 'bytes32' },
    ],
  },
  primaryType: 'Agent',
  message: { source: 'b', connectionId: '0x' + '1'.repeat(64) },
});
test('remote typed-data signing preserves EIP-712 and maps denial', async () => {
  const signTypedData = vi.fn().mockResolvedValue({ signature: '0x1234' });
  const client = {
    wallets: () => ({ ethereum: () => ({ signTypedData }) }),
  } as unknown as PrivyClient;
  process.env.BLOXWAP_TEST_AUTH = 'test-key';
  try {
    const signer = await privySigner(
      migrate({
        agentAddress: '0x' + 'a'.repeat(40),
        privyWalletId: 'wallet',
        authorizationKeyRef: 'env:BLOXWAP_TEST_AUTH',
      }),
      client,
    );
    const data = agentData();
    expect(await signer.signTypedData(data)).toBe('0x1234');
    expect(signTypedData.mock.calls[0][1].params.typed_data.primary_type).toBe(
      'Agent',
    );
    signTypedData.mockRejectedValue(new Error('Policy denied'));
    await expect(signer.signTypedData(data)).rejects.toMatchObject({
      code: 'POLICY_REJECTED',
    });
  } finally {
    delete process.env.BLOXWAP_TEST_AUTH;
  }
  expect(
    await resolveSecret('env:BLOXWAP_SECRET', { BLOXWAP_SECRET: 'ok' }),
  ).toBe('ok');
});

test('signer refuses master actions and wrong domains before contacting Privy', async () => {
  const signTypedData = vi.fn();
  const client = {
    wallets: () => ({ ethereum: () => ({ signTypedData }) }),
  } as unknown as PrivyClient;
  vi.stubEnv('BLOXWAP_TEST_AUTH', 'test-key');
  try {
    const signer = await privySigner(
      migrate({
        agentAddress: '0x' + 'a'.repeat(40),
        privyWalletId: 'wallet',
        authorizationKeyRef: 'env:BLOXWAP_TEST_AUTH',
      }),
      client,
    );
    const valid = agentData();
    for (const data of [
      {
        domain: {
          ...valid.domain,
          name: 'HyperliquidSignTransaction',
          chainId: 42161,
        },
        types: Withdraw3Types,
        primaryType: 'HyperliquidTransaction:Withdraw',
        message: {
          hyperliquidChain: 'Testnet',
          destination: '0x' + '0'.repeat(40),
          amount: '1',
          time: Date.now(),
        },
      },
      { ...valid, primaryType: 'HyperliquidTransaction:Withdraw' },
      { ...valid, primaryType: 'HyperliquidTransaction:ApproveAgent' },
      { ...valid, domain: { ...valid.domain, name: 'Another exchange' } },
      { ...valid, domain: { ...valid.domain, version: '2' } },
      { ...valid, domain: { ...valid.domain, chainId: 42161 } },
      {
        ...valid,
        domain: { ...valid.domain, verifyingContract: '0x1' as `0x${string}` },
      },
      { ...valid, message: { ...valid.message, source: 'a' } },
      { ...valid, message: { ...valid.message, connectionId: '0x1' } },
      { ...valid, types: { Agent: [{ name: 'source', type: 'string' }] } },
    ])
      await expect(signer.signTypedData(data)).rejects.toMatchObject({
        code: 'POLICY_REJECTED',
      });
    expect(signTypedData).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});

test('linking an unowned agent assigns a local owner and policy together', async () => {
  const wallet = {
    id: 'unowned-agent',
    chain_type: 'ethereum',
    address: '0x' + 'a'.repeat(40),
    owner_id: null,
    policy_ids: [],
  };
  const update = vi.fn(async () => ({
    ...wallet,
    owner_id: 'new-local-owner',
    policy_ids: ['policy'],
  }));
  const client = {
    wallets: () => ({ get: async () => wallet, update }),
  } as unknown as PrivyClient;
  const config = migrate({ privyWalletId: wallet.id });
  await createAgent(
    config,
    client,
    join(homedir(), `${randomUUID()}.json`),
    'policy',
  );
  expect(update).toHaveBeenCalledWith(wallet.id, {
    owner: { public_key: expect.any(String) },
    policy_ids: ['policy'],
  });
  const authorizationKey = await resolveSecret(config.authorizationKeyRef);
  expect(authorizationKey.length).toBeGreaterThan(0);
  expect(JSON.stringify(update.mock.calls)).not.toContain(authorizationKey);
});

test('owned wallet policy updates use the local owner key and preserve ownership', async () => {
  const wallet = {
    id: 'wallet',
    chain_type: 'ethereum',
    address: '0x' + 'a'.repeat(40),
    owner_id: 'user-owner',
    policy_ids: ['old-policy'],
  };
  const update = vi.fn(
    async (_id: string, params: { policy_ids: string[] }) => ({
      ...wallet,
      policy_ids: params.policy_ids,
    }),
  );
  const client = {
    wallets: () => ({ get: async () => wallet, update }),
  } as unknown as PrivyClient;
  vi.stubEnv('BLOXWAP_TEST_AUTH', 'user-local-owner-key');
  try {
    const config = migrate({
      privyWalletId: wallet.id,
      authorizationKeyRef: 'env:BLOXWAP_TEST_AUTH',
    });
    await createAgent(
      config,
      client,
      join(homedir(), `${randomUUID()}.json`),
      'new-policy',
    );
    expect(update).toHaveBeenCalledWith(wallet.id, {
      policy_ids: ['new-policy'],
      authorization_context: {
        authorization_private_keys: ['user-local-owner-key'],
      },
    });
    await expect(
      createAgent(
        migrate({ privyWalletId: wallet.id }),
        client,
        undefined,
        'policy',
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    await expect(
      createAgent(
        migrate({
          privyWalletId: wallet.id,
          masterAddress: wallet.address,
          authorizationKeyRef: 'env:BLOXWAP_TEST_AUTH',
        }),
        client,
        undefined,
        'policy',
      ),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    expect(update).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllEnvs();
  }
});

test('Privy onboarding requires credentials for the user’s own app', async () => {
  await expect(privyClient(migrate({}))).rejects.toMatchObject({
    code: 'CONFIG_INVALID',
    message: expect.stringContaining('your own Privy account/app'),
  });
});

test('a lost wallet-create response reuses the persisted owner and idempotency key', async () => {
  const path = join(homedir(), `${randomUUID()}.json`);
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error('ECONNRESET after remote create'))
    .mockResolvedValueOnce({ id: 'recovered', address: '0x' + 'a'.repeat(40) });
  const client = { wallets: () => ({ create }) } as unknown as PrivyClient;
  await expect(
    createAgent(migrate({}), client, path, 'policy'),
  ).rejects.toMatchObject({
    code: 'NETWORK_ERROR',
  });
  const recovered = await loadConfig(path, {});
  expect(recovered.authorizationKeyRef).toMatch(/^file:/);
  await createAgent(recovered, client, path, 'policy');
  expect(create.mock.calls[1][0]).toEqual(create.mock.calls[0][0]);
  expect(await loadConfig(path, {})).toMatchObject({
    privyWalletId: 'recovered',
  });
});

test('a lost link response retains the local owner key for policy-attachment recovery', async () => {
  const path = join(homedir(), `${randomUUID()}.json`);
  const wallet = {
    id: 'agent',
    chain_type: 'ethereum',
    address: '0x' + 'a'.repeat(40),
    owner_id: null as string | null,
    policy_ids: [] as string[],
  };
  const update = vi.fn(async (): Promise<typeof wallet> => {
    wallet.owner_id = 'assigned-owner';
    throw new Error('ECONNRESET after remote ownership change');
  });
  const client = {
    wallets: () => ({ get: async () => wallet, update }),
  } as unknown as PrivyClient;
  await expect(
    createAgent(migrate({ privyWalletId: wallet.id }), client, path, 'policy'),
  ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  const recovered = await loadConfig(path, {});
  const authorizationKey = await resolveSecret(recovered.authorizationKeyRef);
  update.mockImplementationOnce(async () => {
    wallet.policy_ids = ['policy'];
    return wallet;
  });
  await createAgent(recovered, client, path, 'policy');
  expect(update).toHaveBeenLastCalledWith(wallet.id, {
    policy_ids: ['policy'],
    authorization_context: { authorization_private_keys: [authorizationKey] },
  });
});
