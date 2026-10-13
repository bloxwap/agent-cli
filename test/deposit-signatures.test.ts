import { expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writeDeposits,
  type Deposit,
  readDeposits,
} from '../src/funding/store.js';
import {
  signatureSteps,
  submitDepositSignature,
} from '../src/funding/signatures.js';
import { quoteFixture } from './fixtures.js';
test('signature steps are ordered, typed and resumable without replaying completed steps', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-signatures-'));
  const path = join(dir, 'deposits.json');
  const quote: Deposit['quote'] = structuredClone(quoteFixture);
  quote.steps = [
    {
      id: 'first',
      kind: 'signature',
      requestId: 'deposit',
      depositAddress: '0x' + 'a'.repeat(40),
      items: [
        {
          status: 'incomplete',
          data: {
            sign: {
              signatureKind: 'eip712',
              domain: { name: 'Relay' },
              types: { Mapping: [] },
              primaryType: 'Mapping',
              value: { nonce: 1 },
            },
            post: {
              method: 'POST',
              endpoint: '/authorize',
              body: { nonce: 1 },
            },
          },
        },
      ],
    },
    {
      id: 'second',
      kind: 'signature',
      requestId: 'deposit',
      depositAddress: '0x' + 'a'.repeat(40),
      items: [
        {
          status: 'incomplete',
          data: {
            sign: { message: 'second' },
            post: {
              method: 'POST',
              endpoint: '/authorize',
              body: { nonce: 2 },
            },
          },
        },
      ],
    },
  ];
  const deposit: Deposit = {
    id: 'deposit',
    network: 'testnet',
    recipient: '0x' + 'a'.repeat(40),
    route: 'route',
    quote,
    expiresAt: Date.now() + 10000,
    state: 'awaiting_funds',
    baseline: '0',
    createdAt: Date.now(),
    completedSteps: [],
  };
  const submit = vi.fn(async () => ({ ok: true }));
  const signature = '0x' + '11'.repeat(64) + '1b';
  try {
    await writeDeposits([deposit], path);
    expect(signatureSteps(deposit)[0].payload).toMatchObject({
      message: { nonce: 1 },
      primaryType: 'Mapping',
    });
    await expect(
      submitDepositSignature('deposit', 'second:0', signature, {
        path,
        submit,
      }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    expect(submit).not.toHaveBeenCalled();
    await submitDepositSignature('deposit', 'first:0', signature, {
      path,
      submit,
    });
    expect((await readDeposits(path))[0].completedSteps).toEqual(['first:0']);
    await submitDepositSignature('deposit', 'second:0', signature, {
      path,
      submit,
    });
    expect(
      await submitDepositSignature('deposit', 'second:0', signature, {
        path,
        submit,
      }),
    ).toEqual({ complete: true });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0]).toEqual([
      `https://api.testnets.relay.link/authorize?signature=${signature}`,
      { nonce: 1 },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
