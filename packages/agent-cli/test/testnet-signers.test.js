import { afterEach, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress } from 'viem';
import { ApproveBuilderFeeTypes } from '@bloxwap/hyperliquid/api/exchange/approveBuilderFee';
import { approval as productionApproval } from '../src/wallet/approval.ts';
import {
  createTestnetRevocation,
  createTestnetSigner,
  missingTestnetConfiguration,
  requiredTestnetEnvironmentNames,
  requiredTestnetSecrets,
  requireTestnetEnvironment,
} from '../scripts/testnet-signers.mjs';

const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture(source) {
  const directory = await mkdtemp(join(tmpdir(), 'bloxwap-wallet-adapter-'));
  directories.push(directory);
  const executable = join(directory, 'user-wallet.mjs');
  await writeFile(executable, `#!${process.execPath}\n${source}\n`, {
    mode: 0o700,
  });
  return { directory, executable };
}
function baseEnv(overrides = {}) {
  return {
    BLOXWAP_E2E: '1',
    BLOXWAP_TEST_ACCOUNT_ONLY: '1',
    BLOXWAP_PRIVY_APP_ID: 'qa-owned-app',
    BLOXWAP_PRIVY_APP_SECRET: 'qa-owned-secret',
    ...overrides,
  };
}
function externalEnv(account, executable, overrides = {}) {
  return baseEnv({
    BLOXWAP_TEST_MASTER_ADDRESS: account.address,
    BLOXWAP_TEST_SIGNER: executable,
    ...overrides,
  });
}
function approval() {
  const result = createTestnetRevocation('qa-agent', Date.now());
  result.action.agentAddress = '0x' + 'a'.repeat(40);
  result.typedData.message.agentAddress = result.action.agentAddress;
  return result;
}
function builderApproval() {
  const result = approval();
  result.action = {
    type: 'approveBuilderFee',
    signatureChainId: '0xa4b1',
    hyperliquidChain: 'Testnet',
    maxFeeRate: '0.01%',
    builder: '0x' + 'b'.repeat(40),
    nonce: Date.now(),
  };
  result.typedData.types = structuredClone(ApproveBuilderFeeTypes);
  result.typedData.primaryType = 'HyperliquidTransaction:ApproveBuilderFee';
  result.typedData.message = {
    hyperliquidChain: 'Testnet',
    maxFeeRate: '0.01%',
    builder: result.action.builder,
    nonce: result.action.nonce,
  };
  return result;
}

test('preflight preserves legacy missing-name order and selects explicit external configuration', () => {
  expect(requiredTestnetSecrets).toEqual([
    'BLOXWAP_TEST_MASTER_KEY',
    'BLOXWAP_PRIVY_APP_ID',
    'BLOXWAP_PRIVY_APP_SECRET',
  ]);
  expect(missingTestnetConfiguration({})).toEqual(requiredTestnetSecrets);
  expect(
    requiredTestnetEnvironmentNames({ BLOXWAP_TEST_MASTER_ADDRESS: 'public' }),
  ).toEqual([
    'BLOXWAP_TEST_MASTER_ADDRESS',
    'BLOXWAP_TEST_SIGNER',
    'BLOXWAP_PRIVY_APP_ID',
    'BLOXWAP_PRIVY_APP_SECRET',
  ]);
  expect(
    missingTestnetConfiguration({ BLOXWAP_TEST_SIGNER: '/wallet' }),
  ).toEqual([
    'BLOXWAP_TEST_MASTER_ADDRESS',
    'BLOXWAP_PRIVY_APP_ID',
    'BLOXWAP_PRIVY_APP_SECRET',
  ]);
  expect(() => requireTestnetEnvironment({})).toThrow('BLOXWAP_E2E');
  expect(() => requireTestnetEnvironment({ BLOXWAP_E2E: '1' })).toThrow(
    'CI-only',
  );
  expect(() =>
    requireTestnetEnvironment({ BLOXWAP_E2E: '1', CI: 'true' }),
  ).toThrow('disposable');
});

