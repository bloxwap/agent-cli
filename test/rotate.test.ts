import { expect, test, vi } from 'vitest';
import { rotationHandoff, type Rotation } from '../src/commands/rotate.js';
test('rotation never exposes old revocation until approval verification and swap', async () => {
  const rotation = {
    next: {},
    swapped: false,
    revoke: { action: { type: 'approveAgent' } },
  } as unknown as Rotation;
  const swap = vi.fn(async () => {}),
    persist = vi.fn(async () => {});
  await expect(
    rotationHandoff(rotation, { verify: async () => false, swap, persist }),
  ).rejects.toMatchObject({ code: 'AGENT_NOT_APPROVED' });
  expect(swap).not.toHaveBeenCalled();
  expect(
    await rotationHandoff(rotation, {
      verify: async () => true,
      swap,
      persist,
    }),
  ).toBe(rotation.revoke);
  expect(rotation.swapped).toBe(true);
  expect(persist).toHaveBeenCalledOnce();
});
