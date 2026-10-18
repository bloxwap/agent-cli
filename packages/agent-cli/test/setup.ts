import { afterAll, beforeAll, vi } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
const testHome = vi.hoisted(() => {
  const root = process.env.RUNNER_TEMP || '/tmp';
  return `${root}/bloxwap-unit-${process.pid}-${Math.random().toString(16).slice(2)}`;
});
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => testHome,
}));
beforeAll(async () => {
  await mkdir(testHome, { recursive: true, mode: 0o700 });
});
afterAll(async () => {
  await rm(testHome, { recursive: true, force: true });
});
// Explicit service fixtures may replace this stub; accidental unit-test network fails.
vi.stubGlobal('fetch', async () => {
  throw new Error('Unit test attempted an unmocked network request');
});