test.each([
  ['agent', approval],
  ['builder', builderApproval],
])(
  'external wallet signs the public %s approval without QA app secrets in its environment',
  async (_kind, createApproval) => {
    const account = privateKeyToAccount(generatePrivateKey());
    const pending = createApproval();
    const signature = await account.signTypedData(pending.typedData);
    const { executable, directory } = await fixture(`
import {readFileSync, writeFileSync} from 'node:fs';
const request = JSON.parse(readFileSync(0, 'utf8'));
writeFileSync(new URL('./request.json', import.meta.url), JSON.stringify({request,
  hasPrivySecret: Object.hasOwn(process.env, 'BLOXWAP_PRIVY_APP_SECRET'),
  hasMasterKey: Object.hasOwn(process.env, 'BLOXWAP_TEST_MASTER_KEY')}));
process.stdout.write(JSON.stringify({signature: ${JSON.stringify(signature)}}));
`);
    const env = externalEnv(account, executable);
    const config = requireTestnetEnvironment(env);
    expect(config).toEqual({
      mode: 'external',
      address: account.address,
      executable,
    });
    const signer = await createTestnetSigner(config, env);
    expect(signer.mode).toBe('external');
    expect(await signer.sign(pending)).toBe(signature);
    expect(
      JSON.parse(await readFile(join(directory, 'request.json'), 'utf8')),
    ).toEqual({
      request: {
        schemaVersion: 1,
        network: 'testnet',
        address: account.address,
        ...pending,
      },
      hasPrivySecret: false,
      hasMasterKey: false,
    });
  },
);

test('CI-only company-disposable adapter produces real recoverable signatures for both approval types', async () => {
  const key = generatePrivateKey();
  const env = baseEnv({ CI: 'true', BLOXWAP_TEST_MASTER_KEY: key });
  const signer = await createTestnetSigner(requireTestnetEnvironment(env), env);
  expect(signer.mode).toBe('ci-master-key');
  expect(signer.address).toBe(privateKeyToAccount(key).address);
  for (const pending of [
    approval(),
    builderApproval(),
    createTestnetRevocation('qa-agent', Date.now()),
  ]) {
    const signature = await signer.sign(pending);
    expect(
      await recoverTypedDataAddress({ ...pending.typedData, signature }),
    ).toBe(signer.address);
  }
  delete env.CI;
  await expect(
    createTestnetSigner({ mode: 'ci-master-key' }, env),
  ).rejects.toThrow('CI-only');
});

test('signer accepts production approvals after the CLI JSON envelope roundtrip', async () => {
  const env = baseEnv({
    CI: 'true',
    BLOXWAP_TEST_MASTER_KEY: generatePrivateKey(),
  });
  const signer = await createTestnetSigner(requireTestnetEnvironment(env), env);
  const nonce = Date.now();
  const payloads = [
    productionApproval(
      'testnet',
      'approveAgent',
      {
        agentAddress: '0x' + 'a'.repeat(40),
        agentName: `qa-agent valid_until ${nonce + 179 * 86_400_000}`,
      },
      nonce,
    ),
    productionApproval(
      'testnet',
      'approveBuilderFee',
      {
        builder: '0x71b09A08257078A4d642F7Dd7315e656c837329a',
        maxFeeRate: '0.01%',
      },
      nonce + 1,
    ),
    productionApproval(
      'testnet',
      'approveAgent',
      {
        agentAddress: '0x' + '0'.repeat(40),
        agentName: 'qa-agent',
      },
      nonce + 2,
    ),
  ];
  for (const payload of payloads) {
    const pending = JSON.parse(JSON.stringify(payload));
    const signature = await signer.sign(pending);
    expect(
      await recoverTypedDataAddress({ ...pending.typedData, signature }),
    ).toBe(signer.address);
  }
});

test('external mode requires both opt-ins, its public address, executable and user-owned Privy app', async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const { executable } = await fixture('process.stdout.write("{}");');
  const env = externalEnv(account, executable);
  for (const name of [
    'BLOXWAP_E2E',
    'BLOXWAP_TEST_ACCOUNT_ONLY',
    'BLOXWAP_TEST_MASTER_ADDRESS',
    'BLOXWAP_TEST_SIGNER',
    'BLOXWAP_PRIVY_APP_ID',
    'BLOXWAP_PRIVY_APP_SECRET',
  ]) {
    const missing = { ...env };
    delete missing[name];
    expect(() => requireTestnetEnvironment(missing)).toThrow(name);
  }
  expect(() =>
    requireTestnetEnvironment({
      ...env,
      BLOXWAP_TEST_MASTER_KEY: generatePrivateKey(),
    }),
  ).toThrow('cannot be combined');
  expect(() =>
    requireTestnetEnvironment({
      ...env,
      BLOXWAP_TEST_MASTER_ADDRESS: 'not-a-wallet',
    }),
  ).toThrow('public Ethereum address');
  expect(() =>
    requireTestnetEnvironment({ ...env, BLOXWAP_TEST_SIGNER: 'wallet --sign' }),
  ).toThrow('absolute executable path');
  expect(() =>
    requireTestnetEnvironment({
      ...env,
      BLOXWAP_TEST_SIGNER: '/missing/qa-wallet',
    }),
  ).toThrow('accessible executable');
});

