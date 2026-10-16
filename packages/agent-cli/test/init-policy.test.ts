import { expect, test, vi } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, migrate, saveConfig } from '../src/core/config.js';
import { policyFor, policyVersion } from '../src/wallet/policy.js';
import { readCommand } from '../src/commands/read.js';
import { dispatch } from '../src/core/router.js';
import '../src/commands/init.js';

const api = vi.hoisted(() => ({
  getPolicy: vi.fn(),
  createPolicy: vi.fn(),
  getWallet: vi.fn(),
  createWallet: vi.fn(),
  updateWallet: vi.fn(),
}));
vi.mock('../src/wallet/privy.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/wallet/privy.js')>()),
  privyClient: async () => ({
    policies: () => ({ get: api.getPolicy, create: api.createPolicy }),
    wallets: () => ({
      get: api.getWallet,
      create: api.createWallet,
      update: api.updateWallet,
    }),
  }),
}));
vi.mock('../src/core/http.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/core/http.js')>()),
  hlInfo: async (_network: string, method: string) => {
    if (method === 'extraAgents') return [];
    if (method === 'maxBuilderFee') return 0;
    if (method === 'clearinghouseState')
      return {
        marginSummary: {
          accountValue: '0',
          totalMarginUsed: '0',
          totalNtlPos: '0',
        },
        withdrawable: '0',
        assetPositions: [],
      };
    throw new Error(`Unexpected read: ${method}`);
  },
}));

test('init attaches the policy and revalidates it on an approved account; status reports ID/version', async () => {
  const path = join(homedir(), '.bloxwap', 'config.json');
  const wallet = {
    id: 'wallet',
    address: '0x' + 'a'.repeat(40),
    owner_id: 'local-owner',
    chain_type: 'ethereum',
    policy_ids: ['policy'],
  };
  api.createPolicy.mockResolvedValue({ ...policyFor('testnet'), id: 'policy' });
  api.createWallet.mockResolvedValue(wallet);
  api.getWallet.mockResolvedValue(wallet);
  api.getPolicy.mockResolvedValue({
    ...policyFor('testnet'),
    id: 'policy',
    rules: [],
  });
  api.updateWallet.mockResolvedValue({
    ...wallet,
    policy_ids: ['replacement'],
  });
  await saveConfig(migrate({ masterAddress: '0x' + 'b'.repeat(40) }), path);
  const result = await dispatch(['init', '--config', path, '--no-qr']);
  expect(result.body).toMatchObject({
    ok: true,
    data: { policyId: 'policy', approved: false },
  });
  expect(api.createWallet).toHaveBeenCalledWith(
    expect.objectContaining({
      policy_ids: ['policy'],
      owner: { public_key: expect.any(String) },
    }),
  );
  const config = await loadConfig(path);
  expect(config).toMatchObject({ policyId: 'policy', policyVersion });
  expect(await readCommand('status', config)).toMatchObject({
    policy: { id: 'policy', version: String(policyVersion) },
  });
  config.approved = true;
  await saveConfig(config, path);
  api.createPolicy.mockResolvedValue({
    ...policyFor('testnet'),
    id: 'replacement',
  });
  const repeated = await dispatch(['init', '--config', path, '--no-qr']);
  expect(repeated.body).toMatchObject({
    ok: true,
    data: { policyId: 'replacement', approved: true },
  });
  expect(api.updateWallet).toHaveBeenCalledWith(
    wallet.id,
    expect.objectContaining({
      policy_ids: ['replacement'],
      authorization_context: {
        authorization_private_keys: [expect.any(String)],
      },
    }),
  );
  expect(await loadConfig(path)).toMatchObject({
    policyId: 'replacement',
    policyVersion,
  });
  for (const override of [
    ['--network', 'mainnet'],
    ['--master-address', '0x' + 'c'.repeat(40)],
  ]) {
    expect(
      (await dispatch(['init', '--config', path, '--no-qr', ...override])).body,
    ).toMatchObject({ ok: false, code: 'CONFIG_INVALID' });
  }
  expect(await loadConfig(path)).toMatchObject({
    network: 'testnet',
    masterAddress: '0x' + 'b'.repeat(40),
    policyId: 'replacement',
    approved: true,
  });
  expect(api.createPolicy).toHaveBeenCalledTimes(2);
});
