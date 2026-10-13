import '../src/commands/config.js';
import { dispatch } from '../src/core/router.js';
import { mkdtemp, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadConfig, saveConfig, migrate } from '../src/core/config.js';
test('atomic private store, migration and corrupt input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-'));
  const path = join(dir, 'state', 'config.json');
  try {
    await saveConfig({ network: 'testnet' }, path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'state'))).mode & 0o777).toBe(0o700);
    expect(
      (await loadConfig(path, { BLOXWAP_NETWORK: 'mainnet' })).network,
    ).toBe('mainnet');
    await writeFile(path, 'broken');
    await expect(loadConfig(path, {})).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('builder defaults, persisted overrides and validated environment precedence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bloxwap-builder-'));
  const path = join(dir, 'config.json');
  const address = '0x' + 'b'.repeat(40);
  try {
    expect((await loadConfig(path, {})).builder).toEqual({
      address: '0x71b09A08257078A4d642F7Dd7315e656c837329a',
      fee: 10,
    });
    expect(migrate({ builder: {} }).builder.fee).toBe(10);
    for (const [key, value] of [
      ['builder.address', address],
      ['builder.fee', '0'],
    ]) {
      expect(
        (await dispatch(['config', 'set', key, value, '--config', path])).body,
      ).toMatchObject({ ok: true });
    }
    expect((await loadConfig(path, {})).builder).toEqual({ address, fee: 0 });
    expect(
      (
        await loadConfig(path, {
          BLOXWAP_BUILDER_ADDRESS: '0x' + 'c'.repeat(40),
          BLOXWAP_BUILDER_FEE: '20',
        })
      ).builder,
    ).toEqual({ address: '0x' + 'c'.repeat(40), fee: 20 });
    for (const fee of ['bad', '', '-1', '101', '1.5'])
      await expect(
        loadConfig(path, { BLOXWAP_BUILDER_FEE: fee }),
      ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    await expect(
      loadConfig(path, { BLOXWAP_BUILDER_ADDRESS: 'bad' }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