test('invalid testnet envelopes are refused before an external executable can run', async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const { executable, directory } = await fixture(`
import {writeFileSync} from 'node:fs';
writeFileSync(new URL('./invoked', import.meta.url), 'unexpected');
`);
  const env = externalEnv(account, executable);
  const signer = await createTestnetSigner(requireTestnetEnvironment(env), env);
  const mutations = [
    (p) => {
      p.action.type = 'withdraw3';
    },
    (p) => {
      p.action.hyperliquidChain = 'Mainnet';
      p.typedData.message.hyperliquidChain = 'Mainnet';
    },
    (p) => {
      p.typedData.domain.name = 'Exchange';
    },
    (p) => {
      p.typedData.domain.version = '2';
    },
    (p) => {
      p.typedData.domain.chainId = 1;
    },
    (p) => {
      p.typedData.domain.verifyingContract = '0x' + 'f'.repeat(40);
    },
    (p) => {
      p.action.signatureChainId = '0x1';
    },
    (p) => {
      p.action.nonce = 1.5;
      p.typedData.message.nonce = 1.5;
    },
    (p) => {
      p.typedData.message.agentAddress = '0x' + 'f'.repeat(40);
    },
    (p) => {
      p.typedData.types['HyperliquidTransaction:ApproveAgent'][0].type =
        'bytes32';
    },
    (p) => {
      p.typedData.primaryType = 'HyperliquidTransaction:Withdraw';
    },
    (p) => {
      p.action.extra = 'unapproved';
      p.typedData.message.extra = 'unapproved';
    },
    (p) => {
      p.action.agentName = 'x'.repeat(17);
      p.typedData.message.agentName = p.action.agentName;
    },
  ];
  for (const mutate of mutations) {
    const pending = approval();
    mutate(pending);
    await expect(signer.sign(pending)).rejects.toThrow(
      'canonical Hyperliquid testnet approvals',
    );
  }
  for (const malformed of [null, {}, { action: null, typedData: {} }])
    await expect(signer.sign(malformed)).rejects.toThrow(
      'canonical Hyperliquid testnet approvals',
    );
  await expect(readFile(join(directory, 'invoked'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test('a valid signature from another wallet cannot authorize the configured master address', async () => {
  const expected = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const pending = approval();
  const signature = await other.signTypedData(pending.typedData);
  const { executable } = await fixture(
    `process.stdout.write(JSON.stringify({signature:${JSON.stringify(signature)}}));`,
  );
  const env = externalEnv(expected, executable);
  const signer = await createTestnetSigner(requireTestnetEnvironment(env), env);
  await expect(signer.sign(pending)).rejects.toThrow(
    'does not match the test master address',
  );
});

test.each([
  'process.stdout.write("not JSON");',
  'process.stdout.write("{}{}");',
  'process.stdout.write(JSON.stringify({signature:"0x1234"}));',
  'process.stdout.write(JSON.stringify({signature:"0x1234", extra:true}));',
  'process.stderr.write("sensitive-upstream-error"); process.exit(2);',
])(
  'malformed or failed signer output is rejected without exposing child errors (%#)',
  async (source) => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { executable } = await fixture(source);
    const env = externalEnv(account, executable);
    const signer = await createTestnetSigner(
      requireTestnetEnvironment(env),
      env,
    );
    const error = await signer.sign(approval()).catch((failure) => failure);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('sensitive-upstream-error');
    expect(error.message).toMatch(
      /External test signer|invalid EIP-712 signature/,
    );
  },
);

test.each([
  ['setInterval(() => {}, 1000);', { timeoutMs: 50 }],
  ['process.stdout.write("x".repeat(10000));', { maxBuffer: 128 }],
])(
  'external execution has bounded time and output (%#)',
  async (source, options) => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { executable } = await fixture(source);
    const env = externalEnv(account, executable);
    const signer = await createTestnetSigner(
      requireTestnetEnvironment(env),
      env,
      options,
    );
    await expect(signer.sign(approval())).rejects.toThrow('time/output limit');
  },
);

test('cleanup constructs a zero-agent testnet approval with the exact requested name and nonce', () => {
  const revoke = createTestnetRevocation('qa-agent', 123456789);
  expect(revoke.action).toMatchObject({
    type: 'approveAgent',
    agentAddress: '0x' + '0'.repeat(40),
    agentName: 'qa-agent',
    nonce: 123456789,
    hyperliquidChain: 'Testnet',
    signatureChainId: '0xa4b1',
  });
  expect(revoke.typedData.message).toEqual({
    hyperliquidChain: 'Testnet',
    agentAddress: '0x' + '0'.repeat(40),
    agentName: 'qa-agent',
    nonce: 123456789,
  });
  expect(() => createTestnetRevocation('qa-agent', -1)).toThrow('canonical');
});
