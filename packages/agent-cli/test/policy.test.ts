import { expect, test, vi } from 'vitest';
import type { PrivyClient } from '@privy-io/node';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { loadConfig, migrate } from '../src/core/config.js';
import {
  applyPolicy,
  assertTradeAction,
  policyFor,
  policyVersion,
} from '../src/wallet/policy.js';
test('trade-only action whitelist rejects withdrawal and approval', () => {
  for (const action of [
    'withdraw',
    'withdraw3',
    'usdSend',
    'spotSend',
    'approveAgent',
    'approveBuilderFee',
    'usdClassTransfer',
    'sendAsset',
    'subAccountTransfer',
    'vaultTransfer',
    'cWithdraw',
  ])
    expect(() => assertTradeAction(action)).toThrow(
      expect.objectContaining({ code: 'POLICY_REJECTED' }),
    );
  assertTradeAction('order');
  expect(policyFor('mainnet').rules[0].conditions[2].value).toBe('a');
});

function policyClient() {
  const create = vi.fn(async (policy: ReturnType<typeof policyFor>) => ({
    ...policy,
    id: 'policy-new',
  }));
  const get = vi.fn(async () => ({
    ...policyFor('testnet'),
    id: 'policy-existing',
    rules: policyFor('testnet').rules.map((rule, index) => ({
      ...rule,
      id: `rule-${index}`,
    })),
  }));
  const client = {
    policies: () => ({ create, get }),
  } as unknown as PrivyClient;
  return { client, create, get };
}

test('policy is persisted for wallet creation and verified before reuse', async () => {
  const { client, create, get } = policyClient();
  const config = migrate({});
  const path = join(homedir(), `${randomUUID()}.json`);
  expect(await applyPolicy(config, client, path)).toBe('policy-new');
  expect(create).toHaveBeenCalledWith(policyFor('testnet'));
  expect(await loadConfig(path, {})).toMatchObject({
    policyId: 'policy-new',
    policyVersion,
  });
  config.policyId = 'policy-existing';
  expect(await applyPolicy(config, client, path)).toBe('policy-existing');
  expect(get).toHaveBeenCalledWith('policy-existing');
  expect(create).toHaveBeenCalledTimes(1);
});

test('changed server rules and network are replaced instead of trusted by ID', async () => {
  const { client, create, get } = policyClient();
  const path = join(homedir(), `${randomUUID()}.json`);
  const config = migrate({ policyId: 'policy-existing', policyVersion });
  get.mockResolvedValueOnce({
    ...policyFor('testnet'),
    id: 'policy-existing',
    rules: [],
  });
  expect(await applyPolicy(config, client, path)).toBe('policy-new');
  config.policyId = 'policy-existing';
  config.network = 'mainnet';
  expect(await applyPolicy(config, client, path)).toBe('policy-new');
  expect(create).toHaveBeenLastCalledWith(policyFor('mainnet'));
});

test('policy allows only Agent domain signing and leaves other methods unallowlisted', () => {
  const policy = policyFor('testnet');
  expect(policy.rules.filter((rule) => rule.action === 'ALLOW')).toEqual([
    expect.objectContaining({ method: 'eth_signTypedData_v4' }),
  ]);
  // Privy's default policy behavior denies unmatched methods, including key export
  expect(policy.rules.filter((rule) => rule.action === 'DENY')).toEqual([]);
  expect(policy.rules[0].conditions).toContainEqual({
    field_source: 'ethereum_typed_data_domain',
    field: 'chainId',
    operator: 'eq',
    value: '1337',
  });
});
