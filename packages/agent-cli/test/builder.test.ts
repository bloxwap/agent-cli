import { expect, test } from 'vitest';
import { approvedBuilder } from '../src/core/builder.js';
import { migrate } from '../src/core/config.js';
test('builder fee cannot exceed master approval', async () => {
  const config = migrate({
    masterAddress: '0x' + 'a'.repeat(40),
    builder: { address: '0x' + 'b'.repeat(40), fee: 10 },
  });
  expect(await approvedBuilder(config, async () => 10)).toEqual({
    b: config.builder.address,
    f: 10,
  });
  await expect(approvedBuilder(config, async () => 9)).rejects.toMatchObject({
    code: 'AGENT_NOT_APPROVED',
  });
});

test('zero builder fee omits the builder without an approval lookup', async () => {
  const config = migrate({});
  const fetchMaximum = async () => {
    throw new Error('unexpected approval lookup');
  };
  expect(await approvedBuilder(config, fetchMaximum)).toBeUndefined();
});
