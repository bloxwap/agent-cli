import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { getAddress, recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ApproveAgentTypes,
  buildApproveAgent,
} from '@bloxwap/hyperliquid/api/exchange/approveAgent';
import {
  ApproveBuilderFeeTypes,
  buildApproveBuilderFee,
} from '@bloxwap/hyperliquid/api/exchange/approveBuilderFee';

// Retain this ordering for legacy preflight reports and known-secret scanning.
export const requiredTestnetSecrets = [
  'BLOXWAP_TEST_MASTER_KEY',
  'BLOXWAP_PRIVY_APP_ID',
  'BLOXWAP_PRIVY_APP_SECRET',
];
const externalNames = ['BLOXWAP_TEST_MASTER_ADDRESS', 'BLOXWAP_TEST_SIGNER'];
const zeroAddress = '0x' + '0'.repeat(40);
const testnetDomain = {
  name: 'HyperliquidSignTransaction',
  version: '1',
  chainId: 42161,
  verifyingContract: zeroAddress,
};

function configured(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function externalMode(env) {
  return externalNames.some((name) => configured(env[name]));
}
export function requiredTestnetEnvironmentNames(env = process.env) {
  return externalMode(env)
    ? [...externalNames, 'BLOXWAP_PRIVY_APP_ID', 'BLOXWAP_PRIVY_APP_SECRET']
    : [...requiredTestnetSecrets];
}
export function missingTestnetConfiguration(env = process.env) {
  return requiredTestnetEnvironmentNames(env).filter(
    (name) => !configured(env[name]),
  );
}

export function requireTestnetEnvironment(env = process.env) {
  if (env.BLOXWAP_E2E !== '1')
    throw new Error('Explicit BLOXWAP_E2E=1 is required');
  const external = externalMode(env);
  if (external && configured(env.BLOXWAP_TEST_MASTER_KEY))
    throw new Error(
      'External-wallet mode cannot be combined with BLOXWAP_TEST_MASTER_KEY',
    );
  if (!external && !['true', '1'].includes(env.CI))
    throw new Error('Disposable company test master-key signing is CI-only');
  if (env.BLOXWAP_TEST_ACCOUNT_ONLY !== '1')
    throw new Error(
      'Explicit BLOXWAP_TEST_ACCOUNT_ONLY=1 disposable test-account acknowledgement is required',
    );
  const missing = missingTestnetConfiguration(env);
  if (missing.length)
    throw new Error(`Missing testnet configuration: ${missing.join(', ')}`);
  if (!external) return { mode: 'ci-master-key' };

  let address;
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(env.BLOXWAP_TEST_MASTER_ADDRESS))
      throw new Error('Invalid address');
    address = getAddress(env.BLOXWAP_TEST_MASTER_ADDRESS);
    if (address === zeroAddress) throw new Error('Invalid address');
  } catch {
    throw new Error(
      'BLOXWAP_TEST_MASTER_ADDRESS must be a nonzero public Ethereum address',
    );
  }
  const executable = env.BLOXWAP_TEST_SIGNER;
  if (!isAbsolute(executable))
    throw new Error(
      'BLOXWAP_TEST_SIGNER must be an absolute executable path without arguments',
    );
  try {
    if (!statSync(executable).isFile()) throw new Error('Not a file');
    accessSync(executable, constants.X_OK);
  } catch {
    throw new Error(
      'BLOXWAP_TEST_SIGNER must name an accessible executable file',
    );
  }
  return { mode: 'external', address, executable };
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())
  );
}

// Validate the actual action and its canonical EIP-712 representation before
// asking any wallet to sign. This adapter can never sign trades or withdrawals.
export function validateTestnetApproval(approval) {
  try {
    if (!exactKeys(approval, ['action', 'typedData'])) throw new Error();
    const { action, typedData } = approval;
    if (
      !exactKeys(typedData, ['domain', 'types', 'primaryType', 'message']) ||
      !isDeepStrictEqual(typedData.domain, testnetDomain) ||
      action.hyperliquidChain !== 'Testnet' ||
      action.signatureChainId !== '0xa4b1' ||
      !Number.isSafeInteger(action.nonce) ||
      action.nonce < 0
    )
      throw new Error();
    let types;
    if (action.type === 'approveAgent') {
      if (
        !exactKeys(action, [
          'type',
          'signatureChainId',
          'hyperliquidChain',
          'agentAddress',
          'agentName',
          'nonce',
        ])
      )
        throw new Error();
      buildApproveAgent({
        agentAddress: action.agentAddress,
        agentName: action.agentName,
      });
      if (typeof action.agentName !== 'string') throw new Error();
      types = ApproveAgentTypes;
    } else if (action.type === 'approveBuilderFee') {
      if (
        !exactKeys(action, [
          'type',
          'signatureChainId',
          'hyperliquidChain',
          'maxFeeRate',
          'builder',
          'nonce',
        ])
      )
        throw new Error();
      buildApproveBuilderFee({
        maxFeeRate: action.maxFeeRate,
        builder: action.builder,
      });
      types = ApproveBuilderFeeTypes;
    } else throw new Error();
    const message = Object.fromEntries(
      Object.entries(action).filter(
        ([name]) => !['type', 'signatureChainId'].includes(name),
      ),
    );
    if (
      !isDeepStrictEqual(typedData.types, types) ||
      typedData.primaryType !== Object.keys(types)[0] ||
      !isDeepStrictEqual(typedData.message, message)
    )
      throw new Error();
    return approval;
  } catch {
    // SDK errors can embed submitted data; never relay them to logs/artifacts.
    throw new Error(
      'Refusing malformed approval or action outside canonical Hyperliquid testnet approvals',
    );
  }
}

