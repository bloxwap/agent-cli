import { expect, test, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireTestnetEnvironment, testnetLifecycle } from '../scripts/testnet-lifecycle.mjs';

function fixture(overrides = {}) {
  let orders = [];
  let rotated = false;
  let revoked = false;
  let started = false;
  let polls = 0;
  const stop = vi.fn(async () => {});
  const checkpoint = vi.fn();
  const approvals = { agent: { kind: 'agent', typedData: {} }, builder: { kind: 'builder', typedData: {} } };
  const command = vi.fn(async (name, input = {}) => {
    if (name === 'config') return {};
    if (name === 'init') return {
      approved: !!input.builderSignature, approvals,
    };
    if (name === 'fund') return { depositId: 'fixture-deposit', expectedReceived: '0', qrAscii: 'QR' };
    if (name === 'status') return {
      deposits: [{ id: 'fixture-deposit', state: ++polls > 1 ? 'settled' : 'pending' }],
      runner: started ? { signingSession: revoked ? 'unavailable' : 'ready', wsState: 'connected' } : null,
      agent: { approved: !revoked, revoked },
    };
    if (name === 'run') {
      expect(polls).toBeGreaterThan(1);
      started = true;
      return { ready: true, network: 'testnet' };
    }
    if (name === 'market') return { mid: '100000', szDecimals: '5' };
    if (name === 'order') {
      orders = [{ oid: '1', cloid: input.cloid, limitPx: input.price }];
      return { result: { response: { data: { statuses: [{ resting: { oid: 1 } }] } } } };
    }
    if (name === 'orders') return orders;
    if (name === 'modify') {
      expect(input.modifications).toHaveLength(1);
      orders = [{ ...orders[0], oid: '2', limitPx: input.modifications[0].price }];
      return {};
    }
    if (name === 'cancel') { expect(input.oid).toBe(2); orders = []; return {}; }
    if (name === 'events') return [
      { seq: 1, type: 'runner_state' }, { seq: 2, type: 'order_update' },
    ].filter((event) => event.seq > (input.since ?? 0));
    if (name === 'rotate') {
      if (input.signature) rotated = true;
      return {
        oldAgent: '0xold', newAgent: '0xnew', swapped: rotated,
        oldRevoked: !!input.revokeSignature,
        approval: { kind: 'rotate' }, revokeApproval: { kind: 'old-revoke' },
      };
    }
    if (name === 'revoke') {
      revoked = true;
      return { locallyRevoked: true, exchangeRevoked: !!input.signature, approval: { kind: 'final-revoke' } };
    }
    if (name === 'audit') return [
      ...['order', 'modify', 'cancel', 'rotate', 'revoke'].flatMap((action) =>
        ['intent', 'response'].map((stage) => ({ stage, data: { action } }))),
      { stage: 'signature' },
    ];
    throw new Error(`Unexpected fixture command: ${name}`);
  });
  return {
    command, checkpoint, stop, masterAddress: '0xtest', appId: 'test-app',
    sign: vi.fn(async (approval) => `${approval.kind}-signature`),
    info: vi.fn(async (type) => {
      if (type === 'clearinghouseState') return { withdrawable: '30', assetPositions: [] };
      if (type === 'frontendOpenOrders') return [];
      if (type === 'extraAgents') return rotated && !revoked ? [{ address: '0xnew' }] : [];
      throw new Error(`Unexpected fixture info: ${type}`);
    }),
    startFollow: vi.fn(async () => stop), wait: vi.fn(async () => {}), now: () => 123456789,
    ...overrides,
  };
}

test('offline lifecycle driver verifies both approvals, settlement, reconciled writes, replay and revocation', async () => {
  const f = fixture();
  await testnetLifecycle(f);
  expect(f.sign.mock.calls.map(([approval]) => approval.kind)).toEqual([
    'agent', 'builder', 'rotate', 'old-revoke', 'final-revoke',
  ]);
  expect(f.command.mock.calls.find(([name]) => name === 'order')[1]).toMatchObject({ tif: 'Alo' });
  expect(f.wait).toHaveBeenCalledWith(1000);
  expect(f.checkpoint.mock.calls.filter(([stage]) => stage.status === 'passed')).toHaveLength(12);
  expect(f.stop).toHaveBeenCalledOnce();
});

test('unsettled funding stops the workflow within the documented polling budget', async () => {
  const f = fixture();
  const command = f.command;
  f.command = vi.fn(async (name, input) => name === 'status'
    ? { deposits: [{ id: 'fixture-deposit', state: 'pending' }] }
    : command(name, input));
  await expect(testnetLifecycle(f)).rejects.toThrow('polling budget');
  expect(f.command.mock.calls.filter(([name]) => name === 'status')).toHaveLength(12);
  expect(f.command.mock.calls.some(([name]) => ['run', 'order'].includes(name))).toBe(false);
});

test('a successful envelope without exchange acceptance cannot complete the lifecycle', async () => {
  const f = fixture();
  const command = f.command;
  f.command = vi.fn(async (name, input) => name === 'order'
    ? { result: { response: { data: { statuses: [{ error: 'rejected' }] } } } }
    : command(name, input));
  await expect(testnetLifecycle(f)).rejects.toThrow('resting post-only');
  expect(f.command.mock.calls.some(([name]) => name === 'rotate')).toBe(false);
  expect(f.stop).toHaveBeenCalledOnce();
});

test('a funded but non-disposable account is rejected before any write', async () => {
  const f = fixture({ info: async (type) => type === 'clearinghouseState'
    ? { withdrawable: '30', assetPositions: [{ position: { szi: '0.1' } }] } : [] });
  await expect(testnetLifecycle(f)).rejects.toThrow('no positions');
  expect(f.command).not.toHaveBeenCalled();
});

test('credential absence fails the actual entrypoint with a failure artifact and no secret output', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'bloxwap-e2e-report-'));
  try {
    const env = { ...process.env, CI: 'true', BLOXWAP_E2E: '1', BLOXWAP_TEST_ACCOUNT_ONLY: '1' };
    for (const name of ['BLOXWAP_TEST_MASTER_KEY', 'BLOXWAP_PRIVY_APP_ID', 'BLOXWAP_PRIVY_APP_SECRET']) delete env[name];
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/e2e-testnet.mjs', import.meta.url))],
      { cwd, env, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toMatch(/SKIP|PASS/);
    const report = JSON.parse(await readFile(join(cwd, 'artifacts/lifecycle-report.json'), 'utf8'));
    expect(report).toMatchObject({ status: 'failed', failure: 'testnet-preflight', stages: [] });
    expect(report.missingSecrets).toEqual(['BLOXWAP_TEST_MASTER_KEY', 'BLOXWAP_PRIVY_APP_ID', 'BLOXWAP_PRIVY_APP_SECRET']);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('CI-only test credentials and explicit test account acknowledgement are mandatory', () => {
  expect(() => requireTestnetEnvironment({})).toThrow('BLOXWAP_E2E');
  expect(() => requireTestnetEnvironment({ BLOXWAP_E2E: '1' })).toThrow('CI-only');
  expect(() => requireTestnetEnvironment({ BLOXWAP_E2E: '1', CI: 'true' })).toThrow('disposable');
});
