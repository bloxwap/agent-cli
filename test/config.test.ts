import { mkdtemp, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { loadConfig, saveConfig } from '../src/core/config.js';
test('atomic private store, migration and corrupt input',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bloxwap-')); const path=join(dir,'state','config.json');
 try {
  await saveConfig({network:'testnet'},path);expect((await stat(path)).mode & 0o777).toBe(0o600);expect((await stat(join(dir,'state'))).mode & 0o777).toBe(0o700);
  expect((await loadConfig(path,{BLOXWAP_NETWORK:'mainnet'})).network).toBe('mainnet');
  await writeFile(path,'broken');await expect(loadConfig(path,{})).rejects.toMatchObject({code:'CONFIG_INVALID'});
 } finally {await rm(dir,{recursive:true,force:true});}
});