export function createTestnetRevocation(name, nonce) {
  const action = {
    type: 'approveAgent',
    signatureChainId: '0xa4b1',
    hyperliquidChain: 'Testnet',
    agentAddress: zeroAddress,
    agentName: name,
    nonce,
  };
  const approval = {
    action,
    typedData: {
      domain: { ...testnetDomain },
      types: structuredClone(ApproveAgentTypes),
      primaryType: 'HyperliquidTransaction:ApproveAgent',
      message: {
        hyperliquidChain: 'Testnet',
        agentAddress: zeroAddress,
        agentName: name,
        nonce,
      },
    },
  };
  return validateTestnetApproval(approval);
}

function externalSignature(executable, request, env, options) {
  // The external wallet needs the public approval, not the QA Privy credentials
  // or the separate CI master-key mode. No shell or command-line payload is used.
  const signerEnv = { ...env };
  for (const name of requiredTestnetSecrets) delete signerEnv[name];
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      [],
      {
        env: signerEnv,
        shell: false,
        encoding: 'utf8',
        windowsHide: true,
        timeout: options.timeoutMs,
        maxBuffer: options.maxBuffer,
        killSignal: 'SIGKILL',
      },
      (error, stdout) => {
        if (error)
          return reject(
            new Error(
              'External test signer failed or exceeded its time/output limit',
            ),
          );
        try {
          const response = JSON.parse(stdout);
          if (
            !exactKeys(response, ['signature']) ||
            typeof response.signature !== 'string'
          )
            throw new Error();
          resolve(response.signature);
        } catch {
          reject(
            new Error(
              'External test signer must return one JSON object containing only signature',
            ),
          );
        }
      },
    );
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

export async function createTestnetSigner(
  config,
  env = process.env,
  options = {},
) {
  const verified = requireTestnetEnvironment(env);
  if (!isDeepStrictEqual(config, verified))
    throw new Error(
      'Test signer configuration does not match the explicit environment',
    );
  const limits = { timeoutMs: 60_000, maxBuffer: 16_384, ...options };
  if (
    !Number.isSafeInteger(limits.timeoutMs) ||
    limits.timeoutMs < 1 ||
    limits.timeoutMs > 60_000 ||
    !Number.isSafeInteger(limits.maxBuffer) ||
    limits.maxBuffer < 1 ||
    limits.maxBuffer > 65_536
  )
    throw new Error(
      'Test signer time/output limits must be positive bounded integers',
    );
  let account;
  if (verified.mode === 'ci-master-key') {
    try {
      account = privateKeyToAccount(env.BLOXWAP_TEST_MASTER_KEY);
    } catch {
      throw new Error('Invalid disposable CI test master key');
    }
  }
  const address = verified.address ?? account.address;
  return {
    mode: verified.mode,
    address,
    async sign(approval) {
      let snapshot;
      try {
        snapshot = structuredClone(approval);
      } catch {
        throw new Error('Refusing malformed test approval');
      }
      validateTestnetApproval(snapshot);
      const signature = account
        ? await account.signTypedData(snapshot.typedData)
        : await externalSignature(
            verified.executable,
            {
              schemaVersion: 1,
              network: 'testnet',
              address,
              action: snapshot.action,
              typedData: snapshot.typedData,
            },
            env,
            limits,
          );
      let recovered;
      try {
        if (
          !/^0x[0-9a-fA-F]{130}$/.test(signature) ||
          ![0, 1, 27, 28].includes(Number.parseInt(signature.slice(-2), 16))
        )
          throw new Error();
        recovered = await recoverTypedDataAddress({
          ...snapshot.typedData,
          signature,
        });
      } catch {
        throw new Error('Test signer returned an invalid EIP-712 signature');
      }
      if (recovered.toLowerCase() !== address.toLowerCase())
        throw new Error(
          'Test signer signature does not match the test master address',
        );
      return signature;
    },
  };
}
