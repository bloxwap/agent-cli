import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertAgentValid, expiryWarnings } from '../src/wallet/expiry.js';
import { migrate } from '../src/core/config.js';
test('mocked clock blocks expiry and emits each threshold once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-expiry-'));
  const config = migrate({ agentExpiry: 15 * 86400000 });
  const data: unknown[] = [];
  try {
    const options = {
      path: join(dir, 'warnings.json'),
      now: 12 * 86400000,
      emit: async (value: unknown) => {
        data.push(value);
      },
    };
    expect(await expiryWarnings(config, options)).toHaveLength(2);
    expect(await expiryWarnings(config, options)).toHaveLength(0);
    assertAgentValid(config, 14 * 86400000);
    expect(() => assertAgentValid(config, 15 * 86400000)).toThrow(
      expect.objectContaining({ code: 'AGENT_EXPIRED', retryable: false }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
