import { afterEach, expect, test, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/core/config.js';
import { eoaSigner, prepareEoaAgent } from '../src/wallet/eoa.js';

let directory: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function fixture() {
  directory = await mkdtemp(join(tmpdir(), 'bloxwap-eoa-'));
  const master = privateKeyToAccount(generatePrivateKey());
  const key = generatePrivateKey();
  vi.stubEnv('BLOXWAP_TEST_EOA', key);
  const config = migrate({
    signerType: 'eoa',
    eoaKeyRef: 'env:BLOXWAP_TEST_EOA',
    masterAddress: master.address,
  });
  return { config, key, master, path: join(directory, 'config.json') };
}

test('EOA onboarding derives only the public agent and persists a secret reference', async () => {
  const { config, key, path } = await fixture();
  const account = await prepareEoaAgent(config, path);
  expect(config).toMatchObject({
    signerType: 'eoa',
    agentAddress: account.address,
    eoaKeyRef: 'env:BLOXWAP_TEST_EOA',
  });
  expect(config.policyId).toBeUndefined();
  expect(config.privyWalletId).toBeUndefined();
  expect(await readFile(path, 'utf8')).not.toContain(key);
});

test('EOA signer audits valid agent signatures and rejects other action types', async () => {
  const { config, path } = await fixture();
  await prepareEoaAgent(config, path);
  const signer = await eoaSigner(config);
  const data = {
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
    message: {
      source: 'b',
      connectionId: `0x${randomBytes(32).toString('hex')}`,
    },
  };
  const signature = await signer.signTypedData(data);
  expect(signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
  await expect(
    signer.signTypedData({
      ...data,
      primaryType: 'HyperliquidTransaction:Withdraw',
    }),
  ).rejects.toMatchObject({ code: 'POLICY_REJECTED' });
});

test('EOA signer rejects master keys and silently replaced agent keys', async () => {
  const { config, master, path } = await fixture();
  await expect(
    prepareEoaAgent(
      migrate({
        signerType: 'eoa',
        eoaKeyRef: 'env:BLOXWAP_TEST_EOA',
        masterAddress: privateKeyToAccount(
          process.env.BLOXWAP_TEST_EOA as `0x${string}`,
        ).address,
      }),
      path,
    ),
  ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });

  await prepareEoaAgent(config, path);
  vi.stubEnv('BLOXWAP_TEST_EOA', generatePrivateKey());
  await expect(eoaSigner(config)).rejects.toMatchObject({
    code: 'CONFIG_INVALID',
    message: expect.stringContaining('does not match'),
  });
  config.approved = true;
  await expect(prepareEoaAgent(config, path)).rejects.toMatchObject({
    code: 'CONFIG_INVALID',
    message: expect.stringContaining('use rotate'),
  });
  expect(config.agentAddress).not.toBe(master.address);
});
